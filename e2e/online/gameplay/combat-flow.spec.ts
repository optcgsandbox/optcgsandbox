/**
 * F-7k BUG-003 — Online combat / attack-flow truth-finding spec.
 *
 * Goal: prove or expose failures in the online DECLARE_ATTACK path.
 *
 * Flow:
 *   1. Pair two browser tabs in DEV_AUTH mode.
 *   2. A turn 1 → END_TURN (CR §6-5-6-1: first player can't attack turn 1).
 *   3. B turn 1 → END_TURN.
 *   4. A turn 2: DECLARE_ATTACK should be in legalActions.
 *   5. A clicks DECLARE_ATTACK (prefer character-attacks-leader; fall back
 *      to leader-attacks-leader since A has no field characters by default).
 *   6. Assert: server accepts.
 *   7. Observe both tabs' next state: state.phase should be 'block_window';
 *      B's legalActions should include SKIP_BLOCKER.
 *   8. B clicks SKIP_BLOCKER → counter_window → SKIP_COUNTER → resolve.
 *
 * If a pending window opens but no UI exposes the resolving action,
 * that is BUG-003 / `ui_bug`; we capture which step blocked.
 *
 * Pre-req:
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

test.describe('Online combat flow (BUG-003 probe)', () => {
  test.beforeEach(({}, testInfo) => {
    if (!ONLINE_E2E) testInfo.skip(true, 'ONLINE_E2E=1 not set');
  });

  test('A turn 2 DECLARE_ATTACK on opp leader; defender skips blocker + counter; attack resolves', async ({
    browser,
  }) => {
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
      const sessionA = `e2e-combat-a-${Date.now()}`;
      const sessionB = `e2e-combat-b-${Date.now()}`;
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

      // A turn 1: legal sanity, then END_TURN.
      await dumpActions(pageA, 'A turn 1');
      await clickByType(pageA, 'END_TURN');

      // B turn 1: END_TURN.
      await expect(pageA.getByTestId('online-active-player')).toHaveText('B', {
        timeout: 5_000,
      });
      await dumpActions(pageB, 'B turn 1');
      await clickByType(pageB, 'END_TURN');

      // A turn 2.
      await expect(pageA.getByTestId('online-active-player')).toHaveText('A', {
        timeout: 5_000,
      });
      const aTurn2 = await dumpActions(pageA, 'A turn 2');
      expect(aTurn2).toContain('DECLARE_ATTACK');

      // Click first DECLARE_ATTACK button.
      const attackIdx = await findActionByType(pageA, 'DECLARE_ATTACK');
      expect(attackIdx).toBeGreaterThanOrEqual(0);
      await pageA.getByTestId(`online-action-${attackIdx}`).click();
      await expect(pageA.getByTestId('online-last-action')).toContainText(
        'accepted',
        { timeout: 5_000 },
      );
      console.log('A turn 2: DECLARE_ATTACK accepted');

      // After DECLARE_ATTACK: state.phase becomes 'block_window'
      // (shared/engine-v2/reducers/attackFlow.ts:234). Both tabs should
      // see the phase change. B should see SKIP_BLOCKER in legalActions.
      await expect(pageA.getByTestId('online-board-phase')).toHaveText(
        'block_window',
        { timeout: 5_000 },
      );
      await expect(pageB.getByTestId('online-board-phase')).toHaveText(
        'block_window',
        { timeout: 5_000 },
      );

      // B's legalActions should include SKIP_BLOCKER (defender's reactive
      // window — see shared/engine-v2/rules/legality.ts:132-134).
      const bBlockActions = await dumpActions(pageB, 'B block_window');
      expect(bBlockActions).toContain('SKIP_BLOCKER');

      // A's legalActions during block_window should be [CONCEDE] only —
      // active player has no main-phase actions while a pending attack
      // resolves (see shared/engine-v2/rules/legality.ts:131-138 fall-through).
      const aBlockActions = await dumpActions(pageA, 'A block_window');
      expect(aBlockActions).toContain('CONCEDE');

      // B clicks SKIP_BLOCKER.
      const bSkipBlockerIdx = await findActionByType(pageB, 'SKIP_BLOCKER');
      expect(bSkipBlockerIdx).toBeGreaterThanOrEqual(0);
      await pageB.getByTestId(`online-action-${bSkipBlockerIdx}`).click();
      await expect(pageB.getByTestId('online-last-action')).toContainText(
        'accepted',
        { timeout: 5_000 },
      );
      console.log('B SKIP_BLOCKER accepted');

      // Engine should advance to counter_window OR resolve the attack
      // directly if no counter is playable. Capture whichever happens.
      // Defender (B) might see SKIP_COUNTER OR the attack might resolve
      // and active player flip back to A.
      await pageA.waitForTimeout(400);
      const phaseAfterSkipBlocker = await pageA
        .getByTestId('online-board-phase')
        .textContent();
      console.log('Phase after SKIP_BLOCKER:', phaseAfterSkipBlocker);

      if (phaseAfterSkipBlocker === 'counter_window') {
        const bCounterActions = await dumpActions(pageB, 'B counter_window');
        expect(bCounterActions).toContain('SKIP_COUNTER');

        const bSkipCounterIdx = await findActionByType(pageB, 'SKIP_COUNTER');
        expect(bSkipCounterIdx).toBeGreaterThanOrEqual(0);
        await pageB.getByTestId(`online-action-${bSkipCounterIdx}`).click();
        await expect(pageB.getByTestId('online-last-action')).toContainText(
          'accepted',
          { timeout: 5_000 },
        );
        console.log('B SKIP_COUNTER accepted');
      }

      // After both windows resolve, the attack should commit. The phase
      // should land back at 'main' (or 'trigger' if a life-flip triggers
      // an event, which we'll capture but not require). The active player
      // remains A until A ends turn.
      await pageA.waitForTimeout(400);
      const phaseAfterAll = await pageA
        .getByTestId('online-board-phase')
        .textContent();
      console.log('Phase after all attack windows:', phaseAfterAll);

      // Truth criterion: we reached at least 'main' or a known terminal
      // attack outcome (trigger/peek/discard windows are downstream). If
      // the phase is still block_window / counter_window after both skips,
      // that is a stop-and-report condition.
      expect(['main', 'trigger', 'peek', 'discard', 'choose_one']).toContain(
        phaseAfterAll,
      );
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
