import * as THREE from 'three';
import { clamp, radialTexture, scratch } from './util.js';

const TRACER_COUNT = 96;
const FLASH_COUNT = 26;
const DEBRIS_COUNT = 110;
const SMOKE_COUNT = 180;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    this.contrailClock = 0;

    // Tracers are one LineSegments draw call over a fixed buffer.
    this.tracerData = new Float32Array(TRACER_COUNT * 6);
    this.tracerColors = new Float32Array(TRACER_COUNT * 6);
    const tracerGeo = new THREE.BufferGeometry();
    tracerGeo.setAttribute('position', new THREE.BufferAttribute(this.tracerData, 3));
    tracerGeo.setAttribute('color', new THREE.BufferAttribute(this.tracerColors, 3));
    tracerGeo.setDrawRange(0, 0);
    this.tracerMesh = new THREE.LineSegments(tracerGeo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.tracerMesh.frustumCulled = false;
    scene.add(this.tracerMesh);
    this.tracers = [];
    for (let i = 0; i < TRACER_COUNT; i++) {
      this.tracers.push({ active: false, start: new THREE.Vector3(), dir: new THREE.Vector3(), length: 0, ttl: 0, maxTtl: 0, color: 0xffd48a });
    }

    const flashGeo = new THREE.SphereGeometry(1, 8, 6);
    this.flashes = [];
    for (let i = 0; i < FLASH_COUNT; i++) {
      const mesh = new THREE.Mesh(flashGeo, new THREE.MeshBasicMaterial({
        color: 0xffd89a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }));
      mesh.visible = false;
      scene.add(mesh);
      this.flashes.push({ mesh, ttl: 0, maxTtl: 0, size: 1, grow: 1 });
    }

    const debrisGeo = new THREE.BoxGeometry(1, 1, 1);
    const debrisMat = new THREE.MeshStandardMaterial({ color: 0x9b8d7a, roughness: 0.9, flatShading: true });
    this.debris = [];
    for (let i = 0; i < DEBRIS_COUNT; i++) {
      const mesh = new THREE.Mesh(debrisGeo, debrisMat);
      mesh.visible = false;
      mesh.castShadow = false;
      scene.add(mesh);
      this.debris.push({ mesh, velocity: new THREE.Vector3(), spin: new THREE.Vector3(), ttl: 0, maxTtl: 0 });
    }

    const softTex = radialTexture('rgba(255,255,255,0.92)', 'rgba(190,196,198,0.34)');
    this.smoke = [];
    for (let i = 0; i < SMOKE_COUNT; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: softTex, transparent: true, opacity: 0, depthWrite: false, fog: false,
      }));
      sprite.visible = false;
      scene.add(sprite);
      this.smoke.push({ sprite, velocity: new THREE.Vector3(), ttl: 0, maxTtl: 0, size: 1, grow: 1 });
    }
  }

  spawnTracer(start, dir, length, color = 0xffd48a, ttl = 0.11) {
    for (const tracer of this.tracers) {
      if (tracer.active) continue;
      tracer.active = true;
      tracer.start.copy(start);
      tracer.dir.copy(dir).normalize();
      tracer.length = length;
      tracer.ttl = tracer.maxTtl = ttl;
      tracer.color = color;
      return;
    }
  }

  spawnFlash(position, size, color = 0xffd89a, ttl = 0.22, grow = 2.4) {
    for (const flash of this.flashes) {
      if (flash.ttl > 0) continue;
      flash.ttl = flash.maxTtl = ttl;
      flash.size = size;
      flash.grow = grow;
      flash.mesh.position.copy(position);
      flash.mesh.material.color.setHex(color);
      flash.mesh.visible = true;
      return;
    }
  }

  spawnSmoke(position, size, color = 0x5c6165, ttl = 2.2, grow = 1.9, upward = 3.5) {
    for (const puff of this.smoke) {
      if (puff.ttl > 0) continue;
      puff.ttl = puff.maxTtl = ttl;
      puff.size = size;
      puff.grow = grow;
      puff.sprite.position.copy(position);
      puff.velocity.set((Math.random() - 0.5) * 4, upward, (Math.random() - 0.5) * 4);
      puff.sprite.material.color.setHex(color);
      puff.sprite.visible = true;
      return;
    }
  }

  spawnContrail(position, gForce) {
    const thickness = 1.0 + clamp((gForce - 1) * 0.75, 0, 4);
    this.spawnSmoke(position, 1.4 * thickness, 0xe9f8ff, 1.7, 2.6 * thickness, 0.6);
  }

  spawnSplash(position) {
    this.spawnFlash(position, 4, 0xd9f7ff, 0.2, 4.5);
    for (let i = 0; i < 5; i++) {
      const p = scratch.v1.copy(position);
      p.x += (Math.random() - 0.5) * 12;
      p.z += (Math.random() - 0.5) * 12;
      this.spawnSmoke(p, 4 + Math.random() * 5, 0xd5f3f2, 1.1, 2.2, 8);
    }
  }

  spawnExplosion(position, scale = 1, fireball = true) {
    this.spawnFlash(position, 7 * scale, 0xfff0b4, 0.2, 5.5 * scale);
    this.spawnFlash(position, 4 * scale, 0xff7b32, 0.42, 7 * scale);
    for (let i = 0; i < 9; i++) {
      for (const debris of this.debris) {
        if (debris.ttl > 0) continue;
        debris.ttl = debris.maxTtl = 1.1 + Math.random() * 1.4;
        debris.mesh.position.copy(position);
        debris.mesh.scale.setScalar((0.6 + Math.random() * 1.7) * scale);
        debris.velocity.set((Math.random() - 0.5) * 44 * scale, Math.random() * 34 * scale, (Math.random() - 0.5) * 44 * scale);
        debris.spin.set(Math.random() * 9, Math.random() * 9, Math.random() * 9);
        debris.mesh.material.color.setHex(0x8f8173);
        debris.mesh.visible = true;
        break;
      }
    }
    for (let i = 0; i < 12; i++) {
      const p = scratch.v1.copy(position);
      p.x += (Math.random() - 0.5) * 10 * scale;
      p.y += (Math.random() - 0.5) * 8 * scale;
      p.z += (Math.random() - 0.5) * 10 * scale;
      this.spawnSmoke(p, (5 + Math.random() * 7) * scale, i < 4 && fireball ? 0xff8a3d : 0x4c5054, 2.4 + Math.random() * 1.6, 2.4, 5);
    }
  }

  update(dt, wingTips, gForce, firing) {
    this.time += dt;
    let write = 0;
    for (const tracer of this.tracers) {
      if (tracer.ttl <= 0) continue;
      tracer.ttl -= dt;
      if (tracer.ttl <= 0) continue;
      const offset = write * 6;
      const sx = tracer.start.x;
      const sy = tracer.start.y;
      const sz = tracer.start.z;
      this.tracerData[offset] = sx;
      this.tracerData[offset + 1] = sy;
      this.tracerData[offset + 2] = sz;
      this.tracerData[offset + 3] = sx + tracer.dir.x * tracer.length;
      this.tracerData[offset + 4] = sy + tracer.dir.y * tracer.length;
      this.tracerData[offset + 5] = sz + tracer.dir.z * tracer.length;
      const fade = clamp(tracer.ttl / tracer.maxTtl, 0, 1);
      scratch.color.setHex(tracer.color);
      for (let k = 0; k < 2; k++) {
        this.tracerColors[offset + k * 3] = scratch.color.r * fade;
        this.tracerColors[offset + k * 3 + 1] = scratch.color.g * fade;
        this.tracerColors[offset + k * 3 + 2] = scratch.color.b * fade;
      }
      write++;
    }
    this.tracerMesh.geometry.setDrawRange(0, write * 2);
    this.tracerMesh.geometry.attributes.position.needsUpdate = true;
    this.tracerMesh.geometry.attributes.color.needsUpdate = true;

    for (const flash of this.flashes) {
      if (flash.ttl <= 0) continue;
      flash.ttl -= dt;
      if (flash.ttl <= 0) {
        flash.mesh.visible = false;
        continue;
      }
      const t = flash.ttl / flash.maxTtl;
      const size = flash.size * (1 + (1 - t) * flash.grow);
      flash.mesh.scale.setScalar(size);
      flash.mesh.material.opacity = t * 0.92;
    }

    for (const debris of this.debris) {
      if (debris.ttl <= 0) continue;
      debris.ttl -= dt;
      if (debris.ttl <= 0) {
        debris.mesh.visible = false;
        continue;
      }
      debris.velocity.y -= 22 * dt;
      debris.mesh.position.addScaledVector(debris.velocity, dt);
      if (debris.mesh.position.y < 1) {
        debris.mesh.position.y = 1;
        debris.velocity.y = Math.abs(debris.velocity.y) * 0.28;
        debris.velocity.x *= 0.7;
        debris.velocity.z *= 0.7;
      }
      debris.mesh.rotation.x += debris.spin.x * dt;
      debris.mesh.rotation.y += debris.spin.y * dt;
      debris.mesh.rotation.z += debris.spin.z * dt;
    }

    for (const puff of this.smoke) {
      if (puff.ttl <= 0) continue;
      puff.ttl -= dt;
      if (puff.ttl <= 0) {
        puff.sprite.visible = false;
        continue;
      }
      puff.sprite.position.addScaledVector(puff.velocity, dt);
      const t = puff.ttl / puff.maxTtl;
      puff.sprite.material.opacity = t * t * 0.72;
      const size = puff.size * (1 + (1 - t) * puff.grow);
      puff.sprite.scale.set(size, size, 1);
    }

    if (wingTips && gForce > 1.05) {
      this.contrailClock += dt;
      if (this.contrailClock > 0.035) {
        this.contrailClock = 0;
        for (const tip of wingTips) {
          tip.getWorldPosition(scratch.v5);
          this.spawnContrail(scratch.v5, gForce);
        }
      }
    }
  }

  clear() {
    for (const tracer of this.tracers) tracer.ttl = 0;
    for (const flash of this.flashes) {
      flash.ttl = 0;
      flash.mesh.visible = false;
    }
    for (const debris of this.debris) {
      debris.ttl = 0;
      debris.mesh.visible = false;
    }
    for (const puff of this.smoke) {
      puff.ttl = 0;
      puff.sprite.visible = false;
    }
  }
}
