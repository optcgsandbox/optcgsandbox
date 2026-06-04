/**
 * Phase 7 — playabilityTracker determinism + observer-correctness tests.
 * Always-on (small sample so it's cheap), plus an env-gated T1 driver
 * with the same MECH_FREQ-style gating used in items 3-5.
 */

import { describe, expect, it } from 'vitest';

import { runGame } from '../runner.js';
import { loadAllCards } from '../stateInit.js';
import { computeCardMeta } from '../cardMeta.js';
import {
  PlayabilityTracker,
  serializePlayabilityReport,
} from '../playabilityTracker.js';
import { runPlayability } from '../cli-playability.js';

const SEED_BASE = 7;
const GAMES = 8;

function smallBatch(): ReturnType<PlayabilityTracker['report']> {
  const allCards = loadAllCards();
  const cardMeta = computeCardMeta(allCards);
  const tracker = new PlayabilityTracker();
  for (let i = 0; i < GAMES; i++) {
    const r = runGame(SEED_BASE + i, null, null, allCards, {
      adversarial: true,
      cardMeta,
    });
    tracker.observe(r);
  }
  return tracker.report({ seedBase: SEED_BASE, adversarial: true });
}

describe('PlayabilityTracker', () => {
  it('produces byte-identical JSON across two identically-seeded runs', () => {
    const a = serializePlayabilityReport(smallBatch());
    const b = serializePlayabilityReport(smallBatch());
    expect(a).toBe(b);
  });

  it('totalGames matches observed count and all turn/ticks values are non-negative', () => {
    const r = smallBatch();
    expect(r.totalGames).toBe(GAMES);
    expect(r.turn.count).toBe(GAMES);
    expect(r.turn.min).toBeGreaterThanOrEqual(0);
    expect(r.turn.max).toBeGreaterThanOrEqual(r.turn.min);
    expect(r.ticks.min).toBeGreaterThanOrEqual(0);
    expect(r.ticks.max).toBeGreaterThanOrEqual(r.ticks.min);
  });

  it('terminal categories sum to totalGames', () => {
    const r = smallBatch();
    const sum = r.terminalCategories.completed +
                r.terminalCategories.failed +
                r.terminalCategories.timeout;
    expect(sum).toBe(GAMES);
  });

  it('winnerSide A + B + none sums to totalGames', () => {
    const r = smallBatch();
    expect(r.winnerSide.A + r.winnerSide.B + r.winnerSide.none).toBe(GAMES);
  });

  it('reset clears all aggregates', () => {
    const tracker = new PlayabilityTracker();
    const allCards = loadAllCards();
    const cardMeta = computeCardMeta(allCards);
    tracker.observe(runGame(SEED_BASE, null, null, allCards, { adversarial: true, cardMeta }));
    expect(tracker.report({ seedBase: SEED_BASE, adversarial: true }).totalGames).toBe(1);
    tracker.reset();
    expect(tracker.report({ seedBase: SEED_BASE, adversarial: true }).totalGames).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────
// Env-gated T1 driver (1000 games). Invoke via:
//   PLAYABILITY_GAMES=1000 PLAYABILITY_SEED=0 npx vitest run shared/simulation/__tests__/playabilityTracker.test.ts
// Default skip keeps the normal test suite fast.
// ──────────────────────────────────────────────────────────────────

const enabledT1 = process.env['PLAYABILITY_GAMES'] !== undefined;
const t1Games = parseInt(process.env['PLAYABILITY_GAMES'] ?? '0', 10);
const t1SeedBase = parseInt(process.env['PLAYABILITY_SEED'] ?? '0', 10);
const t1Adv = process.env['PLAYABILITY_ADV'] !== 'false';

describe.runIf(enabledT1)('playability T1 driver (env-gated)', () => {
  it(
    `T1: ${t1Games} games adv=${t1Adv} seedBase=${t1SeedBase}`,
    () => {
      const out = runPlayability({ games: t1Games, seedBase: t1SeedBase, adversarial: t1Adv });
      expect(out.report.totalGames).toBe(t1Games);
      expect(out.jsonPath).toMatch(/playability-\d+\.json$/);
      expect(out.markdownPath).toMatch(/playability-\d+\.md$/);
    },
    /* timeout */ 10 * 60 * 1000,
  );
});
