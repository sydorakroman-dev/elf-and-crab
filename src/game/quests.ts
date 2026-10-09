/**
 * Quests (docs/quests.md): optional, per-run stories inside a level. Pure data and rules, unit
 * tested; Game runs them and draws them, the familiar's tablet mirrors them.
 *
 * Q01 The Lantern Fox (the Woodland): a lost fox kit waits near the start. It follows the familiar
 * (or the hero, playing solo) home to its den under the Hollow Oak, but hides whenever a monster is
 * awake close by. Home safe, its family opens their burrow: a tunnel to the guardian's hall.
 */
import type { Level } from '../world/levelgen';
import type { LevelTheme } from '../world/levelgen';
import { mulberry32 } from '../util/rng';
import type { WalkMap } from './walkmap';

type Pt = { x: number; z: number };

/** Where Q01 happens in a level (the same on the hero's browser and the tablet: it comes from the seed). */
export interface FoxPlan {
  kit: Pt;
  /** The den: a burrow at the foot of the Hollow Oak. */
  den: Pt;
  denName: string;
  /** The burrow's other end, just outside the guardian's hall. */
  exit: Pt;
  /** The paw-print trail from the kit to the den (one every few metres). */
  trail: Pt[];
}

export const FOX = {
  /** Within this of the kit, a player finds it (the quest starts). */
  findRange: 6,
  /** An awake monster this close to the kit makes it hide… */
  spookRange: 10,
  /** …until there's been none that close for this long. */
  calmSeconds: 2,
  /** The kit is home within this of the den. */
  homeRange: 3,
  /** Step onto the open burrow within this to go through. */
  burrowRange: 1.4,
  /** Rewards: party XP, and the familiar's Lantern Charm (+familiar speed). */
  xp: 300,
  charmSpeed: 0.1,
  /** How far (m, walking) along the way from the start to the den the kit waits. */
  kitAlong: [30, 60] as const,
  /** Paw prints, every this many metres. */
  trailStep: 6,
};

/** The landmark the den is under. */
export const FOX_DEN_LANDMARK = 'the Hollow Oak';

/**
 * Places Q01 in a Woodland level: the den under the Hollow Oak, the kit 30–60 m along the way there
 * from the start (clear of packs), the trail between, and the burrow's other end south of the
 * guardian's hall. Null where it doesn't happen (other levels, the practice room, no oak).
 */
export function placeFoxQuest(level: Level, theme: Pick<LevelTheme, 'feature' | 'layout'>, seed: number): FoxPlan | null {
  if (theme.feature !== 'woodland' || theme.layout === 'practice') return null;
  const oak = level.landmarks.find((l) => l.name === FOX_DEN_LANDMARK);
  const boss = level.halls.find((h) => h.kind === 'boss');
  if (!oak || !boss) return null;
  const map = level.map;
  const rng = mulberry32(seed ^ 0x0f0c5);
  // The den: at the oak's foot, on the side facing the start (south, +z).
  const den = clearSpot(map, oak.x, oak.z + 4.5, 1.2) ?? clearSpot(map, oak.x, oak.z, 1.2);
  if (!den) return null;
  // The way from the start to the den, walked tile by tile.
  const path = walkPath(map, level.start, den);
  if (path.length < 10) return null;
  const packFree = (p: Pt) => level.packs.every((k) => Math.hypot(k.x - p.x, k.z - p.z) > 18);
  let kit: Pt | null = null;
  let kitAt = 0;
  const [lo, hi] = FOX.kitAlong;
  const tries = [lo + rng() * (hi - lo), lo, (lo + hi) / 2, hi];
  for (const want of tries) {
    const i = indexAtDistance(path, want);
    const p = path[i];
    if (p && packFree(p) && map.clear(p.x, p.z, 1)) {
      kit = p;
      kitAt = i;
      break;
    }
  }
  if (!kit) {
    kitAt = indexAtDistance(path, lo);
    kit = path[kitAt];
  }
  // Paw prints from the kit to the den.
  const trail: Pt[] = [];
  let since = 0;
  for (let i = kitAt + 1; i < path.length; i++) {
    since += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
    if (since >= FOX.trailStep) {
      trail.push(path[i]);
      since = 0;
    }
  }
  // The burrow's far end: just south of the guardian's hall (outside the fight).
  const exit = clearSpot(map, boss.x, boss.z + boss.r + 5, 1.2) ?? clearSpot(map, boss.x, boss.z + boss.r, 1.2);
  if (!exit) return null;
  return { kit, den, denName: FOX_DEN_LANDMARK, exit, trail };
}

