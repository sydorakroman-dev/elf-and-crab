// Difficulty simulator: runs the real game loop headlessly (no rendering) with two bot players
// and reports which wave they die on. Needs `npm run dev` running and Google Chrome installed.
//   npm run balance            # 6 runs per bot
//   npm run balance -- 10      # 10 runs per bot
// Bots: "stand" never moves (a weak player); "kite" strafes, backs off, dashes out of melee and
// through incoming globs (a decent one).
// Both aim perfectly at the nearest slime, so real players will take hits earlier.
import { chromium } from 'playwright-core';
const TRIALS = +(process.argv[2] ?? 6);
const URL = process.env.GAME_URL ?? 'http://localhost:5173/';
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL);
await page.waitForFunction(() => window.__game, null, { timeout: 20000 });
const results = await page.evaluate(({ TRIALS }) => {
  const g = window.__game;
  const run = (style) => {
    g.newGame();
    const p = g.player;
    p.locked = true;
    p.mouseDown = true;
    const maxSteps = 60 * 600; // 10 minutes of game time
    const firstHitWave = { v: null };
    let lastHealth = g.health;
    let step = 0;
    for (; step < maxSteps && g.state === 'playing'; step++) {
      const pos = p.position;
      const alive = g.enemies.slimes.filter((s) => s.alive);
      p.keys.clear();
      if (alive.length) {
        alive.sort((a, b) => Math.hypot(a.x - pos.x, a.z - pos.z) - Math.hypot(b.x - pos.x, b.z - pos.z));
        const t = alive[0];
        p.yaw = Math.atan2(-(t.x - pos.x), -(t.z - pos.z));
        if (style === 'kite') {
          const d = Math.hypot(t.x - pos.x, t.z - pos.z);
          p.keys.add('KeyA');
          if (d < 7) p.keys.add('KeyS');
          if (d < 3) p.keys.add('Space');
          // Dash through globs that are about to hit.
          for (const gl of g.globs.globs) {
            if (!gl.active) continue;
            const gx = pos.x - gl.mesh.position.x;
            const gz = pos.z - gl.mesh.position.z;
            const gd = Math.hypot(gx, gz);
            if (gd < 4 && (gx * gl.dirX + gz * gl.dirZ) / gd > 0.8) p.dashQueued = true;
          }
          // Steer back toward the middle when near a wall.
          if (Math.max(Math.abs(pos.x), Math.abs(pos.z)) > 22) p.keys.add('KeyW');
        }
      }
      g.update(1 / 60);
      if (g.health < lastHealth && firstHitWave.v === null) firstHitWave.v = g.wave;
      lastHealth = g.health;
    }
    return { style, diedOnWave: g.state === 'over' ? g.wave : null, reachedWave: g.wave, firstHitWave: firstHitWave.v, minutes: +(step / 3600).toFixed(1), score: g.score };
  };
  const out = [];
  for (const style of ['stand', 'kite']) for (let i = 0; i < TRIALS; i++) out.push(run(style));
  return out;
}, { TRIALS });
for (const style of ['stand', 'kite']) {
  const r = results.filter((x) => x.style === style);
  const avg = (k) => (r.reduce((s, x) => s + (x[k] ?? 0), 0) / r.length).toFixed(1);
  console.log(`${style.padEnd(5)} died on wave: ${r.map((x) => x.diedOnWave ?? `>${x.reachedWave}`).join(', ')} | first hit on wave: ${r.map((x) => x.firstHitWave ?? '-').join(', ')} | avg minutes ${avg('minutes')}`);
}
if (errors.length) console.log(errors.join('\n'));
await browser.close();
