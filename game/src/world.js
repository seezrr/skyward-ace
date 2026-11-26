import * as THREE from 'three';
import { clamp, mulberry32, radialTexture, scratch } from './util.js';

const SKY_VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = `
uniform vec3 uSun;
varying vec3 vDir;
void main() {
  float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 horizon = vec3(0.79, 0.88, 0.88);
  vec3 zenith = vec3(0.10, 0.32, 0.53);
  vec3 low = vec3(0.48, 0.66, 0.72);
  vec3 col = mix(low, horizon, smoothstep(0.42, 0.54, h));
  col = mix(col, zenith, smoothstep(0.52, 0.98, h));
  float sunDot = max(dot(normalize(vDir), normalize(uSun)), 0.0);
  float glow = pow(sunDot, 26.0) * 0.42 + pow(sunDot, 4.0) * 0.12;
  float disk = smoothstep(0.9985, 0.99935, sunDot);
  col += vec3(1.0, 0.86, 0.62) * glow + vec3(1.0, 0.96, 0.84) * disk * 1.4;
  float band = sin(vDir.y * 34.0 + vDir.x * 8.0) * 0.012 * smoothstep(0.5, 0.8, h);
  col += band;
  gl_FragColor = vec4(col, 1.0);
}`;

const OCEAN_VERT = `
uniform float uTime;
varying vec3 vWorld;
varying float vWave;
void main() {
  vec3 p = position;
  float wave = sin(p.x * 0.034 + uTime * 1.05) * 1.5
             + cos(p.y * 0.027 - uTime * 0.82) * 1.15
             + sin((p.x + p.y) * 0.013 + uTime * 0.51) * 0.85;
  p.y += wave;
  vWave = wave;
  vWorld = (modelMatrix * vec4(p, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const OCEAN_FRAG = `
