import * as THREE from 'three';
import { buildAircraft } from './aircraft.js';
import { clamp, damp, formatTime, scratch } from './util.js';
import { World } from './world.js';
import { InputController } from './input.js';
import { SfxEngine } from './audio.js';
import { Effects } from './fx.js';
import { HUD } from './hud.js';
import { FlightModel } from './flight.js';
import { CombatSystem } from './enemies.js';
import { GameDirector } from './modes.js';

const sceneCanvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas: sceneCanvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.5, 5200);
camera.position.set(0, 130, 390);

const world = new World(scene);
const aircraft = buildAircraft();
const plane = aircraft.plane;
scene.add(plane);
const outerParts = plane.children.filter((child) => child !== aircraft.cockpitFrame);

const flight = new FlightModel(plane);
const hud = new HUD(document.getElementById('hud'));
const audio = new SfxEngine();
const input = new InputController(window);
const fx = new Effects(scene);
let state = 'menu';
let shake = 0;
let playerHealth = 100;
let cameraMode = 0;
const cameraNames = ['CHASE CAM', 'COCKPIT VIEW', 'ORBIT CAM'];
const debugEnabled = new URLSearchParams(window.location.search).has('debug');
const menuEl = document.getElementById('menu');
const pauseEl = document.getElementById('pause');
const gameoverEl = document.getElementById('gameover');
const toastEl = document.getElementById('toast');
const debugEl = document.getElementById('debug');
const debugFpsEl = document.getElementById('debug-fps');
const debugInfoEl = document.getElementById('debug-info');
let toastTimer = 0;
let menuClock = 0;
let fps = 60;

const director = new GameDirector({
  flight, combat: null, world, fx, audio, hud, plane,
  callbacks: {
    onShake: (amount) => { shake = Math.min(2.6, shake + amount); },
    onEnd: (stats) => showResult(stats),
  },
});
const combat = new CombatSystem(scene, world, fx, audio, hud, {
  onShake: (amount) => { shake = Math.min(2.6, shake + amount); },
  onPlayerDamage: (amount, position) => damagePlayer(amount, position),
  onCarrierDamage: (carrier, amount, position) => damageCarrier(carrier, amount, position),
  onKill: (type, position) => {
    const value = type === 'fortress' ? 1500 : type === 'interceptor' ? 600 : 350;
    director.score += value;
    hud.popup(scratch.v1.copy(position).setY(position.y + 18), '+' + value, '#ffc26b');
  },
});
director.ctx.combat = combat;

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.remove('hidden');
  toastTimer = 1.8;
}

function damagePlayer(amount, position) {
  if (state !== 'playing') return;
  playerHealth -= amount;
  hud.damageFlash();
  audio.hit();
  shake = Math.min(2.6, shake + 0.9);
  hud.popup(scratch.v1.copy(position), '-' + Math.round(amount), '#ff6f62');
  if (playerHealth <= 0) {
    fx.spawnExplosion(plane.position, 1.4, true);
    audio.explosion(true);
    director.end(false, 'AIRCRAFT LOST');
  }
}

function damageCarrier(carrier, amount, position) {
  if (!carrier.alive) return;
  carrier.health -= amount;
  hud.popup(scratch.v2.copy(position).setY(34), 'HULL -' + Math.round(amount), '#ff6f62');
  if (carrier.health > 0) return;
  carrier.alive = false;
  carrier.group.visible = false;
  fx.spawnExplosion(carrier.position, 2.3, true);
  audio.explosion(true);
  shake = Math.min(2.6, shake + 1.4);
  toast('CARRIER LOST');
}

function showResult(stats) {
  state = 'gameover';
  document.getElementById('result-kicker').textContent = stats.victory ? 'MISSION SUCCESS' : 'MISSION FAILED';
  document.getElementById('result-title').textContent = stats.reason;
  document.getElementById('result-line').textContent = stats.mode === 'wave'
    ? 'The fleet remembers who held the line.'
    : stats.mode === 'ring' ? 'Ten gates, one line through the islands.' : 'Every pass leaves a mark on the water.';
  const cells = [
    ['SCORE', stats.score.toLocaleString()],
    ['ACCURACY', Math.round(stats.accuracy * 100) + '%'],
    ['TIME', formatTime(stats.time)],
  ];
  const extra = stats.mode === 'wave'
    ? [['KILLS', stats.kills], ['CARRIERS', stats.carriers + '/3'], ['WAVES', stats.score > 0 ? '—' : '—']]
    : stats.mode === 'ring'
      ? [['GATES', stats.rings + '/10'], ['LEFT', formatTime(stats.timeLeft)], ['BONUS', 'x' + director.combo]]
      : [['ROLLS', stats.barrels], ['INVERTED', stats.inverted + 's'], ['SKIM', stats.skim + 's']];
  const grid = document.getElementById('result-stats');
  grid.replaceChildren();
  for (const [label, value] of cells.concat(extra)) {
    const cell = document.createElement('div');
    cell.className = 'stat-cell';
    const b = document.createElement('b');
    b.textContent = String(value);
    const span = document.createElement('span');
    span.textContent = label;
    cell.append(b, span);
    grid.append(cell);
  }
  gameoverEl.classList.remove('hidden');
  audio.setEngine(0, 0, false, false);
}

