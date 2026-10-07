import { describe, expect, it } from 'vitest';
import { RoomManager, type Conn } from './rooms';
import type { ServerMsg } from '../src/net/protocol';

function conn() {
  const inbox: ServerMsg[] = [];
  const c: Conn & { inbox: ServerMsg[] } = { inbox, send: (m) => void inbox.push(m) };
  return c;
}

function setup(opts = {}) {
  let t = 0;
  const rooms = new RoomManager({ now: () => t, ...opts });
  return { rooms, advance: (ms: number) => (t += ms) };
}

describe('RoomManager', () => {
  it('creates a room with a 4-letter unambiguous code', () => {
    const { rooms } = setup();
    const r = rooms.create(conn());
    expect('code' in r && r.code).toMatch(/^[A-HJ-NP-Z]{4}$/);
  });

  it('lets a familiar join and relays both ways', () => {
    const { rooms } = setup();
    const host = conn();
    const guest = conn();
    const { code } = rooms.create(host) as { code: string };
    expect(rooms.join(code, guest)).toEqual({ ok: true });
    expect(host.inbox).toContainEqual({ t: 'peer-joined' });
    rooms.relay(host, { hi: 1 });
    rooms.relay(guest, { cmd: 2 });
    expect(guest.inbox).toContainEqual({ t: 'relay', d: { hi: 1 } });
    expect(host.inbox).toContainEqual({ t: 'relay', d: { cmd: 2 } });
  });

  it('rejects unknown codes; a familiar reconnecting replaces its old (dead) connection', () => {
    const { rooms } = setup();
    const host = conn();
    const { code } = rooms.create(host) as { code: string };
    const old = conn();
    rooms.join(code, old);
    const fresh = conn();
    expect(rooms.join(code, fresh)).toEqual({ ok: true });
    // The old socket closing later doesn't knock the new familiar out.
    rooms.leave(old);
    rooms.relay(host, 'hi');
    expect(fresh.inbox).toContainEqual({ t: 'relay', d: 'hi' });
    expect(host.inbox.some((m) => m.t === 'peer-left')).toBe(false);
    expect(rooms.join('ZZZZ', conn())).toEqual({ error: 'no-room' });
  });

  it('tells the hero when the familiar leaves, and lets them rejoin', () => {
    const { rooms } = setup();
    const host = conn();
    const guest = conn();
    const { code } = rooms.create(host) as { code: string };
    rooms.join(code, guest);
    rooms.leave(guest);
    expect(host.inbox).toContainEqual({ t: 'peer-left' });
    expect(rooms.join(code, conn())).toEqual({ ok: true });
  });

  it('lets a dropped hero reclaim the room with its key within the grace period', () => {
    const { rooms, advance } = setup({ hostGraceMs: 20_000 });
    const host = conn();
    const guest = conn();
    const { code, key } = rooms.create(host) as { code: string; key: string };
    rooms.join(code, guest);
    rooms.leave(host);
    expect(guest.inbox).toContainEqual({ t: 'peer-left', temporary: true });
    advance(5_000);
    rooms.sweep();
    const host2 = conn();
    expect(rooms.create(host2, { code, key })).toEqual({ code, key });
    expect(guest.inbox.filter((m) => m.t === 'peer-joined')).toHaveLength(1);
    rooms.relay(guest, 'still here');
    expect(host2.inbox).toContainEqual({ t: 'relay', d: 'still here' });
  });

  it('does not let a wrong key reclaim a room', () => {
    const { rooms } = setup();
    const host = conn();
    const { code } = rooms.create(host) as { code: string };
    rooms.leave(host);
    const r = rooms.create(conn(), { code, key: 'nope' }) as { code: string };
    expect(r.code).not.toBe(code);
  });

  it('closes the room when the hero does not come back in time', () => {
    const { rooms, advance } = setup({ hostGraceMs: 20_000 });
    const host = conn();
    const guest = conn();
    const { code } = rooms.create(host) as { code: string };
    rooms.join(code, guest);
    rooms.leave(host);
    advance(25_000);
    rooms.sweep();
    expect(guest.inbox.at(-1)).toEqual({ t: 'peer-left' });
    expect(rooms.join(code, conn())).toEqual({ error: 'no-room' });
  });

  it('expires idle rooms', () => {
    const { rooms, advance } = setup({ idleMs: 1000 });
    const host = conn();
    rooms.create(host);
    advance(2000);
    rooms.sweep();
    expect(rooms.size).toBe(0);
    expect(host.inbox).toContainEqual({ t: 'peer-left' });
  });

  it('caps the number of rooms', () => {
    const { rooms } = setup({ maxRooms: 2 });
    rooms.create(conn());
    rooms.create(conn());
    expect(rooms.create(conn())).toEqual({ error: 'server-full' });
  });

  it('moves a host that creates again into the new room', () => {
    const { rooms } = setup();
    const host = conn();
    rooms.create(host);
    rooms.create(host);
    expect(rooms.size).toBe(2); // old one kept briefly for reclaim…
  });

  it('sweeps an abandoned empty room after the grace period', () => {
    const { rooms, advance } = setup({ hostGraceMs: 20_000 });
    const host = conn();
    rooms.create(host);
    rooms.leave(host);
    expect(rooms.size).toBe(1);
    advance(21_000);
    rooms.sweep();
    expect(rooms.size).toBe(0);
  });
});
