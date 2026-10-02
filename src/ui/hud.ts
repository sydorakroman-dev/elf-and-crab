import type { Best } from '../game/highscore';
import type { InputMode } from '../player/controls';
import type { PowerUpType } from '../game/powerups';
import { BossBar, Fade, Popups, hpBarHtml, powerChipsHtml, powerChipsKey } from './shared';
import { normalizeCode } from '../net/protocol';
import { ActionBar } from './actionbar';
import type { ConnStatus } from '../net/client';
import QRCode from 'qrcode';
import { FAMILIARS, type FamiliarKind } from '../game/familiars';

const KEYS_MOUSE =
  '<kbd>W A S D</kbd> move · <kbd>Mouse</kbd> aim · <kbd>Click</kbd> shoot (hold) · <kbd>Space</kbd> dash · <kbd>Scroll</kbd> zoom · <kbd>M</kbd> mute · <kbd>Esc</kbd> pause';
const KEYS_TOUCH = 'Left thumb: move · Right thumb: look · Hold 🏹 to shoot · 💨 to dash';

/** DOM overlay: hearts, wave and score, wave banners, hurt flash, and the title / pause / game-over screen. */
export class Hud {
  private readonly hearts: HTMLElement;
  private readonly wave: HTMLElement;
  private readonly score: HTMLElement;
  private readonly muted: HTMLElement;
  private readonly powers: HTMLElement;
  private powersKey = '';
  private readonly popups: Popups;
  readonly bossBar: BossBar;
  readonly actionBar: ActionBar;
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
  private readonly maxHealth: number;
  private readonly startPrompt: HTMLElement;

  constructor(root: HTMLElement, maxHealth: number, mode: InputMode, onPlay: () => void, onStart: () => void) {
    this.maxHealth = maxHealth;
    root.insertAdjacentHTML(
      'beforeend',
      `<div class="hud" hidden>
         <div class="left">
           <div class="hearts" data-hearts></div>
           <div class="powers" data-powers></div>
         </div>
         <div class="wave" data-wave></div>
         <div class="right">
           <span class="familiar-badge" data-familiar hidden title="Familiar connected">🦀</span>
           <span class="muted" data-muted hidden>🔇</span>
           <div class="score" data-score>0</div>
         </div>
       </div>
       <div class="overlay">
         <div class="card">
           <img class="emblem" src="${import.meta.env.BASE_URL}icons/emblem.jpg" alt="" />
           <h1 data-title>Elf &amp; Crab</h1>
           <p data-message>Goblins, the undead, orcs and worse are pouring out of every gate. Fight from the woodland down through the dungeon to the Ash King, the dragon in his lair — alone, or with a friend as your familiar.</p>
           <p class="keys">${mode === 'touch' ? KEYS_TOUCH : KEYS_MOUSE}</p>
           <button type="button" data-play>Begin the hunt</button>
           <p class="best" data-best hidden></p>
           <button type="button" class="keys-btn" data-keys>⚙️ Keys</button>
           <div class="invite" data-invite>
             <canvas class="qr" data-qr width="112" height="112" hidden></canvas>
             <div class="invite-text">
               <div class="invite-title">🐾 Play together</div>
               <div class="invite-sub">A friend joins as your familiar — crab, capybara, wolf or goldfish — on a tablet or phone:</div>
               <div class="code" data-code>····</div>
               <div class="invite-link" data-link></div>
               <div class="invite-status" data-istatus>Connecting to the server…</div>
             </div>
           </div>
           <form class="join" data-join>
             <span title="Type TEST to practise as the familiar on your own">Got a code?</span>
             <input data-join-code maxlength="5" placeholder="ABCD" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Room code" />
             <button type="submit" class="join-btn">Join as familiar</button>
           </form>
         </div>
       </div>`,
    );
    this.hearts = root.querySelector('[data-hearts]')!;
    this.wave = root.querySelector('[data-wave]')!;
    this.score = root.querySelector('[data-score]')!;
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
    // Its own layer (not inside the HUD bar), so it sits above the touch controls.
    root.insertAdjacentHTML(
      'beforeend',
      `<button type="button" class="start-prompt" data-start hidden>${mode === 'touch' ? '▶ Start' : 'Press <kbd>Enter</kbd> to start'}</button>`,
    );
    this.startPrompt = root.querySelector('[data-start]')!;
    // pointerdown, not click: the touch controls cancel the click a tap would make.
    this.startPrompt.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      onStart();
    });
    // Clicking anywhere on the overlay plays — except inside the invite / join controls.
    this.overlay.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-keys]')) {
        this.actionBar.openPanel();
        return;
      }
      if ((e.target as HTMLElement).closest('[data-invite], [data-join]')) return;
      onPlay();
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
    }
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

  setScore(score: number): void {
    this.score.textContent = String(score);
  }

  /** The "Start" prompt before the first wave: a button on touch screens, a hint for Enter with a mouse (the pointer is locked). */
  setStartPrompt(visible: boolean): void {
    if (this.startPrompt.hidden === visible) this.startPrompt.hidden = !visible;
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
    this.overlay.hidden = false;
  }

  showGameOver(wave: number, score: number, isBest: boolean): void {
    this.title.textContent = isBest && score > 0 ? 'New best!' : 'Overwhelmed';
    this.message.innerHTML = `You held out until wave <strong>${wave}</strong> with <strong>${score}</strong> points.`;
    this.button.textContent = 'Try again';
    this.overlay.hidden = false;
  }
}
