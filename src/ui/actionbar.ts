import { ABILITIES, DEFAULT_KEYS, DEFAULT_SLOTS, RESOURCES, bindKey, keyLabel, loadKeys, saveKeys, type AbilityId, type Resources } from '../game/abilities';

/** What a slot shows: an ability (skills) or a learned spell. */
export interface SlotDef {
  icon: string;
  name: string;
  description: string;
  kind: 'skill' | 'spell';
  /** Stamina charges (skills) or mana (spells). */
  cost: number;
  /** Spell rank (I–III), shown as pips. */
  rank?: number;
}

const abilitySlot = (id: AbilityId): SlotDef => ({ ...ABILITIES[id], description: ABILITIES[id].description });
const EMPTY_TITLE = 'Empty: read a spell book to learn a spell';

/**
 * The elf's resources and abilities on screen: a mana bar and stamina pips (under the health
 * bar), the nine-slot action bar along the bottom (tap a slot on touch screens), and the
 * key-binding panel opened from the title / pause screen.
 */
export class ActionBar {
  /** Current key for each slot (KeyboardEvent.code). */
  readonly keys: string[] = loadKeys();
  /** True while the panel waits for a key to bind. */
  rebinding = false;
  onUse?: (slot: number) => void;
  private readonly bar: HTMLElement;
  private readonly slots: HTMLElement[];
  private readonly manaFill: HTMLElement;
  private readonly manaText: HTMLElement;
  private readonly pips: HTMLElement;
  private readonly panel: HTMLElement;
  private lastKey = '';
  /** What's in each of the nine slots. */
  private readonly defs: (SlotDef | null)[] = DEFAULT_SLOTS.map((id) => (id ? abilitySlot(id) : null));

  constructor(hudLeft: HTMLElement, root: HTMLElement, touch: boolean) {
    hudLeft.insertAdjacentHTML(
      'beforeend',
      `<div class="res">
         <div class="mana"><span class="mana-icon">✦</span><div class="mana-track"><div class="mana-fill"></div></div><b class="mana-text"></b></div>
         <div class="stamina" title="Stamina"></div>
       </div>`,
    );
    this.manaFill = hudLeft.querySelector('.mana-fill')!;
    this.manaText = hudLeft.querySelector('.mana-text')!;
    this.pips = hudLeft.querySelector('.stamina')!;

    const slotHtml = this.defs.map((_, i) => `<button type="button" class="slot" data-slot="${i}"></button>`).join('');
    root.insertAdjacentHTML('beforeend', `<div class="action-bar${touch ? ' touch-bar' : ''}" hidden>${slotHtml}</div>`);
    this.bar = root.querySelector('.action-bar')!;
    this.slots = [...this.bar.querySelectorAll<HTMLElement>('.slot')];
    this.defs.forEach((_, i) => this.renderSlot(i));
    this.bar.addEventListener('pointerdown', (e) => {
      const slot = (e.target as HTMLElement).closest<HTMLElement>('[data-slot]');
      if (!slot) return;
      e.preventDefault();
      e.stopPropagation();
      this.onUse?.(Number(slot.dataset.slot));
    });

    root.insertAdjacentHTML(
      'beforeend',
      `<div class="keys-panel" data-keys-panel hidden>
         <div class="keys-head"><h2>⚙️ Keys</h2><button type="button" data-keys-close>✕</button></div>
         <p class="keys-note">Click a slot, then press the key you want. Space always dashes; WASD, Esc, M, Enter, I / B (bag) and Q / E (potions) are taken.</p>
         <div class="keys-list"></div>
         <button type="button" class="keys-reset" data-keys-reset>Reset to 1–9</button>
       </div>`,
    );
    this.panel = root.querySelector('[data-keys-panel]')!;
    this.panel.addEventListener('click', (e) => {
      e.stopPropagation(); // don't start the game from behind the panel
      const t = e.target as HTMLElement;
      if (t.closest('[data-keys-close]')) this.closePanel();
      if (t.closest('[data-keys-reset]')) {
        this.keys.splice(0, 9, ...DEFAULT_KEYS);
        saveKeys(this.keys);
        this.renderPanel();
      }
      const row = t.closest<HTMLElement>('[data-bind]');
      if (row) this.waitForKey(Number(row.dataset.bind));
    });
    this.renderKeys();
  }

  setVisible(v: boolean): void {
    this.bar.hidden = !v;
  }

  openPanel(): void {
    this.renderPanel();
    this.panel.hidden = false;
  }

  closePanel(): void {
    this.panel.hidden = true;
    this.rebinding = false;
  }

