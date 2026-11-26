import * as THREE from 'three';
import { clamp, formatTime, scratch } from './util.js';

const WAVE_PLAN = [
  [{ type: 'drone', count: 3 }],
  [{ type: 'drone', count: 4 }, { type: 'interceptor', count: 2 }],
  [{ type: 'interceptor', count: 3 }, { type: 'fortress', count: 1 }],
  [{ type: 'interceptor', count: 4 }, { type: 'fortress', count: 2 }],
];

export class GameDirector {
  constructor(ctx) {
    this.ctx = ctx;
    this.mode = 'free';
    this.active = false;
    this.prevPosition = new THREE.Vector3();
    this.safePosition = new THREE.Vector3();
    this.safeQuaternion = new THREE.Quaternion();
    this.safeClock = 0;
    this.stats = {};
  }

  start(mode) {
    const { flight, combat, world, fx, hud, audio, plane } = this.ctx;
    this.mode = mode;
    this.active = true;
    this.score = 0;
    this.combo = 1;
    this.comboTimer = 0;
    this.time = 0;
    this.timeLeft = 0;
    this.ringIndex = 0;
    this.wave = 0;
    this.waveDelay = 0;
    this.spawnedWave = false;
    this.lastBarrels = 0;
    this.lastInverted = 0;
    this.lastSkim = 0;
    this.carrierLosses = 0;

    combat.reset();
    fx.clear();
    flight.reset(new THREE.Vector3(0, 118, 330), new THREE.Quaternion(), 88);
    plane.updateMatrixWorld(true);
    this.prevPosition.copy(flight.object.position);
    this.safePosition.copy(flight.object.position);
    this.safeQuaternion.copy(flight.object.quaternion);

    if (mode === 'wave') {
      this.timeLeft = 240;
      hud.showHint('PROTECT THE CARRIERS · SHOOT DOWN THE DRONES', 7);
      this.startNextWave();
    } else if (mode === 'ring') {
      this.timeLeft = 150;
      world.highlightRing(0);
      hud.showHint('FLY THROUGH THE GLOWING RING · CHAIN COMBOS', 7);
    } else {
      hud.showHint('FREE FLIGHT · BARREL ROLLS, INVERTED TIME, SEA SKIMMING SCORE', 8);
    }
    audio.ui();
  }

  startNextWave() {
    const { combat, hud, audio } = this.ctx;
    this.wave++;
    this.spawnedWave = true;
    const plan = WAVE_PLAN[this.wave - 1];
    if (!plan) return;
    const heading = this.ctx.flight.headingDegrees() * Math.PI / 180;
    let index = 0;
    for (const group of plan) {
      for (let i = 0; i < group.count; i++) {
        const spread = (index - (group.count * 0.5)) * 62;
        const pos = scratch.v1.set(
          this.ctx.flight.object.position.x + spread + Math.sin(heading) * 260,
          95 + (index % 3) * 28,
          this.ctx.flight.object.position.z - 300 - Math.random() * 120,
        );
        combat.spawnEnemy(group.type, pos);
        index++;
      }
    }
    hud.popup(scratch.v2.copy(this.ctx.flight.object.position).add(new THREE.Vector3(0, 42, -160)), 'WAVE ' + this.wave, '#ffc26b');
    audio.alarm();
  }

