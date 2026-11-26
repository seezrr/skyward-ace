import * as THREE from 'three';
import { clamp, damp, scratch } from './util.js';

const LOCAL_FORWARD = new THREE.Vector3(0, 0, -1);
const LOCAL_UP = new THREE.Vector3(0, 1, 0);
const LOCAL_RIGHT = new THREE.Vector3(1, 0, 0);
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const GRAVITY = 9.81;
const MAX_BANK = 1.15;
const MAX_LIFT_G = 3.6;

// Flight model: A/D bank the wing and turn the aircraft together, W/S pitch,
// Q/E are rudder trim. Lift grows in a bank to hold altitude, sideslip is
// damped, and low speed or a high angle of attack produces a real stall.
// Steering assist (auto-level) clamps the bank and levels the wings; turning
// it off gives full aerobatic roll control for barrel rolls.
export class FlightModel {
  constructor(object) {
    this.object = object;
    this.velocity = new THREE.Vector3();
    this.turnQuat = new THREE.Quaternion();
    this.throttle = 0.62;
    this.boosting = false;
    this.braking = false;
    this.stallWarning = false;
    this.stalled = false;
    this.autoLevel = true;
    this.gForce = 1;
    this.rollRate = 0;
    this.pitchRate = 0;
    this.yawRate = 0;
    this.rollAccum = 0;
    this.barrelRolls = 0;
    this.invertedTime = 0;
    this.skimTime = 0;
    this.distance = 0;
    this.lift = GRAVITY;
    this.reset(new THREE.Vector3(0, 128, 330), new THREE.Quaternion(), 88);
  }

  reset(position, quaternion, speed = 88) {
    this.object.position.copy(position);
    this.object.quaternion.copy(quaternion);
    this.getForward(this.velocity).multiplyScalar(speed);
    this.throttle = 0.62;
    this.boosting = false;
    this.braking = false;
    this.stallWarning = false;
    this.stalled = false;
    this.gForce = 1;
    this.rollRate = 0;
    this.pitchRate = 0;
    this.yawRate = 0;
    this.rollAccum = 0;
    this.barrelRolls = 0;
    this.invertedTime = 0;
    this.skimTime = 0;
  }

  getForward(out) {
    return out.copy(LOCAL_FORWARD).applyQuaternion(this.object.quaternion);
  }

  getUp(out) {
    return out.copy(LOCAL_UP).applyQuaternion(this.object.quaternion);
  }

  getRight(out) {
    return out.copy(LOCAL_RIGHT).applyQuaternion(this.object.quaternion);
  }

  get speed() {
    return this.velocity.length();
  }

  get verticalSpeed() {
    return this.velocity.y;
  }

