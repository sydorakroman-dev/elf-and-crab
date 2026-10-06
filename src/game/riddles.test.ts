import { describe, expect, it } from 'vitest';
import { MAX_ANSWER, makeRiddle } from './riddles';

describe('rune riddles', () => {
  it('uses single digits 1–9, answers 1–15, with the answer among 4 distinct choices', () => {
    for (let i = 0; i < 3000; i++) {
      const r = makeRiddle();
      for (const n of [r.a, r.b]) {
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(9);
      }
      for (const n of [r.answer, ...r.choices]) {
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(MAX_ANSWER);
      }
      expect(r.answer).toBe(r.op === '+' ? r.a + r.b : r.a - r.b);
      expect(r.choices).toHaveLength(4);
      expect(new Set(r.choices).size).toBe(4);
      expect(r.choices).toContain(r.answer);
    }
  });

  it('asks both sums and differences, and sums above 10', () => {
    const rs = Array.from({ length: 500 }, () => makeRiddle());
    expect(new Set(rs.map((r) => r.op))).toEqual(new Set(['+', '−']));
    expect(rs.some((r) => r.answer > 10)).toBe(true);
  });

  it('never repeats the question it must avoid', () => {
    for (let i = 0; i < 500; i++) {
      const old = makeRiddle();
      const r = makeRiddle(Math.random, old);
      expect(`${r.a}${r.op}${r.b}`).not.toBe(`${old.a}${old.op}${old.b}`);
    }
  });
});
