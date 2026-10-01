/**
 * Health and damage numbers in one place (the hero has 100 HP). Enemy stats live with each enemy
 * (BEASTS in beasts.ts, ELEMENTALS in elementals.ts, MONSTERS in monsters.ts); waves in rooms.ts.
 */
export const HERO = {
  maxHp: 100,
  arrowDamage: 10,
  /** Seconds of invulnerability after taking a hit. */
  hurtInvulnerable: 1.1,
};

export const HEALING = {
  /** For each wave cleared. */
  waveClear: 20,
  /** The Heart power-up. */
  heartPickup: 25,
  /** The capybara's Soothing Spring (once per pool). */
  spring: 25,
};

/** What the monsters' bolts do to the hero. */
export const MONSTER_SHOTS = {
  /** Goblin rivets: quick and stinging. */
  rivet: 14,
  /** Skeleton and orc archers. */
  arrow: 13,
  /** The Necromancer's soul bolts. */
  soul: 14,
  /** Orc shaman magic. */
  magic: 12,
  /** Cave slime (and worm) acid: slows the hero. */
  acid: { damage: 9, slowSeconds: 1.5, slowFactor: 0.6 },
};

/** Poisonous spore clouds (spore crawlers, mushroom monsters): hurt while you stand in them. */
export const POISON = { seconds: 4, dps: 6 };

/** What the elementals' bolts do to the hero. */
export const ELEMENTAL_ATTACKS = {
  /** Wind: small damage, big shove. */
  gust: { damage: 8, knock: 28 },
  /** Water: slows the hero (speed × factor) for a while. */
  water: { damage: 12, slowSeconds: 2, slowFactor: 0.55 },
  /** Fire: leaves burning ground that hurts while you stand in it. */
  fire: { damage: 15, burnRadius: 1.8, burnSeconds: 3, burnDps: 10 },
};

/** Victory bonus: score per HP left. */
export const VICTORY_SCORE_PER_HP = 5;
