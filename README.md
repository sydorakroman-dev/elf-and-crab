# Elf & Crab

A small third-person WebGL arena game built with [Three.js](https://threejs.org), Vite and TypeScript.
An elf archer fights through a forest and five dungeon rooms of cave dwellers, undead, orcs, goblins and elementals — solo, or with a friend
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

The run waits in the Woodland until you're ready — press **Enter** (or tap **Start**) and the first wave comes; handy
while a friend joins as your familiar. Seven rooms, three waves each (the last room has just one: its boss); every room's last wave brings its boss. Clear a room and its north door opens — walk
through to the next one (your familiar comes along, and you're healed to full). Every room opens with an intro
card — its foes' illustration (`public/art/`), name and boss — and a random one shows while the game loads. The last room ends with **the
Ash King**, a volcanic dragon; beat him to win.

| Room | Who lives there | Boss |
| --- | --- | --- |
| 1 · The Woodland — a round, sunny clearing, trees, hedges | forest beasts, thorn vines, a treant | 🐻 The Crystal Bear |
| 2 · The Crystal Cave — eight-sided, glowing crystal clusters | underworld dwellers | 🪱 The Giant Cave Worm |
| 3 · The Crypt — square, torches, a brazier, four pillars | the undead | 💀 The Necromancer |
| 4 · The Throne Room — square, a colonnade and a throne | orcs | 🪓 The Orc Chieftain |
| 5 · The Flooded Hall — eight-sided, pillars, cold light, puddles | goblins, water elementals | ⚙️ The Scrap Boss |
| 6 · The Lava Chamber — round, a lava pit (arrows fly over it) | fire and wind elementals, rock golems | 🔥 The Inferno |
| 7 · The Ash King's Lair — a vast round hall: obsidian spires, lava pools and lavafalls, a rune circle | — (one wave: the dragon alone) | 🐉 **The Ash King** (final boss) |

## Enemies

Full tables with every number: [`docs/enemies.csv`](docs/enemies.csv) and [`docs/waves.csv`](docs/waves.csv),
generated from the code with `npm run stats`. The elf has **100 HP**; arrows do 10. Each room's group is tougher than
the last.

**Woodland — forest beasts and living plants** (all melee)

| | Tier | HP | Damage | Special |
| --- | --- | --- | --- | --- |
| Armored Beetle | weak | 10 | 8 | swarms |
| Venomous Snake | normal | 30 | 10 | coils, then lunges (18) |
| Dire Wolf | tough | 50 | 15 | very fast; bites, backs off, comes again |
| Thorn Boar | elite | 90 | 15 | paws the ground, then charges (30); dazed if it hits a tree or wall |
| Thorn Vine | normal | 22 | 10 | lashes from 3 m |
| Treant | elite | 90 | 16 | roots erupt where you stand, after a warning ring, and slow |
| **Crystal Bear** | boss | 450 | 22 | fast; swipe (28), ground pound with warning ring (25) that flings 8 crystal shards, a charge from afar (26; dazed if it hits a tree); at half health roars in 6 beetles and enrages |

**Crystal Cave — underworld dwellers** (critters of the deep: poison and acid)

| | Tier | HP | Damage | Special |
| --- | --- | --- | --- | --- |
| Cave Spider | normal | 22 | 12 | leaps at you |
| Cave Slime | normal | 28 | 9 | acid spit that slows you |
| Spore Crawler | normal | 25 | 8 | spore bombs leave poison clouds (6 HP/s) |
| Mushroom Monster | tough | 55 | 14 | poison spore burst around itself |
| Living Mold | elite | 80 | 18 | slow, hard punch; regrows when you stop hitting it |
| **Giant Cave Worm** | boss | 420 | 18 | burrows (can't be hit), bursts up under you after a warning ring; acid fans; calls spiders |

**Crypt — the undead**

| | Tier | HP | Damage | Special |
| --- | --- | --- | --- | --- |
| Skeleton Warrior | normal | 35 | 14 | sword slash |
| Skeleton Archer | normal | 30 | 13 | arrows from afar |
| Ghost | normal | 30 | 12 | floats straight through pillars |
| Zombie Brute | tough | 105 | 25 | slow; fist slam |
| Undead Knight | elite | 150 | 22 | its shield halves arrows to the front — hit it from the side |
| **Necromancer** | boss | 575 | 14 / 20 | 5-bolt soul volleys, soul blasts at your spot; raises skeletons every 10 s |

**Throne Room — orcs**

| | Tier | HP | Damage | Special |
| --- | --- | --- | --- | --- |
| Orc Scout | normal | 40 | 12 | fast; stabs, then backs off |
| Orc Archer | normal | 50 | 13 | arrows from afar |
| Orc Warrior | tough | 70 | 20 | axe swing |
| Orc Shaman | tough | 55 | 12 | magic bolts; heals nearby orcs (green ring) — kill it first |
| Orc Shield Guard | elite | 170 | 22 | its shield blocks almost every arrow to the front |
| **Orc Chieftain** | boss | 745 | 28 / 30 | hammer swings, ground slam with warning ring, long charges; war-cry brings 3 warriors |

**Flooded Hall — goblins and water elementals** (quick, well-armed tinkerers with nasty gadgets)

| | Tier | HP | Damage | Special |
| --- | --- | --- | --- | --- |
| Scrap Brawler | normal | 45 | 18 | mechanical-fist punch |
| Rotor Scout | normal | 40 | 20 | flies; dives at you |
| Rivet Shooter | normal | 50 | 14 | keeps its distance, fires rivets |
| Bomb Lobber | tough | 55 | 26 | bombs land where you stand, after a warning ring |
| Boiler Tinkerer | elite | 130 | 24 | steam burst around itself |
| Water Elemental | normal | 65 | 12 | water bolts that slow you for 2 s |
| **Scrap Boss** | boss | 950 | 32 | stomp shockwave, mech punches; drops 4 brawlers at 2/3 and 1/3 health |

**Lava Chamber — fire, wind and stone elementals**

| | Tier | HP | Damage | Special |
| --- | --- | --- | --- | --- |
| Wind Elemental | normal | 65 | 8 | gust bolts with a big shove |
| Fire Elemental | tough | 105 | 15 | fireballs that leave burning ground (10 HP/s) |
| Rock Golem | elite | 255 | 30 | slow; heavy punch with huge knockback |
| **The Inferno** | final boss | 1380 | 30 / 15 / 22 | flame ring around itself, 5-fireball fans, meteors at your spot (all leave fire); calls fire elementals |

**The Ash King's Lair — the final boss**, alone in a single wave (he calls in fire elementals himself)

| | Tier | HP | Damage | Special |
| --- | --- | --- | --- | --- |
| **🐉 The Ash King** | final boss | 2600 | 24–34 | a volcanic dragon: wing slam around himself (warning ring, leaves fire), swoops across the lair from 9 m+, 9-fireball breath fans, falling ash where you stand (burning ground), bites; calls 3 fire elementals at 2/3 and 1/3 health |

The models (`public/models/`) are static, part-named meshes; `src/game/monsterVisual.ts`, `beastVisual.ts` and
`elementalVisual.ts` rig them in code. Health and damage live in `src/game/balance.ts` and the `BEASTS`
(`beasts.ts`), `ELEMENTALS` (`elementals.ts`) and `MONSTERS` (`monsters.ts`) tables; each room's waves in
`src/world/rooms.ts`.

## Playing together (asymmetric co-op)

Two roles:

- **Hero (the elf)** plays as usual on a computer (or phone). The title screen shows a room code and a QR code.
- **Familiar** scans the QR code or opens the link (`…/?join=CODE`) on a tablet, or types the code under
  "Got a code?", then **picks a creature**. The view is third person, following your creature and always facing north;
  arrows at the screen edge point to the elf and the boss when they're off screen, and trees and pillars in the way
  fade out, as does the bottom (south) wall — to half see-through — when the creature is near it. Touch anywhere and drag to steer — a virtual joystick appears under
  your finger (drag further to run faster, let go to stop); it bites any enemy it touches. It can grab power-ups too — they go
  straight to the elf. Familiars
  can't be hurt: monsters only ever go for the elf.
  Spell buttons have their own cooldowns.
- **Practice room:** type **TEST** as the code (or open `…/?join=TEST`) to practise as the familiar on your own:
  no server, no other player, no monsters. The elf stands in the Woodland (a little hurt, so heals show),
  power-ups drop every few seconds, and the creature can be swapped any time. The **👾 Monsters**
  button brings in any monster or boss from the game, behaving just as in its room — but here the elf can't die. The hero's game runs hidden in
  the same browser (`src/net/local.ts`).
 The creature can be changed between runs or while the elf is paused.

| Familiar | Speed | Spells |
| --- | --- | --- |
| 🦀 Crab | medium | ✨ **Magic Burst** — stun every enemy within 5.5 m for 2.5 s (2.8 s) · 🐚 **Shell Shield** — the elf gets a bubble that blocks the next hit (4.4 s) |
| 🦫 Capybara | slow | ♨️ **Soothing Spring** — a 6 m pool for 6 s: enemies in it are 60% slower, the elf heals 1 heart in it (4 s) · 🌸 **Calm Aura** — enemies within 7 m stop chasing and wander off, harmless, for 5 s (3.2 s) |
| 🐺 Wolf | fast | 🐾 **Pounce** — leap up to 10 m the way it's heading, 25 damage to every enemy on the way (2 s) · 🌕 **War Howl** — enemies within 8 m panic and flee for 3 s (bosses only flinch), and the elf gets Rapid fire for 5 s (5.6 s) |
| 🐠 Goldfish | medium | 🫧 **Bubble Shield** — the elf gets a bubble that blocks the next 2 hits (5.6 s) · 💦 **Water Jet** — a 7 m blast of water ahead: 6 damage, knocks enemies ~5 m back and slows them by half for 3 s (3.2 s) |

Solo is just the elf; the familiar only appears while a second player is connected.

The capybara and wolf use placeholder low-poly bodies built in code. Drop `capybara.glb` / `wolf.glb` into
`public/models/` and they're used automatically (scaled to fit and animated as a whole). Card art lives in
`public/art/`.

How it works: the hero's browser runs the game and streams snapshots (20/s) to the familiar, who sends back taps.
The small Node server in `server/` only manages rooms and relays messages over WebSockets (`/ws`), and also serves
the built game, so one URL does everything.

## Power-ups

They appear at random on the floor every 10-18 s (max two at a time, gone after 14 s) and are sometimes
dropped by defeated enemies (tougher ones more often). Walk over one to collect it; timed ones stack and extend.

| | Power-up | Effect |
| --- | --- | --- |
| 🔱 | Multishot | 3 arrows in a spread (12 s) |
| ⚡ | Rapid fire | Double fire rate (10 s) |
| ➶ | Piercing arrows | Arrows pass through every enemy in a line (12 s) |
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
- `src/player/elf.ts`, `src/player/crab.ts`, `src/player/beasts.ts` — the hero and the three familiars
  (`public/models/`; the familiars are built by `node scripts/models/build-familiars.mjs`). They're static, unrigged
  meshes, so `src/player/rig.ts` groups their named parts under pivots and the classes animate them in code. The elf
  is built by `scripts/models/build-elf.mjs` (`node scripts/models/build-elf.mjs`; shapes and the GLB writer in
  `scripts/models/kit.mjs`), and drawn in a cartoon style — toon shading and outlines (`src/player/toon.ts`), like the familiars.
- `server/` — room manager (`rooms.ts`, unit tested) and the HTTP + WebSocket server (`index.ts`).
- `src/net/` — wire protocol, reconnecting client sessions, and snapshots with interpolation (unit tested).
- `src/familiar/` — the familiar's tablet view: creature picker, top-down camera, tap-to-move, spell buttons, HUD.
- `src/game/familiars.ts` — the creature roster and spells (data + pure math); `src/player/beasts.ts` — their bodies.
- `src/player/controls.ts` — third-person camera and movement (mouse or touch input); `src/ui/touch.ts` — on-screen touch controls.
- `src/game/` — the game loop; enemies: forest beasts (`beasts.ts`), nature elementals (`elementals.ts`), and the
  data-driven monsters and bosses (`monsters.ts`: stats plus shared attacks — melee, shoot, area, lunge, burrow),
  spawned by `enemies.ts`; arrows and enemy bolts (`globs.ts`), ground zones (`zones.ts`), crab companion AI,
  particles, power-ups (`powerups.ts` rules, `pickups.ts` visuals), sound (WebAudio, no files: effects plus
  positional fire ambience), high score, and pure combat helpers in `combat.ts` (unit tested).
