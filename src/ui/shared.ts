import { POWER_UPS, type PowerUpType } from '../game/powerups';
import { ROOMS, WAVES_PER_ROOM } from '../world/rooms';
import { enemyName } from '../game/enemies';

/** HUD pieces shared by the hero's screen and the familiar's tablet. */

/** The hero's health bar (HP out of max), shaded by how much is left. */
export function hpBarHtml(health: number, max: number): string {
  const hp = Math.max(0, Math.ceil(health));
  const pct = Math.max(0, Math.min(100, (hp / max) * 100));
  const tone = pct > 50 ? 'ok' : pct > 25 ? 'warn' : 'low';
  return `<div class="hp ${tone}"><span class="hp-heart">♥</span><div class="hp-track"><div class="hp-fill" style="width:${pct}%"></div></div><b>${hp}</b></div>`;
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
  return wave === 0 ? 'Get ready…' : `Wave ${wave} · ${remaining} foe${remaining === 1 ? '' : 's'} left`;
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

/** A boss's health bar across the top of the screen. */
export class BossBar {
  private readonly el: HTMLElement;
  private readonly fill: HTMLElement;

  constructor(root: HTMLElement) {
    root.insertAdjacentHTML('beforeend', '<div class="boss-bar" hidden><span data-boss-name></span><div class="boss-track"><div class="boss-fill"></div></div></div>');
    this.el = root.querySelector('.boss-bar')!;
    this.fill = this.el.querySelector('.boss-fill')!;
    this.name = this.el.querySelector('[data-boss-name]')!;
  }
  private readonly name: HTMLElement;

  /** Shows the bar at hp/max with the boss's name, or hides it (null). */
  set(boss: { hp: number; max: number; name: string } | null): void {
    this.el.hidden = !boss;
    if (!boss) return;
    this.fill.style.width = `${Math.max(0, (boss.hp / boss.max) * 100)}%`;
    const label = `${boss.name.includes('Bear') ? '🐻' : '👑'} ${boss.name}`;
    if (this.name.textContent !== label) this.name.textContent = label;
  }
}

/** Full-screen fade to black between rooms, with the next room's intro card (its foes' illustration). */
export class Fade {
  private readonly el: HTMLElement;
  private readonly card: HTMLElement;
  private shown = -1;

  constructor(root: HTMLElement) {
    root.insertAdjacentHTML(
      'beforeend',
      `<div class="fade"><div class="room-card">
         <img class="rc-art" alt="" />
         <div class="rc-text"><span class="rc-step"></span><h2 class="rc-name"></h2><p class="rc-who"></p></div>
         <p class="rc-skip">tap or click to continue</p>
       </div></div>`,
    );
    this.el = root.querySelector('.fade')!;
    this.card = this.el.querySelector('.room-card')!;
  }

  /** `card`: index of the room whose card to show on the black (-1: just black). */
  set(dark: boolean, card = -1): void {
    this.el.classList.toggle('on', dark);
    const show = dark && card >= 0;
    this.card.classList.toggle('on', show);
    if (!show || card === this.shown) return;
    this.shown = card;
    const room = ROOMS[card];
    const boss = room.waves[WAVES_PER_ROOM - 1].boss;
    this.card.querySelector<HTMLImageElement>('.rc-art')!.src = `${import.meta.env.BASE_URL}art/${room.art}.jpg`;
    this.card.querySelector('.rc-step')!.textContent = card === ROOMS.length - 1 ? `Room ${card + 1} of ${ROOMS.length} · the last one` : `Room ${card + 1} of ${ROOMS.length}`;
    this.card.querySelector('.rc-name')!.textContent = room.name;
    this.card.querySelector('.rc-who')!.textContent = `${room.group} · Boss: ${boss ? enemyName(boss) : '—'}`;
  }
}

/** Loading screen: a random foes' illustration while the models load. */
export function showLoading(root: HTMLElement): () => void {
  const room = ROOMS[Math.floor(Math.random() * ROOMS.length)];
  root.insertAdjacentHTML(
    'beforeend',
    `<div class="loading"><img src="${import.meta.env.BASE_URL}art/${room.art}.jpg" alt="" /><p>Gathering the monsters…</p></div>`,
  );
  const el = root.querySelector<HTMLElement>('.loading')!;
  return () => {
    el.classList.add('done');
    setTimeout(() => el.remove(), 500);
  };
}
