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

// ── Q03 Cages of the War Camp ───────────────────────────────────────────────────────────────────

/** Where Q03 happens: three cages in a courtyard by a sleeping guard pack, three war horns around it. */
export interface CampPlan {
  /** The courtyard the cages stand in. */
  centre: Pt;
  cages: [Pt, Pt, Pt];
  horns: [Pt, Pt, Pt];
  /** The landmark the courtyard is by. */
  near: string;
}

export const CAMP = {
  /** A player within this of a cage unlatches it (standing there: the familiar takes 2 s, the hero 3 s). */
  unlatchRange: 1.8,
  familiarSeconds: 2,
  heroSeconds: 3,
  /** A player within this of a cage finds the captives (the quest starts, if the merchant hasn't told you). */
  findRange: 10,
  /** An alarm raised this close to the cages reaches them, or this close to a standing war horn. */
  earshot: 20,
  hornReach: 25,
  /** Once the camp is raised, seconds before the guards drag the captives still caged to the keep (more with a horn down). */
  alarmSeconds: 20,
  alarmSecondsHornDown: 35,
  /** Party XP per captive freed straight from the cage, and per one freed after the battle. */
  xpDirect: 150,
  xpLate: 50,
  /** Merchant: prices off when all three were freed straight away / when some were. */
  discountAll: 0.25,
  discountSome: 0.1,
};

/**
 * Places Q03 in the war camp: the courtyard is the sleeping pack nearest the Chieftain's Standard
 * (the camp's middle landmark), the cages 7–12 m from it, the war horns in a ring 16–26 m round the
 * courtyard. Null elsewhere (or if the camp has no room for it).
 */
export function placeCampQuest(level: Level, theme: Pick<LevelTheme, 'feature' | 'layout'>, seed: number): CampPlan | null {
  if (theme.feature !== 'throne' || theme.layout === 'practice') return null;
  const map = level.map;
  const rng = mulberry32(seed ^ 0xca6e5);
  const mid = level.landmarks[1] ?? level.landmarks[0];
  const anchor = mid ?? level.start;
  const guards = level.packs
    .filter((p) => !p.boss && Math.hypot(p.x - level.start.x, p.z - level.start.z) > 45)
    .sort((a, b) => Math.hypot(a.x - anchor.x, a.z - anchor.z) - Math.hypot(b.x - anchor.x, b.z - anchor.z));
  const boss = level.halls.find((h) => h.kind === 'boss');
  const outsideBoss = (p: Pt) => !boss || Math.hypot(p.x - boss.x, p.z - boss.z) > boss.r + 6;
  for (const guard of guards.slice(0, 4)) {
    // Three cages side by side, 7–12 m from the guards, 3 m apart.
    const turn = rng() * Math.PI * 2;
    for (let k = 0; k < 8; k++) {
      const a = turn + (k / 8) * Math.PI * 2;
      const d = 7 + rng() * 5;
      const c = { x: guard.x + Math.cos(a) * d, z: guard.z + Math.sin(a) * d };
      const side = { x: -Math.sin(a), z: Math.cos(a) };
      const cages = [-1, 0, 1].map((s) => ({ x: c.x + side.x * 3 * s, z: c.z + side.z * 3 * s })) as [Pt, Pt, Pt];
      if (!cages.every((p) => map.clear(p.x, p.z, 1.2) && outsideBoss(p))) continue;
      if (walkPath(map, level.start, c).length < 2) continue;
      // The war horns: round the courtyard, spread out.
      const horns: Pt[] = [];
      const hturn = rng() * Math.PI * 2;
      for (let h = 0; h < 3; h++) {
        let spot: Pt | null = null;
        for (let t = 0; t < 12 && !spot; t++) {
          const ha = hturn + (h / 3) * Math.PI * 2 + (t % 2 ? 1 : -1) * Math.floor(t / 2) * 0.18;
          const hd = 16 + ((t * 3) % 10);
          const p = { x: c.x + Math.cos(ha) * hd, z: c.z + Math.sin(ha) * hd };
          if (map.clear(p.x, p.z, 1.2) && outsideBoss(p) && walkPath(map, c, p).length > 1) spot = p;
        }
        if (spot) horns.push(spot);
      }
      if (horns.length < 3) continue;
      return { centre: c, cages, horns: horns as [Pt, Pt, Pt], near: mid?.name ?? 'the camp' };
    }
  }
  return null;
}

