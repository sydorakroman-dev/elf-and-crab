# Elf & Crab

A small third-person WebGL arena game built with [Three.js](https://threejs.org), Vite and TypeScript.
An elf archer holds off waves of slimes pouring out of a dungeon's gates — solo, or with a friend
playing her crab familiar on a tablet.

**Play:** https://elf-and-crab.onrender.com (also mirrored at https://sydorakroman-dev.github.io/elf-and-crab/)

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

## The run

Six rooms, three waves each. Clear a room and its north door opens — walk through to the next one (your familiar
comes along, and you're healed to full). The last room ends with the **King Slime**; beat it to win.

| Room | |
| --- | --- |
| 1 · The Woodland | a sunny clearing: grass, low-poly trees, hedge walls, fireflies; forest beasts and the Crystal Bear |
| 2 · The Crypt | warm torches, a central brazier, four pillars |
| 3 · The Flooded Hall | two rows of pillars, cold blue light, puddles |
| 4 · The Lava Chamber | a glowing lava pit in the middle (arrows fly over it), a ring of pillars |
| 5 · The Crystal Cave | big, with glowing crystal clusters to fight around |
| 6 · The Throne Room | a colonnade and a throne; waves 1–2, then the King Slime |

## Enemies

Full tables with every number: [`docs/enemies.csv`](docs/enemies.csv) and [`docs/waves.csv`](docs/waves.csv),
generated from the code with `npm run stats`. The elf has **100 HP**; arrows do 10.

**The Woodland** — forest beasts (all melee):

| | Tier | HP | Damage | Special |
| --- | --- | --- | --- | --- |
| Armored Beetle | weak | 10 | 8 | swarms |
| Venomous Snake | normal | 25 | 10 | coils, then lunges (18) |
| Dire Wolf | tough | 45 | 15 | very fast; bites, backs off, comes again |
| Thorn Boar | elite | 80 | 15 | paws the ground, then charges (30); dazed if it hits a tree or wall |
| Crystal Bear | mini-boss | 300 | 20 | swipe (25), ground pound with warning ring (25), roars in beetles at half health |

**The dungeon** — slimes:

| | HP | Damage | Special |
| --- | --- | --- | --- |
| Small slime | 10+ | 20 | — |
| Big slime | 40+ | 35 | — |
| Spitter | 20+ | 15 | keeps its distance and spits globs (20) |
| 👑 King Slime | 900 | 30 | leaping slam with warning ring (30), 5-glob volleys, splits off small slimes |

Waves get bigger, faster and tougher room by room (`roomWaveDifficulty` in `src/world/rooms.ts` feeds `waveSpec` in
`src/game/combat.ts`). Health and damage numbers live in `src/game/balance.ts`, `SLIME_KINDS` (`enemies.ts`) and
`BEASTS` (`beasts.ts`).

## Playing together (asymmetric co-op)

Two roles:

- **Hero (the elf)** plays as usual on a computer (or phone). The title screen shows a room code and a QR code.
- **Familiar** scans the QR code or opens the link (`…/?join=CODE`) on a tablet, or types the code under
  "Got a code?", then **picks a creature**. Tap or drag on the floor to move — it bites any slime it touches.
  Spell buttons have their own cooldowns. The creature can be changed between runs or while the elf is paused.

| Familiar | Speed | Spells |
| --- | --- | --- |
| 🦀 Crab | medium | ✨ **Magic Burst** — stun every slime within 5.5 m for 2.5 s (12 s) · 🐚 **Shell Shield** — the elf gets a bubble that blocks the next hit (18 s) |
| 🦫 Capybara | slow | ♨️ **Soothing Spring** — a 6 m pool for 6 s: slimes in it are 60% slower, the elf heals 1 heart in it (16 s) · 🌸 **Calm Aura** — slimes within 7 m stop chasing and wander off, harmless, for 5 s (14 s) |
| 🐺 Wolf | fast | 🐾 **Pounce** — leap up to 10 m toward where you tapped, 2 damage to every slime on the way (8 s) |

Solo is just the elf; the familiar only appears while a second player is connected.

The capybara and wolf use placeholder low-poly bodies built in code. Drop `capybara.glb` / `wolf.glb` into
`public/models/` and they're used automatically (scaled to fit and animated as a whole). Card art lives in
`public/art/`.

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
npm run stats    # regenerate docs/enemies.csv and docs/waves.csv from the code
npm run balance  # difficulty simulator: bots play headlessly (needs `npm run dev` + Chrome)
```

## Hosting

`render.yaml` is a [Render](https://render.com) Blueprint for a free web service (game + WebSocket server on one
URL; free instances sleep when idle and take ~30-60 s to wake). The GitHub Pages copy is built with
`VITE_SERVER_URL` pointing at it (read from `.server-url` by `npm run deploy`).

## How it's put together

- `src/world/rooms.ts` — the six rooms and the run's progression; `src/world/dungeon.ts` builds a room: instanced floor
  tiles and wall bricks, gates and doors, pillars, its centrepiece, torches.
- `src/player/elf.ts`, `src/player/crab.ts` — the two glTF models (`public/models/`). They're static, unrigged
  meshes, so `src/player/rig.ts` groups their named parts under pivots and the classes animate them in code.
- `server/` — room manager (`rooms.ts`, unit tested) and the HTTP + WebSocket server (`index.ts`).
- `src/net/` — wire protocol, reconnecting client sessions, and snapshots with interpolation (unit tested).
- `src/familiar/` — the familiar's tablet view: creature picker, top-down camera, tap-to-move, spell buttons, HUD.
- `src/game/familiars.ts` — the creature roster and spells (data + pure math); `src/player/beasts.ts` — their bodies.
- `src/player/controls.ts` — third-person camera and movement (mouse or touch input); `src/ui/touch.ts` — on-screen touch controls.
- `src/game/` — the game loop, slimes (small, big, spitter), arrows and spitter globs, crab companion AI,
  particles, power-ups (`powerups.ts` rules, `pickups.ts` visuals), sound (WebAudio, no files: effects plus
  positional fire ambience), high score, and pure
  combat helpers in `combat.ts` including the wave difficulty curve (unit tested).
