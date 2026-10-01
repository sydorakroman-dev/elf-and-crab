/**
 * Health and damage numbers in one place (the hero has 100 HP). Enemy stats live with each enemy
 * (SLIME_KINDS in enemies.ts, BEASTS in beasts.ts); wave sizes in combat.ts / rooms.ts.
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

/** Damage the hero takes from slime attacks other than touching them (touch damage is per kind). */
export const SLIME_ATTACKS = {
  glob: 20,
  kingSlam: 30,
};

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