export type CageState = 'shut' | 'open' | 'moved';
export const CAGE_STATES: CageState[] = ['shut', 'open', 'moved']; // index = wire code
export type CampStatus = 'unknown' | 'active' | 'done';
export const CAMP_STATUSES: CampStatus[] = ['unknown', 'active', 'done'];

export interface CampInput {
  /** A player is within CAMP.findRange of a cage. */
  found: boolean;
  /** Per cage: unlatching speed this step (1 / seconds: the familiar's or the hero's; 0 nobody there). */
  unlatch: [number, number, number];
  /** An alarm was raised this step that reaches the cages (near them, or near a standing horn). */
  alarm: boolean;
  /** War horns broken (0–3). */
  hornsDown: number;
  /** The Chieftain has fallen. */
  guardianDown: boolean;
}

export type CampEvent = { e: 'found' } | { e: 'unlatched'; cage: number } | { e: 'alarm'; seconds: number } | { e: 'moved'; count: number } | { e: 'done' };

/** Q03's state machine (docs/quests.md §6, State transitions). */
export class CampQuest {
  status: CampStatus = 'unknown';
  readonly cages: [CageState, CageState, CageState] = ['shut', 'shut', 'shut'];
  readonly progress: [number, number, number] = [0, 0, 0];
  /** Seconds left before the guards move the captives (0: no alarm running). */
  alarmLeft = 0;
  freedDirect = 0;
  freedLate = 0;
  private rewarded = false;

  /** The merchant told you about the captives (before the level). */
  hook(): void {
    if (this.status === 'unknown') this.status = 'active';
  }

  step(dt: number, i: CampInput): CampEvent[] {
    const out: CampEvent[] = [];
    if (this.status === 'done') return out;
    if (i.guardianDown && this.status === 'unknown') return out; // never found: it stays untold
    if (i.guardianDown) {
      // The camp falls: whoever is still caged or in the keep is freed now.
      this.freedLate = this.cages.filter((c) => c !== 'open').length;
      this.status = 'done';
      this.alarmLeft = 0;
      out.push({ e: 'done' });
      return out;
    }
    if (this.status === 'unknown') {
      if (!i.found) return out;
      this.status = 'active';
      out.push({ e: 'found' });
    }
    // Unlatching: standing at a cage (progress is kept if you step away).
    this.cages.forEach((c, k) => {
      if (c !== 'shut' || !i.unlatch[k]) return;
      this.progress[k] = Math.min(1, this.progress[k] + i.unlatch[k] * dt);
      if (this.progress[k] >= 1) {
        this.cages[k] = 'open';
        this.freedDirect++;
        out.push({ e: 'unlatched', cage: k });
      }
    });
    // The alarm: the guards come for the captives still caged.
    const caged = this.cages.some((c) => c === 'shut');
    if (i.alarm && i.hornsDown < 3 && !this.alarmLeft && caged) {
      this.alarmLeft = i.hornsDown > 0 ? CAMP.alarmSecondsHornDown : CAMP.alarmSeconds;
      out.push({ e: 'alarm', seconds: this.alarmLeft });
    } else if (this.alarmLeft > 0) {
      this.alarmLeft = Math.max(0, this.alarmLeft - dt);
      if (!this.alarmLeft) {
        let n = 0;
        this.cages.forEach((c, k) => {
          if (c === 'shut') {
            this.cages[k] = 'moved';
            n++;
          }
        });
        if (n) out.push({ e: 'moved', count: n });
      }
    }
    return out;
  }

  /** Party XP for how it went (once, after it's done; 0 after that). */
  claimXp(): number {
    if (this.status !== 'done' || this.rewarded) return 0;
    this.rewarded = true;
    return this.freedDirect * CAMP.xpDirect + this.freedLate * CAMP.xpLate;
  }

