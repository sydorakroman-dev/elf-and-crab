import { parseFamiliarCommand, parseServerMsg, type ClientMsg, type ErrorReason, type FamiliarCommand, type ServerMsg } from './protocol';
import type { Snapshot } from './snapshot';

export type ConnStatus = 'connecting' | 'open' | 'reconnecting' | 'unavailable';

/** WebSocket URL of the multiplayer server: VITE_SERVER_URL if set, else this site's /ws. */
export function serverUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (configured) return configured.replace(/^http/, 'ws').replace(/\/?$/, '/ws').replace(/\/ws\/ws$/, '/ws');
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

/**
 * A WebSocket that reconnects with backoff. `onOpen` runs after every (re)connect so the owner
 * can re-create / re-join its room. Gives up (status "unavailable") after a few failed tries in
 * a row before ever connecting, but keeps retrying in the background.
 */
class Socket {
  onMessage?: (msg: ServerMsg) => void;
  onOpen?: () => void;
  onStatus?: (s: ConnStatus) => void;
  private ws: WebSocket | null = null;
  private attempts = 0;
  private everOpened = false;
  private closed = false;
  private timer = 0;
  private readonly url: string;

  constructor(url: string) {
    this.url = url;
  }

  connect(): void {
    this.closed = false;
    this.onStatus?.(this.everOpened ? 'reconnecting' : 'connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.retry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.attempts = 0;
      this.everOpened = true;
      this.onStatus?.('open');
      this.onOpen?.();
    };
    ws.onmessage = (e) => {
      const msg = typeof e.data === 'string' ? parseServerMsg(e.data) : null;
      if (msg) this.onMessage?.(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (!this.closed) this.retry();
    };
  }

  /** Sends if connected; returns false if not (or if the socket is backed up). */
  send(msg: ClientMsg): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 256 * 1024) return false;
    ws.send(JSON.stringify(msg));
    return true;
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.timer);
    this.ws?.close();
    this.ws = null;
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Drops the current connection (it looks dead) and connects again straight away. */
  reconnectNow(): void {
    if (this.closed) return;
    clearTimeout(this.timer);
    const old = this.ws;
    this.ws = null;
    if (old) {
      old.onclose = null;
      try {
        old.close();
      } catch {
        // already gone
      }
    }
    this.attempts = 0;
    this.connect();
  }

  private retry(): void {
    this.attempts++;
    // A free-tier server can take up to a minute to wake: keep trying, slower over time.
    if (!this.everOpened && this.attempts >= 4) this.onStatus?.('unavailable');
    else this.onStatus?.(this.everOpened ? 'reconnecting' : 'connecting');
    const delay = Math.min(10_000, 500 * 2 ** Math.min(this.attempts, 5));
    this.timer = window.setTimeout(() => this.connect(), delay);
  }
}

/** Hero side: owns a room, learns when a familiar joins/leaves, streams snapshots, receives commands. */
export class HeroSession {
  onRoom?: (code: string) => void;
  onFamiliar?: (connected: boolean) => void;
  onCommand?: (cmd: FamiliarCommand) => void;
  onStatus?: (s: ConnStatus) => void;
  code: string | null = null;
  familiarConnected = false;
  private key: string | null = null;
  private readonly socket: Socket;

  constructor(url = serverUrl()) {
    this.socket = new Socket(url);
    this.socket.onStatus = (s) => {
      if (s !== 'open' && this.familiarConnected) this.setFamiliar(false);
      this.onStatus?.(s);
    };
    this.socket.onOpen = () => {
      const resume = this.code && this.key ? { code: this.code, key: this.key } : undefined;
      this.socket.send({ t: 'create', resume });
    };
    this.socket.onMessage = (msg) => this.handle(msg);
    this.socket.connect();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && !this.socket.isOpen) this.socket.reconnectNow();
    });
  }

  /** Sends a snapshot if a familiar is listening. */
  sendSnapshot(s: Snapshot): void {
    if (this.familiarConnected) this.socket.send({ t: 'relay', d: s });
  }

  close(): void {
    this.socket.close();
  }

  private handle(msg: ServerMsg): void {
    switch (msg.t) {
      case 'created':
        this.key = msg.key;
        if (msg.code !== this.code) {
          this.code = msg.code;
          this.onRoom?.(msg.code);
        }
        break;
      case 'peer-joined':
        this.setFamiliar(true);
        break;
      case 'peer-left':
        this.setFamiliar(false);
        break;
      case 'relay': {
        const cmd = parseFamiliarCommand(msg.d);
        if (cmd && this.familiarConnected) this.onCommand?.(cmd);
        break;
      }
      case 'error':
        if (msg.reason === 'server-full') this.onStatus?.('unavailable');
        break;
    }
  }

  private setFamiliar(connected: boolean): void {
    if (connected === this.familiarConnected) return;
    this.familiarConnected = connected;
    this.onFamiliar?.(connected);
  }
}

