import * as THREE from 'three';
import { clamp, formatTime, scratch } from './util.js';

const POPUP_COUNT = 36;
const CYAN = '#66e9ff';
const AMBER = '#ffc26b';
const RED = '#ff6f62';

export class HUD {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = 1;
    this.height = 1;
    this.time = 0;
    this.hitTimer = 0;
    this.damageTimer = 0;
    this.hintTimer = 0;
    this.hint = '';
    this.popups = [];
    for (let i = 0; i < POPUP_COUNT; i++) {
      this.popups.push({ active: false, world: new THREE.Vector3(), text: '', color: CYAN, age: 0, life: 1 });
    }
    this.lineAngles = [];
    for (let i = 0; i < 26; i++) this.lineAngles.push((i / 26) * Math.PI * 2 + (i % 3) * 0.07);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = Math.floor(this.width * dpr);
    this.canvas.height = Math.floor(this.height * dpr);
    this.dpr = dpr;
  }

  popup(worldPosition, text, color = CYAN) {
    for (const popup of this.popups) {
      if (popup.active) continue;
      popup.active = true;
      popup.world.copy(worldPosition);
      popup.text = String(text);
      popup.color = color;
      popup.age = 0;
      popup.life = 0.95;
      return;
    }
  }

  hitMarker() {
    this.hitTimer = 0.16;
  }

  damageFlash() {
    this.damageTimer = 0.75;
  }

  showHint(text, duration = 7) {
    this.hint = text;
    this.hintTimer = duration;
  }

  project(worldPosition, camera, out) {
    out.copy(worldPosition).project(camera);
    if (out.z > 1 || out.z < -1) return false;
    out.x = (out.x * 0.5 + 0.5) * this.width;
    out.y = (-out.y * 0.5 + 0.5) * this.height;
    return out.x > -200 && out.x < this.width + 200 && out.y > -200 && out.y < this.height + 200;
  }

  draw(state, camera, dt) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    this.time += dt;
    this.hitTimer = Math.max(0, this.hitTimer - dt);
    this.damageTimer = Math.max(0, this.damageTimer - dt);
    this.hintTimer = Math.max(0, this.hintTimer - dt);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (state.screen === 'menu') return;

    const flight = state.flight;
    const combat = state.combat;
    const centerX = w * 0.5;
    const centerY = h * 0.5;

    this.drawSpeedLines(ctx, flight, w, h, centerX, centerY);
    this.drawPitchLadder(ctx, flight, centerX, centerY);
    this.drawHeadingTape(ctx, flight, centerX, w);
    this.drawInstruments(ctx, flight, state, w, h);
    if (combat) {
      this.drawRadar(ctx, flight, combat, w);
      this.drawLock(ctx, combat, camera);
    }
    this.drawReticle(ctx, centerX, centerY, state);
    this.drawPopups(ctx, camera, dt);
    this.drawModeBanner(ctx, state, w, h);
    this.drawVignette(ctx, w, h);
    this.drawHint(ctx, w, h);
    if (state.debug) this.drawDebug(ctx, state, w);
  }

  drawSpeedLines(ctx, flight, w, h, cx, cy) {
    const speed = flight.speed;
    if (speed < 112) return;
    const strength = clamp((speed - 112) / 95, 0, 1);
    ctx.save();
    ctx.strokeStyle = 'rgba(190,236,255,' + (0.05 + strength * 0.22).toFixed(3) + ')';
    ctx.lineWidth = 1.4;
    const radius = Math.max(w, h) * 0.78;
    for (let i = 0; i < this.lineAngles.length; i++) {
      const angle = this.lineAngles[i] + Math.sin(this.time * 0.4 + i) * 0.01;
      const near = radius * (0.48 + ((i * 37) % 17) / 60);
      const length = radius * (0.12 + strength * 0.28) * (0.6 + ((i * 19) % 11) / 12);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * near, cy + Math.sin(angle) * near);
      ctx.lineTo(cx + Math.cos(angle) * (near + length), cy + Math.sin(angle) * (near + length));
      ctx.stroke();
    }
    ctx.restore();
  }

  drawPitchLadder(ctx, flight, cx, cy) {
    const roll = flight.bankDegrees();
    const pitch = flight.pitchDegrees();
    const scale = 4.8;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-roll * Math.PI / 180);
    ctx.lineWidth = 2;
    for (let deg = -60; deg <= 60; deg += 10) {
      if (deg === 0) continue;
      const y = deg * scale;
      const alpha = 0.25 + (1 - Math.abs(deg) / 80) * 0.45;
      ctx.strokeStyle = 'rgba(180,240,255,' + alpha.toFixed(2) + ')';
      const half = deg % 20 === 0 ? 86 : 42;
      ctx.beginPath();
      ctx.moveTo(-half, y);
      ctx.lineTo(-18, y);
      ctx.moveTo(18, y);
      ctx.lineTo(half, y);
      ctx.stroke();
      if (deg % 20 === 0) {
        ctx.fillStyle = 'rgba(180,240,255,' + (alpha + 0.15).toFixed(2) + ')';
        ctx.font = '12px Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(String(Math.abs(deg)), -half - 20, y + 4);
        ctx.fillText(String(Math.abs(deg)), half + 20, y + 4);
      }
    }
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-180, pitch * scale);
    ctx.lineTo(-42, pitch * scale);
    ctx.moveTo(42, pitch * scale);
    ctx.lineTo(180, pitch * scale);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = 'rgba(255,194,107,0.92)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 46, cy);
    ctx.lineTo(cx - 14, cy);
    ctx.moveTo(cx + 14, cy);
    ctx.lineTo(cx + 46, cy);
    ctx.moveTo(cx, cy - 4);
    ctx.lineTo(cx, cy + 4);
    ctx.stroke();
    ctx.restore();
  }

  drawHeadingTape(ctx, flight, cx, w) {
    const heading = flight.headingDegrees();
    const span = 110;
    const pxPerDeg = 3.4;
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - 250, 12, 500, 62);
    ctx.fillStyle = 'rgba(4,20,30,0.46)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(84,230,255,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.font = '11px Consolas, monospace';
    ctx.textAlign = 'center';
    for (let offset = -span; offset <= span; offset += 5) {
      let value = Math.round((heading + offset) / 5) * 5;
      const wrapped = ((value % 360) + 360) % 360;
      const x = cx + offset * pxPerDeg;
      if (x < cx - 245 || x > cx + 245) continue;
      const major = wrapped % 10 === 0;
      ctx.strokeStyle = major ? 'rgba(102,233,255,0.75)' : 'rgba(102,233,255,0.3)';
      ctx.beginPath();
      ctx.moveTo(x, 48);
      ctx.lineTo(x, major ? 62 : 56);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = 'rgba(210,247,255,0.85)';
        const label = wrapped === 0 ? 'N' : wrapped === 90 ? 'E' : wrapped === 180 ? 'S' : wrapped === 270 ? 'W' : String(wrapped).padStart(3, '0');
        ctx.fillText(label, x, 38);
      }
    }
    ctx.fillStyle = AMBER;
    ctx.beginPath();
    ctx.moveTo(cx, 64);
    ctx.lineTo(cx - 7, 76);
    ctx.lineTo(cx + 7, 76);
    ctx.closePath();
    ctx.fill();
    ctx.font = 'bold 15px Consolas, monospace';
    ctx.fillStyle = AMBER;
    ctx.fillText(String(Math.round(heading)).padStart(3, '0') + '°', cx, 96);
    ctx.restore();
  }

  drawInstruments(ctx, flight, state, w, h) {
    const knots = Math.round(flight.speed * 1.94384);
    const altitude = Math.round(flight.object.position.y * 3.28084);
    const panel = (x, y, width, height) => {
      ctx.fillStyle = 'rgba(4,20,30,0.58)';
      ctx.fillRect(x, y, width, height);
      ctx.strokeStyle = 'rgba(84,230,255,0.28)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
    };

    panel(24, h - 178, 184, 150);
    ctx.fillStyle = 'rgba(150,196,210,0.85)';
    ctx.font = '11px Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('AIRSPEED  KTS', 38, h - 157);
    ctx.fillStyle = flight.stalled ? RED : CYAN;
    ctx.font = 'bold 42px Consolas, monospace';
    ctx.fillText(String(knots).padStart(3, '0'), 36, h - 113);
    ctx.font = '11px Consolas, monospace';
    ctx.fillStyle = 'rgba(150,196,210,0.75)';
    ctx.fillText('THROTTLE', 38, h - 87);
    ctx.fillStyle = 'rgba(84,230,255,0.15)';
    ctx.fillRect(38, h - 79, 150, 11);
    ctx.fillStyle = flight.boosting ? AMBER : CYAN;
    ctx.fillRect(38, h - 79, 150 * flight.throttle, 11);
    ctx.strokeStyle = 'rgba(220,245,255,0.55)';
    ctx.strokeRect(38.5, h - 78.5, 149, 10);
    ctx.fillStyle = flight.airbrake ? AMBER : 'rgba(150,196,210,0.75)';
    ctx.fillText(flight.airbrake ? 'AIRBRAKE DEPLOYED' : 'G ' + flight.gForce.toFixed(1), 38, h - 50);
    if (flight.stalled) {
      ctx.fillStyle = RED;
      ctx.font = 'bold 14px Consolas, monospace';
      ctx.fillText('STALL — LOWER NOSE', 38, h - 32);
    }

    panel(w - 208, h - 178, 184, 150);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(150,196,210,0.85)';
    ctx.font = '11px Consolas, monospace';
    ctx.fillText('ALTITUDE  FT', w - 38, h - 157);
    ctx.fillStyle = altitude < 40 ? RED : CYAN;
    ctx.font = 'bold 42px Consolas, monospace';
    ctx.fillText(String(Math.max(0, altitude)).padStart(4, '0'), w - 36, h - 113);
    ctx.font = '11px Consolas, monospace';
    ctx.fillStyle = 'rgba(150,196,210,0.75)';
    ctx.fillText('BANK', w - 38, h - 87);
    const bank = flight.bankDegrees();
    ctx.fillStyle = 'rgba(84,230,255,0.15)';
    ctx.fillRect(w - 188, h - 79, 150, 11);
    ctx.fillStyle = AMBER;
    const bankWidth = clamp(Math.abs(bank) / 90, 0, 1) * 75;
    ctx.fillRect(w - 113, h - 79, bank < 0 ? -bankWidth : bankWidth, 11);
    ctx.fillStyle = 'rgba(150,196,210,0.75)';
    ctx.fillText(state.cameraName || 'CHASE CAM', w - 38, h - 50);
  }

  drawRadar(ctx, flight, combat, w) {
    const cx = w - 96;
    const cy = 128;
    const r = 70;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(4,20,30,0.64)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(84,230,255,0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(84,230,255,0.16)';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + r);
    ctx.stroke();
    const sweep = this.time * 1.7;
    ctx.strokeStyle = 'rgba(84,230,255,0.38)';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(sweep) * r, cy + Math.sin(sweep) * r);
    ctx.stroke();

    const heading = flight.headingDegrees();
    const pos = flight.object.position;
    const drawBlip = (worldPos, color, size, locked) => {
      const dx = worldPos.x - pos.x;
      const dz = worldPos.z - pos.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 760) return;
      const bearing = Math.atan2(dx, -dz) * 180 / Math.PI;
      let rel = bearing - heading;
      while (rel > 180) rel -= 360;
      while (rel < -180) rel += 360;
      const angle = (rel - 90) * Math.PI / 180;
      const radius = (distance / 760) * (r - 7);
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      ctx.fillStyle = color;
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
      if (locked) {
        ctx.strokeStyle = AMBER;
        ctx.strokeRect(x - 6, y - 6, 12, 12);
      }
    };
    for (const carrier of combat.world.carriers) {
      if (carrier.alive) drawBlip(carrier.position, '#7dffae', 6, false);
    }
    for (const enemy of combat.enemies) {
      if (enemy.alive) drawBlip(enemy.mesh.position, enemy === combat.lockTarget ? AMBER : RED, enemy.type === 'fortress' ? 8 : 5, enemy === combat.lockTarget);
    }
    ctx.fillStyle = CYAN;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 6);
    ctx.lineTo(cx - 5, cy + 5);
    ctx.lineTo(cx + 5, cy + 5);
    ctx.closePath();
    ctx.fill();
    ctx.font = '10px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(160,210,225,0.8)';
    ctx.fillText('RADAR 760m', cx, cy + r + 18);
    ctx.restore();
  }

  drawLock(ctx, combat, camera) {
    if (!combat.lockTarget || !combat.lockTarget.alive) return;
    const point = scratch.v1;
    if (!this.project(combat.lockTarget.mesh.position, camera, point)) return;
    const x = point.x;
    const y = point.y;
    const half = combat.lockProgress >= 1 ? 30 : 20;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    ctx.strokeStyle = combat.lockProgress >= 1 ? RED : AMBER;
    ctx.lineWidth = 2;
    ctx.strokeRect(-half, -half, half * 2, half * 2);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(x, y, 38, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * combat.lockProgress);
    ctx.strokeStyle = combat.lockProgress >= 1 ? RED : CYAN;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.font = 'bold 12px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = combat.lockProgress >= 1 ? RED : AMBER;
    ctx.fillText(combat.lockProgress >= 1 ? 'MISSILE READY · F' : 'LOCKING…', x, y + 54);
  }

  drawReticle(ctx, cx, cy, state) {
    ctx.save();
    ctx.strokeStyle = 'rgba(210,248,255,0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 11, 0, Math.PI * 2);
    ctx.moveTo(cx - 26, cy);
    ctx.lineTo(cx - 15, cy);
    ctx.moveTo(cx + 15, cy);
    ctx.lineTo(cx + 26, cy);
    ctx.moveTo(cx, cy - 26);
    ctx.lineTo(cx, cy - 15);
    ctx.moveTo(cx, cy + 15);
    ctx.lineTo(cx, cy + 26);
    ctx.stroke();
    if (this.hitTimer > 0) {
      ctx.strokeStyle = 'rgba(255,210,110,' + (this.hitTimer / 0.16).toFixed(2) + ')';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx - 10, cy - 10);
      ctx.lineTo(cx - 3, cy - 3);
      ctx.moveTo(cx + 10, cy - 10);
      ctx.lineTo(cx + 3, cy - 3);
      ctx.moveTo(cx - 10, cy + 10);
      ctx.lineTo(cx - 3, cy + 3);
      ctx.moveTo(cx + 10, cy + 10);
      ctx.lineTo(cx + 3, cy + 3);
      ctx.stroke();
    }
    if (state.combat && state.combat.missileCooldown > 0) {
      ctx.font = '11px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,194,107,0.8)';
      ctx.fillText('MISSILE ' + state.combat.missileCooldown.toFixed(1) + 's', cx, cy + 46);
    }
    ctx.restore();
  }

  drawPopups(ctx, camera, dt) {
    const point = scratch.v2;
    for (const popup of this.popups) {
      if (!popup.active) continue;
      popup.age += dt;
      if (popup.age > popup.life) {
        popup.active = false;
        continue;
      }
      if (!this.project(popup.world, camera, point)) continue;
      const t = popup.age / popup.life;
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = popup.color;
      ctx.font = 'bold 18px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(popup.text, point.x, point.y - 20 - t * 44);
      ctx.globalAlpha = 1;
    }
  }

  drawModeBanner(ctx, state, w, h) {
    ctx.save();
    ctx.fillStyle = 'rgba(4,20,30,0.58)';
    ctx.fillRect(24, 92, 300, 74);
    ctx.strokeStyle = 'rgba(84,230,255,0.28)';
    ctx.strokeRect(24.5, 92.5, 299, 73);
    ctx.textAlign = 'left';
    ctx.font = '11px Consolas, monospace';
    ctx.fillStyle = AMBER;
    ctx.fillText(state.modeLabel || 'FREE FLIGHT', 38, 113);
    ctx.font = 'bold 20px Consolas, monospace';
    ctx.fillStyle = CYAN;
    ctx.fillText(state.modeValue || '', 38, 145);
    if (state.modeSub) {
      ctx.font = '11px Consolas, monospace';
      ctx.fillStyle = 'rgba(170,215,228,0.85)';
      ctx.fillText(state.modeSub, 38, 160);
    }
    ctx.restore();
  }

  drawVignette(ctx, w, h) {
    if (this.damageTimer <= 0) return;
    const strength = this.damageTimer / 0.75;
    const gradient = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.78);
    gradient.addColorStop(0, 'rgba(255,50,40,0)');
    gradient.addColorStop(1, 'rgba(255,50,40,' + (strength * 0.52).toFixed(3) + ')');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  }

  drawHint(ctx, w, h) {
    if (this.hintTimer <= 0 || !this.hint) return;
    ctx.save();
    ctx.font = '13px Consolas, monospace';
    const width = Math.min(w - 60, ctx.measureText(this.hint).width + 48);
    const x = (w - width) / 2;
    const y = h - 40;
    ctx.globalAlpha = Math.min(1, this.hintTimer / 0.8);
    ctx.fillStyle = 'rgba(5,22,32,0.78)';
    ctx.fillRect(x, y, width, 34);
    ctx.strokeStyle = 'rgba(255,194,107,0.55)';
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, 33);
    ctx.fillStyle = AMBER;
    ctx.textAlign = 'center';
    ctx.fillText(this.hint, w / 2, y + 22);
    ctx.restore();
  }

  drawDebug(ctx, state, w) {
    ctx.save();
    ctx.font = '12px Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = AMBER;
    ctx.fillText('FPS ' + state.fps.toFixed(0), 24, 190);
    ctx.restore();
  }
}
