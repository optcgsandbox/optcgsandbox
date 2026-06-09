/**
 * F-7h — Playwright two-tab online E2E.
 *
 * Drives two browser contexts through the full DEV_AUTH online flow:
 *   1. Tab A submits a deck, queues, polls until paired.
 *   2. Tab B submits a deck, gets paired.
 *   3. Both render OnlinePlayfield with phase=main.
 *   4. Tab A clicks the first non-CONCEDE legal action; both update.
 *   5. Tab A concedes; both render match-over loser=A.
 *
 * PREREQUISITES (manual; spec skips if absent):
 *   - `ONLINE_E2E=1`
 *   - Worker running: `cd worker && npx wrangler dev --port 8801 --local \
 *                       --var DEV_AUTH:1 --var ENV:dev`
 *   - Vite serving the app on port 5174 (auto-started by playwright.config.ts).
 *   - Optional: `WORKER_ORIGIN=http://localhost:8801` overrides the default.
 *
 * The spec injects `window.__WORKER_ORIGIN__` via `addInitScript` so the
 * client's `src/online/api.ts` (which reads that global) points at the
 * locally-running wrangler dev rather than same-origin.
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';

const ONLINE_E2E = process.env.ONLINE_E2E === '1';
const WORKER_ORIGIN = process.env.WORKER_ORIGIN ?? 'http://localhost:8801';

// Worker's production CORS allowlist (`worker/index.ts:22-25`) excludes
// localhost by design. For LOCAL Playwright runs only, we disable
// browser-side web security so the fetch from http://localhost:5174
// → http://localhost:8801 is not blocked. The worker's strict origin
// posture stays untouched.
test.use({
  launchOptions: {
    args: ['--disable-web-security'],
  },
});

test.describe.configure({ mode: 'serial' });

test.describe('Online lobby two-tab E2E', () => {
  test.beforeEach(({}, testInfo) => {
    if (!ONLINE_E2E) {
      testInfo.skip(true, 'ONLINE_E2E=1 not set — see file header for prereqs');
    }
  });

  test('two tabs pair, render board, submit action, concede', async ({ browser }) => {
    // Two independent contexts so each tab has its own session/cookies.
    const ctxA: BrowserContext = await browser.newContext();
    const ctxB: BrowserContext = await browser.newContext();

    // Inject the worker-origin override BEFORE any page script runs so
    // `src/online/api.ts:workerOrigin()` picks it up on first call.
    const initScript = `window.__WORKER_ORIGIN__ = ${JSON.stringify(WORKER_ORIGIN)};`;
    await ctxA.addInitScript(initScript);
    await ctxB.addInitScript(initScript);

    const pageA: Page = await ctxA.newPage();
    const pageB: Page = await ctxB.newPage();

    try {
      // 1. Both tabs open the online lobby.
      await pageA.goto('/?online=1&test=1');
      await pageB.goto('/?online=1&test=1');
      await expect(pageA.getByTestId('online-lobby-root')).toBeVisible();
      await expect(pageB.getByTestId('online-lobby-root')).toBeVisible();

      // 2. Set unique sessionIds + distinct colors.
      const sessionA = `e2e-alice-${Date.now()}`;
      const sessionB = `e2e-bob-${Date.now()}`;

      await fillSession(pageA, sessionA, 'red');
      await fillSession(pageB, sessionB, 'blue');

      // 3. Tab A finds match → expect QUEUED.
      await pageA.getByTestId('online-find-match').click();
      await expect(pageA.getByTestId('online-phase')).toHaveText('queued', {
        timeout: 10_000,
      });

      // 4. Tab B finds match → A & B should both eventually reach connected.
      await pageB.getByTestId('online-find-match').click();
      await expect(pageB.getByTestId('online-phase')).toHaveText('connected', {
        timeout: 15_000,
      });
      await expect(pageA.getByTestId('online-phase')).toHaveText('connected', {
        timeout: 15_000,
      });

      // 5. Both render OnlinePlayfield with phase=main.
      await expect(pageA.getByTestId('online-playfield-root')).toBeVisible();
      await expect(pageB.getByTestId('online-playfield-root')).toBeVisible();
      await expect(pageA.getByTestId('online-board-phase')).toHaveText('main');
      await expect(pageB.getByTestId('online-board-phase')).toHaveText('main');
      await expect(pageA.getByTestId('online-active-player')).toHaveText('A');

      // 6. legalActions count > 0 on A.
      const aLegalCount = await pageA
        .getByTestId('online-legal-actions-count')
        .textContent();
      expect(Number(aLegalCount ?? '0')).toBeGreaterThan(0);

      // 7. Click the first non-CONCEDE action button on A.
      // We iterate `online-action-N` and pick the first whose
      // data-action-type !== 'CONCEDE'.
      const nonConcedeIdx = await pageA.evaluate(() => {
        const buttons = Array.from(
          document.querySelectorAll('[data-testid^="online-action-"]'),
        ) as HTMLButtonElement[];
        for (let i = 0; i < buttons.length; i++) {
          if (buttons[i]!.getAttribute('data-action-type') !== 'CONCEDE') {
            return i;
          }
        }
        return -1;
      });
      expect(nonConcedeIdx).toBeGreaterThanOrEqual(0);
      await pageA.getByTestId(`online-action-${nonConcedeIdx}`).click();

      // 8. A's last action row should show "accepted".
      await expect(pageA.getByTestId('online-last-action')).toContainText(
        'accepted',
        { timeout: 5_000 },
      );

      // 9. Tab A concedes.
      await pageA.getByTestId('online-concede').click();

      // 10. Both see match result: loser=A.
      await expect(pageA.getByTestId('online-match-result')).toContainText(
        'loser=A',
        { timeout: 5_000 },
      );
      await expect(pageB.getByTestId('online-match-result')).toContainText(
        'loser=A',
        { timeout: 5_000 },
      );
      await expect(pageB.getByTestId('online-match-result')).toContainText(
        'reason=concede',
      );
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});

async function fillSession(page: Page, sessionId: string, color: string): Promise<void> {
  const input = page.getByTestId('online-session-id');
  await input.fill(sessionId);
  await page.getByTestId('online-color-select').selectOption(color);
}
