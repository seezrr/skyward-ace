// Keyboard state with edge-triggered actions. Both WASD and arrows are supported.
const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

export class InputController {
  constructor(target = window) {
    this.held = new Set();
    this.edges = new Set();
    this.enabled = true;
    this.onAction = () => {};

    target.addEventListener('keydown', (event) => {
      if (PREVENT.has(event.code)) event.preventDefault();
      if (!event.repeat) {
        this.edges.add(event.code);
        this.onAction(event.code, event);
      }
      this.held.add(event.code);
    });
    target.addEventListener('keyup', (event) => {
      this.held.delete(event.code);
    });
    target.addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.clear();
    });
  }

  clear() {
    this.held.clear();
    this.edges.clear();
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

  endFrame() {
    this.edges.clear();
  }

  get pitch() {
    // W / Up lowers the nose; S / Down raises it, as in a flight sim.
    return (this.isDown('KeyS', 'ArrowDown') ? 1 : 0) - (this.isDown('KeyW', 'ArrowUp') ? 1 : 0);
  }

  get roll() {
    // A rolls left, D rolls right.
    return (this.isDown('KeyA', 'ArrowLeft') ? 1 : 0) - (this.isDown('KeyD', 'ArrowRight') ? 1 : 0);
  }

  get yaw() {
    return (this.isDown('KeyQ') ? 1 : 0) - (this.isDown('KeyE') ? 1 : 0);
  }

  get boost() {
    return this.isDown('ShiftLeft', 'ShiftRight');
  }

  get brake() {
    return this.isDown('ControlLeft', 'ControlRight');
  }

  get firing() {
    return this.isDown('Space');
  }
}
