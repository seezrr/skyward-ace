import * as THREE from 'three';
import { clamp, fbm2, lerp, mulberry32, radialTexture, scratch, smoothstep } from './util.js';

const SKY_VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = `
uniform vec3 uSun;
uniform vec3 uLow;
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform float uNight;
uniform float uPhase;
varying vec3 vDir;
void main() {
  vec3 dir = normalize(vDir);
  float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(uLow, uHorizon, smoothstep(0.36, 0.55, h));
  col = mix(col, uZenith, smoothstep(0.52, 0.99, h));
  float sd = max(dot(dir, normalize(uSun)), 0.0);
  float glow = pow(sd, 18.0) * 0.55 + pow(sd, 3.0) * 0.15;
  float disk = smoothstep(0.9984, 0.99935, sd);
  float theta = atan(dir.z, dir.x);
  float rays = pow(sd, 5.0) * (0.55 + 0.45 * sin(theta * 21.0 + uPhase * 2.4)) * 0.13;
  col += vec3(1.0, 0.71, 0.41) * glow;
  col += vec3(1.0, 0.94, 0.79) * disk * 1.35;
  col += vec3(1.0, 0.62, 0.35) * rays;
  col = mix(col, vec3(0.012, 0.028, 0.075), uNight * 0.76);
  gl_FragColor = vec4(col, 1.0);
}`;

const OCEAN_VERT = `
uniform float uTime;
varying vec3 vWorld;
varying float vWave;
void main() {
  vec3 p = position;
  float wave = sin(p.x * 0.031 + uTime * 0.92) * 1.35
             + cos(p.z * 0.026 - uTime * 0.74) * 1.05
             + sin((p.x + p.z) * 0.012 + uTime * 0.43) * 0.72;
  p.y += wave;
  vWave = wave;
  vWorld = (modelMatrix * vec4(p, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const OCEAN_FRAG = `
