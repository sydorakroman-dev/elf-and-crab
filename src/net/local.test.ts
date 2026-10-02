import { describe, expect, it } from 'vitest';
import { practiceLink, PRACTICE_CODE } from './local';
import type { Snapshot } from './snapshot';
import { normalizeCode } from './protocol';

describe('practice room link', () => {
  it('is opened by typing TEST', () => {
    expect(normalizeCode('test')).toBe(PRACTICE_CODE);
  });

  it('connects both sides and carries snapshots and commands (as copies)', async () => {
    const link = practiceLink();
    const events: string[] = [];
    link.hero.onFamiliar = (c) => events.push(`fam:${c}`);
    link.familiar.onStatus = (s) => events.push(`status:${s}`);
    let got: Snapshot | null = null;
    link.familiar.onSnapshot = (s) => (got = s);
    let cmd: unknown = null;
    link.hero.onCommand = (c) => (cmd = c);

    const snap = { t: 1, practice: 1 } as unknown as Snapshot;
    link.hero.sendSnapshot(snap); // not connected yet: dropped
    await Promise.resolve();
    expect(got).toBeNull();

    link.connect();
    expect(events).toEqual(['fam:true', 'status:joined']);
    link.hero.sendSnapshot(snap);
    link.familiar.send({ type: 'steer', dx: 1, dz: 0 });
    await Promise.resolve();
    expect(got).toEqual(snap);
    expect(got).not.toBe(snap);
    expect(cmd).toEqual({ type: 'steer', dx: 1, dz: 0 });
  });
});
