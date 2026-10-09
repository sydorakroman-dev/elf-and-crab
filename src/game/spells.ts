/**
 * The elf's spells, learned from spell books dropped by monsters: what each does at ranks I–III,
 * and the spellbook (which spells are known, at what rank, in which action slot). Spells cost
 * mana. Pure data and rules, unit tested; Game applies the effects.
 */

export type SpellKey = 'fire' | 'frost' | 'chain' | 'volley' | 'roots' | 'nova' | 'bloom' | 'bark';
export const SPELL_KEYS: SpellKey[] = ['fire', 'frost', 'chain', 'volley', 'roots', 'nova', 'bloom', 'bark'];
export const MAX_RANK = 3;
/** Spells go in action slots 4–12 (indices 3–11), sharing them with the skill tree's actives. */
export const FIRST_SPELL_SLOT = 3;
export const SPELL_SLOTS = 9;

export interface ElfSpellDef {
  name: string;
  icon: string;
  color: number;
  /** Mana per cast at ranks I, II, III. */
  cost: [number, number, number];
  /** What it does, per rank (for the tooltip and toasts). */
  describe: (rank: number) => string;
}

/** Numbers per rank (index rank − 1). */
export const SPELL_POWER = {
  /** Fire Arrows: shots enchanted, blast radius, blast damage. */
  fire: { shots: [3, 4, 5], radius: [2.5, 3, 3.5], damage: [14, 20, 26] },
  /** Frost Arrows: shots enchanted, slow (factor, seconds); rank III also freezes briefly. */
  frost: { shots: [3, 4, 5], slow: [0.5, 0.45, 0.4], seconds: [3, 3.5, 4], freeze: [0, 0, 1.2] },
  /** Chain Shot: shots enchanted, extra enemies the bolt jumps to, its reach and damage share. */
  chain: { shots: [3, 4, 5], jumps: [2, 3, 4], reach: 9, share: [0.6, 0.7, 0.8] },
  /** Arcane Volley: arrows in the fan. */
  volley: { arrows: [7, 9, 11], spread: 0.16 },
  /** Entangling Roots: where (m ahead), radius, seconds rooted. */
  roots: { ahead: 10, radius: [4, 5, 6], seconds: [2, 2.5, 3] },
  /** Frost Nova: radius around the elf, seconds frozen, damage. */
  nova: { radius: [6, 7, 8], seconds: [1.5, 2, 2.5], damage: [10, 15, 20] },
  /** Healing Bloom: health over `seconds`. */
  bloom: { heal: [30, 40, 50], seconds: 5 },
  /** Bark Skin: share of damage taken away, for `seconds`. */
  bark: { reduce: [0.4, 0.5, 0.6], seconds: 6 },
};

const P = SPELL_POWER;
const roman = (r: number) => ['I', 'II', 'III'][r - 1] ?? '';

export const ELF_SPELLS: Record<SpellKey, ElfSpellDef> = {
  fire: { name: 'Fire Arrows', icon: '🔥', color: 0xff7a2a, cost: [20, 22, 24], describe: (r) => `Your next ${P.fire.shots[r - 1]} shots explode on hit (${P.fire.damage[r - 1]} damage around).` },
  frost: {
    name: 'Frost Arrows',
    icon: '❄️',
    color: 0x9fe4ff,
    cost: [20, 22, 24],
    describe: (r) => `Your next ${P.frost.shots[r - 1]} shots chill foes (${Math.round((1 - P.frost.slow[r - 1]) * 100)}% slower)${r === 3 ? ' and freeze them for a moment' : ''}.`,
  },
  chain: { name: 'Chain Shot', icon: '⚡', color: 0xfff27a, cost: [30, 32, 34], describe: (r) => `Your next ${P.chain.shots[r - 1]} shots arc lightning to ${P.chain.jumps[r - 1]} more foes.` },
  volley: { name: 'Arcane Volley', icon: '✨', color: 0xc79bff, cost: [45, 48, 50], describe: (r) => `Loose a fan of ${P.volley.arrows[r - 1]} arcane arrows at once.` },
  roots: { name: 'Entangling Roots', icon: '🌿', color: 0x6fdc5a, cost: [30, 30, 30], describe: (r) => `Roots grab every foe in a ${P.roots.radius[r - 1]} m circle ahead for ${P.roots.seconds[r - 1]} s.` },
  nova: { name: 'Frost Nova', icon: '🧊', color: 0xbff0ff, cost: [35, 38, 40], describe: (r) => `Freeze every foe within ${P.nova.radius[r - 1]} m for ${P.nova.seconds[r - 1]} s (${P.nova.damage[r - 1]} damage).` },
  bloom: { name: 'Healing Bloom', icon: '💚', color: 0x7dff8a, cost: [40, 40, 40], describe: (r) => `Heal ${P.bloom.heal[r - 1]} health over ${P.bloom.seconds} s.` },
  bark: { name: 'Bark Skin', icon: '🌳', color: 0xb98a4a, cost: [35, 35, 35], describe: (r) => `Take ${Math.round(P.bark.reduce[r - 1] * 100)}% less damage for ${P.bark.seconds} s.` },
};

