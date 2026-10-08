/**
 * The heroes you can play: how tough each is, its three skills (action slots 1–3) and the weapon
 * type it's best with — and the weapon types themselves: the weapon in hand decides how a hero
 * attacks. Pure data, unit tested; Game and the rig apply it.
 */
import type { AbilityId } from './abilities';
import type { WeaponType } from './items';

export type HeroClass = 'elf' | 'knight' | 'mage' | 'barbarian' | 'beastmaster';
export const HERO_CLASSES: HeroClass[] = ['elf', 'knight', 'mage', 'barbarian', 'beastmaster'];

/** arrow / bolt / spear: projectiles · melee: a swing that hits everything in an arc in front. */
export type AttackKind = 'arrow' | 'bolt' | 'spear' | 'melee';


export interface Attack {
  kind: AttackKind;
  damage: number;
  /** Seconds between attacks. */
  interval: number;
  /** Melee: reach (m) and the arc's half-angle (radians). */
  range?: number;
  arc?: number;
  /** Projectiles fly through foes. */
  pierce?: boolean;
}

/** How each weapon type attacks. */
export const WEAPON_ATTACKS: Record<WeaponType, Attack> = {
  onehand: { kind: 'melee', damage: 18, interval: 0.45, range: 3.0, arc: 1.0 },
  twohand: { kind: 'melee', damage: 26, interval: 0.62, range: 3.4, arc: 1.2 },
  bow: { kind: 'arrow', damage: 10, interval: 0.36 },
  staff: { kind: 'bolt', damage: 12, interval: 0.42, pierce: true },
};

/** No weapon in hand: fists. */
export const FISTS: Attack = { kind: 'melee', damage: 6, interval: 0.45, range: 2.2, arc: 0.9 };

/** Damage bonus with the hero's preferred weapon type. */
export const PREFERRED_BONUS = 0.15;

export interface HeroDef {
  name: string;
  icon: string;
  blurb: string;
  /** Max health (before gear) and the share of damage armour takes away. */
  hp: number;
  armor: number;
  /** Extra mana per second. */
  mana: number;
  skills: [AbilityId, AbilityId, AbilityId];
  /** The weapon type it starts with and fights best with (+15% damage). */
  preferred: WeaponType;
  /** Placeholder colours: main (vest, cloak), second (shirt, sleeves). */
  colors: [number, number];
  /** A wolf fights beside the hero. */
  pet?: boolean;
}

export const HEROES: Record<HeroClass, HeroDef> = {
  elf: {
    name: 'Elf Archer',
    icon: '🏹',
    blurb: 'Quick and deadly with a bow.',
    hp: 100,
    armor: 0,
    mana: 0,
    skills: ['dash', 'windwalk', 'doubleshot'],
    preferred: 'bow',
    colors: [0, 0],
  },
  knight: {
    name: 'Knight',
    icon: '🛡️',
    blurb: 'The toughest; best with one-handed blades.',
    hp: 150,
    armor: 0.25,
    mana: 0,
    skills: ['dash', 'shieldwall', 'bash'],
    preferred: 'onehand',
    colors: [0x8a95a8, 0x2f4f8f],
  },
  mage: {
    name: 'Mage',
    icon: '🔮',
    blurb: 'Fragile, more mana; best with a staff.',
    hp: 85,
    armor: 0,
    mana: 4,
    skills: ['blink', 'fireball', 'frostring'],
    preferred: 'staff',
    colors: [0x3b4fb8, 0xd8c8f0],
  },
  barbarian: {
    name: 'Barbarian',
    icon: '🪓',
    blurb: 'Tough; best with two-handed weapons.',
    hp: 125,
    armor: 0.1,
    mana: 0,
    skills: ['dash', 'whirlwind', 'rage'],
    preferred: 'twohand',
    colors: [0x9a2a24, 0x6a4a30],
  },
  beastmaster: {
    name: 'Beast Master',
    icon: '🐺',
    blurb: 'A wolf fights beside you; best with two-handed weapons.',
    hp: 105,
    armor: 0.05,
    mana: 0,
    skills: ['dash', 'sic', 'mend'],
    preferred: 'twohand',
    colors: [0x6a5030, 0x4a7a3a],
    pet: true,
  },
};

const STORAGE_KEY = 'elf-and-crab:hero';

export function loadHero(): HeroClass {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && (HERO_CLASSES as string[]).includes(v)) return v as HeroClass;
  } catch {
    // no storage: the elf
  }
  return 'elf';
}

export function saveHero(h: HeroClass): void {
  try {
    localStorage.setItem(STORAGE_KEY, h);
  } catch {
    // private mode etc.
  }
}

/** Which foes a melee swing from (x, z) facing (dx, dz) hits: within reach (plus their size) and the arc. */
export function inSwing(x: number, z: number, dx: number, dz: number, range: number, arc: number, foe: { x: number; z: number; radius: number }): boolean {
  const fx = foe.x - x;
  const fz = foe.z - z;
  const d = Math.hypot(fx, fz);
  if (d > range + foe.radius) return false;
  if (d < foe.radius + 0.6) return true; // right on top of you
  const len = Math.hypot(dx, dz) || 1;
  const cos = (fx * dx + fz * dz) / (d * len);
  return Math.acos(Math.max(-1, Math.min(1, cos))) <= arc;
}