  /** How the merchant thanks you (after the level). */
  get thanks(): 'all' | 'some' | 'late' | 'none' {
    if (this.status === 'unknown') return 'none';
    if (this.freedDirect === 3) return 'all';
    if (this.freedDirect > 0) return 'some';
    return this.status === 'done' ? 'late' : 'none';
  }
}

/** Q03's tracker line (null before it's found). */
export function campTrackerLine(q: Pick<CampQuest, 'status' | 'cages' | 'alarmLeft' | 'freedDirect' | 'freedLate'>, hornsDown: number): { text: string; done: boolean } | null {
  if (q.status === 'unknown') return null;
  if (q.status === 'done') {
    const late = q.freedLate ? `, ${q.freedLate} after the battle` : '';
    return { text: `🔓 ${q.freedDirect} freed${late} — the merchant will hear of it`, done: true };
  }
  if (q.alarmLeft > 0) return { text: `📯 The camp is raised! Free them in ${Math.ceil(q.alarmLeft)} s`, done: false };
  const open = q.cages.filter((c) => c === 'open').length;
  const moved = q.cages.filter((c) => c === 'moved').length;
  const horns = hornsDown < 3 ? ` · 📯 horns ${3 - hornsDown}/3` : ' · 📯 horns silenced';
  return { text: `🔓 Free the caged folk ${open}/3${moved ? ` · ${moved} taken to the keep` : ''}${horns}`, done: false };
}

// ── Q02 The Knight Who Would Not Rest ───────────────────────────────────────────────────────────

/** Where Q02 happens: Sir Aldric's sarcophagus by the crypt's middle obelisk, and his three rune stones round it. */
export interface KnightPlan {
  tomb: Pt;
  /** Which way the tomb faces (radians): its lid's long side. */
  angle: number;
  stones: [Pt, Pt, Pt];
  near: string;
}

export const KNIGHT = {
  /** Within this of the tomb a player hears the knight (the quest starts). */
  findRange: 8,
  /** The familiar standing this close to a rune stone gets its riddle. */
  stoneRange: 2.6,
  /** The hero holding Interact (F) this close to the lid for this long takes the blade. */
  plunderRange: 2.8,
  plunderSeconds: 1.5,
  /** Skeletons that rise each time a rune stone breaks. */
  skeletonsPerStone: 2,
  xpFreed: 250,
  xpPlundered: 100,
  /** In the Necromancer fight: Sir Aldric's slam (every `every` s, `damage` within `radius`), and the Necromancer's skeleton cap with him there. */
  ally: { damage: 15, every: 1.4, radius: 2.2 },
  skeletonCap: 4,
  /** Plundered: the Necromancer raises Sir Aldric against you at this share of its health. */
  raiseAt: 0.75,
};

/**
 * Places Q02 in the Crypt: the tomb 5–8 m from the middle obelisk, the three rune stones 6–11 m from
 * the tomb, spread round it. Null elsewhere.
 */
export function placeKnightQuest(level: Level, theme: Pick<LevelTheme, 'feature' | 'layout'>, seed: number): KnightPlan | null {
  if (theme.feature !== 'brazier' || theme.layout === 'practice') return null;
  const map = level.map;
  const rng = mulberry32(seed ^ 0xa1d21c);
  const mark = level.landmarks[1] ?? level.landmarks[0];
  if (!mark) return null;
  const boss = level.halls.find((h) => h.kind === 'boss');
  const ok = (p: Pt, margin: number) => map.clear(p.x, p.z, margin) && (!boss || Math.hypot(p.x - boss.x, p.z - boss.z) > boss.r + 8) && Math.hypot(p.x - level.start.x, p.z - level.start.z) > 30;
  const turn = rng() * Math.PI * 2;
  for (let k = 0; k < 16; k++) {
    const a = turn + (k / 16) * Math.PI * 2;
    const d = 5 + rng() * 3;
    const tomb = { x: mark.x + Math.cos(a) * d, z: mark.z + Math.sin(a) * d };
    if (!ok(tomb, 1.6)) continue;
    const stones: Pt[] = [];
    const sturn = rng() * Math.PI * 2;
    for (let s = 0; s < 3; s++) {
      let spot: Pt | null = null;
      for (let t = 0; t < 14 && !spot; t++) {
        const sa = sturn + (s / 3) * Math.PI * 2 + (t % 2 ? 1 : -1) * Math.floor(t / 2) * 0.2;
        const sd = 6 + ((t * 7) % 6);
        const p = { x: tomb.x + Math.cos(sa) * sd, z: tomb.z + Math.sin(sa) * sd };
        if (ok(p, 1) && map.lineOfSight(tomb, p)) spot = p;
      }
      if (spot) stones.push(spot);
    }
    if (stones.length < 3) continue;
    return { tomb, angle: a, stones: stones as [Pt, Pt, Pt], near: mark.name };
  }
  return null;
}

