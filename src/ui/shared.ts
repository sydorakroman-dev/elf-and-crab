import { POWER_UPS, type PowerUpType } from '../game/powerups';

/** HUD pieces shared by the hero's screen and the familiar's tablet. */

export function heartsHtml(health: number, max: number): string {
  return Array.from({ length: max }, (_, i) => `<span class="${i < health ? 'full' : ''}">♥</span>`).join('');
}

export function powerChipsHtml(list: { type: PowerUpType; remaining: number }[]): string {
  return list
    .map(({ type, remaining }) => {
      const def = POWER_UPS[type];
      const color = cssColor(def.color);
      const pct = Math.min(100, (remaining / def.duration) * 100);
      const low = remaining < 3 ? ' low' : '';
      return `<div class="chip${low}" style="--c:${color}" title="${def.label}"><span>${def.icon}</span><b>${Math.ceil(remaining)}</b><i style="width:${pct}%"></i></div>`;
    })
    .join('');
}

/** Key that changes only when the chips would visibly change (avoids DOM churn every frame). */
export function powerChipsKey(list: { type: PowerUpType; remaining: number }[]): string {
  return list.map((p) => `${p.type}:${Math.ceil(p.remaining * 4)}`).join('|');
}

export function waveText(wave: number, remaining: number): string {
  return wave === 0 ? 'Get ready…' : `Wave ${wave} · ${remaining} slime${remaining === 1 ? '' : 's'} left`;
}

export function cssColor(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

function restartAnimation(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth; // reflow so the CSS animation plays again
  el.classList.add(cls);
}

/** Big wave banner, small toast, and the red hurt vignette. */
export class Popups {
  private readonly bannerEl: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly hurtEl: HTMLElement;
  private bannerTimer = 0;
  private toastTimer = 0;

  constructor(root: HTMLElement) {
    root.insertAdjacentHTML('beforeend', '<div class="hurt"></div><div class="banner"></div><div class="toast"></div>');
    this.hurtEl = root.querySelector('.hurt')!;
    this.bannerEl = root.querySelector('.banner')!;
    this.toastEl = root.querySelector('.toast')!;
  }

  banner(text: string): void {
    this.bannerEl.textContent = text;
    restartAnimation(this.bannerEl, 'show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.bannerEl.classList.remove('show'), 1800);
  }

  toast(text: string, color: number): void {
    this.toastEl.textContent = text;
    this.toastEl.style.color = cssColor(color);
    restartAnimation(this.toastEl, 'show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 1400);
  }

  flashHurt(): void {
    restartAnimation(this.hurtEl, 'flash');
  }
}
