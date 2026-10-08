import { describe, expect, it } from 'vitest';
import { FISTS, HEROES, HERO_CLASSES, WEAPON_ATTACKS, inSwing } from './heroes';
import { WEAPON_TYPES } from './items';
import { ABILITIES } from './abilities';

describe('heroes', () => {
  it('gives every hero three real skills, health and a preferred weapon type', () => {
    for (const h of HERO_CLASSES) {
      const d = HEROES[h];
      expect(d.skills).toHaveLength(3);
      for (const s of d.skills) expect(ABILITIES[s]).toBeTruthy();
      expect(d.hp).toBeGreaterThan(50);
      expect(WEAPON_TYPES).toContain(d.preferred);
    }
    expect(HEROES.knight.hp).toBeGreaterThan(HEROES.elf.hp);
    expect(HEROES.mage.hp).toBeLessThan(HEROES.elf.hp);
  });

  it('gives each weapon type its own attack, in the same damage-per-second range', () => {
    const dps = (a: { damage: number; interval: number }) => a.damage / a.interval;
    for (const w of WEAPON_TYPES) {
      const a = WEAPON_ATTACKS[w];
      expect(a.interval).toBeGreaterThan(0.1);
      expect(dps(a)).toBeGreaterThan(20);
      expect(dps(a)).toBeLessThan(50);
      if (a.kind === 'melee') expect(a.range).toBeGreaterThan(2);
    }
    expect(WEAPON_ATTACKS.twohand.damage).toBeGreaterThan(WEAPON_ATTACKS.onehand.damage);
    expect(WEAPON_ATTACKS.twohand.range!).toBeGreaterThan(WEAPON_ATTACKS.onehand.range!);
    expect(dps(FISTS)).toBeLessThan(dps(WEAPON_ATTACKS.onehand) / 2);
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