export type KnightState = 'sleeping' | 'bound' | 'freeing' | 'freed' | 'plundered' | 'left';
export const KNIGHT_STATES: KnightState[] = ['sleeping', 'bound', 'freeing', 'freed', 'plundered', 'left'];

export interface KnightInput {
  /** A player is within KNIGHT.findRange of the tomb. */
  playerNear: boolean;
  /** A rune stone broke this step (by the familiar's riddle, or the hero's blow when playing solo). */
  runeBroken: boolean;
  /** Seconds the hero held Interact at the lid this step (0 if not at the lid). */
  plunder: number;
  /** Interact is held at all (letting go starts the taking over; stepping briefly away only pauses it). */
  holding: boolean;
  /** The Necromancer fight has begun. */
  bossFight: boolean;
}

export type KnightEvent = 'found' | 'rune' | 'freed' | 'plundered' | 'left';

/** Q02's state machine (docs/quests.md §5, State transitions). */
export class KnightQuest {
  state: KnightState = 'sleeping';
  runes = 0;
  /** Seconds of Interact held at the lid so far. */
  plunderHeld = 0;
  /** The boss fight began before anyone found the tomb: it stays asleep, untold. */
  untold = false;
  private rewarded = false;

  step(_dt: number, i: KnightInput): KnightEvent | null {
    switch (this.state) {
      case 'sleeping':
        if (i.bossFight) this.untold = true; // never found before the fight: it stays untold
        if (this.untold || !i.playerNear) return null;
        this.state = 'bound';
        return 'found';
      case 'bound':
      case 'freeing':
        if (i.bossFight) {
          this.state = 'left';
          return 'left';
        }
        if (i.runeBroken) {
          this.runes++;
          this.plunderHeld = 0;
          if (this.runes >= 3) {
            this.state = 'freed';
            return 'freed';
          }
          this.state = 'freeing';
          return 'rune';
        }
        // Taking the blade: only while no rune is broken (one path or the other).
        if (this.state === 'bound') {
          this.plunderHeld = i.holding ? this.plunderHeld + i.plunder : 0;
          if (this.plunderHeld >= KNIGHT.plunderSeconds - 1e-6) {
            this.state = 'plundered';
            return 'plundered';
          }
        }
        return null;
      default:
        return null;
    }
  }

  /** The reward for how it ended (once): XP, and whether the blade drops. */
  claim(): { xp: number; blade: boolean } | null {
    if (this.rewarded || (this.state !== 'freed' && this.state !== 'plundered')) return null;
    this.rewarded = true;
    return this.state === 'freed' ? { xp: KNIGHT.xpFreed, blade: false } : { xp: KNIGHT.xpPlundered, blade: true };
  }
}

/** Q02's tracker line (null before it's found, or if never found). */
export function knightTrackerLine(q: Pick<KnightQuest, 'state' | 'runes'>): { text: string; done: boolean } | null {
  switch (q.state) {
    case 'sleeping':
      return null;
    case 'bound':
      return { text: '🔵 Free Sir Aldric (break 3 rune stones) — or take his blade (hold F)', done: false };
    case 'freeing':
      return { text: `🔵 Break Sir Aldric’s rune stones ${q.runes}/3`, done: false };
    case 'freed':
      return { text: '🔵 Sir Aldric is free — he’ll stand with you', done: true };
    case 'plundered':
      return { text: '⚔️ You took Aldric’s Oath — the Necromancer stirs…', done: true };
    case 'left':
      return { text: '🔵 Sir Aldric sleeps on', done: true };
  }
}