  get panelOpen(): boolean {
    return !this.panel.hidden;
  }

  /** Mana, stamina, and which slots are affordable. */
  update(r: Resources): void {
    const mana = Math.floor(r.mana);
    const pct = (r.mana / RESOURCES.maxMana) * 100;
    this.manaFill.style.width = `${pct}%`;
    if (this.manaText.textContent !== String(mana)) this.manaText.textContent = String(mana);
    const key = `${r.stamina}:${Math.floor(r.staminaProgress * 8)}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.pips.innerHTML = Array.from({ length: RESOURCES.maxStamina }, (_, i) => {
        const full = i < r.stamina;
        const filling = i === r.stamina ? ` style="--p:${r.staminaProgress}"` : '';
        return `<span class="pip${full ? ' full' : ''}${filling ? ' filling' : ''}"${filling}></span>`;
      }).join('');
    }
    this.defs.forEach((d, i) => {
      const poor = !!d && (d.kind === 'skill' ? r.stamina < d.cost : r.mana < d.cost);
      if (this.slots[i].classList.contains('poor') !== poor) this.slots[i].classList.toggle('poor', poor);
    });
  }

  /** Puts a learned spell (or nothing) in slot `i`. */
  setSlot(i: number, def: SlotDef | null): void {
    if (i < 0 || i >= this.defs.length) return;
    this.defs[i] = def;
    this.renderSlot(i);
    if (!def) this.slots[i].classList.remove('poor');
    if (!this.panel.hidden) this.renderPanel();
  }

  /** A quick glow on slot `i` (just learned / ranked up). */
  flash(i: number): void {
    const s = this.slots[i];
    if (!s) return;
    s.classList.remove('learned');
    void s.offsetWidth;
    s.classList.add('learned');
  }

  private renderSlot(i: number): void {
    const d = this.defs[i];
    const s = this.slots[i];
    const cost = d ? `<span class="slot-cost ${d.kind}">${d.kind === 'skill' ? '⚡'.repeat(d.cost) : d.cost}</span>` : '';
    const rank = d?.rank ? `<span class="slot-rank">${'•'.repeat(d.rank)}</span>` : '';
    s.className = `slot${d ? '' : ' empty'}`;
    s.title = d ? `${d.name} — ${d.description}` : EMPTY_TITLE;
    s.innerHTML = `<span class="slot-key">${keyLabel(this.keys[i])}</span><span class="slot-icon">${d?.icon ?? ''}</span>${cost}${rank}`;
  }

  /** A little counter on an ability's slot (charges left; 0 hides it). */
  setCharges(id: AbilityId, n: number): void {
    this.setSlotCharges(DEFAULT_SLOTS.indexOf(id), n);
  }

  /** A little counter on slot `i` (charges left; 0 hides it). */
  setSlotCharges(i: number, n: number): void {
    if (i < 0) return;
    const slot = this.slots[i];
    let badge = slot.querySelector<HTMLElement>('.slot-charges');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'slot-charges';
      slot.append(badge);
    }
    badge.textContent = n > 0 ? `×${n}` : '';
    slot.classList.toggle('charged', n > 0);
  }

  /** The ability in slot `i`, if any. */
  ability(i: number): AbilityId | null {
    return DEFAULT_SLOTS[i] ?? null;
  }

  /** Slot bound to this key, or -1. */
  slotFor(code: string): number {
    return this.keys.indexOf(code);
  }

  private renderKeys(): void {
    this.slots.forEach((s, i) => (s.querySelector('.slot-key')!.textContent = keyLabel(this.keys[i])));
  }

  private renderPanel(): void {
    this.panel.querySelector('.keys-list')!.innerHTML = this.defs.map((d, i) => {
      const name = d ? `${d.icon} ${d.name}` : '<span class="keys-empty">empty (spells)</span>';
      return `<button type="button" class="keys-row" data-bind="${i}"><span>Slot ${i + 1} · ${name}</span><kbd>${keyLabel(this.keys[i])}</kbd></button>`;
    }).join('');
    this.renderKeys();
  }

  private waitForKey(slot: number): void {
    this.rebinding = true;
    const row = this.panel.querySelector<HTMLElement>(`[data-bind="${slot}"] kbd`)!;
    row.textContent = 'press a key…';
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      removeEventListener('keydown', onKey, true);
      this.rebinding = false;
      if (e.code !== 'Escape') {
        if (bindKey(this.keys, slot, e.code)) saveKeys(this.keys);
      }
      this.renderPanel();
    };
    addEventListener('keydown', onKey, true);
  }
}
