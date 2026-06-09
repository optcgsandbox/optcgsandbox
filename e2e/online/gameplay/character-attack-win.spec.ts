/**
 * F-7k BUG-006 — Online character attack + 0-life win via the browser.
 *
 * Drives 5 A-leader attacks on B's leader through the live lobby until
 * B's life is exhausted and the engine sets `state.result.loser = 'B'`.
 * Both browser tabs must show `loser=B` after the lethal attack.
 *
 * Per the task spec: "Do not skip 0-life win by using CONCEDE."
 *
 * This is the lobby companion to the deterministic vitest at
 * `shared/server/__tests__/characterAttackWin.online.test.ts` which pins
 * the engine-side scenarios (character KO, 0-life result, post-result
 * rejection, projection parity).
 *
 * Browser flow per cycle (until match-over or maxCycles exhausted):
 *   1. A turn: assert A active, DECLARE_ATTACK legal, click first attack.
 *   2. block_window: B click SKIP_BLOCKER.
 *   3. If counter_window opens: B click SKIP_COUNTER.
 *   4. If trigger_window opens: B click first RESOLVE_TRIGGER button (any variant).
 *   5. If `online-match-result` shows `loser=B` → break and assert both tabs agree.
 *   6. Otherwise A click END_TURN → B click END_TURN → loop.
 *
 * Prereqs:
 *   - ONLINE_E2E=1
 *   - wrangler dev --port 8801 --local --var DEV_AUTH:1 --var ENV:dev
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';

const ONLINE_E2E = process.env.ONLINE_E2E === '1';
const WORKER_ORIGIN = process.env.WORKER_ORIGIN ?? 'http://localhost:8801';

test.use({
  launchOptions: { args: ['--disable-web-security'] },
});

test.describe.configure({ mode: 'serial' });

test.describe('Online character attack + 0-life win (BUG-006)', () => {
  test.beforeEach(({}, testInfo) => {
    if (!ONLINE_E2E) testInfo.skip(true, 'ONLINE_E2E=1 not set');
  });

  test('A drives 5 leader attacks on B; final attack flips last life; result.loser=B on BOTH tabs', async ({
    browser,
  }) => {
    test.setTimeout(180_000);

    const ctxA: BrowserContext = await browser.newContext();
    const ctxB: BrowserContext = await browser.newContext();
    const initScript = `window.__WORKER_ORIGIN__ = ${JSON.stringify(WORKER_ORIGIN)};`;
    await ctxA.addInitScript(initScript);
    await ctxB.addInitScript(initScript);
    const pageA: Page = await ctxA.newPage();
    const pageB: Page = await ctxB.newPage();

    try {
      await pageA.goto('/?online=1&test=1');
      await pageB.goto('/?online=1&test=1');
      const sessionA = `e2e-win-a-${Date.now()}`;
      const sessionB = `e2e-win-b-${Date.now()}`;
      await pageA.getByTestId('online-session-id').fill(sessionA);
      await pageA.getByTestId('online-color-select').selectOption('red');
      await pageB.getByTestId('online-session-id').fill(sessionB);
      await pageB.getByTestId('online-color-select').selectOption('blue');
      await pageA.getByTestId('online-find-match').click();
      await pageB.getByTestId('online-find-match').click();
      await expect(pageA.getByTestId('online-phase')).toHaveText('connected', {
        timeout: 15_000,
      });

      // Pre-game ETs to reach A turn 2 (game turn 3 — first time A can attack).
      await clickAndWait(pageA, 'END_TURN', async () => {
        await expect(pageB.getByTestId('online-active-player')).toHaveText('B', {
          timeout: 5_000,
        });
      });
      await clickAndWait(pageB, 'END_TURN', async () => {
        await expect(pageA.getByTestId('online-active-player')).toHaveText('A', {
          timeout: 5_000,
        });
      });

      let matchOver = false;
      let attacksLanded = 0;
      const maxCycles = 6; // 5 life cards + safety

      for (let cycle = 0; cycle < maxCycles && !matchOver; cycle += 1) {
        // Make sure A is active for this cycle.
        await expect(pageA.getByTestId('online-active-player')).toHaveText('A', {
          timeout: 8_000,
        });
        const aActions = await dumpActions(pageA, `A turn (cycle ${cycle})`);
        const attackIdx = await findActionByType(pageA, 'DECLARE_ATTACK');
        if (attackIdx < 0) {
          throw new Error(
            `Cycle ${cycle}: A has no DECLARE_ATTACK in legalActions (${aActions.join(',')})`,
          );
        }

        // A DECLARE_ATTACK — wait for phase=block_window confirmation.
        await pageA.getByTestId(`online-action-${attackIdx}`).click();
        await expect(pageA.getByTestId('online-board-phase')).toHaveText(
          'block_window',
          { timeout: 15_000 },
        );

        // B SKIP_BLOCKER — wait for phase transition out of block_window.
        await clickAndWait(pageB, 'SKIP_BLOCKER', async () => {
          await expect(pageA.getByTestId('online-board-phase')).not.toHaveText(
            'block_window',
            { timeout: 15_000 },
          );
        });

        // counter_window if opened.
        const phaseAfterBlock = await pageA
          .getByTestId('online-board-phase')
          .textContent();
        if (phaseAfterBlock === 'counter_window') {
          await clickAndWait(pageB, 'SKIP_COUNTER', async () => {
            await expect(pageA.getByTestId('online-board-phase')).not.toHaveText(
              'counter_window',
              { timeout: 15_000 },
            );
          });
        }

        // trigger_window if opened — B click first RESOLVE_TRIGGER (decline
        // is fine; activate would also resolve back to main).
        await pageA.waitForTimeout(400);
        const phaseAfterCounter = await pageA
          .getByTestId('online-board-phase')
          .textContent();
        if (phaseAfterCounter === 'trigger_window') {
          const trigIdx = await findActionByType(pageB, 'RESOLVE_TRIGGER');
          if (trigIdx < 0) {
            throw new Error(
              'trigger_window open but no RESOLVE_TRIGGER button on B',
            );
          }
          await pageB.getByTestId(`online-action-${trigIdx}`).click();
          await expect(pageA.getByTestId('online-board-phase')).not.toHaveText(
            'trigger_window',
            { timeout: 15_000 },
          );
        }

        attacksLanded += 1;
        console.log(
          `Cycle ${cycle}: attack landed. Phase=${await pageA.getByTestId('online-board-phase').textContent()}`,
        );

        // Check match result.
        const aResult = await pageA.getByTestId('online-match-result').textContent();
        const bResult = await pageB.getByTestId('online-match-result').textContent();
        console.log(`  A result text: ${aResult}`);
        console.log(`  B result text: ${bResult}`);
        if (aResult && aResult.includes('loser=B')) {
          console.log(`*** Cycle ${cycle}: 0-life win condition reached ***`);
          matchOver = true;
          // BOTH tabs must agree.
          expect(bResult ?? '').toContain('loser=B');
          break;
        }

        // Not over yet — A end turn, B end turn, repeat. Note: `enterEnd`
        // applies the hand-size limit BEFORE flipping activePlayer (per
        // `shared/engine-v2/phases/PhaseScheduler.ts:331-348`). If the
        // current player has >10 hand at end-of-turn, the engine suspends
        // on phase=discard_choice + pending.discard. We drain the discard
        // window via RESOLVE_DISCARD clicks before expecting the turn flip.
        await endTurnAndDrainDiscards(pageA, pageB);
        await endTurnAndDrainDiscards(pageB, pageA);
      }

      console.log(`Final: attacksLanded=${attacksLanded}, matchOver=${matchOver}`);

      // The win MUST be reached within maxCycles. With B starting at 5
      // life + one attack per cycle (no blockers since A only has leader
      // and no DON to play blockers anyway, no counters from B since we
      // SKIP_COUNTER), the win SHOULD happen by cycle 4 (5 attacks).
      // Allow up to 6 cycles for any trigger-induced extra resolution.
      expect(matchOver).toBe(true);

      // Final assertion — BOTH tabs see loser=B with reason=life_zero.
      const aFinal = await pageA.getByTestId('online-match-result').textContent();
      const bFinal = await pageB.getByTestId('online-match-result').textContent();
      expect(aFinal ?? '').toContain('loser=B');
      expect(bFinal ?? '').toContain('loser=B');
      expect(aFinal ?? '').toContain('life_zero');
      expect(bFinal ?? '').toContain('life_zero');
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});

async function dumpActions(page: Page, label: string): Promise<string[]> {
  await page.waitForTimeout(250);
  const types = await page.evaluate(() => {
    const buttons = Array.from(
      document.querySelectorAll('[data-testid^="online-action-"]'),
    ) as HTMLButtonElement[];
    return buttons.map((b) => b.getAttribute('data-action-type') ?? '?');
  });
  console.log(`[${label}] action types:`, types.join(', '));
  return types;
}

async function findActionByType(page: Page, type: string): Promise<number> {
  return page.evaluate((t) => {
    const buttons = Array.from(
      document.querySelectorAll('[data-testid^="online-action-"]'),
    ) as HTMLButtonElement[];
    for (let i = 0; i < buttons.length; i++) {
      if (buttons[i]!.getAttribute('data-action-type') === t) return i;
    }
    return -1;
  }, type);
}

/**
 * Click a typed action button and wait for an observable post-condition.
 * Avoids relying on `online-last-action` text which can be stale from a
 * previous click on the same page.
 */
