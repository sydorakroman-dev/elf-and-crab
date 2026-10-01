/**
 * Writes docs/enemies.csv and docs/waves.csv straight from the game's numbers, so the tables never
 * drift from the code. Run: npm run stats
 */
import fs from 'node:fs';
import { BEASTS, SNAKE, BOAR, BEAR, DIREWOLF } from '../src/game/beasts';
import { CASTERS, ELEMENTALS, GOLEM, TREANT, VINE } from '../src/game/elementals';
import { MONSTERS, type Attack } from '../src/game/monsters';
import { ELEMENTAL_ATTACKS, HERO, HEALING, MONSTER_SHOTS, POISON } from '../src/game/balance';
import { ROOMS } from '../src/world/rooms';
import type { EnemyKind } from '../src/game/enemies';

const csv = (rows: (string | number)[][]) => rows.map((r) => r.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(',')).join('\n') + '\n';
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Which room each kind fights in (as a regular or as the boss). */
const roomOf = (k: string) =>
  ROOMS.filter((r) => r.waves.some((w) => w.boss === k || (w.mix as Record<string, number>)[k]))
    .map((r) => r.name.replace('The ', ''))
    .join('; ');
const nameOf = (k: EnemyKind) => (BEASTS as Record<string, { name: string }>)[k]?.name ?? (ELEMENTALS as Record<string, { name: string }>)[k]?.name ?? MONSTERS[k as keyof typeof MONSTERS].name;

const enemies: (string | number)[][] = [
  ['enemy', 'room', 'type', 'tier', 'hp', 'speed_mps', 'radius_m', 'touch_damage', 'special_attack', 'special_damage', 'special_details', 'score', 'drop_chance'],
];
const special: Record<string, [string, string | number, string]> = {
  beetle: ['', '', 'comes in swarms'],
  snake: ['coil + lunge', SNAKE.damage, `strikes within ${SNAKE.range} m after a ${SNAKE.coil} s coil; every ${SNAKE.cooldown} s`],
  direwolf: ['hit and run', '', `backs off for ${DIREWOLF.retreat} s after each bite (harmless while retreating)`],
  boar: ['paw + charge', BOAR.chargeDamage, `charges at ${BOAR.chargeSpeed} m/s from ${BOAR.minRange}-${BOAR.maxRange} m after a ${BOAR.paw} s paw; dazed ${BOAR.daze} s if it hits a wall or tree`],
  bear: ['swipe / ground pound / roar', `${BEAR.swipeDamage} / ${BEAR.poundDamage}`, `pound radius ${BEAR.poundRadius} m every ${BEAR.poundEvery} s with warning ring; roars ${BEAR.roarBeetles} beetles in at half HP`],
};
for (const [k, d] of Object.entries(BEASTS)) {
  const [name, dmg, details] = special[k];
  enemies.push([d.name, roomOf(k), 'melee', d.tier, d.hp, d.speed, d.radius, d.touch, name, dmg, details, d.score, pct(d.drop)]);
}

const g = ELEMENTAL_ATTACKS;
const elemSpecial: Record<string, [string, string | number, string]> = {
  vine: ['vine lash', VINE.damage, `lashes within ${VINE.range} m after a ${VINE.windup} s rear-back; every ${VINE.cooldown} s`],
  wind: ['gust bolt', g.gust.damage, `keeps ${CASTERS.wind.min}-${CASTERS.wind.max} m away; every ${CASTERS.wind.interval} s; big shove (knock ${g.gust.knock})`],
  water: ['water bolt', g.water.damage, `keeps ${CASTERS.water.min}-${CASTERS.water.max} m away; every ${CASTERS.water.interval} s; slows the hero to ${pct(g.water.slowFactor)} speed for ${g.water.slowSeconds} s`],
  fire: ['fireball', g.fire.damage, `keeps ${CASTERS.fire.min}-${CASTERS.fire.max} m away; every ${CASTERS.fire.interval} s; leaves burning ground (r ${g.fire.burnRadius} m, ${g.fire.burnSeconds} s, ${g.fire.burnDps} HP/s)`],
  treant: ['erupting roots', TREANT.damage, `targets the hero's spot within ${TREANT.range} m with a ${TREANT.windup} s warning ring (r ${TREANT.radius} m); slows to ${pct(TREANT.slowFactor)} for ${TREANT.slowSeconds} s; every ${TREANT.cooldown} s`],
  golem: ['heavy punch', GOLEM.damage, `punches within ${GOLEM.range} m after a ${GOLEM.windup} s wind-up; huge knockback (${GOLEM.knock}); every ${GOLEM.cooldown} s`],
};
for (const [k, d] of Object.entries(ELEMENTALS)) {
  const [name, dmg, details] = elemSpecial[k];
  enemies.push([d.name, roomOf(k), d.style, d.tier, d.hp, d.speed, d.radius, d.touch, name, dmg, details, d.score, pct(d.drop)]);
}

