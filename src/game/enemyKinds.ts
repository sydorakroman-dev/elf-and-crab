import type { EnemyKind } from './enemies';

/** Every enemy kind, in a fixed order (its index is the kind's code on the wire). */
export const ENEMY_KIND_LIST: EnemyKind[] = [
  'beetle', 'snake', 'direwolf', 'boar', 'bear',
  'vine', 'wind', 'water', 'fire', 'treant', 'golem',
  'brawler', 'rotor', 'riveter', 'lobber', 'tinkerer', 'scrapboss',
  'skeleton', 'skelarcher', 'ghost', 'zombie', 'knight', 'necromancer',
  'orcscout', 'orcwarrior', 'orcarcher', 'shaman', 'shieldguard', 'chieftain',
  'spider', 'ooze', 'sporecrawler', 'mushroom', 'mold', 'caveworm',
  'inferno',
];
