// Every sound in Skyward Ace is generated with the Web Audio API.
// The context is created on the first click, which is also the launch input.
export class SfxEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.lockBeepAt = 0;
    this.ready = false;
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
      this.master.gain.value = 0.72;
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -16;
      compressor.ratio.value = 7;
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

      // Layered engine core: two detuned saws through a moving low-pass filter.
      this.engineGain = ctx.createGain();
      this.engineGain.gain.value = 0;
      this.engineFilter = ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 300;
      this.engineFilter.Q.value = 1.6;
      this.engineGain.connect(this.engineFilter);
      this.engineFilter.connect(this.master);
      this.oscA = ctx.createOscillator();
      this.oscB = ctx.createOscillator();
      this.oscA.type = 'sawtooth';
      this.oscB.type = 'square';
      this.oscA.frequency.value = 62;
      this.oscB.frequency.value = 93;
      const aGain = ctx.createGain();
      const bGain = ctx.createGain();
      aGain.gain.value = 0.7;
      bGain.gain.value = 0.18;
      this.oscA.connect(aGain).connect(this.engineGain);
      this.oscB.connect(bGain).connect(this.engineGain);
      this.oscA.start();
      this.oscB.start();

      // Wind rush: filtered looping noise whose gain follows airspeed.
      this.wind = ctx.createBufferSource();
      this.wind.buffer = this.noiseBuffer;
      this.wind.loop = true;
      this.windFilter = ctx.createBiquadFilter();
      this.windFilter.type = 'bandpass';
      this.windFilter.frequency.value = 700;
      this.windFilter.Q.value = 0.55;
      this.windGain = ctx.createGain();
      this.windGain.gain.value = 0;
      this.wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
      this.wind.start();
      this.ready = true;
      if (this.muted) this.master.gain.value = 0;
    } catch (error) {
      this.ctx = null;
    }
  }

  setMuted(muted) {
    this.muted = muted;
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(muted ? 0 : 0.72, this.ctx.currentTime, 0.05);
  }

  setEngine(throttle, speed, boost, brake) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const rpm = 48 + throttle * 108 + (boost ? 34 : 0) - (brake ? 18 : 0);
    this.oscA.frequency.setTargetAtTime(rpm, t, 0.09);
    this.oscB.frequency.setTargetAtTime(rpm * 1.503, t, 0.09);
    this.engineFilter.frequency.setTargetAtTime(240 + throttle * 700 + (boost ? 460 : 0), t, 0.12);
    this.engineGain.gain.setTargetAtTime(0.09 + throttle * 0.14 + (boost ? 0.09 : 0), t, 0.12);
    const windLevel = Math.min(0.32, Math.max(0, (speed - 45) / 420));
    this.windGain.gain.setTargetAtTime(windLevel, t, 0.16);
    this.windFilter.frequency.setTargetAtTime(520 + speed * 7.2, t, 0.2);
  }

  noiseBurst(duration, volume, filterType, freq, sweepTo, filterQ = 1) {
    if (!this.ready) return null;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(freq, t);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t + duration);
    filter.Q.value = filterQ;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(t);
    source.stop(t + duration + 0.02);
    return { source, filter, gain };
  }

  tone(freq, duration, volume, type = 'sine', sweepTo = 0) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + duration);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  cannon() {
    this.noiseBurst(0.11, 0.34, 'bandpass', 1800, 240, 0.8);
    this.tone(148, 0.095, 0.19, 'square', 55);
  }

  missile() {
    this.noiseBurst(0.85, 0.28, 'bandpass', 260, 3400, 1.2);
    this.tone(210, 0.5, 0.14, 'sawtooth', 780);
  }

  lockTone() {
    if (!this.ctx || this.ctx.currentTime - this.lockBeepAt < 0.16) return;
    this.lockBeepAt = this.ctx.currentTime;
    this.tone(1240, 0.055, 0.09, 'sine');
  }

  lockComplete() {
    this.tone(1560, 0.12, 0.13, 'sine');
    this.tone(2080, 0.16, 0.08, 'sine');
  }

  explosion(big = false) {
    this.noiseBurst(big ? 1.1 : 0.55, big ? 0.52 : 0.34, 'lowpass', big ? 900 : 1400, 70, 1.1);
    this.tone(big ? 92 : 132, big ? 0.75 : 0.4, big ? 0.32 : 0.2, 'sine', 32);
  }

  hit() {
    this.noiseBurst(0.08, 0.2, 'highpass', 2200, 900, 0.7);
  }

  ring() {
    this.tone(880, 0.1, 0.12, 'sine');
    this.tone(1320, 0.18, 0.1, 'sine');
  }

  alarm() {
    this.tone(430, 0.16, 0.11, 'square', 300);
  }

  ui() {
    this.tone(720, 0.07, 0.1, 'triangle', 1100);
  }

  splash() {
    this.noiseBurst(0.42, 0.18, 'lowpass', 2600, 180, 0.6);
  }
}