const shotDamage = (shot: string) => {
  const s = (MONSTER_SHOTS as Record<string, number | { damage: number }>)[shot] ?? (ELEMENTAL_ATTACKS as Record<string, { damage: number }>)[shot];
  return typeof s === 'number' ? s : s.damage;
};
const describe = (a: Attack): [string, string | number, string] => {
  switch (a.type) {
    case 'melee':
      return ['melee hit', a.damage, `within ${a.range} m after a ${a.windup} s wind-up; every ${a.cooldown} s`];
    case 'shoot': {
      const n = a.count ?? 1;
      return [n > 1 ? `${n}-bolt ${a.shot} fan` : `${a.shot} bolt`, shotDamage(a.shot), `up to ${a.range} m; every ${a.cooldown} s${a.shot === 'acid' ? `; slows the hero to ${pct(MONSTER_SHOTS.acid.slowFactor)} for ${MONSTER_SHOTS.acid.slowSeconds} s` : ''}`];
    }
    case 'area':
      return [
        a.at === 'self' ? 'area blast around itself' : 'blast at the hero\'s spot',
        a.damage,
        `${a.windup} s warning ring, r ${a.radius} m; every ${a.cooldown} s${a.zone ? `; leaves ${a.zone} ground (${a.zone === 'poison' ? `${POISON.dps} HP/s, ${POISON.seconds} s` : `${g.fire.burnDps} HP/s`})` : ''}`,
      ];
    case 'lunge':
      return ['leap / charge', a.damage, `from ${a.minRange ?? 0}-${a.range} m at ${a.speed} m/s after a ${a.windup} s wind-up; every ${a.cooldown} s`];
    case 'burrow':
      return ['burrow + erupt', a.damage, `sinks out of reach, bursts up under the hero after a ${a.windup} s warning ring (r ${a.radius} m); every ${a.cooldown} s`];
  }
};
for (const [k, d] of Object.entries(MONSTERS)) {
  const parts = d.attacks.map(describe);
  const extra = [
    d.keepAway && `keeps ${d.keepAway[0]}-${d.keepAway[1]} m away`,
    d.hitAndRun && `backs off ${d.hitAndRun} s after each hit`,
    d.heal && `heals allies within ${d.heal.radius} m for ${d.heal.amount} every ${d.heal.every} s`,
    d.regen && `regrows ${d.regen.rate} HP/s after ${d.regen.delay} s unhurt`,
    d.guard !== undefined && `shield: takes ${pct(d.guard)} damage from the front`,
    d.phasing && 'floats through pillars',
    d.summonAt && `calls ${d.summonAt.count} ${nameOf(d.summonAt.kind)}s at ${d.summonAt.at.map(pct).join(' and ')} HP`,
    d.summonEvery && `raises ${d.summonEvery.count} ${nameOf(d.summonEvery.kind)}s every ${d.summonEvery.every} s (max ${d.summonEvery.max})`,
  ].filter(Boolean);
  enemies.push([
    d.name, roomOf(k), d.style, d.tier, d.hp, d.speed, d.radius, d.touch,
    parts.map((p) => p[0]).join(' / '), parts.map((p) => p[1]).join(' / '), [...parts.map((p) => `${p[0]}: ${p[2]}`), ...extra].join('; '),
    d.score, pct(d.drop),
  ]);
}
enemies.push([]);
enemies.push(['HERO (elf)', '', '', '', HERO.maxHp, 7.5, 0.5, '', 'arrow', HERO.arrowDamage, `invulnerable ${HERO.hurtInvulnerable} s after a hit; heals +${HEALING.waveClear} per wave, full per room, +${HEALING.heartPickup} heart pickup, +${HEALING.spring} spring`, '', '']);

const waves: (string | number)[][] = [['room', 'room_name', 'wave', 'enemies', 'enemy_count', 'total_hp', 'boss']];
ROOMS.forEach((room, r) => {
  room.waves.forEach((w, i) => {
    const entries = Object.entries(w.mix) as [EnemyKind, number][];
    const hp = (k: EnemyKind) => (BEASTS as Record<string, { hp: number }>)[k]?.hp ?? (ELEMENTALS as Record<string, { hp: number }>)[k]?.hp ?? MONSTERS[k as keyof typeof MONSTERS].hp;
    const total = entries.reduce((s, [k, n]) => s + hp(k) * n, w.boss ? hp(w.boss) : 0);
    waves.push([r + 1, room.name, i + 1, entries.map(([k, n]) => `${n} ${nameOf(k)}`).join(' + '), entries.reduce((s, [, n]) => s + n, 0), total, w.boss ? nameOf(w.boss) : '']);
  });
});

fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync('docs/enemies.csv', csv(enemies));
fs.writeFileSync('docs/waves.csv', csv(waves));
console.log(`wrote docs/enemies.csv (${enemies.length - 1} rows) and docs/waves.csv (${waves.length - 1} rows)`);
