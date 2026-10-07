---
name: world-building
description: Design rules and a review checklist for Elf & Crab's levels and map — generated layouts (src/world/levelgen.ts), how they're dressed and lit (src/world/dungeon.ts), level themes (src/world/rooms.ts), the minimap, packs, chests and the exit. Use when adding or changing levels, layouts, props, landmarks, loot placement or the minimap, or when asked to review the world / map design.
---

# World and map building — Elf & Crab

Levels are generated each run from a theme and a seed (`generateLevel` in `src/world/levelgen.ts`),
drawn by `Dungeon` (`src/world/dungeon.ts`) and themed by `ROOMS` (`src/world/rooms.ts`). A level is
a tall 200 × 400 m rectangle of 2 m tiles: the elf starts in the south, the guardian's hall and
exit door are at the very north. Halls (`Hall.kind`: start / normal / treasure / boss) are joined
by corridors, or (Woodland, Flooded Hall) carved out of noisy open ground. Packs sleep and roam
near their spot; the familiar's tablet rebuilds the same level from the seed, so **everything
the generator places must come from the seeded rng**.

Apply the eight rules below to every change. Each rule says what it means here, how to do it in
this code, and what to check.

## 1. Landmarks players can recognise and navigate by

The camera sees ~40–60 m through fog; the minimap shows 140 m round the elf. A player must be
able to say "I'm past the big tree, the guardian is north of the ruined statue".

- Give every level **2–4 named landmarks** (unique, tall, lit, readable from afar): one near the
  start, one or two mid-level, one marking the guardian's hall. Make them a `Prop` kind with a
  distinctive silhouette (height > wall height, own colour / light / glow sprite) rather than
  another copy of a common prop.
- Put landmarks at **junctions and big halls**, not in corridors; keep them out of `keepClear`.
- The guardian's hall should be **visible as a goal** from far off (a light column, smoke, a glow
  over the walls) so "north" means something before the minimap shows it.
- Mark discovered landmarks on the minimap (`MinimapMarks`) with their own icon.
- Check: from any hall, is a landmark (or the goal glow) within ~60 m and in sight?

## 2. Visual and mechanical differences between regions

Levels already differ by theme (colours, fog, props, monsters, music). Inside a level, halls
should not all look and play alike.

- Give halls a **role** from the theme (e.g. Crypt: ossuary, chapel, catacomb; Throne Room:
  barracks, armory, feast hall; Lava: forge, magma channels; Woodland: glade, thicket, pond,
  ruins). Store it on `Hall` and let `decorate()` dress by role, not just by theme.
- A role should change **play**, not only looks: cover (pillars), hazards (lava, deep water,
  poison), sight lines, tight vs open space, which monsters live there (bias `populate()`'s pool
  by role: archers in galleries, brutes in barracks).
- Vary floor / wall tint slightly per region (`Dungeon` per-instance colours) so a glance tells
  regions apart.
- Check: pick two random halls — can you tell them apart in a screenshot, and do they fight
  differently?

## 3. Multiple routes where possible

- Keep loops: `connect()` = minimum spanning tree + `extra` short edges. Short edges make local
  loops; also guarantee **at least two macro routes** from the start to the guardian (e.g. a
  west and an east lane that only meet near the start and the boss hall).
- Routes should **differ in character**: a long safe way vs a short dangerous one, a hazard vs a
  pack, a dark corridor vs open ground.
- Never let a route depend on something that might not be there (props must not block a
  corridor: `prop()` checks `map.clear(x, z, r + 0.8)`; keep it that way).
- Check (tests in `levelgen.test.ts`): everything reachable; the guardian reachable by ≥ 2 paths
  that don't share most tiles (remove the shortest path's tiles and BFS again).

## 4. Hide some locations instead of marking everything

- The minimap only shows what has been **seen** (`Minimap.reveal`, line of sight); keep it so.
  Don't mark chests, packs or side rooms before they're found.
- Add **secrets**: a side room behind a breakable / hidden wall, a chest in a thicket, a nook
  behind a waterfall. Generate them as real floor (reachable) but with a cue that rewards the
  observant (a crack in the wall, a glint, a draught of particles).
- The tablet player is a natural scout: let the familiar notice and reveal secrets.
- Check: a fresh level shows only the start area on the minimap; at least one location per
  level is not visible from any main corridor.

## 5. Reward going off the obvious path

The obvious path is the shortest walk start → guardian (`map.distanceField`).

