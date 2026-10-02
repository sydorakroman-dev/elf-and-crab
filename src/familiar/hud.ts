import { POWER_CODES } from '../net/snapshot';
import type { Snapshot } from '../net/snapshot';
import { normalizeCode } from '../net/protocol';
import { BossBar, Fade, Popups, cssColor, hpBarHtml, powerChipsHtml, powerChipsKey } from '../ui/shared';
import { runLabel } from '../world/rooms';
import type { PowerUpType } from '../game/powerups';
import { FAMILIARS, FAMILIAR_KINDS, SPELLS, SPELL_IDS, type FamiliarKind, type SpellId } from '../game/familiars';

export type Blocking = 'start' | 'pick' | 'no-room' | 'room-full' | 'hero-left' | null;

const BASE = import.meta.env.BASE_URL;

/** 1–3 pips for how fast a creature moves. */
function speedPips(speed: number): string {
  const n = speed >= 10 ? 3 : speed >= 7.5 ? 2 : 1;
  return '●'.repeat(n) + '<span class="off">' + '●'.repeat(3 - n) + '</span>';
}

/**
 * The familiar's tablet HUD: the hero's hearts / wave / score / power-ups, a status pill, the
 * creature picker, one big button per spell with a cooldown ring, and full-screen cards for start
 * and errors.
 */
export class FamiliarHud {
  readonly popups: Popups;
  readonly bossBar: BossBar;
  readonly fade: Fade;
  onStart?: () => void;
  onChoose?: (kind: FamiliarKind) => void;
  onSpell?: (id: SpellId) => void;
  private readonly hearts: HTMLElement;
  private readonly powers: HTMLElement;
  private readonly wave: HTMLElement;
  private readonly score: HTMLElement;
  private readonly status: HTMLElement;
  private readonly spellBar: HTMLElement;
  private readonly changeBtn: HTMLButtonElement;
  private readonly overlay: HTMLElement;
  private readonly card: HTMLElement;
  private readonly picker: HTMLElement;
  private readonly title: HTMLElement;
  private readonly message: HTMLElement;
  private readonly action: HTMLButtonElement;
  private readonly retry: HTMLFormElement;
  private readonly pickerClose: HTMLButtonElement;
  private powersKey = '';
  private blocking: Blocking = 'start';
  private kind: FamiliarKind | null = null;
  private canChange = true;

