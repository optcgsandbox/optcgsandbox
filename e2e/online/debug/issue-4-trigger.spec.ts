/**
 * F-7n Issue 4 — reproduction-only spec for "Triggers not obvious /
 * not usable in human play". No fixes. Observation + screenshots.
 *
 * Trigger windows only fire when an attack damages a leader whose
 * top-of-life card has `effectSpecV2.clauses[*].trigger === 'trigger'`.
 * Only 3 corpus cards have such clauses (OP01-009 Carrot, OP05-109
 * Pagaya, OP13-106 Conney). In random-deck online play this is rare.
 *
 * Strategy: loop A-attacks against B leader across up to N turns; if
 * a trigger_window ever fires, capture the full state of both tabs.
 * If we exhaust the loop without ever seeing a trigger, REPORT that
 * and recommend a deterministic fixture path (which is forbidden by
 * F-7n scope — would require server changes).
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { captureSnapshot, summarizeSnapshot, type DomSnapshot } from './snapshot';

const ONLINE_E2E = process.env.ONLINE_E2E === '1';
const WORKER_ORIGIN = process.env.WORKER_ORIGIN ?? 'http://localhost:8801';
const MAX_ATTACK_CYCLES = 6;

test.use({
  launchOptions: { args: ['--disable-web-security'] },
});

test.describe.configure({ mode: 'serial' });

test.describe('F-7n Issue 4 — TRIGGER reproduction', () => {
  test.beforeEach(({}, testInfo) => {
    if (!ONLINE_E2E) testInfo.skip(true, 'ONLINE_E2E=1 not set');
  });

  test('loop attacks until trigger_window fires; capture both views', async ({
    browser,
  }, testInfo) => {
    test.setTimeout(180_000);
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

    let triggerSeen = false;

    try {
      await pageA.goto('/?online=1&test=1');
      await pageB.goto('/?online=1&test=1');
      await pageA.getByTestId('online-session-id').fill(`f7n-i4-a-${Date.now()}`);
      await pageA.getByTestId('online-color-select').selectOption('red');
      await pageB.getByTestId('online-session-id').fill(`f7n-i4-b-${Date.now()}`);
      await pageB.getByTestId('online-color-select').selectOption('blue');
      await pageA.getByTestId('online-find-match').click();
      await pageB.getByTestId('online-find-match').click();
      await expect(pageA.getByTestId('online-phase')).toHaveText('connected', {
        timeout: 15_000,
      });
      await expect(pageA.getByTestId('online-board-phase')).toHaveText('main');

      // A turn 1 END_TURN; B turn 1 END_TURN to reach A turn 2 (CR §6-5-6-1).
      const sA0 = await captureSnapshot(pageA);
      await pageA.getByTestId(sA0.actions.find((a) => a.type === 'END_TURN')!.testId).click();
      await pageA.waitForTimeout(500);
      const sB0 = await captureSnapshot(pageB);
      await pageB.getByTestId(sB0.actions.find((a) => a.type === 'END_TURN')!.testId).click();
      await pageA.waitForTimeout(500);

      for (let cycle = 0; cycle < MAX_ATTACK_CYCLES && !triggerSeen; cycle += 1) {
        report(`--- attack cycle ${cycle} ---`);
        const sA = await captureSnapshot(pageA);
        const aAttack = sA.actions.find((a) => a.type === 'DECLARE_ATTACK');
        if (aAttack === undefined) {
          report(`A has no DECLARE_ATTACK on cycle ${cycle} — ending loop`);
          break;
        }
        await pageA.getByTestId(aAttack.testId).click();
        await pageA.waitForTimeout(300);

        // SKIP_BLOCKER on B.
        const sBlock = await captureSnapshot(pageB);
        const bsk = sBlock.actions.find((a) => a.type === 'SKIP_BLOCKER');
        if (bsk === undefined) {
          report('B no SKIP_BLOCKER — stop');
          break;
        }
        await pageB.getByTestId(bsk.testId).click();
        await pageA.waitForTimeout(300);

        // If counter_window, SKIP_COUNTER on B.
        const sCnt = await captureSnapshot(pageB);
        if (sCnt.phase === 'counter_window') {
          const bsc = sCnt.actions.find((a) => a.type === 'SKIP_COUNTER');
          if (bsc !== undefined) {
            await pageB.getByTestId(bsc.testId).click();
            await pageA.waitForTimeout(400);
          }
        }

        // Check phase post-damage.
        const sBAfter = await captureSnapshot(pageB);
        const sAAfter = await captureSnapshot(pageA);
        report(
          `cycle ${cycle}: B phase=${sBAfter.phase}, A phase=${sAAfter.phase}`,
        );

        if (sBAfter.phase === 'trigger_window' || sAAfter.phase === 'trigger_window') {
          triggerSeen = true;
          report('*** trigger_window OPENED — capturing state on both tabs ***');
          const sB_trig = await snap(pageB, `cycle ${cycle}: B trigger_window`);
          const sA_trig = await snap(pageA, `cycle ${cycle}: A view during B trigger_window`);
          await shot(pageB, `B_trigger_window_cycle_${cycle}`);
          await shot(pageA, `A_view_trigger_window_cycle_${cycle}`);

          // P0 diagnosis points:
          const banner = sB_trig.pendingBanner;
          const resolves = sB_trig.actions.filter((a) => a.type === 'RESOLVE_TRIGGER');
          report(`[B trigger_window] banner=${banner === null ? 'NONE' : JSON.stringify(banner)}`);
          report(`[B trigger_window] RESOLVE_TRIGGER count=${resolves.length}`);
          for (const r of resolves) {
            report(`  - testId=${r.testId} group=${r.group} label="${r.label}"`);
          }
          report(`[A view trigger] legal=${sA_trig.legalActionsCount}, banner=${sA_trig.pendingBanner === null ? 'NONE' : 'shown'}`);

          // Click first RESOLVE_TRIGGER (declines variant is safest).
          const r0 = resolves[0];
          if (r0 !== undefined) {
            report(`[B] clicking RESOLVE_TRIGGER ${r0.label}`);
            await pageB.getByTestId(r0.testId).click();
            await pageA.waitForTimeout(500);
            const sB_post = await snap(pageB, `cycle ${cycle}: B after RESOLVE_TRIGGER`);
            const sA_post = await snap(pageA, `cycle ${cycle}: A after B RESOLVE_TRIGGER`);
            await shot(pageB, `B_after_trigger_cycle_${cycle}`);
            await shot(pageA, `A_after_trigger_cycle_${cycle}`);
            report(`[post-trigger] B phase=${sB_post.phase}, A phase=${sA_post.phase}`);
          }
          break;
        }

        if (sBAfter.result !== '—' && sBAfter.result !== null && sBAfter.result !== '') {
          report(`match ended: ${sBAfter.result}`);
          break;
        }

        // End A's turn, B's turn, loop.
        const sAEndA = await captureSnapshot(pageA);
        const aE = sAEndA.actions.find((a) => a.type === 'END_TURN');
        if (aE === undefined) {
          report('A no END_TURN — stop');
          break;
        }
        await pageA.getByTestId(aE.testId).click();
        await pageA.waitForTimeout(500);

        const sBEnd = await captureSnapshot(pageB);
        const bE = sBEnd.actions.find((a) => a.type === 'END_TURN');
        if (bE === undefined) {
          report('B no END_TURN (probably discard window) — stop');
          break;
        }
        await pageB.getByTestId(bE.testId).click();
        await pageA.waitForTimeout(500);
      }

      if (!triggerSeen) {
        report(
          `Trigger window did NOT fire in ${MAX_ATTACK_CYCLES} attack cycles. Random seed didn't deal a trigger card (Carrot/Pagaya/Conney) onto B life. Deterministic fixture would require server seed control — FORBIDDEN in F-7n scope.`,
        );
        report(
          'Engine-side RESOLVE_TRIGGER coverage already pinned by `shared/server/__tests__/triggerWindow.online.test.ts` (5 scenarios).',
        );
      }
    } finally {
      const rp = testInfo.outputPath('issue-4-report.txt');
      fs.writeFileSync(rp, reportLines.join('\n'), 'utf8');
      report(`\nReport written to: ${path.basename(rp)}; triggerSeen=${triggerSeen}`);
      await ctxA.close();
      await ctxB.close();
    }
  });
});