/** A floor point near (x, z) at least `margin` from walls (searching outward), or null. */
function clearSpot(map: WalkMap, x: number, z: number, margin: number): Pt | null {
  for (let ring = 0; ring <= 8; ring++)
    for (let k = 0; k < Math.max(1, ring * 6); k++) {
      const a = (k / Math.max(1, ring * 6)) * Math.PI * 2;
      const px = x + Math.cos(a) * ring * 1.5;
      const pz = z + Math.sin(a) * ring * 1.5;
      if (map.clear(px, pz, margin)) return { x: px, z: pz };
    }
  return null;
}

/** The walking path (tile centres) from `a` to `b`, or [] if there's no way. */
export function walkPath(map: WalkMap, a: Pt, b: Pt): Pt[] {
  const field = map.distanceField(b.x, b.z);
  let c = map.col(a.x);
  let r = map.row(a.z);
  if (!map.isFloor(c, r)) {
    const p = map.nearestFloor(a.x, a.z);
    c = map.col(p.x);
    r = map.row(p.z);
  }
  if (field[r * map.cols + c] < 0) return [];
  const out: Pt[] = [map.centre(c, r)];
  for (let guard = 0; guard < map.cols * map.rows; guard++) {
    const here = field[r * map.cols + c];
    if (here <= 0) break;
    let best = -1;
    let bc = c;
    let br = r;
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = c + dc;
        const nr = r + dr;
        if (!map.isFloor(nc, nr)) continue;
        if (dr && dc && (!map.isFloor(c + dc, r) || !map.isFloor(c, r + dr))) continue;
        const d = field[nr * map.cols + nc];
        if (d >= 0 && d < here && (best < 0 || d < best)) {
          best = d;
          bc = nc;
          br = nr;
        }
      }
    if (best < 0) break;
    c = bc;
    r = br;
    out.push(map.centre(c, r));
  }
  return out;
}

function indexAtDistance(path: Pt[], metres: number): number {
  let d = 0;
  for (let i = 1; i < path.length; i++) {
    d += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
    if (d >= metres) return i;
  }
  return path.length - 1;
}

// ── Q01's state ─────────────────────────────────────────────────────────────────────────────────

export type FoxState = 'waiting' | 'following' | 'hiding' | 'home' | 'closed';
export const FOX_STATES: FoxState[] = ['waiting', 'following', 'hiding', 'home', 'closed']; // index = wire code

/** What the world looks like to the quest this step. */
export interface FoxInput {
  /** A player is within FOX.findRange of the kit. */
  playerNear: boolean;
  /** An awake (not calmed / stunned) monster is within FOX.spookRange of the kit. */
  threat: boolean;
  /** The kit is within FOX.homeRange of the den. */
  atDen: boolean;
  /** The level's guardian has fallen. */
  guardianDown: boolean;
}

export type FoxEvent = 'found' | 'spooked' | 'calmed' | 'home' | 'closed';

/** Q01's state machine (docs/quests.md §4, State transitions). */
export class FoxQuest {
  state: FoxState = 'waiting';
  /** Seconds without a threat while hiding. */
  private calm = 0;
  /** The reward was given (never twice). */
  rewarded = false;

  step(dt: number, i: FoxInput): FoxEvent | null {
    const open = this.state === 'waiting' || this.state === 'following' || this.state === 'hiding';
    if (open && i.guardianDown) {
      this.state = 'closed';
      return 'closed';
    }
    switch (this.state) {
      case 'waiting':
        if (!i.playerNear) return null;
        this.state = 'following';
        return 'found';
      case 'following':
        if (i.atDen) {
          this.state = 'home';
          return 'home';
        }
        if (i.threat) {
          this.state = 'hiding';
          this.calm = 0;
          return 'spooked';
        }
        return null;
      case 'hiding':
        this.calm = i.threat ? 0 : this.calm + dt;
        if (this.calm < FOX.calmSeconds) return null;
        this.state = 'following';
        return 'calmed';
      default:
        return null;
    }
  }

  /** Grants the reward once: true the first time it's asked for after reaching home. */
  claimReward(): boolean {
    if (this.state !== 'home' || this.rewarded) return false;
    this.rewarded = true;
    return true;
  }

  /** The burrow to the guardian's hall is open. */
  get burrowOpen(): boolean {
    return this.state === 'home';
  }
}

/** The tracker line for Q01 (null: nothing to show — not found yet). */
export function foxTrackerLine(state: FoxState, metres: number): { text: string; done: boolean } | null {
  switch (state) {
    case 'waiting':
      return null;
    case 'following':
      return { text: `🦊 Lead the kit home to the Hollow Oak · ${Math.round(metres)} m`, done: false };
    case 'hiding':
      return { text: '🦊 The kit is hiding — clear the monsters near it!', done: false };
    case 'home':
      return { text: '🦊 Home safe! The burrow leads to the guardian', done: true };
    case 'closed':
      return { text: '🦊 The kit found its own way home', done: true };
  }
}
