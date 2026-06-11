/**
 * F-7n human-side reactive-action matrix.
 *
 * Tests whether BLOCK/COUNTER/TRIGGER response windows render legal
 * actions for the human player on BOTH seats — A-as-defender AND
 * B-as-defender — in the same match. Observes side-by-side what each
 * tab's UI shows when the engine opens a reactive window.
 *
 * Scenario:
 *   1. Pair A=red B=blue.
 *   2. Turn 1: A → END_TURN; B → (best-effort play any card) → END_TURN.
 *   3. Turn 2 (game turn 3): A attacks B leader → captures the
 *      B-as-defender block/counter snapshot.
 *      Then A SKIP path through the windows to finish A's turn.
 *      Then A → END_TURN.
 *   4. Turn 2 (game turn 4): B attacks A leader → captures the
 *      A-as-defender block/counter snapshot.
 *
 * For EACH defender snapshot record:
 *   - viewer/seat
 *   - phase
 *   - activePlayer
 *   - pending.kind + pending controller (from board.pending JSON)
 *   - legalActions count + types + groups (from DOM)
 *   - whether DECLARE_BLOCKER / SKIP_BLOCKER / PLAY_COUNTER /
 *     SKIP_COUNTER / RESOLVE_TRIGGER are present
 *   - last action result after clicking the first available reactive
 *     action (proves the click chain works on THAT seat)
 *
 * Stop conditions:
 *   - if any side completely lacks the expected reactive action,
 *     report the gap and DO NOT fix.
 *   - if both sides have the action, report symmetric working state.
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

interface DefenderCase {
  readonly seat: 'A' | 'B';
  readonly attackerSeat: 'A' | 'B';
  readonly phase: string | null;
  readonly defenderLegalActionTypes: ReadonlyArray<string>;
  readonly defenderHasSKIP_BLOCKER: boolean;
  readonly defenderHasDECLARE_BLOCKER: boolean;
  readonly defenderHasSKIP_COUNTER: boolean;
  readonly defenderHasPLAY_COUNTER: boolean;
  readonly attackerLegalActionTypes: ReadonlyArray<string>;
  readonly attackerOnlyConcede: boolean;
  readonly pendingBannerOnDefender: boolean;
  readonly pendingBannerOnAttacker: boolean;
}

test.describe('F-7n human-side reactive matrix', () => {
  test.beforeEach(({}, testInfo) => {
    if (!ONLINE_E2E) testInfo.skip(true, 'ONLINE_E2E=1 not set');
  });

  test('both A and B can respond when defender; record matrix', async ({ browser }, testInfo) => {
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
    };

    const cases: DefenderCase[] = [];

    try {
      // Pair.
      await pageA.goto('/?online=1&test=1');
      await pageB.goto('/?online=1&test=1');
      await pageA.getByTestId('online-session-id').fill(`hs-A-${Date.now()}`);
      await pageA.getByTestId('online-color-select').selectOption('red');
      await pageB.getByTestId('online-session-id').fill(`hs-B-${Date.now()}`);
      await pageB.getByTestId('online-color-select').selectOption('blue');
      await pageA.getByTestId('online-find-match').click();
      await pageB.getByTestId('online-find-match').click();
      await expect(pageA.getByTestId('online-phase')).toHaveText('connected', { timeout: 15_000 });
      await expect(pageA.getByTestId('online-board-phase')).toHaveText('main');

      // Helper: click action by type on a given page.
      const click = async (page: Page, type: string): Promise<boolean> => {
        const s = await captureSnapshot(page);
        const act = s.actions.find((a) => a.type === type);
        if (act === undefined) return false;
        await page.getByTestId(act.testId).click();
        await page.waitForTimeout(300);
        return true;
      };

      // ── Turn 1 setup ─────────────────────────────────────────────
      report('--- Turn 1: A END_TURN, B (try play) END_TURN ---');
      await click(pageA, 'END_TURN');
      await pageA.waitForTimeout(500);
      // B may have a PLAY_CARD; pick first.
      const sB1 = await captureSnapshot(pageB);
      const bPlay = sB1.actions.find((a) => a.type === 'PLAY_CARD');
      if (bPlay !== undefined) {
        report(`B plays ${bPlay.label}`);
        await pageB.getByTestId(bPlay.testId).click();
        await pageB.waitForTimeout(500);
      }
      await click(pageB, 'END_TURN');
      await pageA.waitForTimeout(500);

      // ── Case 1: A attacks → B is defender ──────────────────────
      report('\n=== CASE 1: A attacks B leader → B is defender ===');
      const sA2 = await captureSnapshot(pageA);
      const aAttack = sA2.actions.find((a) => a.type === 'DECLARE_ATTACK');
      if (aAttack === undefined) {
        report('A has no DECLARE_ATTACK on turn 2 — STOP case 1');
      } else {
        await pageA.getByTestId(aAttack.testId).click();
        await pageA.waitForTimeout(400);
        await shot(pageB, 'case1_B_defender_block_window');
        await shot(pageA, 'case1_A_attacker_block_window');
        const sBdef = await snap(pageB, 'CASE 1: B-as-defender block_window');
        const sAatk = await snap(pageA, 'CASE 1: A-as-attacker view during block_window');
        cases.push({
          seat: 'B',
          attackerSeat: 'A',
          phase: sBdef.phase,
          defenderLegalActionTypes: sBdef.actions.map((a) => a.type),
          defenderHasSKIP_BLOCKER: sBdef.actions.some((a) => a.type === 'SKIP_BLOCKER'),
          defenderHasDECLARE_BLOCKER: sBdef.actions.some((a) => a.type === 'DECLARE_BLOCKER'),
          defenderHasSKIP_COUNTER: sBdef.actions.some((a) => a.type === 'SKIP_COUNTER'),
          defenderHasPLAY_COUNTER: sBdef.actions.some((a) => a.type === 'PLAY_COUNTER'),
          attackerLegalActionTypes: sAatk.actions.map((a) => a.type),
          attackerOnlyConcede: sAatk.actions.length === 1 && sAatk.actions[0]!.type === 'CONCEDE',
          pendingBannerOnDefender: sBdef.pendingBanner !== null,
          pendingBannerOnAttacker: sAatk.pendingBanner !== null,
        });

        // Drive B through SKIP_BLOCKER → counter_window → capture B counter view.
        const okSB = await click(pageB, 'SKIP_BLOCKER');
        report(`B SKIP_BLOCKER click? ${okSB}`);
        await pageA.waitForTimeout(400);
        const sBCounter = await snap(pageB, 'CASE 1: B-as-defender counter_window');
        const sACounter = await snap(pageA, 'CASE 1: A-as-attacker view during counter_window');
        cases.push({
          seat: 'B',
          attackerSeat: 'A',
          phase: sBCounter.phase,
          defenderLegalActionTypes: sBCounter.actions.map((a) => a.type),
          defenderHasSKIP_BLOCKER: false,
          defenderHasDECLARE_BLOCKER: false,
          defenderHasSKIP_COUNTER: sBCounter.actions.some((a) => a.type === 'SKIP_COUNTER'),
          defenderHasPLAY_COUNTER: sBCounter.actions.some((a) => a.type === 'PLAY_COUNTER'),
          attackerLegalActionTypes: sACounter.actions.map((a) => a.type),
          attackerOnlyConcede: sACounter.actions.length === 1 && sACounter.actions[0]!.type === 'CONCEDE',
          pendingBannerOnDefender: sBCounter.pendingBanner !== null,
          pendingBannerOnAttacker: sACounter.pendingBanner !== null,
        });

        // Drain to main.
        if (sBCounter.phase === 'counter_window') {
          await click(pageB, 'SKIP_COUNTER');
          await pageA.waitForTimeout(400);
        }
        // If trigger_window opens, B (defender) resolves; capture.
        const sPostDamage = await captureSnapshot(pageB);
        if (sPostDamage.phase === 'trigger_window') {
          await snap(pageB, 'CASE 1: B-as-defender trigger_window');
          await snap(pageA, 'CASE 1: A view during B trigger_window');
          await click(pageB, 'RESOLVE_TRIGGER');
          await pageA.waitForTimeout(400);
        }
      }

      // End A's turn → B's turn 2 → B attacks A.
      report('\n--- A END_TURN; B turn 2 ---');
      await click(pageA, 'END_TURN');
      await pageA.waitForTimeout(500);

      // ── Case 2: B attacks → A is defender ──────────────────────
      report('\n=== CASE 2: B attacks A leader → A is defender ===');
      const sB2 = await captureSnapshot(pageB);
      const bAttack = sB2.actions.find((a) => a.type === 'DECLARE_ATTACK');
      if (bAttack === undefined) {
        report('B has no DECLARE_ATTACK on B turn 2 — STOP case 2');
      } else {
        await pageB.getByTestId(bAttack.testId).click();
        await pageA.waitForTimeout(400);
        await shot(pageA, 'case2_A_defender_block_window');
        await shot(pageB, 'case2_B_attacker_block_window');
        const sAdef = await snap(pageA, 'CASE 2: A-as-defender block_window');
        const sBatk = await snap(pageB, 'CASE 2: B-as-attacker view during block_window');
        cases.push({
          seat: 'A',
          attackerSeat: 'B',
          phase: sAdef.phase,
          defenderLegalActionTypes: sAdef.actions.map((a) => a.type),
          defenderHasSKIP_BLOCKER: sAdef.actions.some((a) => a.type === 'SKIP_BLOCKER'),
          defenderHasDECLARE_BLOCKER: sAdef.actions.some((a) => a.type === 'DECLARE_BLOCKER'),
          defenderHasSKIP_COUNTER: sAdef.actions.some((a) => a.type === 'SKIP_COUNTER'),
          defenderHasPLAY_COUNTER: sAdef.actions.some((a) => a.type === 'PLAY_COUNTER'),
          attackerLegalActionTypes: sBatk.actions.map((a) => a.type),
          attackerOnlyConcede: sBatk.actions.length === 1 && sBatk.actions[0]!.type === 'CONCEDE',
          pendingBannerOnDefender: sAdef.pendingBanner !== null,
          pendingBannerOnAttacker: sBatk.pendingBanner !== null,
        });

        // A SKIP_BLOCKER → counter view.
        const okSA = await click(pageA, 'SKIP_BLOCKER');
        report(`A SKIP_BLOCKER click? ${okSA}`);
        await pageA.waitForTimeout(400);
        const sACounter = await snap(pageA, 'CASE 2: A-as-defender counter_window');
        const sBCounter = await snap(pageB, 'CASE 2: B-as-attacker view during counter_window');
        cases.push({
          seat: 'A',
          attackerSeat: 'B',
          phase: sACounter.phase,
          defenderLegalActionTypes: sACounter.actions.map((a) => a.type),
          defenderHasSKIP_BLOCKER: false,
          defenderHasDECLARE_BLOCKER: false,
          defenderHasSKIP_COUNTER: sACounter.actions.some((a) => a.type === 'SKIP_COUNTER'),
          defenderHasPLAY_COUNTER: sACounter.actions.some((a) => a.type === 'PLAY_COUNTER'),
          attackerLegalActionTypes: sBCounter.actions.map((a) => a.type),
          attackerOnlyConcede: sBCounter.actions.length === 1 && sBCounter.actions[0]!.type === 'CONCEDE',
          pendingBannerOnDefender: sACounter.pendingBanner !== null,
          pendingBannerOnAttacker: sBCounter.pendingBanner !== null,
        });

        if (sACounter.phase === 'counter_window') {
          await click(pageA, 'SKIP_COUNTER');
          await pageA.waitForTimeout(400);
        }
        const sPostDamage = await captureSnapshot(pageA);
        if (sPostDamage.phase === 'trigger_window') {
          await snap(pageA, 'CASE 2: A-as-defender trigger_window');
          await snap(pageB, 'CASE 2: B view during A trigger_window');
          await click(pageA, 'RESOLVE_TRIGGER');
          await pageA.waitForTimeout(400);
        }
      }

      // ── Matrix output ──
      report('\n=== A-vs-B REACTIVE MATRIX ===');
      for (const c of cases) {
        report(
          `[seat=${c.seat} attacker=${c.attackerSeat} phase=${c.phase}] ` +
            `defenderActions=[${c.defenderLegalActionTypes.join(',')}] ` +
            `SKIP_BLOCKER=${c.defenderHasSKIP_BLOCKER} DECLARE_BLOCKER=${c.defenderHasDECLARE_BLOCKER} ` +
            `SKIP_COUNTER=${c.defenderHasSKIP_COUNTER} PLAY_COUNTER=${c.defenderHasPLAY_COUNTER} ` +
            `pendingBanner=${c.pendingBannerOnDefender}`,
        );
        report(
          `  attacker view: actions=[${c.attackerLegalActionTypes.join(',')}] onlyConcede=${c.attackerOnlyConcede} pendingBanner=${c.pendingBannerOnAttacker}`,
        );
      }
    } finally {
      const rp = testInfo.outputPath('human-side-reactive-report.txt');
      fs.writeFileSync(rp, reportLines.join('\n'), 'utf8');
      report(`\nReport written to: ${path.basename(rp)}`);
      await ctxA.close();
      await ctxB.close();
    }
  });
});
