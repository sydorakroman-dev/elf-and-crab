import { FAMILIAR_KINDS, SPELL_IDS, type FamiliarKind, type SpellId } from '../game/familiars';
import { MAX_ANSWER } from '../game/riddles';
import { GEAR_SLOTS, type GearSlot } from '../game/items';
import type { InvOp } from '../game/inventory';

/**
 * Wire protocol shared by the browser and the Node server. The server only manages rooms and
 * relays `relay` payloads between the two players; it never looks inside them.
 */

/** Unambiguous letters for room codes (no I, O, 0, 1). */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const CODE_LENGTH = 4;
export const MAX_MESSAGE_BYTES = 64 * 1024;

export type ErrorReason = 'no-room' | 'room-full' | 'server-full' | 'bad-message' | 'rate-limited';

export type ClientMsg =
  /** Hero opens a room, or reclaims it after a dropped connection with the key it was given. */
  | { t: 'create'; resume?: { code: string; key: string } }
  /** Familiar joins a room by code. */
  | { t: 'join'; code: string }
  | { t: 'relay'; d: unknown };

export type ServerMsg =
  | { t: 'created'; code: string; key: string }
  | { t: 'joined'; code: string }
  | { t: 'peer-joined' }
  /** `temporary`: the hero dropped and may come back within the grace period. */
  | { t: 'peer-left'; temporary?: boolean }
  | { t: 'error'; reason: ErrorReason }
  | { t: 'relay'; d: unknown };

/** Uppercases and strips a typed room code; null if it can't be a valid code. */
export function normalizeCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== CODE_LENGTH) return null;
  return [...code].every((c) => CODE_ALPHABET.includes(c)) ? code : null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Validates a message from a client; null if malformed. */
export function parseClientMsg(raw: string): ClientMsg | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(v)) return null;
  switch (v.t) {
    case 'create': {
      if (v.resume === undefined) return { t: 'create' };
      const r = v.resume;
      if (!isObject(r) || typeof r.key !== 'string' || typeof r.code !== 'string') return null;
      const code = normalizeCode(r.code);
      return code && r.key.length <= 64 ? { t: 'create', resume: { code, key: r.key } } : null;
    }
    case 'join': {
      const code = typeof v.code === 'string' ? normalizeCode(v.code) : null;
      return code ? { t: 'join', code } : null;
    }
    case 'relay':
      return 'd' in v ? { t: 'relay', d: v.d } : null;
    default:
      return null;
  }
}

/** Validates a message from the server; null if malformed. */
export function parseServerMsg(raw: string): ServerMsg | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(v) || typeof v.t !== 'string') return null;
  switch (v.t) {
    case 'created':
      return typeof v.code === 'string' && typeof v.key === 'string' ? { t: 'created', code: v.code, key: v.key } : null;
    case 'joined':
      return typeof v.code === 'string' ? { t: 'joined', code: v.code } : null;
    case 'peer-joined':
      return { t: 'peer-joined' };
    case 'peer-left':
      return { t: 'peer-left', temporary: v.temporary === true };
    case 'error':
      return typeof v.reason === 'string' ? { t: 'error', reason: v.reason as ErrorReason } : null;
    case 'relay':
      return { t: 'relay', d: v.d };
    default:
      return null;
  }
}

// ---- Game payloads carried inside `relay` ------------------------------------------------------

/** What the familiar player can ask for. The hero validates and applies it. */
export type FamiliarCommand =
  | { type: 'move'; x: number; z: number }
  /** Virtual joystick: run in direction (dx, dz), length 0..1 = speed; (0, 0) stops. */
  | { type: 'steer'; dx: number; dz: number }
  | { type: 'spell'; id: SpellId }
  /** Practice room only: show this monster strolling about. */
  | { type: 'parade'; kind: string }
  /** Rune Seal: the familiar picks an answer. */
  | { type: 'answer'; value: number }
  /** Practice room only: start a Rune Seal to try. */
  | { type: 'riddle' }
  /** Pick (or switch) creature. */
  | { type: 'choose'; kind: FamiliarKind }
  /** Something with the shared bag (equip, drink, buy…). */
  | { type: 'inv'; req: InvOp };

/** Validates a familiar command; null if malformed. */
export function parseFamiliarCommand(v: unknown): FamiliarCommand | null {
  if (!isObject(v)) return null;
  if (v.type === 'spell' && (SPELL_IDS as unknown[]).includes(v.id)) return { type: 'spell', id: v.id as SpellId };
  if (v.type === 'choose' && (FAMILIAR_KINDS as unknown[]).includes(v.kind)) return { type: 'choose', kind: v.kind as FamiliarKind };
  if (v.type === 'answer' && Number.isInteger(v.value) && (v.value as number) >= 0 && (v.value as number) <= MAX_ANSWER) return { type: 'answer', value: v.value as number };
  if (v.type === 'riddle') return { type: 'riddle' };
  if (v.type === 'inv' && isObject(v.req)) {
    const r = v.req;
    const index = Number.isInteger(r.i) && (r.i as number) >= 0 && (r.i as number) < 32 ? (r.i as number) : -1;
    if (r.op === 'equip' && index >= 0 && (GEAR_SLOTS as unknown[]).includes(r.to)) return { type: 'inv', req: { op: 'equip', i: index, to: r.to as GearSlot } };
    if ((r.op === 'equip' || r.op === 'use' || r.op === 'drop' || r.op === 'sell' || r.op === 'buy') && index >= 0) return { type: 'inv', req: { op: r.op, i: index } };
    if (r.op === 'unequip' && (GEAR_SLOTS as unknown[]).includes(r.slot)) {
      const to = Number.isInteger(r.to) && (r.to as number) >= 0 && (r.to as number) < 32 ? (r.to as number) : undefined;
      return { type: 'inv', req: { op: 'unequip', slot: r.slot as GearSlot, ...(to !== undefined ? { to } : {}) } };
    }
    const j = Number.isInteger(r.j) && (r.j as number) >= 0 && (r.j as number) < 32 ? (r.j as number) : -1;
    if (r.op === 'move' && index >= 0 && j >= 0) return { type: 'inv', req: { op: 'move', i: index, j } };
    return null;
  }
  if (v.type === 'parade' && typeof v.kind === 'string' && v.kind.length <= 24) return { type: 'parade', kind: v.kind }; // the hero checks it's a real monster
  if (v.type === 'move' && Number.isFinite(v.x) && Number.isFinite(v.z)) return { type: 'move', x: v.x as number, z: v.z as number };
  if (v.type === 'steer' && Number.isFinite(v.dx) && Number.isFinite(v.dz)) {
    // Never faster than full stick.
    const len = Math.hypot(v.dx as number, v.dz as number);
    const k = len > 1 ? 1 / len : 1;
    return { type: 'steer', dx: (v.dx as number) * k, dz: (v.dz as number) * k };
  }
  return null;
}
