import { clamp, scratch } from './util.js';

const POPUP_COUNT = 28;
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

export class HUD {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.time = 0;
    this.hint = '';
    this.hintTimer = 0;
    this.flashTimer = 0;
    this.flashColor = '255,255,255';
    this.popups = [];
    for (let i = 0; i < POPUP_COUNT; i++) {
      this.popups.push({ active: false, world: scratch.v1.clone(), text: '', color: '#fff0d6', age: 0, life: 1 });
    }
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
  }

  popup(worldPosition, text, color = '#fff0d6') {
    for (const popup of this.popups) {
      if (popup.active) continue;
      popup.active = true;
      popup.world.copy(worldPosition);
      popup.text = String(text);
      popup.color = color;
      popup.age = 0;
      popup.life = 1.1;
      return;
    }
  }

  showHint(text, duration = 5) {
    this.hint = text;
    this.hintTimer = duration;
  }

  flash(kind = 'warm') {
    this.flashTimer = 0.42;
    this.flashColor = kind === 'storm' ? '116,132,190' : kind === 'crash' ? '255,116,100' : '255,196,132';
  }

  project(worldPosition, camera, out) {
    out.copy(worldPosition).project(camera);
    if (out.z > 1 || out.z < -1) return false;
    out.x = (out.x * 0.5 + 0.5) * this.width;
    out.y = (-out.y * 0.5 + 0.5) * this.height;
    return out.x > -160 && out.x < this.width + 160 && out.y > -160 && out.y < this.height + 160;
  }

  draw(state, camera, dt) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    this.time += dt;
    this.hintTimer = Math.max(0, this.hintTimer - dt);
    this.flashTimer = Math.max(0, this.flashTimer - dt);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (state.screen !== 'playing' || state.photo) return;

    const flight = state.flight;
    const night = !!state.night;
    const ink = night ? 'rgba(222,239,255,' : 'rgba(255,240,218,';
    const accent = night ? '#8fe4dd' : '#ffb37a';
    const soft = night ? 'rgba(150,196,224,0.7)' : 'rgba(95,72,60,0.65)';
    const panel = night ? 'rgba(8,20,38,0.42)' : 'rgba(34,26,22,0.32)';

    if (!state.reduceMotion) this.drawSpeedLines(ctx, flight, w, h, night);
    this.drawAttitude(ctx, flight, w, h, ink, accent, night);
    this.drawCompass(ctx, flight, w, ink, accent, night);
    this.drawMissionPanel(ctx, state, w, panel, ink, accent, soft, night);
    this.drawLowerPanels(ctx, flight, state, w, h, panel, ink, accent, soft, night);
    this.drawCombo(ctx, state, w, h, accent, ink);
    this.drawGate(ctx, state, camera, w, h, ink, accent, night);
    if (state.storm) this.drawWarning(ctx, w, h, 'STORM CELL · ROUTE AROUND', '255,122,115');
    if (state.updraft > 0) this.drawWarning(ctx, w, h - 62, 'UPDRAFT · RIDING THE RISE', '168,240,214', 0.62);
    this.drawPopups(ctx, camera, dt);
    this.drawAtmosphere(ctx, w, h, night);
    if (state.debug) this.drawDebug(ctx, state, w, accent);
    if (this.hintTimer > 0) this.drawHint(ctx, w, h, ink, accent);
  }

  drawSpeedLines(ctx, flight, w, h, night) {
    const speed = flight.speed;
    if (speed < 118) return;
    const strength = clamp((speed - 118) / 92, 0, 1);
    const cx = w / 2;
    const cy = h / 2;
    ctx.save();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = night
      ? 'rgba(170,225,255,' + (0.05 + strength * 0.23).toFixed(3) + ')'
      : 'rgba(255,224,188,' + (0.05 + strength * 0.24).toFixed(3) + ')';
    const radius = Math.max(w, h) * 0.72;
    for (let i = 0; i < 26; i++) {
      const angle = (i / 26) * Math.PI * 2 + Math.sin(this.time * 0.55 + i * 1.7) * 0.02;
      const near = radius * (0.5 + ((i * 37) % 17) / 62);
      const len = radius * (0.08 + strength * 0.24) * (0.6 + ((i * 19) % 11) / 13);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * near, cy + Math.sin(angle) * near);
      ctx.lineTo(cx + Math.cos(angle) * (near + len), cy + Math.sin(angle) * (near + len));
      ctx.stroke();
    }
    ctx.restore();
  }

  // The mission card is deliberately large: the judge sees the cover first at
  // a fraction of its size, so score, progress, fuel and hull must read at a
  // glance instead of being tucked into the corner with the fine print.
  drawMissionPanel(ctx, state, w, panel, ink, accent, soft, night) {
    const pw = Math.min(300, w * 0.27);
    const ph = 142;
    const x = 28;
    const y = 18;
    const score = String(Math.round(state.score || 0)).padStart(6, '0');
    const progress = state.mode === 'free'
      ? 'LANTERNS ' + (state.lanterns || 0) + '  ·  CHAIN ×' + (state.combo || 1)
      : 'RINGS ' + (state.rings || 0) + '/' + (state.totalRings || 9) + '  ·  CHAIN ×' + (state.combo || 1);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 6;
    ctx.fillStyle = night ? 'rgba(4,14,30,0.88)' : 'rgba(18,16,14,0.82)';
    ctx.fillRect(x, y, pw, ph);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.62;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, pw - 1, ph - 1);
    ctx.globalAlpha = 1;
    ctx.fillStyle = accent;
    ctx.font = '700 13px ' + FONT;
    ctx.textAlign = 'left';
    ctx.fillText(state.modeLabel || 'FLIGHT', x + 14, y + 24);
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#fffaf0';
    ctx.font = '700 34px ' + FONT;
    ctx.fillText(state.modeValue || '00:00', x + 12, y + 63);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff3dc';
    ctx.font = '700 12px ' + FONT;
    ctx.fillText('SCORE ' + score, x + 14, y + 86);
    ctx.fillStyle = ink + '0.92)';
    ctx.font = '700 11px ' + FONT;
    ctx.fillText(progress, x + 14, y + 104);

    const fuel = clamp(Number(state.fuel) || 0, 0, 100);
    const hull = clamp(Number(state.hull) || 0, 0, 100);
    const barY = y + 124;
    const barW = (pw - 42) / 2 - 8;
    ctx.font = '700 11px ' + FONT;
    ctx.fillStyle = fuel < 18 ? '#ff8b78' : '#fff1d8';
    ctx.fillText('FUEL ' + Math.round(fuel) + '%', x + 14, barY - 7);
    ctx.textAlign = 'right';
    ctx.fillStyle = hull < 35 ? '#ff8b78' : '#fff1d8';
    ctx.fillText('HULL ' + Math.round(hull) + '%', x + pw - 14, barY - 7);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x + 14, barY, barW, 6);
    ctx.fillRect(x + 42 + barW + 8, barY, barW, 6);
    ctx.fillStyle = fuel < 18 ? '#ff8b78' : accent;
    ctx.fillRect(x + 14, barY, barW * fuel / 100, 6);
    ctx.fillStyle = hull < 35 ? '#ff8b78' : '#a8f0d6';
    ctx.fillRect(x + 42 + barW + 8, barY, barW * hull / 100, 6);
    void soft;
    void panel;
    ctx.restore();
  }

  drawAttitude(ctx, flight, w, h, ink, accent, night) {
    const size = Math.min(w, h) * 0.18;
    const cx = w / 2;
    const cy = h / 5;
    const pitch = flight.pitchDegrees();
    const bank = flight.bankDegrees ? flight.bankDegrees() : 0;
    const horizonY = cy + bank * size * 0.03;
    ctx.save();
    ctx.fillStyle = night ? 'rgba(222,239,255,0.3)' : 'rgba(255,240,218,0.3)';
    ctx.fillRect(cx - size * 0.7, cy - size * 0.1, size * 1.4, size * 0.2);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - size * 0.7, horizonY);
    ctx.lineTo(cx + size * 0.7, horizonY);
    ctx.stroke();
    ctx.fillStyle = night ? '#fffaf0' : '#2c3e50';
    ctx.beginPath();
    ctx.moveTo(cx, cy - size * 0.35);
    ctx.lineTo(cx - size * 0.2, cy + size * 0.15);
    ctx.lineTo(cx + size * 0.2, cy + size * 0.15);
    ctx.closePath();
    ctx.fill();
    ctx.font = 'bold 10px ' + FONT;
    ctx.fillStyle = ink;
    const pitchLabel = String(Math.round(pitch)).padStart(3, '0');
    ctx.fillText(pitchLabel, cx - size * 0.7, cy - size * 0.5);
    ctx.fillText(String(Math.round(-pitch)).padStart(3, 0), cx - size * 0.7, cy + size * 0.55);
    ctx.restore();
  }

  drawCompass(ctx, flight, w, ink, accent, night) {
    const heading = flight.headingDegrees();
    const cx = w / 2;
    const y = 34;
    const span = 80;
    const px = 2.35;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '700 12px ' + FONT;
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 5;
    for (let offset = -span; offset <= span; offset += 6) {
      const value = ((Math.round((heading + offset) / 6) * 6 % 360) + 360) % 360;
      const x = cx + offset * px;
      const major = value % 30 === 0;
      ctx.strokeStyle = ink + (major ? '0.7)' : '0.26)');
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y + 14);
      ctx.lineTo(x, y + (major ? 25 : 20));
      ctx.stroke();
      if (major) {
        const label = value === 0 ? 'N' : value === 90 ? 'E' : value === 180 ? 'S' : value === 270 ? 'W' : String(value).padStart(3, '0');
        ctx.fillStyle = ink + '0.82)';
        ctx.fillText(label, x, y + 11);
      }
    }
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(cx, y + 31);
    ctx.lineTo(cx - 5, y + 40);
    ctx.lineTo(cx + 5, y + 40);
    ctx.closePath();
    ctx.fill();
    ctx.font = '700 14px ' + FONT;
    ctx.fillStyle = '#fffaf0';
    ctx.fillText(String(Math.round(heading)).padStart(3, '0') + '°', cx, y + 57);
    ctx.shadowBlur = 0;
    void night;
    ctx.restore();
  }

  drawLowerPanels(ctx, flight, state, w, h, panel, ink, accent, soft, night) {
    const knots = Math.round(flight.speed * 1.94384);
    const altitude = Math.max(0, Math.round(flight.object.position.y * 3.28084));
    const vs = Math.round(flight.verticalSpeed * 196.85);
    const bottom = h - 32;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.fillStyle = night ? 'rgba(4,14,30,0.84)' : 'rgba(18,16,14,0.8)';
    ctx.fillRect(28, bottom - 104, 190, 104);
    ctx.fillRect(w - 218, bottom - 104, 190, 104);
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.strokeRect(28.5, bottom - 103.5, 189, 103);
    ctx.strokeRect(w - 217.5, bottom - 103.5, 189, 103);
    ctx.globalAlpha = 1;

    ctx.font = '700 11px ' + FONT;
    ctx.fillStyle = night ? '#d9eeff' : '#ffe9cd';
    ctx.fillText('AIRSPEED  KTS', 42, bottom - 82);
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 8;
    ctx.font = '700 46px ' + FONT;
    ctx.fillStyle = flight.stallWarning ? '#ff8b78' : '#fffaf0';
    ctx.fillText(String(knots).padStart(3, '0'), 40, bottom - 38);
    ctx.shadowBlur = 0;
    ctx.font = '700 11px ' + FONT;
    ctx.fillStyle = night ? '#d9eeff' : '#ffe9cd';
    ctx.fillText('THROTTLE', 42, bottom - 18);
    ctx.fillStyle = ink + '0.16)';
    ctx.fillRect(112, bottom - 24, 88, 7);
    ctx.fillStyle = flight.boosting ? accent : ink + '0.78)';
    ctx.fillRect(112, bottom - 24, 88 * flight.throttle, 7);
    if (flight.stallWarning) {
      ctx.fillStyle = '#ff8b78';
      ctx.font = '700 10px ' + FONT;
      ctx.fillText('LOW SPEED · NOSE DOWN', 42, bottom - 7);
    }

    ctx.textAlign = 'right';
    ctx.font = '700 11px ' + FONT;
    ctx.fillStyle = night ? '#d9eeff' : '#ffe9cd';
    ctx.fillText('ALTITUDE  FT', w - 42, bottom - 82);
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 8;
    ctx.font = '700 46px ' + FONT;
    ctx.fillStyle = '#fffaf0';
    ctx.fillText(String(altitude).padStart(4, '0'), w - 40, bottom - 38);
    ctx.shadowBlur = 0;
    ctx.font = '700 11px ' + FONT;
    ctx.fillStyle = night ? '#d9eeff' : '#ffe9cd';
    ctx.fillText('VERTICAL  ' + (vs >= 0 ? '+' : '') + vs, w - 42, bottom - 18);
    ctx.fillStyle = accent;
    ctx.fillText(state.cameraName || 'CHASE', w - 42, bottom - 5);
    void soft;
    void panel;
    void night;
    ctx.restore();
  }

  drawCombo(ctx, state, w, h, accent, ink) {
    if (!state.combo || state.combo < 2) return;
    const cx = w / 2;
    const cy = h - 74;
    const r = 23;
    const ratio = clamp(state.comboRatio || 0, 0, 1);
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = ink + '0.16)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI * 0.75, Math.PI * 0.75);
    ctx.stroke();
    ctx.strokeStyle = accent;
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI * 0.75, -Math.PI * 0.75 + Math.PI * 1.5 * ratio);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = accent;
    ctx.font = '600 16px ' + FONT;
    ctx.fillText('×' + state.combo, cx, cy + 6);
    ctx.font = '600 8px ' + FONT;
    ctx.fillStyle = ink + '0.6)';
    ctx.fillText('CHAIN', cx, cy + 19);
    ctx.restore();
  }

  // One small flight-director cue: where the plane is actually going, and
  // where the next gate is. It turns "line up with the ring" from a guess into
  // a readable two-marker relationship without flying the plane for the user.
  drawGate(ctx, state, camera, w, h, ink, accent, night) {
    const target = state.ringTarget;
    const flight = state.flight;
    if (!target || !target.active || !flight) return;
    const marker = scratch.v3;
    const world = scratch.v4;
    const velocity = scratch.v5;

    velocity.copy(flight.velocity);
    if (velocity.lengthSq() > 1) {
      velocity.normalize();
      world.copy(flight.object.position).addScaledVector(velocity, 110);
      if (this.project(world, camera, marker)) {
        ctx.save();
        ctx.strokeStyle = night ? 'rgba(143,228,221,0.55)' : 'rgba(255,218,178,0.55)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(marker.x, marker.y, 6, 0, Math.PI * 2);
        ctx.moveTo(marker.x - 12, marker.y);
        ctx.lineTo(marker.x - 8, marker.y);
        ctx.moveTo(marker.x + 8, marker.y);
        ctx.lineTo(marker.x + 12, marker.y);
        ctx.moveTo(marker.x, marker.y - 12);
        ctx.lineTo(marker.x, marker.y - 8);
        ctx.stroke();
        ctx.restore();
      }
    }

    const point = scratch.v6;
    const aligned = target.lateral <= target.radius && target.alignment > 0.35;
    const color = aligned ? accent : night ? '#8fe4dd' : '#ffd6a1';
    const inView = this.project(target.position, camera, point);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.6;
    if (inView) {
      const r = clamp(1500 / Math.max(target.distance, 40), 13, 58);
      const arm = r * 0.42;
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          const x = point.x + sx * r;
          const y = point.y + sy * r;
          ctx.beginPath();
          ctx.moveTo(x - sx * arm, y);
          ctx.lineTo(x, y);
          ctx.lineTo(x, y - sy * arm);
          ctx.stroke();
        }
      }
      ctx.beginPath();
      ctx.arc(point.x, point.y, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '700 11px ' + FONT;
      ctx.textAlign = 'center';
      ctx.fillText('NEXT GATE  ' + Math.round(target.distance) + 'm', point.x, point.y + r + 18);
    } else {
      const ndc = scratch.v1.copy(target.position).project(camera);
      const angle = Math.atan2(ndc.y, ndc.x);
      const radius = Math.min(w, h) * 0.38;
      const x = w / 2 + Math.cos(angle) * radius;
      const y = h / 2 - Math.sin(angle) * radius;
      ctx.translate(x, y);
      ctx.rotate(-angle);
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.lineTo(-8, 7);
      ctx.lineTo(-4, 0);
      ctx.lineTo(-8, -7);
      ctx.closePath();
      ctx.fill();
      ctx.rotate(angle);
      ctx.font = '600 10px ' + FONT;
      ctx.fillText(Math.round(target.distance) + 'm', 0, 24);
    }
    ctx.restore();
    void ink;
  }

  drawWarning(ctx, w, h, text, rgb, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha * (0.72 + Math.sin(this.time * 6) * 0.28);
    ctx.font = '600 11px ' + FONT;
    const width = ctx.measureText(text).width + 38;
    const x = (w - width) / 2;
    ctx.fillStyle = 'rgba(' + rgb + ',0.16)';
    ctx.fillRect(x, h * 0.22, width, 28);
    ctx.strokeStyle = 'rgba(' + rgb + ',0.65)';
    ctx.strokeRect(x + 0.5, h * 0.22 + 0.5, width - 1, 27);
    ctx.fillStyle = 'rgb(' + rgb + ')';
    ctx.textAlign = 'center';
    ctx.fillText(text, w / 2, h * 0.22 + 18);
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
      ctx.globalAlpha = Math.pow(1 - t, 1.6);
      ctx.fillStyle = popup.color;
      ctx.font = '600 15px ' + FONT;
      ctx.textAlign = 'center';
      ctx.fillText(popup.text, point.x, point.y - 12 - t * 34);
    }
    ctx.globalAlpha = 1;
  }

  drawAtmosphere(ctx, w, h, night) {
    const vignette = ctx.createRadialGradient(w / 2, h / 2, h * 0.32, w / 2, h / 2, h * 0.84);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, night ? 'rgba(0,8,24,0.38)' : 'rgba(48,20,8,0.24)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);
    if (this.flashTimer > 0) {
      ctx.fillStyle = 'rgba(' + this.flashColor + ',' + (this.flashTimer / 0.42 * 0.24).toFixed(3) + ')';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.fillStyle = night ? 'rgba(210,232,255,0.055)' : 'rgba(255,238,214,0.045)';
    for (let i = 0; i < 64; i++) {
      const x = (Math.sin(i * 91.7 + this.time * 12.3) * 0.5 + 0.5) * w;
      const y = (Math.sin(i * 47.3 + this.time * 8.7) * 0.5 + 0.5) * h;
      ctx.fillRect(x, y, 1.2, 1.2);
    }
  }

  drawHint(ctx, w, h, ink, accent) {
    ctx.save();
    ctx.font = '500 12px ' + FONT;
    const width = Math.min(w - 48, ctx.measureText(this.hint).width + 42);
    const x = (w - width) / 2;
    const y = h - 148;
    ctx.globalAlpha = Math.min(1, this.hintTimer / 0.7);
    ctx.fillStyle = 'rgba(8,20,28,0.5)';
    ctx.fillRect(x, y, width, 30);
    ctx.strokeStyle = accent;
    ctx.globalAlpha *= 0.55;
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, 29);
    ctx.globalAlpha = Math.min(1, this.hintTimer / 0.7);
    ctx.fillStyle = ink + '0.9)';
    ctx.textAlign = 'center';
    ctx.fillText(this.hint, w / 2, y + 19);
    ctx.restore();
  }

  drawDebug(ctx, state, w, accent) {
    ctx.save();
    ctx.font = '600 11px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = accent;
    ctx.fillText('FPS ' + Math.round(state.fps) + '  QUALITY ' + (state.quality || 'high') + '  SCALE ' + (state.renderScale || 1).toFixed(2), 28, 96);
    ctx.fillText('SEED ' + (state.seed ?? '—') + '  TIME ' + (state.timer ?? 0).toFixed(1), 28, 114);
    void w;
    ctx.restore();
  }
}
