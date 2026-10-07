import { describe, expect, it } from 'vitest';
import { HEROES, HERO_CLASSES, inSwing } from './heroes';
import { ABILITIES } from './abilities';

describe('heroes', () => {
  it('gives every hero three real skills, health and an attack', () => {
    for (const h of HERO_CLASSES) {
      const d = HEROES[h];
      expect(d.skills).toHaveLength(3);
      for (const s of d.skills) expect(ABILITIES[s]).toBeTruthy();
      expect(d.hp).toBeGreaterThan(50);
      expect(d.attack.damage).toBeGreaterThan(0);
      expect(d.attack.interval).toBeGreaterThan(0.1);
      if (d.attack.kind === 'melee') expect(d.attack.range).toBeGreaterThan(2);
    }
  });

  it('trades toughness for reach: the melee heroes are the toughest, the mage the frailest', () => {
    expect(HEROES.knight.hp).toBeGreaterThan(HEROES.elf.hp);
    expect(HEROES.barbarian.hp).toBeGreaterThan(HEROES.elf.hp);
    expect(HEROES.mage.hp).toBeLessThan(HEROES.elf.hp);
    // Damage per second is in the same range for everyone (the beast master's wolf adds to it).
    const dps = (h: (typeof HERO_CLASSES)[number]) => HEROES[h].attack.damage / HEROES[h].attack.interval;
    for (const h of HERO_CLASSES) expect(dps(h)).toBeGreaterThan(20);
    for (const h of HERO_CLASSES) expect(dps(h)).toBeLessThan(50);
  });

  it('hits what is in the arc in front, within reach', () => {
    const foe = (x: number, z: number) => ({ x, z, radius: 0.5 });
    expect(inSwing(0, 0, 0, 1, 3, 1, foe(0, 2.5))).toBe(true); // straight ahead
    expect(inSwing(0, 0, 0, 1, 3, 1, foe(1.5, 2))).toBe(true); // off to the side, inside the arc
    expect(inSwing(0, 0, 0, 1, 3, 1, foe(0, -2))).toBe(false); // behind
    expect(inSwing(0, 0, 0, 1, 3, 1, foe(0, 5))).toBe(false); // too far
    expect(inSwing(0, 0, 0, 1, 3, 1, foe(0.3, -0.3))).toBe(true); // right on top of you
  });
});
