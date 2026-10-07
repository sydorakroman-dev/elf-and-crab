import { TILE, type WalkMap } from '../game/walkmap';

/** Tiles within this many metres of the hero or the familiar get revealed. */
const SIGHT = 16;
const PX = 2; // canvas pixels per tile
const REDRAW = 0.2; // seconds between redraws
/** The map shows this many tiles across around the elf (a level is much bigger). */
const VIEW = 70;

export interface MinimapMarks {
  hero: { x: number; z: number; facing?: number };
  familiar?: { x: number; z: number } | null;
  /** The exit doorway, and whether it's open. */
  exit?: { x: number; z: number; open: boolean } | null;
  /** Chests (not yet opened). */
  chests?: readonly { x: number; z: number }[];
  /** The guardian, when its hall has been seen. */
  boss?: { x: number; z: number } | null;
  /** Landmarks (shown once seen). */
  landmarks?: readonly { x: number; z: number }[];
  /** Where to head (the guardian, then the exit): an arrow on the map's edge while it's off the map. */
  goal?: { x: number; z: number } | null;
}

/**
 * The level map in a corner of the screen, centred on the elf: halls and corridors appear as you
 * explore them, with the elf, the familiar, the exit door and anything worth finding marked on it.
 */
export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private map: WalkMap | null = null;
  private seen = new Uint8Array(0);
  private timer = 0;
  private readonly base: HTMLCanvasElement;

  constructor(root: HTMLElement) {
    root.insertAdjacentHTML('beforeend', '<canvas class="minimap" hidden></canvas>');
    this.canvas = root.querySelector<HTMLCanvasElement>('canvas.minimap')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.base = document.createElement('canvas');
  }

  setVisible(v: boolean): void {
    this.canvas.hidden = !v;
  }

  /** A new level: everything unexplored again. */
  setLevel(map: WalkMap): void {
    if (map === this.map) return;
    this.map = map;
    this.seen = new Uint8Array(map.cols * map.rows);
    this.base.width = map.cols * PX;
    this.base.height = map.rows * PX;
    this.canvas.width = this.canvas.height = VIEW * PX;
    this.base.getContext('2d')!.clearRect(0, 0, this.base.width, this.base.height);
    this.timer = 0;
  }

  /** Has the tile at (x, z) been seen? */
  explored(x: number, z: number): boolean {
    const m = this.map;
    if (!m) return false;
    const c = m.col(x);
    const r = m.row(z);
    return c >= 0 && r >= 0 && c < m.cols && r < m.rows && this.seen[r * m.cols + c] === 1;
  }

  update(dt: number, marks: MinimapMarks): void {
    const m = this.map;
    if (!m || this.canvas.hidden) return;
    this.reveal(marks.hero.x, marks.hero.z);
    if (marks.familiar) this.reveal(marks.familiar.x, marks.familiar.z);
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = REDRAW;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    // The window of the map round the elf (kept inside the level where it can be).
    const fit = (centre: number, size: number) => (size <= VIEW ? (size - VIEW) / 2 : Math.max(0, Math.min(size - VIEW, centre - VIEW / 2)));
    const c0 = fit((marks.hero.x - m.originX) / TILE, m.cols);
    const r0 = fit((marks.hero.z - m.originZ) / TILE, m.rows);
    ctx.drawImage(this.base, -c0 * PX, -r0 * PX);
    const sx = (x: number) => ((x - m.originX) / TILE - c0) * PX;
    const sz = (z: number) => ((z - m.originZ) / TILE - r0) * PX;
    const dot = (x: number, z: number, r: number, fill: string, ring = 'rgba(0,0,0,0.7)') => {
      ctx.beginPath();
      ctx.arc(sx(x), sz(z), r, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = ring;
      ctx.stroke();
    };
    for (const c of marks.chests ?? []) if (this.explored(c.x, c.z)) dot(c.x, c.z, 3, '#ffd34d');
    for (const l of marks.landmarks ?? []) {
      if (!this.explored(l.x, l.z)) continue;
      // A little diamond for a landmark.
      const x = sx(l.x);
      const y = sz(l.z);
      ctx.beginPath();
      ctx.moveTo(x, y - 6);
      ctx.lineTo(x + 5, y);
      ctx.lineTo(x, y + 6);
      ctx.lineTo(x - 5, y);
      ctx.closePath();
      ctx.fillStyle = '#9fe0ff';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.stroke();
    }
    const goal = marks.goal;
    if (goal) {
      const gx = sx(goal.x);
      const gy = sz(goal.z);
      const size = VIEW * PX;
      if (gx < 0 || gy < 0 || gx > size || gy > size) {
        // Off the map: an arrow on the edge, pointing the way.
        const hx = sx(marks.hero.x);
        const hy = sz(marks.hero.z);
        const a = Math.atan2(gy - hy, gx - hx);
        const half = size / 2 - 9;
        const k = half / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
        ctx.save();
        ctx.translate(size / 2 + Math.cos(a) * k, size / 2 + Math.sin(a) * k);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.moveTo(8, 0);
        ctx.lineTo(-5, -6);
        ctx.lineTo(-5, 6);
        ctx.closePath();
        ctx.fillStyle = '#ff6a5a';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.stroke();
        ctx.restore();
      }
    }
    if (marks.exit && (marks.exit.open || this.explored(marks.exit.x, marks.exit.z + 2))) dot(marks.exit.x, marks.exit.z, 4, marks.exit.open ? '#fff1c0' : '#8a7a5a');
    if (marks.boss && this.explored(marks.boss.x, marks.boss.z)) dot(marks.boss.x, marks.boss.z, 4, '#ff4d5e');
    if (marks.familiar) dot(marks.familiar.x, marks.familiar.z, 3, '#7dffcf');
    const h = marks.hero;
    if (h.facing !== undefined) {
      // A little arrow for the elf, pointing where it faces.
      const cx = sx(h.x);
      const cz = sz(h.z);
      ctx.save();
      ctx.translate(cx, cz);
      ctx.rotate(-h.facing + Math.PI);
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4, 4);
      ctx.lineTo(0, 2);
      ctx.lineTo(-4, 4);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.stroke();
      ctx.restore();
    } else dot(h.x, h.z, 3.5, '#ffffff');
  }

  /** Marks the floor within sight of (x, z) as explored, and paints it on the base layer. */
  private reveal(x: number, z: number): void {
    const m = this.map!;
    const n = Math.ceil(SIGHT / TILE);
    const c0 = m.col(x);
    const r0 = m.row(z);
    const g = this.base.getContext('2d')!;
    for (let r = r0 - n; r <= r0 + n; r++)
      for (let c = c0 - n; c <= c0 + n; c++) {
        if (c < 0 || r < 0 || c >= m.cols || r >= m.rows) continue;
        const i = r * m.cols + c;
        if (this.seen[i]) continue;
        const p = m.centre(c, r);
        if (Math.hypot(p.x - x, p.z - z) > SIGHT) continue;
        // Floor is seen if a straight line reaches it; walls next to seen floor show as walls.
        if (m.isFloor(c, r)) {
          if (!m.lineOfSight({ x, z }, p)) continue;
          this.seen[i] = 1;
          g.fillStyle = 'rgba(214, 200, 168, 0.85)';
        } else {
          if (!this.nextToSeenFloor(c, r)) continue;
          this.seen[i] = 2;
          g.fillStyle = 'rgba(70, 62, 52, 0.9)';
        }
        g.fillRect(c * PX, r * PX, PX, PX);
      }
  }

  private nextToSeenFloor(c: number, r: number): boolean {
    const m = this.map!;
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const nc = c + dc;
        const nr = r + dr;
        if (m.isFloor(nc, nr) && this.seen[nr * m.cols + nc] === 1) return true;
      }
    return false;
  }
}