  update(dt) {
    if (!this.active) return;
    const { flight, combat, world, hud, fx, audio, plane } = this.ctx;
    this.time += dt;
    this.prevPosition.copy(flight.object.position);

    this.updateCrash(dt);
    if (this.mode === 'free') this.updateFree(dt);
    else if (this.mode === 'wave') this.updateWave(dt);
    else this.updateRing(dt);

    if (this.mode !== 'wave') this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 1;
    }
  }

  updateCrash(dt) {
    const { flight, hud, fx, audio, world } = this.ctx;
    const pos = flight.object.position;
    this.safeClock += dt;
    if (this.safeClock > 0.75 && pos.y > 45 && !this.overLand(pos)) {
      this.safeClock = 0;
      this.safePosition.copy(pos);
      this.safeQuaternion.copy(flight.object.quaternion);
    }
    let crashed = pos.y < 4;
    if (!crashed && this.overLand(pos)) crashed = true;
    if (!crashed) return;

    fx.spawnExplosion(pos, 1.15, false);
    audio.explosion();
    hud.damageFlash();
    this.ctx.callbacks.onShake(1.6);
    if (this.mode === 'free') {
      this.score = Math.max(0, this.score - 100);
      hud.showHint('RESPAWNED · −100 STUNT POINTS', 2.4);
      flight.reset(this.safePosition, this.safeQuaternion, 88);
    } else {
      flight.reset(new THREE.Vector3(0, 140, 330), new THREE.Quaternion(), 92);
    }
    this.prevPosition.copy(flight.object.position);
  }

  overLand(pos) {
    const islands = this.ctx.world.islands || [];
    for (const island of islands) {
      const dx = pos.x - island.x;
      const dz = pos.z - island.z;
      const d = Math.hypot(dx, dz);
      if (d > island.radius * 1.06) continue;
      const surface = island.height * (1.2 - d / island.radius) + 4;
      if (pos.y < surface) return true;
    }
    return false;
  }

  updateFree(dt) {
    const { flight, hud, combat } = this.ctx;
    this.score += flight.speed * dt * 0.08;
    if (flight.barrelRolls > this.lastBarrels) {
      this.lastBarrels = flight.barrelRolls;
      this.combo = Math.min(8, this.combo + 1);
      const bonus = 400 * this.combo;
      this.score += bonus;
      this.comboTimer = 5;
      hud.popup(flight.object.position, 'BARREL ROLL +' + bonus, '#ffc26b');
      this.ctx.audio.ring();
    }
    if (flight.invertedTime - this.lastInverted > 3) {
      this.lastInverted = flight.invertedTime;
      const bonus = 300 * this.combo;
      this.score += bonus;
      hud.popup(flight.object.position, 'INVERTED +' + bonus, '#9ef4ff');
    }
    if (flight.skimTime - this.lastSkim > 2) {
      this.lastSkim = flight.skimTime;
      const bonus = 250 * this.combo;
      this.score += bonus;
      hud.popup(flight.object.position, 'SEA SKIM +' + bonus, '#9ef4ff');
      if (flight.object.position.y < 16) {
        this.ctx.fx.spawnSplash(scratch.v1.copy(flight.object.position).setY(2));
        this.ctx.audio.splash();
      }
    }
    void combat;
  }

  updateWave(dt) {
    const { combat, world, hud } = this.ctx;
    let aliveCarriers = 0;
    for (const carrier of world.carriers) if (carrier.alive) aliveCarriers++;
    if (aliveCarriers <= 0) {
      this.end(false, 'FLEET LOST');
      return;
    }
    if (combat.aliveCount() === 0) {
      if (this.wave >= WAVE_PLAN.length) {
        this.end(true, 'ALL WAVES CLEARED');
        return;
      }
      this.waveDelay += dt;
      if (this.waveDelay > 2.6) {
        this.waveDelay = 0;
        this.startNextWave();
      }
    }
    void hud;
  }

  updateRing(dt) {
    const { world, flight, hud, audio } = this.ctx;
    const ring = world.rings[this.ringIndex];
    if (!ring) {
      this.end(true, 'COURSE COMPLETE');
      return;
    }
    const current = flight.object.position;
    const before = this.prevPosition;
    const d0 = scratch.v1.subVectors(before, ring.position).dot(ring.normal);
    const d1 = scratch.v2.subVectors(current, ring.position).dot(ring.normal);
    if (d0 < 0 && d1 >= 0) {
      const lateral = scratch.v3.copy(current).addScaledVector(ring.normal, -d1).distanceTo(ring.position);
      if (lateral < ring.radius + 3) {
        this.combo = Math.min(9, this.combo + 1);
        this.comboTimer = 4.5;
        const bonus = 1000 * this.combo;
        this.score += bonus;
        this.timeLeft = Math.min(180, this.timeLeft + 3.5);
        hud.popup(ring.position, 'RING ' + (this.ringIndex + 1) + ' +' + bonus, '#ffc26b');
        audio.ring();
        this.ctx.callbacks.onShake(0.2);
        this.ringIndex++;
        if (this.ringIndex >= world.rings.length) {
          this.end(true, 'COURSE COMPLETE');
          return;
        }
        world.highlightRing(this.ringIndex);
      }
    }
    void dt;
  }

  end(victory, reason) {
    if (!this.active) return;
    this.active = false;
    const { combat, flight, world } = this.ctx;
    const accuracy = combat.shotsFired ? combat.shotsHit / combat.shotsFired : 0;
    let carriers = 0;
    for (const carrier of world.carriers) if (carrier.alive) carriers++;
    this.stats = {
      victory,
      reason,
      mode: this.mode,
      score: Math.round(this.score),
      accuracy,
      kills: combat.kills,
      shotsFired: combat.shotsFired,
      rings: this.ringIndex,
      barrels: flight.barrelRolls,
      inverted: Math.round(flight.invertedTime),
      skim: Math.round(flight.skimTime),
      carriers,
      time: this.time,
      timeLeft: this.timeLeft,
    };
    this.ctx.callbacks.onEnd(this.stats);
  }

  forceEnd() {
    this.end(this.mode !== 'wave', 'DEBUG EARLY EXIT');
  }

  hudState() {
    if (this.mode === 'wave') {
      let carriers = 0;
      for (const carrier of this.ctx.world.carriers) if (carrier.alive) carriers++;
      return {
        modeLabel: 'WAVE DEFENSE · WAVE ' + this.wave + '/4',
        modeValue: 'FLEET ' + carriers + '/3',
        modeSub: 'HOSTILES ' + this.ctx.combat.aliveCount() + ' · SCORE ' + Math.round(this.score),
      };
    }
    if (this.mode === 'ring') {
      return {
        modeLabel: 'RING TRIAL · GATE ' + Math.min(this.ringIndex + 1, 10) + '/10',
        modeValue: formatTime(this.timeLeft),
        modeSub: 'COMBO x' + this.combo + ' · SCORE ' + Math.round(this.score),
      };
    }
    return {
      modeLabel: 'FREE FLIGHT · STUNT SCORE',
      modeValue: String(Math.round(this.score)),
      modeSub: 'ROLLS ' + this.ctx.flight.barrelRolls + ' · INVERTED ' + Math.round(this.ctx.flight.invertedTime) + 's · SKIM ' + Math.round(this.ctx.flight.skimTime) + 's',
    };
  }
}
