/** Tiny WebAudio synth for all game sound — effects and ambience, no audio files needed. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private fireGain: GainNode | null = null;
  private firePan: StereoPannerNode | null = null;
  private fireLevel = 0;
  private muted = false;

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.startAmbience();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  /**
   * Fire ambience: `level` 0..1 is how close the listener is to torches/braziers, `pan` -1..1 where
   * they are (left/right). Call every step; it also schedules random crackle pops.
   */
  setAmbience(level: number, pan: number, dt: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.fireGain || !this.firePan) return;
    this.fireLevel = level;
    this.fireGain.gain.setTargetAtTime(0.004 + level * 0.16, ctx.currentTime, 0.15);
    this.firePan.pan.setTargetAtTime(pan * 0.7, ctx.currentTime, 0.15);
    // Crackles: more (and louder) the closer the fire.
    if (Math.random() < dt * (1 + level * 11)) this.crackle();
  }

  /** Bowstring release. */
  twang(): void {
    this.tone('triangle', 220, 90, 0.12, 0.12);
    this.hiss(0.05, 0.05, 3000, 'lowpass');
  }

  hit(): void {
    this.tone('square', 320, 120, 0.08, 0.05);
  }

  splat(big: boolean): void {
    this.hiss(big ? 0.3 : 0.18, big ? 0.22 : 0.15, big ? 500 : 900, 'lowpass');
    this.tone('sine', big ? 160 : 240, 50, big ? 0.25 : 0.15, 0.15);
  }

  /** Wet "ptoo" from a spitter. */
  spit(): void {
    this.tone('sine', 520, 180, 0.14, 0.09);
    this.hiss(0.08, 0.06, 1800, 'bandpass');
  }

  hurt(): void {
    this.tone('sawtooth', 200, 60, 0.3, 0.12);
  }

  /** Boot on stone: a soft thud plus a short gritty scuff. */
  footstep(strength: number): void {
    const v = 0.35 + strength * 0.65;
    const pitch = 0.85 + Math.random() * 0.3;
    this.tone('sine', 110 * pitch, 50, 0.07, 0.09 * v);
    this.hiss(0.05, 0.05 * v, 1400 * pitch, 'lowpass');
  }

  /** Crab legs on stone: tiny high clicks. */
  scuttle(strength: number): void {
    const v = 0.4 + strength * 0.6;
    this.hiss(0.015, 0.035 * v, 3500 + Math.random() * 2500, 'highpass');
  }

  whoosh(): void {
    const ctx = this.ctx;
    if (!ctx || !this.noise || !this.master) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.5;
    filter.frequency.setValueAtTime(400, t);
    filter.frequency.exponentialRampToValueAtTime(2200, t + 0.18);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.26);
  }

  /** Rising arpeggio at the start of a wave. */
  wave(): void {
    [0, 4, 7, 12].forEach((semi, i) => {
      const f = 330 * Math.pow(2, semi / 12);
      this.tone('sine', f, f, 0.4, 0.12, i * 0.08);
    });
  }

  private startAmbience(): void {
    const ctx = this.ctx!;
    const master = this.master!;

    // Low room tone: the dungeon's hum.
    const room = this.loop();
    const roomFilter = ctx.createBiquadFilter();
    roomFilter.type = 'lowpass';
    roomFilter.frequency.value = 160;
    const roomGain = ctx.createGain();
    roomGain.gain.value = 0.06;
    room.connect(roomFilter).connect(roomGain).connect(master);

    // Fire bed: band-passed noise with a slow flutter, panned toward the nearest fire.
    const fire = this.loop();
    const fireFilter = ctx.createBiquadFilter();
    fireFilter.type = 'bandpass';
    fireFilter.frequency.value = 700;
    fireFilter.Q.value = 0.5;
    this.fireGain = ctx.createGain();
    this.fireGain.gain.value = 0;
    this.firePan = ctx.createStereoPanner();
    const flutter = ctx.createOscillator();
    flutter.frequency.value = 5.3;
    const flutterDepth = ctx.createGain();
    flutterDepth.gain.value = 250;
    flutter.connect(flutterDepth).connect(fireFilter.frequency);
    flutter.start();
    fire.connect(fireFilter).connect(this.fireGain).connect(this.firePan).connect(master);
  }

  private loop(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start(0, Math.random() * 2);
    return src;
  }

  private crackle(): void {
    const ctx = this.ctx;
    if (!ctx || !this.noise || !this.firePan) return;
    const t = ctx.currentTime;
    const dur = 0.008 + Math.random() * 0.025;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1800 + Math.random() * 3000;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime((0.01 + this.fireLevel * 0.14) * (0.4 + Math.random() * 0.6), t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(gain).connect(this.firePan);
    src.start(t, Math.random() * 1.9);
    src.stop(t + dur);
  }

  private tone(type: OscillatorType, from: number, to: number, dur: number, vol: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private hiss(dur: number, vol: number, cutoff: number, type: BiquadFilterType): void {
    const ctx = this.ctx;
    if (!ctx || !this.noise || !this.master) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = cutoff;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur);
  }
}
