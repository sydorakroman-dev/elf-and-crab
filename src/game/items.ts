/**
 * Gear and potions: what each equipment slot can roll, rarities, generated names and prices, and
 * the totals the elf and the familiar get from what they wear. Pure rules, unit tested.
 */

/** What a piece of gear is (where it can be worn). */
export type ItemSlot = 'bow' | 'offhand' | 'helmet' | 'armor' | 'cape' | 'belt' | 'gloves' | 'boots' | 'amulet' | 'ring' | 'collar' | 'charm';
/** Places to wear gear: one per kind, except two rings. */
export type HeroSlot = 'bow' | 'offhand' | 'helmet' | 'armor' | 'cape' | 'belt' | 'gloves' | 'boots' | 'amulet' | 'ring' | 'ring2';
export type FamSlot = 'collar' | 'charm';
export type GearSlot = HeroSlot | FamSlot;
export const HERO_SLOTS: HeroSlot[] = ['bow', 'offhand', 'helmet', 'armor', 'cape', 'belt', 'gloves', 'boots', 'amulet', 'ring', 'ring2'];
export const FAM_SLOTS: FamSlot[] = ['collar', 'charm'];
export const GEAR_SLOTS: GearSlot[] = [...HERO_SLOTS, ...FAM_SLOTS];
/** Every kind of gear that can drop. */
export const ITEM_SLOTS: ItemSlot[] = ['bow', 'offhand', 'helmet', 'armor', 'cape', 'belt', 'gloves', 'boots', 'amulet', 'ring', 'collar', 'charm'];

/** Can gear of kind `item` be worn in place `place`? (A ring fits either ring finger.) */
export function fits(item: ItemSlot, place: GearSlot): boolean {
  return item === place || (item === 'ring' && place === 'ring2');
}

/** The kind of gear a place takes. */
export function kindFor(place: GearSlot): ItemSlot {
  return place === 'ring2' ? 'ring' : place;
}

export type Rarity = 'common' | 'rare' | 'epic';
export const RARITIES: Rarity[] = ['common', 'rare', 'epic'];

export type StatKey =
  | 'damage' // arrow damage, +%
  | 'attackSpeed' // shots per second, +%
  | 'crit' // chance of a double-damage shot, %
  | 'maxHp' // flat
  | 'armor' // damage taken, −%
  | 'moveSpeed' // +%
  | 'manaRegen' // mana per second, flat
  | 'staminaRegen' // faster stamina, +%
  | 'famPower' // familiar damage (bites, pounces, spells), +%
  | 'famCooldown' // familiar spell cooldowns, −%
  | 'famSpeed'; // familiar move speed, +%

export type Stats = Partial<Record<StatKey, number>>;

export interface Item {
  kind: 'item';
  id: number;
  slot: ItemSlot;
  rarity: Rarity;
  name: string;
  stats: Stats;
  /** Painted icon (1–10, public/art/items/<slot>-<art>.webp) for kinds that have them. */
  art?: number;
  /** Gold it's worth (the merchant's price; sells for a share of it). */
  value: number;
}

export type PotionKind = 'health' | 'mana';
export interface Potion {
  kind: 'potion';
  id: number;
  potion: PotionKind;
  value: number;
}

export type BagEntry = Item | Potion;

export const POTIONS: Record<PotionKind, { name: string; icon: string; amount: number; value: number; color: number }> = {
  health: { name: 'Health Potion', icon: '🧪', amount: 40, value: 18, color: 0xff4d5e },
  mana: { name: 'Mana Potion', icon: '🔮', amount: 50, value: 18, color: 0x5ea8ff },
};

