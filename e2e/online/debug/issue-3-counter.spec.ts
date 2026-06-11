/**
 * F-7n Issue 3 — reproduction-only spec for "Counters not obvious /
 * not usable in human play". No fixes. Observation + screenshots.
 *
 * Drives the same A-attack flow as Issue 2 but EXPLICITLY clicks a
 * PLAY_COUNTER (rather than SKIP_COUNTER) to surface what the human
 * sees when they actually use a counter. Validates:
 *   - banner is visible
 *   - PLAY_COUNTER buttons are in Counter Response group
 *   - card name is in the button label
 *   - click is accepted server-side
 *   - state after counter shows reduced opp damage or attacker
 *     surviving — observable how?
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

test.describe('F-7n Issue 3 — COUNTER reproduction', () => {
  test.beforeEach(({}, testInfo) => {
    if (!ONLINE_E2E) testInfo.skip(true, 'ONLINE_E2E=1 not set');
  });

  test('drive A attack → counter_window → click PLAY_COUNTER, observe', async ({
    browser,
  }, testInfo) => {
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
      const safe = label.replace(/[^a-z0-9-_]/gi, '_');
      const fp = testInfo.outputPath(`${safe}.png`);
      await page.screenshot({ path: fp, fullPage: true });
      report(`  (screenshot saved: ${path.basename(fp)})`);
    };

    try {
      await pageA.goto('/?online=1&test=1');
      await pageB.goto('/?online=1&test=1');
      const sa = `f7n-i3-a-${Date.now()}`;
      const sb = `f7n-i3-b-${Date.now()}`;
      await pageA.getByTestId('online-session-id').fill(sa);
      await pageA.getByTestId('online-color-select').selectOption('red');
      await pageB.getByTestId('online-session-id').fill(sb);
      await pageB.getByTestId('online-color-select').selectOption('blue');
      await pageA.getByTestId('online-find-match').click();
      await pageB.getByTestId('online-find-match').click();
      await expect(pageA.getByTestId('online-phase')).toHaveText('connected', {
        timeout: 15_000,
      });
      await expect(pageA.getByTestId('online-board-phase')).toHaveText('main');

      // A turn 1 → END_TURN; B turn 1 → END_TURN.
      const sA0 = await captureSnapshot(pageA);
      await pageA.getByTestId(sA0.actions.find((a) => a.type === 'END_TURN')!.testId).click();
      await pageA.waitForTimeout(500);
      const sB0 = await captureSnapshot(pageB);
      await pageB.getByTestId(sB0.actions.find((a) => a.type === 'END_TURN')!.testId).click();
      await pageA.waitForTimeout(500);

      // A turn 2: DECLARE_ATTACK.
      const sA1 = await snap(pageA, 'A turn 2 pre-attack');
      const aAttack = sA1.actions.find((a) => a.type === 'DECLARE_ATTACK');
      if (aAttack === undefined) {
        report('A has no DECLARE_ATTACK on turn 2 — STOP');
        return;
      }
      await pageA.getByTestId(aAttack.testId).click();
      await pageA.waitForTimeout(400);

      // block_window opens; B clicks SKIP_BLOCKER.
      const sB_block = await snap(pageB, 'B block_window');
      const bSkipBlock = sB_block.actions.find((a) => a.type === 'SKIP_BLOCKER');
      if (bSkipBlock === undefined) {
        report('B has no SKIP_BLOCKER in block_window — STOP');
        return;
      }
      await pageB.getByTestId(bSkipBlock.testId).click();
      await pageA.waitForTimeout(400);

      // counter_window now. CAPTURE B's view in detail.
      const sB_counter = await snap(pageB, 'B counter_window full state');
      const sA_counter = await snap(pageA, 'A view during counter_window');
      await shot(pageB, 'B_counter_window_full');
      await shot(pageA, 'A_view_counter_window');

      const banner = sB_counter.pendingBanner;
      const playCounters = sB_counter.actions.filter((a) => a.type === 'PLAY_COUNTER');
      const skipCounter = sB_counter.actions.find((a) => a.type === 'SKIP_COUNTER');
      report(`[B counter_window] banner=${banner === null ? 'NONE' : JSON.stringify(banner)}`);
      report(`[B counter_window] SKIP_COUNTER visible? ${skipCounter !== undefined ? 'yes' : 'NO'}`);
      report(`[B counter_window] PLAY_COUNTER count=${playCounters.length}`);
      for (const c of playCounters) {
        report(`  - testId=${c.testId} group=${c.group} label="${c.label}"`);
      }
      report(`[A view] legalActions count=${sA_counter.legalActionsCount}, banner=${sA_counter.pendingBanner === null ? 'NONE' : 'shown'}`);

      // Click the first PLAY_COUNTER to surface what happens.
      if (playCounters.length === 0) {
        report('B has no PLAY_COUNTER candidate (no counter cards in hand) — falling back to SKIP_COUNTER');
        if (skipCounter !== undefined) {
          await pageB.getByTestId(skipCounter.testId).click();
          await pageA.waitForTimeout(500);
          const sB_after = await snap(pageB, 'B after SKIP_COUNTER');
          const sA_after = await snap(pageA, 'A after B SKIP_COUNTER');
          await shot(pageB, 'B_after_SKIP_COUNTER');
          await shot(pageA, 'A_after_B_SKIP_COUNTER');
          report(`[settled] B phase=${sB_after.phase}, A phase=${sA_after.phase}, A active=${sA_after.activePlayer}`);
        }
      } else {
        const c0 = playCounters[0]!;
        report(`[B] clicking PLAY_COUNTER ${c0.label} at ${c0.testId}`);
        await pageB.getByTestId(c0.testId).click();
        await pageA.waitForTimeout(500);
        const sB_after = await snap(pageB, 'B after PLAY_COUNTER click');
        const sA_after = await snap(pageA, 'A after B PLAY_COUNTER click');
        await shot(pageB, 'B_after_PLAY_COUNTER');
        await shot(pageA, 'A_after_B_PLAY_COUNTER');
        report(`[B] lastAction=${sB_after.lastAction}`);
        report(`[B] phase after counter=${sB_after.phase}`);

        // Whether or not the engine immediately resolves damage or stays
        // in counter_window for another counter, capture the next state.
        if (sB_after.phase === 'counter_window') {
          const sk = sB_after.actions.find((a) => a.type === 'SKIP_COUNTER');
          if (sk !== undefined) {
            await pageB.getByTestId(sk.testId).click();
            await pageA.waitForTimeout(500);
            const sB_final = await snap(pageB, 'B after final SKIP_COUNTER (counter played)');
            const sA_final = await snap(pageA, 'A after final SKIP_COUNTER (counter played)');
            await shot(pageB, 'B_final_after_counter');
            await shot(pageA, 'A_final_after_counter');
            report(`[final] B phase=${sB_final.phase}, A phase=${sA_final.phase}, A active=${sA_final.activePlayer}`);
          }
        }
      }
    } finally {
      const rp = testInfo.outputPath('issue-3-report.txt');
      fs.writeFileSync(rp, reportLines.join('\n'), 'utf8');
      report(`\nReport written to: ${path.basename(rp)}`);
      await ctxA.close();
      await ctxB.close();
    }
  });
});
