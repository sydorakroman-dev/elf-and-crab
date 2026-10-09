import type { Best } from '../game/highscore';
import type { InputMode } from '../player/controls';
import type { PowerUpType } from '../game/powerups';
import { BossBar, Fade, Popups, hpBarHtml, powerChipsHtml, powerChipsKey, questTrackerHtml, xpBarHtml } from './shared';
import { normalizeCode } from '../net/protocol';
import { ActionBar } from './actionbar';
import { DIFFICULTIES, DIFFICULTY_LIST, difficulty, setDifficulty, type Difficulty } from '../game/difficulty';
import { HEROES, HERO_CLASSES, loadHero, saveHero, type HeroClass } from '../game/heroes';
import { loadProgress, type Progress } from '../game/progress';
import { ROOMS } from '../world/rooms';
import type { ConnStatus } from '../net/client';
import QRCode from 'qrcode';
import { FAMILIARS, type FamiliarKind } from '../game/familiars';

const KEYS_MOUSE =
  '<kbd>W A S D</kbd> move · <kbd>Mouse</kbd> aim · <kbd>Click</kbd> shoot (hold) · <kbd>Space</kbd> dash · <kbd>Scroll</kbd> zoom · <kbd>M</kbd> mute · <kbd>Esc</kbd> pause';
const KEYS_TOUCH = 'Left thumb: move · Right thumb: look · Hold 🏹 to shoot · 💨 to dash';

/** DOM overlay: hearts, wave and score, wave banners, hurt flash, and the title / pause / game-over screen. */
export class Hud {
  private readonly hearts: HTMLElement;
  private readonly xp: HTMLElement;
  private xpKey = '';
  private readonly quests: HTMLElement;
  private questsKey = '';
  private readonly wave: HTMLElement;
  private readonly score: HTMLElement;
  private readonly gold: HTMLElement;
  private readonly muted: HTMLElement;
  private readonly powers: HTMLElement;
  private powersKey = '';
  private readonly popups: Popups;
  readonly bossBar: BossBar;
  readonly actionBar: ActionBar;
  private startSelect!: HTMLSelectElement;
  readonly fade: Fade;
  private readonly hud: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly title: HTMLElement;
  private readonly message: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly best: HTMLElement;
  private readonly familiarBadge: HTMLElement;
  private readonly qr: HTMLCanvasElement;
  private readonly codeEl: HTMLElement;
  private readonly linkEl: HTMLElement;
  private readonly inviteStatus: HTMLElement;
  private maxHealth: number;
  private readonly startPrompt: HTMLElement;

