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

/** What the familiar (crab) player can ask for. The hero validates and applies it. */
export type FamiliarCommand = { type: 'move'; x: number; z: number } | { type: 'burst' };

/** Validates a familiar command; null if malformed. */
export function parseFamiliarCommand(v: unknown): FamiliarCommand | null {
  if (!isObject(v)) return null;
  if (v.type === 'burst') return { type: 'burst' };
  if (v.type === 'move' && Number.isFinite(v.x) && Number.isFinite(v.z)) return { type: 'move', x: v.x as number, z: v.z as number };
  return null;
}
