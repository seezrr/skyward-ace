import * as THREE from 'three';
import { clamp, damp, scratch } from './util.js';

const LOCAL_FORWARD = new THREE.Vector3(0, 0, -1);
const LOCAL_UP = new THREE.Vector3(0, 1, 0);
const LOCAL_RIGHT = new THREE.Vector3(1, 0, 0);
const GRAVITY = 9.8;

// Arcade-sim: throttle is a setting, boost is a burst, and lift follows
// airspeed with a soft warning before a stall. Auto-level keeps it welcoming.
export class FlightModel {
  constructor(object) {
    this.object = object;
    this.velocity = new THREE.Vector3();
    this.throttle = 0.58;
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
    this.lift = 0;
    this.reset(new THREE.Vector3(0, 128, 330), new THREE.Quaternion(), 88);
  }

  reset(position, quaternion, speed = 88) {
    this.object.position.copy(position);
    this.object.quaternion.copy(quaternion);
    this.getForward(this.velocity).multiplyScalar(speed);
    this.throttle = 0.58;
    this.boosting = false;
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
    const authority = clamp(speed / 82, 0.32, 1.3) * (this.stalled ? 0.55 : 1);
    let pitchInput = input.pitch;
    let rollInput = input.roll;
    const yawInput = input.yaw;

    // Assisted auto-level only steps in when the stick is quiet.
    if (this.autoLevel && Math.abs(rollInput) < 0.08) {
      const bank = this.bankDegrees() * Math.PI / 180;
      rollInput = clamp(-bank * 0.42, -0.55, 0.55);
    }
    if (this.autoLevel && Math.abs(pitchInput) < 0.08) {
      const pitch = this.pitchDegrees() * Math.PI / 180;
      pitchInput = clamp(-pitch * 0.22, -0.3, 0.3);
    }

    const targetPitch = pitchInput * 1.02 * authority;
    const targetRoll = rollInput * 2.2 * authority;
    const targetYaw = yawInput * 0.58 * authority;
    this.pitchRate = damp(this.pitchRate, targetPitch, 7.2, dt);
    this.rollRate = damp(this.rollRate, targetRoll, 8.1, dt);
    this.yawRate = damp(this.yawRate, targetYaw, 6.2, dt);

    this.stallWarning = speed < 48 && this.object.position.y > 10;
    if (this.stalled) this.pitchRate = damp(this.pitchRate, -0.62, 2.8, dt);

    this.object.rotateX(this.pitchRate * dt);
    this.object.rotateY(this.yawRate * dt);
    this.object.rotateZ(this.rollRate * dt);
    this.object.quaternion.normalize();

    this.getForward(forward);
    this.getUp(up);
    this.getRight(right);

    accel.set(0, -GRAVITY, 0);
    const thrust = 12.5 * this.throttle * (this.boosting ? 1.9 : 1) * (this.braking ? 0.22 : 1);
    accel.addScaledVector(forward, thrust);

    const liftRatio = clamp(speed / 86, 0, 1.5);
    this.lift = GRAVITY * liftRatio * liftRatio * (this.stalled ? 0.34 : 1);
    accel.addScaledVector(up, this.lift);

    const drag = 0.010 + speed * 0.00068 + (this.braking ? 0.078 : 0);
    accel.addScaledVector(this.velocity, -drag);
    accel.addScaledVector(right, -this.velocity.dot(right) * 1.3);

    this.velocity.addScaledVector(accel, dt);
    const newSpeed = this.velocity.length();
    const maxSpeed = this.boosting ? 218 : 176;
    if (newSpeed > maxSpeed) this.velocity.multiplyScalar(maxSpeed / newSpeed);
    if (newSpeed < 14) this.velocity.addScaledVector(forward, 20 * dt);

    this.object.position.addScaledVector(this.velocity, dt);
    this.distance += this.speed * dt;
    this.stalled = this.speed < 29 && this.object.position.y > 8;

    const turnAccel = Math.abs(this.rollRate * this.speed) * 0.34 + Math.abs(this.pitchRate * this.speed) * 0.5;
    this.gForce = damp(this.gForce, clamp(1 + turnAccel / GRAVITY, 1, 7.5), 5, dt);

    this.rollAccum += this.rollRate * dt;
    if (Math.abs(this.rollAccum) > Math.PI * 2) {
      this.barrelRolls++;
      this.rollAccum -= Math.sign(this.rollAccum) * Math.PI * 2;
    }
    if (up.y < -0.25) this.invertedTime += dt;
    if (this.object.position.y < 28 && this.speed > 55) this.skimTime += dt;
  }

  headingDegrees() {
    const forward = scratch.v5;
    this.getForward(forward);
    let heading = Math.atan2(forward.x, -forward.z) * 180 / Math.PI;
    if (heading < 0) heading += 360;
    return heading;
  }

  pitchDegrees() {
    const forward = scratch.v5;
    this.getForward(forward);
    return Math.asin(clamp(forward.y, -1, 1)) * 180 / Math.PI;
  }

  bankDegrees() {
    const up = scratch.v5;
    const right = scratch.v1;
    this.getUp(up);
    this.getRight(right);
    return Math.atan2(right.y, up.y) * 180 / Math.PI;
  }
}