  update(dt, input) {
    const forward = scratch.v1;
    const up = scratch.v2;
    const right = scratch.v3;
    const accel = scratch.v4;
    this.getForward(forward);
    this.getUp(up);
    this.getRight(right);

    this.braking = input.brake;
    this.boosting = input.boost;
    if (input.throttleUp) this.throttle = clamp(this.throttle + dt * 0.55, 0.08, 1);
    if (input.throttleDown) this.throttle = clamp(this.throttle - dt * 0.72, 0.08, 1);
    if (this.braking) this.throttle = damp(this.throttle, 0.12, 6, dt);

    const speed = this.speed;
    const authority = clamp(speed / 84, 0.34, 1.25) * (this.stalled ? 0.55 : 1);
    const rollInput = input.roll;
    let pitchInput = input.pitch;

    // Assisted steering: the stick commands a bank angle, then the wings level
    // when released. Unassisted: the stick commands a roll rate for aerobatics.
    if (this.autoLevel) {
      const bank = this.bankRadians();
      const stick = Math.abs(rollInput) < 0.08 ? clamp(-bank * 0.85, -0.5, 0.5) : rollInput;
      const targetBank = stick * MAX_BANK * authority;
      const bankError = targetBank - bank;
      this.rollRate = damp(this.rollRate, clamp(bankError * 6.2, -5, 5), 16, dt);
    } else {
      this.rollRate = damp(this.rollRate, rollInput * 2.8 * authority, 10, dt);
    }
    this.object.rotateZ(this.rollRate * dt);

    if (this.autoLevel) {
      // Assisted pitch settles at a readable 45-degree climb/dive instead of
      // looping the aircraft when the key is held. Aerobatic mode keeps the
      // full stick authority for loops.
      const pitch = this.pitchRadians();
      if (Math.abs(pitchInput) < 0.08) pitchInput = clamp(-pitch * 0.9, -0.45, 0.45);
      else pitchInput = clamp((Math.sign(pitchInput) * 0.78 - pitch) * 1.6, -0.55, 0.55);
    }
    if (this.stalled) pitchInput = -0.55;
    this.pitchRate = damp(this.pitchRate, pitchInput * 1.9 * authority, 9, dt);
    this.object.rotateX(this.pitchRate * dt);
    this.object.quaternion.normalize();

    this.getForward(forward);
    this.getUp(up);
    this.getRight(right);

    // A banked wing makes the aircraft turn around the vertical axis. The
    // rudder adds trim on top of that instead of being the only way to turn.
    const bank = this.bankRadians();
    const coordinated = GRAVITY * Math.tan(clamp(bank, -1.35, 1.35)) / Math.max(speed, 42);
    // The bank-angle relationship still produces a real, speed-dependent
    // turn, but a little extra gain at high speed keeps fast passes from
    // feeling like the plane refuses to follow the stick.
    const speedGain = 1.5 + clamp((speed - 90) / 140, 0, 0.45);
    const targetYaw = clamp(coordinated * speedGain + input.yaw * 0.8 * authority, -2.1, 2.1);
    this.yawRate = damp(this.yawRate, targetYaw, 10, dt);
    this.turnQuat.setFromAxisAngle(WORLD_UP, this.yawRate * dt);
    this.object.quaternion.premultiply(this.turnQuat).normalize();

    this.getForward(forward);
    this.getUp(up);
    this.getRight(right);

    const forwardSpeed = this.velocity.dot(forward);
    const sideSpeed = this.velocity.dot(right);
    const bodyUpSpeed = this.velocity.dot(up);
    const angleOfAttack = clamp(-Math.atan2(bodyUpSpeed, Math.max(Math.abs(forwardSpeed), 10)), -0.6, 0.6);
    this.stallWarning = speed < 52 || (Math.abs(angleOfAttack) > 0.42 && speed < 70);

    accel.set(0, -GRAVITY, 0);

    // In a level turn, lift must rise as 1 / cos(bank) to hold altitude. Its
    // horizontal component is what actually curves the flight path.
    const speedLift = clamp(Math.pow(speed / 86, 2), 0, 1.55);
    const bankLift = 1 / Math.max(0.45, Math.abs(up.y));
    const aoaLift = 1 + clamp(angleOfAttack * 0.55, -0.25, 0.35);
    const stallFactor = this.stalled ? 0.32 : 1;
    this.lift = GRAVITY * clamp(speedLift * bankLift, 0, MAX_LIFT_G) * aoaLift * stallFactor;
    accel.addScaledVector(up, this.lift);

    const thrust = 12.5 * this.throttle * (this.boosting ? 1.9 : 1) * (this.braking ? 0.22 : 1);
    accel.addScaledVector(forward, thrust);

    const drag = 0.011 + speed * 0.0007 + (this.braking ? 0.078 : 0);
    accel.addScaledVector(this.velocity, -drag);

    // Keep the nose and the velocity aligned; this is what makes a bank carve
    // through the air instead of spinning the model in place.
    // Stronger path damping makes the aircraft follow its nose through a gate
    // instead of sliding sideways after the model has already turned.
    accel.addScaledVector(right, -sideSpeed * 3.2);
    accel.addScaledVector(up, -bodyUpSpeed * 0.5);

    this.velocity.addScaledVector(accel, dt);
    const newSpeed = this.velocity.length();
    const maxSpeed = this.boosting ? 218 : 176;
    if (newSpeed > maxSpeed) this.velocity.multiplyScalar(maxSpeed / newSpeed);
    if (newSpeed < 14) this.velocity.addScaledVector(forward, 20 * dt);

    this.object.position.addScaledVector(this.velocity, dt);
    this.distance += this.speed * dt;
    // A high angle of attack alone is not a stall at cruising speed; the wing
    // still flies. Stalling needs low airspeed, otherwise every climb would be
    // pulled over by the recovery logic.
    this.stalled = (this.speed < 30 || (Math.abs(angleOfAttack) > 0.72 && this.speed < 62))
      && this.object.position.y > 8;

    const turnAccel = Math.abs(coordinated) * this.speed;
    const pitchAccel = Math.abs(this.pitchRate) * this.speed * 0.5;
    this.gForce = damp(this.gForce, clamp(1 + (turnAccel + pitchAccel) / GRAVITY, 1, 7.5), 5, dt);

    this.rollAccum += this.rollRate * dt * (this.autoLevel ? 0.18 : 1);
    if (Math.abs(this.rollAccum) > Math.PI * 2) {
      this.barrelRolls++;
      this.rollAccum -= Math.sign(this.rollAccum) * Math.PI * 2;
    }
    if (up.y < -0.25) this.invertedTime += dt;
    if (this.object.position.y < 28 && this.speed > 55) this.skimTime += dt;
  }

  headingDegrees() {
    const forward = scratch.v6;
    this.getForward(forward);
    let heading = Math.atan2(forward.x, -forward.z) * 180 / Math.PI;
    if (heading < 0) heading += 360;
    return heading;
  }

  pitchRadians() {
    const forward = scratch.v6;
    this.getForward(forward);
    return Math.asin(clamp(forward.y, -1, 1));
  }

  pitchDegrees() {
    return this.pitchRadians() * 180 / Math.PI;
  }

  bankRadians() {
    const up = scratch.v6;
    const right = scratch.v7;
    this.getUp(up);
    this.getRight(right);
    return Math.atan2(right.y, up.y);
  }

  bankDegrees() {
    return this.bankRadians() * 180 / Math.PI;
  }
}
