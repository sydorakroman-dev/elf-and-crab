import { describe, expect, it } from 'vitest';
import { BAG_SIZE, Inventory, makeStock } from './inventory';
import { GEAR_SLOTS, RARITY_INFO, SLOT_INFO, STAT_INFO, makeItem, makePotion, rollRarity, sellPrice, statLines, totalStats, type StatKey } from './items';
import { mulberry32 } from '../util/rng';

describe('items', () => {
  it('rolls stats that fit the slot, more and bigger for rarer items and later levels', () => {
    const rng = mulberry32(4);
    for (let i = 0; i < 300; i++) {
      const slot = GEAR_SLOTS[i % GEAR_SLOTS.length];
      const rarity = (['common', 'rare', 'epic'] as const)[i % 3];
      const it = makeItem(rng, rarity, 1 + (i % 7), slot);
      const keys = Object.keys(it.stats) as StatKey[];
      expect(it.slot).toBe(slot);
      expect(keys.length).toBe(Math.min(RARITY_INFO[rarity].stats, SLOT_INFO[slot].stats.length));
      for (const k of keys) {
        expect(SLOT_INFO[slot].stats).toContain(k);
        expect(it.stats[k]).toBeGreaterThan(0);
      }
      expect(it.name.length).toBeGreaterThan(3);
      expect(statLines(it.stats)).toHaveLength(keys.length);
    }
    const avg = (rarity: 'common' | 'epic', level: number) => {
      let s = 0;
      for (let i = 0; i < 200; i++) s += makeItem(rng, rarity, level, 'bow').stats.damage ?? 0;
      return s / 200;
    };
    expect(avg('epic', 1)).toBeGreaterThan(avg('common', 1) * 1.5);
    expect(avg('common', 6)).toBeGreaterThan(avg('common', 1));
  });

  it('adds up worn stats, capped', () => {
    const rng = mulberry32(1);
    const bows = Array.from({ length: 60 }, () => makeItem(rng, 'epic', 7, 'ring'));
    const t = totalStats(bows);
    for (const k of Object.keys(STAT_INFO) as StatKey[]) expect(t[k]).toBeLessThanOrEqual(STAT_INFO[k].cap);
    expect(totalStats([null, null]).damage).toBe(0);
  });

  it('rolls rarities by the odds', () => {
    const rng = mulberry32(2);
    const n = { common: 0, rare: 0, epic: 0 };
    for (let i = 0; i < 3000; i++) n[rollRarity(rng, [70, 25, 5])]++;
    expect(n.common).toBeGreaterThan(n.rare);
    expect(n.rare).toBeGreaterThan(n.epic);
    expect(n.epic).toBeGreaterThan(50);
  });
});

describe('inventory', () => {
  it('equips from the bag, swapping what was worn back into that bag slot', () => {
    const inv = new Inventory();
    const rng = mulberry32(3);
    const a = makeItem(rng, 'common', 1, 'bow');
    const b = makeItem(rng, 'rare', 1, 'bow');
    inv.add(a);
    inv.add(b);
    expect(inv.apply({ op: 'equip', i: 0 }, null)).not.toBeNull();
    expect(inv.gear.bow).toBe(a);
    expect(inv.bag[0]).toBeNull();
    inv.apply({ op: 'equip', i: 1 }, null);
    expect(inv.gear.bow).toBe(b);
    expect(inv.bag[1]).toBe(a);
    expect(inv.heroStats().damage).toBe(b.stats.damage ?? 0);
  });

  it('puts familiar gear on the familiar', () => {
    const inv = new Inventory();
    const collar = makeItem(mulberry32(5), 'epic', 3, 'collar');
    inv.add(collar);
    inv.apply({ op: 'equip', i: 0 }, null);
    expect(inv.gear.collar).toBe(collar);
    expect(inv.familiarStats().famPower + inv.familiarStats().famSpeed + inv.familiarStats().famCooldown).toBeGreaterThan(0);
    expect(inv.heroStats().damage).toBe(0);
  });

  it('unequips into the bag, drinks potions, drops, refuses nonsense', () => {
    const inv = new Inventory();
    const ring = makeItem(mulberry32(6), 'common', 1, 'ring');
    inv.add(ring);
    inv.apply({ op: 'equip', i: 0 }, null);
    inv.apply({ op: 'unequip', slot: 'ring' }, null);
    expect(inv.gear.ring).toBeNull();
    expect(inv.bag[0]).toBe(ring);
    inv.add(makePotion('health'));
    const r = inv.apply({ op: 'use', i: 1 }, null);
    expect(r?.used?.kind).toBe('potion');
    expect(inv.bag[1]).toBeNull();
    expect(inv.apply({ op: 'use', i: 0 }, null)).toBeNull(); // not a potion
    expect(inv.apply({ op: 'equip', i: 5 }, null)).toBeNull(); // empty
    inv.apply({ op: 'drop', i: 0 }, null);
    expect(inv.bag.every((e) => e === null)).toBe(true);
  });

  it('holds 16 things; a full bag takes no more', () => {
    const inv = new Inventory();
    for (let i = 0; i < BAG_SIZE; i++) expect(inv.add(makePotion('mana'))).toBe(true);
    expect(inv.full).toBe(true);
    expect(inv.add(makePotion('mana'))).toBe(false);
  });

  it('buys and sells only at the merchant, within the purse', () => {
    const inv = new Inventory();
    const stock = makeStock(2, mulberry32(8));
    expect(stock.length).toBe(7);
    expect(stock.some((s) => s.what.kind === 'book')).toBe(true);
    expect(inv.apply({ op: 'buy', i: 0 }, stock)).toBeNull(); // no gold
    inv.addGold(1000);
    const before = inv.gold;
    expect(inv.apply({ op: 'buy', i: 0 }, stock)?.bought).toBe(stock[0].what);
    expect(inv.gold).toBe(before - stock[0].price);
    expect(inv.apply({ op: 'buy', i: 0 }, stock)).toBeNull(); // sold out
    expect(inv.apply({ op: 'sell', i: 0 }, null)).toBeNull(); // no merchant here
    const worth = sellPrice(inv.bag[0]!);
    inv.apply({ op: 'sell', i: 0 }, stock);
    expect(inv.gold).toBe(before - stock[0].price + worth);
    const book = stock.findIndex((s) => s.what.kind === 'book');
    expect(inv.apply({ op: 'buy', i: book }, stock)?.bought).toEqual({ kind: 'book' });
  });

  it('counts versions so the tablet can tell when it changed', () => {
    const inv = new Inventory();
    const v = inv.version;
    inv.addGold(5);
    expect(inv.version).toBeGreaterThan(v);
    expect(inv.encode().g).toBe(5);
  });
});
