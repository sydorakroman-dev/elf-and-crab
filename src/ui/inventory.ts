import { FAM_SLOTS, HERO_SLOTS, POTIONS, RARITY_INFO, SLOT_INFO, STAT_INFO, sellPrice, statLines, type BagEntry, type GearSlot, type Item, type StatKey } from '../game/items';
import type { InvOp, InvState, StockEntry } from '../game/inventory';

type Selection = { from: 'bag'; i: number } | { from: 'gear'; slot: GearSlot } | { from: 'shop'; i: number } | null;

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function iconOf(e: BagEntry | { kind: 'book' }): string {
  if (e.kind === 'book') return '📖';
  if (e.kind === 'potion') return POTIONS[e.potion].icon;
  return SLOT_INFO[e.slot].icon;
}

function nameOf(e: BagEntry | { kind: 'book' }): string {
  if (e.kind === 'book') return 'Spell Book';
  if (e.kind === 'potion') return POTIONS[e.potion].name;
  return e.name;
}

function colorOf(e: BagEntry | { kind: 'book' }): string {
  if (e.kind === 'item') return RARITY_INFO[e.rarity].color;
  if (e.kind === 'potion') return `#${POTIONS[e.potion].color.toString(16).padStart(6, '0')}`;
  return '#c79bff';
}

/**
 * The bag: the elf's five gear slots and the familiar's two, the 16-slot bag shared by both, the
 * gold — and, between levels, the merchant's wares. Tap or click anything to see it, then equip,
 * drink, sell or drop it. Used on the hero's screen and on the familiar's tablet alike; actions go
 * out through `onAction` (the hero's game checks and applies them).
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

  constructor(root: HTMLElement, role: 'hero' | 'familiar') {
    this.role = role;
    root.insertAdjacentHTML('beforeend', `<div class="bag-panel ${role}" hidden></div>`);
    this.el = root.querySelector<HTMLElement>(`.bag-panel.${role}`)!;
    // Taps and clicks inside the panel stay in the panel (they mustn't shoot, steer or unpause).
    for (const type of ['pointerdown', 'pointerup', 'click', 'touchstart', 'touchend', 'mousedown'] as const)
      this.el.addEventListener(type, (e) => e.stopPropagation(), { passive: type.startsWith('touch') });
    this.el.addEventListener('click', (e) => this.click(e.target as HTMLElement));
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
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
    this.el.hidden = true;
    this.sel = null;
  }

  /** New inventory / shop to show (redraws only when something changed). */
  update(state: InvState | null, shop: StockEntry[] | null, statsLine = ''): void {
    this.state = state;
    this.shop = shop;
    this.statsLine = statsLine;
    if (!this.el.hidden) this.render();
  }

  private click(t: HTMLElement): void {
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

  private selected(): BagEntry | { kind: 'book' } | null {
    const s = this.sel;
    const st = this.state;
    if (!s || !st) return null;
    if (s.from === 'bag') return st.bag[s.i] ?? null;
    if (s.from === 'gear') return st.gear[s.slot];
    const e = this.shop?.[s.i];
    return e && !e.sold ? e.what : null;
  }

  private render(): void {
    const st = this.state;
    if (!st) {
      this.el.innerHTML = '<div class="bag-wait">…</div>';
      return;
    }
    const key = JSON.stringify([st.v, st.g, this.sel, this.shop?.map((s) => s.sold), this.statsLine]);
    if (key === this.key) return;
    this.key = key;
    if (this.sel && !this.selected()) this.sel = null;
    const gearCell = (slot: GearSlot) => {
      const it = st.gear[slot];
      const on = this.sel?.from === 'gear' && this.sel.slot === slot;
      return `<button type="button" class="gear-cell${it ? '' : ' empty'}${on ? ' on' : ''}" data-gear="${slot}" style="${it ? `--rc:${colorOf(it)}` : ''}">
        <span class="gc-icon">${SLOT_INFO[slot].icon}</span><span class="gc-text"><b>${SLOT_INFO[slot].label}</b><i>${it ? esc(it.name) : 'empty'}</i></span></button>`;
    };
    const bag = st.bag
      .map((e, i) => {
        const on = this.sel?.from === 'bag' && this.sel.i === i;
        return `<button type="button" class="bag-cell${e ? '' : ' empty'}${on ? ' on' : ''}" data-bag="${i}" style="${e ? `--rc:${colorOf(e)}` : ''}">${e ? iconOf(e) : ''}</button>`;
      })
      .join('');
    const shopHtml = this.shop
      ? `<section class="shop"><h3>🛒 The merchant</h3><div class="shop-list">${this.shop
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
        <section class="gear">
          <h3>Elf</h3>${HERO_SLOTS.map(gearCell).join('')}
          <h3>Familiar</h3>${FAM_SLOTS.map(gearCell).join('')}
          ${this.statsLine ? `<p class="bag-stats">${this.statsLine}</p>` : ''}
        </section>
        <section class="bag-grid">${bag}</section>
        ${shopHtml}
      </div>
      <div class="bag-detail">${this.detailHtml()}</div>`;
  }

  private detailHtml(): string {
    const e = this.selected();
    const s = this.sel;
    if (!e || !s) return `<p class="hint">${this.role === 'hero' ? 'Click' : 'Tap'} anything to look at it.${this.role === 'hero' ? ' <kbd>Q</kbd> / <kbd>E</kbd> drink a health / mana potion.' : ''}</p>`;
    const buttons: string[] = [];
    let lines: string[] = [];
    let sub = '';
    if (e.kind === 'item') {
      sub = `${RARITY_INFO[e.rarity].label} ${SLOT_INFO[e.slot].label.toLowerCase()}${SLOT_INFO[e.slot].familiar ? ' · for the familiar' : ''}`;
      lines = statLines(e.stats);
      // Compared with what's worn in that slot now.
      const worn = this.state!.gear[e.slot];
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
