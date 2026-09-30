import type { Best } from '../game/highscore';
import type { InputMode } from '../player/controls';
import { POWER_UPS, type PowerUpType } from '../game/powerups';

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
  private readonly toastEl: HTMLElement;
  private powersKey = '';
  private toastTimer = 0;
  private readonly bannerEl: HTMLElement;
  private readonly hurt: HTMLElement;
  private readonly hud: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly title: HTMLElement;
  private readonly message: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly best: HTMLElement;
  private readonly maxHealth: number;
  private bannerTimer = 0;

  constructor(root: HTMLElement, maxHealth: number, mode: InputMode, onPlay: () => void) {
    this.maxHealth = maxHealth;
    root.insertAdjacentHTML(
      'beforeend',
      `<div class="hurt"></div>
       <div class="hud" hidden>
         <div class="left">
           <div class="hearts" data-hearts></div>
           <div class="powers" data-powers></div>
         </div>
         <div class="wave" data-wave></div>
         <div class="right">
           <span class="muted" data-muted hidden>🔇</span>
           <div class="score" data-score>0</div>
         </div>
       </div>
       <div class="banner" data-banner></div>
       <div class="toast" data-toast></div>
       <div class="overlay">
         <div class="card">
           <h1 data-title>Elf &amp; Crab</h1>
           <p data-message>Slimes are pouring out of the dungeon gates.<br/>Hold them off with your bow — your crab has your back.</p>
           <p class="keys">${mode === 'touch' ? KEYS_TOUCH : KEYS_MOUSE}</p>
           <button type="button">Enter the dungeon</button>
           <p class="best" data-best hidden></p>
         </div>
       </div>`,
    );
    this.hearts = root.querySelector('[data-hearts]')!;
    this.wave = root.querySelector('[data-wave]')!;
    this.score = root.querySelector('[data-score]')!;
    this.muted = root.querySelector('[data-muted]')!;
    this.powers = root.querySelector('[data-powers]')!;
    this.toastEl = root.querySelector('[data-toast]')!;
    this.bannerEl = root.querySelector('[data-banner]')!;
    this.hurt = root.querySelector('.hurt')!;
    this.hud = root.querySelector('.hud')!;
    this.overlay = root.querySelector('.overlay')!;
    this.title = root.querySelector('[data-title]')!;
    this.message = root.querySelector('[data-message]')!;
    this.button = root.querySelector('.overlay button')!;
    this.best = root.querySelector('[data-best]')!;
    this.overlay.addEventListener('click', onPlay);
  }

  /** `inGame`: a run is in progress (so un-pausing resumes it). */
  setPaused(paused: boolean, inGame: boolean): void {
    this.overlay.hidden = !paused;
    if (!paused) this.hud.hidden = false;
    if (paused && inGame) {
      this.title.textContent = 'Paused';
      this.message.innerHTML = 'The slimes will wait. Probably.';
      this.button.textContent = 'Resume';
    }
  }

  setHealth(health: number): void {
    this.hearts.innerHTML = Array.from({ length: this.maxHealth }, (_, i) => `<span class="${i < health ? 'full' : ''}">♥</span>`).join('');
  }

  /** Active power-up chips with a countdown bar; only touches the DOM when something visible changes. */
  setPowers(list: { type: PowerUpType; remaining: number }[]): void {
    const key = list.map((p) => `${p.type}:${Math.ceil(p.remaining * 4)}`).join('|');
    if (key === this.powersKey) return;
    this.powersKey = key;
    this.powers.innerHTML = list
      .map(({ type, remaining }) => {
        const def = POWER_UPS[type];
        const color = `#${def.color.toString(16).padStart(6, '0')}`;
        const pct = Math.min(100, (remaining / def.duration) * 100);
        const low = remaining < 3 ? ' low' : '';
        return `<div class="chip${low}" style="--c:${color}" title="${def.label}"><span>${def.icon}</span><b>${Math.ceil(remaining)}</b><i style="width:${pct}%"></i></div>`;
      })
      .join('');
  }

  toast(text: string, color: number): void {
    this.toastEl.textContent = text;
    this.toastEl.style.color = `#${color.toString(16).padStart(6, '0')}`;
    this.toastEl.classList.remove('show');
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 1400);
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

  setWave(wave: number, remaining: number): void {
    const text = wave === 0 ? 'Get ready…' : `Wave ${wave} · ${remaining} slime${remaining === 1 ? '' : 's'} left`;
    if (this.wave.textContent !== text) this.wave.textContent = text;
  }

  banner(text: string): void {
    this.bannerEl.textContent = text;
    this.bannerEl.classList.remove('show');
    void this.bannerEl.offsetWidth; // restart the CSS animation
    this.bannerEl.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.bannerEl.classList.remove('show'), 1800);
  }

  flashHurt(): void {
    this.hurt.classList.remove('flash');
    void this.hurt.offsetWidth;
    this.hurt.classList.add('flash');
  }

  showGameOver(wave: number, score: number, isBest: boolean): void {
    this.title.textContent = isBest && score > 0 ? 'New best!' : 'Overwhelmed';
    this.message.innerHTML = `You held out until wave <strong>${wave}</strong> with <strong>${score}</strong> points.`;
    this.button.textContent = 'Try again';
    this.overlay.hidden = false;
  }
}
