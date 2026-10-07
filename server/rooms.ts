import { CODE_ALPHABET, CODE_LENGTH, type ErrorReason, type ServerMsg } from '../src/net/protocol';

/** Anything we can send a message to (a WebSocket in production, a fake in tests). */
export interface Conn {
  send(msg: ServerMsg): void;
  /** Drops the connection (a newer one took its place). */
  close?(): void;
}

interface Room {
  code: string;
  key: string;
  host: Conn | null;
  guest: Conn | null;
  lastActive: number;
  /** When the host dropped (for the reclaim grace period), or null while connected. */
  hostGoneAt: number | null;
}

export interface RoomOptions {
  maxRooms?: number;
  /** Rooms with no traffic for this long are closed. */
  idleMs?: number;
  /** How long a dropped host has to reclaim its room before the familiar is told it's over. */
  hostGraceMs?: number;
  now?: () => number;
  rng?: () => number;
}

/**
 * Two-player rooms: a hero (host) creates one and gets a short code; a familiar (guest) joins
 * with it. Messages are relayed to the other side. Pure logic, no sockets — unit tested.
 */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly roomOf = new Map<Conn, Room>();
  private readonly maxRooms: number;
  private readonly idleMs: number;
  private readonly hostGraceMs: number;
  private readonly now: () => number;
  private readonly rng: () => number;

  constructor(opts: RoomOptions = {}) {
    this.maxRooms = opts.maxRooms ?? 200;
    this.idleMs = opts.idleMs ?? 60 * 60 * 1000;
    this.hostGraceMs = opts.hostGraceMs ?? 20 * 1000;
    this.now = opts.now ?? Date.now;
    this.rng = opts.rng ?? Math.random;
  }

  get size(): number {
    return this.rooms.size;
  }

  /** Hero opens a room, or reclaims its room after a reconnect (code + key). */
  create(host: Conn, resume?: { code: string; key: string }): { code: string; key: string } | { error: ErrorReason } {
    this.leave(host);
    if (resume) {
      const room = this.rooms.get(resume.code);
      if (room && room.key === resume.key && room.host === null) {
        room.host = host;
        room.hostGoneAt = null;
        room.lastActive = this.now();
        this.roomOf.set(host, room);
        if (room.guest) {
          room.guest.send({ t: 'peer-joined' });
          host.send({ t: 'peer-joined' });
        }
        return { code: room.code, key: room.key };
      }
      // Couldn't reclaim (expired or taken): fall through to a fresh room.
    }
    if (this.rooms.size >= this.maxRooms) return { error: 'server-full' };
    const room: Room = { code: this.newCode(), key: this.newKey(), host, guest: null, lastActive: this.now(), hostGoneAt: null };
    this.rooms.set(room.code, room);
    this.roomOf.set(host, room);
    return { code: room.code, key: room.key };
  }

  /** Familiar joins by code. */
  join(code: string, guest: Conn): { ok: true } | { error: ErrorReason } {
    this.leave(guest);
    const room = this.rooms.get(code);
    if (!room) return { error: 'no-room' };
    if (room.guest) {
      // A familiar reconnecting after a network blip often arrives before the server has noticed
      // its old, dead socket: the newest familiar takes the place (the old connection is dropped).
      const old = room.guest;
      this.roomOf.delete(old);
      old.close?.();
    }
    room.guest = guest;
    room.lastActive = this.now();
    this.roomOf.set(guest, room);
    if (room.host) room.host.send({ t: 'peer-joined' });
    else guest.send({ t: 'peer-left', temporary: true }); // hero is reconnecting
    return { ok: true };
  }

  /** A connection closed or switched rooms. */
  leave(conn: Conn): void {
    const room = this.roomOf.get(conn);
    if (!room) return;
    this.roomOf.delete(conn);
    if (room.host === conn) {
      // Keep the room briefly so the hero can reclaim it after a network blip.
      room.host = null;
      room.hostGoneAt = this.now();
      room.guest?.send({ t: 'peer-left', temporary: true });
    } else if (room.guest === conn) {
      room.guest = null;
      room.host?.send({ t: 'peer-left' });
    }
    // An empty room lingers until sweep() so a reconnecting hero keeps the code it's showing.
  }

  /** Forwards a payload to the other player in the sender's room. */
  relay(from: Conn, d: unknown): void {
    const room = this.roomOf.get(from);
    if (!room) return;
    room.lastActive = this.now();
    const to = room.host === from ? room.guest : room.host;
    to?.send({ t: 'relay', d });
  }

  /** Closes idle rooms and rooms whose host never came back. Call periodically. */
  sweep(): void {
    const now = this.now();
    for (const room of this.rooms.values()) {
      const hostExpired = room.hostGoneAt !== null && now - room.hostGoneAt > this.hostGraceMs;
      const idle = now - room.lastActive > this.idleMs;
      if (!hostExpired && !idle) continue;
      for (const c of [room.host, room.guest]) {
        if (!c) continue;
        c.send({ t: 'peer-left' });
        this.roomOf.delete(c);
      }
      this.rooms.delete(room.code);
    }
  }

  private newCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(this.rng() * CODE_ALPHABET.length)];
      if (!this.rooms.has(code) && code !== 'TEST') return code; // TEST opens the practice room (src/net/local.ts)
    }
  }

  private newKey(): string {
    return Array.from({ length: 24 }, () => Math.floor(this.rng() * 36).toString(36)).join('');
  }
}
