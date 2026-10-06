/**
 * Rune Seal riddles: small sums for the familiar to solve between rooms. Both numbers are single
 * digits (1–9, never 0); a sum is at most 15 and a difference at least 1, so no step involves 0.
 * Pure logic, unit tested.
 */
export interface Riddle {
  a: number;
  op: '+' | '−';
  b: number;
  answer: number;
  /** Four choices (the answer among them), shuffled. */
  choices: number[];
}

/** Riddles to solve to break a seal. */
export const SEAL_RIDDLES = 3;
/** Largest answer a riddle (or a wrong choice) can have. */
export const MAX_ANSWER = 15;

/** A new riddle; never the same question as `avoid` (used after a wrong answer). */
export function makeRiddle(rng: () => number = Math.random, avoid?: Pick<Riddle, 'a' | 'op' | 'b'> | null): Riddle {
  const int = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
  let a: number;
  let b: number;
  let op: Riddle['op'];
  for (let guard = 0; ; guard++) {
    if (rng() < 0.5) {
      op = '+';
      a = int(1, 9);
      b = int(1, Math.min(9, MAX_ANSWER - a));
    } else {
      op = '−';
      a = int(2, 9);
      b = int(1, a - 1);
    }
    if (!avoid || guard > 50 || avoid.a !== a || avoid.op !== op || avoid.b !== b) break;
  }
  const answer = op === '+' ? a + b : a - b;
  // Three wrong choices near the answer (still 1..MAX_ANSWER), no repeats.
  const wrong = new Set<number>();
  for (let guard = 0; wrong.size < 3 && guard < 100; guard++) {
    const w = answer + int(-3, 3);
    if (w !== answer && w >= 1 && w <= MAX_ANSWER) wrong.add(w);
  }
  for (let w = 1; wrong.size < 3; w++) if (w !== answer) wrong.add(w);
  const choices = [answer, ...wrong];
  for (let i = choices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }
  return { a, op, b, answer, choices };
}
