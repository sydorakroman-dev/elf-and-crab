import { describe, expect, it } from 'vitest';
import { FAMILIARS, FAMILIAR_KINDS, JET, POUNCE_RANGE, SPELLS, SPELL_IDS, inJet, SpellCooldowns, distanceToSegment, pounceLanding } from './familiars';

describe('familiar roster', () => {
  it('has five creatures with distinct speeds and valid spells', () => {
    expect(FAMILIAR_KINDS).toEqual(['crab', 'capybara', 'wolf', 'goldfish', 'iguana']);
    const speeds = FAMILIAR_KINDS.map((k) => FAMILIARS[k].speed);
    expect(new Set(speeds).size).toBe(5);
    expect(FAMILIARS.wolf.speed).toBeGreaterThan(FAMILIARS.crab.speed);
    expect(FAMILIARS.crab.speed).toBeGreaterThan(FAMILIARS.capybara.speed);
    for (const k of FAMILIAR_KINDS) for (const s of FAMILIARS[k].spells) expect(SPELLS[s]).toBeDefined();
    expect(FAMILIARS.crab.spells).toEqual(['burst', 'shell']);
    expect(FAMILIARS.capybara.spells).toEqual(['spring', 'calm']);
    expect(FAMILIARS.wolf.spells).toEqual(['pounce', 'howl']);
    expect(FAMILIARS.goldfish.spells).toEqual(['bubble', 'jet']);
    expect(FAMILIARS.iguana.spells).toEqual(['tongue', 'ward']);
  });
});

describe('SpellCooldowns', () => {
  it('casts when ready, then blocks until the cooldown runs out', () => {
    const cd = new SpellCooldowns();
    expect(cd.tryCast('pounce')).toBe(true);
    expect(cd.tryCast('pounce')).toBe(false);
    expect(cd.remaining('pounce')).toBe(SPELLS.pounce.cooldown);
    cd.tick(SPELLS.pounce.cooldown - 0.1);
    expect(cd.ready('pounce')).toBe(false);
    cd.tick(0.2);
    expect(cd.tryCast('pounce')).toBe(true);
  });

  it('keeps separate cooldowns per spell', () => {
    const cd = new SpellCooldowns();
    cd.tryCast('burst');
    expect(cd.ready('shell')).toBe(true);
  });
});

describe('pounceLanding', () => {
  it('leaps toward the tap, capped at the range', () => {
    expect(pounceLanding({ x: 0, z: 0 }, { x: 4, z: 0 }, 0)).toEqual({ x: 4, z: 0 });
    const far = pounceLanding({ x: 0, z: 0 }, { x: 0, z: 30 }, 0);
    expect(far.z).toBeCloseTo(POUNCE_RANGE);
  });

  it('leaps straight ahead when the tap is underfoot', () => {
    const p = pounceLanding({ x: 0, z: 0 }, { x: 0.3, z: 0 }, Math.PI / 2);
    expect(p.x).toBeCloseTo(POUNCE_RANGE);
    expect(p.z).toBeCloseTo(0);
  });
});

describe('distanceToSegment', () => {
  it('measures to the nearest point of the segment', () => {
    const a = { x: 0, z: 0 };
    const b = { x: 10, z: 0 };
    expect(distanceToSegment({ x: 5, z: 3 }, a, b)).toBeCloseTo(3);
    expect(distanceToSegment({ x: -4, z: 3 }, a, b)).toBeCloseTo(5);
    expect(distanceToSegment({ x: 2, z: 0 }, a, a)).toBeCloseTo(2);
  });

  it('every creature has two spells; spell codes stay stable on the wire', () => {
    for (const k of Object.keys(FAMILIARS) as (keyof typeof FAMILIARS)[]) expect(FAMILIARS[k].spells).toHaveLength(2);
    expect(FAMILIARS.wolf.spells).toEqual(['pounce', 'howl']);
    expect(SPELL_IDS.slice(0, 5)).toEqual(['burst', 'shell', 'spring', 'calm', 'pounce']);
  });

  it('the water jet reaches a strip ahead of the goldfish, not behind or to the side', () => {
    const from = { x: 0, z: 0 };
    const north = Math.PI; // heading yaw: facing −z
    expect(inJet(from, north, { x: 0, z: -5 }, 0.5)).toBe(true);
    expect(inJet(from, north, { x: 0, z: -(JET.length + 2) }, 0.5)).toBe(false);
    expect(inJet(from, north, { x: 0, z: 4 }, 0.5)).toBe(false);
    expect(inJet(from, north, { x: 4, z: -3 }, 0.5)).toBe(false);
  });
});
