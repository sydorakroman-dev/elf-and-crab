/**
 * The elf's own abilities: skills cost stamina (a counter of charges), spells cost mana (a bar).
 * Nine action slots, used with keys 1-9 by default (rebindable, saved in the browser). Pure data
 * and rules, unit tested; Game applies the effects.
 */

export type AbilityId = 'dash' | 'windwalk' | 'doubleshot';

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
};

/** What sits in each of the nine slots (spells from the magic book will fill the empty ones). */
export const DEFAULT_SLOTS: (AbilityId | null)[] = ['dash', 'windwalk', 'doubleshot', null, null, null, null, null, null];

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
export const DEFAULT_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'];

/** Keys that are already taken by movement and the menus. */
export const RESERVED_KEYS = new Set(['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape', 'KeyM', 'Enter', 'NumpadEnter', 'KeyI', 'KeyB', 'KeyQ', 'KeyE']);

/** "Digit1" → "1", "KeyQ" → "Q", "Space" → "Space". */
export function keyLabel(code: string): string {
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

export function loadKeys(storage: Pick<Storage, 'getItem'> | null = safeStorage()): string[] {
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null') as unknown;
    // Keys taken by something else since they were saved fall back to the default for that slot.
    if (Array.isArray(saved) && saved.length === 9 && saved.every((k) => typeof k === 'string' && k.length < 32))
      return (saved as string[]).map((k, i) => (RESERVED_KEYS.has(k) && !(saved as string[]).includes(DEFAULT_KEYS[i]) ? DEFAULT_KEYS[i] : k));
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