function startMode(mode) {
  audio.unlock();
  menuEl.classList.add('hidden');
  pauseEl.classList.add('hidden');
  gameoverEl.classList.add('hidden');
  playerHealth = 100;
  state = 'playing';
  director.start(mode);
}

function restart() {
  if (state === 'menu') return;
  startMode(director.mode);
}

function toMenu() {
  state = 'menu';
  director.active = false;
  combat.reset();
  fx.clear();
  pauseEl.classList.add('hidden');
  gameoverEl.classList.add('hidden');
  menuEl.classList.remove('hidden');
  menuClock = 0;
}

function togglePause() {
  if (state === 'playing') {
    state = 'paused';
    input.clear();
    pauseEl.classList.remove('hidden');
  } else if (state === 'paused') {
    state = 'playing';
    pauseEl.classList.add('hidden');
  }
}

for (const button of document.querySelectorAll('[data-mode]')) {
  button.addEventListener('click', () => startMode(button.dataset.mode));
}
document.getElementById('resume-btn').addEventListener('click', togglePause);
document.getElementById('pause-restart-btn').addEventListener('click', restart);
document.getElementById('pause-menu-btn').addEventListener('click', toMenu);
document.getElementById('restart-btn').addEventListener('click', restart);
document.getElementById('menu-btn').addEventListener('click', toMenu);
for (const button of document.querySelectorAll('[data-debug]')) {
  button.addEventListener('click', () => {
    const action = button.dataset.debug;
    if (action === 'spawn') combat.spawnEnemy('interceptor');
    else if (action === 'fortress') combat.spawnEnemy('fortress');
    else if (action === 'end') director.forceEnd();
  });
}
if (debugEnabled) debugEl.classList.remove('hidden');

input.onAction = (code) => {
  if (code === 'KeyM') {
    audio.setMuted(!audio.muted);
    toast(audio.muted ? 'AUDIO MUTED' : 'AUDIO ON');
  }
};

window.addEventListener('blur', () => {
  if (state === 'playing') togglePause();
});
window.addEventListener('resize', () => {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  hud.resize();
});

const chaseBase = new THREE.Vector3();
const chaseTarget = new THREE.Vector3();
const cameraDesired = new THREE.Vector3();
const cameraLook = new THREE.Vector3();

function updateCamera(dt) {
  const forward = scratch.v1;
  const up = scratch.v2;
  const right = scratch.v3;
  flight.getForward(forward);
  flight.getUp(up);
  flight.getRight(right);
  const speed = flight.speed;
  const boostEffect = flight.boosting ? 6 : 0;

  if (state === 'menu') {
    const angle = menuClock * 0.13;
    cameraDesired.set(
      plane.position.x + Math.sin(angle) * 62,
      plane.position.y + 20 + Math.sin(angle * 0.7) * 9,
      plane.position.z + Math.cos(angle) * 62,
    );
    cameraLook.copy(plane.position).addScaledVector(forward, 24).addScaledVector(up, 3);
    camera.position.lerp(cameraDesired, 1 - Math.exp(-3.6 * dt));
    camera.up.set(0, 1, 0);
    camera.lookAt(cameraLook);
    camera.fov = damp(camera.fov, 68, 4, dt);
  } else if (cameraMode === 1) {
    camera.position.copy(plane.localToWorld(scratch.v4.set(0, 2.65, -0.6)));
    camera.up.copy(up);
    camera.quaternion.copy(plane.quaternion);
    cameraLook.copy(camera.position).addScaledVector(forward, 100);
    camera.lookAt(cameraLook);
    camera.fov = damp(camera.fov, 76 + boostEffect, 4, dt);
  } else if (cameraMode === 2) {
    const angle = menuClock * 0.28;
    cameraDesired.set(
      plane.position.x + Math.sin(angle) * 58,
      plane.position.y + 17,
      plane.position.z + Math.cos(angle) * 58,
    );
    camera.position.lerp(cameraDesired, 1 - Math.exp(-3 * dt));
    camera.up.set(0, 1, 0);
    camera.lookAt(plane.position);
    camera.fov = damp(camera.fov, 64, 4, dt);
  } else {
    chaseBase.copy(plane.position).addScaledVector(up, 9.5).addScaledVector(forward, -38).addScaledVector(right, 0);
    cameraDesired.copy(chaseBase);
    camera.position.lerp(cameraDesired, 1 - Math.exp(-6.2 * dt));
    chaseTarget.copy(plane.position).addScaledVector(forward, 58).addScaledVector(up, 3.5);
    camera.up.set(0, 1, 0);
    camera.lookAt(chaseTarget);
    camera.fov = damp(camera.fov, clamp(66 + (speed - 70) * 0.19, 64, 88) + boostEffect, 3.5, dt);
  }

  if (shake > 0.001) {
    const t = performance.now() * 0.001;
    camera.position.x += Math.sin(t * 47.3) * shake * 0.48;
    camera.position.y += Math.sin(t * 61.7 + 1.3) * shake * 0.42;
    camera.position.z += Math.sin(t * 53.1 + 2.7) * shake * 0.38;
    shake = Math.max(0, shake - dt * 3.8);
  }
  camera.updateProjectionMatrix();
  const cockpitVisible = state !== 'menu' && cameraMode === 1;
  aircraft.cockpitFrame.visible = cockpitVisible;
  for (const part of outerParts) part.visible = !cockpitVisible;
}

