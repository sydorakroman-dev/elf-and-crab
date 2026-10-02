import * as THREE from 'three';

const POOL = 48;
const LIFE = 0.8;

interface Num {
  sprite: THREE.Sprite;
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  age: number;
  vx: number;
  size: number;
}

/**
 * Floating damage numbers: pop up over whatever was hit, drift up and fade. Heavy hits are bigger
 * and orange; damage to the elf is red. Pooled sprites with small canvas textures.
 */
export class DamageNumbers {
  readonly group = new THREE.Group();
  private readonly nums: Num[] = [];
  private next = 0;

  constructor() {
    for (let i = 0; i < POOL; i++) {
      const canvas = typeof document === 'undefined' ? null : document.createElement('canvas');
      if (!canvas) break; // tests (no DOM): numbers just don't show
      canvas.width = 128;
      canvas.height = 64;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }));
      sprite.visible = false;
      sprite.renderOrder = 10;
      this.group.add(sprite);
      this.nums.push({ sprite, canvas, texture, age: LIFE, vx: 0, size: 1 });
    }
  }

  /** Shows `amount` at (x, y, z). `kind`: 'hit' (enemy), 'big' (heavy hit on an enemy), 'hurt' (the elf). */
  show(amount: number, x: number, y: number, z: number, kind: 'hit' | 'big' | 'hurt' = 'hit'): void {
    if (!this.nums.length || amount <= 0) return;
    const n = this.nums[this.next];
    this.next = (this.next + 1) % this.nums.length;
    const ctx = n.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 128, 64);
    ctx.font = `900 ${kind === 'hit' ? 40 : 50}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(20, 10, 10, 0.9)';
    const text = String(Math.round(amount));
    ctx.strokeText(text, 64, 34);
    ctx.fillStyle = kind === 'hurt' ? '#ff5050' : kind === 'big' ? '#ffb02e' : '#ffffff';
    ctx.fillText(text, 64, 34);
    n.texture.needsUpdate = true;
    n.sprite.position.set(x + (Math.random() - 0.5) * 0.4, y, z);
    n.size = kind === 'hit' ? 0.9 : 1.3;
    n.vx = (Math.random() - 0.5) * 0.8;
    n.age = 0;
    n.sprite.visible = true;
  }

  update(dt: number): void {
    for (const n of this.nums) {
      if (n.age >= LIFE) continue;
      n.age += dt;
      const k = n.age / LIFE;
      n.sprite.position.y += dt * (2.2 - k * 1.8);
      n.sprite.position.x += n.vx * dt;
      const pop = k < 0.15 ? 0.6 + (k / 0.15) * 0.6 : 1.2 - (k - 0.15) * 0.25; // a quick pop, then settle
      n.sprite.scale.set(n.size * pop * 2, n.size * pop, 1);
      n.sprite.material.opacity = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
      if (n.age >= LIFE) n.sprite.visible = false;
    }
  }
}