export const SLOT_INFO: Record<ItemSlot | 'ring2', { label: string; icon: string; nouns: string[]; stats: StatKey[]; familiar: boolean }> = {
  bow: { label: 'Bow', icon: '🏹', nouns: ['Elmwood Bow', 'Yew Longbow', 'Moonwood Bow', 'Hunter’s Recurve'], stats: ['damage', 'attackSpeed', 'crit'], familiar: false },
  offhand: { label: 'Off-hand', icon: '🗡️', nouns: ['Hunting Knife', 'Elven Dagger', 'Fletcher’s Quiver', 'Wooden Buckler'], stats: ['damage', 'crit', 'armor', 'attackSpeed'], familiar: false },
  helmet: { label: 'Helmet', icon: '🪖', nouns: ['Leather Cap', 'Ranger’s Hood', 'Leaf Circlet', 'Horned Helm'], stats: ['maxHp', 'armor', 'manaRegen'], familiar: false },
  cape: { label: 'Cape', icon: '🧣', nouns: ['Woolen Cloak', 'Ranger’s Cape', 'Leafweave Mantle', 'Shadow Cloak'], stats: ['armor', 'moveSpeed', 'manaRegen'], familiar: false },
  belt: { label: 'Belt', icon: '🪢', nouns: ['Leather Belt', 'Hunter’s Girdle', 'Studded Belt', 'Rune Sash'], stats: ['maxHp', 'staminaRegen', 'damage'], familiar: false },
  gloves: { label: 'Gloves', icon: '🧤', nouns: ['Archer’s Gloves', 'Leather Bracers', 'Silk Gloves', 'Hawk Grips'], stats: ['attackSpeed', 'crit', 'damage'], familiar: false },
  armor: { label: 'Armor', icon: '🦺', nouns: ['Leather Jerkin', 'Ranger’s Coat', 'Leafweave Vest', 'Scale Tunic'], stats: ['maxHp', 'armor', 'moveSpeed'], familiar: false },
  boots: { label: 'Boots', icon: '👢', nouns: ['Soft Boots', 'Trail Boots', 'Wind Treads', 'Elven Boots'], stats: ['moveSpeed', 'staminaRegen', 'maxHp'], familiar: false },
  amulet: { label: 'Amulet', icon: '📿', nouns: ['Acorn Amulet', 'Moonstone Pendant', 'Rune Locket', 'Star Charm'], stats: ['manaRegen', 'maxHp', 'damage', 'crit'], familiar: false },
  ring: { label: 'Ring', icon: '💍', nouns: ['Silver Ring', 'Jade Band', 'Signet Ring', 'Ember Ring'], stats: ['crit', 'attackSpeed', 'manaRegen', 'damage'], familiar: false },
  ring2: { label: 'Ring', icon: '💍', nouns: [], stats: [], familiar: false },
  collar: { label: 'Collar', icon: '🎀', nouns: ['Leaf Collar', 'Braided Collar', 'Bell Collar', 'Shell Collar'], stats: ['famPower', 'famSpeed', 'famCooldown'], familiar: true },
  charm: { label: 'Charm', icon: '🍀', nouns: ['Lucky Charm', 'Clover Token', 'Tide Pebble', 'Spirit Feather'], stats: ['famCooldown', 'famPower', 'famSpeed'], familiar: true },
};

/**
 * Gear with painted icons: each picture's name, and which pictures each rarity uses (plainer
 * ones for commons, gilded and steel ones for epics).
 */
