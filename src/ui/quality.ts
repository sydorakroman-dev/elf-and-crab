import type * as THREE from 'three';

/**
 * Automatic quality: watches the frame rate and, if the device keeps struggling (under ~40 fps for
 * a few seconds), steps quality down — first a lower render resolution, then no shadows. Helps
 * older tablets keep playable frame rates; fast devices never notice it.
 */
export class AutoQuality {
  private readonly renderer: THREE.WebGLRenderer;
  private frames = 0;
  private elapsed = 0;
  private slowFor = 0;
  private level = 0;
  /** Seconds to ignore at the start (loading, shader compiling). */
  private warmup = 4;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
  }

  /** Call once per rendered frame with the real frame time (seconds). */
  frame(dt: number): void {
    if (this.level >= 2 || dt <= 0 || dt > 0.5) return; // done, or a pause / tab switch
    if (this.warmup > 0) {
      this.warmup -= dt;
      return;
    }
    this.frames++;
    this.elapsed += dt;
    if (this.elapsed < 1) return;
    const fps = this.frames / this.elapsed;
    this.frames = 0;
    this.elapsed = 0;
    this.slowFor = fps < 40 ? this.slowFor + 1 : 0;
    if (this.slowFor < 3) return;
    this.slowFor = 0;
    this.level++;
    if (this.level === 1) {
      this.renderer.setPixelRatio(Math.max(1, this.renderer.getPixelRatio() * 0.7));
      console.info(`[quality] running at ${fps.toFixed(0)} fps — lowering resolution`);
    } else {
      this.renderer.shadowMap.enabled = false;
      console.info(`[quality] still ${fps.toFixed(0)} fps — turning shadows off`);
    }
    this.warmup = 2;
  }
}
