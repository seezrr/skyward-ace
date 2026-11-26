import * as THREE from 'three';
import { clamp, dailySeed, formatTime, readStore, scratch, writeStore } from './util.js';

const RING_TIME = 78;
const COMBO_WINDOW = 4.6;

export class GameDirector {
  constructor(ctx) {
    this.ctx = ctx;
    this.mode = 'ring';
    this.active = false;
    this.prevPosition = new THREE.Vector3();
    this.safePosition = new THREE.Vector3();
    this.safeQuaternion = new THREE.Quaternion();
    this.safeClock = 0;
    this.recoveryGrace = 0;
    this.crashes = 0;
    this.stormClock = 0;
    this.stats = {};
    this.hudTarget = {
      active: false,
      position: new THREE.Vector3(),
      radius: 30,
      distance: 0,
      axial: 0,
      lateral: 0,
      alignment: 0,
    };
    this.seed = dailySeed();
    this.best = 0;
    this.timer = 0;
  }

  start(mode) {
    const { flight, world, fx, audio, hud, plane } = this.ctx;
    this.mode = mode;
    this.active = true;
    this.score = 0;
    this.combo = 1;
    this.comboTimer = 0;
    this.time = 0;
    this.timer = RING_TIME;
    this.ringIndex = 0;
    this.ringsPassed = 0;
    this.nearMisses = 0;
    this.lanterns = 0;
    this.stormClock = 0;
    this.safeClock = 0;
    this.recoveryGrace = 0;
    this.crashes = 0;
    this.lastBarrels = 0;
    this.lastSkim = 0;
    this.updraft = 0;
    this.storm = false;
    this.seed = mode === 'daily' ? dailySeed() : world.seed;
    if (mode === 'daily') world.setSeed(this.seed);
    world.resetRun();
    fx.clear();
    flight.reset(new THREE.Vector3(0, 128, 330), new THREE.Quaternion(), 88);
    plane.updateMatrixWorld(true);
    this.prevPosition.copy(flight.object.position);
    this.safePosition.copy(flight.object.position);
    this.safeQuaternion.copy(flight.object.quaternion);
    const bestKey = mode === 'daily' ? 'halcyon.daily.' + this.seed : 'halcyon.ring.best';
    this.best = Number(readStore(bestKey, 0)) || 0;
    if (mode === 'ring') hud.showHint('CHAIN GLOWING RINGS · CLOSE PASSES ADD WIND BONUS', 6);
    else if (mode === 'daily') hud.showHint('TODAY’S SEED · ONE COURSE FOR EVERYONE', 6);
    else hud.showHint('COLLECT SKY LANTERNS · RIDE THE UPDRAFTS · NO TIMER', 6);
    audio.ui();
    audio.ringIndex = 0;
  }