export function spellTitle(key: SpellKey, rank: number): string {
  return `${ELF_SPELLS[key].name} ${roman(rank)}`;
}

export function spellCost(key: SpellKey, rank: number): number {
  return ELF_SPELLS[key].cost[Math.max(1, Math.min(MAX_RANK, rank)) - 1];
}

/** What reading a spell book did. */
export type BookResult = { kind: 'learned'; key: SpellKey; slot: number } | { kind: 'ranked'; key: SpellKey; rank: number } | { kind: 'mastered' };

/** The spells the elf knows this run, their ranks, and which action slot each sits in. */
export class Spellbook {
  private readonly ranks = new Map<SpellKey, number>();
  /** Slot contents for action slots 4–12. */
  readonly slots: (SpellKey | null)[] = Array(SPELL_SLOTS).fill(null);
  /** Action slots taken by something else (the skill tree's actives): spells skip them. */
  blocked: (slot: number) => boolean = () => false;

  /** The first slot (index into `slots`) a new spell can go in, or −1. */
  private freeSlot(): number {
    return this.slots.findIndex((k, i) => k === null && !this.blocked(i + FIRST_SPELL_SLOT));
  }

  rank(key: SpellKey): number {
    return this.ranks.get(key) ?? 0;
  }

  get known(): SpellKey[] {
    return [...this.ranks.keys()];
  }

  /** The spell in action slot `slot` (0-based over all the slots), if any. */
  inSlot(slot: number): SpellKey | null {
    return this.slots[slot - FIRST_SPELL_SLOT] ?? null;
  }

  /** Reads a spell book: a new spell (into the first free slot), or a rank up for one you know. */
  read(rng: () => number): BookResult {
    const open = SPELL_KEYS.filter((k) => this.rank(k) < MAX_RANK);
    if (!open.length) return { kind: 'mastered' };
    // New spells come first while there's room for them; then rank-ups.
    const fresh = open.filter((k) => this.rank(k) === 0);
    const free = this.freeSlot();
    const pool = fresh.length && free >= 0 && rng() < 0.7 ? fresh : open.filter((k) => this.rank(k) > 0 || free >= 0);
    const key = (pool.length ? pool : open)[Math.floor(rng() * (pool.length ? pool : open).length)];
    return this.learn(key);
  }

  /** Learns `key` (or ranks it up). */
  learn(key: SpellKey): BookResult {
    const r = this.rank(key);
    if (r >= MAX_RANK) return { kind: 'mastered' };
    if (r > 0) {
      this.ranks.set(key, r + 1);
      return { kind: 'ranked', key, rank: r + 1 };
    }
    const free = this.freeSlot();
    if (free < 0) return { kind: 'mastered' };
    this.ranks.set(key, 1);
    this.slots[free] = key;
    return { kind: 'learned', key, slot: free + FIRST_SPELL_SLOT };
  }

  clear(): void {
    this.ranks.clear();
    this.slots.fill(null);
  }

  /** Network / save form: [key index, rank] per slot (0 = empty). */
  encode(): number[] {
    return this.slots.map((k) => (k ? SPELL_KEYS.indexOf(k) * 4 + this.rank(k) : -1));
  }
}
