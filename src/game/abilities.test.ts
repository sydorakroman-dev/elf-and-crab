import { describe, expect, it } from 'vitest';
import { ABILITIES, DEFAULT_KEYS, RESOURCES, Resources, bindKey, keyLabel, loadKeys, saveKeys } from './abilities';

describe('elf resources', () => {
  it('starts full: 100 mana, 5 stamina', () => {
    const r = new Resources();
    expect(r.mana).toBe(100);
    expect(r.stamina).toBe(5);
  });

  it('skills spend stamina charges, and refuse when out', () => {
    const r = new Resources();
    for (let i = 0; i < 5; i++) expect(r.spend('dash')).toBe(true);
    expect(r.stamina).toBe(0);
    expect(r.spend('dash')).toBe(false);
    expect(r.spend('windwalk')).toBe(false);
  });

  it('wind walk costs more than a dash', () => {
    expect(ABILITIES.windwalk.cost).toBeGreaterThan(ABILITIES.dash.cost);
    const r = new Resources();
    r.spend('windwalk');
    expect(r.stamina).toBe(5 - ABILITIES.windwalk.cost);
  });

  it('stamina comes back one charge at a time, never past 5; mana refills too', () => {
    const r = new Resources();
    r.stamina = 0;
    r.mana = 10;
    r.tick(RESOURCES.staminaEvery * 1.5);
    expect(r.stamina).toBe(1);
    r.tick(RESOURCES.staminaEvery * 20);
    expect(r.stamina).toBe(RESOURCES.maxStamina);
    expect(r.mana).toBe(RESOURCES.maxMana);
  });
});

describe('key bindings', () => {
  it('defaults to 1-9 and labels keys nicely', () => {
    expect(loadKeys(null)).toEqual(DEFAULT_KEYS);
    expect(keyLabel('Digit3')).toBe('3');
    expect(keyLabel('KeyQ')).toBe('Q');
  });

  it('rebinding swaps with a slot that already had the key; movement keys are refused', () => {
    const keys = [...DEFAULT_KEYS];
    expect(bindKey(keys, 0, 'KeyQ')).toBe(true);
    expect(keys[0]).toBe('KeyQ');
    expect(bindKey(keys, 1, 'KeyQ')).toBe(true);
    expect(keys[1]).toBe('KeyQ');
    expect(keys[0]).toBe('Digit2'); // swapped
    expect(bindKey(keys, 2, 'KeyW')).toBe(false);
    expect(bindKey(keys, 2, 'Space')).toBe(false);
  });

  it('saves and loads, ignoring junk', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const keys = [...DEFAULT_KEYS];
    bindKey(keys, 4, 'KeyF');
    saveKeys(keys, storage);
    expect(loadKeys(storage)[4]).toBe('KeyF');
    store.set('elf-and-crab:keys', '"nonsense"');
    expect(loadKeys(storage)).toEqual(DEFAULT_KEYS);
  });
});

describe('double shot', () => {
  it('is a 1-stamina skill in slot 3', async () => {
    const { DEFAULT_SLOTS } = await import('./abilities');
    expect(ABILITIES.doubleshot).toMatchObject({ kind: 'skill', cost: 1 });
    expect(DEFAULT_SLOTS[2]).toBe('doubleshot');
  });
});
