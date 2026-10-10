/**
 * The elf's own abilities: skills cost stamina (a counter of charges), spells cost mana (a bar).
 * Nine action slots, used with keys 1-9 by default (rebindable, saved in the browser). Pure data
 * and rules, unit tested; Game applies the effects.
 */

export type AbilityId =
  | 'dash' | 'windwalk' | 'doubleshot' | 'shieldwall' | 'bash' | 'blink' | 'fireball' | 'frostring' | 'whirlwind' | 'rage' | 'sic' | 'mend'
  // From the skill tree (progression.ts):
  | 'piercing' | 'rainofarrows' | 'huntersmark' | 'thorntrap' | 'callforest';

export interface AbilityDef {
  name: string;
  icon: string;
  kind: 'skill' | 'spell';
  /** Stamina charges (skills) or mana points (spells). */
  cost: number;
  description: string;
}

export const ABILITIES: Record<AbilityId, AbilityDef> = {
  dash: { name: 'Dash', icon: '💨', kind: 'skill', cost: 1, description: 'A quick dash; you can’t be hit while dashing.' },
  doubleshot: { name: 'Double Shot', icon: '🏹', kind: 'skill', cost: 1, description: 'Your next 3 shots fire two arrows side by side.' },
  windwalk: { name: 'Wind Walk', icon: '🌬️', kind: 'skill', cost: 2, description: 'Turn invisible for 3 s: enemies lose track of you. Shooting breaks it.' },
  shieldwall: { name: 'Shield Wall', icon: '🛡️', kind: 'skill', cost: 2, description: 'Brace behind your shield: take 60% less damage for 4 s.' },
  bash: { name: 'Shield Bash', icon: '💥', kind: 'skill', cost: 1, description: 'Slam the foes in front: 15 damage and stunned for 1.5 s.' },
  blink: { name: 'Blink', icon: '✨', kind: 'skill', cost: 1, description: 'Vanish and appear 8 m ahead (you can’t blink through walls).' },
  fireball: { name: 'Fireball', icon: '☄️', kind: 'skill', cost: 2, description: 'Hurl a fireball: 32 damage to everything round where it lands.' },
  frostring: { name: 'Frost Ring', icon: '❄️', kind: 'skill', cost: 2, description: 'Freeze every foe within 5 m for 2 s.' },
  whirlwind: { name: 'Whirlwind', icon: '🌀', kind: 'skill', cost: 2, description: 'Spin with both blades: 26 damage to every foe around you.' },
  rage: { name: 'Rage', icon: '😡', kind: 'skill', cost: 2, description: 'For 6 s, swing 50% faster and hit 30% harder.' },
  sic: { name: 'Sic ’Em', icon: '🐺', kind: 'skill', cost: 1, description: 'Your wolf leaps at the nearest foe for 30 damage.' },
  mend: { name: 'Mend', icon: '🌿', kind: 'skill', cost: 2, description: 'Heal yourself 25 and your wolf fully.' },
  piercing: { name: 'Piercing Arrow', icon: '➶', kind: 'skill', cost: 2, description: 'A heavy arrow through every foe in its line.' },
  rainofarrows: { name: 'Rain of Arrows', icon: '🌧️', kind: 'skill', cost: 3, description: 'Arrows rain on a 5 m circle where you aim for 3 s.' },
  huntersmark: { name: 'Hunter’s Mark', icon: '👁️', kind: 'skill', cost: 1, description: 'The foe you aim at takes more damage for 8 s and shows through walls.' },
  thorntrap: { name: 'Thorn Trap', icon: '🌿', kind: 'skill', cost: 1, description: 'A trap at your feet roots and hurts the first foes in it (two at once).' },
  callforest: { name: 'Call of the Forest', icon: '🌳', kind: 'skill', cost: 3, description: 'A treant fights beside you for a while.' },
};

/** Action slots: the hero's three skills, then skill-tree actives and spells as they're learned. */
export const SLOT_COUNT = 12;
export const DEFAULT_SLOTS: (AbilityId | null)[] = ['dash', 'windwalk', 'doubleshot', ...Array<null>(SLOT_COUNT - 3).fill(null)];

export const RESOURCES = {
  maxMana: 100,
  /** Mana per second. */
  manaRegen: 4,
  maxStamina: 5,
  /** Seconds to get one stamina charge back. */
  staminaEvery: 4,
};

