/**
 * The heroes you can play: how each fights (its basic attack), its three skills (action slots
 * 1–3), how tough it is, and its placeholder look (the elf model recoloured, with its own weapon)
 * until proper models arrive. Pure data, unit tested; Game and the rig apply it.
 */
import type { AbilityId } from './abilities';

export type HeroClass = 'elf' | 'knight' | 'mage' | 'barbarian' | 'beastmaster';
export const HERO_CLASSES: HeroClass[] = ['elf', 'knight', 'mage', 'barbarian', 'beastmaster'];

/** arrow / bolt / spear: projectiles · melee: a swing that hits everything in an arc in front. */
export type AttackKind = 'arrow' | 'bolt' | 'spear' | 'melee';

/** What the hero holds (the placeholder weapon models). */
export type WeaponLook = 'bow' | 'swordShield' | 'staff' | 'twinBlades' | 'greatAxe' | 'spear';

export interface HeroDef {
  name: string;
  icon: string;
  blurb: string;
  /** Max health (before gear) and the share of damage armour takes away. */
  hp: number;
  armor: number;
  /** Extra mana per second. */
  mana: number;
  attack: {
    kind: AttackKind;
    damage: number;
    /** Seconds between attacks. */
    interval: number;
    /** Melee: reach (m) and the arc's half-angle (radians). */
    range?: number;
    arc?: number;
    /** Projectiles fly through foes. */
    pierce?: boolean;
  };
  skills: [AbilityId, AbilityId, AbilityId];
  weapon: WeaponLook;
  /** Placeholder colours: main (vest, cloak), second (shirt, sleeves). */
  colors: [number, number];
  /** A wolf fights beside the hero. */
  pet?: boolean;
}

export const HEROES: Record<HeroClass, HeroDef> = {
  elf: {
    name: 'Elf Archer',
    icon: '🏹',
    blurb: 'Quick and deadly at range.',
    hp: 100,
    armor: 0,
    mana: 0,
    attack: { kind: 'arrow', damage: 10, interval: 0.36 },
    skills: ['dash', 'windwalk', 'doubleshot'],
    weapon: 'bow',
    colors: [0, 0],
  },
  knight: {
    name: 'Knight',
    icon: '🛡️',
    blurb: 'Sword and shield: the toughest, up close.',
    hp: 150,
    armor: 0.25,
    mana: 0,
    attack: { kind: 'melee', damage: 24, interval: 0.6, range: 3.2, arc: 1.0 },
    skills: ['dash', 'shieldwall', 'bash'],
    weapon: 'swordShield',
    colors: [0x8a95a8, 0x2f4f8f],
  },
  mage: {
    name: 'Mage',
    icon: '🔮',
    blurb: 'Fragile, but bolts fly through foes; more mana.',
    hp: 85,
    armor: 0,
    mana: 4,
    attack: { kind: 'bolt', damage: 12, interval: 0.42, pierce: true },
    skills: ['blink', 'fireball', 'frostring'],
    weapon: 'staff',
    colors: [0x3b4fb8, 0xd8c8f0],
  },
  barbarian: {
    name: 'Barbarian',
    icon: '🪓',
    blurb: 'A great axe: heavy, wide chops.',
    hp: 125,
    armor: 0.1,
    mana: 0,
    attack: { kind: 'melee', damage: 22, interval: 0.5, range: 3.4, arc: 1.2 },
    skills: ['dash', 'whirlwind', 'rage'],
    weapon: 'greatAxe',
    colors: [0x9a2a24, 0x6a4a30],
  },
  beastmaster: {
    name: 'Beast Master',
    icon: '🐺',
    blurb: 'Throws spears; a wolf fights beside you.',
    hp: 105,
    armor: 0.05,
    mana: 0,
    attack: { kind: 'spear', damage: 15, interval: 0.55 },
    skills: ['dash', 'sic', 'mend'],
    weapon: 'spear',
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
