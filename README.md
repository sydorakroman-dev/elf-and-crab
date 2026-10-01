# Elf & Crab

A small third-person WebGL arena game built with [Three.js](https://threejs.org), Vite and TypeScript.
An elf archer holds off waves of slimes pouring out of a dungeon's gates — solo, or with a friend
playing her crab familiar on a tablet.

**Play:** https://sydorakroman-dev.github.io/elf-and-crab/ (multiplayer needs the Render server, see below)

## Controls

| Input | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Orbit camera / aim |
| Click (hold) | Shoot |
| Space | Dash (invulnerable while dashing) |
| Scroll | Zoom |
| M | Mute |
| Esc | Pause |

On phones and tablets (touch-first devices) the game shows on-screen controls instead:
left thumb moves (floating joystick), right thumb drags the camera, hold 🏹 to shoot, tap 💨 to dash.
Aim assist is wider on touch.

## Playing together (asymmetric co-op)

Two roles:

- **Hero (the elf)** plays as usual on a computer (or phone). The title screen shows a room code and a QR code.
- **Familiar (the crab)** scans the QR code or opens the link (`…/?join=CODE`) on a tablet, or types the code
  under "Got a code?". The crab appears beside the elf. Tap or drag on the floor to move — the crab pinches any
  slime it touches. **✨ Burst** stuns every slime around the crab for 2.5 s (12 s cooldown).

Solo is just the elf; the crab only appears while a familiar is connected.

How it works: the hero's browser runs the game and streams snapshots (20/s) to the familiar, who sends back taps.
The small Node server in `server/` only manages rooms and relays messages over WebSockets (`/ws`), and also serves
the built game, so one URL does everything.

## Power-ups

They appear at random on the floor every 10-18 s (max two at a time, gone after 14 s) and are sometimes
dropped by slimes (big ones most often). Walk over one to collect it; timed ones stack and extend.

| | Power-up | Effect |
| --- | --- | --- |
| 🔱 | Multishot | 3 arrows in a spread (12 s) |
| ⚡ | Rapid fire | Double fire rate (10 s) |
| ➶ | Piercing arrows | Arrows pass through every slime in a line (12 s) |
| 🛡️ | Shield | Absorbs the next hit (up to 20 s) |
| ❤️ | Heart | +1 heart (only appears when you're hurt) |

## Development

```bash
npm install
npm run dev      # game on http://localhost:5173 + multiplayer server on :8787 (proxied at /ws)
npm test         # unit tests (Vitest)
npm run build    # production build: dist/ (game) + server/dist/ (server)
npm start        # run the built server: serves the game and /ws on $PORT (default 8787)
npm run deploy   # build and publish to GitHub Pages (gh-pages branch)
npm run balance  # difficulty simulator: bots play headlessly (needs `npm run dev` + Chrome)
```

## Hosting

`render.yaml` is a [Render](https://render.com) Blueprint for a free web service (game + WebSocket server on one
URL; free instances sleep when idle and take ~30-60 s to wake). The GitHub Pages copy is built with
`VITE_SERVER_URL` pointing at it (put the URL in `.server-url` before `npm run deploy`).

## How it's put together

- `src/world/dungeon.ts` — the arena: instanced floor tiles and wall bricks, gates, pillars, torches.
- `src/player/elf.ts`, `src/player/crab.ts` — the two glTF models (`public/models/`). They're static, unrigged
  meshes, so `src/player/rig.ts` groups their named parts under pivots and the classes animate them in code.
- `server/` — room manager (`rooms.ts`, unit tested) and the HTTP + WebSocket server (`index.ts`).
- `src/net/` — wire protocol, reconnecting client sessions, and snapshots with interpolation (unit tested).
- `src/familiar/` — the familiar's tablet view: top-down camera, tap-to-move, Burst button, HUD.
- `src/player/controls.ts` — third-person camera and movement (mouse or touch input); `src/ui/touch.ts` — on-screen touch controls.
- `src/game/` — the game loop, slimes (small, big, spitter), arrows and spitter globs, crab companion AI,
  particles, power-ups (`powerups.ts` rules, `pickups.ts` visuals), sound (WebAudio, no files: effects plus
  positional fire ambience), high score, and pure
  combat helpers in `combat.ts` including the wave difficulty curve (unit tested).
