# Elf & Crab

A third-person WebGL dungeon crawler built with [Three.js](https://threejs.org), Vite and TypeScript.
An elf archer fights through a forest and five dungeon levels of cave dwellers, undead, orcs, goblins and elementals — solo, or with a friend
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

## Difficulty, progress and options

- **Difficulty:** 🌱 Easy (monsters 65% HP, 55% damage, half score), ⚔️ Normal, 🔥 Hard (135% HP, 130% damage,
  1.5× score) — picked on the title screen and remembered.
- **Continue:** the furthest level you've reached is remembered; the title screen then lets you **start in** any level up
  to it. Beating the Ash King on a difficulty earns a trophy shown on the title screen.
- **Music:** every level has its own theme (composed in code, like the sound effects), switching to a heavier version
  during boss fights. **M** mutes everything.
- **Feedback:** damage numbers over every hit, camera shake on heavy hits and slams, a brief freeze on big blows.
- **Performance:** models are compressed at build time and level art loads one level ahead (first load ~5 MB). If a
  device keeps dropping below ~40 fps the game lowers its resolution, then turns shadows off.

## Rune Seals (the familiar's puzzles)

When a level's guardian falls with a familiar connected, runes seal the exit door: the familiar solves **3 rune riddles** on
the tablet — sums and differences like `7 + 8` or `9 − 4`, single digits 1–9, never 0, answers up to 15 — by tapping the right
one of four rune stones (a wrong stone swaps in a new riddle). Breaking the seal opens the door and heals the elf +20 HP. Solo
play and the final level have no seal. In the practice room, the 🔮 button starts one any time.

## Skills and spells

The elf has **stamina** (5 charges, one back every 4 s) and **mana** (a 100-point bar, refilling 4 per second).
Skills cost stamina, spells cost mana. Nine action slots, used with keys **1–9** (rebind them under **⚙️ Keys** on
the title / pause screen; saved in your browser); on touch screens, tap the slots.

| Slot | | Cost | |
| --- | --- | --- | --- |
| 1 | 💨 **Dash** (also Space) | 1 stamina | a quick dash; you can't be hit while dashing |
| 2 | 🌬️ **Wind Walk** | 2 stamina | invisible for 3 s: enemies lose track of you and head for where you vanished; shooting breaks it |
| 3 | 🏹 **Double Shot** | 1 stamina | the next 3 shots fire two arrows side by side |
| 4–9 | spells | mana | learned from **spell books** (below) |

### Spells and loot

Monsters drop **gold** (more from tough ones, guardians and later levels) and now and then a **spell book**;
guardians always drop one, and **treasure chests** in the levels' dead-end side rooms hold gold and often a book.
Coins fly to whoever's near — the familiar can pick up loot too, for the party. A book teaches a new spell into the
first free slot (4–9), or raises one you know a rank (I → II → III); once all six slots are full, books only rank up.

| Spell | Mana | Rank I (II and III are stronger) |
| --- | --- | --- |
| 🔥 Fire Arrows | 20 | the next 3 shots explode on hit (14 damage round them) |
| ❄️ Frost Arrows | 20 | the next 3 shots slow foes to half speed for 3 s (rank III also freezes) |
| ⚡ Chain Shot | 30 | the next 3 shots arc lightning on to 2 more foes |
| ✨ Arcane Volley | 45 | a fan of 7 piercing arcane arrows |
| 🌿 Entangling Roots | 30 | roots every foe in a 4 m circle ahead for 2 s |
| 🧊 Frost Nova | 35 | freezes every foe within 6 m for 1.5 s (10 damage) |
| 💚 Healing Bloom | 40 | heals 30 over 5 s |
| 🌳 Bark Skin | 35 | take 40% less damage for 6 s |

### Gear, the bag and the merchant

Monsters, guardians and chests also drop **gear** — common (white), rare (blue) or epic (purple), with more and
bigger bonuses the rarer it is and the later the level — and **potions**. Everything goes into the party's
**16-slot bag** (**I** or **B**, or the 🎒 button; on the tablet too). Tap an item to see it (compared with what's
worn), then equip it, drink it or drop it. **Q** / **E** drink a health / mana potion.

| Slot | Can roll |
| --- | --- |
| 🏹 Bow · 🦺 Armor · 👢 Boots · 📿 Amulet · 💍 Ring (the elf) | arrow damage, attack speed, critical shots, max health, armor, move speed, mana and stamina regen |
| 🎀 Collar · 🍀 Charm (the familiar) | familiar damage, shorter familiar cooldowns, familiar speed |

Through the exit door you reach the **merchant's camp**: four pieces of gear, two potions and a spell book for sale,
and anything in the bag sells for 30% of its worth. Both players can buy from the shared purse; the elf decides when
to move on. The bag pauses a solo game; with a familiar along, the game keeps going.

## The run

Seven **levels**, each **generated afresh every run** (`src/world/levelgen.ts`, seeded — your familiar's tablet
builds the same level from the seed): about 160 × 160 m, three times the old rooms. Dungeon levels are **halls
joined by corridors** (square, round and eight-sided halls, loops, dead-end side rooms); the Woodland and the
Flooded Hall are **open ground** — glades and flooded caverns joined by wide trails.

You arrive in the south. **Packs** of 3–6 monsters wait asleep around the level and wake when you come into view
(or hit one); awake, they hunt you round the walls along the shortest way. The level's **guardian** (a mini-boss and
its escort) holds the big hall in the north; beat it and the **exit door** behind it opens — walk through to the next
level (your familiar comes along, and you're healed to full). Other packs can be left behind. Out of a fight for a
few seconds, the elf's health comes back. A **map** in the top right fills in as you explore. Walls and trees between
the camera and the elf turn see-through.

The run waits in the Woodland until you're ready — press **Enter** (or tap **Start**) and the monsters stir; handy
while a friend joins as your familiar. Every level opens with an intro card — its foes' illustration
(`public/art/`), name and guardian — and a random one shows while the game loads. The last level ends with **the
Ash King**, a volcanic dragon; beat him to win.

| Level | Who lives there | Guardian |
| --- | --- | --- |
| 1 · The Woodland — open woods and glades, hedges | forest beasts, thorn vines, a treant | 🐻 The Crystal Bear |
| 2 · The Crystal Cave — halls and corridors, glowing crystal clusters | underworld dwellers | 🪱 The Giant Cave Worm |
| 3 · The Crypt — halls and corridors, torches, braziers, pillars | the undead | 💀 The Necromancer |
| 4 · The Throne Room — square halls, colonnades, the throne in the guardian's hall | orcs | 🪓 The Orc Chieftain |
| 5 · The Flooded Hall — open flooded caverns: ankle-deep water, ripples, waterfalls, floating debris | goblins, water elementals | ⚙️ The Scrap Boss |
| 6 · The Lava Chamber — halls with lava pits (arrows fly over them) | fire and wind elementals, rock golems | 🔥 The Inferno |
| 7 · The Ash King's Lair — a long approach to a vast round hall: obsidian spires, lava pools, lavafalls, a rune circle | — (the dragon alone) | 🐉 **The Ash King** (final boss) |

## Enemies

Full tables with every number: [`docs/enemies.csv`](docs/enemies.csv) and [`docs/levels.csv`](docs/levels.csv),
generated from the code with `npm run stats`. The elf has **100 HP**; arrows do 10. Each level's group is tougher than
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

**The Ash King's Lair — the final boss**, alone in his hall (he calls in fire elementals himself)

| | Tier | HP | Damage | Special |
| --- | --- | --- | --- | --- |
| **🐉 The Ash King** | final boss | 2600 | 24–34 | a volcanic dragon: wing slam around himself (warning ring, leaves fire), swoops across the lair from 9 m+, 9-fireball breath fans, falling ash where you stand (burning ground), bites; calls 3 fire elementals at 2/3 and 1/3 health |

The models (`public/models/`) are static, part-named meshes; `src/game/monsterVisual.ts`, `beastVisual.ts` and
`elementalVisual.ts` rig them in code. Health and damage live in `src/game/balance.ts` and the `BEASTS`
(`beasts.ts`), `ELEMENTALS` (`elementals.ts`) and `MONSTERS` (`monsters.ts`) tables; each level's monster mix, pack size and guardian in
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
  Spell buttons have their own cooldowns. The corners button in the top bar puts the browser in **full screen** (tap again
  to leave); it's hidden where the browser can't do it — iPhone Safari, or when opened from the home screen, which is already full screen.
- **Full screen:** the ⛶ button in the tablet's top bar. On iPad / iPhone (every browser there runs on Safari's
  engine, whose full screen folds away when you drag down) it explains how to add the game to the Home Screen
  instead — opened from there it runs full screen as an app.
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
| 🦎 Iguana | medium | 👅 **Tongue Lash** — yanks the nearest enemy within 9 m over to the iguana and stuns it 1.5 s (bosses just flinch) (3.6 s) · 💚 **Jade Ward** — a jade circle around the elf for 5 s: heals 6 HP/s and slows enemies in it by 40% (5.6 s) |

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
npm run stats    # regenerate docs/enemies.csv and docs/levels.csv from the code
npm run balance  # difficulty simulator: bots play headlessly (needs `npm run dev` + Chrome)
```

## Hosting

`render.yaml` is a [Render](https://render.com) Blueprint for a free web service (game + WebSocket server on one
URL; free instances sleep when idle and take ~30-60 s to wake). The GitHub Pages copy is built with
`VITE_SERVER_URL` pointing at it (read from `.server-url` by `npm run deploy`).

## How it's put together

- `src/world/rooms.ts` — the six rooms and the run's progression; `src/world/dungeon.ts` builds a room: instanced floor
  tiles and wall bricks, gates and doors, pillars, its centrepiece, torches.
- `src/player/elf.ts`, `src/player/crab.ts`, `src/player/beasts.ts` — the hero and the familiars (the iguana is an imported
  Blender model, renamed and simplified by `node scripts/models/prepare-iguana.mjs`)
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
