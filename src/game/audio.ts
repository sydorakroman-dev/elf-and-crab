/** Tiny WebAudio synth for game sounds — no audio files needed. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock(): void {
    this.ctx ??= new AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (!this.noise) {
      const len = this.ctx.sampleRate * 0.3;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
  }

  /** Bowstring release. */
  twang(): void {
    this.tone('triangle', 220, 90, 0.12, 0.12);
    this.hiss(0.05, 0.05, 3000);
  }

  hit(): void {
    this.tone('square', 320, 120, 0.08, 0.05);
  }

  splat(big: boolean): void {
    this.hiss(big ? 0.3 : 0.18, big ? 0.22 : 0.15, big ? 500 : 900);
    this.tone('sine', big ? 160 : 240, 50, big ? 0.25 : 0.15, 0.15);
  }

  hurt(): void {
    this.tone('sawtooth', 200, 60, 0.3, 0.12);
  }

  /** Rising arpeggio at the start of a wave. */
  wave(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    [0, 4, 7, 12].forEach((semi, i) => this.tone('sine', 330 * Math.pow(2, semi / 12), 330 * Math.pow(2, semi / 12), 0.4, 0.12, i * 0.08));
  }

  private tone(type: OscillatorType, from: number, to: number, dur: number, vol: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private hiss(dur: number, vol: number, cutoff: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.noise) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t);
    src.stop(t + dur);
  }
}
