import * as THREE from 'three';
import { clamp, radialTexture, scratch } from './util.js';

const SPARK_COUNT = 64;
const PUFF_COUNT = 48;
const STREAK_COUNT = 48;
const TRAIL_POINTS = 44;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    this.trailClock = 0;
    this.glowTex = radialTexture('rgba(255,255,255,1)', 'rgba(255,205,150,0.52)', 96);
    this.softTex = radialTexture('rgba(255,255,255,0.86)', 'rgba(188,220,225,0.28)', 128);

    this.sparks = [];
    for (let i = 0; i < SPARK_COUNT; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.glowTex, transparent: true, opacity: 0, depthWrite: false,
        blending: THREE.AdditiveBlending, fog: false,
      }));
      sprite.visible = false;
      scene.add(sprite);
      this.sparks.push({ sprite, velocity: new THREE.Vector3(), ttl: 0, max: 1, size: 4 });
    }

    this.puffs = [];
    for (let i = 0; i < PUFF_COUNT; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.softTex, transparent: true, opacity: 0, depthWrite: false, fog: false,
      }));
      sprite.visible = false;
      scene.add(sprite);
      this.puffs.push({ sprite, velocity: new THREE.Vector3(), ttl: 0, max: 1, size: 6, grow: 2 });
    }

    this.streakData = new Float32Array(STREAK_COUNT * 6);
    this.streakColors = new Float32Array(STREAK_COUNT * 6);
    const streakGeo = new THREE.BufferGeometry();
    streakGeo.setAttribute('position', new THREE.BufferAttribute(this.streakData, 3));
    streakGeo.setAttribute('color', new THREE.BufferAttribute(this.streakColors, 3));
    streakGeo.setDrawRange(0, 0);
    this.streakMesh = new THREE.LineSegments(streakGeo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.streakMesh.frustumCulled = false;
    scene.add(this.streakMesh);
    this.streaks = [];
    for (let i = 0; i < STREAK_COUNT; i++) {
      this.streaks.push({ active: false, start: new THREE.Vector3(), end: new THREE.Vector3(), ttl: 0, max: 0.45, color: 0xffd6a0 });
    }

    this.trails = [];
    for (let t = 0; t < 2; t++) {
      const positions = new Float32Array(TRAIL_POINTS * 3);
      const colors = new Float32Array(TRAIL_POINTS * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.setDrawRange(0, 0);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0.48,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      line.frustumCulled = false;
      scene.add(line);
      this.trails.push({ line, positions, colors, initialized: false, fade: 0 });
    }
  }

  burst(position, color = 0xffd6a0, count = 14, speed = 26, size = 5) {
    let made = 0;
    for (const spark of this.sparks) {
      if (spark.ttl > 0) continue;
      spark.ttl = spark.max = 0.6 + Math.random() * 0.55;
      spark.size = size * (0.6 + Math.random() * 0.8);
      spark.sprite.position.copy(position);
      spark.sprite.material.color.setHex(color);
      spark.velocity.set(
        (Math.random() - 0.5) * speed,
        (Math.random() - 0.2) * speed * 0.8,
        (Math.random() - 0.5) * speed,
      );
      spark.sprite.visible = true;
      made++;
      if (made >= count) break;
    }
  }

  puff(position, color = 0xd9f2f0, size = 7, up = 5) {
    for (const puff of this.puffs) {
      if (puff.ttl > 0) continue;
      puff.ttl = puff.max = 1.5 + Math.random() * 1.3;
      puff.size = size;
      puff.grow = 1.6 + Math.random();
      puff.sprite.position.copy(position);
      puff.sprite.material.color.setHex(color);
      puff.velocity.set((Math.random() - 0.5) * 5, up, (Math.random() - 0.5) * 5);
      puff.sprite.visible = true;
      return;
    }
  }

  windStreak(position, direction, color = 0xffd6a0) {
    for (const streak of this.streaks) {
      if (streak.active) continue;
      streak.active = true;
      streak.ttl = streak.max = 0.42;
      streak.color = color;
      streak.start.copy(position);
      streak.end.copy(position).addScaledVector(direction, 42 + Math.random() * 38);
      return;
    }
  }

  crash(position) {
    this.burst(position, 0xffd08a, 26, 38, 7);
    for (let i = 0; i < 6; i++) {
      scratch.v1.copy(position);
      scratch.v1.x += (Math.random() - 0.5) * 14;
      scratch.v1.z += (Math.random() - 0.5) * 14;
      this.puff(scratch.v1, 0xe6f2f0, 8 + Math.random() * 5, 6);
    }
  }

  updateTrails(dt, wingTips, gForce, boosting) {
    const emit = !!wingTips && (gForce > 1.08 || boosting);
    this.trailClock += dt;
    const shift = emit && this.trailClock > 0.033;
    if (shift) this.trailClock = 0;
    for (let t = 0; t < 2; t++) {
      const trail = this.trails[t];
      if (emit && wingTips[t]) {
        wingTips[t].getWorldPosition(scratch.v1);
        if (!trail.initialized) {
          for (let i = 0; i < TRAIL_POINTS; i++) {
            trail.positions[i * 3] = scratch.v1.x;
            trail.positions[i * 3 + 1] = scratch.v1.y;
            trail.positions[i * 3 + 2] = scratch.v1.z;
          }
          trail.initialized = true;
        }
        if (shift) {
          for (let i = TRAIL_POINTS - 1; i > 0; i--) {
            const to = i * 3;
            const from = (i - 1) * 3;
            trail.positions[to] = trail.positions[from];
            trail.positions[to + 1] = trail.positions[from + 1];
            trail.positions[to + 2] = trail.positions[from + 2];
          }
          trail.positions[0] = scratch.v1.x;
          trail.positions[1] = scratch.v1.y;
          trail.positions[2] = scratch.v1.z;
        }
        trail.fade = 1;
      } else {
        trail.fade = Math.max(0, trail.fade - dt * 0.75);
        if (trail.fade <= 0) trail.initialized = false;
      }
      const intensity = trail.fade * (0.35 + clamp((gForce - 1) * 0.22, 0, 0.55) + (boosting ? 0.2 : 0));
      for (let i = 0; i < TRAIL_POINTS; i++) {
        const a = (1 - i / TRAIL_POINTS) * intensity;
        trail.colors[i * 3] = a;
        trail.colors[i * 3 + 1] = a * 0.78;
        trail.colors[i * 3 + 2] = a * 0.56;
      }
      trail.line.geometry.setDrawRange(0, trail.initialized ? TRAIL_POINTS : 0);
      trail.line.geometry.attributes.position.needsUpdate = true;
      trail.line.geometry.attributes.color.needsUpdate = true;
    }
  }

  update(dt, wingTips, gForce, boosting) {
    this.time += dt;
    let write = 0;
    for (const streak of this.streaks) {
      if (!streak.active) continue;
      streak.ttl -= dt;
      if (streak.ttl <= 0) {
        streak.active = false;
        continue;
      }
      const fade = streak.ttl / streak.max;
      const offset = write * 6;
      const dx = streak.end.x - streak.start.x;
      const dy = streak.end.y - streak.start.y;
      const dz = streak.end.z - streak.start.z;
      this.streakData[offset] = streak.start.x;
      this.streakData[offset + 1] = streak.start.y;
      this.streakData[offset + 2] = streak.start.z;
      this.streakData[offset + 3] = streak.start.x + dx * fade;
      this.streakData[offset + 4] = streak.start.y + dy * fade;
      this.streakData[offset + 5] = streak.start.z + dz * fade;
      scratch.color.setHex(streak.color);
      for (let k = 0; k < 2; k++) {
        this.streakColors[offset + k * 3] = scratch.color.r * fade;
        this.streakColors[offset + k * 3 + 1] = scratch.color.g * fade;
        this.streakColors[offset + k * 3 + 2] = scratch.color.b * fade;
      }
      write++;
    }
    this.streakMesh.geometry.setDrawRange(0, write * 2);
    this.streakMesh.geometry.attributes.position.needsUpdate = true;
    this.streakMesh.geometry.attributes.color.needsUpdate = true;

    for (const spark of this.sparks) {
      if (spark.ttl <= 0) continue;
      spark.ttl -= dt;
      if (spark.ttl <= 0) {
        spark.sprite.visible = false;
        continue;
      }
      spark.velocity.y -= 18 * dt;
      spark.sprite.position.addScaledVector(spark.velocity, dt);
      const t = spark.ttl / spark.max;
      spark.sprite.material.opacity = t * t;
      spark.sprite.scale.setScalar(spark.size * (0.5 + (1 - t) * 0.8));
    }

    for (const puff of this.puffs) {
      if (puff.ttl <= 0) continue;
      puff.ttl -= dt;
      if (puff.ttl <= 0) {
        puff.sprite.visible = false;
        continue;
      }
      puff.sprite.position.addScaledVector(puff.velocity, dt);
      const t = puff.ttl / puff.max;
      puff.sprite.material.opacity = t * t * 0.5;
      puff.sprite.scale.setScalar(puff.size * (1 + (1 - t) * puff.grow));
    }

    this.updateTrails(dt, wingTips, gForce, boosting);
  }

  clear() {
    for (const spark of this.sparks) {
      spark.ttl = 0;
      spark.sprite.visible = false;
    }
    for (const puff of this.puffs) {
      puff.ttl = 0;
      puff.sprite.visible = false;
    }
    for (const streak of this.streaks) streak.active = false;
    for (const trail of this.trails) {
      trail.initialized = false;
      trail.fade = 0;
      trail.line.geometry.setDrawRange(0, 0);
    }
  }
}