- Place rewards by **detour**: measure each spot's extra distance from that path; treasure rooms,
  chests, shrines, elite packs with better drops and rare monsters go where the detour is large.
  Scale chest loot (`chestLoot`) with the detour.
- Dead ends must never be empty — every dead end ends in something (chest, shrine, lore, view).
- Check: average reward value off-path > on-path; no dead end without a reward.

## 6. Connect locations to history, economy, factions and geography

Each level is a faction's home (woodland beasts, underworld dwellers, undead, orcs, goblins,
elementals, the Ash King). Make its layout explainable:

- **Geography**: water flows downhill to the Flooded Hall's pools; lava channels lead to the
  forge; the woods thin toward ruins; the crypt grows deeper (darker, narrower) going north.
- **History / economy**: orcs have barracks near the throne, storerooms with loot, a kitchen;
  goblins have workshops (scrap piles, gears) where riveters gather; the crypt has an old chapel
  the necromancer took over. Put matching props and the right monsters there.
- **Factions**: border zones between factions can show conflict (bodies, broken barricades).
- The intro card (`ui/shared.ts`) and level names should hint at this story.
- Check: for each hall role, one sentence says why it is there and who uses it.

## 7. Dense, meaningful areas over large empty ones

Bigger is not better by itself; every 50 m of walking should offer something: a fight, a choice,
a sight, a pickup, a landmark.

- Prefer **more, smaller, fuller halls** over huge open fields. Corridors should be short or
  have something in them (a pack, a hazard, a view into a hall).
- Watch the open layouts (Woodland / Flooded Hall are ~57 000 m² of mostly open ground): break
  them into clearings with clear edges, fill clearings, and cut dead space with thickets / rock.
- Rough density targets: one encounter or point of interest per ~600–900 m² of floor; no stretch
  of walkable floor longer than ~50 m with nothing in it.
- Check (script): count packs + props of interest + chests per hall and per 1000 m²; list long
  empty corridors (distance-field runs with no interest point near).

## 8. Let locations change because of player actions

The world should answer the player:

- Already here: the exit opens when the guardian dies (or after the Rune Seal), chests open and
  stay open (`Snapshot.ch`), packs wake and leave their spot.
- Add: cleared halls become **safe** (braziers relight, a camp / merchant appears), the guardian's
  death changes the level (lava cools, the necromancer's chapel's undead crumble, the orc banners
  fall), switches open shortcuts back to the start, a broken bridge or collapsed corridor, a
  freed prisoner who later sells or helps.
- Every change must be **synced to the tablet** (snapshot field or event) and deterministic from
  the seed + what happened.
- Check: list the changes a player can cause in a level; each is visible, persists, and shows on
  both screens.

## How to work on it here

- Generator: `src/world/levelgen.ts` (pure, seeded — never `Math.random` there). Halls, corridors,
  `decorate()` for props, `populate()` for packs, `treasureRooms()`, `exitAlcove()`.
- Drawing: `src/world/dungeon.ts` (`buildProp` per `PropKind`, `buildFeature` per theme, chunks
  and `nearOnly` culling — keep far things undrawn).
- Themes and numbers: `src/world/rooms.ts` (pool, guardian, escort, foes, layout, shapes).
- Minimap: `src/ui/minimap.ts`; marks come from `Game.updateMinimap` and the tablet's `apply`.
- Collision: `src/game/walkmap.ts` (tile floor, `clear`, `raycast`, `distanceField`).
- Tests: `src/world/levelgen.test.ts` (connected, sizes, guardian north, packs away from start,
  determinism). Add a test for every new rule you rely on.
- Look at it: the scratchpad Playwright scripts (overhead shots, hero-camera shots per level),
  `npm run balance`, and the dev FPS panel — big levels must stay ~50+ FPS.
- Keep performance: new props share geometry / materials (`once()`), go in `nearOnly`, and use
  the pooled lights, not new `PointLight`s.

## Review checklist

For a review, score each rule 0–3 (absent / weak / fair / strong), cite the code, and give the
two or three changes with the best value for effort:

1. Landmarks — distinct, tall, lit, at junctions, on the minimap, goal visible from afar?
2. Regions — hall roles that change looks and play?
3. Routes — loops and ≥ 2 distinct macro routes to the guardian?
4. Hidden — fog-of-war map, real secrets with cues?
5. Off-path rewards — rewards scale with detour, no empty dead ends?
6. World logic — layout and props explained by faction, history, geography?
7. Density — points of interest per area, no long empty stretches?
8. Change — what the player can change, persistent and synced?