export type FamiliarStatus = ConnStatus | 'joined' | 'no-room' | 'room-full' | 'hero-away' | 'hero-left';

/** What the hero's game needs from its link to a familiar: a real room (HeroSession) or the practice room. */
export interface HeroLink {
  onRoom?: (code: string) => void;
  onFamiliar?: (connected: boolean) => void;
  onCommand?: (cmd: FamiliarCommand) => void;
  onStatus?: (s: ConnStatus) => void;
  familiarConnected: boolean;
  sendSnapshot(s: Snapshot): void;
}

/** What the familiar's view needs from its link to the hero: a real room (FamiliarSession) or the practice room. */
export interface FamiliarLink {
  readonly code: string;
  onSnapshot?: (s: Snapshot) => void;
  onStatus?: (s: FamiliarStatus) => void;
  send(cmd: FamiliarCommand): void;
}

/** Familiar side: joins a room by code, receives snapshots, sends commands. */
/** No update from the hero for this long (ms) while in the room: the link is dead, reconnect. */
const SILENCE_MS = 6000;

export class FamiliarSession {
  onSnapshot?: (s: Snapshot) => void;
  onStatus?: (s: FamiliarStatus) => void;
  readonly code: string;
  private readonly socket: Socket;
  private gaveUp = false;
  private lastHeard = Date.now();
  private heroAway = false;

  constructor(code: string, url = serverUrl()) {
    this.code = code;
    this.socket = new Socket(url);
    this.socket.onStatus = (s) => {
      if (!this.gaveUp) this.onStatus?.(s);
    };
    this.socket.onOpen = () => {
      this.lastHeard = Date.now();
      this.socket.send({ t: 'join', code });
    };
    this.socket.onMessage = (msg) => {
      this.lastHeard = Date.now();
      this.handle(msg);
    };
    this.socket.connect();
    // Watchdog: a connection can die without closing (Wi-Fi drops, the tablet dozes). The hero
    // sends at least 5 updates a second, so silence means the link is gone: reconnect at once.
    setInterval(() => {
      if (this.gaveUp || this.heroAway || !this.socket.isOpen) return;
      if (Date.now() - this.lastHeard > SILENCE_MS) {
        this.lastHeard = Date.now();
        this.socket.reconnectNow();
      }
    }, 1000);
    // Back from the background / the screen waking: reconnect now rather than after a back-off.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden || this.gaveUp) return;
      if (!this.socket.isOpen || Date.now() - this.lastHeard > 2000) {
        this.lastHeard = Date.now();
        this.socket.reconnectNow();
      }
    });
  }

  send(cmd: FamiliarCommand): void {
    this.socket.send({ t: 'relay', d: cmd });
  }

  close(): void {
    this.socket.close();
  }

  private handle(msg: ServerMsg): void {
    switch (msg.t) {
      case 'joined':
      case 'peer-joined':
        this.heroAway = false;
        this.onStatus?.('joined');
        break;
      case 'peer-left':
        this.heroAway = !!msg.temporary; // the hero is reconnecting: silence is expected
        this.onStatus?.(msg.temporary ? 'hero-away' : 'hero-left');
        if (!msg.temporary) this.stop();
        break;
      case 'relay':
        if (isSnapshot(msg.d)) this.onSnapshot?.(msg.d);
        break;
      case 'error':
        if (msg.reason === 'no-room' || msg.reason === 'room-full') {
          this.onStatus?.(msg.reason as Extract<ErrorReason, 'no-room' | 'room-full'>);
          this.stop();
        }
        break;
    }
  }

  private stop(): void {
    this.gaveUp = true;
    this.socket.close();
  }
}

function isSnapshot(d: unknown): d is Snapshot {
  if (typeof d !== 'object' || d === null) return false;
  const s = d as Partial<Snapshot>;
  return typeof s.t === 'number' && typeof s.state === 'string' && typeof s.hero === 'object' && Array.isArray(s.slimes);
}
