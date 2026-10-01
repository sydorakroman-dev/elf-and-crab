import type { Point } from './combat';

/** The familiar creatures a second player can pick, and their spells. Pure data + math; unit tested. */

export type FamiliarKind = 'crab' | 'capybara' | 'wolf';
export type SpellId = 'burst' | 'shell' | 'spring' | 'calm' | 'pounce';

export const FAMILIAR_KINDS: FamiliarKind[] = ['crab', 'capybara', 'wolf'];
export const SPELL_IDS: SpellId[] = ['burst', 'shell', 'spring', 'calm', 'pounce'];

export interface FamiliarDef {
  name: string;
  emoji: string;
  /** Card art in public/art/. */
  art: string;
  /** Glow / UI colour. */
  color: number;
  /** Move speed, m/s (the elf walks at 7.5). */
  speed: number;
  /** How it walks: crabs scuttle sideways, others face where they go. */
  gait: 'sideways' | 'forward';
  /** Auto-attack on enemies in reach: damage and seconds between bites. */
  biteDamage: number;
  biteCooldown: number;
  /** Body radius for collisions. */
  radius: number;
  spells: SpellId[];
  blurb: string;
}

export const FAMILIARS: Record<FamiliarKind, FamiliarDef> = {
  crab: {
    name: 'Crab',
    emoji: '🦀',
    art: 'art/crab.webp',
    color: 0x6fe8d6,
    speed: 8,
    gait: 'sideways',
    biteDamage: 10,
    biteCooldown: 0.8,
    radius: 0.6,
    spells: ['burst', 'shell'],
    blurb: 'Crowd control and protection.',
  },
  capybara: {
    name: 'Capybara',
    emoji: '🦫',
    art: 'art/capybara.webp',
    color: 0x8fe39a,
    speed: 6,
    gait: 'forward',
    biteDamage: 8,
    biteCooldown: 1.2,
    radius: 0.7,
    spells: ['spring', 'calm'],
    blurb: 'Slow and steady. Heals and soothes.',
  },
  wolf: {
    name: 'Wolf',
    emoji: '🐺',
    art: 'art/wolf.webp',
    color: 0x9fd4ff,
    speed: 11,
    gait: 'forward',
    biteDamage: 12,
    biteCooldown: 0.55,
    radius: 0.6,
    spells: ['pounce'],
    blurb: 'Fast hunter. Big damage.',
  },
};

export interface SpellDef {
  name: string;
  icon: string;
  cooldown: number;
  /** Area radius (m) where it applies, for range rings; 0 if not an area spell. */
  radius: number;
  /** Effect duration (s), where it applies. */
  duration: number;
  description: string;
}

export const SPELLS: Record<SpellId, SpellDef> = {
  burst: { name: 'Magic Burst', icon: '✨', cooldown: 7, radius: 5.5, duration: 2.5, description: 'Stuns every enemy around you.' },
  shell: { name: 'Shell Shield', icon: '🐚', cooldown: 11, radius: 0, duration: 0, description: 'The elf gets a bubble that blocks the next hit.' },
  spring: { name: 'Soothing Spring', icon: '♨️', cooldown: 10, radius: 3, duration: 6, description: 'A warm pool: enemies in it slow down, the elf heals a heart in it.' },
  calm: { name: 'Calm Aura', icon: '🌸', cooldown: 8, radius: 7, duration: 5, description: 'Enemies near you stop chasing and wander off.' },
  pounce: { name: 'Pounce', icon: '🐾', cooldown: 5, radius: 0, duration: 0.35, description: 'Leap toward where you tapped, hitting every enemy on the way.' },
};

/** Soothing Spring: enemies inside move at this fraction of their speed (60% slower). */
export const SPRING_SLOW = 0.4;
export const POUNCE_RANGE = 10;
export const POUNCE_DAMAGE = 25;
/** How close (beyond body radii) an enemy must be to the pounce path to get hit. */
export const POUNCE_WIDTH = 0.8;

/** Seconds left on each spell's cooldown. */
export class SpellCooldowns {
  private readonly left = new Map<SpellId, number>();

  ready(id: SpellId): boolean {
    return (this.left.get(id) ?? 0) <= 0;
  }

  remaining(id: SpellId): number {
    return Math.max(0, this.left.get(id) ?? 0);
  }

  /** Starts the cooldown if the spell is ready; returns whether it was cast. */
  tryCast(id: SpellId): boolean {
    if (!this.ready(id)) return false;
    this.left.set(id, SPELLS[id].cooldown);
    return true;
  }

  tick(dt: number): void {
    for (const [id, t] of this.left) this.left.set(id, t - dt);
  }

  clear(): void {
    this.left.clear();
  }
}

/**
 * Where a pounce lands: toward `target` (the last tap) up to POUNCE_RANGE; if the tap is right
 * underfoot, straight ahead along `heading` (model front = +Z) for the full range.
 */
export function pounceLanding(from: Point, target: Point | null, heading: number): Point {
  if (target) {
    const dx = target.x - from.x;
    const dz = target.z - from.z;
    const d = Math.hypot(dx, dz);
    if (d > 1) {
      const k = Math.min(d, POUNCE_RANGE) / d;
      return { x: from.x + dx * k, z: from.z + dz * k };
    }
  }
  return { x: from.x + Math.sin(heading) * POUNCE_RANGE, z: from.z + Math.cos(heading) * POUNCE_RANGE };
}

/** Distance from point p to the segment a→b. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2));
  return Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t));
}