uniform float uTime;
uniform float uNight;
uniform vec3 uSun;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFog;
varying vec3 vWorld;
varying float vWave;
void main() {
  vec3 viewDir = normalize(cameraPosition - vWorld);
  float dx = 0.045 * cos(vWorld.x * 0.031 + uTime * 0.92);
  float dz = 0.04 * sin(vWorld.z * 0.026 - uTime * 0.74);
  vec3 n = normalize(vec3(-dx, 1.0, -dz));
  float fres = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), 3.0);
  float spec = pow(max(dot(reflect(-normalize(uSun), n), viewDir), 0.0), 110.0);
  float sparkle = pow(max(dot(reflect(-normalize(uSun), n), viewDir), 0.0), 480.0);
  float depth = clamp(0.46 + vWave * 0.085, 0.0, 1.0);
  vec3 col = mix(uDeep, uShallow, depth);
  col = mix(col, vec3(0.58, 0.79, 0.82), fres * 0.48);
  col += vec3(1.0, 0.74, 0.45) * spec * 1.45 + vec3(1.0) * sparkle * (1.0 - uNight * 0.55);
  col += vec3(smoothstep(2.6, 3.3, vWave) * 0.14);
  float dist = length(cameraPosition - vWorld);
  float fog = 1.0 - exp(-pow(dist * 0.00049, 2.0));
  col = mix(col, uFog, clamp(fog, 0.0, 0.93));
  col = mix(col, col * vec3(0.42, 0.58, 0.88), uNight * 0.5);
  gl_FragColor = vec4(col, 1.0);
}`;

const CHUNK = 420;
const CHUNK_RADIUS = 2;
const RING_COURSE = [
  [0, 126, 128], [76, 140, -76], [188, 126, -286], [112, 116, -492],
  [-82, 138, -668], [-286, 132, -508], [-252, 116, -258], [-86, 134, -34], [54, 122, 184],
];

const PALETTE = {
  golden: {
    low: 0xffd9a8, horizon: 0xffb079, zenith: 0x2f7394,
    deep: 0x0d465c, shallow: 0x39a2a2, fog: 0xd9bfa7,
    hemiSky: 0xffe2bb, hemiGround: 0x315c62, sun: 0xffd5a0,
  },
  dusk: {
    low: 0xff9875, horizon: 0xd96e6d, zenith: 0x273c6c,
    deep: 0x12304d, shallow: 0x2f7188, fog: 0xb48a92,
    hemiSky: 0xffb39c, hemiGround: 0x243b54, sun: 0xff9b72,
  },
  night: {
    low: 0x253a5d, horizon: 0x24335a, zenith: 0x07132b,
    deep: 0x061f33, shallow: 0x0d465a, fog: 0x1a2c4b,
    hemiSky: 0x8ca8dd, hemiGround: 0x101d33, sun: 0x9db6ff,
  },
};

export class World {
  constructor(scene, seed = 913377, quality = 'high') {
    this.scene = scene;
    this.seed = seed >>> 0;
    this.quality = quality;
    this.time = 0;
    this.dayPhase = 0.04;
    this.nightFactor = 0;
    this.sunDir = new THREE.Vector3(-0.52, 0.34, -0.78).normalize();
    this.fogColor = new THREE.Color(PALETTE.golden.fog);
    scene.fog = new THREE.Fog(this.fogColor, 460, 2350);

    this.rings = [];
    this.storms = [];
    this.lanterns = [];
    this.updrafts = [];
    this.clouds = [];
    this.chunks = new Map();
    this.chunkKeys = new Set();
    this.islandCache = new Map();

    this.shared = this.buildSharedResources();
    this.buildSky();
    this.buildLights();
    this.buildOcean();
    this.buildStars();
    this.buildClouds();
    this.buildFlare();
    this.buildCourse();
    this.rebuildChunks(0, 0, true);
    this.setTimeOfDay(this.dayPhase);
  }

  buildSharedResources() {
    const pineGeo = new THREE.ConeGeometry(3.6, 14, 5);
    pineGeo.translate(0, 7, 0);
    const palmTrunkGeo = new THREE.CylinderGeometry(0.65, 1.05, 12, 5);
    palmTrunkGeo.translate(0, 6, 0);
    const palmCrownGeo = new THREE.ConeGeometry(5.2, 2.4, 6);
    const rockGeo = new THREE.DodecahedronGeometry(3.4, 0);
    return {
      pineGeo,
      palmTrunkGeo,
      palmCrownGeo,
      rockGeo,
      pineMat: new THREE.MeshStandardMaterial({ color: 0x3d6f60, roughness: 1, flatShading: true }),
      trunkMat: new THREE.MeshStandardMaterial({ color: 0x8d6a4a, roughness: 1, flatShading: true }),
      crownMat: new THREE.MeshStandardMaterial({ color: 0x5c9a69, roughness: 1, flatShading: true }),
      rockMat: new THREE.MeshStandardMaterial({ color: 0x8b8379, roughness: 1, flatShading: true }),
      islandMat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, flatShading: true, side: THREE.DoubleSide }),
      wakeMat: new THREE.MeshBasicMaterial({ color: 0xb9e9dc, transparent: true, opacity: 0.26, depthWrite: false, side: THREE.DoubleSide }),
      ringGeo: new THREE.TorusGeometry(26, 2.1, 8, 36),
      glowGeo: new THREE.TorusGeometry(26, 5.2, 6, 32),
      markerGeo: new THREE.OctahedronGeometry(2.8, 0),
      lanternTex: radialTexture('rgba(255,242,196,1)', 'rgba(255,171,94,0.55)'),
      cloudTex: radialTexture('rgba(255,250,240,0.95)', 'rgba(255,205,178,0.30)'),
      stormTex: radialTexture('rgba(88,74,104,0.88)', 'rgba(66,83,109,0.28)'),
      flareTex: radialTexture('rgba(255,255,244,1)', 'rgba(255,201,132,0.5)'),
    };
  }

  buildSky() {
    this.skyUniforms = {
      uSun: { value: this.sunDir },
      uLow: { value: new THREE.Color(PALETTE.golden.low) },
      uHorizon: { value: new THREE.Color(PALETTE.golden.horizon) },
      uZenith: { value: new THREE.Color(PALETTE.golden.zenith) },
      uNight: { value: 0 },
      uPhase: { value: 0 },
    };
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(3600, 32, 20),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        uniforms: this.skyUniforms,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  buildLights() {
    this.hemi = new THREE.HemisphereLight(PALETTE.golden.hemiSky, PALETTE.golden.hemiGround, 1.5);
    this.scene.add(this.hemi);
    this.sunLight = new THREE.DirectionalLight(PALETTE.golden.sun, 2.25);
    this.sunLight.position.copy(this.sunDir).multiplyScalar(900);
    this.sunLight.target.position.set(0, 0, -250);
    this.sunLight.castShadow = this.quality !== 'low';
    this.sunLight.shadow.mapSize.set(this.quality === 'high' ? 2048 : 1024, this.quality === 'high' ? 2048 : 1024);
    this.sunLight.shadow.camera.left = -560;
    this.sunLight.shadow.camera.right = 560;
    this.sunLight.shadow.camera.top = 560;
    this.sunLight.shadow.camera.bottom = -560;
    this.sunLight.shadow.camera.near = 50;
    this.sunLight.shadow.camera.far = 1800;
    this.sunLight.shadow.bias = -0.0007;
    this.sunLight.shadow.normalBias = 1.4;
    this.scene.add(this.sunLight, this.sunLight.target);
  }

  buildOcean() {
    const geo = new THREE.PlaneGeometry(3000, 3000, this.quality === 'low' ? 70 : 128, this.quality === 'low' ? 70 : 128);
    geo.rotateX(-Math.PI / 2);
    this.oceanUniforms = {
      uTime: { value: 0 },
      uNight: { value: 0 },
      uSun: { value: this.sunDir },
      uDeep: { value: new THREE.Color(PALETTE.golden.deep) },
      uShallow: { value: new THREE.Color(PALETTE.golden.shallow) },
      uFog: { value: this.fogColor },
    };
    this.ocean = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      vertexShader: OCEAN_VERT,
      fragmentShader: OCEAN_FRAG,
      uniforms: this.oceanUniforms,
      side: THREE.DoubleSide,
    }));
    this.ocean.position.y = -0.6;
    this.scene.add(this.ocean);
  }

  buildStars() {
    const rng = mulberry32(this.seed ^ 0x5eed);
    const positions = new Float32Array(720 * 3);
    for (let i = 0; i < 720; i++) {
      const y = rng() * 1.6 - 0.28;
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(Math.max(0.02, 1 - y * y));
      positions[i * 3] = Math.cos(a) * r * 3400;
      positions[i * 3 + 1] = y * 3400;
      positions[i * 3 + 2] = Math.sin(a) * r * 3400;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.starMaterial = new THREE.PointsMaterial({
      color: 0xeaf2ff, size: 2.4, sizeAttenuation: false,
      transparent: true, opacity: 0, depthWrite: false, fog: false,
    });
    this.stars = new THREE.Points(geo, this.starMaterial);
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);
  }

  buildClouds() {
    const count = this.quality === 'low' ? 20 : 34;
    const rng = mulberry32(this.seed ^ 0xc10d);
    for (let i = 0; i < count; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.shared.cloudTex, transparent: true, depthWrite: false, opacity: 0.3, fog: false,
      }));
      sprite.position.set((rng() - 0.5) * 1900, 175 + rng() * 250, -rng() * 1700 + 180);
      const s = 150 + rng() * 230;
      sprite.scale.set(s, s * 0.5, 1);
      sprite.userData.drift = 2 + rng() * 5;
      this.scene.add(sprite);
      this.clouds.push(sprite);
    }
  }

  buildFlare() {
    this.sunFlare = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.shared.flareTex, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: false, fog: false, opacity: 0.7,
    }));
    this.sunFlare.scale.set(560, 560, 1);
    this.scene.add(this.sunFlare);
  }

  buildCourse() {
    const activeMat = new THREE.MeshStandardMaterial({
      color: 0xffc082, emissive: 0xb25b25, emissiveIntensity: 1.25, roughness: 0.34, metalness: 0.12,
    });
    for (let i = 0; i < RING_COURSE.length; i++) {
      const [x, zy, z] = RING_COURSE[i];
      const pos = new THREE.Vector3(x, Math.max(zy, this.collisionHeightAt(x, z) + 44), z);
      const next = RING_COURSE[(i + 1) % RING_COURSE.length];
      const nextPos = new THREE.Vector3(next[0], Math.max(next[1], this.collisionHeightAt(next[0], next[2]) + 44), next[2]);
      const normal = new THREE.Vector3().subVectors(nextPos, pos).normalize();
      const group = new THREE.Group();
      group.position.copy(pos);
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      const mat = activeMat.clone();
      group.add(new THREE.Mesh(this.shared.ringGeo, mat));
      const glow = new THREE.Mesh(this.shared.glowGeo, new THREE.MeshBasicMaterial({
        color: 0xffc082, transparent: true, opacity: 0.13, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      group.add(glow);
      const markerMat = new THREE.MeshBasicMaterial({ color: 0xfff0c9, transparent: true, opacity: 0.9 });
      for (const side of [-1, 1]) {
        const marker = new THREE.Mesh(this.shared.markerGeo, markerMat);
        marker.position.set(side * 26, 0, 0);
        group.add(marker);
      }
      this.scene.add(group);
      this.rings.push({ group, position: pos, normal, radius: 26, index: i, material: mat, glow, passed: false, nearMissed: false });
    }

    const stormSpots = [[-120, 130, -350], [250, 150, -620], [-330, 140, -150]];
    const rng = mulberry32(this.seed ^ 0x57a4);
    for (const [x, y, z] of stormSpots) {
      const group = new THREE.Group();
      group.position.set(x, y, z);
      for (let i = 0; i < 5; i++) {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this.shared.stormTex, transparent: true, depthWrite: false, opacity: 0.42, color: 0x8b7f9b, fog: false,
        }));
        sprite.position.set((rng() - 0.5) * 42, (rng() - 0.5) * 30, (rng() - 0.5) * 42);
        const s = 70 + rng() * 50;
        sprite.scale.set(s, s * 0.7, 1);
        group.add(sprite);
      }
      const marker = new THREE.Mesh(
        new THREE.OctahedronGeometry(13, 0),
        new THREE.MeshBasicMaterial({ color: 0xff7a73, wireframe: true, transparent: true, opacity: 0.72 }),
      );
      group.add(marker);
      const flash = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.shared.flareTex, color: 0xdce6ff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }));
      flash.scale.set(90, 90, 1);
      group.add(flash);
      this.scene.add(group);
      this.storms.push({ group, position: group.position, radius: 62, marker, flash, phase: rng() * 6.28 });
    }

    const lanternRng = mulberry32(this.seed ^ 0x1a47);
    for (let i = 0; i < 22; i++) {
      const a = lanternRng() * Math.PI * 2;
      const r = 110 + lanternRng() * 620;
      const x = Math.cos(a) * r;
      const z = -220 + Math.sin(a) * r;
      const y = Math.max(46, this.collisionHeightAt(x, z) + 34) + lanternRng() * 70;
      const group = new THREE.Group();
      group.position.set(x, y, z);
      const core = new THREE.Mesh(
        new THREE.OctahedronGeometry(2.1, 0),
        new THREE.MeshBasicMaterial({ color: 0xffdca0 }),
      );
      group.add(core);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.shared.lanternTex, transparent: true, opacity: 0.82,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }));
      halo.scale.set(15, 15, 1);
      group.add(halo);
      this.scene.add(group);
      this.lanterns.push({ group, position: group.position, active: true, phase: lanternRng() * 6.28 });
    }

    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.4;
      const r = 160 + (i % 2) * 240;
      const x = Math.cos(a) * r;
      const z = -330 + Math.sin(a) * r;
      const strength = 9 + (i % 3) * 3;
      const points = [];
      for (let j = 0; j <= 72; j++) {
        const t = j / 72;
        const angle = t * Math.PI * 7;
        points.push(new THREE.Vector3(
          x + Math.cos(angle) * (7 + t * 16),
          Math.max(8, this.collisionHeightAt(x, z)) + t * 170,
          z + Math.sin(angle) * (7 + t * 16),
        ));
      }
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: 0xa8f0d6, transparent: true, opacity: 0.21, depthWrite: false }),
      );
      this.scene.add(line);
      this.updrafts.push({ x, z, radius: 44, strength, line });
    }
  }

  heightAt(x, z) {
    const base = fbm2(x * 0.00225, z * 0.00225, this.seed, 4);
    const detail = fbm2(x * 0.0061 + 19, z * 0.0061 - 11, this.seed ^ 0x9e37, 3);
    return Math.max(-7, (base - 0.455) * 430 + (detail - 0.5) * 34);
  }

  // Island geometry is generated per chunk, so collision uses the same cached
  // description instead of the lower ocean floor. The cache is independent of
  // which chunks are currently visible, meaning recovery never places the
  // plane inside an island that has not streamed in yet.
  islandAtChunk(gx, gz) {
    const key = gx + ':' + gz;
    if (this.islandCache.has(key)) return this.islandCache.get(key);
    const baseX = gx * CHUNK + CHUNK * 0.5;
    const baseZ = gz * CHUNK + CHUNK * 0.5;
    let bestH = -999;
    let bestX = baseX;
    let bestZ = baseZ;
    for (let ix = -1; ix <= 1; ix++) {
      for (let iz = -1; iz <= 1; iz++) {
        const sx = baseX + ix * CHUNK * 0.28;
        const sz = baseZ + iz * CHUNK * 0.28;
        const h = this.heightAt(sx, sz);
        if (h > bestH) {
          bestH = h;
          bestX = sx;
          bestZ = sz;
        }
      }
    }
    const island = bestH > 4 ? {
      x: bestX,
      z: bestZ,
      peak: bestH,
      radius: clamp(58 + bestH * 0.82, 66, 160),
    } : null;
    this.islandCache.set(key, island);
    return island;
  }

  collisionHeightAt(x, z) {
    let height = Math.max(-4, this.heightAt(x, z));
    const gx = Math.floor(x / CHUNK);
    const gz = Math.floor(z / CHUNK);
    for (let ix = gx - 1; ix <= gx + 1; ix++) {
      for (let iz = gz - 1; iz <= gz + 1; iz++) {
        const island = this.islandAtChunk(ix, iz);
        if (!island) continue;
        const dx = x - island.x;
        const dz = z - island.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= island.radius * island.radius) continue;
        const t = Math.sqrt(d2) / island.radius;
        const fall = Math.pow(1 - t, 1.32);
        const detail = (fbm2(x * 0.032, z * 0.032, this.seed ^ 0x3a11, 2) - 0.5) * 22;
        const surface = island.peak * fall + detail * fall - 4.5 * t;
        if (surface > height) height = surface;
      }
    }
    return height;
  }

  clearanceAt(position) {
    return position.y - this.collisionHeightAt(position.x, position.z);
  }

  // Pick an escape point above every visible surface and turn the nose away
  // from the impact. Candidate rings fan out behind the impact first, so a
  // recovery never drops the plane back in front of the obstacle it hit.
  findSafeRespawn(position, awayDirection, preferred = null) {
    const up = new THREE.Vector3(0, 1, 0);
    const away = new THREE.Vector3();
    if (awayDirection) away.copy(awayDirection);
    away.y = 0;
    if (away.lengthSq() < 0.0001) away.set(0, 0, 1);
    away.normalize();

    const candidates = [];
    if (preferred) {
      const dx = preferred.x - position.x;
      const dz = preferred.z - position.z;
      if (dx * dx + dz * dz > 60 * 60) candidates.push(new THREE.Vector3(preferred.x, 0, preferred.z));
    }
    const distances = [150, 240, 340, 460];
    const offsets = [0, 0.65, -0.65, 1.3, -1.3, 2.1, -2.1, Math.PI];
    for (const distance of distances) {
      for (const offset of offsets) {
        const dir = away.clone().applyAxisAngle(up, offset);
        candidates.push(new THREE.Vector3(
          position.x + dir.x * distance,
          0,
          position.z + dir.z * distance,
        ));
      }
    }
    candidates.push(new THREE.Vector3(position.x, 0, position.z));

    let chosen = null;
    for (const candidate of candidates) {
      const surface = this.collisionHeightAt(candidate.x, candidate.z);
      candidate.y = Math.max(position.y + 95, surface + 125, 135);
      if (candidate.y - surface >= 100 && !this.stormAt(candidate)) {
        chosen = candidate;
        break;
      }
    }
    if (!chosen) {
      chosen = new THREE.Vector3(0, Math.max(position.y + 140, 180), 0);
      chosen.y = Math.max(chosen.y, this.collisionHeightAt(0, 0) + 180);
    }

    const forward = chosen.clone().sub(position);
    forward.y = 0;
    if (forward.lengthSq() < 0.0001) forward.copy(away);
    forward.normalize();
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(new THREE.Vector3(), forward, up),
    );
    quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.1));
    return { position: chosen, quaternion, forward };
  }

  rebuildChunks(camX, camZ, force = false) {
    const cx = Math.floor(camX / CHUNK);
    const cz = Math.floor(camZ / CHUNK);
    if (!force && this.centerCellX === cx && this.centerCellZ === cz) return;
    this.centerCellX = cx;
    this.centerCellZ = cz;
    const wanted = new Set();
    for (let gx = cx - CHUNK_RADIUS; gx <= cx + CHUNK_RADIUS; gx++) {
      for (let gz = cz - CHUNK_RADIUS; gz <= cz + CHUNK_RADIUS; gz++) {
        const key = gx + ':' + gz;
        wanted.add(key);
        if (!this.chunks.has(key)) this.createChunk(gx, gz, key);
      }
    }
    for (const [key, group] of this.chunks) {
      if (wanted.has(key)) continue;
      this.scene.remove(group);
      group.traverse((node) => {
        if (node.userData.ownGeometry && node.geometry) node.geometry.dispose();
      });
      this.chunks.delete(key);
    }
  }

  createChunk(gx, gz, key) {
    const baseX = gx * CHUNK + CHUNK * 0.5;
    const baseZ = gz * CHUNK + CHUNK * 0.5;
    const group = new THREE.Group();
    group.position.set(baseX, 0, baseZ);

    const island = this.islandAtChunk(gx, gz);
    if (island) {
      const bestH = island.peak;
      const bestX = island.x - baseX;
      const bestZ = island.z - baseZ;
      const radius = island.radius;
      const segments = this.quality === 'low' ? 14 : 20;
      const rings = this.quality === 'low' ? 6 : 9;
      const positions = new Float32Array((rings + 1) * (segments + 1) * 3);
      const colors = new Float32Array((rings + 1) * (segments + 1) * 3);
      const indices = [];
      const sand = new THREE.Color(0xdfc79b);
      const coral = new THREE.Color(0xd48f77);
      const grass = new THREE.Color(0x6b9a6f);
      const pine = new THREE.Color(0x3f7462);
      const rock = new THREE.Color(0x8e8b83);
      const lagoon = new THREE.Color(0x4ba89c);
      const tint = scratch.color;
      for (let ri = 0; ri <= rings; ri++) {
        const t = ri / rings;
        for (let si = 0; si <= segments; si++) {
          const angle = (si / segments) * Math.PI * 2;
          const wx = baseX + bestX + Math.cos(angle) * radius * t;
          const wz = baseZ + bestZ + Math.sin(angle) * radius * t;
          const detail = (fbm2(wx * 0.032, wz * 0.032, this.seed ^ 0x3a11, 2) - 0.5) * 22;
          const fall = Math.pow(1 - t, 1.32);
          const y = bestH * fall + detail * fall - 4.5 * t;
          const idx = (ri * (segments + 1) + si) * 3;
          positions[idx] = Math.cos(angle) * radius * t + bestX;
          positions[idx + 1] = y;
          positions[idx + 2] = Math.sin(angle) * radius * t + bestZ;
          const exposed = y / Math.max(1, bestH);
          if (t > 0.84) tint.copy(sand);
          else if (exposed > 0.74) tint.copy(rock);
          else if (t < 0.55 && exposed < 0.22) tint.copy(lagoon);
          else if (exposed > 0.42) tint.copy(pine);
          else tint.copy(grass);
          tint.lerp(coral, clamp((fbm2(wx * 0.011, wz * 0.011, this.seed ^ 0x77, 2) - 0.45) * 0.7, 0, 0.28));
          colors[idx] = tint.r;
          colors[idx + 1] = tint.g;
          colors[idx + 2] = tint.b;
        }
      }
      for (let ri = 0; ri < rings; ri++) {
        for (let si = 0; si < segments; si++) {
          const a = ri * (segments + 1) + si;
          const b = a + segments + 1;
          indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      const islandMesh = new THREE.Mesh(geo, this.shared.islandMat);
      islandMesh.castShadow = true;
      islandMesh.receiveShadow = true;
      islandMesh.userData.ownGeometry = true;
      group.add(islandMesh);

      const wake = new THREE.Mesh(new THREE.RingGeometry(radius * 0.98, radius * 1.28, 28), this.shared.wakeMat);
      wake.rotation.x = -Math.PI / 2;
      wake.position.set(bestX, 1.15, bestZ);
      wake.userData.ownGeometry = true;
      group.add(wake);

      const rng = mulberry32((this.seed + gx * 7919 + gz * 104729) >>> 0);
      const dummy = scratch.m1;
      const matrix = new THREE.Matrix4();
      const pineCount = 18 + Math.floor(rng() * 12);
      const pines = new THREE.InstancedMesh(this.shared.pineGeo, this.shared.pineMat, pineCount);
      const trunks = new THREE.InstancedMesh(this.shared.palmTrunkGeo, this.shared.trunkMat, 10);
      const crowns = new THREE.InstancedMesh(this.shared.palmCrownGeo, this.shared.crownMat, 10);
      const rocks = new THREE.InstancedMesh(this.shared.rockGeo, this.shared.rockMat, 14);
      const obj = new THREE.Object3D();
      const place = (mesh, i, px, py, pz, sx, sy, sz, yaw) => {
        obj.position.set(px, py, pz);
        obj.scale.set(sx, sy, sz);
        obj.rotation.set(0, yaw, 0);
        obj.updateMatrix();
        mesh.setMatrixAt(i, obj.matrix);
      };
      for (let i = 0; i < pineCount; i++) {
        const a = rng() * Math.PI * 2;
        const t = 0.28 + rng() * 0.52;
        const px = bestX + Math.cos(a) * radius * t;
        const pz = bestZ + Math.sin(a) * radius * t;
        const py = bestH * Math.pow(1 - t, 1.32) + 2;
        const s = 0.7 + rng() * 0.8;
        place(pines, i, px, py, pz, s, s * (0.8 + rng() * 0.5), s, rng() * 6.28);
      }
      for (let i = 0; i < 10; i++) {
        const a = rng() * Math.PI * 2;
        const t = 0.62 + rng() * 0.26;
        const px = bestX + Math.cos(a) * radius * t;
        const pz = bestZ + Math.sin(a) * radius * t;
        const py = bestH * Math.pow(1 - t, 1.32) + 1;
        const s = 0.8 + rng() * 0.55;
        place(trunks, i, px, py, pz, s, s, s, rng() * 6.28);
        place(crowns, i, px, py + 12 * s, pz, s, s, s, rng() * 6.28);
      }
      for (let i = 0; i < 14; i++) {
        const a = rng() * Math.PI * 2;
        const t = 0.78 + rng() * 0.22;
        const px = bestX + Math.cos(a) * radius * t;
        const pz = bestZ + Math.sin(a) * radius * t;
        const s = 0.55 + rng() * 1.1;
        place(rocks, i, px, 1.5 + rng() * 3, pz, s, s * 0.72, s, rng() * 6.28);
      }
      for (const mesh of [pines, trunks, crowns, rocks]) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = true;
        group.add(mesh);
      }
      void dummy;
      void matrix;
    }
    this.scene.add(group);
    this.chunks.set(key, group);
  }

  setSeed(seed) {
    this.seed = seed >>> 0;
    for (const [, group] of this.chunks) {
      this.scene.remove(group);
      group.traverse((node) => {
        if (node.userData.ownGeometry && node.geometry) node.geometry.dispose();
      });
    }
    this.chunks.clear();
    this.islandCache.clear();
    for (const ring of this.rings) this.scene.remove(ring.group);
    for (const storm of this.storms) this.scene.remove(storm.group);
    for (const lantern of this.lanterns) this.scene.remove(lantern.group);
    for (const updraft of this.updrafts) {
      this.scene.remove(updraft.line);
      updraft.line.geometry.dispose();
    }
    this.rings.length = 0;
    this.storms.length = 0;
    this.lanterns.length = 0;
    this.updrafts.length = 0;
    this.buildCourse();
    this.rebuildChunks(this.scene.userData.cameraX || 0, this.scene.userData.cameraZ || 0, true);
  }

  setQuality(quality) {
    this.quality = quality;
    this.sunLight.castShadow = quality !== 'low';
  }

  setTimeOfDay(phase) {
    this.dayPhase = clamp(phase, 0, 1);
    const dusk = smoothstep(0.25, 0.72, this.dayPhase);
    const night = smoothstep(0.62, 0.98, this.dayPhase);
    this.nightFactor = night;
    const a = PALETTE.golden;
    const b = PALETTE.dusk;
    const c = PALETTE.night;
    const mix = (key, target) => target.setHex(a[key]).lerp(scratch.color.setHex(b[key]), dusk).lerp(scratch.color2.setHex(c[key]), night);
    mix('low', this.skyUniforms.uLow.value);
    mix('horizon', this.skyUniforms.uHorizon.value);
    mix('zenith', this.skyUniforms.uZenith.value);
    mix('deep', this.oceanUniforms.uDeep.value);
    mix('shallow', this.oceanUniforms.uShallow.value);
    mix('fog', this.fogColor);
    this.scene.fog.color.copy(this.fogColor);
    this.scene.fog.far = lerp(2350, 1600, night);
    this.sunDir.set(lerp(-0.52, -0.86, dusk), lerp(0.34, -0.06, night), lerp(-0.78, -0.48, dusk)).normalize();
    this.sunLight.position.copy(this.sunDir).multiplyScalar(900);
    this.sunLight.intensity = lerp(2.25, 0.32, night);
    this.sunLight.color.setHex(a.sun).lerp(scratch.color.setHex(b.sun), dusk).lerp(scratch.color2.setHex(c.sun), night);
    this.hemi.intensity = lerp(1.5, 0.62, night);
    this.hemi.color.setHex(a.hemiSky).lerp(scratch.color.setHex(b.hemiSky), dusk).lerp(scratch.color2.setHex(c.hemiSky), night);
    this.hemi.groundColor.setHex(a.hemiGround).lerp(scratch.color.setHex(b.hemiGround), dusk).lerp(scratch.color2.setHex(c.hemiGround), night);
    this.skyUniforms.uNight.value = night;
    this.skyUniforms.uPhase.value = this.dayPhase;
    this.oceanUniforms.uNight.value = night;
    this.starMaterial.opacity = night * 0.92;
    this.sunFlare.material.opacity = lerp(0.68, 0.2, night);
    const glowColor = this.rings[0] ? this.rings[0].material.color : scratch.color;
    void glowColor;
  }

  highlightRing(index) {
    for (const ring of this.rings) {
      const active = ring.index === index && !ring.passed;
      const color = active ? 0xffd08a : 0xffb0a0;
      ring.material.color.setHex(color);
      ring.material.emissive.setHex(active ? 0xc46a28 : 0x6d3a4a);
      ring.material.emissiveIntensity = active ? 1.5 : 0.55;
      ring.glow.material.color.setHex(color);
      ring.glow.material.opacity = active ? 0.26 : 0.08;
    }
  }

  resetRun() {
    for (const ring of this.rings) {
      ring.passed = false;
      ring.nearMissed = false;
      ring.group.visible = true;
    }
    for (const lantern of this.lanterns) {
      lantern.active = true;
      lantern.group.visible = true;
    }
    this.highlightRing(0);
  }

  collectLantern(position, radius = 12) {
    for (const lantern of this.lanterns) {
      if (!lantern.active) continue;
      const dx = position.x - lantern.position.x;
      const dy = position.y - lantern.position.y;
      const dz = position.z - lantern.position.z;
      if (dx * dx + dy * dy + dz * dz < radius * radius) {
        lantern.active = false;
        lantern.group.visible = false;
        return lantern;
      }
    }
    return null;
  }

  stormAt(position) {
    for (const storm of this.storms) {
      const dx = position.x - storm.position.x;
      const dy = position.y - storm.position.y;
      const dz = position.z - storm.position.z;
      if (dx * dx + dy * dy + dz * dz < storm.radius * storm.radius) return storm;
    }
    return null;
  }

  applyWinds(dt, flight) {
    const pos = flight.object.position;
    let lift = 0;
    for (const up of this.updrafts) {
      const dx = pos.x - up.x;
      const dz = pos.z - up.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > up.radius * up.radius) continue;
      const altitude = pos.y - Math.max(8, this.heightAt(up.x, up.z));
      if (altitude < 0 || altitude > 190) continue;
      const falloff = 1 - Math.sqrt(d2) / up.radius;
      lift += up.strength * falloff * (1 - altitude / 230);
    }
    if (lift > 0) flight.velocity.y += lift * dt;
    return lift;
  }

  update(dt, cameraPosition) {
    this.time += dt;
    this.scene.userData.cameraX = cameraPosition.x;
    this.scene.userData.cameraZ = cameraPosition.z;
    this.oceanUniforms.uTime.value = this.time;
    this.ocean.position.set(cameraPosition.x, -0.6, cameraPosition.z);
    this.sky.position.copy(cameraPosition);
    this.stars.position.copy(cameraPosition);
    this.sunFlare.position.copy(this.sunDir).multiplyScalar(2600).add(cameraPosition);

    for (const cloud of this.clouds) {
      cloud.position.x += cloud.userData.drift * dt;
      if (cloud.position.x > cameraPosition.x + 1000) cloud.position.x -= 2000;
      cloud.material.color.setHex(this.nightFactor > 0.5 ? 0x7c86ad : 0xffd7bd);
    }
    for (const ring of this.rings) {
      const pulse = 1 + Math.sin(this.time * 2.2 + ring.index) * 0.016;
      ring.group.scale.setScalar(pulse);
      ring.group.children[0].rotation.z += dt * 0.16;
    }
    for (const storm of this.storms) {
      storm.marker.rotation.y += dt * 0.6;
      storm.marker.rotation.x += dt * 0.24;
      const flicker = Math.sin(this.time * 2.7 + storm.phase) * Math.sin(this.time * 0.61 + storm.phase);
      storm.flash.material.opacity = flicker > 0.94 ? (flicker - 0.94) * 9 : 0;
      storm.group.rotation.y += dt * 0.04;
    }
    for (const lantern of this.lanterns) {
      if (!lantern.active) continue;
      lantern.group.position.y += Math.sin(this.time * 0.8 + lantern.phase) * dt * 1.5;
      lantern.group.rotation.y += dt * 0.35;
    }
    for (const up of this.updrafts) {
      up.line.material.opacity = 0.14 + Math.sin(this.time * 1.4 + up.x) * 0.06;
    }
    this.rebuildChunks(cameraPosition.x, cameraPosition.z);
  }
}
