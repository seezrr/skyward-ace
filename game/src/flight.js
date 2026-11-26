import * as THREE from 'three';
import { clamp, damp, scratch } from './util.js';

const LOCAL_FORWARD = new THREE.Vector3(0, 0, -1);
const LOCAL_UP = new THREE.Vector3(0, 1, 0);
const LOCAL_RIGHT = new THREE.Vector3(1, 0, 0);
const GRAVITY = 9.8;

// Arcade-sim flight: lift follows airspeed, stalls bite, banking trades lift for turn rate.
export class FlightModel {
  constructor(object) {
    this.object = object;
    this.velocity = new THREE.Vector3();
    this.throttle = 0.62;
    this.airbrake = false;
    this.boosting = false;
    this.stalled = false;
    this.gForce = 1;
    this.rollRate = 0;
    this.pitchRate = 0;
    this.yawRate = 0;
    this.rollAccum = 0;
    this.barrelRolls = 0;
    this.invertedTime = 0;
    this.skimTime = 0;
    this.distance = 0;
    this.reset(new THREE.Vector3(0, 118, 330), new THREE.Quaternion(), 88);
  }

  reset(position, quaternion, speed = 86) {
    this.object.position.copy(position);
    this.object.quaternion.copy(quaternion);
    this.getForward(this.velocity).multiplyScalar(speed);
    this.throttle = 0.62;
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

  update(dt, input) {
    const forward = scratch.v1;
    const up = scratch.v2;
    const right = scratch.v3;
    const accel = scratch.v4;
    this.getForward(forward);
    this.getUp(up);
    this.getRight(right);

    this.boosting = input.boost;
    this.airbrake = input.brake;
    const targetThrottle = input.boost ? 1 : input.brake ? 0.12 : this.throttle;
    this.throttle = damp(this.throttle, targetThrottle, input.boost ? 4.2 : 2.5, dt);

    const speed = this.speed;
    const authority = clamp(speed / 78, 0.28, 1.35) * (this.stalled ? 0.42 : 1);

    const targetPitch = input.pitch * 1.05 * authority;
    const targetRoll = input.roll * 2.25 * authority;
    const targetYaw = input.yaw * 0.62 * authority;
    this.pitchRate = damp(this.pitchRate, targetPitch, 7.5, dt);
    this.rollRate = damp(this.rollRate, targetRoll, 8.5, dt);
    this.yawRate = damp(this.yawRate, targetYaw, 6.0, dt);

    if (this.stalled) {
      // Nose drops by itself; pulling through the recovery is rewarded.
      this.pitchRate = damp(this.pitchRate, -0.72, 2.6, dt);
    }

    this.object.rotateX(this.pitchRate * dt);
    this.object.rotateY(this.yawRate * dt);
    this.object.rotateZ(this.rollRate * dt);
    this.object.quaternion.normalize();

    this.getForward(forward);
    this.getUp(up);
    this.getRight(right);

    accel.set(0, -GRAVITY, 0);
    const thrust = 13 * this.throttle * (input.boost ? 1.85 : 1) * (input.brake ? 0.25 : 1);
    accel.addScaledVector(forward, thrust);

    const liftRatio = clamp(speed / 88, 0, 1.45);
    const lift = GRAVITY * liftRatio * liftRatio * (this.stalled ? 0.26 : 1);
    accel.addScaledVector(up, lift);

    const drag = 0.012 + speed * 0.00075 + (input.brake ? 0.095 : 0);
    accel.addScaledVector(this.velocity, -drag);

    // Kill most sideslip so the arcade plane carves instead of sliding.
    const sideSpeed = this.velocity.dot(right);
    accel.addScaledVector(right, -sideSpeed * 1.25);

    this.velocity.addScaledVector(accel, dt);
    const newSpeed = this.velocity.length();
    const maxSpeed = input.boost ? 226 : 182;
    if (newSpeed > maxSpeed) this.velocity.multiplyScalar(maxSpeed / newSpeed);
    if (newSpeed < 12) this.velocity.addScaledVector(forward, 22 * dt);

    this.object.position.addScaledVector(this.velocity, dt);
    this.distance += this.speed * dt;

    this.stalled = this.speed < 32 && this.object.position.y > 8;

    const turnAccel = Math.abs(this.rollRate * this.speed) * 0.36 + Math.abs(this.pitchRate * this.speed) * 0.52;
    this.gForce = damp(this.gForce, clamp(1 + turnAccel / GRAVITY, 1, 8.5), 5, dt);

    this.rollAccum += this.rollRate * dt;
    if (Math.abs(this.rollAccum) > Math.PI * 2) {
      this.barrelRolls++;
      this.rollAccum -= Math.sign(this.rollAccum) * Math.PI * 2;
    }
    if (up.y < -0.25) this.invertedTime += dt;
    if (this.object.position.y < 26 && this.speed > 55) this.skimTime += dt;
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
    this.getUp(up);
    const right = scratch.v1;
    this.getRight(right);
    return Math.atan2(right.y, up.y) * 180 / Math.PI;
  }
}