async function clickAndWait(
  page: Page,
  type: string,
  waitForChange: () => Promise<void>,
): Promise<void> {
  const idx = await findActionByType(page, type);
  if (idx < 0) throw new Error(`legalAction "${type}" not found on page`);
  await page.getByTestId(`online-action-${idx}`).click();
  await waitForChange();
}

/**
 * Click END_TURN on `actorPage`, then drain any discard_choice window
 * that opens on the same actor (hand > 10 per CR §6-5-7 — implemented at
 * `shared/engine-v2/phases/PhaseScheduler.ts:331-348`). After the
 * discard window resolves, wait for the activePlayer to flip on
 * `otherPage`.
 *
 * Both `actorPage` (the player ending turn) and `otherPage` (the
 * about-to-be-active player) views of `online-active-player` should
 * agree once the engine completes the turn handoff.
 */
async function endTurnAndDrainDiscards(
  actorPage: Page,
  otherPage: Page,
): Promise<void> {
  // Determine who is currently the active player (the one ending turn).
  const activeBefore = await actorPage
    .getByTestId('online-active-player')
    .textContent();

  // Click END_TURN.
  const endIdx = await findActionByType(actorPage, 'END_TURN');
  if (endIdx < 0) {
    throw new Error('END_TURN not in legalActions on actor page');
  }
  await actorPage.getByTestId(`online-action-${endIdx}`).click();

  // Engine may suspend on discard_choice if actor's hand > 10. Drain.
  for (let i = 0; i < 20; i += 1) {
    await actorPage.waitForTimeout(250);
    const phase = await actorPage
      .getByTestId('online-board-phase')
      .textContent();
    if (phase !== 'discard_choice') break;
    const discardIdx = await findActionByType(actorPage, 'RESOLVE_DISCARD');
    if (discardIdx < 0) {
      throw new Error(
        'discard_choice open but no RESOLVE_DISCARD button on actor page',
      );
    }
    await actorPage.getByTestId(`online-action-${discardIdx}`).click();
  }

  // After drain, the active player must have flipped on the OTHER page.
  const expectedNext = activeBefore === 'A' ? 'B' : 'A';
  await expect(otherPage.getByTestId('online-active-player')).toHaveText(
    expectedNext,
    { timeout: 15_000 },
  );
}
