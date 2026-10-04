/**
 * Rune Seal riddles: small sums for the familiar to solve between rooms. Every number in a riddle
 * — both operands and the answer — is between 0 and 10. Pure logic, unit tested.
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

export function makeRiddle(rng: () => number = Math.random): Riddle {
  const int = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
  let a: number;
  let b: number;
  let op: Riddle['op'];
  if (rng() < 0.5) {
    op = '+';
    a = int(0, 10);
    b = int(0, 10 - a);
  } else {
    op = '−';
    a = int(0, 10);
    b = int(0, a);
  }
  const answer = op === '+' ? a + b : a - b;
  // Three wrong choices near the answer (still 0..10), no repeats.
  const wrong = new Set<number>();
  for (let guard = 0; wrong.size < 3 && guard < 100; guard++) {
    const w = answer + int(-3, 3);
    if (w !== answer && w >= 0 && w <= 10) wrong.add(w);
  }
  for (let w = 0; wrong.size < 3; w++) if (w !== answer) wrong.add(w);
  const choices = [answer, ...wrong];
  for (let i = choices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }
  return { a, op, b, answer, choices };
}