  constructor(root: HTMLElement, maxHealth: number, mode: InputMode, onPlay: () => void, onStart: () => void) {
    this.maxHealth = maxHealth;
    root.insertAdjacentHTML(
      'beforeend',
      `<div class="hud" hidden>
         <div class="left">
           <div class="hearts" data-hearts></div>
           <div class="xp-row" data-xp></div>
           <div class="powers" data-powers></div>
         </div>
         <div class="mid"><div class="wave" data-wave></div><div class="quest-list" data-quests></div></div>
         <div class="right">
           <span class="familiar-badge" data-familiar hidden title="Familiar connected">🦀</span>
           <span class="muted" data-muted hidden>🔇</span>
           <div class="gold" data-gold title="Gold">🪙 0</div>
           <div class="score" data-score>0</div>
         </div>
       </div>
       <div class="overlay">
         <div class="card menu" data-menu>
           <header class="menu-head">
             <img class="emblem" src="${import.meta.env.BASE_URL}icons/emblem.jpg" alt="" />
             <div>
               <h1 data-title>Elf &amp; Crab</h1>
               <p class="tagline" data-message>Fight from the woodland down to the Ash King's lair — alone, or with a friend as your familiar.</p>
             </div>
           </header>

           <section class="panel play-panel">
             <div class="setup" data-setup>
               <div class="field">
                 <span class="label">Hero</span>
                 <div class="heroes" data-heroes>${HERO_CLASSES.map((h) => `<button type="button" data-hero="${h}" title="${HEROES[h].blurb}"><span class="hero-icon">${HEROES[h].icon}</span><span class="hero-name">${HEROES[h].name}</span></button>`).join('')}</div>
                 <span class="hint" data-hero-hint></span>
               </div>
               <div class="field">
                 <span class="label">Difficulty</span>
                 <div class="difficulty" data-difficulty>${DIFFICULTY_LIST.map((d) => `<button type="button" data-diff="${d}">${DIFFICULTIES[d].icon} ${DIFFICULTIES[d].label}</button>`).join('')}</div>
                 <span class="hint" data-diff-hint></span>
               </div>
               <div class="field" data-continue hidden>
                 <span class="label">Start in</span>
                 <select data-start-room aria-label="Start in room"></select>
               </div>
             </div>
             <button type="button" class="play-btn" data-play>▶ Begin the hunt</button>
             <div class="stats">
               <span class="best" data-best hidden></span>
               <span class="trophies" data-trophies hidden></span>
             </div>
           </section>

           <section class="panel coop-panel">
             <h2>🐾 Play together <span class="sub">a friend helps as your familiar on a tablet or phone</span></h2>
             <div class="coop-cols">
               <div class="invite" data-invite>
                 <canvas class="qr" data-qr width="112" height="112" hidden></canvas>
                 <div class="invite-text">
                   <span class="label">Invite — they scan or enter</span>
                   <div class="code" data-code>····</div>
                   <div class="invite-link" data-link></div>
                   <div class="invite-status" data-istatus>Connecting to the server…</div>
                 </div>
               </div>
               <form class="join" data-join>
                 <span class="label">Join someone's game</span>
                 <div class="join-row">
                   <input data-join-code maxlength="5" placeholder="ABCD" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Room code" />
                   <button type="submit" class="join-btn">Join</button>
                 </div>
                 <span class="hint">Type <b>TEST</b> to practise as a familiar</span>
               </form>
             </div>
           </section>

           <footer class="menu-foot">
             <details class="howto">
               <summary>❔ How to play</summary>
               <p class="keys">${mode === 'touch' ? KEYS_TOUCH : KEYS_MOUSE}</p>
             </details>
             <button type="button" class="keys-btn" data-keys>⚙️ Keys</button>
           </footer>
         </div>
       </div>`,
    );
    this.hearts = root.querySelector('[data-hearts]')!;
    this.xp = root.querySelector('[data-xp]')!;
    this.quests = root.querySelector('[data-quests]')!;
    this.wave = root.querySelector('[data-wave]')!;
    this.score = root.querySelector('[data-score]')!;
    this.gold = root.querySelector('[data-gold]')!;
    this.muted = root.querySelector('[data-muted]')!;
    this.powers = root.querySelector('[data-powers]')!;
    this.popups = new Popups(root);
    this.actionBar = new ActionBar(root.querySelector('.hud .left')!, root, mode === 'touch');
    this.bossBar = new BossBar(root);
    this.fade = new Fade(root);
    this.hud = root.querySelector('.hud')!;
    this.overlay = root.querySelector('.overlay')!;
    // Painted title art, once (and only if) it loads; until then the title keeps the plain dim.
    // Absolute: a relative url() in a CSS variable resolves against the stylesheet (assets/) in the build.
    const landingUrl = new URL(`${import.meta.env.BASE_URL}art/landing.jpg`, location.href).href;
    const landing = new Image();
    landing.onload = () => {
      if (this.overlay.dataset.started) return;
      this.overlay.style.setProperty('--landing-art', `url(${landingUrl})`);
      this.overlay.classList.add('landing');
    };
    landing.src = landingUrl;
    this.title = root.querySelector('[data-title]')!;
    this.message = root.querySelector('[data-message]')!;
    this.button = root.querySelector('[data-play]')!;
    this.best = root.querySelector('[data-best]')!;
    this.familiarBadge = root.querySelector('[data-familiar]')!;
    this.qr = root.querySelector('[data-qr]')!;
    this.codeEl = root.querySelector('[data-code]')!;
    this.linkEl = root.querySelector('[data-link]')!;
    this.inviteStatus = root.querySelector('[data-istatus]')!;
    this.showDifficulty();
    this.showHero();
    this.startSelect = root.querySelector('[data-start-room]')!;
    this.startSelect.addEventListener('click', (e) => e.stopPropagation());
    this.setProgress(loadProgress());
    // Its own layer (not inside the HUD bar), so it sits above the touch controls.
    root.insertAdjacentHTML(
      'beforeend',
      `<button type="button" class="start-prompt" data-start data-touch="${mode === 'touch' ? 1 : 0}" hidden>${mode === 'touch' ? '▶ Start' : 'Press <kbd>Enter</kbd> to start'}</button>`,
    );
    this.startPrompt = root.querySelector('[data-start]')!;
    // pointerdown, not click: the touch controls cancel the click a tap would make.
    this.startPrompt.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      onStart();
    });
        this.overlay.addEventListener('click', (e) => {
      const heroBtn = (e.target as HTMLElement).closest<HTMLElement>('[data-hero]');
      if (heroBtn) {
        // The hero can change between runs (not while one is paused).
        if (this.button.textContent !== 'Resume') {
          this.hero = heroBtn.dataset.hero as HeroClass;
          saveHero(this.hero);
          this.showHero();
          this.onHero?.(this.hero);
        }
        return;
      }
      const diff = (e.target as HTMLElement).closest<HTMLElement>('[data-diff]');
      if (diff) {
        // Difficulty can change between runs (not while one is paused).
        if (this.button.textContent !== 'Resume') {
          setDifficulty(diff.dataset.diff as Difficulty);
          this.showDifficulty();
        }
        return;
      }
      if ((e.target as HTMLElement).closest('[data-keys]')) {
        this.actionBar.openPanel();
        return;
      }
      // Play: the button, or (when paused) a click outside the menu. Clicks inside the panels do nothing.
      if ((e.target as HTMLElement).closest('[data-play]') || !(e.target as HTMLElement).closest('[data-menu]')) onPlay();
    });
    const joinForm = root.querySelector<HTMLFormElement>('[data-join]')!;
    const joinInput = root.querySelector<HTMLInputElement>('[data-join-code]')!;
    joinForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const code = normalizeCode(joinInput.value);
      if (!code) {
        joinInput.classList.add('bad');
        joinInput.focus();
        return;
      }
      location.search = `?join=${code}`;
    });
    joinInput.addEventListener('input', () => joinInput.classList.remove('bad'));
  }

  /** The room the next run starts in (0 unless the player picked a room they've reached). */
  get startRoom(): number {
    return Number(this.startSelect.value) || 0;
  }

  /** "Start in" choices (every room reached so far) and the difficulties beaten. */
  setProgress(p: Progress): void {
    const wrap = this.overlay.querySelector<HTMLElement>('[data-continue]')!;
    const keep = this.startSelect.value;
    this.startSelect.innerHTML = ROOMS.slice(0, p.furthest + 1).map((r, i) => `<option value="${i}">Room ${i + 1} · ${r.name.replace(/^The /, '')}</option>`).join('');
    this.startSelect.value = keep && Number(keep) <= p.furthest ? keep : '0';
    wrap.hidden = p.furthest === 0;
    const trophies = this.overlay.querySelector<HTMLElement>('[data-trophies]')!;
    trophies.hidden = p.wins.length === 0;
    trophies.textContent = `👑 Ash King beaten on: ${DIFFICULTY_LIST.filter((d) => p.wins.includes(d)).map((d) => `${DIFFICULTIES[d].icon} ${DIFFICULTIES[d].label}`).join(' · ')}`;
  }

  /** The hero chosen on the title screen (remembered). */
  hero: HeroClass = loadHero();
  onHero?: (h: HeroClass) => void;

  /** Highlights the chosen hero; locked while a run is paused. */
  showHero(): void {
    const locked = this.button.textContent === 'Resume';
    for (const b of this.overlay.querySelectorAll<HTMLElement>('[data-hero]')) {
      b.classList.toggle('on', b.dataset.hero === this.hero);
      b.toggleAttribute('disabled', locked && b.dataset.hero !== this.hero);
    }
    const hint = this.overlay.querySelector('[data-hero-hint]');
    if (hint) {
      const d = HEROES[this.hero];
      hint.textContent = `${d.blurb} · ${d.hp} health${d.armor ? ` · armour ${Math.round(d.armor * 100)}%` : ''}`;
    }
  }

  /** Highlights the chosen difficulty; locked (dimmed) while a run is paused. */
  showDifficulty(): void {
    const locked = this.button.textContent === 'Resume';
    for (const b of this.overlay.querySelectorAll<HTMLElement>('[data-diff]')) {
      b.classList.toggle('on', b.dataset.diff === difficulty());
      b.toggleAttribute('disabled', locked && b.dataset.diff !== difficulty());
    }
    const hint = this.overlay.querySelector('[data-diff-hint]');
    if (hint) hint.textContent = DIFFICULTIES[difficulty()].blurb;
  }

  /** `inGame`: a run is in progress (so un-pausing resumes it). */
  setPaused(paused: boolean, inGame: boolean): void {
    this.overlay.hidden = !paused;
    // The painted landing art is for the title screen only; pause and game-over use the plain dim.
    if (!paused) {
      this.overlay.dataset.started = '1';
      this.overlay.classList.remove('landing');
    }
    if (paused) this.setStartPrompt(false);
    if (!paused) this.hud.hidden = false;
    if (paused && inGame) {
      this.title.textContent = 'Paused';
      this.message.innerHTML = 'The monsters will wait. Probably.';
      this.button.textContent = 'Resume';
      this.showDifficulty();
      this.showHero();
    }
  }

  /** The quest tracker lines (docs/quests.md). */
  setQuests(lines: readonly { text: string; done: boolean }[]): void {
    const html = questTrackerHtml(lines);
    if (html === this.questsKey) return;
    this.questsKey = html;
    this.quests.innerHTML = html;
  }

  /** The party level and the way to the next. */
  setXp(level: number, progress: number, max: number): void {
    const key = `${level}:${Math.round(progress * 200)}`;
    if (key === this.xpKey) return;
    this.xpKey = key;
    this.xp.innerHTML = xpBarHtml(level, progress, max);
  }

  setHealth(health: number): void {
    this.hearts.innerHTML = hpBarHtml(health, this.maxHealth);
  }

  /** Active power-up chips with a countdown bar; only touches the DOM when something visible changes. */
  setPowers(list: { type: PowerUpType; remaining: number }[]): void {
    const key = powerChipsKey(list);
    if (key === this.powersKey) return;
    this.powersKey = key;
    this.powers.innerHTML = powerChipsHtml(list);
  }

  toast(text: string, color: number): void {
    this.popups.toast(text, color);
  }

  /** Room code for inviting a familiar: shows the code, a join link and a QR code for the tablet. */
  setInviteCode(code: string): void {
    const link = `${location.origin}${location.pathname}?join=${code}`;
    this.codeEl.textContent = code;
    this.linkEl.textContent = link.replace(/^https?:\/\//, '');
    this.qr.hidden = false;
    void QRCode.toCanvas(this.qr, link, { width: 112, margin: 1, color: { dark: '#1a1005', light: '#ffd36e' } });
  }

  setInviteStatus(status: ConnStatus, familiarConnected: boolean, kind: FamiliarKind | null): void {
    const def = kind ? FAMILIARS[kind] : null;
    this.familiarBadge.hidden = !def;
    if (def) {
      this.familiarBadge.textContent = def.emoji;
      this.familiarBadge.title = `${def.name} familiar`;
    }
    this.inviteStatus.classList.toggle('ok', familiarConnected);
    this.inviteStatus.textContent = familiarConnected
      ? def
        ? `${def.emoji} Your ${def.name.toLowerCase()} familiar is here!`
        : 'Familiar connected — choosing a creature…'
      : status === 'open'
        ? 'Waiting for a familiar to join…'
        : status === 'unavailable'
          ? 'Multiplayer unavailable right now — solo works fine.'
          : status === 'reconnecting'
            ? 'Reconnecting…'
            : 'Connecting to the server… (can take a minute to wake up)';
  }

  setMuted(muted: boolean): void {
    this.muted.hidden = !muted;
  }

  setBest(best: Best | null): void {
    this.best.hidden = !best;
    if (best) this.best.textContent = `Best: ${best.score} points · wave ${best.wave}`;
  }

  /** Max health changed (gear): redraws the bar at its new length. */
  setMaxHealth(max: number): void {
    this.maxHealth = max;
  }

  setScore(score: number): void {
    this.score.textContent = String(score);
  }

  setGold(gold: number): void {
    const t = `🪙 ${gold}`;
    if (this.gold.textContent !== t) this.gold.textContent = t;
  }

  /** The "Start" prompt before the first wave: a button on touch screens, a hint for Enter with a mouse (the pointer is locked). */
  /** The big prompt at the bottom: "Press Enter to start" — or, after the last boss, to finish. */
  setStartPrompt(visible: boolean, finish = false): void {
    if (this.startPrompt.hidden === visible && this.startPrompt.dataset.finish === String(finish)) return;
    this.startPrompt.hidden = !visible;
    this.startPrompt.dataset.finish = String(finish);
    const touch = this.startPrompt.dataset.touch === '1';
    this.startPrompt.innerHTML = finish
      ? touch ? '👑 Finish the run' : 'Press <kbd>Enter</kbd> to finish the run'
      : touch ? '▶ Start' : 'Press <kbd>Enter</kbd> to start';
  }

  /** The run label (room, wave, foes left…). */
  setWave(text: string): void {
    if (this.wave.textContent !== text) this.wave.textContent = text;
  }

  banner(text: string): void {
    this.popups.banner(text);
  }

  flashHurt(): void {
    this.popups.flashHurt();
  }

  showVictory(score: number, seconds: number, isBest: boolean): void {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    this.title.textContent = '👑 Victory!';
    this.message.innerHTML = `The Ash King has fallen. You cleared all seven rooms in <strong>${m}:${s}</strong> with <strong>${score}</strong> points${isBest ? ' — a new best!' : '.'}`;
    this.button.textContent = 'Play again';
    this.showDifficulty();
    this.showHero();
    this.overlay.hidden = false;
  }

  showGameOver(wave: number, score: number, isBest: boolean): void {
    this.title.textContent = isBest && score > 0 ? 'New best!' : 'Overwhelmed';
    this.message.innerHTML = `You held out until wave <strong>${wave}</strong> with <strong>${score}</strong> points.`;
    this.button.textContent = 'Try again';
    this.showDifficulty();
    this.showHero();
    this.overlay.hidden = false;
  }
}