function updateMenuFlight(dt) {
  menuClock += dt;
  const t = menuClock;
  plane.position.set(Math.sin(t * 0.12) * 170, 132 + Math.sin(t * 0.19) * 14, 320 - t * 17);
  plane.rotation.set(Math.sin(t * 0.23) * 0.04, Math.sin(t * 0.09) * 0.14, Math.sin(t * 0.31) * 0.38 - 0.08);
  flight.velocity.set(Math.cos(t * 0.12) * 20, 0, -17);
  if (plane.position.z < -900) menuClock = 0;
}

let lastTime = performance.now();
let fpsFrames = 0;
let fpsClock = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - lastTime) / 1000;
  lastTime = now;
  if (!Number.isFinite(dt) || dt < 0) dt = 0;
  dt = Math.min(dt, 0.05);
  fpsFrames++;
  fpsClock += dt;
  if (fpsClock >= 0.5) {
    fps = fpsFrames / fpsClock;
    fpsFrames = 0;
    fpsClock = 0;
    if (debugEnabled) {
      debugFpsEl.textContent = fps.toFixed(0) + ' FPS';
      debugInfoEl.textContent = 'MODE ' + director.mode + '\nSTATE ' + state + '\nENEMIES ' + combat.aliveCount();
    }
  }

  if (state === 'menu') {
    updateMenuFlight(dt);
  } else if (state === 'playing') {
    if (input.consume('Escape')) togglePause();
    if (input.consume('KeyR')) restart();
    if (input.consume('KeyC')) {
      cameraMode = (cameraMode + 1) % cameraNames.length;
      toast('CAMERA · ' + cameraNames[cameraMode]);
    }
    if (input.consume('KeyF')) combat.fireMissile(plane, flight);
    flight.update(dt, input);
    plane.updateMatrixWorld(true);
    combat.update(dt, plane, flight, input);
    director.update(dt);
    audio.setEngine(flight.throttle, flight.speed, flight.boosting, flight.airbrake);
  } else {
    if (input.consume('Escape')) togglePause();
    if (input.consume('KeyR')) restart();
    if (input.consume('KeyC')) cameraMode = (cameraMode + 1) % cameraNames.length;
  }

  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) toastEl.classList.add('hidden');
  }

  world.update(dt, camera.position);
  fx.update(dt, state === 'playing' ? aircraft.wingTips : null, flight.gForce, state === 'playing' && input.firing);
  updateCamera(dt);

  const hudState = {
    screen: state,
    flight, combat, world, debug: debugEnabled, fps,
    cameraName: cameraNames[cameraMode],
    ...director.hudState(),
  };
  hud.draw(hudState, camera, dt);
  renderer.render(scene, camera);
  input.endFrame();
}

requestAnimationFrame(frame);

// Test and debug surface used by the headless play-test.
window.__skyward = {
  getState() {
    return {
      state,
      mode: director.mode,
      active: director.active,
      score: Math.round(director.score),
      fps,
      health: Math.round(playerHealth),
      enemies: combat.aliveCount(),
      carriers: world.carriers.filter((c) => c.alive).length,
      ring: director.ringIndex,
      wave: director.wave,
      camera: cameraNames[cameraMode],
      muted: audio.muted,
      position: { x: plane.position.x, y: plane.position.y, z: plane.position.z },
    };
  },
  startMode,
  restart,
  toMenu,
  forceSpawn(type) { return !!combat.spawnEnemy(type || 'drone'); },
  forceEnd() { director.forceEnd(); },
  setCamera(index) { cameraMode = clamp(index, 0, 2) | 0; },
  mute() { audio.setMuted(!audio.muted); },
};
