import { HERO_SLOTS, POTIONS, RARITY_INFO, SLOT_INFO, STAT_INFO, fits, sellPrice, statLines, type BagEntry, type GearSlot, type Item, type StatKey } from '../game/items';
import type { InvOp, InvState, StockEntry } from '../game/inventory';

type Selection = { from: 'bag'; i: number } | { from: 'gear'; slot: GearSlot } | { from: 'shop'; i: number } | null;
type Thing = BagEntry | { kind: 'book' };

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** How far (px) a press has to move before it's a drag rather than a tap. */
const DRAG_START = 6;

const BASE = import.meta.env.BASE_URL;
/** Gear kinds shown with a basic placeholder picture until they get painted art. */
const PLACEHOLDER = new Set(['offhand', 'collar', 'charm']);

/** An item's icon: its painted picture where it has one (bows, armor), otherwise an emoji. */
function iconOf(e: Thing): string {
  if (e.kind === 'book') return '📖';
  if (e.kind === 'potion') return POTIONS[e.potion].icon;
  if (e.art) return `<img class="item-art" src="${BASE}art/items/${e.slot}-${e.art}.webp" alt="" draggable="false" />`;
  // Kinds still waiting for their art: a plain placeholder picture.
  if (PLACEHOLDER.has(e.slot)) return `<img class="item-art" src="${BASE}art/items/${e.slot}-0.svg" alt="" draggable="false" />`;
  return SLOT_INFO[e.slot].icon;
}

function nameOf(e: Thing): string {
  if (e.kind === 'book') return 'Spell Book';
  if (e.kind === 'potion') return POTIONS[e.potion].name;
  return e.name;
}

function colorOf(e: Thing): string {
  if (e.kind === 'item') return RARITY_INFO[e.rarity].color;
  if (e.kind === 'potion') return `#${POTIONS[e.potion].color.toString(16).padStart(6, '0')}`;
  return '#c79bff';
}

/** Where each gear slot sits on the paper doll (grid areas): weapons tall at the sides, armor in the middle. */
const DOLL: Record<GearSlot, { area: string; size: 'small' | 'tall' | 'body' }> = {
  amulet: { area: 'amulet', size: 'small' },
  helmet: { area: 'helmet', size: 'small' },
  gloves: { area: 'gloves', size: 'small' },
  bow: { area: 'bow', size: 'tall' },
  armor: { area: 'armor', size: 'body' },
  cape: { area: 'cape', size: 'small' },
  belt: { area: 'belt', size: 'small' },
  offhand: { area: 'offhand', size: 'tall' },
  ring: { area: 'ring', size: 'small' },
  boots: { area: 'boots', size: 'small' },
  ring2: { area: 'ring2', size: 'small' },
  collar: { area: 'collar', size: 'small' },
  charm: { area: 'charm', size: 'small' },
};

/**
 * The bag: the elf's gear on a paper doll (and the familiar's two slots), the 16-slot bag shared
 * by both, the gold — and, between levels, the merchant's wares. Drag things between them (onto a
 * gear slot to wear it, onto the merchant to sell, onto the bin to drop), or tap one to look at it
 * and use the buttons. Used on the hero's screen and the familiar's tablet alike; actions go out
 * through `onAction` (the hero's game checks and applies them).
 */
export class InventoryPanel {
  onAction?: (req: InvOp) => void;
  onClose?: () => void;
  /** The merchant's "Continue" (the hero leaves for the next level). */
  onContinue?: () => void;
  private readonly el: HTMLElement;
  private readonly role: 'hero' | 'familiar';
  private state: InvState | null = null;
  private shop: StockEntry[] | null = null;
  private sel: Selection = null;
  private statsLine = '';
  private key = '';
  /** A press that may become a drag, and the floating icon once it is one. */
  private press: { src: Selection; x: number; y: number; id: number } | null = null;
  private ghost: HTMLElement | null = null;
  private dragged = false;

