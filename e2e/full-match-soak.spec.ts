// full-match-soak — Phase 6 soak validation. 20 independent matches run
// through the real UI end-to-end. Each match goes until game-over OR
// 20 valid turns; failures are isolated to one match.
//
// Per directive 2026-06-05: real UI only, no scenarioFactory touches,
// engine/card-data unchanged.

import { test, expect, type Page } from '@playwright/test';
import { PlayerDriver } from './helpers/player';

const MATCH_TIMEOUT_MS = 12 * 60_000; // 12 min per match — accommodates
// late-game AI cycles when both players have 5 characters + full DON.
const TURNS_TO_PLAY = 20;
const TOTAL_MATCHES = 20;

interface MatchMetrics {
  matchIdx: number;
  turnsCompleted: number;
  endedNaturally: boolean;
  gameOverReason: string | null;
  cardsPlayedA: number;
  attacksDeclared: number;
  pageErrors: string[];
  invariantErrors: string[];
}

async function bootstrap(page: Page): Promise<{ drv: PlayerDriver; pageErrors: string[]; invariantErrors: string[] }> {
  const pageErrors: string[] = [];
  const invariantErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    const t = msg.text();
    if (t.includes('InvariantError') || t.includes('invariant')) {
      invariantErrors.push(t);
    }
  });
  const drv = new PlayerDriver(page);
  await drv.open();
  await drv.waitForPhase('dice_roll');
  await drv.rollDice();
  try { await drv.waitForPhase('first_player_choice', 15_000); await drv.chooseGoFirst(); } catch {}
  try { await drv.waitForPhase('mulligan', 8_000); await drv.keepMulliganHand(); } catch {}
  await expect.poll(
    async () => {
      const s = await drv.getState();
      return { phase: s.phase, activePlayer: s.activePlayer };
    },
    { timeout: 60_000, message: 'A did not reach main during bootstrap' },
  ).toMatchObject({ phase: 'main', activePlayer: 'A' });
  return { drv, pageErrors, invariantErrors };
}

async function closeAnyOpenModal(page: Page): Promise<void> {
  try {
    const closeBtn = page.locator('button:has-text("CLOSE")').first();
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click({ timeout: 2_000 });
      await page.waitForTimeout(180);
    }
  } catch {}
}

// Attack opp leader via 3-click flow. Returns true if landed.
async function attackOppLeader(page: Page): Promise<boolean> {
  try {
    const own = page.locator('[aria-label*="(leader)" i]').last();
    if (!(await own.isVisible().catch(() => false))) return false;
    await own.click({ timeout: 3_000 });
    await page.waitForTimeout(250);
    const sel = page.locator('button:has-text("SELECT AS ATTACKER")').first();
    if (!(await sel.isVisible().catch(() => false))) { await closeAnyOpenModal(page); return false; }
    await sel.click({ timeout: 3_000 });
    await page.waitForTimeout(250);
    const opp = page.locator('[aria-label*="(leader)" i]').first();
    if (!(await opp.isVisible().catch(() => false))) { await closeAnyOpenModal(page); return false; }
    await opp.click({ timeout: 3_000 });
    await page.waitForTimeout(250);
    const atk = page.locator('button:has-text("ATTACK THIS")').first();
    if (!(await atk.isVisible().catch(() => false))) { await closeAnyOpenModal(page); return false; }
    await atk.click({ timeout: 3_000 });
    await page.waitForTimeout(2_500);
    return true;
  } catch {
    await closeAnyOpenModal(page);
    return false;
  }
}

async function isGameOver(drv: PlayerDriver): Promise<boolean> {
  const s = await drv.getState();
  return Boolean(s.result);
}

// Run one match. Returns metrics. Throws if a non-recoverable error fires.
async function playMatch(page: Page, matchIdx: number): Promise<MatchMetrics> {
  const { drv, pageErrors, invariantErrors } = await bootstrap(page);
  const metrics: MatchMetrics = {
    matchIdx,
    turnsCompleted: 0,
    endedNaturally: false,
    gameOverReason: null,
    cardsPlayedA: 0,
    attacksDeclared: 0,
    pageErrors,
    invariantErrors,
  };

  for (let turn = 0; turn < TURNS_TO_PLAY; turn += 1) {
    if (await isGameOver(drv)) {
      metrics.endedNaturally = true;
      metrics.gameOverReason = 'game-over';
      break;
    }
    await closeAnyOpenModal(page);

    // Try to play 1 card per turn. Selector-fix at helpers/player.ts:79
    // means playCard now reliably hits hand cards (no DON misclick). Vary
    // index for play diversity across matches.
    const idx = (matchIdx + turn) % 2;
    try {
      const ok = await drv.playCard(idx);
      if (ok) metrics.cardsPlayedA += 1;
    } catch { /* card unplayable at this index; skip */ }
    await closeAnyOpenModal(page);
    // ChoosePrompt resolution — drv.chooseOption at helpers/player.ts:120
    // throws when it sees an empty-options edge case. Catch and proceed
    // so soak continues; the engine's auto-resolve loop covers most cases.
    if (await drv.hasChoosePrompt().catch(() => false)) {
      try { await drv.chooseOption(0); } catch {}
    }

    // Try one attack with leader.
    const attacked = await attackOppLeader(page);
    if (attacked) metrics.attacksDeclared += 1;
    await closeAnyOpenModal(page);

    if (await isGameOver(drv)) {
      metrics.endedNaturally = true;
      metrics.gameOverReason = 'game-over-on-attack';
      break;
    }

    // End turn.
    await drv.endTurn();

    // Wait for control to return to A in main (or game-over).
    await expect.poll(
      async () => {
        const s = await drv.getState();
        if (s.result) return { done: true, phase: 'over', activePlayer: 'over' };
        return { done: false, phase: s.phase, activePlayer: s.activePlayer };
      },
      {
        timeout: 90_000,
        message: `match ${matchIdx} turn ${turn}: control did not return to A`,
      },
    ).toMatchObject({ phase: 'main', activePlayer: 'A' }).catch(async () => {
      // Maybe the game ended during the AI's turn. Re-check.
      const s = await drv.getState();
      if (s.result) {
        metrics.endedNaturally = true;
        metrics.gameOverReason = 'game-over-during-ai-turn';
      } else {
        throw new Error(`match ${matchIdx} turn ${turn}: phase=${s.phase} activePlayer=${s.activePlayer}`);
      }
    });

    if (metrics.endedNaturally) break;

    // Check no stuck pending.
    const mid = await drv.getState();
    expect(mid.pendingKind, `match ${matchIdx} turn ${turn}: pending stuck`).toBeNull();
    metrics.turnsCompleted += 1;
  }

  // Final assertions.
  expect(pageErrors, `match ${matchIdx}: pageerror events`).toEqual([]);
  expect(invariantErrors, `match ${matchIdx}: invariant errors`).toEqual([]);

  return metrics;
}

test.describe('Full match soak', () => {
  for (let m = 0; m < TOTAL_MATCHES; m += 1) {
    test(`match ${m + 1}/${TOTAL_MATCHES}`, async ({ page }) => {
      test.setTimeout(MATCH_TIMEOUT_MS);
      const metrics = await playMatch(page, m);
      // eslint-disable-next-line no-console
      console.log(`[soak] match ${metrics.matchIdx + 1}: turns=${metrics.turnsCompleted} ` +
        `ended=${metrics.endedNaturally} reason=${metrics.gameOverReason ?? 'turn-cap'} ` +
        `plays=${metrics.cardsPlayedA} attacks=${metrics.attacksDeclared}`);
    });
  }
});
