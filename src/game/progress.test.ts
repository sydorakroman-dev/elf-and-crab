import { describe, expect, it } from 'vitest';
import { loadProgress, reachRoom, recordWin } from './progress';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('progress', () => {
  it('remembers the furthest room and never goes back', () => {
    const s = memory();
    expect(loadProgress(s).furthest).toBe(0);
    reachRoom(3, s);
    reachRoom(1, s);
    expect(loadProgress(s).furthest).toBe(3);
  });

  it('records wins per difficulty once, and survives junk', () => {
    const s = memory();
    recordWin('normal', s);
    recordWin('normal', s);
    recordWin('hard', s);
    expect(loadProgress(s).wins).toEqual(['normal', 'hard']);
    s.setItem('elf-and-crab:progress', '{"furthest":"x","wins":["nope"]}');
    expect(loadProgress(s)).toEqual({ furthest: 0, wins: [] });
  });
});