export const ITEM_ART: Partial<Record<ItemSlot, { names: string[]; byRarity: Record<Rarity, number[]> }>> = {
  bow: {
    names: ['Elmwood Bow', 'Hunter’s Recurve', 'Oaken Warbow', 'Ivory Bow', 'Moonsteel Bow', 'Short Hunting Bow', 'Sylvan Bow', 'Plumwood Bow', 'Crystal-Grip Bow', 'Nightgold Bow'],
    byRarity: { common: [1, 2, 3, 6], rare: [4, 7, 8, 9], epic: [5, 9, 10] },
  },
  armor: {
    names: ['Steel Breastplate', 'Bronze Cuirass', 'Ironclad Vest', 'Gilded White Plate', 'Banded Bluemail', 'Copper Lamellar', 'Riveted Ranger Coat', 'Plum Knight Plate', 'Sky Knight Armor', 'Black-and-Gold Armor'],
    byRarity: { common: [1, 2, 6, 7], rare: [3, 4, 5, 8], epic: [9, 10] },
  },
  helmet: {
    names: ['Wool Cap', 'Ranger’s Hood', 'Kettle Helm', 'Adventurer’s Hat', 'Wizard’s Hat', 'Aviator Cap', 'Plum Hood', 'Knight’s Helm', 'Golden Circlet', 'Black-and-Gold Helm'],
    byRarity: { common: [1, 2, 3, 4], rare: [5, 6, 7, 8], epic: [9, 10] },
  },
  boots: {
    names: ['Soft Boots', 'Cuffed Boots', 'Riding Boots', 'Laced Boots', 'Elven Boots', 'Buckled Bluesteel Boots', 'Wrapped Boots', 'Copper Greaves', 'Knight’s Sabatons', 'Black-and-Gold Boots'],
    byRarity: { common: [1, 2, 4, 7], rare: [3, 5, 6, 8], epic: [9, 10] },
  },
  gloves: {
    names: ['Leather Gloves', 'Silk Gloves', 'Fingerless Grips', 'Padded Gloves', 'Forest Gauntlets', 'Studded Bluesteel Gloves', 'Wrapped Gloves', 'Copper Gauntlets', 'Knight’s Gauntlets', 'Black-and-Gold Gauntlets'],
    byRarity: { common: [1, 2, 3, 4], rare: [5, 6, 7, 8], epic: [9, 10] },
  },
  cape: {
    names: ['Hooded Capelet', 'Traveler’s Cloak', 'Crimson Wrap', 'Gilded White Mantle', 'Ranger’s Hooded Cloak', 'Midnight Capelet', 'Plum Shawl Cloak', 'Ember Mantle', 'Frost Cloak', 'Black-and-Gold Cloak'],
    byRarity: { common: [1, 2, 3, 6], rare: [4, 5, 7, 8], epic: [9, 10] },
  },
  amulet: {
    names: ['Pebble Pendant', 'Copper Medallion', 'Silver Bar Charm', 'Sky Pendant', 'Jade Bead Necklace', 'Emerald Chain', 'Moonstone Choker', 'Amber Collar Necklace', 'Starsapphire Necklace', 'Black-and-Gold Necklace'],
    byRarity: { common: [1, 2, 3, 4], rare: [5, 6, 7, 8], epic: [9, 10] },
  },
  ring: {
    names: ['Silver Band', 'Copper Band', 'Ruby Signet', 'Sapphire Ring', 'Twin Bands', 'Emerald Ring', 'Moonstone Ring', 'Amber Ring', 'Starsapphire Ring', 'Black-and-Gold Ring'],
    byRarity: { common: [1, 2, 4, 5], rare: [3, 6, 7, 8], epic: [9, 10] },
  },
  belt: {
    names: ['Leather Belt', 'Sand Sash', 'Ring-Buckle Belt', 'Ivory Gem Belt', 'Ranger’s Double Belt', 'Adventurer’s Pouch Belt', 'Laced Corset Belt', 'Bronze Plate Belt', 'Knight’s Girdle', 'Black-and-Gold Girdle'],
    byRarity: { common: [1, 2, 3, 6], rare: [4, 5, 7, 8], epic: [9, 10] },
  },
};

/** Each stat: its size on a common level-1 item, a cap on the total, and how it reads. */
export const STAT_INFO: Record<StatKey, { base: number; cap: number; label: (v: number) => string }> = {
  damage: { base: 0.08, cap: 1.5, label: (v) => `+${pct(v)} arrow damage` },
  attackSpeed: { base: 0.08, cap: 0.6, label: (v) => `+${pct(v)} attack speed` },
  crit: { base: 0.05, cap: 0.5, label: (v) => `${pct(v)} critical shots` },
  maxHp: { base: 15, cap: 150, label: (v) => `+${Math.round(v)} max health` },
  armor: { base: 0.06, cap: 0.5, label: (v) => `−${pct(v)} damage taken` },
  moveSpeed: { base: 0.06, cap: 0.4, label: (v) => `+${pct(v)} move speed` },
  manaRegen: { base: 1, cap: 10, label: (v) => `+${v.toFixed(1)} mana / s` },
  staminaRegen: { base: 0.12, cap: 1, label: (v) => `+${pct(v)} stamina regen` },
  famPower: { base: 0.12, cap: 1.5, label: (v) => `+${pct(v)} familiar damage` },
  famCooldown: { base: 0.1, cap: 0.5, label: (v) => `−${pct(v)} familiar cooldowns` },
  famSpeed: { base: 0.08, cap: 0.5, label: (v) => `+${pct(v)} familiar speed` },
};

