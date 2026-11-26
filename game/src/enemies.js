import * as THREE from 'three';
import { clamp, scratch } from './util.js';

const MAX_BULLETS = 90;
const MAX_MISSILES = 8;

function enemyShape(type, parts) {
  const group = new THREE.Group();
  if (type === 'drone') {
    const body = new THREE.Mesh(parts.droneBody, parts.droneMat);
    body.scale.set(1, 1, 2.1);
    group.add(body);
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(parts.wing, parts.droneMat);
      wing.position.set(side * 6, 0, 0);
      wing.scale.set(1.5, 0.25, 0.7);
      group.add(wing);
    }
    const eye = new THREE.Mesh(parts.eye, parts.redGlow);
    eye.position.z = -4;
    group.add(eye);
    group.userData.radius = 7;
  } else if (type === 'interceptor') {
    const body = new THREE.Mesh(parts.fighterBody, parts.fighterMat);
    body.rotation.x = -Math.PI / 2;
    group.add(body);
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(parts.wing, parts.fighterMat);
      wing.position.set(side * 7.5, 0, 1.5);
      wing.scale.set(1.9, 0.24, 0.95);
      wing.rotation.y = side * 0.22;
      group.add(wing);
    }
    const eye = new THREE.Mesh(parts.eye, parts.amberGlow);
    eye.position.z = -6;
    group.add(eye);
    group.userData.radius = 8;
  } else {
    const core = new THREE.Mesh(parts.fortressBody, parts.fortressMat);
    core.scale.set(1.6, 1, 2.6);
    group.add(core);
    for (const side of [-1, 1]) {
      const pod = new THREE.Mesh(parts.pod, parts.fortressMat);
      pod.rotation.z = Math.PI / 2;
      pod.position.set(side * 16, 2, 0);
      group.add(pod);
    }
    const weak = new THREE.Mesh(parts.weak, parts.weakGlow);
    weak.position.z = -16;
    group.add(weak);
    group.userData.weak = weak;
    group.userData.radius = 17;
  }
  return group;
}

