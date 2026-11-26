// Every sound in Halcyon is synthesised with Web Audio. The context is only
// created after the first user gesture, which is also the launch click.
const CHIME = [523.25, 587.33, 659.25, 783.99, 880, 987.77, 1046.5, 1174.66, 1318.51];

export class SfxEngine {
  constructor(volume = 0.72) {
    this.ctx = null;
    this.muted = false;
    this.volume = volume;
    this.ready = false;
    this.ringIndex = 0;
    this.lastStall = 0;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    try {
      const ctx = new AudioCtx();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.ratio.value = 6;
      this.master.connect(compressor);
      compressor.connect(ctx.destination);

      this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < data.length; i++) {
        const white = Math.random() * 2 - 1;
        last = last * 0.86 + white * 0.14;
        data[i] = last;
      }

      this.engineGain = ctx.createGain();
      this.engineGain.gain.value = 0;
      this.engineFilter = ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 320;
      this.engineFilter.Q.value = 1.4;
      this.engineGain.connect(this.engineFilter).connect(this.master);
      this.oscA = ctx.createOscillator();
      this.oscB = ctx.createOscillator();
      this.oscA.type = 'sawtooth';
      this.oscB.type = 'triangle';
      this.oscA.frequency.value = 66;
      this.oscB.frequency.value = 99;
      const aGain = ctx.createGain();
      const bGain = ctx.createGain();
      aGain.gain.value = 0.6;
      bGain.gain.value = 0.22;
      this.oscA.connect(aGain).connect(this.engineGain);
      this.oscB.connect(bGain).connect(this.engineGain);
      this.oscA.start();
      this.oscB.start();

      this.wind = ctx.createBufferSource();
      this.wind.buffer = this.noiseBuffer;
      this.wind.loop = true;
      this.windFilter = ctx.createBiquadFilter();
      this.windFilter.type = 'bandpass';
      this.windFilter.frequency.value = 720;
      this.windFilter.Q.value = 0.55;
      this.windGain = ctx.createGain();
      this.windGain.gain.value = 0;
      this.wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
      this.wind.start();

      this.padGain = ctx.createGain();
      this.padGain.gain.value = 0.028;
      this.padFilter = ctx.createBiquadFilter();
      this.padFilter.type = 'lowpass';
      this.padFilter.frequency.value = 640;
      this.padGain.connect(this.padFilter).connect(this.master);
      this.padOsc = [];
      for (const [freq, detune] of [[146.83, -6], [220, 5], [293.66, 9]]) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.detune.value = detune;
        const gain = ctx.createGain();
        gain.gain.value = 0.32;
        osc.connect(gain).connect(this.padGain);
        osc.start();
        this.padOsc.push(osc);
      }
      this.ready = true;
    } catch (error) {
      void error;
      this.ctx = null;
      this.ready = false;
    }
  }

  setVolume(value) {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.ready) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.08);
  }

  setMuted(muted) {
    this.muted = !!muted;
    if (this.ready) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.06);
  }

  setEngine(throttle, speed, boost, brake) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const rpm = 54 + throttle * 104 + (boost ? 38 : 0) - (brake ? 16 : 0);
    this.oscA.frequency.setTargetAtTime(rpm, t, 0.09);
    this.oscB.frequency.setTargetAtTime(rpm * 1.502, t, 0.09);
    this.engineFilter.frequency.setTargetAtTime(260 + throttle * 720 + (boost ? 480 : 0), t, 0.12);
    this.engineGain.gain.setTargetAtTime(0.07 + throttle * 0.12 + (boost ? 0.08 : 0), t, 0.12);
    const windLevel = Math.max(0, Math.min(0.3, (speed - 52) / 430));
    this.windGain.gain.setTargetAtTime(windLevel, t, 0.18);
    this.windFilter.frequency.setTargetAtTime(480 + speed * 7.4, t, 0.22);
  }

  setAmbient(phase) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const shift = 1 - phase * 0.22;
    for (let i = 0; i < this.padOsc.length; i++) {
      const base = [146.83, 220, 293.66][i] * shift;
      this.padOsc[i].frequency.setTargetAtTime(base, t, 1.4);
    }
    this.padFilter.frequency.setTargetAtTime(700 - phase * 260, t, 1.2);
    this.padGain.gain.setTargetAtTime(0.028 + phase * 0.012, t, 1.2);
  }

  noiseBurst(duration, volume, filterType, freq, sweepTo, q = 1) {
    if (!this.ready) return null;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(freq, t);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t + duration);
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(t);
    source.stop(t + duration + 0.02);
    return { source, filter, gain };
  }

  tone(freq, duration, volume, type = 'sine', sweepTo = 0, delay = 0) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + duration);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.03);
  }

  ring(combo = 1) {
    if (!this.ready) return;
    const note = CHIME[Math.min(CHIME.length - 1, Math.max(0, combo - 1))];
    this.tone(note, 0.26, 0.14, 'sine');
    this.tone(note * 1.5, 0.42, 0.075, 'sine', 0, 0.045);
    this.tone(note * 2, 0.5, 0.035, 'triangle', 0, 0.09);
    this.ringIndex++;
  }

  lantern() {
    this.tone(1174.66, 0.22, 0.1, 'sine');
    this.tone(1567.98, 0.38, 0.06, 'sine', 0, 0.06);
  }

  updraft() {
    this.noiseBurst(0.45, 0.06, 'bandpass', 900, 1800, 1.6);
  }

  stall() {
    if (!this.ready || this.ctx.currentTime - this.lastStall < 1.7) return;
    this.lastStall = this.ctx.currentTime;
    this.tone(330, 0.16, 0.085, 'triangle', 240);
    this.tone(330, 0.16, 0.085, 'triangle', 240, 0.24);
  }

  storm() {
    this.noiseBurst(0.22, 0.11, 'bandpass', 2400, 700, 0.7);
  }

  thunder() {
    this.noiseBurst(0.9, 0.2, 'lowpass', 700, 70, 1.2);
    this.tone(74, 0.85, 0.17, 'sine', 38);
  }

  crash() {
    this.noiseBurst(0.42, 0.2, 'lowpass', 1200, 160, 0.8);
    this.tone(110, 0.34, 0.14, 'sine', 48);
  }

  ui() {
    this.tone(740, 0.08, 0.075, 'triangle', 1040);
  }
}