uniform float uTime;
uniform vec3 uSun;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFog;
varying vec3 vWorld;
varying float vWave;
void main() {
  vec3 viewDir = normalize(cameraPosition - vWorld);
  float dx = 0.05 * cos(vWorld.x * 0.034 + uTime * 1.05);
  float dz = 0.04 * sin(vWorld.z * 0.027 - uTime * 0.82);
  vec3 n = normalize(vec3(-dx, 1.0, -dz));
  float fres = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), 3.0);
  float spec = pow(max(dot(reflect(-normalize(uSun), n), viewDir), 0.0), 92.0);
  float sparkle = pow(max(dot(reflect(-normalize(uSun), n), viewDir), 0.0), 420.0);
  vec3 col = mix(uDeep, uShallow, clamp(0.42 + vWave * 0.09, 0.0, 1.0));
  col = mix(col, vec3(0.61, 0.81, 0.87), fres * 0.45);
  col += vec3(1.0, 0.86, 0.58) * spec * 1.25 + vec3(1.0) * sparkle * 0.9;
  float foam = smoothstep(2.5, 3.4, vWave) * 0.16;
  col += vec3(foam);
  float dist = length(cameraPosition - vWorld);
  float fog = 1.0 - exp(-pow(dist * 0.00052, 2.0));
  col = mix(col, uFog, clamp(fog, 0.0, 0.94));
  gl_FragColor = vec4(col, 1.0);
}`;

export class World {
  constructor(scene) {
    this.scene = scene;
    this.rng = mulberry32(913377);
    this.time = 0;
    this.rings = [];
    this.clouds = [];
    this.carriers = [];
    this.islands = [];
    this.plume = [];
    this.sunDir = new THREE.Vector3(-0.42, 0.58, -0.70).normalize();
    this.fogColor = new THREE.Color(0xb9d4dd);
    scene.fog = new THREE.Fog(this.fogColor, 500, 2300);

    this.buildSky();
    this.buildLights();
    this.buildOcean();
    this.buildIslands();
    this.buildVolcano();
    this.buildBridge();
    this.buildLighthouse();
    this.buildArches();
    this.buildRings();
    this.buildCarriers();
    this.buildClouds();
  }

  buildSky() {
    const geo = new THREE.SphereGeometry(3600, 32, 20);
    const mat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: { uSun: { value: this.sunDir } },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  buildLights() {
    const hemi = new THREE.HemisphereLight(0xd6f0ff, 0x2b4b5c, 1.45);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1d2, 2.35);
    sun.position.copy(this.sunDir).multiplyScalar(900);
    sun.target.position.set(0, 0, -300);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -620;
    sun.shadow.camera.right = 620;
    sun.shadow.camera.top = 620;
    sun.shadow.camera.bottom = -620;
    sun.shadow.camera.near = 50;
    sun.shadow.camera.far = 1900;
    sun.shadow.bias = -0.0007;
    sun.shadow.normalBias = 1.5;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sunLight = sun;
  }

  buildOcean() {
    const geo = new THREE.PlaneGeometry(2800, 2800, 150, 150);
    geo.rotateX(-Math.PI / 2);
    this.oceanUniforms = {
      uTime: { value: 0 },
      uSun: { value: this.sunDir },
      uDeep: { value: new THREE.Color(0x0d4157) },
      uShallow: { value: new THREE.Color(0x2a8ea1) },
      uFog: { value: this.fogColor },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: OCEAN_VERT,
      fragmentShader: OCEAN_FRAG,
      uniforms: this.oceanUniforms,
      side: THREE.DoubleSide,
    });
    this.ocean = new THREE.Mesh(geo, mat);
    this.ocean.position.y = -0.5;
    this.scene.add(this.ocean);
  }

  makeIsland(x, z, radius, height, tint = 0x6f8f74, seedOffset = 0) {
    this.islands.push({ x, z, radius, height });
    const rng = mulberry32(4000 + Math.round(x) * 13 + Math.round(z) * 7 + seedOffset);
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    const rock = new THREE.MeshStandardMaterial({ color: 0x65737a, roughness: 0.95, flatShading: true });
    const earth = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.9, flatShading: true });
    const sand = new THREE.MeshStandardMaterial({ color: 0xcbb891, roughness: 1, flatShading: true });

    const layers = [
      { rt: radius, rb: radius * 1.06, h: height * 0.24, y: height * 0.10, mat: sand, sides: 9 },
      { rt: radius * 0.80, rb: radius, h: height * 0.38, y: height * 0.38, mat: rock, sides: 8 },
      { rt: radius * 0.44, rb: radius * 0.80, h: height * 0.45, y: height * 0.75, mat: earth, sides: 7 },
      { rt: radius * 0.14, rb: radius * 0.44, h: height * 0.34, y: height * 1.08, mat: earth, sides: 6 },
    ];
    for (const layer of layers) {
      const geo = new THREE.CylinderGeometry(layer.rt, layer.rb, layer.h, layer.sides, 1);
      const mesh = new THREE.Mesh(geo, layer.mat);
      mesh.position.y = layer.y;
      mesh.rotation.y = rng() * 0.7;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }

    const treeGeo = new THREE.ConeGeometry(radius * 0.038, height * 0.19, 5);
    treeGeo.translate(0, height * 0.095, 0);
    const treeMat = new THREE.MeshStandardMaterial({ color: 0x2f6b5b, roughness: 1, flatShading: true });
    const trees = new THREE.InstancedMesh(treeGeo, treeMat, 34);
    trees.castShadow = true;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 34; i++) {
      const angle = rng() * Math.PI * 2;
      const ring = radius * (0.28 + rng() * 0.48);
      const y = height * (1.02 - (ring / radius) * 0.42) + rng() * height * 0.12;
      dummy.position.set(Math.cos(angle) * ring, y, Math.sin(angle) * ring);
      const s = 0.7 + rng() * 0.7;
      dummy.scale.set(s, s * (0.8 + rng() * 0.6), s);
      dummy.rotation.y = rng() * 6.28;
      dummy.updateMatrix();
      trees.setMatrixAt(i, dummy.matrix);
    }
    trees.instanceMatrix.needsUpdate = true;
    group.add(trees);

    const rockGeo = new THREE.DodecahedronGeometry(radius * 0.055, 0);
    const rocks = new THREE.InstancedMesh(rockGeo, rock, 24);
    rocks.castShadow = true;
    for (let i = 0; i < 24; i++) {
      const angle = rng() * Math.PI * 2;
      const ring = radius * (0.65 + rng() * 0.45);
      dummy.position.set(Math.cos(angle) * ring, height * 0.05 + rng() * height * 0.18, Math.sin(angle) * ring);
      const s = 0.5 + rng() * 1.3;
      dummy.scale.set(s, s * 0.7, s);
      dummy.rotation.set(rng(), rng(), rng());
      dummy.updateMatrix();
      rocks.setMatrixAt(i, dummy.matrix);
    }
    rocks.instanceMatrix.needsUpdate = true;
    group.add(rocks);

    const wake = new THREE.Mesh(
      new THREE.RingGeometry(radius * 1.02, radius * 1.5, 24),
      new THREE.MeshBasicMaterial({ color: 0xb9ecdf, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }),
    );
    wake.rotation.x = -Math.PI / 2;
    wake.position.y = 1.2;
    group.add(wake);

    this.scene.add(group);
    return group;
  }

  buildIslands() {
    this.makeIsland(0, -290, 128, 108, 0x6d9274, 1);
    this.makeIsland(220, -170, 150, 132, 0x63886c, 2);
    this.makeIsland(610, -430, 142, 120, 0x78916c, 3);
    this.makeIsland(-260, -180, 118, 96, 0x62907c, 4);
    this.makeIsland(-560, -600, 165, 145, 0x7c8d70, 5);
    this.makeIsland(190, -790, 155, 138, 0x648a72, 6);
    this.makeIsland(-330, -930, 125, 112, 0x6f8d78, 7);
    this.makeIsland(520, -980, 110, 92, 0x71917e, 8);
    this.makeIsland(-760, -260, 100, 84, 0x6d8b74, 9);
  }

  buildVolcano() {
    const group = new THREE.Group();
    group.position.set(-560, 0, -600);
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(155, 340, 9, 3),
      new THREE.MeshStandardMaterial({ color: 0x4c4d52, roughness: 0.98, flatShading: true }),
    );
    cone.position.y = 170;
    cone.castShadow = true;
    cone.receiveShadow = true;
    group.add(cone);
    const crater = new THREE.Mesh(
      new THREE.CylinderGeometry(38, 58, 16, 9),
      new THREE.MeshStandardMaterial({ color: 0x3a3030, roughness: 1, flatShading: true }),
    );
    crater.position.y = 336;
    group.add(crater);
    const lava = new THREE.Mesh(
      new THREE.CircleGeometry(35, 16),
      new THREE.MeshBasicMaterial({ color: 0xff7134, transparent: true, opacity: 0.92 }),
    );
    lava.rotation.x = -Math.PI / 2;
    lava.position.y = 345;
    group.add(lava);
    const lavaLight = new THREE.PointLight(0xff6b30, 26, 380, 2);
    lavaLight.position.set(0, 350, 0);
    group.add(lavaLight);

    const tex = radialTexture('rgba(210,210,205,0.72)', 'rgba(120,118,116,0.24)');
    const plumeMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.44, fog: false });
    for (let i = 0; i < 22; i++) {
      const sprite = new THREE.Sprite(plumeMat.clone());
      sprite.position.set(0, 350, 0);
      const scale = 40 + i * 5;
      sprite.scale.set(scale, scale, 1);
      group.add(sprite);
      this.plume.push({ sprite, offset: (i / 22) * 9, drift: (this.rng() - 0.5) * 70 });
    }
    this.scene.add(group);
    this.volcano = group;
  }

  buildBridge() {
    const group = new THREE.Group();
    const a = new THREE.Vector3(100, 0, -115);
    const b = new THREE.Vector3(710, 0, -410);
    const dir = new THREE.Vector3().subVectors(b, a);
    const length = dir.length();
    const yaw = Math.atan2(dir.x, dir.z);
    group.position.copy(a);
    group.rotation.y = yaw;
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x8a6a4c, roughness: 0.88, flatShading: true });
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x9b8270, roughness: 0.9, flatShading: true });
    const cableMat = new THREE.LineBasicMaterial({ color: 0xe0c8a4, transparent: true, opacity: 0.9 });
    const hangerMat = new THREE.MeshBasicMaterial({ color: 0xd9c09b });

    const deck = new THREE.Mesh(new THREE.BoxGeometry(22, 4, length), deckMat);
    deck.position.set(0, 116, length / 2);
    deck.castShadow = true;
    deck.receiveShadow = true;
    group.add(deck);

    const cablePoints = [[], []];
    for (const t of [0, 1]) {
      const z = t === 0 ? 8 : length - 8;
      for (const side of [-1, 1]) {
        const tower = new THREE.Mesh(new THREE.BoxGeometry(6, 92, 6), towerMat);
        tower.position.set(side * 13, 162, z);
        tower.castShadow = true;
        group.add(tower);
      }
    }
    for (let i = 0; i <= 36; i++) {
      const z = (i / 36) * length;
      const sag = Math.sin((i / 36) * Math.PI) * 26;
      cablePoints[0].push(new THREE.Vector3(-13, 204 - sag, z));
      cablePoints[1].push(new THREE.Vector3(13, 204 - sag, z));
    }
    for (const points of cablePoints) {
      const curve = new THREE.CatmullRomCurve3(points);
      const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(80));
      group.add(new THREE.Line(geo, cableMat));
      for (let i = 0; i <= 36; i += 2) {
        const p = points[i];
        const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, p.y - 118, 4), hangerMat);
        hanger.position.set(p.x, (p.y + 118) / 2, p.z);
        group.add(hanger);
      }
    }
    this.scene.add(group);
    this.bridge = group;
  }

  buildLighthouse() {
    const group = new THREE.Group();
    group.position.set(28, 104, -290);
    const white = new THREE.MeshStandardMaterial({ color: 0xf2efe4, roughness: 0.72 });
    const red = new THREE.MeshStandardMaterial({ color: 0xc9503f, roughness: 0.72 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(11, 15, 92, 12), white);
    body.position.y = 46;
    body.castShadow = true;
    group.add(body);
    for (const y of [22, 60]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(12.4, 13.4, 13, 12), red);
      band.position.y = y;
      group.add(band);
    }
    const gallery = new THREE.Mesh(new THREE.CylinderGeometry(16, 13, 5, 12), red);
    gallery.position.y = 94;
    group.add(gallery);
    const lamp = new THREE.Mesh(
      new THREE.CylinderGeometry(9, 9, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0xffdf9b, transparent: true, opacity: 0.9 }),
    );
    lamp.position.y = 104;
    group.add(lamp);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(13, 12, 12), red);
    roof.position.y = 117;
    group.add(roof);
    const beam = new THREE.Mesh(
      new THREE.ConeGeometry(30, 320, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffe6ac, transparent: true, opacity: 0.11, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    beam.rotation.z = Math.PI / 2;
    beam.position.set(160, 104, 0);
    const pivot = new THREE.Group();
    pivot.position.y = 104;
    pivot.add(beam);
    beam.position.set(160, 0, 0);
    group.add(pivot);
    this.lighthouseBeam = pivot;
    this.scene.add(group);
  }

  buildArches() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xa89b86, roughness: 0.94, flatShading: true });
    const spots = [
      { x: 380, y: 118, z: -520, r: 46, yaw: 0.3 },
      { x: -180, y: 128, z: -900, r: 52, yaw: -0.5 },
      { x: 520, y: 96, z: -980, r: 40, yaw: 0.7 },
    ];
    for (const spot of spots) {
      const group = new THREE.Group();
      group.position.set(spot.x, 0, spot.z);
      group.rotation.y = spot.yaw;
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(16, spot.y, 20), mat);
        leg.position.set(side * spot.r, spot.y / 2, 0);
        leg.castShadow = true;
        group.add(leg);
      }
      const arch = new THREE.Mesh(new THREE.TorusGeometry(spot.r, 9, 7, 18, Math.PI), mat);
      arch.position.y = spot.y;
      arch.rotation.z = 0;
      arch.castShadow = true;
      group.add(arch);
      this.scene.add(group);
    }
  }

  buildRings() {
    const course = [
      [0, 118, 60], [92, 138, -148], [215, 112, -318], [378, 142, -520],
      [176, 96, -742], [-180, 154, -900], [-470, 122, -676], [-318, 92, -362],
      [-104, 146, -118], [34, 124, 138],
    ];
    const ringGeo = new THREE.TorusGeometry(27, 2.4, 8, 36);
    const glowGeo = new THREE.TorusGeometry(27, 5.5, 6, 32);
    for (let i = 0; i < course.length; i++) {
      const pos = new THREE.Vector3(course[i][0], course[i][1], course[i][2]);
      const next = new THREE.Vector3(course[(i + 1) % course.length][0], course[(i + 1) % course.length][1], course[(i + 1) % course.length][2]);
      const normal = new THREE.Vector3().subVectors(next, pos).normalize();
      const group = new THREE.Group();
      group.position.copy(pos);
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x4ce4ff, emissive: 0x1c9dc2, emissiveIntensity: 1.4, roughness: 0.35, metalness: 0.2,
      });
      const ring = new THREE.Mesh(ringGeo, mat);
      group.add(ring);
      const glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({
        color: 0x4ce4ff, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      group.add(glow);
      this.scene.add(group);
      this.rings.push({ group, position: pos, normal, radius: 27, index: i, material: mat, glow });
    }
  }

  buildCarriers() {
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x3b5664, roughness: 0.78, metalness: 0.18, flatShading: true });
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x7d8a8c, roughness: 0.9, flatShading: true });
    const stripeMat = new THREE.MeshBasicMaterial({ color: 0xf0d6a2 });
    const spots = [[-70, 4, 150], [110, 4, 95], [-250, 4, 30]];
    for (let i = 0; i < spots.length; i++) {
      const group = new THREE.Group();
      group.position.set(spots[i][0], 0, spots[i][2]);
      group.rotation.y = 0.18 + i * 0.25;
      const hull = new THREE.Mesh(new THREE.BoxGeometry(46, 13, 190), hullMat);
      hull.position.y = 7;
      hull.castShadow = true;
      group.add(hull);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(42, 3, 176), deckMat);
      deck.position.y = 15;
      deck.receiveShadow = true;
      group.add(deck);
      const tower = new THREE.Mesh(new THREE.BoxGeometry(19, 20, 34), hullMat);
      tower.position.set(-11, 26, 18);
      tower.castShadow = true;
      group.add(tower);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 30, 5), hullMat);
      mast.position.set(-11, 47, 18);
      group.add(mast);
      for (let s = -1; s <= 1; s++) {
        const stripe = new THREE.Mesh(new THREE.PlaneGeometry(3, 12), stripeMat);
        stripe.rotation.x = -Math.PI / 2;
        stripe.position.set(0, 17, s * 42);
        group.add(stripe);
      }
      const wakeMat = new THREE.MeshBasicMaterial({ color: 0xdaf6f2, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
      const wake = new THREE.Mesh(new THREE.PlaneGeometry(58, 230), wakeMat);
      wake.rotation.x = -Math.PI / 2;
      wake.position.set(0, 1.4, 100);
      group.add(wake);
      this.scene.add(group);
      this.carriers.push({ group, position: group.position, health: 100, maxHealth: 100, radius: 42, alive: true, index: i });
    }
  }

  buildClouds() {
    const tex = radialTexture('rgba(255,255,255,0.95)', 'rgba(206,232,242,0.34)');
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.5, fog: false });
    for (let i = 0; i < 34; i++) {
      const sprite = new THREE.Sprite(mat.clone());
      const x = (this.rng() - 0.5) * 1900;
      const z = -this.rng() * 1600 + 150;
      sprite.position.set(x, 170 + this.rng() * 220, z);
      const s = 150 + this.rng() * 220;
      sprite.scale.set(s, s * 0.54, 1);
      sprite.material.opacity = 0.22 + this.rng() * 0.32;
      sprite.userData.drift = 2 + this.rng() * 5;
      this.scene.add(sprite);
      this.clouds.push(sprite);
    }
    const flare = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialTexture('rgba(255,255,245,1)', 'rgba(255,214,140,0.52)'),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false,
    }));
    flare.position.copy(this.sunDir).multiplyScalar(2600);
    flare.scale.set(560, 560, 1);
    this.scene.add(flare);
    this.sunFlare = flare;
  }

  highlightRing(index) {
    for (const ring of this.rings) {
      const active = ring.index === index;
      ring.material.color.setHex(active ? 0xffc26b : 0x4ce4ff);
      ring.material.emissive.setHex(active ? 0xa15a16 : 0x1c9dc2);
      ring.glow.material.color.setHex(active ? 0xffc26b : 0x4ce4ff);
      ring.glow.material.opacity = active ? 0.28 : 0.12;
    }
  }

  resetCarriers() {
    for (const carrier of this.carriers) {
      carrier.health = carrier.maxHealth;
      carrier.alive = true;
      carrier.group.visible = true;
    }
  }

  update(dt, cameraPosition) {
    this.time += dt;
    this.oceanUniforms.uTime.value = this.time;
    this.lighthouseBeam.rotation.y += dt * 0.42;
    this.sky.position.copy(cameraPosition);
    this.sunFlare.position.copy(this.sunDir).multiplyScalar(2600).add(cameraPosition);
    for (const cloud of this.clouds) {
      cloud.position.x += cloud.userData.drift * dt;
      if (cloud.position.x > 1000) cloud.position.x = -1000;
    }
    for (const puff of this.plume) {
      const phase = (this.time * 0.11 + puff.offset) % 9;
      puff.sprite.position.set(puff.drift * phase / 9, 350 + phase * 36, Math.sin(phase + puff.offset) * 18);
      const fade = Math.sin((phase / 9) * Math.PI);
      puff.sprite.material.opacity = 0.34 * fade;
      const scale = 38 + phase * 8;
      puff.sprite.scale.set(scale, scale, 1);
    }
    for (const ring of this.rings) {
      ring.group.scale.setScalar(1 + Math.sin(this.time * 2.4 + ring.index) * 0.014);
    }
  }
}
