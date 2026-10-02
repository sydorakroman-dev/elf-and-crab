/**
 * Background music, composed in code (no audio files): a looping theme per room — bass, melody,
 * a soft pad and percussion in that room's key and tempo — and a faster, heavier boss version
 * while a boss is on the field. Notes are scheduled a little ahead on the WebAudio clock.
 */

/** One room's theme. Notes are semitones from the root; null is a rest. Each bar is 8 steps. */
interface Theme {
  /** Root note, MIDI. */
  root: number;
  bpm: number;
  /** Lead line, one entry per step (4 bars × 8 steps). */
  lead: (number | null)[];
  /** Bass, one entry per bar. */
  bass: number[];
  /** Pad chord per bar (semitones), played as a soft sustained chord. */
  pads: number[][];
  /** Percussion pattern per step: k kick, s snare, h hat, '.' none. */
  drums: string;
  /** Lead voice. */
  wave: OscillatorType;
}

const _ = null;
const minor = [0, 3, 7];
const major = [0, 4, 7];

/** Themes by room index (Woodland, Crystal Cave, Crypt, Throne Room, Flooded Hall, Lava Chamber, Lair). */
const THEMES: Theme[] = [
  // Woodland: bright, folksy, in D major.
  {
    root: 62, bpm: 104, wave: 'triangle',
    lead: [0, _, 4, 7, 9, _, 7, 4, 5, _, 4, 2, 0, _, _, _, 0, _, 4, 7, 12, _, 11, 9, 7, _, 5, 4, 2, _, _, _],
    bass: [0, 5, 7, 0], pads: [major, [5, 9, 12], [7, 11, 14], major], drums: 'k.h.s.h.k.h.s.hh',
  },
  // Crystal Cave: shimmering, sparse, E minor.
  {
    root: 64, bpm: 92, wave: 'sine',
    lead: [12, _, 7, _, 15, _, 14, _, 12, _, _, 7, 10, _, _, _, 12, _, 7, _, 19, _, 17, _, 15, _, 14, _, 12, _, _, _],
    bass: [0, 8, 3, 7], pads: [minor, [8, 12, 15], [3, 7, 10], [7, 10, 14]], drums: 'k...h...k.h.h...',
  },
  // Crypt: slow and eerie, C minor.
  {
    root: 60, bpm: 78, wave: 'sine',
    lead: [0, _, _, 3, 2, _, _, _, 0, _, _, 8, 7, _, _, _, 0, _, _, 3, 6, _, 5, _, 3, _, 2, _, 0, _, _, _],
    bass: [0, 8, 5, 7], pads: [minor, [8, 12, 15], [5, 8, 12], [7, 11, 14]], drums: 'k.......s.......',
  },
  // Throne Room: martial, G minor.
  {
    root: 55, bpm: 112, wave: 'sawtooth',
    lead: [7, 7, 10, _, 12, _, 10, 7, 5, _, 7, _, 3, _, _, _, 7, 7, 10, _, 15, _, 14, 12, 10, _, 12, _, 7, _, _, _],
    bass: [0, 3, 5, 7], pads: [minor, [3, 7, 10], [5, 8, 12], [7, 11, 14]], drums: 'k.k.s.h.k.k.s.hs',
  },
  // Flooded Hall: rolling, A minor.
  {
    root: 57, bpm: 96, wave: 'triangle',
    lead: [0, 3, 7, 3, 0, 3, 7, 10, 8, 7, 5, 3, 2, _, _, _, 0, 3, 7, 12, 10, 7, 5, 7, 3, 2, 0, -2, 0, _, _, _],
    bass: [0, 8, 5, 7], pads: [minor, [8, 12, 15], [5, 8, 12], [7, 10, 14]], drums: 'k..hs..hk.h.s..h',
  },
  // Lava Chamber: driving, F minor.
  {
    root: 53, bpm: 124, wave: 'sawtooth',
    lead: [0, _, 0, 3, 5, _, 3, 0, 8, _, 7, 5, 3, _, _, _, 0, _, 0, 3, 5, _, 8, 7, 10, _, 8, 7, 5, _, _, _],
    bass: [0, 0, 8, 7], pads: [minor, minor, [8, 12, 15], [7, 11, 14]], drums: 'k.hkk.h.k.hkk.hs',
  },
  // The Ash King's Lair: ominous, D minor (mostly heard as boss music).
  {
    root: 50, bpm: 132, wave: 'sawtooth',
    lead: [0, 1, 0, _, 3, _, 1, 0, 7, 6, 5, _, 3, _, 1, _, 0, 1, 0, _, 8, 7, 6, 5, 3, _, 1, _, 0, _, _, _],
    bass: [0, 1, 8, 7], pads: [minor, [1, 5, 8], [8, 12, 15], [7, 11, 14]], drums: 'kkhkskhkkkhkskhs',
  },
];

