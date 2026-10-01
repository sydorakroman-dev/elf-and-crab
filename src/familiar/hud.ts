import { POWER_CODES } from '../net/snapshot';
import type { Snapshot } from '../net/snapshot';
import { normalizeCode } from '../net/protocol';
import { Popups, heartsHtml, powerChipsHtml, powerChipsKey, waveText } from '../ui/shared';
import type { PowerUpType } from '../game/powerups';
import { BURST_COOLDOWN } from '../game/companion';

export type Blocking = 'start' | 'no-room' | 'room-full' | 'hero-left' | null;

/**
 * The familiar's tablet HUD: the hero's hearts / wave / score / power-ups, a status pill, the
 * big Magic Burst button with its cooldown ring, and full-screen cards for start and errors.
 */
export class FamiliarHud {
  readonly popups: Popups;
  onBurst?: () => void;
  onStart?: () => void;
  private readonly hearts: HTMLElement;
  private readonly powers: HTMLElement;
  private readonly wave: HTMLElement;
  private readonly score: HTMLElement;
  private readonly status: HTMLElement;
  private readonly burstBtn: HTMLButtonElement;
  private readonly overlay: HTMLElement;
  private readonly title: HTMLElement;
  private readonly message: HTMLElement;
  private readonly action: HTMLButtonElement;
  private readonly retry: HTMLFormElement;
  private powersKey = '';
  private blocking: Blocking = 'start';

  constructor(root: HTMLElement, code: string) {
    root.insertAdjacentHTML(
      'beforeend',
      `<div class="hud fam-hud">
         <div class="left"><div class="hearts" data-f-hearts></div><div class="powers" data-f-powers></div></div>
         <div class="wave" data-f-wave></div>
         <div class="right"><span class="role-badge">🦀 ${code}</span><div class="score" data-f-score>0</div></div>
       </div>
       <div class="fam-status" data-f-status hidden></div>
       <button type="button" class="burst-btn" data-f-burst aria-label="Magic Burst">
         <span class="burst-icon">✨</span><span class="burst-label">Burst</span>
       </button>
       <div class="overlay fam-overlay">
         <div class="card">
           <h1 data-f-title>You're the familiar</h1>
           <p data-f-message>Help the elf survive. <b>Tap the floor</b> to move your crab — it pinches any slime it touches.<br/><b>✨ Burst</b> stuns every slime around you.</p>
           <button type="button" data-f-action>Tap to join 🦀</button>
           <form class="join" data-f-retry hidden>
             <input maxlength="5" placeholder="ABCD" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Room code" />
             <button type="submit" class="join-btn">Join</button>
           </form>
           <p class="fam-solo"><a href="./">Play solo as the elf instead</a></p>
         </div>
       </div>`,
    );
    this.popups = new Popups(root);
    this.hearts = root.querySelector('[data-f-hearts]')!;
    this.powers = root.querySelector('[data-f-powers]')!;
    this.wave = root.querySelector('[data-f-wave]')!;
    this.score = root.querySelector('[data-f-score]')!;
    this.status = root.querySelector('[data-f-status]')!;
    this.burstBtn = root.querySelector('[data-f-burst]')!;
    this.overlay = root.querySelector('.fam-overlay')!;
    this.title = root.querySelector('[data-f-title]')!;
    this.message = root.querySelector('[data-f-message]')!;
    this.action = root.querySelector('[data-f-action]')!;
    this.retry = root.querySelector('[data-f-retry]')!;

    this.burstBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.onBurst?.();
    });
    this.action.addEventListener('click', () => {
      if (this.blocking === 'start') {
        this.setBlocking(null);
        this.onStart?.();
      } else if (this.blocking === 'hero-left') {
        location.reload();
      }
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

  setBlocking(b: Blocking, code = ''): void {
    // An error (bad code, full room, hero gone) replaces whatever card is showing.
    this.blocking = b;
    this.overlay.hidden = b === null;
    this.retry.hidden = !(b === 'no-room' || b === 'room-full');
    this.action.hidden = b === 'no-room' || b === 'room-full';
    if (b === 'no-room') {
      this.title.textContent = 'Room not found';
      this.message.innerHTML = `There's no game with code <b>${code}</b>. Ask the elf player for the code on their screen.`;
    } else if (b === 'room-full') {
      this.title.textContent = 'Already has a familiar';
      this.message.innerHTML = `Game <b>${code}</b> already has a crab. Only one familiar per game.`;
    } else if (b === 'hero-left') {
      this.title.textContent = 'The elf left';
      this.message.innerHTML = 'The game has ended. Ask them for a new code to play again.';
      this.action.textContent = 'Try again';
    }
  }

  /** Small non-blocking status pill (connecting, waiting, paused…); null hides it. */
  setStatus(text: string | null): void {
    this.status.hidden = text === null;
    if (text !== null && this.status.textContent !== text) this.status.textContent = text;
  }

  update(s: Snapshot): void {
    this.hearts.innerHTML = heartsHtml(s.health, s.maxHealth);
    const list = s.powers.map(([code, remaining]) => ({ type: POWER_CODES[code] as PowerUpType, remaining }));
    const key = powerChipsKey(list);
    if (key !== this.powersKey) {
      this.powersKey = key;
      this.powers.innerHTML = powerChipsHtml(list);
    }
    const w = waveText(s.wave, s.remaining);
    if (this.wave.textContent !== w) this.wave.textContent = w;
    this.score.textContent = String(s.score);
    this.setBurstCooldown(s.burstCd);
  }

  private setBurstCooldown(seconds: number): void {
    const ready = seconds <= 0.05;
    this.burstBtn.classList.toggle('ready', ready);
    this.burstBtn.style.setProperty('--p', String(1 - Math.min(1, seconds / BURST_COOLDOWN)));
    const label = ready ? 'Burst' : String(Math.ceil(seconds));
    const el = this.burstBtn.querySelector('.burst-label')!;
    if (el.textContent !== label) el.textContent = label;
  }
}
