import { POWER_CODES } from '../net/snapshot';
import type { Snapshot } from '../net/snapshot';
import { normalizeCode } from '../net/protocol';
import { fullscreenSupported, isAppleTouch, isFullscreen, isStandalone, onFullscreenChange, toggleFullscreen } from '../ui/fullscreen';
import { BossBar, Fade, Popups, cssColor, hpBarHtml, powerChipsHtml, powerChipsKey } from '../ui/shared';
import { ROOMS, runLabel } from '../world/rooms';
import { enemyName, type EnemyKind } from '../game/enemies';
import type { PowerUpType } from '../game/powerups';
import { FAMILIARS, FAMILIAR_KINDS, SPELLS, SPELL_IDS, type FamiliarKind, type SpellId } from '../game/familiars';

export type Blocking = 'start' | 'pick' | 'no-room' | 'room-full' | 'hero-left' | null;

const BASE = import.meta.env.BASE_URL;

/** Four corner brackets (drawn, so it looks the same on every device); they point inward while full screen. */
const FS_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
  <g class="fs-open"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></g>
  <g class="fs-close"><path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/></g></svg>`;

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
  /** Rune Seal: an answer was picked; practice room: start a seal to try. */
  onAnswer?: (value: number) => void;
  onRiddle?: () => void;
  private readonly seal: HTMLElement;
  private readonly riddleTry: HTMLButtonElement;
  private sealKey = '';
  /** Practice room: show this monster. */
  onParade?: (kind: EnemyKind) => void;
  private readonly paradeBtn: HTMLButtonElement;
  private readonly paradePanel: HTMLElement;
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
           <button type="button" class="role-badge parade-btn" data-f-riddle-try hidden title="Try a rune seal">🔮</button>
           <button type="button" class="role-badge parade-btn" data-f-parade hidden>👾 Monsters</button>
           <button type="button" class="role-badge" data-f-change title="Change creature">🐾 ${code}</button>
           <button type="button" class="role-badge fs-btn" data-f-fullscreen title="Full screen" aria-label="Full screen" hidden>${FS_ICON}</button>
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
    // Rune Seal: a carved stone tablet with the riddle and four rune stones to choose from.
    root.insertAdjacentHTML(
      'beforeend',
      `<div class="seal" data-seal hidden>
         <div class="seal-stone">
           <div class="seal-title">✦ Rune Seal ✦</div>
           <div class="seal-sub">The door is bound by old magic. Solve the runes to break it.</div>
           <div class="seal-gems" data-seal-gems></div>
           <div class="seal-riddle" data-seal-riddle></div>
           <div class="seal-choices" data-seal-choices></div>
           <div class="seal-msg" data-seal-msg></div>
         </div>
       </div>`,
    );
    this.seal = root.querySelector('[data-seal]')!;
    this.seal.querySelector('[data-seal-choices]')!.addEventListener('pointerdown', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-answer]');
      if (!b || b.classList.contains('used')) return;
      e.preventDefault();
      e.stopPropagation();
      this.pendingAnswer = b;
      this.onAnswer?.(Number(b.dataset.answer));
    });
    this.riddleTry = root.querySelector('[data-f-riddle-try]')!;
    this.riddleTry.addEventListener('click', () => this.onRiddle?.());

    // Practice room: a picker of every monster, by room; the chosen one appears and strolls about.
    this.paradeBtn = root.querySelector('[data-f-parade]')!;
    const groups = ROOMS.map((room) => {
      const kinds = [...new Set(room.waves.flatMap((w) => [...(Object.keys(w.mix) as EnemyKind[]), ...(w.boss ? [w.boss] : [])]))];
      const buttons = kinds.map((k) => `<button type="button" data-kind="${k}">${enemyName(k)}</button>`).join('');
      return `<section><h3>${room.name}</h3><div class="parade-list">${buttons}</div></section>`;
    }).join('');
    root.insertAdjacentHTML('beforeend', `<div class="parade-panel" hidden><div class="parade-head"><h2>👾 Fight a monster</h2><button type="button" data-parade-close>✕</button></div>${groups}</div>`);
    this.paradePanel = root.querySelector('.parade-panel')!;
    this.paradeBtn.addEventListener('click', () => (this.paradePanel.hidden = !this.paradePanel.hidden));
    this.paradePanel.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-parade-close]')) this.paradePanel.hidden = true;
      const kind = t.closest<HTMLElement>('[data-kind]')?.dataset.kind as EnemyKind | undefined;
      if (!kind) return;
      this.onParade?.(kind);
      this.paradePanel.hidden = true;
    });

    // Full screen: a toggle in the top bar (hidden where the browser can't, e.g. iPhone Safari).
    const fsBtn = root.querySelector<HTMLButtonElement>('[data-f-fullscreen]')!;
    if (fullscreenSupported()) {
      fsBtn.hidden = false;
      const show = (on: boolean) => {
        fsBtn.classList.toggle('on', on);
        fsBtn.title = fsBtn.ariaLabel = on ? 'Exit full screen' : 'Full screen';
      };
      fsBtn.addEventListener('click', () => void toggleFullscreen());
      onFullscreenChange(show);
      show(isFullscreen());
    } else if (isAppleTouch() && !isStandalone()) {
      // iPad / iPhone: the browser's full screen folds away when you drag down (an iOS gesture);
      // the button explains how to get real full screen — the game from the Home Screen.
      fsBtn.hidden = false;
      root.insertAdjacentHTML(
        'beforeend',
        `<div class="fs-tip" data-fs-tip hidden>
           <h3>Play full screen on iPad</h3>
           <p>Add the game to your Home Screen and open it from there — it runs full screen, with no browser bars and nothing to fold away.</p>
           <ol><li>Tap the <b>Share</b> button <span class="fs-share">⬆︎</span> (Chrome: top right; Safari: top bar)</li><li>Choose <b>Add to Home Screen</b></li><li>Open <b>Elf &amp; Crab</b> from your Home Screen and join with the same code</li></ol>
           <button type="button" data-fs-tip-close>Got it</button>
         </div>`,
      );
      const tip = root.querySelector<HTMLElement>('[data-fs-tip]')!;
      fsBtn.addEventListener('click', () => (tip.hidden = !tip.hidden));
      tip.querySelector('[data-fs-tip-close]')!.addEventListener('click', () => (tip.hidden = true));
    }

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

  private pendingAnswer: HTMLElement | null = null;

  /** Shows (or hides) the Rune Seal; redraws only when the riddle changes. */
  private showSeal(r: Snapshot['rid']): void {
    this.seal.hidden = !r;
    if (!r) {
      this.sealKey = '';
      return;
    }
    const key = `${r.a}${r.op}${r.b}:${r.n}`;
    if (key === this.sealKey) return;
    const fresh = !this.sealKey;
    this.sealKey = key;
    this.seal.querySelector('[data-seal-gems]')!.innerHTML = Array.from({ length: r.t }, (_, i) => `<span class="gem${i < r.n ? ' lit' : ''}"></span>`).join('');
    this.seal.querySelector('[data-seal-riddle]')!.innerHTML = `<span>${r.a}</span><span class="op">${r.op}</span><span>${r.b}</span><span class="op">=</span><span class="q">?</span>`;
    this.seal.querySelector('[data-seal-choices]')!.innerHTML = r.c.map((v) => `<button type="button" class="rune" data-answer="${v}">${v}</button>`).join('');
    this.seal.querySelector('[data-seal-msg]')!.textContent = fresh ? 'Tap the rune stone with the answer.' : 'The runes glow brighter…';
    this.seal.classList.remove('wrong');
  }

  /** The hero judged an answer: shake on a wrong one, celebrate the last right one. */
  riddleResult(ok: boolean, done: boolean): void {
    const msg = this.seal.querySelector('[data-seal-msg]')!;
    if (ok) {
      if (done) msg.textContent = 'The seal breaks!';
      return;
    }
    this.pendingAnswer?.classList.add('used');
    msg.textContent = 'The runes resist… try another stone.';
    this.seal.classList.remove('wrong');
    void this.seal.offsetWidth; // restart the shake
    this.seal.classList.add('wrong');
  }

  update(s: Snapshot): void {
    this.hearts.innerHTML = hpBarHtml(s.health, s.maxHealth);
    const list = s.powers.map(([code, remaining]) => ({ type: POWER_CODES[code] as PowerUpType, remaining }));
    const key = powerChipsKey(list);
    if (key !== this.powersKey) {
      this.powersKey = key;
      this.powers.innerHTML = powerChipsHtml(list);
    }
    const w = s.rid && !s.practice ? `🔮 Break the rune seal to open the door (${s.rid.n}/${s.rid.t})` : s.practice ? '🧪 Practice room' : s.phase === 'ready' ? 'Waiting for the elf to start…' : runLabel(s.room, s.rw, s.remaining, s.phase, s.boss?.name ?? null);
    if (this.wave.textContent !== w) this.wave.textContent = w;
    this.score.textContent = String(s.score);
    this.bossBar.set(s.boss);
    this.fade.set(s.phase === 'transition', s.card ?? -1);

    // Creature can be changed between runs or while paused (or before it's placed at all).
    this.canChange = s.state !== 'playing' || !s.fam || !!s.practice; // any time in the practice room
    if (this.paradeBtn.hidden === !!s.practice) this.paradeBtn.hidden = !s.practice;
    if (this.riddleTry.hidden === !!s.practice) this.riddleTry.hidden = !s.practice;
    this.showSeal(s.rid);
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