const LOOKAHEAD = 0.25; // seconds of notes scheduled ahead
const midiHz = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export class Music {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private theme: Theme | null = null;
  private boss = false;
  private step = 0;
  private nextTime = 0;
  private enabled = true;

  /** Hooks the music into the game's audio (after the user's first tap / click). */
  attach(ctx: AudioContext, destination: AudioNode, noise: AudioBuffer): void {
    if (this.ctx) return;
    this.ctx = ctx;
    this.noise = noise;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(destination);
  }

  /** Room `room`'s theme (or silence for -1); `boss`: the faster, heavier version. Fades between them. */
  play(room: number, boss: boolean): void {
    const theme = room >= 0 ? THEMES[Math.min(room, THEMES.length - 1)] : null;
    if (theme === this.theme && boss === this.boss) return;
    const restart = theme !== this.theme;
    this.theme = theme;
    this.boss = boss;
    if (!this.ctx || !this.out) return;
    this.out.gain.setTargetAtTime(theme && this.enabled ? 0.55 : 0, this.ctx.currentTime, 0.6);
    if (restart) {
      this.step = 0;
      this.nextTime = this.ctx.currentTime + 0.1;
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.ctx && this.out) this.out.gain.setTargetAtTime(on && this.theme ? 0.55 : 0, this.ctx.currentTime, 0.2);
  }

  /** Schedules the notes coming up; call every frame. */
  update(): void {
    const ctx = this.ctx;
    const t = this.theme;
    if (!ctx || !t || !this.out) return;
    if (this.nextTime < ctx.currentTime - 0.5) this.nextTime = ctx.currentTime + 0.05; // after a pause
    const stepLen = 60 / (t.bpm * (this.boss ? 1.18 : 1)) / 2; // eighth notes
    while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
      this.playStep(t, this.step, this.nextTime, stepLen);
      this.nextTime += stepLen;
      this.step = (this.step + 1) % 32;
    }
  }

  private playStep(t: Theme, step: number, when: number, len: number): void {
    const bar = Math.floor(step / 8);
    const root = t.root;
    // Pad + bass at the start of each bar.
    if (step % 8 === 0) {
      for (const n of t.pads[bar]) this.note('sine', midiHz(root - 12 + n), when, len * 8, 0.035);
      this.note(this.boss ? 'sawtooth' : 'triangle', midiHz(root - 24 + t.bass[bar]), when, len * 3.5, this.boss ? 0.12 : 0.14);
    }
    // In boss mode the bass pulses on every quarter.
    if (this.boss && step % 2 === 0 && step % 8 !== 0) this.note('sawtooth', midiHz(root - 24 + t.bass[bar]), when, len * 1.5, 0.08);
    const lead = t.lead[step];
    if (lead !== null) this.note(t.wave, midiHz(root + lead + (this.boss ? 12 : 0)), when, len * 1.6, t.wave === 'sawtooth' ? 0.045 : 0.07);
    // Drums (boss: busier — a hat on every step).
    const d = t.drums[step % 16];
    if (d === 'k') this.kick(when);
    if (d === 's') this.snare(when);
    if (d === 'h' || (this.boss && d === '.')) this.hat(when, this.boss ? 0.035 : 0.025);
  }

  private note(type: OscillatorType, hz: number, when: number, dur: number, vol: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = hz;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vol, when + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0008, when + dur);
    if (type === 'sawtooth') {
      // Soften the buzz.
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1800;
      osc.connect(lp).connect(g);
    } else osc.connect(g);
    g.connect(this.out!);
    osc.start(when);
    osc.stop(when + dur + 0.05);
  }

  private kick(when: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.setValueAtTime(140, when);
    osc.frequency.exponentialRampToValueAtTime(42, when + 0.14);
    g.gain.setValueAtTime(0.32, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.22);
    osc.connect(g).connect(this.out!);
    osc.start(when);
    osc.stop(when + 0.25);
  }

  private snare(when: number): void {
    this.noiseHit(when, 0.16, 0.16, 1800, 'bandpass');
  }

  private hat(when: number, vol: number): void {
    this.noiseHit(when, 0.04, vol, 7000, 'highpass');
  }

  private noiseHit(when: number, dur: number, vol: number, freq: number, type: BiquadFilterType): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + dur);
    src.connect(f).connect(g).connect(this.out!);
    src.start(when, Math.random());
    src.stop(when + dur + 0.02);
  }
}