export const WIND_WALK_SECONDS = 3;
/** Double Shot: how many shots it charges, and how far apart the two arrows fly (m). */
export const DOUBLE_SHOTS = 3;
export const DOUBLE_GAP = 0.7;

/** The elf's mana and stamina. */
export class Resources {
  mana: number = RESOURCES.maxMana;
  stamina: number = RESOURCES.maxStamina;
  /** Progress (0..1) toward the next stamina charge. */
  staminaProgress = 0;

  reset(): void {
    this.mana = RESOURCES.maxMana;
    this.stamina = RESOURCES.maxStamina;
    this.staminaProgress = 0;
  }

  /** Extra mana per second, and faster stamina (+share), from gear. */
  manaBonus = 0;
  staminaBonus = 0;

  tick(dt: number): void {
    this.mana = Math.min(RESOURCES.maxMana, this.mana + (RESOURCES.manaRegen + this.manaBonus) * dt);
    if (this.stamina >= RESOURCES.maxStamina) {
      this.staminaProgress = 0;
      return;
    }
    this.staminaProgress += (dt * (1 + this.staminaBonus)) / RESOURCES.staminaEvery;
    while (this.staminaProgress >= 1 && this.stamina < RESOURCES.maxStamina) {
      this.staminaProgress -= 1;
      this.stamina++;
    }
  }

  canAfford(id: AbilityId): boolean {
    const a = ABILITIES[id];
    return a.kind === 'skill' ? this.stamina >= a.cost : this.mana >= a.cost;
  }

  /** Pays `cost` mana for a spell if there's enough; returns whether it was paid. */
  spendMana(cost: number): boolean {
    if (this.mana < cost) return false;
    this.mana -= cost;
    return true;
  }

  /** Pays for an ability if there's enough; returns whether it was paid. */
  spend(id: AbilityId): boolean {
    if (!this.canAfford(id)) return false;
    const a = ABILITIES[id];
    if (a.kind === 'skill') this.stamina -= a.cost;
    else this.mana -= a.cost;
    return true;
  }
}

// ── Key bindings ────────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'elf-and-crab:keys';
export const DEFAULT_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'];

/** Keys that are already taken by movement and the menus. */
export const RESERVED_KEYS = new Set(['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape', 'KeyM', 'Enter', 'NumpadEnter', 'KeyI', 'KeyB', 'KeyQ', 'KeyE', 'KeyT', 'KeyF']);

/** "Digit1" → "1", "KeyQ" → "Q", "Minus" → "-", "Space" → "Space". */
export function keyLabel(code: string): string {
  if (code.startsWith('Unbound')) return '–';
  if (code === 'Minus') return '-';
  if (code === 'Equal') return '=';
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

export function loadKeys(storage: Pick<Storage, 'getItem'> | null = safeStorage()): string[] {
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null') as unknown;
    // Keys taken by something else since they were saved fall back to the default for that slot.
    // (Saved before the bar grew from 9 slots to 12: the new slots get their default keys, unless taken.)
    if (Array.isArray(saved) && (saved.length === 9 || saved.length === SLOT_COUNT) && saved.every((k) => typeof k === 'string' && k.length < 32)) {
      const keys = (saved as string[]).map((k, i) => (RESERVED_KEYS.has(k) && !(saved as string[]).includes(DEFAULT_KEYS[i]) ? DEFAULT_KEYS[i] : k));
      for (let i = keys.length; i < SLOT_COUNT; i++) keys.push(keys.includes(DEFAULT_KEYS[i]) ? `Unbound${i}` : DEFAULT_KEYS[i]);
      return keys;
    }
  } catch {
    // fall through to the defaults
  }
  return [...DEFAULT_KEYS];
}

export function saveKeys(keys: string[], storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // private mode etc.: bindings just won't persist
  }
}

/**
 * Binds `code` to slot `slot`; if another slot had that key, the two swap so every key stays
 * unique. Reserved keys are refused (returns false).
 */
export function bindKey(keys: string[], slot: number, code: string): boolean {
  if (RESERVED_KEYS.has(code)) return false;
  const other = keys.indexOf(code);
  if (other >= 0 && other !== slot) keys[other] = keys[slot];
  keys[slot] = code;
  return true;
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
