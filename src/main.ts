import * as THREE from 'three';
import './style.css';
import { Game } from './game/Game';
import { Elf } from './player/elf';
import { Crab } from './player/crab';
import type { InputMode } from './player/controls';

const CRAB_SCALE = 0.32; // companion-sized: ~1.4 m across with claws

const root = document.querySelector<HTMLDivElement>('#app')!;

async function boot(): Promise<void> {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch {
    root.innerHTML = '<p class="error">WebGL 2 isn’t available in this browser, so the game can’t run.</p>';
    return;
  }
  // Touch-first devices get the on-screen controls and a lighter render load.
  const mode: InputMode = matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse';
  renderer.setPixelRatio(Math.min(devicePixelRatio, mode === 'touch' ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  root.appendChild(renderer.domElement);

  const base = import.meta.env.BASE_URL;
  const [elf, crab] = await Promise.all([Elf.load(`${base}models/elf.glb`), Crab.load(`${base}models/crab.glb`, CRAB_SCALE)]);
  const game = new Game(renderer, root, elf, crab, mode);
  game.start();

  if (import.meta.env.DEV) {
    void import('three/addons/libs/stats.module.js').then(({ default: Stats }) => {
      const stats = new Stats();
      stats.dom.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:10;';
      root.appendChild(stats.dom);
      game.setFrameHook(() => stats.update());
      (window as unknown as { __game: Game }).__game = game;
    });
  }
}

boot().catch((err) => {
  console.error(err);
  root.innerHTML = '<p class="error">The game failed to load. Check the console for details.</p>';
});
