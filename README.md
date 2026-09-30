# Elf & Crab

A small third-person WebGL arena game built with [Three.js](https://threejs.org), Vite and TypeScript.
An elf archer and her crab companion hold off waves of slimes pouring out of a dungeon's gates.

**Play:** https://sydorakroman-dev.github.io/elf-and-crab/

## Controls

| Input | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Orbit camera / aim |
| Click (hold) | Shoot |
| Space | Dash (invulnerable while dashing) |
| Scroll | Zoom |
| Esc | Pause |

## Development

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests (Vitest)
npm run build    # production build in dist/
npm run deploy   # build and publish to GitHub Pages (gh-pages branch)
```

## How it's put together

- `src/world/dungeon.ts` — the arena: instanced floor tiles and wall bricks, gates, pillars, torches.
- `src/player/elf.ts`, `src/player/crab.ts` — the two glTF models (`public/models/`). They're static, unrigged
  meshes, so `src/player/rig.ts` groups their named parts under pivots and the classes animate them in code.
- `src/player/controls.ts` — third-person camera and movement.
- `src/game/` — the game loop, slimes, arrows, crab companion AI, particles, sound (WebAudio, no files),
  and pure combat helpers in `combat.ts` (unit tested).
