import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, scaledDamage, scaledHp, setDifficulty } from './difficulty';

describe('difficulty', () => {
  it('scales enemy HP and damage to the elf, normal unchanged', () => {
    setDifficulty('normal');
    expect(scaledHp(100)).toBe(100);
    expect(scaledDamage(20)).toBe(20);
    setDifficulty('easy');
    expect(scaledHp(100)).toBe(Math.round(100 * DIFFICULTIES.easy.enemyHp));
    expect(scaledDamage(20)).toBeLessThan(20);
    setDifficulty('hard');
    expect(scaledHp(100)).toBeGreaterThan(100);
    expect(scaledDamage(20)).toBeGreaterThan(20);
    expect(scaledDamage(1)).toBeGreaterThanOrEqual(1);
    setDifficulty('normal');
  });
});