export class CombatSystem {
  constructor(scene, world, fx, audio, hud, callbacks) {
    this.scene = scene;
    this.world = world;
    this.fx = fx;
    this.audio = audio;
    this.hud = hud;
    this.callbacks = callbacks;
    this.enemies = [];
    this.bullets = [];
    this.missiles = [];
    this.gunClock = 0;
    this.missileCooldown = 0;
    this.lockProgress = 0;
    this.lockTarget = null;
    this.kills = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;

    const flat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.25, flatShading: true, ...extra });
    this.parts = {
      droneBody: new THREE.OctahedronGeometry(4, 0),
      fighterBody: new THREE.ConeGeometry(3.2, 14, 6),
      wing: new THREE.BoxGeometry(7, 1, 4),
      fortressBody: new THREE.BoxGeometry(14, 11, 15),
      pod: new THREE.CylinderGeometry(5, 5, 13, 8),
      eye: new THREE.SphereGeometry(1.9, 8, 6),
      weak: new THREE.SphereGeometry(4.2, 10, 8),
      droneMat: flat(0x9b3545),
      fighterMat: flat(0x5c5b86),
      fortressMat: flat(0x696f78),
      redGlow: new THREE.MeshBasicMaterial({ color: 0xff4b5e }),
      amberGlow: new THREE.MeshBasicMaterial({ color: 0xffb14c }),
      weakGlow: new THREE.MeshBasicMaterial({ color: 0xffdc67 }),
      bulletGeo: new THREE.SphereGeometry(0.75, 6, 4),
      bulletMat: new THREE.MeshBasicMaterial({ color: 0xffd076 }),
      missileGeo: new THREE.ConeGeometry(1.3, 6, 6),
      missileMat: new THREE.MeshStandardMaterial({ color: 0xd8e4e9, metalness: 0.5, roughness: 0.35, flatShading: true }),
    };

    for (let i = 0; i < MAX_BULLETS; i++) {
      const mesh = new THREE.Mesh(this.parts.bulletGeo, this.parts.bulletMat);
      mesh.visible = false;
      scene.add(mesh);
      this.bullets.push({ mesh, velocity: new THREE.Vector3(), ttl: 0, damage: 8 });
    }
    for (let i = 0; i < MAX_MISSILES; i++) {
      const mesh = new THREE.Mesh(this.parts.missileGeo, this.parts.missileMat);
      mesh.visible = false;
      scene.add(mesh);
      this.missiles.push({ mesh, velocity: new THREE.Vector3(), ttl: 0, target: null, smokeClock: 0, damage: 70 });
    }
  }

  spawnEnemy(type = 'drone', position = null) {
    let enemy = this.enemies.find((item) => !item.alive && item.type === type);
    if (!enemy) {
      const mesh = enemyShape(type, this.parts);
      this.scene.add(mesh);
      enemy = {
        type, mesh, velocity: new THREE.Vector3(), health: 0, maxHealth: 0,
        alive: false, radius: 8, cooldown: 0, smokeClock: 0, weak: mesh.userData.weak || null,
        wobble: Math.random() * 6.28,
      };
      this.enemies.push(enemy);
    }
    const pos = position || scratch.v1.set((Math.random() - 0.5) * 500, 90 + Math.random() * 100, -420 - Math.random() * 200);
    enemy.mesh.position.copy(pos);
    enemy.velocity.set(0, 0, 20);
    enemy.alive = true;
    enemy.radius = enemy.mesh.userData.radius || 8;
    enemy.maxHealth = type === 'fortress' ? 190 : type === 'interceptor' ? 52 : 34;
    enemy.health = enemy.maxHealth;
    enemy.cooldown = 0.6 + Math.random() * 1.2;
    enemy.smokeClock = 0;
    enemy.mesh.visible = true;
    enemy.mesh.scale.setScalar(1);
    return enemy;
  }

  nearestCarrier(position) {
    let best = null;
    let bestDist = Infinity;
    for (const carrier of this.world.carriers) {
      if (!carrier.alive) continue;
      const d = carrier.position.distanceToSquared(position);
      if (d < bestDist) {
        bestDist = d;
        best = carrier;
      }
    }
    return best || this.world.carriers[0];
  }

  spawnBullet(from, direction, speed = 210, damage = 8) {
    for (const bullet of this.bullets) {
      if (bullet.ttl > 0) continue;
      bullet.ttl = 2.6;
      bullet.damage = damage;
      bullet.mesh.position.copy(from);
      bullet.mesh.visible = true;
      bullet.velocity.copy(direction).normalize().multiplyScalar(speed);
      return;
    }
  }

  fireGuns(plane, flight) {
    if (this.gunClock > 0) return;
    this.gunClock = 0.085;
    const forward = scratch.v1;
    const right = scratch.v2;
    const origin = scratch.v3;
    const dir = scratch.v4;
    flight.getForward(forward);
    flight.getRight(right);
    for (const side of [-1, 1]) {
      origin.copy(plane.position).addScaledVector(right, side * 3.2).addScaledVector(forward, 9).addScaledVector(scratch.v5.set(0, -0.4, 0), 1);
      plane.localToWorld(scratch.v5.set(side * 3.2, -0.3, -8));
      origin.copy(scratch.v5);
      dir.copy(forward);
      dir.x += (Math.random() - 0.5) * 0.008;
      dir.y += (Math.random() - 0.5) * 0.008;
      dir.normalize();
      this.fx.spawnTracer(origin, dir, 780, 0xffd48a, 0.12);
      this.fx.spawnFlash(origin, 0.9, 0xffc46a, 0.07, 2.3);
      this.shotsFired++;
      this.testGunHit(origin, dir);
    }
    this.audio.cannon();
    this.callbacks.onShake(0.42);
  }

  testGunHit(origin, dir) {
    const toEnemy = scratch.v1;
    const closest = scratch.v2;
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      toEnemy.subVectors(enemy.mesh.position, origin);
      const along = toEnemy.dot(dir);
      if (along < 0 || along > 800) continue;
      closest.copy(origin).addScaledVector(dir, along);
      if (closest.distanceToSquared(enemy.mesh.position) < (enemy.radius + 2.2) ** 2) {
        this.damageEnemy(enemy, 12, false, closest);
        this.shotsHit++;
        this.hud.hitMarker();
        return;
      }
    }
  }

  damageEnemy(enemy, amount, splash = false, point = null) {
    if (!enemy.alive) return;
    enemy.health -= amount;
    const hitPos = point || scratch.v3.copy(enemy.mesh.position);
    this.fx.spawnFlash(hitPos, 2.2, 0xffd27a, 0.13, 2.2);
    this.hud.popup(hitPos, splash ? 'MISSILE ' + Math.round(amount) : String(Math.round(amount)), splash ? '#ffd06b' : '#9ef4ff');
    if (enemy.health > 0) return;
    enemy.alive = false;
    enemy.mesh.visible = false;
    this.kills++;
    this.fx.spawnExplosion(enemy.mesh.position, enemy.type === 'fortress' ? 1.7 : 1, true);
    this.audio.explosion(enemy.type === 'fortress');
    this.callbacks.onShake(enemy.type === 'fortress' ? 1.3 : 0.6);
    this.callbacks.onKill(enemy.type, enemy.mesh.position);
  }

  updateLock(dt, plane, flight) {
    const forward = scratch.v1;
    const toTarget = scratch.v2;
    flight.getForward(forward);
    let best = null;
    let bestDot = 0.965;
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      toTarget.subVectors(enemy.mesh.position, plane.position);
      const distance = toTarget.length();
      if (distance > 780 || distance < 20) continue;
      toTarget.multiplyScalar(1 / distance);
      const dot = toTarget.dot(forward);
      if (dot > bestDot) {
        bestDot = dot;
        best = enemy;
      }
    }
    if (best !== this.lockTarget) {
      this.lockTarget = best;
      this.lockProgress = 0;
    }
    if (best) {
      const wasNotReady = this.lockProgress < 1;
      this.lockProgress = clamp(this.lockProgress + dt * 1.35, 0, 1);
      if (wasNotReady && this.lockProgress < 1) this.audio.lockTone();
      if (wasNotReady && this.lockProgress >= 1) this.audio.lockComplete();
    } else {
      this.lockProgress = 0;
    }
  }

  fireMissile(plane, flight) {
    if (this.missileCooldown > 0 || !this.lockTarget || this.lockProgress < 1) return false;
    for (const missile of this.missiles) {
      if (missile.ttl > 0) continue;
      missile.ttl = 7;
      missile.target = this.lockTarget;
      missile.smokeClock = 0;
      missile.mesh.position.copy(plane.position).addScaledVector(flight.getForward(scratch.v1), 8);
      missile.mesh.quaternion.copy(plane.quaternion);
      missile.velocity.copy(flight.getForward(scratch.v1)).multiplyScalar(110);
      missile.mesh.visible = true;
      this.missileCooldown = 3.2;
      this.audio.missile();
      this.callbacks.onShake(0.75);
      this.lockTarget = null;
      this.lockProgress = 0;
      return true;
    }
    return false;
  }

  updateEnemies(dt, plane) {
    const targetVec = scratch.v1;
    const desired = scratch.v2;
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      enemy.cooldown -= dt;
      const isFortress = enemy.type === 'fortress';
      const carrier = this.nearestCarrier(enemy.mesh.position);
      const targetPos = isFortress || enemy.type === 'drone' ? carrier.position : plane.position;
      targetVec.copy(targetPos);
      if (!isFortress) targetVec.y += 12;
      else targetVec.y += 95;
      desired.subVectors(targetVec, enemy.mesh.position);
      const distance = desired.length();
      if (distance > 1) desired.multiplyScalar(1 / distance);

      const maxSpeed = isFortress ? 18 : enemy.type === 'interceptor' ? 104 : 62;
      const steer = isFortress ? 0.7 : 2.1;
      enemy.velocity.lerp(scratch.v3.copy(desired).multiplyScalar(maxSpeed), clamp(steer * dt, 0, 1));
      enemy.wobble += dt * 1.6;
      enemy.velocity.y += Math.sin(enemy.wobble) * (isFortress ? 0.2 : 5) * dt;
      enemy.mesh.position.addScaledVector(enemy.velocity, dt);
      enemy.mesh.lookAt(targetVec);
      if (enemy.weak) enemy.weak.rotation.y += dt * 2;

      if (enemy.health < enemy.maxHealth * 0.55) {
        enemy.smokeClock -= dt;
        if (enemy.smokeClock <= 0) {
          enemy.smokeClock = 0.13;
          this.fx.spawnSmoke(enemy.mesh.position, 2.6, 0x4a4b4d, 1.5, 2.6, 2.6);
        }
      }

      if (enemy.cooldown <= 0 && distance < (isFortress ? 430 : 330)) {
        const shots = isFortress ? 3 : 1;
        for (let i = 0; i < shots; i++) {
          const dir = scratch.v4.copy(targetVec).sub(enemy.mesh.position);
          dir.x += (Math.random() - 0.5) * (isFortress ? 26 : 14);
          dir.y += (Math.random() - 0.5) * (isFortress ? 20 : 12);
          this.spawnBullet(scratch.v5.copy(enemy.mesh.position), dir, isFortress ? 150 : 190, isFortress ? 11 : 7);
        }
        enemy.cooldown = isFortress ? 2.3 : enemy.type === 'interceptor' ? 1.35 : 2.1;
      }

      if (enemy.mesh.position.distanceToSquared(plane.position) < 13 * 13) {
        this.callbacks.onPlayerDamage(16, enemy.mesh.position);
        this.damageEnemy(enemy, 9999, false, enemy.mesh.position);
      }
    }
  }

  updateBullets(dt, plane) {
    const toTarget = scratch.v1;
    for (const bullet of this.bullets) {
      if (bullet.ttl <= 0) continue;
      bullet.ttl -= dt;
      if (bullet.ttl <= 0) {
        bullet.mesh.visible = false;
        continue;
      }
      bullet.mesh.position.addScaledVector(bullet.velocity, dt);
      if (bullet.mesh.position.y < 2) {
        bullet.ttl = 0;
        bullet.mesh.visible = false;
        continue;
      }
      toTarget.subVectors(bullet.mesh.position, plane.position);
      if (toTarget.lengthSq() < 9 * 9) {
        bullet.ttl = 0;
        bullet.mesh.visible = false;
        this.callbacks.onPlayerDamage(bullet.damage, bullet.mesh.position);
        continue;
      }
      for (const carrier of this.world.carriers) {
        if (!carrier.alive) continue;
        if (bullet.mesh.position.distanceToSquared(carrier.position) < carrier.radius * carrier.radius) {
          bullet.ttl = 0;
          bullet.mesh.visible = false;
          this.callbacks.onCarrierDamage(carrier, bullet.damage, bullet.mesh.position);
          break;
        }
      }
    }
  }

  updateMissiles(dt) {
    const desired = scratch.v1;
    const toTarget = scratch.v2;
    for (const missile of this.missiles) {
      if (missile.ttl <= 0) continue;
      missile.ttl -= dt;
      if (missile.target && missile.target.alive) {
        toTarget.subVectors(missile.target.mesh.position, missile.mesh.position);
        const dist = toTarget.length();
        if (dist > 1) {
          desired.copy(toTarget).multiplyScalar(1 / dist);
          missile.velocity.lerp(scratch.v3.copy(desired).multiplyScalar(155), clamp(2.6 * dt, 0, 1));
        }
        if (dist < 17) {
          this.detonateMissile(missile);
          continue;
        }
      }
      missile.mesh.position.addScaledVector(missile.velocity, dt);
      missile.mesh.lookAt(scratch.v4.copy(missile.mesh.position).add(missile.velocity));
      missile.smokeClock -= dt;
      if (missile.smokeClock <= 0) {
        missile.smokeClock = 0.035;
        this.fx.spawnSmoke(missile.mesh.position, 1.8, 0xdde5e7, 1.1, 2.2, 0.4);
      }
      if (missile.ttl <= 0 || missile.mesh.position.y < 2) this.detonateMissile(missile);
    }
  }

  detonateMissile(missile) {
    if (missile.ttl <= 0 && !missile.mesh.visible) return;
    missile.ttl = 0;
    missile.mesh.visible = false;
    const pos = scratch.v3.copy(missile.mesh.position);
    pos.y = Math.max(3, pos.y);
    this.fx.spawnExplosion(pos, 1.25, true);
    this.audio.explosion();
    this.callbacks.onShake(0.8);
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const dist = enemy.mesh.position.distanceTo(pos);
      if (dist < 52) {
        const weakBonus = enemy.weak && enemy.weak.getWorldPosition(scratch.v4).distanceTo(pos) < 22;
        this.damageEnemy(enemy, weakBonus ? 190 : missile.damage, true, enemy.mesh.position);
      }
    }
  }

  update(dt, plane, flight, controlsEnabled) {
    this.gunClock -= dt;
    this.missileCooldown -= dt;
    if (controlsEnabled) {
      if (controlsEnabled.firing) this.fireGuns(plane, flight);
      this.updateLock(dt, plane, flight);
    } else {
      this.lockProgress = 0;
      this.lockTarget = null;
    }
    this.updateEnemies(dt, plane);
    this.updateBullets(dt, plane);
    this.updateMissiles(dt);
  }

  aliveCount() {
    let count = 0;
    for (const enemy of this.enemies) if (enemy.alive) count++;
    return count;
  }

  reset() {
    for (const enemy of this.enemies) {
      enemy.alive = false;
      enemy.mesh.visible = false;
    }
    for (const bullet of this.bullets) {
      bullet.ttl = 0;
      bullet.mesh.visible = false;
    }
    for (const missile of this.missiles) {
      missile.ttl = 0;
      missile.mesh.visible = false;
    }
    this.lockTarget = null;
    this.lockProgress = 0;
    this.missileCooldown = 0;
    this.gunClock = 0;
    this.kills = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.world.resetCarriers();
  }
}
