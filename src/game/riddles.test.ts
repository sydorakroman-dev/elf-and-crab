import { describe, expect, it } from 'vitest';
import { makeRiddle } from './riddles';

describe('rune riddles', () => {
  it('keeps every number between 0 and 10, with a correct answer among 4 distinct choices', () => {
    for (let i = 0; i < 2000; i++) {
      const r = makeRiddle();
      for (const n of [r.a, r.b, r.answer, ...r.choices]) {
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(10);
      }
      expect(r.answer).toBe(r.op === '+' ? r.a + r.b : r.a - r.b);
      expect(r.choices).toHaveLength(4);
      expect(new Set(r.choices).size).toBe(4);
      expect(r.choices).toContain(r.answer);
    }
  });

  it('asks both sums and differences', () => {
    const ops = new Set(Array.from({ length: 200 }, () => makeRiddle().op));
    expect(ops).toEqual(new Set(['+', '−']));
  });
});
