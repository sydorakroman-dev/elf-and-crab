import { HEROES, type HeroClass } from '../game/heroes';
import { MAX_LEVEL, MAX_RANK, TREES, type LearnBlock, type TreeSkill, type TreeSkillId } from '../game/progression';

/** What the panel shows (the hero's browser fills it from the run's Leveling). */
export interface TreeView {
  hero: HeroClass;
  level: number;
  /** Way to the next level, 0..1. */
  progress: number;
  points: number;
  rank: (id: TreeSkillId) => number;
  block: (id: TreeSkillId) => LearnBlock | null;
  /** The merchant's respec: its price, and whether it can be done now (at the camp, with the gold). */
  respec: { cost: number; here: boolean; affordable: boolean; anySpent: boolean };
}

const ROMAN = ['I', 'II', 'III'];

/**
 * The skill tree (T, or the ⭐ button): the hero's three branches side by side, each skill with its
 * rank pips; a click spends a point. Locked skills say what they need; the details below show every
 * rank. At the merchant's camp the points can be reset for gold.
 */
export class SkillTreePanel {
  onLearn?: (id: TreeSkillId) => void;
  onRespec?: () => void;
  onClose?: () => void;
  private readonly el: HTMLElement;
  private view: TreeView | null = null;
  private focus: TreeSkillId | null = null;
  private key = '';

  constructor(root: HTMLElement) {
    root.insertAdjacentHTML('beforeend', '<div class="tree-panel" hidden></div>');
    this.el = root.querySelector<HTMLElement>('.tree-panel')!;
    // Clicks inside stay inside (they mustn't shoot or unpause).
    for (const type of ['pointerdown', 'pointerup', 'click', 'touchstart', 'touchend', 'mousedown'] as const)
      this.el.addEventListener(type, (e) => e.stopPropagation(), { passive: type.startsWith('touch') });
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-tree-close]')) {
        this.close();
        this.onClose?.();
        return;
      }
      if (t.closest('[data-respec]:not([disabled])')) {
        this.onRespec?.();
        return;
      }
      const node = t.closest<HTMLElement>('[data-skill]');
      if (!node) return;
      const id = node.dataset.skill as TreeSkillId;
      this.focus = id;
      if (this.view && !this.view.block(id)) this.onLearn?.(id);
      else this.render(true);
    });
    this.el.addEventListener('pointerover', (e) => {
      const node = (e.target as HTMLElement).closest<HTMLElement>('[data-skill]');
      if (!node || node.dataset.skill === this.focus) return;
      this.focus = node.dataset.skill as TreeSkillId;
      this.render(true);
    });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(): void {
    this.el.hidden = false;
    this.render(true);
  }

  close(): void {
    this.el.hidden = true;
  }

  update(view: TreeView): void {
    this.view = view;
    if (this.isOpen) this.render(false);
  }

  private render(force: boolean): void {
    const v = this.view;
    if (!v) return;
    const tree = TREES[v.hero];
    const key = JSON.stringify([v.hero, v.level, v.points, Math.round(v.progress * 100), this.focus, v.respec, tree?.flatMap((b) => b.skills.map((s) => v.rank(s.id)))]);
    if (!force && key === this.key) return;
    this.key = key;
    const hero = HEROES[v.hero];
    const head = `<div class="tree-head">
        <h2>⭐ Skill tree</h2>
        <span class="tree-who">${hero.icon} ${hero.name} · level ${v.level}${v.level >= MAX_LEVEL ? ' (max)' : ` · ${Math.round(v.progress * 100)}% to ${v.level + 1}`}</span>
        <span class="tree-points${v.points ? ' some' : ''}">${v.points} point${v.points === 1 ? '' : 's'} to spend</span>
        <button type="button" class="bag-close" data-tree-close title="Close (T / Esc)">✕</button>
      </div>`;
    if (!tree) {
      this.el.innerHTML = `${head}<p class="tree-soon">The ${hero.name}’s skill tree is coming soon. Your points are kept for it.</p>`;
      return;
    }
    const focus = tree.flatMap((b) => b.skills).find((s) => s.id === this.focus) ?? null;
    const columns = tree
      .map(
        (b) => `<div class="tree-branch" style="--branch:${b.color}">
          <h3>${b.name}</h3>
          ${b.skills.map((s, i) => `${i ? '<div class="tree-link"></div>' : ''}${this.nodeHtml(s, v)}`).join('')}
        </div>`,
      )
      .join('');
    const respec = v.respec.here
      ? `<button type="button" class="tree-respec" data-respec ${v.respec.affordable && v.respec.anySpent ? '' : 'disabled'}>↺ Reset points · ${v.respec.cost} 🪙</button>`
      : '<span class="tree-respec-note">Points can be reset at the merchant’s camp, for gold.</span>';
    this.el.innerHTML = `${head}<div class="tree-body">${columns}</div>${this.detailHtml(focus, v)}<div class="tree-foot">${respec}</div>`;
  }

  private nodeHtml(s: TreeSkill, v: TreeView): string {
    const rank = v.rank(s.id);
    const block = v.block(s.id);
    const state = rank >= MAX_RANK ? 'maxed' : block === 'locked' ? 'locked' : !block ? 'open' : rank ? 'learned' : 'idle';
    const pips = Array.from({ length: MAX_RANK }, (_, i) => `<i class="${i < rank ? 'on' : ''}"></i>`).join('');
    const kind = s.kind === 'passive' ? 'passive' : s.kind === 'upgrade' ? 'upgrade' : 'new skill';
    return `<button type="button" class="tree-node ${state}${rank ? ' has' : ''}${this.focus === s.id ? ' focus' : ''}" data-skill="${s.id}">
        <span class="tree-icon">${s.icon}</span>
        <span class="tree-name">${s.name}<small>${kind}</small></span>
        <span class="tree-pips">${pips}</span>
        ${state === 'open' ? '<span class="tree-plus">+</span>' : ''}
      </button>`;
  }

  private detailHtml(s: TreeSkill | null, v: TreeView): string {
    if (!s) return '<div class="tree-detail muted">Point at a skill to see what it does. Click to spend a point.</div>';
    const rank = v.rank(s.id);
    const block = v.block(s.id);
    const req = s.requires ? this.view && TREES[v.hero]!.flatMap((b) => b.skills).find((o) => o.id === s.requires!.id) : null;
    const why =
      block === 'locked' && req ? `🔒 Needs ${req.name} ${ROMAN[s.requires!.rank - 1]}`
      : block === 'no-points' && rank < MAX_RANK ? 'No points to spend — level up to earn one'
      : block === 'maxed' ? 'Mastered'
      : `Click to learn rank ${ROMAN[rank]}`;
    const lines = s.ranks.map((r, i) => `<li class="${i < rank ? 'have' : i === rank ? 'next' : ''}"><b>${ROMAN[i]}</b> ${r}</li>`).join('');
    return `<div class="tree-detail"><div class="tree-detail-head">${s.icon} <b>${s.name}</b> <span class="tree-why">${why}</span></div><ul>${lines}</ul></div>`;
  }
}
