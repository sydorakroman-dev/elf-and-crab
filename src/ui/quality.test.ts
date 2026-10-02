import { describe, expect, it } from 'vitest';
import { AutoQuality } from './quality';

function fakeRenderer() {
  let ratio = 2;
  return { getPixelRatio: () => ratio, setPixelRatio: (r: number) => (ratio = r), shadowMap: { enabled: true } };
}

describe('automatic quality', () => {
  it('leaves a fast device alone', () => {
    const r = fakeRenderer();
    const q = new AutoQuality(r as never);
    for (let i = 0; i < 60 * 20; i++) q.frame(1 / 60);
    expect(r.getPixelRatio()).toBe(2);
    expect(r.shadowMap.enabled).toBe(true);
  });

  it('lowers resolution, then turns shadows off, on a slow one', () => {
    const r = fakeRenderer();
    const q = new AutoQuality(r as never);
    for (let i = 0; i < 25 * 10; i++) q.frame(1 / 25);
    expect(r.getPixelRatio()).toBeLessThan(2);
    for (let i = 0; i < 25 * 10; i++) q.frame(1 / 25);
    expect(r.shadowMap.enabled).toBe(false);
  });
});
