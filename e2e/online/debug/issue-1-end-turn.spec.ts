/**
 * F-7n Issue 1 — reproduction-only spec for "Opponent first-turn
 * END_TURN feels broken". No fixes. Pure observation + screenshots.
 *
 * Procedure:
 *   1. Pair two tabs.
 *   2. Capture snapshots on BOTH tabs at the moment phase=main and
 *      activePlayer=A.
 *   3. Verify END_TURN is present on A; visible (not disabled); has a
 *      data-action-group attribute we can name.
 *   4. Click A's END_TURN. Capture snapshots IMMEDIATELY (no waits)
 *      AND after a short paint tick.
 *   5. Check: does activePlayer flip to B? does phase stay main? does
 *      A's last-action say accepted / rejected? does a discard prompt
 *      intercept?
 *   6. Same for B's END_TURN (B is now "opp" from A's POV — this is
 *      the "opponent first-turn END_TURN" case the owner reported).
 *   7. After B's END_TURN, capture A turn 2 state.
 *   8. Save screenshots and snapshot text dumps to test-results.
 *
 * Run pre-req:
 *   ONLINE_E2E=1
 *   wrangler dev --port 8801 --local --var DEV_AUTH:1 --var ENV:dev
 *   vite --port 5174
 *
 * The spec ALWAYS passes — every assertion is `expect().soft(...)` /
 * console.log so the report contains every observation regardless of
 * which assertion would fail. We're documenting, not validating.
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { captureSnapshot, summarizeSnapshot, type DomSnapshot } from './snapshot';

const ONLINE_E2E = process.env.ONLINE_E2E === '1';
const WORKER_ORIGIN = process.env.WORKER_ORIGIN ?? 'http://localhost:8801';

test.use({
  launchOptions: { args: ['--disable-web-security'] },
});

test.describe.configure({ mode: 'serial' });

test.describe('F-7n Issue 1 — END_TURN reproduction', () => {
  test.beforeEach(({}, testInfo) => {
    if (!ONLINE_E2E) testInfo.skip(true, 'ONLINE_E2E=1 not set');
  });

  test('observe A and B END_TURN flow without fixing anything', async ({ browser }, testInfo) => {
    test.setTimeout(120_000);

    const ctxA: BrowserContext = await browser.newContext();
    const ctxB: BrowserContext = await browser.newContext();
    const initScript = `window.__WORKER_ORIGIN__ = ${JSON.stringify(WORKER_ORIGIN)};`;
    await ctxA.addInitScript(initScript);
    await ctxB.addInitScript(initScript);
    const pageA: Page = await ctxA.newPage();
    const pageB: Page = await ctxB.newPage();

    const reportLines: string[] = [];
    const report = (line: string): void => {
      console.log(line);
      reportLines.push(line);
    };

    const snap = async (page: Page, label: string): Promise<DomSnapshot> => {
      const s = await captureSnapshot(page);
      report(summarizeSnapshot(label, s));
      return s;
    };

    const shot = async (page: Page, label: string): Promise<void> => {
      const safeLabel = label.replace(/[^a-z0-9-_]/gi, '_');
      const filePath = testInfo.outputPath(`${safeLabel}.png`);
      await page.screenshot({ path: filePath, fullPage: true });
      report(`  (screenshot saved: ${path.basename(filePath)})`);
    };

    try {
      // ── Pair ────────────────────────────────────────────────────────
      await pageA.goto('/?online=1&test=1');
      await pageB.goto('/?online=1&test=1');
      const sessionA = `f7n-issue1-a-${Date.now()}`;
      const sessionB = `f7n-issue1-b-${Date.now()}`;
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

      // ── Step 1: A turn 1 main, fresh state ─────────────────────────
      const sA0 = await snap(pageA, 'A pre-END_TURN (turn 1, A active)');
      const sB0 = await snap(pageB, 'B view (turn 1, opp active)');
      await shot(pageA, 'step1_A_main_turn1');
      await shot(pageB, 'step1_B_view_turn1');

      // Diagnose: is END_TURN in A's actions? what group? disabled?
      const aEndTurn = sA0.actions.find((a) => a.type === 'END_TURN');
      report(
        `[A] END_TURN visible? ${aEndTurn !== undefined ? 'yes' : 'NO'}` +
          (aEndTurn !== undefined
            ? ` (group=${aEndTurn.group}, disabled=${aEndTurn.disabled}, label="${aEndTurn.label}")`
            : ''),
      );
      // Diagnose: is END_TURN in B's actions while opp's turn?
      const bEndTurn = sB0.actions.find((a) => a.type === 'END_TURN');
      report(
        `[B view, opp turn] END_TURN visible? ${bEndTurn !== undefined ? 'yes' : 'NO'}`,
      );

      // ── Step 2: click A's END_TURN, capture immediately ────────────
      if (aEndTurn === undefined) {
        report('[A] cannot click END_TURN — it is not in legalActions');
      } else {
        report(`[A] clicking END_TURN button at testId=${aEndTurn.testId}`);
        await pageA.getByTestId(aEndTurn.testId).click();
        // Capture before any wait — what does the DOM look like in the
        // tick AFTER the click but BEFORE WS round-trip resolves?
        const sA_imm = await snap(pageA, 'A immediately after END_TURN click');
        const sB_imm = await snap(pageB, 'B immediately after A END_TURN click');
        await shot(pageA, 'step2_A_after_click_immediate');
        await shot(pageB, 'step2_B_after_A_click_immediate');
        void sA_imm;
        void sB_imm;
      }

      // ── Step 3: wait for state to settle, then capture again ───────
      await pageA.waitForTimeout(750);
      const sA1 = await snap(pageA, 'A after END_TURN settled');
      const sB1 = await snap(pageB, 'B after A END_TURN settled');
      await shot(pageA, 'step3_A_after_click_settled');
      await shot(pageB, 'step3_B_after_A_click_settled');

      // Diagnose: did the active player flip to B?
      report(
        `[settled] A view active=${sA1.activePlayer}, B view active=${sB1.activePlayer}, phase=${sA1.phase}/${sB1.phase}`,
      );
      // Diagnose: discard_choice or pending banner on either tab?
      report(
        `[settled] A pending banner=${sA1.pendingBanner === null ? 'none' : JSON.stringify(sA1.pendingBanner)}`,
      );
      report(
        `[settled] B pending banner=${sB1.pendingBanner === null ? 'none' : JSON.stringify(sB1.pendingBanner)}`,
      );
      // Diagnose: last-action accepted/rejected on A's tab?
      report(`[settled] A lastAction=${sA1.lastAction}`);

      // ── Step 4: now check B (the "opp first-turn") — same procedure
      const bEndTurn1 = sB1.actions.find((a) => a.type === 'END_TURN');
      report(
        `[B turn 1 opens] END_TURN visible on B view? ${bEndTurn1 !== undefined ? 'yes' : 'NO'}` +
          (bEndTurn1 !== undefined
            ? ` (group=${bEndTurn1.group}, disabled=${bEndTurn1.disabled}, label="${bEndTurn1.label}")`
            : ''),
      );

      if (bEndTurn1 === undefined) {
        report('[B] cannot click END_TURN — observe what blocks it');
      } else {
        report(`[B] clicking END_TURN at testId=${bEndTurn1.testId}`);
        await pageB.getByTestId(bEndTurn1.testId).click();
        const sB_imm2 = await snap(pageB, 'B immediately after END_TURN click');
        const sA_imm2 = await snap(pageA, 'A immediately after B END_TURN click');
        await shot(pageB, 'step4_B_after_click_immediate');
        await shot(pageA, 'step4_A_after_B_click_immediate');
        void sB_imm2;
        void sA_imm2;

        await pageA.waitForTimeout(750);
        const sB2 = await snap(pageB, 'B after END_TURN settled');
        const sA2 = await snap(pageA, 'A after B END_TURN settled');
        await shot(pageB, 'step5_B_after_click_settled');
        await shot(pageA, 'step5_A_after_B_click_settled');

        report(
          `[B END_TURN settled] A view active=${sA2.activePlayer}, B view active=${sB2.activePlayer}, phase=${sA2.phase}/${sB2.phase}`,
        );
        report(
          `[B END_TURN settled] A pending banner=${sA2.pendingBanner === null ? 'none' : JSON.stringify(sA2.pendingBanner)}`,
        );
        report(
          `[B END_TURN settled] B pending banner=${sB2.pendingBanner === null ? 'none' : JSON.stringify(sB2.pendingBanner)}`,
        );
        report(`[B END_TURN settled] B lastAction=${sB2.lastAction}`);
      }
    } finally {
      const reportPath = testInfo.outputPath('issue-1-report.txt');
      fs.writeFileSync(reportPath, reportLines.join('\n'), 'utf8');
      report(`\nReport written to: ${path.basename(reportPath)}`);
      await ctxA.close();
      await ctxB.close();
    }
  });
});
