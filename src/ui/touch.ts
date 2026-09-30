import type { Player } from '../player/controls';
import { joystickVector } from './joystick';

const STICK_RADIUS = 56; // px the thumb can travel from where it landed

/**
 * On-screen controls for touch devices: a floating joystick on the left half, drag-to-look on
 * the right half, and buttons to shoot (hold), dash and pause. Uses pointer events so several
 * fingers work at once.
 */
export class TouchControls {
  private readonly root: HTMLElement;
  private readonly stick: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly player: Player;

  constructor(parent: HTMLElement, player: Player) {
    this.player = player;
    parent.insertAdjacentHTML(
      'beforeend',
      `<div class="touch" hidden>
         <div class="touch-zone move"></div>
         <div class="touch-zone look"></div>
         <div class="stick" hidden><div class="knob"></div></div>
         <button type="button" class="tbtn shoot" aria-label="Shoot">🏹</button>
         <button type="button" class="tbtn dash" aria-label="Dash">💨</button>
         <button type="button" class="tbtn pause" aria-label="Pause"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="3" y="2" width="3.5" height="12" rx="1" fill="currentColor"/><rect x="9.5" y="2" width="3.5" height="12" rx="1" fill="currentColor"/></svg></button>
       </div>`,
    );
    this.root = parent.querySelector('.touch')!;
    this.stick = this.root.querySelector('.stick')!;
    this.knob = this.root.querySelector('.knob')!;

    this.bindMove(this.root.querySelector('.touch-zone.move')!);
    this.bindLook(this.root.querySelector('.touch-zone.look')!);

    const shoot = this.root.querySelector<HTMLElement>('.tbtn.shoot')!;
    shoot.addEventListener('pointerdown', (e) => {
      shoot.setPointerCapture(e.pointerId);
      shoot.classList.add('down');
      player.setTouchTrigger(true);
    });
    for (const ev of ['pointerup', 'pointercancel'] as const) {
      shoot.addEventListener(ev, () => {
        shoot.classList.remove('down');
        player.setTouchTrigger(false);
      });
    }
    const dash = this.root.querySelector<HTMLElement>('.tbtn.dash')!;
    dash.addEventListener('pointerdown', () => player.queueDash());
    this.root.querySelector('.tbtn.pause')!.addEventListener('click', () => player.deactivate());

    // No long-press menus or text selection while playing.
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
    if (!visible) {
      this.stick.hidden = true;
      this.player.setMove(0, 0);
    }
  }

  private bindMove(zone: HTMLElement): void {
    let id: number | null = null;
    let ox = 0;
    let oy = 0;
    zone.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      id = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      ox = e.clientX;
      oy = e.clientY;
      this.stick.style.transform = `translate(${ox}px, ${oy}px)`;
      this.knob.style.transform = 'translate(0px, 0px)';
      this.stick.hidden = false;
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const dx = e.clientX - ox;
      const dy = e.clientY - oy;
      const v = joystickVector(dx, dy, STICK_RADIUS);
      this.player.setMove(v.x, v.y);
      const len = Math.hypot(dx, dy);
      const k = len > STICK_RADIUS ? STICK_RADIUS / len : 1;
      this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      this.stick.hidden = true;
      this.player.setMove(0, 0);
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  private bindLook(zone: HTMLElement): void {
    let id: number | null = null;
    let lx = 0;
    let ly = 0;
    zone.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      id = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      lx = e.clientX;
      ly = e.clientY;
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      this.player.look(e.clientX - lx, e.clientY - ly);
      lx = e.clientX;
      ly = e.clientY;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === id) id = null;
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }
}
