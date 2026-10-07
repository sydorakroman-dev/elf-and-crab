// Difficulty simulator: runs the real game loop headlessly (no rendering) with two bot players
// and reports which level they die on († died, … ran out of time). Needs `npm run dev` running and Google Chrome installed.
//   npm run balance            # 6 runs per bot
//   npm run balance -- 10      # 10 runs per bot
// Bots walk the level toward its guardian (then the exit) along the shortest way. In a fight,
// "stand" stands still (a weak player); "kite" strafes, backs off, dashes out of melee and
// through incoming globs (a decent one).
// Both aim perfectly at the nearest enemy, so real players will take hits earlier.
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
    p.active = true;
    g.nextPickup = 1e9; // bots ignore power-ups; keep the comparison clean
    p.mouseDown = true;
    const maxSteps = 60 * 900; // 15 minutes of game time
    const firstHitWave = { v: null };
    let lastHealth = g.health;
    let step = 0;
    let field = null;
    let fieldFor = '';
    for (; step < maxSteps && g.state === 'playing'; step++) {
      const pos = p.position;
      const map = g.dungeon.map;
      p.keys.clear();
      // Fight whatever is awake, close and in sight; otherwise head for the guardian, then the exit.
      const foes = g.enemies.all
        .filter((s) => s.alive && !s.hidden && !g.enemies.isAsleep(s) && Math.hypot(s.x - pos.x, s.z - pos.z) < 28 && map.lineOfSight(pos, s))
        .sort((a, b) => Math.hypot(a.x - pos.x, a.z - pos.z) - Math.hypot(b.x - pos.x, b.z - pos.z));
      if (foes.length) {
        const t = foes[0];
        p.yaw = Math.atan2(-(t.x - pos.x), -(t.z - pos.z));
        if (style === 'kite') {
          const d = Math.hypot(t.x - pos.x, t.z - pos.z);
          p.keys.add('KeyA');
          if (d < 7) p.keys.add('KeyS');
          if (d < 3) p.keys.add('Space');
          for (const gl of g.globs.globs) {
            if (!gl.active) continue;
            const gx = pos.x - gl.mesh.position.x;
            const gz = pos.z - gl.mesh.position.z;
            const gd = Math.hypot(gx, gz);
            if (gd < 4 && (gx * gl.dirX + gz * gl.dirZ) / gd > 0.8) p.dashQueued = true;
          }
        }
      } else {
        const bossPack = g.level.packs.find((k) => k.boss);
        const boss = g.enemies.all.find((s) => s.bossName && s.alive);
        const goal = g.phase === 'cleared' && g.level.exit ? { x: g.level.exit.x, z: g.level.exit.z + 0.5 } : boss ? { x: boss.x, z: boss.z } : bossPack;
        const key = `${g.room}:${map.col(goal.x)}:${map.row(goal.z)}`;
        if (key !== fieldFor) {
          field = map.distanceField(goal.x, goal.z);
          fieldFor = key;
        }
        const w = map.nextWaypoint(field, pos.x, pos.z, 0.5) ?? goal;
        p.yaw = Math.atan2(-(w.x - pos.x), -(w.z - pos.z));
        // Rest up before taking on the guardian (health comes back out of a fight).
        const nearGuardian = boss && Math.hypot(boss.x - pos.x, boss.z - pos.z) < 34;
        if (!(nearGuardian && g.health < 95)) p.keys.add('KeyW');
      }
      if (g.phase === 'ready') g.beginFight(); // press Start
      if (g.phase === 'transition') g.cardSkip = true;
      if (g.phase === 'shop') g.leaveShop(); // bots don't shop
      g.update(1 / 60);
      if (g.health < lastHealth && firstHitWave.v === null) firstHitWave.v = g.room + 1;
      lastHealth = g.health;
    }
    return { style, room: g.room + 1, won: g.state === 'won', died: g.state === 'over', firstHit: firstHitWave.v, minutes: +(step / 3600).toFixed(1), score: g.score, hunting: g.enemies.hunting, near: g.enemies.all.filter((s) => s.alive && Math.hypot(s.x - p.position.x, s.z - p.position.z) < 15).map((s) => s.kind).join(' ') };
  };
  const out = [];
  for (const style of ['stand', 'kite']) for (let i = 0; i < TRIALS; i++) out.push(run(style));
  return out;
}, { TRIALS });
for (const style of ['stand', 'kite']) {
  const r = results.filter((x) => x.style === style);
  const avg = (k) => (r.reduce((s, x) => s + (x[k] ?? 0), 0) / r.length).toFixed(1);
  console.log(`${style.padEnd(5)} ended on level: ${r.map((x) => (x.won ? 'WON' : `${x.room}${x.died ? '†' : '…'}`)).join(', ')} | first hit on level: ${r.map((x) => x.firstHit ?? '-').join(', ')} | avg minutes ${avg('minutes')}`);
}
console.log(JSON.stringify(results.map((r) => [r.style, r.room, r.hunting, r.near])));
if (errors.length) console.log(errors.join('\n'));
await browser.close();
