import * as THREE from 'three';
import './style.css';
import { Game } from './game/Game';
import { Elf } from './player/elf';
import { loadFamiliarBodies } from './player/beasts';
import { loadBeastTemplates } from './game/beastVisual';
import { loadElementalTemplates } from './game/elementalVisual';
import { loadMonsterTemplates } from './game/monsterVisual';
import type { InputMode } from './player/controls';
import { FamiliarGame } from './familiar/FamiliarGame';
import { FamiliarSession, HeroSession } from './net/client';
import { normalizeCode } from './net/protocol';

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
  // ?join=CODE → this device is the familiar (crab); otherwise it's the hero (elf).
  const joinCode = normalizeCode(new URLSearchParams(location.search).get('join') ?? '');
  // Touch-first devices get the on-screen controls and a lighter render load.
  const mode: InputMode = matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse';
  renderer.setPixelRatio(Math.min(devicePixelRatio, mode === 'touch' || joinCode ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  root.appendChild(renderer.domElement);

  const base = import.meta.env.BASE_URL;
  const [elf, familiars] = await Promise.all([
    Elf.load(`${base}models/elf.glb`),
    loadFamiliarBodies(base, CRAB_SCALE),
    loadBeastTemplates(base),
    loadElementalTemplates(base),
    loadMonsterTemplates(base),
  ]);
  const game = joinCode
    ? new FamiliarGame(renderer, root, elf, familiars, new FamiliarSession(joinCode))
    : new Game(renderer, root, elf, familiars, mode, multiplayerAvailable() ? new HeroSession() : null);
  game.start();

  if (import.meta.env.DEV) {
    void import('three/addons/libs/stats.module.js').then(({ default: Stats }) => {
      const stats = new Stats();
      stats.dom.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:10;';
      root.appendChild(stats.dom);
      game.setFrameHook(() => stats.update());
      (window as unknown as { __game: Game | FamiliarGame }).__game = game;
    });
  }
}

/** A build served without a multiplayer server (e.g. GitHub Pages with no VITE_SERVER_URL) is solo-only. */
function multiplayerAvailable(): boolean {
  return Boolean(import.meta.env.VITE_SERVER_URL) || !location.hostname.endsWith('github.io');
}

boot().catch((err) => {
  console.error(err);
  root.innerHTML = '<p class="error">The game failed to load. Check the console for details.</p>';
});
