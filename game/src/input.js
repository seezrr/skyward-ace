import { clamp, damp } from './util.js';

const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

// Analog sticks get a gentle curve: small deflections make fine corrections,
// full deflections still reach the stops. Keyboard keys remain exact 0/1.
function curve(value) {
  const v = clamp(value, -1, 1);
  return Math.sign(v) * Math.pow(Math.abs(v), 1.25);
}

// Keyboard, mouse steering, gamepad and touch all feed the same small verb set.
export class InputController {
  constructor(target = window) {
    this.held = new Set();
    this.edges = new Set();
    this.invertY = false;
    this.mouseSteer = false;
    this.mouseX = 0;
    this.mouseY = 0;
    this.touchX = 0;
    this.touchY = 0;
    this.touchBoost = false;
    this.touchThrottle = 0;
    this.tiltX = 0;
    this.tiltY = 0;
    this.tiltEnabled = false;
    this.smoothMouseX = 0;
    this.smoothMouseY = 0;
    this.onAction = () => {};
    this.gamepad = null;
    this.gamepadCamera = false;

    target.addEventListener('keydown', (event) => {
      if (PREVENT.has(event.code)) event.preventDefault();
      if (!event.repeat) {
        this.edges.add(event.code);
        this.onAction(event.code, event);
      }
      this.held.add(event.code);
    });
    target.addEventListener('keyup', (event) => this.held.delete(event.code));
    target.addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.clear();
    });
    target.addEventListener('pointermove', (event) => {
      if (!this.mouseSteer) return;
      this.mouseX = clamp((event.clientX / window.innerWidth) * 2 - 1, -1, 1);
      this.mouseY = clamp((event.clientY / window.innerHeight) * 2 - 1, -1, 1);
    });
    window.addEventListener('deviceorientation', (event) => {
      if (!this.tiltEnabled || event.gamma === null || event.beta === null) return;
      this.tiltX = clamp(event.gamma / 32, -1, 1);
      this.tiltY = clamp((event.beta - 48) / 32, -1, 1);
    });
    this.bindTouch();
  }

  bindTouch() {
    const stick = document.getElementById('touch-stick');
    const nub = document.getElementById('touch-nub');
    if (stick && nub) {
      let pointer = null;
      const move = (event) => {
        if (pointer !== event.pointerId) return;
        const rect = stick.getBoundingClientRect();
        this.touchX = clamp((event.clientX - rect.left - rect.width / 2) / (rect.width * 0.42), -1, 1);
        this.touchY = clamp((event.clientY - rect.top - rect.height / 2) / (rect.height * 0.42), -1, 1);
        nub.style.transform = 'translate(' + (this.touchX * 34) + 'px,' + (this.touchY * 34) + 'px)';
      };
      stick.addEventListener('pointerdown', (event) => {
        pointer = event.pointerId;
        stick.setPointerCapture(pointer);
        move(event);
      });
      stick.addEventListener('pointermove', move);
      const release = () => {
        pointer = null;
        this.touchX = 0;
        this.touchY = 0;
        nub.style.transform = '';
      };
      stick.addEventListener('pointerup', release);
      stick.addEventListener('pointercancel', release);
    }
    const boost = document.getElementById('touch-boost');
    if (boost) {
      boost.addEventListener('pointerdown', () => { this.touchBoost = true; });
      boost.addEventListener('pointerup', () => { this.touchBoost = false; });
      boost.addEventListener('pointercancel', () => { this.touchBoost = false; });
    }
    const up = document.getElementById('touch-up');
    const down = document.getElementById('touch-down');
    if (up) up.addEventListener('pointerdown', () => { this.touchThrottle = 1; });
    if (up) up.addEventListener('pointerup', () => { this.touchThrottle = 0; });
    if (down) down.addEventListener('pointerdown', () => { this.touchThrottle = -1; });
    if (down) down.addEventListener('pointerup', () => { this.touchThrottle = 0; });
    const tilt = document.getElementById('touch-tilt');
    if (tilt) {
      tilt.addEventListener('click', async () => {
        try {
          if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
            const answer = await DeviceOrientationEvent.requestPermission();
            this.tiltEnabled = answer === 'granted';
          } else {
            this.tiltEnabled = !this.tiltEnabled;
          }
          this.onAction('TiltToggle');
        } catch (error) {
          void error;
          this.tiltEnabled = false;
        }
      });
    }
  }

  setSettings(settings) {
    this.invertY = !!settings.invertY;
    this.mouseSteer = !!settings.mouseSteer;
  }

  clear() {
    this.held.clear();
    this.edges.clear();
    this.touchX = 0;
    this.touchY = 0;
    this.touchBoost = false;
    this.touchThrottle = 0;
  }

  isDown(...codes) {
    for (const code of codes) if (this.held.has(code)) return true;
    return false;
  }

  pressed(...codes) {
    for (const code of codes) if (this.edges.has(code)) return true;
    return false;
  }

  consume(...codes) {
    let found = false;
    for (const code of codes) {
      if (this.edges.delete(code)) found = true;
    }
    return found;
  }

  poll(dt) {
    this.smoothMouseX = damp(this.smoothMouseX, this.mouseSteer ? this.mouseX : 0, 7, dt);
    this.smoothMouseY = damp(this.smoothMouseY, this.mouseSteer ? this.mouseY : 0, 7, dt);
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    let pad = null;
    for (const candidate of pads) {
      if (candidate && candidate.connected) {
        pad = candidate;
        break;
      }
    }
    this.gamepad = pad;
    if (!pad) return;
    const camera = !!pad.buttons[1]?.pressed;
    if (camera && !this.gamepadCamera) this.edges.add('GamepadCamera');
    this.gamepadCamera = camera;
  }

  endFrame() {
    this.edges.clear();
  }

  get pitch() {
    // Positive pitch commands climb: W / ArrowUp raise the nose, S / ArrowDown
    // lower it. Gamepad and mouse axes are negated because "up" is negative
    // in both coordinate systems.
    let value = (this.isDown('KeyW', 'ArrowUp') ? 1 : 0) - (this.isDown('KeyS', 'ArrowDown') ? 1 : 0);
    if (this.gamepad) {
      value -= curve(this.gamepad.axes[1] || 0);
      if (this.tiltEnabled) value += curve(this.tiltY);
    } else if (this.tiltEnabled) {
      value += curve(this.tiltY);
    }
    value -= curve(this.smoothMouseY);
    return clamp(value, -1, 1) * (this.invertY ? -1 : 1);
  }

  get roll() {
    // Positive roll banks and turns left; rightward stick/mouse movement must
    // therefore subtract, matching A / ArrowLeft and D / ArrowRight.
    let value = (this.isDown('KeyA', 'ArrowLeft') ? 1 : 0) - (this.isDown('KeyD', 'ArrowRight') ? 1 : 0);
    if (this.gamepad) {
      value -= curve(this.gamepad.axes[0] || 0);
      if (this.tiltEnabled) value -= curve(this.tiltX);
    } else if (this.tiltEnabled) {
      value -= curve(this.tiltX);
    }
    value -= curve(this.smoothMouseX) + curve(this.touchX);
    return clamp(value, -1, 1);
  }

  get yaw() {
    let value = (this.isDown('KeyQ') ? 1 : 0) - (this.isDown('KeyE') ? 1 : 0);
    if (this.gamepad) {
      const trigger = (this.gamepad.buttons[4]?.value || 0) - (this.gamepad.buttons[5]?.value || 0);
      value += trigger;
    }
    return clamp(value, -1, 1);
  }

  get throttleUp() {
    return this.isDown('ShiftLeft', 'ShiftRight') || !!this.gamepad?.buttons[6]?.pressed || this.touchThrottle > 0;
  }

  get throttleDown() {
    return this.isDown('ControlLeft', 'ControlRight') || !!this.gamepad?.buttons[7]?.pressed || this.touchThrottle < 0;
  }

  get boost() {
    return this.isDown('Space') || !!this.gamepad?.buttons[0]?.pressed || this.touchBoost;
  }

  get brake() {
    return this.throttleDown;
  }
}
