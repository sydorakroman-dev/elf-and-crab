import { describe, expect, it } from 'vitest';
import { ELF_SPELLS, MAX_RANK, SPELL_KEYS, Spellbook, spellCost, spellTitle } from './spells';
import { mulberry32 } from '../util/rng';

describe('spellbook', () => {
  it('learns a new spell into the first free slot (keys 4–9)', () => {
    const b = new Spellbook();
    expect(b.learn('fire')).toEqual({ kind: 'learned', key: 'fire', slot: 3 });
    expect(b.learn('nova')).toEqual({ kind: 'learned', key: 'nova', slot: 4 });
    expect(b.inSlot(3)).toBe('fire');
    expect(b.inSlot(4)).toBe('nova');
    expect(b.inSlot(5)).toBeNull();
    expect(b.inSlot(0)).toBeNull(); // slots 1–3 are skills
  });

  it('ranks a known spell up to III, then no further', () => {
    const b = new Spellbook();
    b.learn('frost');
    expect(b.learn('frost')).toEqual({ kind: 'ranked', key: 'frost', rank: 2 });
    expect(b.learn('frost')).toEqual({ kind: 'ranked', key: 'frost', rank: 3 });
    expect(b.learn('frost')).toEqual({ kind: 'mastered' });
    expect(b.rank('frost')).toBe(MAX_RANK);
  });

  it('reading books fills the six slots, then only ranks up what you know', () => {
    const b = new Spellbook();
    const rng = mulberry32(3);
    for (let i = 0; i < 200; i++) b.read(rng);
    expect(b.known.length).toBe(6);
    expect(b.slots.every((k) => k !== null)).toBe(true);
    for (const k of b.known) expect(b.rank(k)).toBe(MAX_RANK);
    expect(b.read(rng)).toEqual({ kind: 'mastered' });
  });

  it('favours new spells while there is room', () => {
    const b = new Spellbook();
    const rng = mulberry32(9);
    for (let i = 0; i < 6; i++) b.read(rng);
    expect(b.known.length).toBeGreaterThanOrEqual(4);
  });

  it('has a name, icon and cost for every spell and rank', () => {
    for (const k of SPELL_KEYS) {
      for (let r = 1; r <= MAX_RANK; r++) {
        expect(spellCost(k, r)).toBeGreaterThan(0);
        expect(spellCost(k, r)).toBeLessThanOrEqual(100);
        expect(ELF_SPELLS[k].describe(r).length).toBeGreaterThan(10);
      }
    }
    expect(spellTitle('chain', 2)).toBe('Chain Shot II');
  });

  it('clears for a new run', () => {
    const b = new Spellbook();
    b.learn('bark');
    b.clear();
    expect(b.known).toEqual([]);
    expect(b.slots.every((k) => k === null)).toBe(true);
  });
});
