import { describe, expect, it } from 'vitest';
import { loadBest, recordRun } from './highscore';

function fakeStore(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

describe('high score', () => {
  it('has no best at first', () => {
    expect(loadBest(fakeStore())).toBeNull();
  });

  it('records the first run and only beats it with a higher score', () => {
    const store = fakeStore();
    expect(recordRun({ score: 100, wave: 3 }, store)).toBe(true);
    expect(recordRun({ score: 80, wave: 5 }, store)).toBe(false);
    expect(loadBest(store)).toEqual({ score: 100, wave: 3 });
    expect(recordRun({ score: 150, wave: 4 }, store)).toBe(true);
    expect(loadBest(store)).toEqual({ score: 150, wave: 4 });
  });

  it('breaks score ties by wave', () => {
    const store = fakeStore();
    recordRun({ score: 100, wave: 3 }, store);
    expect(recordRun({ score: 100, wave: 4 }, store)).toBe(true);
    expect(recordRun({ score: 100, wave: 4 }, store)).toBe(false);
  });

  it('ignores corrupt data', () => {
    expect(loadBest(fakeStore({ 'elf-and-crab:best': '{not json' }))).toBeNull();
    expect(loadBest(fakeStore({ 'elf-and-crab:best': '{"score":"x"}' }))).toBeNull();
  });

  it('survives storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadBest(broken)).toBeNull();
    expect(recordRun({ score: 10, wave: 1 }, broken)).toBe(true);
  });

  it('works with no storage at all', () => {
    expect(loadBest(null)).toBeNull();
    expect(recordRun({ score: 10, wave: 1 }, null)).toBe(true);
  });
});
