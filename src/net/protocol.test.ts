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
  it('accepts moves and bursts, rejects the rest', () => {
    expect(parseFamiliarCommand({ type: 'move', x: 1.5, z: -2 })).toEqual({ type: 'move', x: 1.5, z: -2 });
    expect(parseFamiliarCommand({ type: 'burst' })).toEqual({ type: 'burst' });
    expect(parseFamiliarCommand({ type: 'move', x: 'a', z: 0 })).toBeNull();
    expect(parseFamiliarCommand({ type: 'move', x: Infinity, z: 0 })).toBeNull();
    expect(parseFamiliarCommand(null)).toBeNull();
  });
});
