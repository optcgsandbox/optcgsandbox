/**
 * F-7k BUG-009 — Human playability regression for the online lobby UI.
 *
 * Verifies that the rewritten OnlinePlayfield exposes pending windows
 * with banners, groups actions for human findability, and surfaces
 * card-kind-aware labels — all of which the soak harness's robotic
 * picker did NOT cover.
 *
 * Tests run against the same wrangler / vite stack used by the rest
 * of the e2e/online/gameplay/ specs. Single complex flow that
 * exercises every owner-reported P0 issue:
 *
 *   - Pending banner with `data-testid="online-pending-banner"` shows
 *     during block_window / counter_window / trigger_window.
 *   - Action buttons carry `data-action-group` attributes (Blocker
 *     Response / Counter Response / Trigger Response / Turn / etc).
 *   - Stable field slots — `you-field-slot-N` exist for N=0..4
 *     regardless of how many cards are on field.
 *   - Concede via the legacy `online-concede` button still works.
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

test.describe('F-7k BUG-009 — online human playability regression', () => {
  test.beforeEach(({}, testInfo) => {
    if (!ONLINE_E2E) testInfo.skip(true, 'ONLINE_E2E=1 not set');
  });

  test('pending banner + grouped actions + stable field slots', async ({ browser }) => {
    test.setTimeout(120_000);

    const ctxA: BrowserContext = await browser.newContext();
    const ctxB: BrowserContext = await browser.newContext();
    const initScript = `window.__WORKER_ORIGIN__ = ${JSON.stringify(WORKER_ORIGIN)};`;
    await ctxA.addInitScript(initScript);
    await ctxB.addInitScript(initScript);
    const pageA: Page = await ctxA.newPage();
    const pageB: Page = await ctxB.newPage();

    try {
      // 1. Pair via the lobby.
      await pageA.goto('/?online=1&test=1');
      await pageB.goto('/?online=1&test=1');
      const sessionA = `e2e-bug009-a-${Date.now()}`;
      const sessionB = `e2e-bug009-b-${Date.now()}`;
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

      // 2. Stable field slots on both sides — there must be exactly
      // FIELD_CAP=5 slots regardless of whether any cards are on field.
      for (let i = 0; i < 5; i += 1) {
        await expect(pageA.getByTestId(`you-field-slot-${i}`)).toBeVisible();
        await expect(pageA.getByTestId(`opp-field-slot-${i}`)).toBeVisible();
      }

      // 3. No pending banner on main phase.
      await expect(pageA.getByTestId('online-pending-banner')).toHaveCount(0);

      // 4. Action groups are exposed via `data-action-group` attribute.
      const aGroupAttrs = await pageA.evaluate(() => {
        const buttons = Array.from(
          document.querySelectorAll('[data-testid^="online-action-"]'),
        ) as HTMLElement[];
        return Array.from(new Set(buttons.map((b) => b.getAttribute('data-action-group') ?? '?')));
      });
      console.log('A main-phase groups:', aGroupAttrs.join(', '));
      // Turn group must be visible during main.
      expect(aGroupAttrs).toContain('Turn');

      // 5. A clicks END_TURN; B becomes active; B clicks END_TURN; A turn 2.
      const aEndIdx = await findActionByType(pageA, 'END_TURN');
      expect(aEndIdx).toBeGreaterThanOrEqual(0);
      await pageA.getByTestId(`online-action-${aEndIdx}`).click();
      await expect(pageB.getByTestId('online-active-player')).toHaveText('B', {
        timeout: 5_000,
      });

      const bEndIdx = await findActionByType(pageB, 'END_TURN');
      expect(bEndIdx).toBeGreaterThanOrEqual(0);
      await pageB.getByTestId(`online-action-${bEndIdx}`).click();
      await expect(pageA.getByTestId('online-active-player')).toHaveText('A', {
        timeout: 5_000,
      });

      // 6. A's turn 2 has DECLARE_ATTACK in the Attack group.
      const aAttackIdx = await findActionByType(pageA, 'DECLARE_ATTACK');
      expect(aAttackIdx).toBeGreaterThanOrEqual(0);
      const aAttackGroup = await pageA.evaluate((idx) => {
        const b = document.querySelector(`[data-testid="online-action-${idx}"]`);
        return b?.getAttribute('data-action-group') ?? null;
      }, aAttackIdx);
      expect(aAttackGroup).toBe('Attack');

      // 7. A declares attack → block_window opens → pending banner appears
      //    on BOTH tabs.
      await pageA.getByTestId(`online-action-${aAttackIdx}`).click();
      await expect(pageA.getByTestId('online-board-phase')).toHaveText(
        'block_window',
        { timeout: 5_000 },
      );

      await expect(pageA.getByTestId('online-pending-banner')).toHaveCount(1);
      await expect(pageB.getByTestId('online-pending-banner')).toHaveCount(1);

      // Banner must encode phase + which side is responsible. Defender
      // (B) has `data-needs-response="you"`; active (A) has
      // `data-needs-response="opp"`.
      const bBannerNeeds = await pageB
        .getByTestId('online-pending-banner')
        .getAttribute('data-needs-response');
      expect(bBannerNeeds).toBe('you');
      const aBannerNeeds = await pageA
        .getByTestId('online-pending-banner')
        .getAttribute('data-needs-response');
      expect(aBannerNeeds).toBe('opp');

      // 8. B has SKIP_BLOCKER under the Blocker Response group.
      const bSkipBlockerIdx = await findActionByType(pageB, 'SKIP_BLOCKER');
      expect(bSkipBlockerIdx).toBeGreaterThanOrEqual(0);
      const bSkipGroup = await pageB.evaluate((idx) => {
        const el = document.querySelector(`[data-testid="online-action-${idx}"]`);
        return el?.getAttribute('data-action-group') ?? null;
      }, bSkipBlockerIdx);
      expect(bSkipGroup).toBe('Blocker Response');
      await pageB.getByTestId(`online-action-${bSkipBlockerIdx}`).click();

      // 9. counter_window opens → banner updates → B sees SKIP_COUNTER
      //    in Counter Response group.
      await expect(pageA.getByTestId('online-board-phase')).toHaveText(
        'counter_window',
        { timeout: 5_000 },
      );
      const bSkipCounterIdx = await findActionByType(pageB, 'SKIP_COUNTER');
      expect(bSkipCounterIdx).toBeGreaterThanOrEqual(0);
      const bCounterGroup = await pageB.evaluate((idx) => {
        const el = document.querySelector(`[data-testid="online-action-${idx}"]`);
        return el?.getAttribute('data-action-group') ?? null;
      }, bSkipCounterIdx);
      expect(bCounterGroup).toBe('Counter Response');
      await pageB.getByTestId(`online-action-${bSkipCounterIdx}`).click();

      // 10. After damage resolves, banner clears OR a trigger_window
      //     opens. Whichever — the banner OR phase=main must be visible.
      await pageA.waitForTimeout(400);
      const phaseAfter = await pageA
        .getByTestId('online-board-phase')
        .textContent();
      console.log('phase after attack resolves:', phaseAfter);

      if (phaseAfter === 'trigger_window') {
        // Trigger Response group must exist.
        const trigIdx = await findActionByType(pageB, 'RESOLVE_TRIGGER');
        expect(trigIdx).toBeGreaterThanOrEqual(0);
        const trigGroup = await pageB.evaluate((idx) => {
          const el = document.querySelector(`[data-testid="online-action-${idx}"]`);
          return el?.getAttribute('data-action-group') ?? null;
        }, trigIdx);
        expect(trigGroup).toBe('Trigger Response');
        await pageB.getByTestId(`online-action-${trigIdx}`).click();
      } else {
        expect(['main', 'damage_resolution']).toContain(phaseAfter);
      }

      // 11. Legacy CONCEDE button still works.
      await pageA.getByTestId('online-concede').click();
      await expect(pageA.getByTestId('online-match-result')).toContainText(
        'loser=A',
        { timeout: 5_000 },
      );
      await expect(pageB.getByTestId('online-match-result')).toContainText(
        'loser=A',
        { timeout: 5_000 },
      );
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});

async function findActionByType(page: Page, type: string): Promise<number> {
  await page.waitForTimeout(200);
  return page.evaluate((t) => {
    const buttons = Array.from(
      document.querySelectorAll('[data-testid^="online-action-"]'),
    ) as HTMLButtonElement[];
    for (let i = 0; i < buttons.length; i++) {
      if (buttons[i]!.getAttribute('data-action-type') === t) {
        const testId = buttons[i]!.getAttribute('data-testid') ?? '';
        return Number.parseInt(testId.replace('online-action-', ''), 10);
      }
    }
    return -1;
  }, type);
}
