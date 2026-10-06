/**
 * The party's belongings this run: the elf's five gear slots, the familiar's two, a 16-slot bag
 * shared by both, and the gold purse. Plus the merchant's stock between levels. Pure rules, unit
 * tested; the hero's game owns the one true inventory and the familiar's tablet sends requests.
 */
import { FAM_SLOTS, HERO_SLOTS, fits, makeItem, makePotion, rollRarity, sellPrice, totalStats, type BagEntry, type GearSlot, type Item, type Stats } from './items';

export const BAG_SIZE = 16;

export type InvOp =
  | { op: 'equip'; i: number; to?: GearSlot } // bag slot → a place it fits (what was worn there goes back to that bag slot)
  | { op: 'unequip'; slot: GearSlot; to?: number } // gear slot → bag slot `to` (or the first free one)
  | { op: 'move'; i: number; j: number } // bag slot i ↔ bag slot j
  | { op: 'use'; i: number } // drink a potion
  | { op: 'drop'; i: number }
  | { op: 'sell'; i: number } // only at the merchant
  | { op: 'buy'; i: number }; // stock entry i, only at the merchant

/** What the merchant sells: gear, potions, or a spell book. */
export type StockEntry = { what: BagEntry | { kind: 'book' }; price: number; sold: boolean };

export class Inventory {
  readonly gear: Record<GearSlot, Item | null> = Object.fromEntries([...HERO_SLOTS, ...FAM_SLOTS].map((s) => [s, null])) as Record<GearSlot, Item | null>;
  readonly bag: (BagEntry | null)[] = Array(BAG_SIZE).fill(null);
  gold = 0;
  /** Goes up on every change (so the tablet only gets the inventory when it changed). */
  version = 0;

  clear(): void {
    for (const s of Object.keys(this.gear) as GearSlot[]) this.gear[s] = null;
    this.bag.fill(null);
    this.gold = 0;
    this.version++;
  }

  get full(): boolean {
    return !this.bag.includes(null);
  }

  addGold(n: number): void {
    this.gold += n;
    this.version++;
  }

  /** Puts something in the first free bag slot; false if the bag is full. */
  add(e: BagEntry): boolean {
    const i = this.bag.indexOf(null);
    if (i < 0) return false;
    this.bag[i] = e;
    this.version++;
    return true;
  }

  /** The elf's totals from gear. */
  heroStats(): Required<Stats> {
    return totalStats(HERO_SLOTS.map((s) => this.gear[s]));
  }

  /** The familiar's totals from gear. */
  familiarStats(): Required<Stats> {
    return totalStats(FAM_SLOTS.map((s) => this.gear[s]));
  }

  /**
   * Applies a request. `shop`: the merchant's stock if the party is at the merchant (selling and
   * buying need it). Returns what happened, or null if it wasn't possible. A potion used is
   * returned for the caller to apply; a book bought likewise.
   */
  apply(req: InvOp, shop: StockEntry[] | null): { used?: BagEntry; bought?: StockEntry['what'] } | null {
    switch (req.op) {
      case 'equip': {
        const e = this.bag[req.i];
        if (!e || e.kind !== 'item') return null;
        // Where: the place asked for, else the free one of its places (rings), else the first.
        const places = (Object.keys(this.gear) as GearSlot[]).filter((g) => fits(e.slot, g));
        const to = req.to ? (fits(e.slot, req.to) ? req.to : null) : (places.find((g) => !this.gear[g]) ?? places[0]);
        if (!to) return null;
        this.bag[req.i] = this.gear[to];
        this.gear[to] = e;
        break;
      }
      case 'unequip': {
        const it = this.gear[req.slot];
        if (!it) return null;
        const to = req.to ?? -1;
        const there = to >= 0 && to < BAG_SIZE ? this.bag[to] : undefined;
        if (there === null) {
          this.bag[to] = it; // dropped on an empty bag slot
          this.gear[req.slot] = null;
        } else if (there?.kind === 'item' && fits(there.slot, req.slot)) {
          this.bag[to] = it; // onto gear for the same slot: swap them
          this.gear[req.slot] = there;
        } else {
          const free = this.bag.indexOf(null);
          if (free < 0) return null;
          this.bag[free] = it;
          this.gear[req.slot] = null;
        }
        break;
      }
      case 'move': {
        const { i, j } = req;
        if (i === j || i < 0 || j < 0 || i >= BAG_SIZE || j >= BAG_SIZE || !this.bag[i]) return null;
        [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
        break;
      }
      case 'use': {
        const e = this.bag[req.i];
        if (!e || e.kind !== 'potion') return null;
        this.bag[req.i] = null;
        this.version++;
        return { used: e };
      }
      case 'drop': {
        if (!this.bag[req.i]) return null;
        this.bag[req.i] = null;
        break;
      }
      case 'sell': {
        const e = this.bag[req.i];
        if (!e || !shop) return null;
        this.gold += sellPrice(e);
        this.bag[req.i] = null;
        break;
      }
      case 'buy': {
        const s = shop?.[req.i];
        if (!s || s.sold || this.gold < s.price) return null;
        if (s.what.kind !== 'book' && this.full) return null;
        this.gold -= s.price;
        s.sold = true;
        if (s.what.kind !== 'book') this.add(s.what);
        this.version++;
        return { bought: s.what };
      }
    }
    this.version++;
    return {};
  }

  /** Network form (plain data). */
  encode(): InvState {
    return { v: this.version, g: this.gold, gear: { ...this.gear }, bag: [...this.bag] };
  }
}

export interface InvState {
  v: number;
  g: number;
  gear: Record<GearSlot, Item | null>;
  bag: (BagEntry | null)[];
}

/** The merchant's wares for the stop after level `level`: gear, two potions, a spell book. */
export function makeStock(level: number, rng: () => number): StockEntry[] {
  const odds: [number, number, number] = level <= 2 ? [55, 38, 7] : level <= 4 ? [40, 45, 15] : [25, 50, 25];
  const stock: StockEntry[] = [];
  for (let i = 0; i < 4; i++) {
    const it = makeItem(rng, rollRarity(rng, odds), level + 1);
    stock.push({ what: it, price: it.value, sold: false });
  }
  for (const p of ['health', 'mana'] as const) {
    const po = makePotion(p);
    stock.push({ what: po, price: po.value * 2, sold: false });
  }
  stock.push({ what: { kind: 'book' }, price: 90 + level * 30, sold: false });
  return stock;
}