  constructor(root: HTMLElement, role: 'hero' | 'familiar') {
    this.role = role;
    root.insertAdjacentHTML('beforeend', `<div class="bag-panel ${role}" hidden></div>`);
    this.el = root.querySelector<HTMLElement>(`.bag-panel.${role}`)!;
    // Taps and clicks inside the panel stay in the panel (they mustn't shoot, steer or unpause).
    for (const type of ['pointerdown', 'pointerup', 'click', 'touchstart', 'touchend', 'mousedown'] as const)
      this.el.addEventListener(type, (e) => e.stopPropagation(), { passive: type.startsWith('touch') });
    this.el.addEventListener('click', (e) => this.click(e.target as HTMLElement));
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.el.addEventListener('pointerdown', (e) => this.down(e));
    this.el.addEventListener('pointermove', (e) => this.move(e));
    this.el.addEventListener('pointerup', (e) => this.up(e));
    this.el.addEventListener('pointercancel', () => this.endDrag());
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(): void {
    this.el.hidden = false;
    this.key = '';
    this.render();
  }

  close(): void {
    if (this.el.hidden) return;
    this.endDrag();
    this.el.hidden = true;
    this.sel = null;
  }

  /** New inventory / shop to show (redraws only when something changed). */
  update(state: InvState | null, shop: StockEntry[] | null, statsLine = ''): void {
    this.state = state;
    this.shop = shop;
    this.statsLine = statsLine;
    if (!this.el.hidden && !this.ghost) this.render();
  }

  // ── Drag and drop ───────────────────────────────────────────────────────────────────────────

  /** What a cell holds: a selection pointing at it, if there's something there. */
  private cellSource(t: HTMLElement): Selection {
    const cell = t.closest<HTMLElement>('[data-bag],[data-gear],[data-shop]');
    if (!cell || !this.state) return null;
    if (cell.dataset.bag !== undefined) {
      const i = Number(cell.dataset.bag);
      return this.state.bag[i] ? { from: 'bag', i } : null;
    }
    if (cell.dataset.gear) {
      const slot = cell.dataset.gear as GearSlot;
      return this.state.gear[slot] ? { from: 'gear', slot } : null;
    }
    const i = Number(cell.dataset.shop);
    return this.shop?.[i] && !this.shop[i].sold ? { from: 'shop', i } : null;
  }

  private thingAt(s: Selection): Thing | null {
    const st = this.state;
    if (!s || !st) return null;
    if (s.from === 'bag') return st.bag[s.i] ?? null;
    if (s.from === 'gear') return st.gear[s.slot];
    const e = this.shop?.[s.i];
    return e && !e.sold ? e.what : null;
  }

  private down(e: PointerEvent): void {
    if (e.button > 0) return;
    const src = this.cellSource(e.target as HTMLElement);
    if (!src) return;
    this.press = { src, x: e.clientX, y: e.clientY, id: e.pointerId };
    this.dragged = false;
  }

  private move(e: PointerEvent): void {
    const p = this.press;
    if (!p || p.id !== e.pointerId) return;
    if (!this.ghost) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_START) return;
      const thing = this.thingAt(p.src);
      if (!thing) return;
      // Start dragging: a floating icon follows the pointer; fitting places light up.
      this.ghost = document.createElement('div');
      this.ghost.className = 'bag-ghost';
      this.ghost.style.setProperty('--rc', colorOf(thing));
      this.ghost.innerHTML = iconOf(thing);
      document.body.append(this.ghost);
      this.el.setPointerCapture(e.pointerId);
      this.el.classList.add('dragging');
      for (const g of this.el.querySelectorAll<HTMLElement>('[data-gear]')) g.classList.toggle('fits', thing.kind === 'item' && fits(thing.slot, g.dataset.gear as GearSlot));
      this.sel = p.src;
    }
    this.ghost.style.left = `${e.clientX}px`;
    this.ghost.style.top = `${e.clientY}px`;
    for (const t of this.el.querySelectorAll('.drop-over')) t.classList.remove('drop-over');
    this.dropTarget(e.clientX, e.clientY)?.classList.add('drop-over');
  }

  private dropTarget(x: number, y: number): HTMLElement | null {
    const under = document.elementFromPoint(x, y) as HTMLElement | null;
    return under?.closest<HTMLElement>('[data-bag],[data-gear],[data-sell-zone],[data-trash],[data-buy-zone]') ?? null;
  }

  private up(e: PointerEvent): void {
    const p = this.press;
    this.press = null;
    if (!p || !this.ghost) return;
    const target = this.dropTarget(e.clientX, e.clientY);
    this.endDrag();
    this.dragged = true; // the click that follows isn't a tap
    const req = target ? this.dropRequest(p.src, target) : null;
    if (req) {
      this.onAction?.(req);
      this.sel = null;
    }
    this.key = '';
    this.render();
  }

  /** What dropping `src` on `target` means: wear it, take it off, move it, sell, buy or drop it. */
  private dropRequest(src: Selection, target: HTMLElement): InvOp | null {
    const thing = this.thingAt(src);
    if (!src || !thing) return null;
    const bagI = target.dataset.bag !== undefined ? Number(target.dataset.bag) : -1;
    const gear = target.dataset.gear as GearSlot | undefined;
    if (src.from === 'bag') {
      if (gear && thing.kind === 'item' && fits(thing.slot, gear)) return { op: 'equip', i: src.i, to: gear };
      if (bagI >= 0 && bagI !== src.i) return { op: 'move', i: src.i, j: bagI };
      if (target.dataset.sellZone !== undefined && this.shop && thing.kind !== 'book') return { op: 'sell', i: src.i };
      if (target.dataset.trash !== undefined) return { op: 'drop', i: src.i };
      return null;
    }
    if (src.from === 'gear') {
      if (bagI >= 0) return { op: 'unequip', slot: src.slot, to: bagI };
      if (target.dataset.sellZone !== undefined || target.dataset.trash !== undefined) return null;
      return null;
    }
    // From the merchant: drop it into the bag (or anywhere on the gear) to buy it.
    if (bagI >= 0 || gear || target.dataset.buyZone !== undefined) return { op: 'buy', i: src.i };
    return null;
  }

  private endDrag(): void {
    this.ghost?.remove();
    this.ghost = null;
    this.el.classList.remove('dragging');
    for (const t of this.el.querySelectorAll('.drop-over, .fits')) t.classList.remove('drop-over', 'fits');
  }

  // ── Taps and buttons ────────────────────────────────────────────────────────────────────────

  private click(t: HTMLElement): void {
    if (this.dragged) {
      this.dragged = false;
      return;
    }
    const btn = t.closest<HTMLElement>('[data-act]');
    if (btn) {
      const act = btn.dataset.act!;
      if (act === 'close') {
        this.close();
        this.onClose?.();
        return;
      }
      if (act === 'continue') {
        this.onContinue?.();
        return;
      }
      const s = this.sel;
      if (act === 'unequip' && s?.from === 'gear') this.onAction?.({ op: 'unequip', slot: s.slot });
      else if (s?.from === 'bag' && (act === 'equip' || act === 'use' || act === 'drop' || act === 'sell')) this.onAction?.({ op: act, i: s.i });
      else if (act === 'buy' && s?.from === 'shop') this.onAction?.({ op: 'buy', i: s.i });
      if (act !== 'buy') this.sel = null;
      this.key = '';
      this.render();
      return;
    }
    const cell = t.closest<HTMLElement>('[data-bag],[data-gear],[data-shop]');
    if (!cell) return;
    if (cell.dataset.bag !== undefined) this.sel = { from: 'bag', i: Number(cell.dataset.bag) };
    else if (cell.dataset.gear) this.sel = { from: 'gear', slot: cell.dataset.gear as GearSlot };
    else this.sel = { from: 'shop', i: Number(cell.dataset.shop) };
    this.key = '';
    this.render();
  }

  // ── Drawing ─────────────────────────────────────────────────────────────────────────────────

  private render(): void {
    const st = this.state;
    if (!st) {
      this.el.innerHTML = '<div class="bag-wait">…</div>';
      return;
    }
    const key = JSON.stringify([st.v, st.g, this.sel, this.shop?.map((s) => s.sold), this.statsLine]);
    if (key === this.key) return;
    this.key = key;
    if (this.sel && !this.thingAt(this.sel)) this.sel = null;
    const gearCell = (slot: GearSlot) => {
      const it = st.gear[slot];
      const on = this.sel?.from === 'gear' && this.sel.slot === slot;
      const d = DOLL[slot];
      return `<button type="button" class="doll-slot ${d.size}${it ? ' full' : ''}${on ? ' on' : ''}" data-gear="${slot}" style="grid-area:${d.area};${it ? `--rc:${colorOf(it)}` : ''}" title="${esc(it ? it.name : SLOT_INFO[slot].label)}">
        <span class="ds-icon">${it ? iconOf(it) : SLOT_INFO[slot].icon}</span>${it ? '' : `<span class="ds-label">${SLOT_INFO[slot].label}</span>`}</button>`;
    };
    const bag = st.bag
      .map((e, i) => {
        const on = this.sel?.from === 'bag' && this.sel.i === i;
        return `<button type="button" class="bag-cell${e ? '' : ' empty'}${on ? ' on' : ''}" data-bag="${i}" style="${e ? `--rc:${colorOf(e)}` : ''}" title="${e ? esc(nameOf(e)) : ''}">${e ? iconOf(e) : ''}</button>`;
      })
      .join('');
    const shopHtml = this.shop
      ? `<section class="shop" data-sell-zone><h3>🛒 The merchant <small>drag here to sell</small></h3><div class="shop-list">${this.shop
          .map((s, i) => {
            const on = this.sel?.from === 'shop' && this.sel.i === i;
            const poor = st.g < s.price;
            return `<button type="button" class="shop-row${s.sold ? ' sold' : ''}${on ? ' on' : ''}${poor && !s.sold ? ' poor' : ''}" data-shop="${i}" style="--rc:${colorOf(s.what)}" ${s.sold ? 'disabled' : ''}>
              <span class="sr-icon">${iconOf(s.what)}</span><span class="sr-name">${esc(nameOf(s.what))}</span><span class="sr-price">${s.sold ? 'sold' : `🪙 ${s.price}`}</span></button>`;
          })
          .join('')}</div>
          ${this.role === 'hero' ? '<button type="button" class="shop-go" data-act="continue">Onward to the next level →</button>' : '<p class="shop-wait">The elf moves on when ready.</p>'}</section>`
      : '';
    this.el.innerHTML = `
      <header class="bag-head"><h2>🎒 ${this.shop ? 'Trade' : 'Bag'}</h2><span class="bag-gold">🪙 ${st.g}</span>${this.shop ? '' : '<button type="button" class="bag-close" data-act="close">✕</button>'}</header>
      <div class="bag-body">
        <section class="doll" data-buy-zone>
          <div class="doll-figure" aria-hidden="true">🧝</div>
          <div class="doll-grid">
            ${HERO_SLOTS.map(gearCell).join('')}
          </div>
          <div class="doll-fam"><span class="df-label">Familiar</span>${gearCell('collar')}${gearCell('charm')}</div>
          ${this.statsLine ? `<p class="bag-stats">${this.statsLine}</p>` : ''}
        </section>
        <section class="bag-side">
          <div class="bag-grid" data-buy-zone>${bag}</div>
          <div class="bag-trash" data-trash>🗑 drag here to drop</div>
        </section>
        ${shopHtml}
      </div>
      <div class="bag-detail">${this.detailHtml()}</div>`;
  }

  private detailHtml(): string {
    const e = this.thingAt(this.sel);
    const s = this.sel;
    if (!e || !s) return `<p class="hint">${this.role === 'hero' ? 'Click' : 'Tap'} anything to look at it, or drag it where it goes.${this.role === 'hero' ? ' <kbd>Q</kbd> / <kbd>E</kbd> drink a health / mana potion.' : ''}</p>`;
    const buttons: string[] = [];
    let lines: string[] = [];
    let sub = '';
    if (e.kind === 'item') {
      sub = `${RARITY_INFO[e.rarity].label} ${SLOT_INFO[e.slot].label.toLowerCase()}${SLOT_INFO[e.slot].familiar ? ' · for the familiar' : ''}`;
      lines = statLines(e.stats);
      // Compared with what's worn in that slot now.
      const worn = e.slot === 'ring' ? (this.state!.gear.ring && this.state!.gear.ring2 ? this.state!.gear.ring : null) : this.state!.gear[e.slot];
      if (s.from !== 'gear' && worn) lines.push(...compare(e, worn));
      if (s.from === 'bag') buttons.push('<button type="button" data-act="equip">Equip</button>');
      if (s.from === 'gear') buttons.push('<button type="button" data-act="unequip">Take off</button>');
    } else if (e.kind === 'potion') {
      const p = POTIONS[e.potion];
      sub = 'Potion';
      lines = [e.potion === 'health' ? `Restores ${p.amount} health` : `Restores ${p.amount} mana`];
      if (s.from === 'bag') buttons.push('<button type="button" data-act="use">Drink</button>');
    } else {
      sub = 'Teaches a new spell, or ranks one up';
    }
    if (s.from === 'shop') {
      const entry = this.shop![s.i];
      buttons.push(`<button type="button" data-act="buy" ${this.state!.g < entry.price ? 'disabled' : ''}>Buy · 🪙 ${entry.price}</button>`);
    }
    if (s.from === 'bag') {
      if (this.shop && e.kind !== 'book') buttons.push(`<button type="button" data-act="sell">Sell · 🪙 ${sellPrice(e)}</button>`);
      buttons.push('<button type="button" class="ghost" data-act="drop">Drop</button>');
    }
    return `<div class="bd-title" style="--rc:${colorOf(e)}"><span>${iconOf(e)}</span><b>${esc(nameOf(e))}</b></div>
      <p class="bd-sub">${sub}</p>
      <ul>${lines.map((l) => `<li class="${l.startsWith('▲') ? 'up' : l.startsWith('▼') ? 'down' : ''}">${esc(l)}</li>`).join('')}</ul>
      <div class="bd-actions">${buttons.join('')}</div>`;
  }
}

/** "▲ +3% arrow damage" / "▼ −10 max health" lines: this item against the worn one. */
function compare(a: Item, worn: Item): string[] {
  const keys = new Set([...Object.keys(a.stats), ...Object.keys(worn.stats)] as StatKey[]);
  const out: string[] = [];
  for (const k of keys) {
    const d = (a.stats[k] ?? 0) - (worn.stats[k] ?? 0);
    if (Math.abs(d) < 1e-6) continue;
    const text = STAT_INFO[k].label(Math.abs(d)).replace(/^[+−-]/, '');
    out.push(`${d > 0 ? '▲' : '▼'} ${d > 0 ? '' : 'less '}${text} than worn`);
  }
  return out;
}
