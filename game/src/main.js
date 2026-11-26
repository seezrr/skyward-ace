// CONCEPT: "Halcyon" — a calm-but-thrilling arcade flight at golden hour. A
// small stylised plane crosses a procedural archipelago, threads glowing rings,
// catches island updrafts and outruns the sunset. Alto's Odyssey meets
// Wipeout-clean UI in 3D: one more run, always.
import * as THREE from 'three';
import { buildAircraft } from './aircraft.js';
import { clamp, damp, dailySeed, readStore, scratch, writeStore } from './util.js';
import { World } from './world.js';
import { InputController } from './input.js';
import { SfxEngine } from './audio.js';
import { Effects } from './fx.js';
import { HUD } from './hud.js';
import { FlightModel } from './flight.js';
import { GameDirector } from './modes.js';

const sceneCanvas = document.getElementById('scene');
const gl = sceneCanvas.getContext('webgl2', { antialias: true, powerPreference: 'high-performance' });

if (!gl) {
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('fallback').classList.remove('hidden');
} else {
  boot(gl);
}

function boot(glContext) {
  const defaults = {
    volume: 0.72,
    muted: false,
    quality: 'high',
    autoLevel: true,
    invertY: false,
    mouseSteer: false,
    reduceMotion: false,
    tilt: false,
  };
  const stored = readStore('halcyon.settings', {});
  const settings = { ...defaults, ...(stored && typeof stored === 'object' ? stored : {}) };
  const qualityCap = { low: 0.9, med: 1.2, high: 1.6 };

  const renderer = new THREE.WebGLRenderer({
    canvas: sceneCanvas,
    context: glContext,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = settings.quality !== 'low';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(64, window.innerWidth / window.innerHeight, 0.5, 5200);
  camera.position.set(0, 150, 410);

  let renderScale = 1;
  let drsLocked = false;
  const baseDpr = () => Math.min(window.devicePixelRatio || 1, qualityCap[settings.quality] || 1.6);
  renderer.setPixelRatio(baseDpr());
  renderer.setSize(window.innerWidth, window.innerHeight);

  const world = new World(scene, dailySeed(), settings.quality);
  const aircraft = buildAircraft();
  const plane = aircraft.plane;
  plane.scale.setScalar(1.18);
  scene.add(plane);
  const flight = new FlightModel(plane);
  flight.autoLevel = !!settings.autoLevel;

  const fx = new Effects(scene);
  const hud = new HUD(document.getElementById('hud'));
  const audio = new SfxEngine(settings.volume);
  audio.muted = !!settings.muted;
  const input = new InputController(window);
  input.setSettings(settings);
  input.tiltEnabled = !!settings.tilt;

  const debugEnabled = new URLSearchParams(window.location.search).has('debug');
  const menuEl = document.getElementById('menu');
  const pauseEl = document.getElementById('pause');
  const resultEl = document.getElementById('result');
  const controlsEl = document.getElementById('controls-card');
  const settingsEl = document.getElementById('settings');
  const toastEl = document.getElementById('toast');
  const debugEl = document.getElementById('debug');
  const debugFpsEl = document.getElementById('debug-fps');
  const debugInfoEl = document.getElementById('debug-info');

  let state = 'menu';
  let cameraMode = 0;
  const cameraNames = ['CHASE CAM', 'FREE CAM', 'PHOTO MODE'];
  let shake = 0;
  let toastTimer = 0;
  let menuClock = 2.4;
  let dayPhase = 0.04;
  let fps = 60;
  let shotPreset = '';
  let cameraSnap = true;

  const director = new GameDirector({
    flight, world, fx, audio, hud, plane,
    callbacks: {
      onShake: (amount) => { shake = Math.min(1.5, shake + amount); },
      onRecover: () => { cameraSnap = true; },
      onEnd: (stats) => showResult(stats),
    },
  });

  const chaseBase = new THREE.Vector3();
  const chaseTarget = new THREE.Vector3();
  const cameraDesired = new THREE.Vector3();
  const cameraLook = new THREE.Vector3();
  const cameraUp = new THREE.Vector3();
  const worldUp = new THREE.Vector3(0, 1, 0);

  function saveSettings() {
    writeStore('halcyon.settings', settings);
  }

  function applySettings() {
    input.setSettings(settings);
    input.tiltEnabled = !!settings.tilt;
    flight.autoLevel = !!settings.autoLevel;
    audio.setVolume(settings.volume);
    audio.setMuted(settings.muted);
    world.setQuality(settings.quality);
    renderer.shadowMap.enabled = settings.quality !== 'low';
    document.body.classList.toggle('night', world.nightFactor > 0.45);
    document.body.classList.toggle('touch', matchMedia('(pointer: coarse)').matches);
    document.getElementById('touch-ui').classList.toggle('hidden', !matchMedia('(pointer: coarse)').matches);
    for (const button of document.querySelectorAll('[data-quality]')) {
      button.classList.toggle('on', button.dataset.quality === settings.quality);
    }
    for (const button of document.querySelectorAll('[data-setting]')) {
      const key = button.dataset.setting;
      const value = key === 'tilt' ? settings.tilt : settings[key];
      const on = !!value;
      button.classList.toggle('on', on);
      button.textContent = on ? 'ON' : 'OFF';
    }
    document.getElementById('setting-volume').value = String(Math.round(settings.volume * 100));
    saveSettings();
  }

  function setScreen(element, visible, immediate = false) {
    if (visible) {
      element.classList.remove('hidden');
      element.classList.remove('fading');
    } else if (immediate) {
      element.classList.add('hidden');
      element.classList.add('fading');
    } else {
      element.classList.add('fading');
      window.setTimeout(() => element.classList.add('hidden'), 220);
    }
  }

  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.remove('hidden');
    toastEl.style.opacity = '1';
    toastTimer = 1.8;
  }

  function closeOverlays() {
    controlsEl.classList.add('hidden');
    settingsEl.classList.add('hidden');
  }

  function startMode(mode, preset = '') {
    audio.unlock();
    cameraSnap = true;
    closeOverlays();
    setScreen(menuEl, false, true);
    setScreen(pauseEl, false, true);
    setScreen(resultEl, false, true);
    state = 'playing';
    shotPreset = preset;
    cameraMode = 0;
    shake = 0;
    dayPhase = 0.04;
    world.setTimeOfDay(dayPhase);
    director.start(mode);
  }

  function restart() {
    if (state === 'menu') return;
    startMode(director.mode);
  }

  function toMenu() {
    state = 'menu';
    cameraSnap = true;
    director.active = false;
    fx.clear();
    dayPhase = 0.04;
    world.setTimeOfDay(dayPhase);
    document.body.classList.remove('night');
    cameraMode = 1;
    closeOverlays();
    setScreen(pauseEl, false, true);
    setScreen(resultEl, false, true);
    setScreen(menuEl, true, true);
    menuClock = 2.4;
  }

  function togglePause() {
    if (state === 'playing') {
      state = 'paused';
      input.clear();
      audio.setEngine(0.2, 30, false, false);
      setScreen(pauseEl, true);
    } else if (state === 'paused') {
      state = 'playing';
      setScreen(pauseEl, false);
    }
  }

  function showResult(stats) {
    state = 'result';
    document.getElementById('result-kicker').textContent = stats.victory ? 'RUN COMPLETE' : 'THE DAY ENDED';
    document.getElementById('result-title').textContent = stats.reason;
    document.getElementById('result-line').textContent = stats.mode === 'free'
      ? 'A quiet hour over the archipelago.'
      : stats.mode === 'daily' ? 'Today’s course, your line through it.' : 'One more run is always waiting.';
    document.getElementById('result-stars').textContent = '✦ '.repeat(stats.stars) + '✧ '.repeat(3 - stats.stars);
    const cells = [
      ['SCORE', stats.score.toLocaleString()],
      stats.mode === 'free' ? ['LANTERNS', stats.lanterns] : ['RINGS', stats.rings + '/' + stats.totalRings],
      ['BEST', Math.round(stats.best).toLocaleString()],
      ['TIME', Math.round(stats.time) + 's'],
      ['CHAIN', '×' + stats.combo],
      stats.mode === 'free' ? ['ROLLS', stats.barrels] : ['NEAR MISSES', stats.nearMisses],
    ];
    const grid = document.getElementById('result-stats');
    grid.replaceChildren();
    for (const [label, value] of cells) {
      const cell = document.createElement('div');
      cell.className = 'stat-cell';
      const b = document.createElement('b');
      b.textContent = String(value);
      const span = document.createElement('span');
      span.textContent = label;
      cell.append(b, span);
      grid.append(cell);
    }
    audio.setEngine(0, 0, false, false);
    setScreen(resultEl, true);
  }

  function handleAction(code) {
    const overlayOpen = !controlsEl.classList.contains('hidden') || !settingsEl.classList.contains('hidden');
    if (code === 'Escape') {
      if (overlayOpen) {
        closeOverlays();
        return;
      }
      if (state === 'playing' || state === 'paused') togglePause();
      return;
    }
    if (code === 'KeyP' && (state === 'playing' || state === 'paused')) {
      togglePause();
      return;
    }
    if (code === 'GamepadCamera' || code === 'KeyC') {
      cameraMode = (cameraMode + 1) % cameraNames.length;
      toast('CAMERA · ' + cameraNames[cameraMode]);
      return;
    }
    if (code === 'KeyR' && state !== 'menu') {
      restart();
      return;
    }
    if (code === 'KeyM') {
      settings.muted = !settings.muted;
      applySettings();
      toast(settings.muted ? 'AUDIO MUTED' : 'AUDIO ON');
      return;
    }
    if (code === 'KeyH') {
      controlsEl.classList.toggle('hidden');
      settingsEl.classList.add('hidden');
      return;
    }
    if (code === 'KeyG') {
      settings.autoLevel = !settings.autoLevel;
      applySettings();
      toast('STEERING ASSIST ' + (settings.autoLevel ? 'ON' : 'OFF'));
      return;
    }
    if (code === 'KeyV') {
      settings.mouseSteer = !settings.mouseSteer;
      applySettings();
      toast('MOUSE STEERING ' + (settings.mouseSteer ? 'ON' : 'OFF'));
      return;
    }
    if (code === 'Digit1' || code === 'Digit2' || code === 'Digit3') {
      settings.quality = code === 'Digit1' ? 'low' : code === 'Digit2' ? 'med' : 'high';
      drsLocked = false;
      applySettings();
      toast('QUALITY · ' + settings.quality.toUpperCase());
    }
  }
  // Actions are processed once per frame from the edge buffer so keyboard,
  // gamepad and touch all share the same path without double-firing.
  input.onAction = (code) => {
    if (code === 'TiltToggle') toast('TILT STEERING ' + (settings.tilt ? 'ON' : 'OFF'));
  };

  for (const button of document.querySelectorAll('[data-mode]')) {
    button.addEventListener('click', () => startMode(button.dataset.mode));
  }
  document.getElementById('controls-btn').addEventListener('click', () => {
    controlsEl.classList.remove('hidden');
    settingsEl.classList.add('hidden');
  });
  document.getElementById('settings-btn').addEventListener('click', () => {
    settingsEl.classList.remove('hidden');
    controlsEl.classList.add('hidden');
  });
  for (const button of document.querySelectorAll('[data-close]')) {
    button.addEventListener('click', () => document.getElementById(button.dataset.close).classList.add('hidden'));
  }
  for (const button of document.querySelectorAll('[data-quality]')) {
    button.addEventListener('click', () => {
      settings.quality = button.dataset.quality;
      drsLocked = false;
      applySettings();
    });
  }
  for (const button of document.querySelectorAll('[data-setting]')) {
    button.addEventListener('click', () => {
      const key = button.dataset.setting;
      const actual = key === 'tilt' ? 'tilt' : key;
      settings[actual] = !settings[actual];
      applySettings();
    });
  }
  document.getElementById('setting-volume').addEventListener('input', (event) => {
    settings.volume = Number(event.target.value) / 100;
    applySettings();
  });
  document.getElementById('resume-btn').addEventListener('click', togglePause);
  document.getElementById('pause-restart-btn').addEventListener('click', restart);
  document.getElementById('pause-menu-btn').addEventListener('click', toMenu);
  document.getElementById('restart-btn').addEventListener('click', restart);
  document.getElementById('menu-btn').addEventListener('click', toMenu);
  for (const button of document.querySelectorAll('[data-debug]')) {
    button.addEventListener('click', () => {
      const action = button.dataset.debug;
      if (action === 'end') director.forceEnd();
      else if (action === 'dusk') world.setTimeOfDay(0.5);
      else if (action === 'night') world.setTimeOfDay(0.95);
    });
  }

  window.addEventListener('resize', () => {
    renderer.setPixelRatio(baseDpr() * renderScale);
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    hud.resize();
  });
  window.addEventListener('blur', () => {
    if (state === 'playing') togglePause();
  });

  document.getElementById('daily-label').textContent = 'SEED ' + dailySeed();
  applySettings();
  if (debugEnabled) debugEl.classList.remove('hidden');

  function updateMenuFlight(dt) {
    menuClock += dt;
    const t = menuClock;
    plane.position.set(Math.sin(t * 0.11) * 165, 138 + Math.sin(t * 0.17) * 12, 350 - ((t * 15) % 1250));
    plane.rotation.set(Math.sin(t * 0.21) * 0.045, Math.sin(t * 0.08) * 0.12, Math.sin(t * 0.27) * 0.3 - 0.08);
    flight.velocity.set(Math.cos(t * 0.11) * 18, 0, -15);
    plane.updateMatrixWorld(true);
    dayPhase = 0.05 + Math.sin(t * 0.035) * 0.02;
    world.setTimeOfDay(dayPhase);
  }

  function moveCamera(desired, lambda, dt) {
    if (cameraSnap) camera.position.copy(desired);
    else camera.position.lerp(desired, 1 - Math.exp(-lambda * dt));
  }

  function updateCamera(dt) {
    const forward = scratch.v1;
    const up = scratch.v2;
    const right = scratch.v3;
    flight.getForward(forward);
    flight.getUp(up);
    flight.getRight(right);
    const speed = flight.speed;
    const boostKick = flight.boosting ? 7 : 0;
    const rollBlend = settings.reduceMotion ? 0.08 : 0.34;

    // Every view is a spring arm attached to the aircraft: the camera may
    // drift, but it never orbits away and leaves the plane off-screen.
    if (state === 'menu') {
      const drift = Math.sin(menuClock * 0.3) * 9;
      cameraDesired.copy(plane.position).addScaledVector(forward, -52).addScaledVector(up, 14).addScaledVector(right, 22 + drift);
      cameraLook.copy(plane.position).addScaledVector(forward, 12).addScaledVector(up, 2);
      moveCamera(cameraDesired, 3.4, dt);
      cameraUp.copy(worldUp).lerp(up, 0.12);
      camera.fov = damp(camera.fov, 60, 3, dt);
    } else if (cameraMode === 1) {
      const drift = Math.sin(menuClock * 0.24) * 11;
      cameraDesired.copy(plane.position).addScaledVector(forward, -58).addScaledVector(up, 19).addScaledVector(right, 25 + drift);
      cameraLook.copy(plane.position).addScaledVector(forward, 18).addScaledVector(up, 3);
      moveCamera(cameraDesired, 3.2, dt);
      cameraUp.copy(worldUp).lerp(up, 0.14);
      camera.fov = damp(camera.fov, 58, 3.4, dt);
    } else if (cameraMode === 2) {
      cameraDesired.copy(plane.position).addScaledVector(forward, 5).addScaledVector(right, 40).addScaledVector(up, 11);
      cameraLook.copy(plane.position).addScaledVector(up, 1.5);
      moveCamera(cameraDesired, 3, dt);
      cameraUp.copy(worldUp);
      camera.fov = damp(camera.fov, 50, 3, dt);
    } else {
      chaseBase.copy(plane.position).addScaledVector(forward, -35).addScaledVector(up, 8.6);
      moveCamera(chaseBase, 6.4, dt);
      chaseTarget.copy(plane.position).addScaledVector(forward, 46).addScaledVector(up, 2.6);
      cameraLook.copy(chaseTarget);
      cameraUp.copy(worldUp).lerp(up, rollBlend);
      camera.fov = damp(camera.fov, clamp(61 + (speed - 82) * 0.12, 59, 82) + boostKick, 3.6, dt);
    }

    cameraSnap = false;

    if (shake > 0.001) {
      const t = performance.now() * 0.001;
      camera.position.x += Math.sin(t * 43.1) * shake * 0.5;
      camera.position.y += Math.sin(t * 57.7 + 1.1) * shake * 0.42;
      camera.position.z += Math.sin(t * 51.3 + 2.4) * shake * 0.4;
      shake = Math.max(0, shake - dt * 2.4);
    }
    camera.up.copy(cameraUp);
    camera.lookAt(cameraLook);
    camera.updateProjectionMatrix();
  }

  function applyDynamicResolution(fpsNow) {
    if (drsLocked) return;
    const cap = qualityCap[settings.quality] || 1.6;
    if (fpsNow < 52 && renderScale > 0.68) renderScale = Math.max(0.68, renderScale - 0.07);
    else if (fpsNow > 59 && renderScale < 1) renderScale = Math.min(1, renderScale + 0.035);
    renderer.setPixelRatio(baseDpr() * renderScale);
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  let lastTime = performance.now();
  let fpsFrames = 0;
  let fpsClock = 0;
  let drsClock = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, 0.05);
    fpsFrames++;
    fpsClock += dt;
    drsClock += dt;
    if (fpsClock >= 0.5) {
      fps = fpsFrames / fpsClock;
      fpsFrames = 0;
      fpsClock = 0;
      if (debugEnabled) {
        debugFpsEl.textContent = Math.round(fps) + ' FPS';
        debugInfoEl.textContent = 'MODE ' + director.mode + '\nSTATE ' + state + '\nRINGS ' + director.ringIndex
          + '\nHDG ' + Math.round(flight.headingDegrees()) + '  BANK ' + Math.round(flight.bankDegrees());
      }
    }
    if (drsClock >= 0.7) {
      applyDynamicResolution(fps);
      drsClock = 0;
    }

    input.poll(dt);
    if (input.pressed('Escape', 'KeyP', 'GamepadCamera', 'KeyC', 'KeyR', 'KeyM', 'KeyH', 'KeyG', 'KeyV', 'Digit1', 'Digit2', 'Digit3')) {
      for (const code of ['Escape', 'KeyP', 'GamepadCamera', 'KeyC', 'KeyR', 'KeyM', 'KeyH', 'KeyG', 'KeyV', 'Digit1', 'Digit2', 'Digit3']) {
        if (input.consume(code)) handleAction(code);
      }
    }

    let windLift = 0;
    if (state === 'menu') {
      updateMenuFlight(dt);
      audio.setEngine(0.32, 62, false, false);
      audio.setAmbient(dayPhase);
    } else if (state === 'playing') {
      flight.update(dt, input);
      windLift = world.applyWinds(dt, flight);
      plane.updateMatrixWorld(true);
      director.update(dt, windLift);
      if (director.active) {
        if (shotPreset === 'dusk') dayPhase = 0.52;
        else if (shotPreset === 'night') dayPhase = 0.98;
        else if (shotPreset === 'ring') dayPhase = 0.07;
        else dayPhase = director.mode === 'free'
          ? (director.time / 210) % 1
          : clamp(director.time / 120, 0, 1);
        world.setTimeOfDay(dayPhase);
        audio.setAmbient(dayPhase);
        audio.setEngine(flight.throttle, flight.speed, flight.boosting, flight.braking);
        if (flight.stallWarning) audio.stall();
      }
    } else {
      audio.setEngine(0.18, 32, false, false);
    }

    if (toastTimer > 0) {
      toastTimer -= dt;
      if (toastTimer <= 0) {
        toastEl.style.opacity = '0';
        window.setTimeout(() => toastEl.classList.add('hidden'), 260);
      }
    }

    world.update(dt, camera.position);
    fx.update(dt, state === 'playing' ? aircraft.wingTips : null, flight.gForce, flight.boosting && state === 'playing');
    updateCamera(dt);
    document.body.classList.toggle('night', world.nightFactor > 0.45);
    if (aircraft.prop) aircraft.prop.rotation.z += dt * (4 + flight.throttle * 24);

    const hudState = {
      screen: state,
      flight, world,
      debug: debugEnabled,
      fps,
      quality: settings.quality,
      renderScale,
      cameraName: cameraNames[cameraMode],
      seed: director.seed,
      timer: director.timer || 0,
      night: world.nightFactor > 0.42,
      reduceMotion: settings.reduceMotion,
      photo: state === 'playing' && cameraMode === 2,
      ...director.hudState(),
    };
    hud.draw(hudState, camera, dt);
    renderer.render(scene, camera);
    input.endFrame();
  }

  requestAnimationFrame(frame);

  function setShotPreset(name) {
    shotPreset = name;
    drsLocked = true;
    renderScale = 1;
    renderer.setPixelRatio(baseDpr());
    renderer.setSize(window.innerWidth, window.innerHeight);
    closeOverlays();
    if (name === 'title') {
      toMenu();
      menuClock = 3.6;
      cameraMode = 1;
      world.setTimeOfDay(0.06);
      return { state, mode: director.mode };
    }
    startMode(name === 'ring' ? 'ring' : 'free', name);
    if (name === 'ring') {
      plane.position.set(4, 127, 196);
      plane.quaternion.setFromEuler(new THREE.Euler(-0.02, -0.06, -0.1));
      flight.getForward(scratch.v1).multiplyScalar(94);
      flight.velocity.copy(scratch.v1);
      director.prevPosition.copy(plane.position);
      cameraMode = 0;
      dayPhase = 0.07;
      world.setTimeOfDay(dayPhase);
    } else if (name === 'dusk') {
      plane.position.set(-220, 158, -430);
      plane.quaternion.setFromEuler(new THREE.Euler(0.05, 0.75, -0.46));
      flight.getForward(scratch.v1).multiplyScalar(104);
      flight.velocity.copy(scratch.v1);
      director.prevPosition.copy(plane.position);
      cameraMode = 1;
      menuClock = 5.2;
      dayPhase = 0.52;
      world.setTimeOfDay(dayPhase);
      fx.burst(scratch.v2.set(-300, 122, -508), 0xffc58c, 16, 18, 5);
    } else if (name === 'night') {
      plane.position.set(240, 138, -560);
      plane.quaternion.setFromEuler(new THREE.Euler(-0.03, -0.5, 0.22));
      flight.getForward(scratch.v1).multiplyScalar(82);
      flight.velocity.copy(scratch.v1);
      director.prevPosition.copy(plane.position);
      cameraMode = 2;
      menuClock = 8.1;
      dayPhase = 0.98;
      world.setTimeOfDay(dayPhase);
      fx.burst(scratch.v2.set(250, 150, -620), 0xffdca0, 18, 20, 6);
    }
    plane.updateMatrixWorld(true);
    return { state, mode: director.mode, camera: cameraNames[cameraMode] };
  }

  window.__halcyon = {
    getState() {
      const projected = new THREE.Vector3().copy(plane.position).project(camera);
      const forward = flight.getForward(new THREE.Vector3());
      const right = flight.getRight(new THREE.Vector3());
      const surface = world.collisionHeightAt(plane.position.x, plane.position.z);
      return {
        state,
        mode: director.mode,
        active: director.active,
        score: Math.round(director.score || 0),
        rings: director.ringIndex || 0,
        timer: Number((director.timer || 0).toFixed(1)),
        fps: Math.round(fps),
        camera: cameraNames[cameraMode],
        quality: settings.quality,
        renderScale: Number(renderScale.toFixed(2)),
        seed: director.seed,
        best: Math.round(director.best || 0),
        muted: audio.muted,
        autoLevel: settings.autoLevel,
        night: Number(world.nightFactor.toFixed(2)),
        lanternsActive: world.lanterns.filter((l) => l.active).length,
        position: { x: plane.position.x, y: plane.position.y, z: plane.position.z },
        heading: Math.round(flight.headingDegrees()),
        headingRaw: Number(flight.headingDegrees().toFixed(3)),
        bank: Math.round(flight.bankDegrees()),
        bankRaw: Number(flight.bankDegrees().toFixed(3)),
        pitch: Math.round(flight.pitchDegrees()),
        surface: Number(surface.toFixed(1)),
        clearance: Number((plane.position.y - surface).toFixed(1)),
        recoveryGrace: Number((director.recoveryGrace || 0).toFixed(2)),
        crashes: director.crashes || 0,
        forwardSpeed: Number(flight.velocity.dot(forward).toFixed(1)),
        verticalSpeed: Number(flight.velocity.y.toFixed(1)),
        stalled: !!flight.stalled,
        sideSpeed: Number(flight.velocity.dot(right).toFixed(1)),
        controls: { roll: input.roll, pitch: input.pitch, yaw: input.yaw },
        rates: { roll: Number(flight.rollRate.toFixed(2)), pitch: Number(flight.pitchRate.toFixed(2)), yaw: Number(flight.yawRate.toFixed(2)) },
        cameraInfo: {
          position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
          direction: camera.getWorldDirection(new THREE.Vector3()).toArray().map((n) => Number(n.toFixed(3))),
          look: cameraLook.toArray().map((n) => Number(n.toFixed(3))),
          forward: flight.getForward(new THREE.Vector3()).toArray().map((n) => Number(n.toFixed(3))),
          near: camera.near,
          far: camera.far,
        },
        planeScreen: {
          x: Math.round((projected.x * 0.5 + 0.5) * window.innerWidth),
          y: Math.round((-projected.y * 0.5 + 0.5) * window.innerHeight),
          ndc: { x: Number(projected.x.toFixed(3)), y: Number(projected.y.toFixed(3)), z: Number(projected.z.toFixed(3)) },
          inView: projected.z > -1 && projected.z < 1 && Math.abs(projected.x) < 0.95 && Math.abs(projected.y) < 0.95,
          distance: Number(camera.position.distanceTo(plane.position).toFixed(1)),
        },
        settings: { ...settings },
        shotPreset,
      };
    },
    startMode,
    restart,
    toMenu,
    forceEnd() { director.forceEnd(); },
    setCamera(index) { cameraMode = clamp(index, 0, 2) | 0; },
    setSetting(key, value) {
      if (!(key in settings)) return false;
      settings[key] = value;
      applySettings();
      return true;
    },
    mute() { settings.muted = !settings.muted; applySettings(); },
    setShotPreset,
    terrainAt(x, z) { return Number(world.collisionHeightAt(x, z).toFixed(2)); },
    debugPlace(x, y, z, vx = 0, vy = 0, vz = 0) {
      plane.position.set(x, y, z);
      plane.quaternion.identity();
      flight.velocity.set(vx, vy, vz);
      flight.stalled = false;
      flight.stallWarning = false;
      director.prevPosition.copy(plane.position);
      cameraSnap = true;
      return { x: plane.position.x, y: plane.position.y, z: plane.position.z };
    },
  };
}
