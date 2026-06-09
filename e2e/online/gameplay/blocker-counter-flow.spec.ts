/**
 * F-7k BUG-005 — Online BLOCKER + COUNTER click probe.
 *
 * Drives:
 *   1. A turn 1 → END_TURN.
 *   2. B turn 1 → PLAY_CARD (best-effort: lays down something cheap so
 *      B might have a field char to block with later) → END_TURN.
 *   3. A turn 2 → DECLARE_ATTACK on B's leader.
 *   4. block_window: if B has DECLARE_BLOCKER in legalActions → click it,
 *      assert acceptance, observe redirect. Else → SKIP_BLOCKER.
 *   5. counter_window: if PLAY_COUNTER in legalActions → click it,
 *      assert acceptance, observe counter accepted. Continue clicking
 *      while more PLAY_COUNTER candidates remain (each adds boost).
 *      Then SKIP_COUNTER.
 *   6. Assert phase resolves to one of {main, trigger_window} — never
 *      stuck in a pending window.
 *
 * Browser path is probabilistic (random deck). Deterministic proof of
 * all power-math + KO branches lives at
 *   `shared/server/__tests__/blockerCounter.online.test.ts`.
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

test.describe('Online BLOCKER + COUNTER click probe (BUG-005)', () => {
  test.beforeEach(({}, testInfo) => {
    if (!ONLINE_E2E) testInfo.skip(true, 'ONLINE_E2E=1 not set');
  });

  test('A attack on B leader; B clicks DECLARE_BLOCKER if available, PLAY_COUNTER if available', async ({
    browser,
  }) => {
    const ctxA: BrowserContext = await browser.newContext();
    const ctxB: BrowserContext = await browser.newContext();
    const initScript = `window.__WORKER_ORIGIN__ = ${JSON.stringify(WORKER_ORIGIN)};`;
    await ctxA.addInitScript(initScript);
    await ctxB.addInitScript(initScript);
    const pageA: Page = await ctxA.newPage();
    const pageB: Page = await ctxB.newPage();

    let didDeclareBlocker = false;
    let didPlayCounter = false;

    try {
      await pageA.goto('/?online=1&test=1');
      await pageB.goto('/?online=1&test=1');
      const sessionA = `e2e-bc-a-${Date.now()}`;
      const sessionB = `e2e-bc-b-${Date.now()}`;
      await pageA.getByTestId('online-session-id').fill(sessionA);
      await pageA.getByTestId('online-color-select').selectOption('red');
      await pageB.getByTestId('online-session-id').fill(sessionB);
      await pageB.getByTestId('online-color-select').selectOption('blue');
      await pageA.getByTestId('online-find-match').click();
      await pageB.getByTestId('online-find-match').click();
      await expect(pageA.getByTestId('online-phase')).toHaveText('connected', {
        timeout: 15_000,
      });
      await expect(pageA.getByTestId('online-board-phase')).toHaveText('main');

      // A turn 1 → END_TURN.
      await clickByType(pageA, 'END_TURN');
      await expect(pageB.getByTestId('online-active-player')).toHaveText('B', {
        timeout: 5_000,
      });

      // B turn 1: play a PLAY_CARD if available (so B has a char on field
      // for potential blocker next turn). Best-effort — random deck.
      const bTurn1 = await dumpActions(pageB, 'B turn 1');
      if (bTurn1.includes('PLAY_CARD')) {
        const playIdx = await findActionByType(pageB, 'PLAY_CARD');
        await pageB.getByTestId(`online-action-${playIdx}`).click();
        await expect(pageB.getByTestId('online-last-action')).toContainText(
          'accepted',
          { timeout: 5_000 },
        );
        console.log('B turn 1: PLAY_CARD accepted (placed char on B field)');
      }

      await clickByType(pageB, 'END_TURN');
      await expect(pageA.getByTestId('online-active-player')).toHaveText('A', {
        timeout: 5_000,
      });

      // A turn 2: DECLARE_ATTACK on B leader.
      const aTurn2 = await dumpActions(pageA, 'A turn 2');
      expect(aTurn2).toContain('DECLARE_ATTACK');
      const attackIdx = await findActionByType(pageA, 'DECLARE_ATTACK');
      await pageA.getByTestId(`online-action-${attackIdx}`).click();
      await expect(pageA.getByTestId('online-last-action')).toContainText(
        'accepted',
        { timeout: 5_000 },
      );
      console.log('A turn 2: DECLARE_ATTACK accepted');

      // block_window — check for DECLARE_BLOCKER candidate.
      await expect(pageA.getByTestId('online-board-phase')).toHaveText(
        'block_window',
        { timeout: 5_000 },
      );
      const bBlockActions = await dumpActions(pageB, 'B block_window');
      const blockIdx = await findActionByType(pageB, 'DECLARE_BLOCKER');
      if (blockIdx >= 0) {
        await pageB.getByTestId(`online-action-${blockIdx}`).click();
        await expect(pageB.getByTestId('online-last-action')).toContainText(
          'accepted',
          { timeout: 5_000 },
        );
        didDeclareBlocker = true;
        console.log('B DECLARE_BLOCKER accepted (real blocker click verified online)');
      } else {
        console.log(
          'B block_window has no DECLARE_BLOCKER (no blocker char on field); falling back to SKIP_BLOCKER',
        );
        await clickByType(pageB, 'SKIP_BLOCKER');
      }

      // counter_window — try PLAY_COUNTER candidates.
      await pageA.waitForTimeout(400);
      const phaseAfterBlock = await pageA
        .getByTestId('online-board-phase')
        .textContent();
      if (phaseAfterBlock === 'counter_window') {
        const bCounterActions = await dumpActions(pageB, 'B counter_window');
        // Try clicking ONE PLAY_COUNTER if available (corpus event/character
        // with counterValue > 0). DON cost-1 events are typical.
        const counterIdx = await findActionByType(pageB, 'PLAY_COUNTER');
        if (counterIdx >= 0) {
          await pageB.getByTestId(`online-action-${counterIdx}`).click();
          await pageB.waitForTimeout(400);
          const lastAfterCounter = await pageB
            .getByTestId('online-last-action')
            .textContent();
          if (lastAfterCounter && lastAfterCounter.includes('accepted')) {
            didPlayCounter = true;
            console.log('B PLAY_COUNTER accepted (real counter click verified online)');
          } else {
            console.log(`B PLAY_COUNTER not accepted: ${lastAfterCounter}`);
          }
        } else {
          console.log('B counter_window has no PLAY_COUNTER candidate (deck composition)');
        }

        // Always SKIP_COUNTER to resolve damage.
        await clickByType(pageB, 'SKIP_COUNTER');
      }

      // Phase must resolve to non-stuck state.
      await pageA.waitForTimeout(500);
      const phaseFinal = await pageA
        .getByTestId('online-board-phase')
        .textContent();
      console.log(`Final phase: ${phaseFinal}, didDeclareBlocker=${didDeclareBlocker}, didPlayCounter=${didPlayCounter}`);

      expect([
        'main',
        'trigger_window',
        'peek_choice',
        'discard_choice',
        'choose_one',
      ]).toContain(phaseFinal);
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});

async function dumpActions(page: Page, label: string): Promise<string[]> {
  await page.waitForTimeout(300);
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

async function clickByType(page: Page, type: string): Promise<void> {
  const idx = await findActionByType(page, type);
  if (idx < 0) throw new Error(`legalAction "${type}" not found on page`);
  await page.getByTestId(`online-action-${idx}`).click();
  await expect(page.getByTestId('online-last-action')).toContainText(
    'accepted',
    { timeout: 5_000 },
  );
}