  update(dt, windLift = 0) {
    if (!this.active) return;
    const { flight, world, fx, audio, hud } = this.ctx;
    this.time += dt;
    this.updraft = windLift;
    const current = flight.object.position;
    const before = this.prevPosition;

    const recovered = this.updateCrash(dt);
    this.updateStorms(dt);
    if (this.mode === 'free') this.updateFree(dt);
    else if (!recovered) this.updateRing(before, current);

    if (this.mode !== 'free') {
      this.timer = Math.max(0, this.timer - dt);
      if (this.timer <= 0) {
        this.end(false, 'THE SUN WENT DOWN');
        return;
      }
    }
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 1;
    }
    this.prevPosition.copy(current);
  }

  updateCrash(dt) {
    const { flight, world, fx, audio, hud } = this.ctx;
    const pos = flight.object.position;
    if (this.recoveryGrace > 0) {
      this.recoveryGrace = Math.max(0, this.recoveryGrace - dt);
      return false;
    }

    const surface = world.collisionHeightAt(pos.x, pos.z);
    const clearance = pos.y - surface;
    if (clearance > 6) {
      // Only bank clear, high airspace as a preferred checkpoint. A point just
      // above a ridge can be inside the next ridge a second later.
      if (clearance > 95 && pos.y < 300 && flight.speed > 45) {
        this.safeClock += dt;
        if (this.safeClock > 0.8) {
          this.safePosition.copy(pos);
          this.safeQuaternion.copy(flight.object.quaternion);
          this.safeClock = 0;
        }
      } else {
        this.safeClock = Math.min(this.safeClock, 0.5);
      }
      return false;
    }

    this.crashes++;
    fx.crash(pos);
    audio.crash();
    hud.flash('crash');
    hud.showHint('AUTO RECOVERY · CLIMBING CLEAR', 2.2);
    this.ctx.callbacks.onShake(0.7);
    this.score = Math.max(0, this.score - 60);
    this.combo = 1;

    const away = scratch.v8.copy(flight.velocity).negate().normalize();
    const recovery = world.findSafeRespawn(pos, away, this.safePosition);
    flight.reset(recovery.position, recovery.quaternion, clamp(flight.speed, 72, 96));
    this.prevPosition.copy(flight.object.position);
    this.recoveryGrace = 1.15;
    if (this.ctx.callbacks.onRecover) this.ctx.callbacks.onRecover();
    return true;
  }

  updateStorms(dt) {
    const { flight, world, audio, hud } = this.ctx;
    const storm = world.stormAt(flight.object.position);
    this.storm = !!storm;
    if (!storm) return;
    flight.velocity.multiplyScalar(Math.max(0.72, 1 - dt * 0.85));
    this.stormClock -= dt;
    if (this.stormClock <= 0) {
      this.stormClock = 1.1;
      audio.storm();
      hud.showHint('TURBULENCE · FIND CLEAR SKY', 1.6);
      this.ctx.callbacks.onShake(0.35);
    }
  }

  updateRing(before, current) {
    const { world, flight, fx, audio, hud } = this.ctx;
    const ring = world.rings[this.ringIndex];
    if (!ring) {
      this.end(true, 'COURSE COMPLETE');
      return;
    }
    const d0 = scratch.v1.subVectors(before, ring.position).dot(ring.normal);
    const d1 = scratch.v2.subVectors(current, ring.position).dot(ring.normal);
    if (d0 >= 0 || d1 < 0) return;
    // Gates only count when the aircraft is travelling through them, and the
    // lateral offset is measured at the exact segment/plane crossing instead
    // of at the frame after it. Fast passes now score where they visually
    // crossed, not where the plane happened to be one frame later.
    const forward = scratch.v4.copy(flight.velocity).normalize();
    if (forward.dot(ring.normal) < 0.15) return;
    const t = d0 / (d0 - d1);
    const hit = scratch.v3.copy(before).lerp(current, t);
    const lateral = hit.distanceTo(ring.position);
    if (lateral < ring.radius) {
      ring.passed = true;
      this.combo = Math.min(9, this.combo + 1);
      this.comboTimer = COMBO_WINDOW;
      const bonus = 500 * this.combo;
      this.score += bonus;
      this.timer = Math.min(RING_TIME + 12, this.timer + 4.2);
      this.ringsPassed++;
      fx.burst(ring.position, 0xffd39a, 20, 34, 6);
      audio.ring(this.combo);
      hud.popup(ring.position, 'RING ' + (this.ringIndex + 1) + '  +' + bonus, '#ffd39a');
      this.ctx.callbacks.onShake(0.14);
      this.ringIndex++;
      if (this.ringIndex >= world.rings.length) {
        this.end(true, 'COURSE COMPLETE');
        return;
      }
      world.highlightRing(this.ringIndex);
    } else if (!ring.nearMissed && lateral < ring.radius + 19) {
      ring.nearMissed = true;
      this.nearMisses++;
      const bonus = 180 * this.combo;
      this.score += bonus;
      flight.getForward(scratch.v4).multiplyScalar(-1);
      fx.windStreak(current, scratch.v4, 0xa8f0d6);
      audio.updraft();
      hud.popup(current, 'WIND STREAK  +' + bonus, '#a8f0d6');
    }
  }

  updateFree(dt) {
    const { world, flight, fx, audio, hud } = this.ctx;
    this.score += flight.speed * dt * 0.055;
    const lantern = world.collectLantern(flight.object.position, 14);
    if (lantern) {
      this.lanterns++;
      this.combo = Math.min(9, this.combo + 1);
      this.comboTimer = COMBO_WINDOW;
      const bonus = 220 * this.combo;
      this.score += bonus;
      fx.burst(lantern.position, 0xffdfa6, 16, 27, 5);
      audio.lantern();
      hud.popup(lantern.position, 'LANTERN  +' + bonus, '#ffdfa6');
    }
    if (flight.barrelRolls > this.lastBarrels) {
      this.lastBarrels = flight.barrelRolls;
      const bonus = 300 * this.combo;
      this.score += bonus;
      hud.popup(flight.object.position, 'ROLL  +' + bonus, '#a8f0d6');
      audio.ring(this.combo);
    }
    if (this.updraft > 4) this.score += this.updraft * dt * 12;
    if (this.updraft > 6) audio.updraft();
  }

  end(victory, reason) {
    if (!this.active) return;
    this.active = false;
    const { flight, world } = this.ctx;
    const stars = this.mode === 'free'
      ? clamp(1 + Math.floor(this.lanterns / 5), 1, 3)
      : clamp(1 + Math.floor(this.ringsPassed / 4) + (victory ? 1 : 0), 1, 3);
    this.stats = {
      victory,
      reason,
      mode: this.mode,
      score: Math.round(this.score),
      combo: this.combo,
      rings: this.ringsPassed,
      totalRings: world.rings.length,
      nearMisses: this.nearMisses,
      lanterns: this.lanterns,
      barrels: flight.barrelRolls,
      time: this.time,
      timer: this.timer,
      seed: this.seed,
      stars,
    };
    if (this.mode === 'daily' && this.score > this.best) {
      this.best = Math.round(this.score);
      writeStore('halcyon.daily.' + this.seed, this.best);
    } else if (this.mode === 'ring' && this.score > this.best) {
      this.best = Math.round(this.score);
      writeStore('halcyon.ring.best', this.best);
    }
    this.stats.best = this.best;
    this.ctx.callbacks.onEnd(this.stats);
  }

  forceEnd() {
    this.end(true, 'RUN COMPLETE');
  }

  hudState() {
    const label = this.mode === 'free'
      ? 'FREE FLIGHT'
      : this.mode === 'daily' ? 'DAILY SEED · ' + this.seed : 'RING RUN';
    const value = this.mode === 'free'
      ? String(Math.round(this.score)).padStart(5, '0')
      : formatTime(this.timer);
    const sub = this.mode === 'free'
      ? 'LANTERNS ' + this.lanterns + ' · BEST ' + Math.round(this.best)
      : 'RINGS ' + this.ringIndex + '/' + this.ctx.world.rings.length + ' · BEST ' + Math.round(this.best);

    // The guidance target is also the debug surface used by the playtests:
    // one description of the active gate shared by HUD, tests and scoring.
    const target = this.hudTarget;
    const ring = this.mode === 'free' ? null : this.ctx.world.rings[this.ringIndex];
    if (!ring || !this.active) {
      target.active = false;
    } else {
      const { flight } = this.ctx;
      target.active = true;
      target.position.copy(ring.position);
      target.radius = ring.radius;
      const rel = scratch.v1.subVectors(flight.object.position, ring.position);
      target.axial = rel.dot(ring.normal);
      scratch.v2.copy(rel).addScaledVector(ring.normal, -target.axial);
      target.lateral = scratch.v2.length();
      target.distance = rel.length();
      target.alignment = scratch.v3.copy(flight.velocity).normalize().dot(ring.normal);
    }

    return {
      modeLabel: label,
      modeValue: value,
      modeSub: sub,
      combo: this.combo,
      comboRatio: this.comboTimer / COMBO_WINDOW,
      storm: this.storm,
      updraft: this.updraft,
      seed: this.seed,
      timer: this.timer,
      best: this.best,
      ringTarget: target,
    };
  }
}