  constructor(root: HTMLElement, code: string) {
    const cards = FAMILIAR_KINDS.map((k) => {
      const f = FAMILIARS[k];
      const spells = f.spells
        .map((id) => `<li><span class="sp-icon">${SPELLS[id].icon}</span><b>${SPELLS[id].name}</b><span>${SPELLS[id].description}</span></li>`)
        .join('');
      return `<button type="button" class="pick-card" data-kind="${k}" style="--c:${cssColor(f.color)}">
          <img src="${BASE}${f.art}" alt="${f.name}" loading="eager" draggable="false" />
          <div class="pick-info">
            <div class="pick-name">${f.name}</div>
            <div class="pick-blurb">${f.blurb}</div>
            <div class="pick-speed">Speed <span class="pips">${speedPips(f.speed)}</span></div>
            <ul class="pick-spells">${spells}</ul>
          </div>
        </button>`;
    }).join('');

    root.insertAdjacentHTML(
      'beforeend',
      `<div class="hud fam-hud">
         <div class="left"><div class="hearts" data-f-hearts></div><div class="powers" data-f-powers></div></div>
         <div class="wave" data-f-wave></div>
         <div class="right">
           <button type="button" class="role-badge" data-f-change title="Change creature">🐾 ${code}</button>
           <div class="score" data-f-score>0</div>
         </div>
       </div>
       <div class="fam-status" data-f-status hidden></div>
       <div class="spell-bar" data-f-spells></div>
       <div class="overlay fam-overlay">
         <div class="card" data-f-card>
           <h1 data-f-title>You're the familiar</h1>
           <p data-f-message>Help the elf survive. <b>Touch and drag anywhere</b> to steer — your creature bites any enemy it touches, grabs power-ups for the elf, and has <b>spells</b> to cast.</p>
           <button type="button" data-f-action>Tap to join 🐾</button>
           <form class="join" data-f-retry hidden>
             <input maxlength="5" placeholder="ABCD" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Room code" />
             <button type="submit" class="join-btn">Join</button>
           </form>
           <p class="fam-solo"><a href="./">Play solo as the elf instead</a></p>
         </div>
         <div class="picker" data-f-picker hidden>
           <h2>Choose your familiar</h2>
           <div class="pick-cards">${cards}</div>
           <button type="button" class="picker-close" data-f-picker-close hidden>Keep current</button>
         </div>
       </div>`,
    );
    this.popups = new Popups(root);
    this.bossBar = new BossBar(root);
    this.fade = new Fade(root);
    this.hearts = root.querySelector('[data-f-hearts]')!;
    this.powers = root.querySelector('[data-f-powers]')!;
    this.wave = root.querySelector('[data-f-wave]')!;
    this.score = root.querySelector('[data-f-score]')!;
    this.status = root.querySelector('[data-f-status]')!;
    this.spellBar = root.querySelector('[data-f-spells]')!;
    this.changeBtn = root.querySelector('[data-f-change]')!;
    this.overlay = root.querySelector('.fam-overlay')!;
    this.card = root.querySelector('[data-f-card]')!;
    this.picker = root.querySelector('[data-f-picker]')!;
    this.title = root.querySelector('[data-f-title]')!;
    this.message = root.querySelector('[data-f-message]')!;
    this.action = root.querySelector('[data-f-action]')!;
    this.retry = root.querySelector('[data-f-retry]')!;
    this.pickerClose = root.querySelector('[data-f-picker-close]')!;

    this.action.addEventListener('click', () => {
      if (this.blocking === 'start') {
        this.onStart?.();
        this.setBlocking('pick');
      } else if (this.blocking === 'hero-left') {
        location.reload();
      }
    });
    root.querySelectorAll<HTMLButtonElement>('.pick-card').forEach((btn) =>
      btn.addEventListener('click', () => {
        const kind = btn.dataset.kind as FamiliarKind;
        this.setKind(kind);
        this.setBlocking(null);
        this.onChoose?.(kind);
      }),
    );
    this.pickerClose.addEventListener('click', () => this.setBlocking(null));
    this.changeBtn.addEventListener('click', () => {
      if (this.canChange && this.blocking === null) this.setBlocking('pick');
    });
    this.retry.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = this.retry.querySelector('input')!;
      const c = normalizeCode(input.value);
      if (c) location.search = `?join=${c}`;
      else input.classList.add('bad');
    });
  }

  get isBlocked(): boolean {
    return this.blocking !== null;
  }

  get chosen(): FamiliarKind | null {
    return this.kind;
  }

  setBlocking(b: Blocking, code = ''): void {
    // An error (bad code, full room, hero gone) replaces whatever card is showing.
    this.blocking = b;
    this.overlay.hidden = b === null;
    this.picker.hidden = b !== 'pick';
    this.card.hidden = b === 'pick';
    this.pickerClose.hidden = this.kind === null;
    this.picker.querySelectorAll<HTMLElement>('.pick-card').forEach((c) => c.classList.toggle('current', c.dataset.kind === this.kind));
    this.retry.hidden = !(b === 'no-room' || b === 'room-full');
    this.action.hidden = b === 'no-room' || b === 'room-full';
    if (b === 'no-room') {
      this.title.textContent = 'Room not found';
      this.message.innerHTML = `There's no game with code <b>${code}</b>. Ask the elf player for the code on their screen.`;
    } else if (b === 'room-full') {
      this.title.textContent = 'Already has a familiar';
      this.message.innerHTML = `Game <b>${code}</b> already has a familiar. Only one per game.`;
    } else if (b === 'hero-left') {
      this.title.textContent = 'The elf left';
      this.message.innerHTML = 'The game has ended. Ask them for a new code to play again.';
      this.action.textContent = 'Try again';
    }
  }

  /** Builds the spell buttons and badge for the chosen creature. */
  setKind(kind: FamiliarKind): void {
    this.kind = kind;
    const f = FAMILIARS[kind];
    this.changeBtn.innerHTML = `${f.emoji} ${f.name} <span class="chg">▾</span>`;
    this.spellBar.innerHTML = f.spells
      .map(
        (id) => `<button type="button" class="spell-btn ready" data-spell="${id}" style="--c:${cssColor(f.color)};--p:1" aria-label="${SPELLS[id].name}">
          <span class="spell-icon">${SPELLS[id].icon}</span><span class="spell-label">${SPELLS[id].name}</span>
        </button>`,
      )
      .join('');
    this.spellBar.querySelectorAll<HTMLButtonElement>('.spell-btn').forEach((b) =>
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (!this.isBlocked) this.onSpell?.(b.dataset.spell as SpellId);
      }),
    );
  }

  /** Small non-blocking status pill (connecting, waiting, paused…); null hides it. */
  setStatus(text: string | null): void {
    this.status.hidden = text === null;
    if (text !== null && this.status.textContent !== text) this.status.textContent = text;
  }

  update(s: Snapshot): void {
    this.hearts.innerHTML = hpBarHtml(s.health, s.maxHealth);
    const list = s.powers.map(([code, remaining]) => ({ type: POWER_CODES[code] as PowerUpType, remaining }));
    const key = powerChipsKey(list);
    if (key !== this.powersKey) {
      this.powersKey = key;
      this.powers.innerHTML = powerChipsHtml(list);
    }
    const w = s.phase === 'ready' ? 'Waiting for the elf to start…' : runLabel(s.room, s.rw, s.remaining, s.phase, s.boss?.name ?? null);
    if (this.wave.textContent !== w) this.wave.textContent = w;
    this.score.textContent = String(s.score);
    this.bossBar.set(s.boss);
    this.fade.set(s.phase === 'transition', s.card ?? -1);

    // Creature can be changed between runs or while paused (or before it's placed at all).
    this.canChange = s.state !== 'playing' || !s.fam;
    this.changeBtn.classList.toggle('locked', !this.canChange);

    for (const [code, secs] of s.cds) {
      const id = SPELL_IDS[code];
      const btn = this.spellBar.querySelector<HTMLElement>(`[data-spell="${id}"]`);
      if (!btn || !id) continue;
      const ready = secs <= 0.05;
      btn.classList.toggle('ready', ready);
      btn.style.setProperty('--p', String(1 - Math.min(1, secs / SPELLS[id].cooldown)));
      const label = btn.querySelector('.spell-label')!;
      const text = ready ? SPELLS[id].name : String(Math.ceil(secs));
      if (label.textContent !== text) label.textContent = text;
    }
  }
}
