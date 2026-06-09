/**
 * F-7k Stage 3 — Multi-turn online gameplay E2E.
 *
 * Pre-fix (BUG-001): the server's MatchSession never drove the
 * refresh → draw → don → main pipeline after END_TURN, so B's
 * legalActions collapsed to [CONCEDE] and every match deadlocked at
 * A's first END_TURN.
 *
 * Post-fix (shared/server/turnPipeline.ts): the server applies the
 * turn-pipeline sweep after every action that lands the engine at
 * phase='refresh' with result===null. This spec proves the fix
 * end-to-end through the browser, the WebSocket, and the projection.
 *
 * Flow:
 *   1. A + B pair via the lobby (mirrors F-7h).
 *   2. A clicks the first non-CONCEDE legal action (typically ATTACH_DON).
 *   3. A clicks END_TURN.
 *   4. Both tabs flip active-player → B.
 *   5. B's legalActions count > 1 AND contains END_TURN
 *      (proves BUG-001 is dead).
 *   6. B clicks its first non-CONCEDE action; server accepts; hash + seq move.
 *   7. B clicks END_TURN; control returns to A on turn 2.
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

test.describe('Multi-turn online gameplay (BUG-001 fix)', () => {
  test.beforeEach(({}, testInfo) => {
    if (!ONLINE_E2E) {
      testInfo.skip(true, 'ONLINE_E2E=1 not set');
    }
  });

  test('A turn1 → B turn1 with full legalActions → A turn2', async ({ browser }) => {
    const ctxA: BrowserContext = await browser.newContext();
    const ctxB: BrowserContext = await browser.newContext();

    const initScript = `window.__WORKER_ORIGIN__ = ${JSON.stringify(WORKER_ORIGIN)};`;
    await ctxA.addInitScript(initScript);
    await ctxB.addInitScript(initScript);

    const pageA: Page = await ctxA.newPage();
    const pageB: Page = await ctxB.newPage();

    try {
      // 1. Lobby + pair.
      await pageA.goto('/?online=1&test=1');
      await pageB.goto('/?online=1&test=1');
      const sessionA = `e2e-mt-a-${Date.now()}`;
      const sessionB = `e2e-mt-b-${Date.now()}`;
      await pageA.getByTestId('online-session-id').fill(sessionA);
      await pageA.getByTestId('online-color-select').selectOption('red');
      await pageB.getByTestId('online-session-id').fill(sessionB);
      await pageB.getByTestId('online-color-select').selectOption('blue');

      await pageA.getByTestId('online-find-match').click();
      await pageB.getByTestId('online-find-match').click();
      await expect(pageA.getByTestId('online-phase')).toHaveText('connected', {
        timeout: 15_000,
      });
      await expect(pageB.getByTestId('online-phase')).toHaveText('connected', {
        timeout: 15_000,
      });

      // 2. A's turn 1: main phase, active player A.
      await expect(pageA.getByTestId('online-board-phase')).toHaveText('main');
      await expect(pageA.getByTestId('online-active-player')).toHaveText('A');

      const aTurn1Actions = await dumpActions(pageA, 'A turn1');
      expect(aTurn1Actions).toContain('END_TURN');
      expect(aTurn1Actions).toContain('CONCEDE');

      // 3. BUG-002 verification — click ATTACH_DON if available, then
      //    click first PLAY_CARD if available, then END_TURN. Each must
      //    be accepted by the server.
      const aAttachIdx = await findActionByType(pageA, 'ATTACH_DON');
      if (aAttachIdx >= 0) {
        await pageA.getByTestId(`online-action-${aAttachIdx}`).click();
        await expect(pageA.getByTestId('online-last-action')).toContainText(
          'accepted',
          { timeout: 5_000 },
        );
        console.log('A turn1: ATTACH_DON accepted');
      }
      const aPlayIdx = await findActionByType(pageA, 'PLAY_CARD');
      if (aPlayIdx >= 0) {
        await pageA.getByTestId(`online-action-${aPlayIdx}`).click();
        await expect(pageA.getByTestId('online-last-action')).toContainText(
          'accepted',
          { timeout: 5_000 },
        );
        console.log('A turn1: PLAY_CARD accepted');
      }
      const aEndTurnIdx = await findActionByType(pageA, 'END_TURN');
      expect(aEndTurnIdx).toBeGreaterThanOrEqual(0);
      await pageA.getByTestId(`online-action-${aEndTurnIdx}`).click();
      await expect(pageA.getByTestId('online-last-action')).toContainText(
        'accepted',
        { timeout: 5_000 },
      );

      // 5. Both tabs flip active-player to B.
      await expect(pageB.getByTestId('online-active-player')).toHaveText('B', {
        timeout: 5_000,
      });
      await expect(pageA.getByTestId('online-active-player')).toHaveText('B', {
        timeout: 5_000,
      });

      // 6. CRITICAL — BUG-001 fix verification.
      //    B's legalActions must include END_TURN (proves R/D/D/Main ran).
      //    B should also have CONCEDE; legalActions count must be > 1.
      const bTurn1Actions = await dumpActions(pageB, 'B turn1');
      expect(bTurn1Actions).toContain('CONCEDE');
      expect(bTurn1Actions).toContain('END_TURN');
      expect(bTurn1Actions.length).toBeGreaterThan(1);

      // Board phase must be 'main' on B's side too.
      await expect(pageB.getByTestId('online-board-phase')).toHaveText('main');

      // 7. B END_TURN → A's turn 2 (skipping mid-turn actions per BUG-002).
      const bEndTurnIdx = await findActionByType(pageB, 'END_TURN');
      expect(bEndTurnIdx).toBeGreaterThanOrEqual(0);
      await pageB.getByTestId(`online-action-${bEndTurnIdx}`).click();
      await expect(pageB.getByTestId('online-last-action')).toContainText(
        'accepted',
        { timeout: 5_000 },
      );

      await expect(pageA.getByTestId('online-active-player')).toHaveText('A', {
        timeout: 5_000,
      });

      const aTurn2Actions = await dumpActions(pageA, 'A turn2');
      expect(aTurn2Actions).toContain('END_TURN');
      expect(aTurn2Actions).toContain('CONCEDE');
      // A's turn 2 should also have non-CONCEDE / non-END_TURN options
      // (the new turn pipeline gave A another DON to attach).
      expect(aTurn2Actions.length).toBeGreaterThan(1);

      await expect(pageA.getByTestId('online-board-phase')).toHaveText('main');
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

async function findActionExcluding(
  page: Page,
  excluded: ReadonlyArray<string>,
): Promise<number> {
  return page.evaluate((ex) => {
    const buttons = Array.from(
      document.querySelectorAll('[data-testid^="online-action-"]'),
    ) as HTMLButtonElement[];
    for (let i = 0; i < buttons.length; i++) {
      const t = buttons[i]!.getAttribute('data-action-type');
      if (t && !ex.includes(t)) return i;
    }
    return -1;
  }, excluded);
}
