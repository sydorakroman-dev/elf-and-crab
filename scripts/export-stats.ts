/**
 * Writes docs/enemies.csv and docs/waves.csv straight from the game's numbers, so the tables never
 * drift from the code. Run: npm run stats
 */
import fs from 'node:fs';
import { SLIME_KINDS, BOSS_HP, SLAM_RADIUS, SPLIT_COUNT, WOODLAND_WAVES } from '../src/game/enemies';
import { BEASTS, SNAKE, BOAR, BEAR, DIREWOLF } from '../src/game/beasts';
import { CASTERS, ELEMENTALS, GOLEM, TREANT, VINE } from '../src/game/elementals';
import { ELEMENTAL_ATTACKS, HERO, HEALING, SLIME_ATTACKS } from '../src/game/balance';
import { waveSpec } from '../src/game/combat';
import { ROOMS, WAVES_PER_ROOM, isBossWave, roomElementals, roomWaveDifficulty } from '../src/world/rooms';

const csv = (rows: (string | number)[][]) => rows.map((r) => r.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(',')).join('\n') + '\n';
const pct = (x: number) => `${Math.round(x * 100)}%`;

const enemies: (string | number)[][] = [
  ['enemy', 'found_in', 'type', 'tier', 'hp', 'speed_mps', 'radius_m', 'touch_damage', 'special_attack', 'special_damage', 'special_details', 'score', 'drop_chance', 'stun', 'calm'],
];
const slimeHp = (k: string) => (k === 'small' ? `${waveSpec(1).smallHp}+` : k === 'big' ? `${waveSpec(1).bigHp}+` : `${waveSpec(1).spitterHp}+`);
enemies.push(['Small slime', 'dungeon rooms', 'melee', 'weak', slimeHp('small'), SLIME_KINDS.small.speed, SLIME_KINDS.small.radius, SLIME_KINDS.small.touch, '', '', 'HP grows +10 every 5 difficulty levels; hops', SLIME_KINDS.small.score, '4%', 'full', 'yes']);
enemies.push(['Big slime', 'dungeon rooms', 'melee', 'tough', slimeHp('big'), SLIME_KINDS.big.speed, SLIME_KINDS.big.radius, SLIME_KINDS.big.touch, '', '', 'HP grows +10 every 3 levels', SLIME_KINDS.big.score, '25%', 'full', 'yes']);
enemies.push(['Spitter', 'dungeon rooms', 'ranged', 'normal', slimeHp('spitter'), SLIME_KINDS.spitter.speed, SLIME_KINDS.spitter.radius, SLIME_KINDS.spitter.touch, 'glob', SLIME_ATTACKS.glob, 'keeps 9-14 m away; spits every ~3 s after a 0.7 s swell; globs 11 m/s', SLIME_KINDS.spitter.score, '10%', 'full', 'yes']);
enemies.push(['King Slime', 'Lava Chamber (final boss)', 'melee + ranged', 'boss', BOSS_HP, SLIME_KINDS.boss.speed, SLIME_KINDS.boss.radius, SLIME_KINDS.boss.touch, 'leaping slam / 5-glob volley', `${SLIME_ATTACKS.kingSlam} / ${SLIME_ATTACKS.glob} each`, `slam radius ${SLAM_RADIUS} m with warning ring; splits ${SPLIT_COUNT} small slimes at 2/3 and 1/3 HP`, SLIME_KINDS.boss.score, '0%', '35% duration', 'immune']);
const special: Record<string, [string, string | number, string]> = {
  beetle: ['', '', 'comes in swarms'],
  snake: ['coil + lunge', SNAKE.damage, `strikes within ${SNAKE.range} m after a ${SNAKE.coil} s coil; every ${SNAKE.cooldown} s`],
  direwolf: ['hit and run', '', `backs off for ${DIREWOLF.retreat} s after each bite (harmless while retreating)`],
  boar: ['paw + charge', BOAR.chargeDamage, `charges at ${BOAR.chargeSpeed} m/s from ${BOAR.minRange}-${BOAR.maxRange} m after a ${BOAR.paw} s paw; dazed ${BOAR.daze} s if it hits a wall or tree`],
  bear: ['swipe / ground pound / roar', `${BEAR.swipeDamage} / ${BEAR.poundDamage}`, `pound radius ${BEAR.poundRadius} m every ${BEAR.poundEvery} s with warning ring; roars ${BEAR.roarBeetles} beetles in at half HP`],
};
for (const [k, d] of Object.entries(BEASTS)) {
  const [name, dmg, details] = special[k];
  enemies.push([d.name, 'The Woodland', 'melee', d.tier, d.hp, d.speed, d.radius, d.touch, name, dmg, details, d.score, pct(d.drop), k === 'bear' ? '50% duration' : 'full', k === 'bear' ? 'immune' : 'yes']);
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
  const rooms = ROOMS.filter((r) => r.elementals?.includes(k as never)).map((r) => r.name.replace('The ', '')).join('; ');
  enemies.push([d.name, rooms, d.style, d.tier, d.hp, d.speed, d.radius, d.touch, name, dmg, details, d.score, pct(d.drop), d.tier === 'elite' ? '70% duration' : 'full', 'yes']);
}
enemies.push([]);
enemies.push(['HERO (elf)', '', '', '', HERO.maxHp, 7.5, 0.5, '', 'arrow', HERO.arrowDamage, `invulnerable ${HERO.hurtInvulnerable} s after a hit; heals +${HEALING.waveClear} per wave, full per room, +${HEALING.heartPickup} heart pickup, +${HEALING.spring} spring`, '', '', '', '']);

const waves: (string | number)[][] = [['room', 'room_name', 'wave', 'enemies', 'difficulty_level', 'small', 'big', 'spitters', 'beetles', 'snakes', 'dire_wolves', 'boars', 'elementals', 'boss', 'speed_bonus', 'small_hp', 'big_hp', 'spitter_hp', 'pack_size', 'seconds_between_packs']];
ROOMS.forEach((room, r) => {
  for (let w = 1; w <= WAVES_PER_ROOM; w++) {
    if (room.enemies === 'beasts') {
      const b = WOODLAND_WAVES[w - 1];
      waves.push([r + 1, room.name, w, 'beasts', '', '', '', '', b.beetle, b.snake, b.direwolf, b.boar, '', b.bear ? 'The Crystal Bear' : '', '', '', '', '', 2, b.bear ? 3 : 1.4]);
      continue;
    }
    const d = roomWaveDifficulty(r, w);
    const s = waveSpec(d);
    if (isBossWave(r, w)) waves.push([r + 1, room.name, w, 'slimes', +d.toFixed(2), 6, 0, 0, '', '', '', '', '', 'The King Slime', +s.speedBonus.toFixed(2), s.smallHp, '', '', s.packSize, +s.spawnInterval.toFixed(2)]);
    else {
      const el = roomElementals(r, w);
      const counts = [...new Set(el)].map((k) => `${el.filter((x) => x === k).length} ${k}`).join(' + ');
      waves.push([r + 1, room.name, w, el.length ? 'slimes + elementals' : 'slimes', +d.toFixed(2), s.small, s.big, s.spitters, '', '', '', '', counts, '', +s.speedBonus.toFixed(2), s.smallHp, s.bigHp, s.spitterHp, s.packSize, +s.spawnInterval.toFixed(2)]);
    }
  }
});

fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync('docs/enemies.csv', csv(enemies));
fs.writeFileSync('docs/waves.csv', csv(waves));
console.log(`wrote docs/enemies.csv (${enemies.length - 1} rows) and docs/waves.csv (${waves.length - 1} rows)`);
