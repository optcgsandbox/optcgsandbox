/**
 * Per-card coverage tracker for the simulation layer.
 *
 * Tracks each cardId across coverage axes (seenInDeck, seenDrawn,
 * seenPlayed, seenResolved, clauseFired). Persists to disk between
 * batches so multi-batch sessions resume.
 *
 * Pure observation — never mutates engine-v2 state or cards.json.
 */

// @ts-expect-error Node built-ins resolve at runtime
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime
import { dirname, resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime
import { fileURLToPath } from 'node:url';

import type { GameState } from '../engine-v2/state/types.js';

export interface CoverageAxes {
  seenInDeck: boolean;
  seenInGame: boolean; // card existed in either deck OR was either leader in at least one game
  seenDrawn: boolean;
  seenPlayed: boolean;
  seenResolved: boolean;
  clauseFired: number[]; // clause indices that have fired at least once
}

export interface CoverageSnapshot {
  byCard: Record<string, CoverageAxes>;
  meta: {
    runsContributing: number;
    lastSavedAt: number;
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');
const COVERAGE_PATH = resolve(__dirname, '.coverage.json');

function emptyAxes(): CoverageAxes {
  return {
    seenInDeck: false,
    seenInGame: false,
    seenDrawn: false,
    seenPlayed: false,
    seenResolved: false,
    clauseFired: [],
  };
}

export class CoverageTracker {
  private byCard = new Map<string, CoverageAxes>();
  private kindByCard = new Map<string, string>();
  private runsContributing = 0;
  private readonly allCardIds: ReadonlyArray<string>;

  /**
   * `allCards` is the corpus (id + kind). Kind is needed for the kind-aware
   * coverage criterion (leaders covered via seenInGame; others require
   * gameplay participation).
   */
  constructor(allCards: ReadonlyArray<{ readonly id: string; readonly kind: string }>) {
    this.allCardIds = allCards.map((c) => c.id);
    for (const c of allCards) {
      this.byCard.set(c.id, emptyAxes());
      this.kindByCard.set(c.id, c.kind);
    }
  }

  /** Hydrate from disk (no-op if file missing). */
  loadFromDisk(): void {
    if (!existsSync(COVERAGE_PATH)) return;
    try {
      const raw = readFileSync(COVERAGE_PATH, 'utf-8');
      const snap = JSON.parse(raw) as CoverageSnapshot;
      for (const [cardId, axes] of Object.entries(snap.byCard)) {
        if (this.byCard.has(cardId)) this.byCard.set(cardId, { ...axes });
      }
      this.runsContributing = snap.meta?.runsContributing ?? 0;
    } catch {
      // Corrupt file — start fresh.
    }
  }

  saveToDisk(): void {
    const dir = dirname(COVERAGE_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const snap: CoverageSnapshot = {
      byCard: Object.fromEntries(this.byCard.entries()),
      meta: { runsContributing: this.runsContributing, lastSavedAt: Date.now() },
    };
    writeFileSync(COVERAGE_PATH, JSON.stringify(snap, null, 2));
  }

  markCardSeen(cardId: string, axis: keyof Omit<CoverageAxes, 'clauseFired'>): void {
    const axes = this.byCard.get(cardId);
    if (axes === undefined) return;
    axes[axis] = true;
  }

  markClauseFired(cardId: string, clauseIndex: number): void {
    const axes = this.byCard.get(cardId);
    if (axes === undefined) return;
    if (!axes.clauseFired.includes(clauseIndex)) axes.clauseFired.push(clauseIndex);
  }

  /** Mark every card in `deck` (cardIds) as seen-in-deck + seen-in-game. */
  markDeck(cardIds: ReadonlyArray<string>): void {
    for (const id of cardIds) {
      this.markCardSeen(id, 'seenInDeck');
      this.markCardSeen(id, 'seenInGame');
    }
  }

  /** Mark a card as participating in a game (independent of clause events). */
  markGameParticipation(cardId: string): void {
    this.markCardSeen(cardId, 'seenInGame');
  }

  /**
   * Update coverage by diffing two consecutive game states. Catches drawn
   * (deck → hand), played (hand → field/trash/stage), resolved (history
   * CLAUSE_FIRED events).
   */
  updateFromTransition(prev: GameState, next: GameState): void {
    for (const side of ['A', 'B'] as const) {
      const prevPl = prev.players[side];
      const nextPl = next.players[side];

      // Drawn = appears in next.hand but not prev.hand
      const prevHandSet = new Set(prevPl.hand);
      for (const id of nextPl.hand) {
        if (!prevHandSet.has(id)) {
          const inst = next.instances[id];
          if (inst !== undefined) this.markCardSeen(inst.cardId, 'seenDrawn');
        }
      }

      // Played = on field/stage now but not before
      const prevFieldSet = new Set([...prevPl.field.map((c) => c.instanceId), prevPl.stage?.instanceId].filter(Boolean));
      const nextFieldList = [...nextPl.field, ...(nextPl.stage ? [nextPl.stage] : [])];
      for (const inst of nextFieldList) {
        if (!prevFieldSet.has(inst.instanceId)) {
          const ref = next.instances[inst.instanceId];
          if (ref !== undefined) this.markCardSeen(ref.cardId, 'seenPlayed');
        }
      }

      // Played event: appears in trash now but was in hand before and is an event
      const prevTrashSet = new Set(prevPl.trash);
      for (const id of nextPl.trash) {
        if (!prevTrashSet.has(id) && prevHandSet.has(id)) {
          const inst = next.instances[id];
          if (inst === undefined) continue;
          const card = next.cardLibrary[inst.cardId];
          if (card !== undefined && (card as { kind?: string }).kind === 'event') {
            this.markCardSeen(inst.cardId, 'seenPlayed');
            this.markCardSeen(inst.cardId, 'seenResolved');
          }
        }
      }
    }

    // Clause-fired: scan new history events
    const newEvents = next.history.slice(prev.history.length);
    for (const evt of newEvents) {
      const e = evt as { type?: string; sourceInstanceId?: string; clauseIndex?: number };
      if (e.type === 'CLAUSE_FIRED' && typeof e.sourceInstanceId === 'string') {
        const inst = next.instances[e.sourceInstanceId];
        if (inst !== undefined) {
          this.markCardSeen(inst.cardId, 'seenResolved');
          if (typeof e.clauseIndex === 'number') this.markClauseFired(inst.cardId, e.clauseIndex);
        }
      }
    }
  }

  /**
   * Coverage criterion (kind-aware):
   *   leader: seenInGame (participation as either side's leader)
   *   non-leader: seenDrawn || seenPlayed || seenResolved (gameplay participation)
   * Returns cards whose criterion is NOT met, ordered by priority
   * (fewest axes covered ascending).
   */
  getUncoveredCards(limit?: number): string[] {
    const items: { cardId: string; score: number }[] = [];
    for (const [cardId, axes] of this.byCard.entries()) {
      if (this.isCovered(cardId)) continue;
      const score = (axes.seenInDeck ? 1 : 0) + (axes.seenInGame ? 1 : 0);
      items.push({ cardId, score });
    }
    items.sort((a, b) => a.score - b.score || a.cardId.localeCompare(b.cardId));
    const ids = items.map((i) => i.cardId);
    return limit !== undefined ? ids.slice(0, limit) : ids;
  }

  isCovered(cardId: string): boolean {
    const a = this.byCard.get(cardId);
    if (a === undefined) return false;
    if (a.seenDrawn || a.seenPlayed || a.seenResolved) return true;
    // Leaders count as covered if they participated in any game.
    if (this.kindByCard.get(cardId) === 'leader' && a.seenInGame) return true;
    return false;
  }

  totalCards(): number {
    return this.allCardIds.length;
  }

  coveredCount(): number {
    let n = 0;
    for (const cardId of this.allCardIds) if (this.isCovered(cardId)) n += 1;
    return n;
  }

  coveragePercent(): number {
    return this.totalCards() === 0 ? 100 : (this.coveredCount() / this.totalCards()) * 100;
  }

  incrementRunCounter(): void {
    this.runsContributing += 1;
  }

  axesFor(cardId: string): CoverageAxes | undefined {
    return this.byCard.get(cardId);
  }
}
