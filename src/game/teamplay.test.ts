import { describe, expect, it } from 'vitest';
import { COMBO, ComboTracker, METER, PING, PingLimiter, PowerMeter, ULTIMATES, emptyStats, highlightTitle } from './teamplay';
import { FAMILIAR_KINDS } from './familiars';

describe('the power meter', () => {
  it('fills from spells (more for more foes, capped), bites, saves, combos and loot — and never past full', () => {
    const m = new PowerMeter();
    m.spell(1);
    expect(m.value).toBe(METER.spell);
    m.spell(20); // capped
    expect(m.value).toBe(METER.spell + METER.spellCap);
    m.bite(7);
    m.bite(7); // 14 damage → 1
    expect(m.value).toBe(METER.spell + METER.spellCap + 1);
    m.add(METER.save + METER.combo + METER.loot);
    expect(m.full).toBe(false);
    m.add(1000);
    expect(m.value).toBe(METER.max);
    expect(m.full).toBe(true);
  });

  it('is spent only when full', () => {
    const m = new PowerMeter();
    m.add(50);
    expect(m.use()).toBe(false);
    expect(m.value).toBe(50);
    m.add(50);
    expect(m.use()).toBe(true);
    expect(m.value).toBe(0);
  });

  it('every creature has an ultimate', () => {
    for (const k of FAMILIAR_KINDS) expect(ULTIMATES[k].name).toBeTruthy();
  });
});

describe('combos', () => {
  it('a hero hit on a foe the familiar just affected is a combo (once per spell); too late is not', () => {
    const c = new ComboTracker();
    c.mark([1, 2], 10);
    expect(c.hit(1, 11)).toEqual({ combo: true, chain: 1, super: false });
    expect(c.hit(1, 11.5)).toEqual({ combo: false }); // used up
    expect(c.hit(2, 10 + COMBO.window + 0.1)).toEqual({ combo: false }); // too late
    expect(c.hit(3, 11)).toEqual({ combo: false }); // never touched
  });

  it('chains combos close together, and calls the fifth a Super combo', () => {
    const c = new ComboTracker();
    c.mark([1, 2, 3, 4, 5, 6], 0);
    const chains = [1, 2, 3, 4, 5].map((id, i) => c.hit(id, i * 0.5));
    expect(chains.map((h) => (h.combo ? h.chain : 0))).toEqual([1, 2, 3, 4, 5]);
    expect(chains[4]).toEqual({ combo: true, chain: 5, super: true });
    c.mark([7], 10);
    expect(c.hit(7, 10 + 0.1)).toMatchObject({ chain: 1 }); // more than COMBO.chain since the last: starts over
    expect(c.total).toBe(6);
  });
});

describe('pings and highlights', () => {
  it('lets a ping through at most every 1.5 s', () => {
    const p = new PingLimiter();
    expect(p.allow(0)).toBe(true);
    expect(p.allow(1)).toBe(false);
    expect(p.allow(PING.every)).toBe(true);
  });

  it('names the familiar for its best work', () => {
    expect(highlightTitle(emptyStats()).title).toBe('Best Buddy');
    expect(highlightTitle({ ...emptyStats(), saves: 3, stuns: 5 }).title).toBe('Shield Hero');
    expect(highlightTitle({ ...emptyStats(), combos: 8, stuns: 6 }).title).toBe('Combo Master');
    expect(highlightTitle({ ...emptyStats(), gold: 300 }).title).toBe('Treasure Hunter');
  });
});
