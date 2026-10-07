import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { MAX_MESSAGE_BYTES, parseClientMsg, type ServerMsg } from '../src/net/protocol';
import { RoomManager, type Conn } from './rooms';

/**
 * Elf & Crab server: serves the built game (dist/) and relays messages between the two players
 * of a room over WebSockets at /ws. The hero's browser runs the game; this only brokers rooms.
 */

const PORT = Number(process.env.PORT ?? 8787);
const here = path.dirname(fileURLToPath(import.meta.url));
// Works both from server/ (tsx in dev) and server/dist/ (built).
const DIST = [path.resolve(here, '../dist'), path.resolve(here, '../../dist')].find((d) => fs.existsSync(path.join(d, 'index.html')));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const rooms = new RoomManager();

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`ok ${rooms.size} rooms`);
    return;
  }
  if (!DIST) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Game not built (run npm run build). WebSocket server is running on /ws.');
    return;
  }
  // Static files, with an index.html fallback. Resolve inside dist/ only.
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  let file = path.resolve(DIST, rel);
  if (!file.startsWith(DIST + path.sep) && file !== DIST) {
    res.writeHead(403).end();
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  const ext = path.extname(file);
  const immutable = file.includes(`${path.sep}assets${path.sep}`); // hashed filenames
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

server.on('upgrade', (req, socket, head) => {
  if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

// Token bucket per connection: snapshots are 20/s, so allow ~60/s with bursts.
const RATE = 60;
const BURST = 120;

wss.on('connection', (ws: WebSocket & { alive?: boolean }) => {
  const conn: Conn = {
    send(msg: ServerMsg) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
    close() {
      ws.terminate();
    },
  };
  let tokens = BURST;
  let last = Date.now();
  ws.alive = true;
  ws.on('pong', () => (ws.alive = true));

  ws.on('message', (data, isBinary) => {
    const now = Date.now();
    tokens = Math.min(BURST, tokens + ((now - last) / 1000) * RATE);
    last = now;
    if (tokens < 1) {
      conn.send({ t: 'error', reason: 'rate-limited' });
      return;
    }
    tokens -= 1;
    const msg = isBinary ? null : parseClientMsg(data.toString());
    if (!msg) {
      conn.send({ t: 'error', reason: 'bad-message' });
      return;
    }
    if (msg.t === 'create') {
      const r = rooms.create(conn, msg.resume);
      conn.send('error' in r ? { t: 'error', reason: r.error } : { t: 'created', code: r.code, key: r.key });
    } else if (msg.t === 'join') {
      const r = rooms.join(msg.code, conn);
      conn.send('error' in r ? { t: 'error', reason: r.error } : { t: 'joined', code: msg.code });
    } else {
      rooms.relay(conn, msg.d);
    }
  });
  ws.on('close', () => rooms.leave(conn));
  ws.on('error', () => ws.terminate());
});

// Heartbeat drops dead sockets; sweep closes idle / abandoned rooms.
setInterval(() => {
  for (const ws of wss.clients as Set<WebSocket & { alive?: boolean }>) {
    if (!ws.alive) {
      ws.terminate();
      continue;
    }
    ws.alive = false;
    ws.ping();
  }
  rooms.sweep();
}, 10_000).unref();

server.listen(PORT, () => {
  console.log(`Elf & Crab server on :${PORT}${DIST ? ` serving ${DIST}` : ' (no dist/, WebSocket only)'}`);
});
