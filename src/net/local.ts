import type { FamiliarCommand } from './protocol';
import type { Snapshot } from './snapshot';
import type { FamiliarLink, HeroLink } from './client';

/** Typing this as the join code opens the practice room instead of joining a real one. */
export const PRACTICE_CODE = 'TEST';

/**
 * An in-memory link between a hero game and a familiar view running in the same browser: the
 * practice room. Messages go through a JSON round-trip and a microtask, like the real network
 * minus the latency. Call connect() once both sides are wired up.
 */
export function practiceLink(): { hero: HeroLink; familiar: FamiliarLink; connect(): void } {
  const hero: HeroLink = {
    familiarConnected: false,
    sendSnapshot(s: Snapshot) {
      if (!hero.familiarConnected) return;
      const copy = JSON.parse(JSON.stringify(s)) as Snapshot;
      queueMicrotask(() => familiar.onSnapshot?.(copy));
    },
  };
  const familiar: FamiliarLink = {
    code: PRACTICE_CODE,
    send(cmd: FamiliarCommand) {
      const copy = JSON.parse(JSON.stringify(cmd)) as FamiliarCommand;
      queueMicrotask(() => hero.onCommand?.(copy));
    },
  };
  return {
    hero,
    familiar,
    connect() {
      hero.familiarConnected = true;
      hero.onStatus?.('open');
      hero.onFamiliar?.(true);
      familiar.onStatus?.('joined');
    },
  };
}
