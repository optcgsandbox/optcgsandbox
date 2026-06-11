/**
 * F-7n Issue 2 — reproduction-only spec for "Blockers not obvious /
 * not usable in human play". No fixes. Observation + screenshots.
 *
 * Drives:
 *   1. Pair two tabs (A red, B blue — blue has many blockers).
 *   2. A END_TURN; B plays first PLAY_CARD if any (best-effort: B
 *      might get a blocker char on field; might not — we observe).
 *   3. B END_TURN; A turn 2.
 *   4. A clicks DECLARE_ATTACK on B leader to open block_window.
 *   5. Capture B's UI: banner, grouped DECLARE_BLOCKER / SKIP_BLOCKER
 *      visibility, A's UI showing waiting state.
 *   6. If DECLARE_BLOCKER appears, click it; capture result.
 *      If not, click SKIP_BLOCKER; capture result.
 *
 * Same as Issue 1: every observation logged + screenshotted; assertions
 * are SOFT (we WANT to see all the data even if any expectation fails).
 *
 * Run pre-req:
 *   ONLINE_E2E=1
 *   wrangler dev --port 8801 --local --var DEV_AUTH:1 --var ENV:dev
 *   vite --port 5174
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

test.describe('F-7n Issue 2 — BLOCKER reproduction', () => {
  test.beforeEach(({}, testInfo) => {
    if (!ONLINE_E2E) testInfo.skip(true, 'ONLINE_E2E=1 not set');
  });

  test('drive A attack → block_window, observe B UI', async ({ browser }, testInfo) => {
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
      // Pair.
      await pageA.goto('/?online=1&test=1');
      await pageB.goto('/?online=1&test=1');
      const sessionA = `f7n-issue2-a-${Date.now()}`;
      const sessionB = `f7n-issue2-b-${Date.now()}`;
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
      report('--- A turn 1: END_TURN ---');
      const sA0 = await snap(pageA, 'A turn 1 pre-END_TURN');
      const aEnd0 = sA0.actions.find((a) => a.type === 'END_TURN');
      if (aEnd0 === undefined) throw new Error('A has no END_TURN on turn 1');
      await pageA.getByTestId(aEnd0.testId).click();
      await pageA.waitForTimeout(600);

      // B turn 1 → try first PLAY_CARD (no labels indicate blocker keyword,
      // so this is best-effort) then END_TURN. We CAPTURE B's snapshot to
      // observe what was played.
      report('--- B turn 1: play if possible, then END_TURN ---');
      const sB0 = await snap(pageB, 'B turn 1 pre-action');
      const bPlay = sB0.actions.find((a) => a.type === 'PLAY_CARD');
      if (bPlay !== undefined) {
        report(`B plays ${bPlay.label}`);
        await pageB.getByTestId(bPlay.testId).click();
        await pageB.waitForTimeout(600);
      } else {
        report('B has no PLAY_CARD on turn 1; skipping play');
      }
      const sB0b = await snap(pageB, 'B turn 1 post-play (pre-END_TURN)');
      const bEnd0 = sB0b.actions.find((a) => a.type === 'END_TURN');
      if (bEnd0 === undefined) throw new Error('B has no END_TURN on turn 1');
      await pageB.getByTestId(bEnd0.testId).click();
      await pageB.waitForTimeout(600);

      // A turn 2 — capture A view. Note B's field state for blocker presence.
      report('--- A turn 2: capture state, DECLARE_ATTACK ---');
      const sA1 = await snap(pageA, 'A turn 2 pre-attack');
      await shot(pageA, 'A_turn2_pre_attack');
      await shot(pageB, 'B_turn1_done');
      const aAttack = sA1.actions.find((a) => a.type === 'DECLARE_ATTACK');
      if (aAttack === undefined) {
        report('A turn 2 has no DECLARE_ATTACK — cannot reproduce block_window. STOP.');
        return;
      }
      report(`A attacks via testId=${aAttack.testId}, label="${aAttack.label}"`);
      await pageA.getByTestId(aAttack.testId).click();

      // Capture B IMMEDIATELY after A's attack — this is the moment B
      // would visually realize a response window opened.
      await pageA.waitForTimeout(400);
      const sB1 = await snap(pageB, 'B view immediately after A DECLARE_ATTACK');
      const sA2 = await snap(pageA, 'A view immediately after own DECLARE_ATTACK');
      await shot(pageB, 'B_view_block_window_opens');
      await shot(pageA, 'A_view_block_window_opens');

      // P0 diagnosis points:
      const bBanner = sB1.pendingBanner;
      const bSkip = sB1.actions.find((a) => a.type === 'SKIP_BLOCKER');
      const bBlock = sB1.actions.find((a) => a.type === 'DECLARE_BLOCKER');
      report(
        `[B block_window] banner=${bBanner === null ? 'NONE' : JSON.stringify(bBanner)}`,
      );
      report(
        `[B block_window] SKIP_BLOCKER visible? ${bSkip !== undefined ? `yes (group=${bSkip.group}, label="${bSkip.label}", disabled=${bSkip.disabled})` : 'NO'}`,
      );
      report(
        `[B block_window] DECLARE_BLOCKER visible? ${bBlock !== undefined ? `yes (group=${bBlock.group}, label="${bBlock.label}", disabled=${bBlock.disabled})` : 'NO (B has no blocker char on field this seed)'}`,
      );
      report(
        `[A view during block_window] legalActions count=${sA2.legalActionsCount} (expect 1 = CONCEDE only)`,
      );
      report(`[A view during block_window] phase=${sA2.phase}`);

      // Click whichever blocker action is available. Prefer DECLARE_BLOCKER
      // to exercise the click path; fall back to SKIP_BLOCKER.
      if (bBlock !== undefined) {
        report(`[B] clicking DECLARE_BLOCKER at ${bBlock.testId}`);
        await pageB.getByTestId(bBlock.testId).click();
        await pageA.waitForTimeout(500);
        const sB2 = await snap(pageB, 'B after DECLARE_BLOCKER click');
        const sA3 = await snap(pageA, 'A after B DECLARE_BLOCKER');
        await shot(pageB, 'B_after_DECLARE_BLOCKER');
        await shot(pageA, 'A_after_B_DECLARE_BLOCKER');
        report(`[B] lastAction=${sB2.lastAction}`);
        report(
          `[A] phase=${sA3.phase}, B view phase=${sB2.phase} (expect counter_window or main)`,
        );
      } else if (bSkip !== undefined) {
        report(`[B] clicking SKIP_BLOCKER at ${bSkip.testId}`);
        await pageB.getByTestId(bSkip.testId).click();
        await pageA.waitForTimeout(500);
        const sB2 = await snap(pageB, 'B after SKIP_BLOCKER click');
        const sA3 = await snap(pageA, 'A after B SKIP_BLOCKER');
        await shot(pageB, 'B_after_SKIP_BLOCKER');
        await shot(pageA, 'A_after_B_SKIP_BLOCKER');
        report(`[B] lastAction=${sB2.lastAction}`);
        report(
          `[A] phase=${sA3.phase}, B view phase=${sB2.phase} (expect counter_window or main)`,
        );
      } else {
        report('[B] no SKIP_BLOCKER or DECLARE_BLOCKER — stuck. STOP.');
      }
    } finally {
      const reportPath = testInfo.outputPath('issue-2-report.txt');
      fs.writeFileSync(reportPath, reportLines.join('\n'), 'utf8');
      report(`\nReport written to: ${path.basename(reportPath)}`);
      await ctxA.close();
      await ctxB.close();
    }
  });
});
