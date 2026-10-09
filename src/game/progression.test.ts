import { describe, expect, it } from 'vitest';
import { MAX_LEVEL, MAX_RANK, Leveling, TREES, TREE_SKILL_IDS, XP_FOR_LEVEL, levelFor, levelProgress, treeSkills } from './progression';
import { ABILITIES } from './abilities';

describe('progression', () => {
  it('climbs from level 1 to the cap of 12, each level costing more than the last', () => {
    expect(XP_FOR_LEVEL).toHaveLength(MAX_LEVEL);
    expect(levelFor(0)).toBe(1);
    expect(levelFor(XP_FOR_LEVEL[1] - 1)).toBe(1);
    expect(levelFor(XP_FOR_LEVEL[1])).toBe(2);
    expect(levelFor(1e9)).toBe(MAX_LEVEL);
    for (let l = 2; l < MAX_LEVEL; l++) expect(XP_FOR_LEVEL[l] - XP_FOR_LEVEL[l - 1]).toBeGreaterThan(XP_FOR_LEVEL[l - 1] - XP_FOR_LEVEL[l - 2]);
    expect(levelProgress(XP_FOR_LEVEL[1] + (XP_FOR_LEVEL[2] - XP_FOR_LEVEL[1]) / 2)).toBeCloseTo(0.5);
    expect(levelProgress(1e9)).toBe(1);
  });

  it('reports levels gained, and stops at the cap', () => {
    const p = new Leveling();
    expect(p.addXp(XP_FOR_LEVEL[3])).toBe(3);
    expect(p.level).toBe(4);
    expect(p.points).toBe(3);
    p.addXp(1e9);
    expect(p.level).toBe(MAX_LEVEL);
    expect(p.points).toBe(MAX_LEVEL - 1);
    expect(p.addXp(500)).toBe(0);
  });

  it('the elf’s tree: three branches of three, every skill with three ranks; actives are real abilities', () => {
    const skills = treeSkills('elf');
    expect(TREES.elf).toHaveLength(3);
    expect(skills).toHaveLength(9);
    expect(new Set(skills.map((s) => s.id)).size).toBe(9);
    for (const s of skills) {
      expect(TREE_SKILL_IDS).toContain(s.id);
      expect(s.ranks).toHaveLength(MAX_RANK);
      if (s.kind === 'active') expect(ABILITIES[s.ability!]).toBeTruthy();
      if (s.requires) expect(skills.some((o) => o.id === s.requires!.id)).toBe(true);
    }
    // Each branch starts open and the rest need the one before.
    for (const b of TREES.elf!) {
      expect(b.skills[0].requires).toBeUndefined();
      expect(b.skills[1].requires?.id).toBe(b.skills[0].id);
      expect(b.skills[2].requires?.id).toBe(b.skills[1].id);
    }
  });

  it('spends points only where the rules allow', () => {
    const p = new Leveling();
    expect(p.block('elf', 'keeneye')).toBe('no-points');
    p.addXp(XP_FOR_LEVEL[4]); // level 5: 4 points
    expect(p.block('elf', 'piercing')).toBe('locked');
    expect(p.learn('elf', 'keeneye')).toBe(1);
    expect(p.learn('elf', 'piercing')).toBe(1);
    expect(p.block('elf', 'rainofarrows')).toBe('locked'); // needs Piercing Arrow II
    expect(p.learn('elf', 'piercing')).toBe(2);
    expect(p.learn('elf', 'rainofarrows')).toBe(1);
    expect(p.points).toBe(0);
    expect(p.learn('elf', 'keeneye')).toBeNull();
    expect(p.block('knight', 'keeneye')).toBe('not-in-tree');
    p.addXp(1e9);
    p.learn('elf', 'keeneye');
    p.learn('elf', 'keeneye');
    expect(p.block('elf', 'keeneye')).toBe('maxed');
    expect(p.value('keeneye')).toBeCloseTo(0.3);
  });

  it('a respec gives every point back', () => {
    const p = new Leveling();
    p.addXp(XP_FOR_LEVEL[5]);
    p.learn('elf', 'toughness');
    p.learn('elf', 'thorntrap');
    p.respec();
    expect(p.points).toBe(5);
    expect(p.rank('thorntrap')).toBe(0);
  });

  it('survives the trip over the network', () => {
    const p = new Leveling();
    p.addXp(4000);
    p.learn('elf', 'fleetfoot');
    p.learn('elf', 'tumble');
    const q = new Leveling();
    q.decode(p.encode());
    expect(q.level).toBe(p.level);
    expect(q.rank('tumble')).toBe(1);
    expect(q.points).toBe(p.points);
  });
});
