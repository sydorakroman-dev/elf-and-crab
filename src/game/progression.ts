/**
 * The party's level and the hero's skill tree. Every kill gives its score as experience, shared by
 * the hero and the familiar (one party level, 1–12, starting over each run); every level after the
 * first gives a skill point to spend in the hero's tree. Pure data and rules, unit tested; Game
 * applies the effects.
 */
import type { AbilityId } from './abilities';
import type { HeroClass } from './heroes';

export const MAX_LEVEL = 12;

/**
 * Total experience to reach each level (index = level − 1). Tuned so clearing about half of each
 * dungeon level's foes reaches level ~4 after the Woodland and 12 by the Ash King (a full clear of
 * all seven holds ~27,000).
 */
export const XP_FOR_LEVEL = [0, 500, 1050, 1750, 2550, 3500, 4600, 5900, 7450, 9300, 11450, 14000];

/** The level reached with `xp` experience. */
export function levelFor(xp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && xp >= XP_FOR_LEVEL[level]) level++;
  return level;
}

/** Experience a run starting at dungeon level `room` (0-based; "continue") begins with: about what half-clearing the ones before gives. */
export const XP_AT_ROOM = [0, 1500, 3000, 4700, 7000, 10000, 13300];

/** How far through the current level (0..1; 1 at the cap). */
export function levelProgress(xp: number): number {
  const level = levelFor(xp);
  if (level >= MAX_LEVEL) return 1;
  const from = XP_FOR_LEVEL[level - 1];
  return (xp - from) / (XP_FOR_LEVEL[level] - from);
}

// ── Skill trees ─────────────────────────────────────────────────────────────────────────────────

export type TreeSkillId =
  | 'keeneye' | 'piercing' | 'rainofarrows'
  | 'fleetfoot' | 'tumble' | 'huntersmark'
  | 'toughness' | 'thorntrap' | 'callforest';

export interface TreeSkill {
  id: TreeSkillId;
  name: string;
  icon: string;
  /** passive: always on · active: a new button on the action bar · upgrade: changes a skill you have. */
  kind: 'passive' | 'active' | 'upgrade';
  /** The action this unlocks (actives). */
  ability?: AbilityId;
  /** Needs this skill at this rank first. */
  requires?: { id: TreeSkillId; rank: number };
  /** What each rank (I, II, III) does. */
  ranks: [string, string, string];
}

export interface TreeBranch {
  name: string;
  color: string;
  skills: [TreeSkill, TreeSkill, TreeSkill];
}

export const MAX_RANK = 3;

/** The numbers behind each rank (index = rank − 1). */
export const TREE_VALUES = {
  /** Arrow (basic attack) damage +share. */
  keeneye: [0.1, 0.2, 0.3],
  /** Piercing Arrow damage. */
  piercing: [30, 45, 60],
  /** Rain of Arrows: damage to each foe in the circle every RAIN.tick seconds. */
  rainofarrows: [4, 6, 8],
  /** Move speed +share (stamina comes back faster by FLEET_STAMINA × this). */
  fleetfoot: [0.06, 0.12, 0.18],
  /** Seconds the decoy holds the foes' attention. */
  tumble: [2, 3.5, 5],
  /** Damage taken by the marked foe +share. */
  huntersmark: [0.2, 0.3, 0.4],
  /** Max health +. */
  toughness: [15, 30, 45],
  /** Thorn Trap: [root seconds, damage]. */
  thorntrap: [
    [2, 15],
    [2.5, 25],
    [3, 35],
  ],
  /** Seconds the treant stays. */
  callforest: [12, 16, 20],
} as const;

/** Stamina regen +share per point of Fleet Foot's speed share (6% speed → 10% stamina). */
export const FLEET_STAMINA = 10 / 6;
export const PIERCING = { range: 30 };
export const RAIN = { radius: 5, seconds: 3, tick: 0.25, range: 16 };
export const MARK = { seconds: 8, range: 24 };
export const TRAP = { radius: 1.6, seconds: 40, max: 2 };
export const TUMBLE = { freeEvery: 8 };
/** The treant: its slam (every `every` s, `damage` to foes within `radius` of where it lands). */
export const TREANT_ALLY = { damage: [14, 18, 22], every: 1.3, radius: 2.4, reach: 2.2 };

