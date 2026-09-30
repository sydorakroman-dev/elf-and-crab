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
| M | Mute |
| Esc | Pause |

On phones and tablets (touch-first devices) the game shows on-screen controls instead:
left thumb moves (floating joystick), right thumb drags the camera, hold 🏹 to shoot, tap 💨 to dash.
Aim assist is wider on touch.

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
npm run dev      # http://localhost:5173
npm test         # unit tests (Vitest)
npm run build    # production build in dist/
npm run deploy   # build and publish to GitHub Pages (gh-pages branch)
npm run balance  # difficulty simulator: bots play headlessly (needs `npm run dev` + Chrome)
```

## How it's put together

- `src/world/dungeon.ts` — the arena: instanced floor tiles and wall bricks, gates, pillars, torches.
- `src/player/elf.ts`, `src/player/crab.ts` — the two glTF models (`public/models/`). They're static, unrigged
  meshes, so `src/player/rig.ts` groups their named parts under pivots and the classes animate them in code.
- `src/player/controls.ts` — third-person camera and movement (mouse or touch input); `src/ui/touch.ts` — on-screen touch controls.
- `src/game/` — the game loop, slimes (small, big, spitter), arrows and spitter globs, crab companion AI,
  particles, power-ups (`powerups.ts` rules, `pickups.ts` visuals), sound (WebAudio, no files: effects plus
  positional fire ambience), high score, and pure
  combat helpers in `combat.ts` including the wave difficulty curve (unit tested).