const SUFFIX: Record<StatKey, string> = {
  damage: 'of Might',
  attackSpeed: 'of Swiftness',
  crit: 'of the Hawk',
  maxHp: 'of Vigor',
  armor: 'of Stone',
  moveSpeed: 'of the Wind',
  manaRegen: 'of Stars',
  staminaRegen: 'of the Spring',
  famPower: 'of the Pack',
  famCooldown: 'of Patience',
  famSpeed: 'of the Fox',
};

export const RARITY_INFO: Record<Rarity, { label: string; color: string; stats: number; power: number; value: number }> = {
  common: { label: 'Common', color: '#e8e2d4', stats: 1, power: 1, value: 20 },
  rare: { label: 'Rare', color: '#5ea8ff', stats: 2, power: 1.5, value: 60 },
  epic: { label: 'Epic', color: '#c77dff', stats: 3, power: 2.2, value: 150 },
};

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

let nextId = 1;
/** A fresh id for anything put in the bag. */
export function newId(): number {
  return nextId++;
}

/** Rolls a piece of gear for `slot` (random if not given) of `rarity` on level `level` (1-based). */
export function makeItem(rng: () => number, rarity: Rarity, level: number, slot?: ItemSlot): Item {
  const s = slot ?? ITEM_SLOTS[Math.floor(rng() * ITEM_SLOTS.length)];
  const info = SLOT_INFO[s];
  const r = RARITY_INFO[rarity];
  const pool = [...info.stats];
  const stats: Stats = {};
  const scale = r.power * (1 + 0.15 * Math.max(0, level - 1));
  const count = Math.min(r.stats, pool.length);
  for (let i = 0; i < count; i++) {
    const key = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    const v = STAT_INFO[key].base * scale * (0.8 + rng() * 0.4);
    stats[key] = key === 'maxHp' ? Math.round(v) : Math.round(v * 100) / 100;
  }
  const top = (Object.keys(stats) as StatKey[])[0];
  // A painted picture (and the name that goes with it), where this kind has them.
  const artSet = ITEM_ART[s];
  const pictures = artSet?.byRarity[rarity];
  const art = pictures ? pictures[Math.floor(rng() * pictures.length)] : undefined;
  const noun = art && artSet ? artSet.names[art - 1] : info.nouns[Math.floor(rng() * info.nouns.length)];
  const name = rarity === 'common' ? noun : `${noun} ${SUFFIX[top]}`;
  const value = Math.round(r.value * (1 + 0.2 * Math.max(0, level - 1)));
  return { kind: 'item', id: newId(), slot: s, rarity, name, stats, value, ...(art ? { art } : {}) };
}

export function makePotion(potion: PotionKind): Potion {
  return { kind: 'potion', id: newId(), potion, value: POTIONS[potion].value };
}

/** Rarity for a drop: `odds` are the chances of [common, rare, epic]. */
export function rollRarity(rng: () => number, odds: [number, number, number]): Rarity {
  let x = rng() * (odds[0] + odds[1] + odds[2]);
  for (let i = 0; i < 3; i++) if ((x -= odds[i]) < 0) return RARITIES[i];
  return 'common';
}

/** Totals from everything worn (each stat capped). */
export function totalStats(items: readonly (Item | null)[]): Required<Stats> {
  const out = Object.fromEntries((Object.keys(STAT_INFO) as StatKey[]).map((k) => [k, 0])) as Required<Stats>;
  for (const it of items) if (it) for (const [k, v] of Object.entries(it.stats) as [StatKey, number][]) out[k] += v;
  for (const k of Object.keys(out) as StatKey[]) out[k] = Math.min(out[k], STAT_INFO[k].cap);
  return out;
}

/** Lines describing an item's stats. */
export function statLines(stats: Stats): string[] {
  return (Object.entries(stats) as [StatKey, number][]).map(([k, v]) => STAT_INFO[k].label(v));
}

/** What the merchant pays for something (a share of its worth). */
export function sellPrice(e: BagEntry): number {
  return Math.max(1, Math.floor(e.value * 0.3));
}
