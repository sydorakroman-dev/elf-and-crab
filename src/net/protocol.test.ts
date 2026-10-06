import { describe, expect, it } from 'vitest';
import { normalizeCode, parseClientMsg, parseFamiliarCommand, parseServerMsg } from './protocol';

describe('normalizeCode', () => {
  it('accepts sloppy typing of a valid code', () => {
    expect(normalizeCode(' ab-cd ')).toBe('ABCD');
  });
  it('rejects wrong length and ambiguous letters', () => {
    expect(normalizeCode('ABC')).toBeNull();
    expect(normalizeCode('AB0D')).toBeNull();
    expect(normalizeCode('ABID')).toBeNull();
  });
});

describe('parseClientMsg', () => {
  it('parses valid messages', () => {
    expect(parseClientMsg('{"t":"create"}')).toEqual({ t: 'create' });
    expect(parseClientMsg('{"t":"join","code":"abcd"}')).toEqual({ t: 'join', code: 'ABCD' });
    expect(parseClientMsg('{"t":"relay","d":{"x":1}}')).toEqual({ t: 'relay', d: { x: 1 } });
    expect(parseClientMsg('{"t":"create","resume":{"code":"ABCD","key":"k"}}')).toEqual({ t: 'create', resume: { code: 'ABCD', key: 'k' } });
  });
  it('rejects junk', () => {
    for (const raw of ['nope', '[]', '{"t":"join"}', '{"t":"join","code":"XX"}', '{"t":"hack"}', '{"t":"relay"}', '{"t":"create","resume":{"code":1}}']) {
      expect(parseClientMsg(raw)).toBeNull();
    }
  });
});

describe('parseServerMsg', () => {
  it('round-trips server messages', () => {
    expect(parseServerMsg('{"t":"created","code":"ABCD","key":"k"}')).toEqual({ t: 'created', code: 'ABCD', key: 'k' });
    expect(parseServerMsg('{"t":"peer-left","temporary":true}')).toEqual({ t: 'peer-left', temporary: true });
    expect(parseServerMsg('{"t":"nope"}')).toBeNull();
  });
});

describe('parseFamiliarCommand', () => {
  it('accepts moves, spells and creature picks, rejects the rest', () => {
    expect(parseFamiliarCommand({ type: 'move', x: 1.5, z: -2 })).toEqual({ type: 'move', x: 1.5, z: -2 });
    expect(parseFamiliarCommand({ type: 'spell', id: 'pounce' })).toEqual({ type: 'spell', id: 'pounce' });
    expect(parseFamiliarCommand({ type: 'choose', kind: 'capybara' })).toEqual({ type: 'choose', kind: 'capybara' });
    expect(parseFamiliarCommand({ type: 'spell', id: 'fireball' })).toBeNull();
    expect(parseFamiliarCommand({ type: 'choose', kind: 'dragon' })).toBeNull();
    expect(parseFamiliarCommand({ type: 'burst' })).toBeNull();
    expect(parseFamiliarCommand({ type: 'move', x: 'a', z: 0 })).toBeNull();
    expect(parseFamiliarCommand({ type: 'move', x: Infinity, z: 0 })).toBeNull();
    expect(parseFamiliarCommand(null)).toBeNull();
    expect(parseFamiliarCommand({ type: 'steer', dx: 0.6, dz: 0 })).toEqual({ type: 'steer', dx: 0.6, dz: 0 });
    const full = parseFamiliarCommand({ type: 'steer', dx: 3, dz: 4 }) as { dx: number; dz: number }; // clamped to full stick
    expect(full.dx).toBeCloseTo(0.6);
    expect(full.dz).toBeCloseTo(0.8);
    expect(parseFamiliarCommand({ type: 'steer', dx: NaN, dz: 0 })).toBeNull();
  });

  it('accepts rune answers up to the biggest sum', () => {
    expect(parseFamiliarCommand({ type: 'answer', value: 15 })).toEqual({ type: 'answer', value: 15 });
    expect(parseFamiliarCommand({ type: 'answer', value: 16 })).toBeNull();
  });

  it('accepts bag requests, rejects malformed ones', () => {
    expect(parseFamiliarCommand({ type: 'inv', req: { op: 'equip', i: 3 } })).toEqual({ type: 'inv', req: { op: 'equip', i: 3 } });
    expect(parseFamiliarCommand({ type: 'inv', req: { op: 'unequip', slot: 'collar' } })).toEqual({ type: 'inv', req: { op: 'unequip', slot: 'collar' } });
    expect(parseFamiliarCommand({ type: 'inv', req: { op: 'buy', i: 2 } })).toEqual({ type: 'inv', req: { op: 'buy', i: 2 } });
    expect(parseFamiliarCommand({ type: 'inv', req: { op: 'equip', i: -1 } })).toBeNull();
    expect(parseFamiliarCommand({ type: 'inv', req: { op: 'unequip', slot: 'hat' } })).toBeNull();
    expect(parseFamiliarCommand({ type: 'inv', req: { op: 'steal', i: 0 } })).toBeNull();
    expect(parseFamiliarCommand({ type: 'inv', req: { op: 'move', i: 1, j: 4 } })).toEqual({ type: 'inv', req: { op: 'move', i: 1, j: 4 } });
    expect(parseFamiliarCommand({ type: 'inv', req: { op: 'unequip', slot: 'bow', to: 7 } })).toEqual({ type: 'inv', req: { op: 'unequip', slot: 'bow', to: 7 } });
    expect(parseFamiliarCommand({ type: 'inv', req: { op: 'move', i: 1 } })).toBeNull();
  });
});