export const TREES: Partial<Record<HeroClass, [TreeBranch, TreeBranch, TreeBranch]>> = {
  elf: [
    {
      name: 'Marksman',
      color: '#ff8a6b',
      skills: [
        { id: 'keeneye', name: 'Keen Eye', icon: '🎯', kind: 'passive', ranks: ['+10% arrow damage', '+20% arrow damage', '+30% arrow damage'] },
        {
          id: 'piercing', name: 'Piercing Arrow', icon: '➶', kind: 'active', ability: 'piercing', requires: { id: 'keeneye', rank: 1 },
          ranks: ['A heavy arrow through every foe in its line: 30 damage', '45 damage to each', '60 damage to each'],
        },
        {
          id: 'rainofarrows', name: 'Rain of Arrows', icon: '🌧️', kind: 'active', ability: 'rainofarrows', requires: { id: 'piercing', rank: 2 },
          ranks: ['Arrows rain on a 5 m circle where you aim for 3 s: 4 damage every ¼ s', '6 damage every ¼ s', '8 damage every ¼ s'],
        },
      ],
    },
    {
      name: 'Ranger',
      color: '#8fe39a',
      skills: [
        { id: 'fleetfoot', name: 'Fleet Foot', icon: '🍃', kind: 'passive', ranks: ['+6% speed, stamina back 10% faster', '+12% speed, stamina 20% faster', '+18% speed, stamina 30% faster'] },
        {
          id: 'tumble', name: 'Tumble', icon: '🤸', kind: 'upgrade', requires: { id: 'fleetfoot', rank: 1 },
          ranks: ['Dash leaves a decoy: foes chase it for 2 s', 'The decoy lasts 3.5 s', 'The decoy lasts 5 s, and one dash every 8 s is free'],
        },
        {
          id: 'huntersmark', name: 'Hunter’s Mark', icon: '👁️', kind: 'active', ability: 'huntersmark', requires: { id: 'tumble', rank: 1 },
          ranks: ['Mark the foe you aim at for 8 s: it takes 20% more damage (from both of you) and shows through walls', '30% more damage', '40% more damage'],
        },
      ],
    },
    {
      name: 'Wildcraft',
      color: '#6fc3ff',
      skills: [
        { id: 'toughness', name: 'Toughness', icon: '🌰', kind: 'passive', ranks: ['+15 max health', '+30 max health', '+45 max health'] },
        {
          id: 'thorntrap', name: 'Thorn Trap', icon: '🌿', kind: 'active', ability: 'thorntrap', requires: { id: 'toughness', rank: 1 },
          ranks: ['Set a trap at your feet: the first foes in it are rooted 2 s and take 15 (two traps at once)', 'Rooted 2.5 s, 25 damage', 'Rooted 3 s, 35 damage'],
        },
        {
          id: 'callforest', name: 'Call of the Forest', icon: '🌳', kind: 'active', ability: 'callforest', requires: { id: 'thorntrap', rank: 2 },
          ranks: ['A treant fights beside you for 12 s', 'For 16 s, hitting harder', 'For 20 s, hitting harder still'],
        },
      ],
    },
  ],
};

/** Every skill in a hero's tree (none yet for heroes without one). */
export function treeSkills(hero: HeroClass): TreeSkill[] {
  return (TREES[hero] ?? []).flatMap((b) => b.skills);
}

export const TREE_SKILL_IDS: TreeSkillId[] = ['keeneye', 'piercing', 'rainofarrows', 'fleetfoot', 'tumble', 'huntersmark', 'toughness', 'thorntrap', 'callforest']; // index = wire code: append only

/** Why a skill can't take a point now (null: it can). */
export type LearnBlock = 'no-points' | 'maxed' | 'locked' | 'not-in-tree';

/** A run's experience, level, and the points spent in the tree. */
export class Leveling {
  xp = 0;
  private readonly ranks = new Map<TreeSkillId, number>();

  get level(): number {
    return levelFor(this.xp);
  }

  /** Points earned (one per level after the first) and not yet spent. */
  get points(): number {
    let spent = 0;
    for (const r of this.ranks.values()) spent += r;
    return this.level - 1 - spent;
  }

  rank(id: TreeSkillId): number {
    return this.ranks.get(id) ?? 0;
  }

  /** The skill's number at its current rank (0 / null when not learned). */
  value<K extends keyof typeof TREE_VALUES>(id: K): (typeof TREE_VALUES)[K][number] | 0 {
    const r = this.rank(id);
    return r ? TREE_VALUES[id][r - 1] : 0;
  }

  /** Adds experience; returns how many levels that gained. */
  addXp(amount: number): number {
    const before = this.level;
    this.xp = Math.min(XP_FOR_LEVEL[MAX_LEVEL - 1], this.xp + Math.max(0, amount));
    return this.level - before;
  }

  /** Can `id` take a point now? */
  block(hero: HeroClass, id: TreeSkillId): LearnBlock | null {
    const skill = treeSkills(hero).find((s) => s.id === id);
    if (!skill) return 'not-in-tree';
    if (this.rank(id) >= MAX_RANK) return 'maxed';
    if (skill.requires && this.rank(skill.requires.id) < skill.requires.rank) return 'locked';
    if (this.points <= 0) return 'no-points';
    return null;
  }

  /** Spends a point on `id`; returns the new rank, or null if it can't. */
  learn(hero: HeroClass, id: TreeSkillId): number | null {
    if (this.block(hero, id)) return null;
    const r = this.rank(id) + 1;
    this.ranks.set(id, r);
    return r;
  }

  /** Takes back every point spent (the merchant's respec). */
  respec(): void {
    this.ranks.clear();
  }

  reset(): void {
    this.xp = 0;
    this.ranks.clear();
  }

  /** Network form: [xp, rank of each tree skill in TREE_SKILL_IDS order]. */
  encode(): number[] {
    return [Math.round(this.xp), ...TREE_SKILL_IDS.map((id) => this.rank(id))];
  }

  /** From the network form (the familiar's tablet). */
  decode(t: readonly number[]): void {
    this.xp = t[0] ?? 0;
    this.ranks.clear();
    TREE_SKILL_IDS.forEach((id, i) => {
      const r = t[i + 1] ?? 0;
      if (r) this.ranks.set(id, r);
    });
  }
}

/** Gold to reset the tree at the merchant's camp. */
export function respecCost(level: number): number {
  return 40 * level;
}
