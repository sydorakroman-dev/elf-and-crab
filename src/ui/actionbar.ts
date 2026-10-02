import { ABILITIES, DEFAULT_KEYS, DEFAULT_SLOTS, RESOURCES, bindKey, keyLabel, loadKeys, saveKeys, type AbilityId, type Resources } from '../game/abilities';

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

    const slotHtml = DEFAULT_SLOTS.map((id, i) => {
      const a = id ? ABILITIES[id] : null;
      const cost = a ? `<span class="slot-cost ${a.kind}">${a.kind === 'skill' ? '⚡'.repeat(a.cost) : a.cost}</span>` : '';
      return `<button type="button" class="slot${a ? '' : ' empty'}" data-slot="${i}" title="${a ? `${a.name} — ${a.description}` : 'Empty: spells from the magic book go here'}">
          <span class="slot-key"></span><span class="slot-icon">${a ? a.icon : ''}</span>${cost}
        </button>`;
    }).join('');
    root.insertAdjacentHTML('beforeend', `<div class="action-bar${touch ? ' touch' : ''}" hidden>${slotHtml}</div>`);
    this.bar = root.querySelector('.action-bar')!;
    this.slots = [...this.bar.querySelectorAll<HTMLElement>('.slot')];
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
         <p class="keys-note">Click a slot, then press the key you want. Space always dashes; WASD, Esc, M and Enter are taken.</p>
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
      DEFAULT_SLOTS.forEach((id, i) => this.slots[i].classList.toggle('poor', !!id && !r.canAfford(id)));
    }
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
    this.panel.querySelector('.keys-list')!.innerHTML = DEFAULT_SLOTS.map((id, i) => {
      const name = id ? `${ABILITIES[id].icon} ${ABILITIES[id].name}` : '<span class="keys-empty">empty (spells)</span>';
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
