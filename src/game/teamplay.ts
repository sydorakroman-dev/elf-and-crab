/**
 * Team play between the hero and the familiar: the familiar's power meter and ultimate, combos
 * (the hero hitting what the familiar just stunned, slowed, yanked…), the familiar's pings, and
 * the highlights shown at the merchant's camp. Pure rules, unit tested; Game applies them.
 */
import type { FamiliarKind } from './familiars';

// ── The power meter ─────────────────────────────────────────────────────────────────────────────

export const METER = {
  max: 100,
  /** A spell that affected someone, and per extra foe it reached (up to `spellCap` in all). */
  spell: 8,
  perFoe: 2,
  spellCap: 16,
  /** Per 10 damage bitten. */
  bitePer10: 1,
  /** Saving the elf: a shield blocks a hit, or a heal / ward lands while the elf is low. */
  save: 15,
  combo: 10,
  loot: 1,
};

/** Below this share of max health, a familiar heal counts as a save. */
export const SAVE_HEALTH = 0.3;

/** The familiar's power meter: fills as it helps (never drains), spent on its ultimate. */
export class PowerMeter {
  value = 0;
  /** Bitten damage not yet turned into meter. */
  private bites = 0;

  get full(): boolean {
    return this.value >= METER.max;
  }

  add(n: number): void {
    this.value = Math.min(METER.max, this.value + Math.max(0, n));
  }

  /** A spell that reached `foes` enemies (0: one that helps the elf instead, e.g. a shield — still counts once). */
  spell(foes: number): void {
    this.add(Math.min(METER.spellCap, METER.spell + METER.perFoe * Math.max(0, foes - 1)));
  }

  bite(damage: number): void {
    this.bites += damage;
    const whole = Math.floor(this.bites / 10);
    this.bites -= whole * 10;
    this.add(whole * METER.bitePer10);
  }

  /** Spends a full meter; returns whether the ultimate may go off. */
  use(): boolean {
    if (!this.full) return false;
    this.value = 0;
    return true;
  }

  reset(): void {
    this.value = 0;
    this.bites = 0;
  }
}

// ── The ultimates ──────────────────────────────────────────────────────────────────────────────

export interface UltimateDef {
  name: string;
  icon: string;
  /** What it does, for the tablet's button. */
  description: string;
  /** Seconds it lasts. */
  seconds: number;
}

export const ULTIMATES: Record<FamiliarKind, UltimateDef> = {
  crab: { name: 'King Crab', icon: '👑', description: 'Grow giant! Slam the ground every second: foes nearby are stunned and hurt.', seconds: 6 },
  capybara: { name: 'Hot Spring Flood', icon: '🌊', description: 'A huge warm pool: foes in it slow down and calm, the elf heals in it.', seconds: 8 },
  wolf: { name: 'Moon Pack', icon: '🌕', description: 'Three spirit wolves hunt the foes nearby, and the elf shoots faster.', seconds: 8 },
  goldfish: { name: 'Tidal Wave', icon: '🌊', description: 'A great wave rolls ahead: knocks foes back, hurts and slows them.', seconds: 1.2 },
  iguana: { name: 'Jade Dragon', icon: '🐉', description: 'A roar roots every foe around, and the elf gets a 3-hit jade shield.', seconds: 3 },
};

/** The numbers behind each ultimate. */
export const ULT = {
  crab: { scale: 2.6, every: 1, radius: 6, damage: 25, stun: 1.2 },
  capybara: { radius: 10, slow: 0.4, heal: 4 },
  wolf: { wolves: 3, damage: 12, every: 0.6 },
  goldfish: { length: 20, width: 8, damage: 30, shove: 7, slow: 0.5, slowSeconds: 3 },
  iguana: { radius: 9, root: 3, shieldHits: 3 },
};

// ── Combos ──────────────────────────────────────────────────────────────────────────────────────

export const COMBO = {
  /** The hero's hit counts as a combo within this long of the familiar's spell affecting the foe. */
  window: 2.5,
  /** Combos within this long of each other chain (×2, ×3…). */
  chain: 4,
  /** Extra damage on a combo hit. */
  bonus: 0.3,
  /** A chain this long is a Super combo (it drops gold). */
  superAt: 5,
  superGold: 15,
};

/** Which foes the familiar's spells just affected, and the running chain of combos. */
export class ComboTracker {
  private readonly touched = new Map<number, number>();
  chain = 0;
  private last = -Infinity;
  /** Combos this level (for the highlights). */
  total = 0;

  /** The familiar's spell affected these foes at time `t`. */
  mark(ids: Iterable<number>, t: number): void {
    for (const id of ids) this.touched.set(id, t);
  }

  /** The hero hit foe `id` at time `t`: a combo? (Each spell gives one combo per foe.) */
  hit(id: number, t: number): { combo: false } | { combo: true; chain: number; super: boolean } {
    const at = this.touched.get(id);
    if (at === undefined || t - at > COMBO.window) return { combo: false };
    this.touched.delete(id);
    this.chain = t - this.last <= COMBO.chain ? this.chain + 1 : 1;
    this.last = t;
    this.total++;
    return { combo: true, chain: this.chain, super: this.chain === COMBO.superAt };
  }

  /** Forgets old marks (call now and then). */
  prune(t: number): void {
    for (const [id, at] of this.touched) if (t - at > COMBO.window) this.touched.delete(id);
  }

  reset(): void {
    this.touched.clear();
    this.chain = 0;
    this.last = -Infinity;
    this.total = 0;
  }
}

// ── Pings ───────────────────────────────────────────────────────────────────────────────────────

export type PingKind = 'look' | 'danger' | 'loot' | 'hearts';
export const PING_KINDS: PingKind[] = ['look', 'danger', 'loot', 'hearts']; // index = wire code

export const PINGS: Record<PingKind, { icon: string; label: string; color: number }> = {
  look: { icon: '👀', label: 'Look here!', color: 0x8fd8ff },
  danger: { icon: '⚠️', label: 'Danger!', color: 0xff6a5a },
  loot: { icon: '🎁', label: 'Loot here!', color: 0xffd36b },
  hearts: { icon: '❤️', label: '', color: 0xff8fb0 },
};

export const PING = {
  /** Seconds between pings (no spamming), and how long one shows. */
  every: 1.5,
  shows: 4,
};

/** Lets a ping through at most every PING.every seconds. */
export class PingLimiter {
  private last = -Infinity;
  allow(t: number): boolean {
    if (t - this.last < PING.every) return false;
    this.last = t;
    return true;
  }
}

// ── Highlights ──────────────────────────────────────────────────────────────────────────────────

/** What the familiar did this level. */
export interface FamiliarStats {
  stuns: number;
  saves: number;
  combos: number;
  gold: number;
  ultimates: number;
}

export function emptyStats(): FamiliarStats {
  return { stuns: 0, saves: 0, combos: 0, gold: 0, ultimates: 0 };
}

/** The title the familiar earned this level: for its best stat (weighted so each is about as easy to top). */
export function highlightTitle(s: FamiliarStats): { title: string; icon: string } {
  const scores: [number, string, string][] = [
    [s.saves * 4, 'Shield Hero', '🛡️'],
    [s.combos * 2, 'Combo Master', '⚡'],
    [s.stuns, 'Stun Star', '💫'],
    [s.gold / 15, 'Treasure Hunter', '🪙'],
    [s.ultimates * 5, 'Big Moment', '🌟'],
  ];
  const best = scores.reduce((a, b) => (b[0] > a[0] ? b : a));
  return best[0] > 0 ? { title: best[1], icon: best[2] } : { title: 'Best Buddy', icon: '💛' };
}
