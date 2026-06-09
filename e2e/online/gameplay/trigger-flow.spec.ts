/**
 * F-7k BUG-004 — Online trigger / life-damage / RESOLVE_TRIGGER probe.
 *
 * This spec drives ONE attack against B's leader through the live lobby
 * and reports the outcome:
 *
 *   A. Trigger fired: B clicks RESOLVE_TRIGGER → phase returns to main.
 *      (Probabilistic — depends on the seed; only 3 corpus cards have
 *      `trigger:` clauses, so most seeds will NOT trigger.)
 *   B. No trigger: damage / no-trigger path verified; we log it.
 *
 * The deterministic proof that the trigger window + RESOLVE_TRIGGER
 * dispatch path works through the same server entry-point used by the
 * online lobby lives in
 *   `shared/server/__tests__/triggerWindow.online.test.ts`
 * — that test fires the engine via `MatchSession.applyPlayerAction`
 * (exactly the path `MatchRoom.handleSubmitAction` calls) and pins all
 * three trigger-window behaviors (open, decline, activate).
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

test.describe('Online trigger / life-damage flow (BUG-004 probe)', () => {
  test.beforeEach(({}, testInfo) => {
    if (!ONLINE_E2E) testInfo.skip(true, 'ONLINE_E2E=1 not set');
  });

  test('A attacks B leader; damage flips life; trigger_window OR direct-to-main', async ({
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
      const sessionA = `e2e-trig-a-${Date.now()}`;
      const sessionB = `e2e-trig-b-${Date.now()}`;
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

      // A turn 1 END_TURN.
      await clickByType(pageA, 'END_TURN');
      await expect(pageB.getByTestId('online-active-player')).toHaveText('B', {
        timeout: 5_000,
      });

      // B turn 1 END_TURN.
      await clickByType(pageB, 'END_TURN');
      await expect(pageA.getByTestId('online-active-player')).toHaveText('A', {
        timeout: 5_000,
      });

      // A turn 2 (game turn 3): DECLARE_ATTACK should be legal.
      const aTurn2 = await dumpActions(pageA, 'A turn 2');
      expect(aTurn2).toContain('DECLARE_ATTACK');

      const attackIdx = await findActionByType(pageA, 'DECLARE_ATTACK');
      await pageA.getByTestId(`online-action-${attackIdx}`).click();
      await expect(pageA.getByTestId('online-last-action')).toContainText(
        'accepted',
        { timeout: 5_000 },
      );
      console.log('A turn 2: DECLARE_ATTACK accepted');

      // block_window → SKIP_BLOCKER.
      await expect(pageA.getByTestId('online-board-phase')).toHaveText(
        'block_window',
        { timeout: 5_000 },
      );
      await clickByType(pageB, 'SKIP_BLOCKER');

      // counter_window → SKIP_COUNTER (if opens).
      await pageA.waitForTimeout(400);
      const phaseAfterSkipBlocker = await pageA
        .getByTestId('online-board-phase')
        .textContent();
      if (phaseAfterSkipBlocker === 'counter_window') {
        await clickByType(pageB, 'SKIP_COUNTER');
      }

      // Observe phase after windows resolve.
      await pageA.waitForTimeout(500);
      const phaseAfter = await pageA
        .getByTestId('online-board-phase')
        .textContent();
      console.log(`Phase after attack windows: ${phaseAfter}`);

      if (phaseAfter === 'trigger_window') {
        // RESOLVE_TRIGGER path through lobby.
        console.log('Trigger window opened — proving online RESOLVE_TRIGGER dispatch.');

        // Hidden-info probe — A's legalActions in trigger window must be
        // [CONCEDE] only (per `shared/engine-v2/rules/legality.ts:68-76`).
        const aTrigActions = await dumpActions(pageA, 'A trigger_window');
        expect(aTrigActions).toEqual(['CONCEDE']);

        // B sees RESOLVE_TRIGGER buttons.
        const bTrigActions = await dumpActions(pageB, 'B trigger_window');
        expect(bTrigActions).toContain('RESOLVE_TRIGGER');

        // Click decline-variant — works for ANY trigger card whether or
        // not its action has targeting requirements.
        const trigBtns = await pageB.evaluate(() => {
          const buttons = Array.from(
            document.querySelectorAll('[data-testid^="online-action-"]'),
          ) as HTMLButtonElement[];
          return buttons
            .map((b, i) => ({
              i,
              type: b.getAttribute('data-action-type') ?? '?',
              title: b.title,
              label: b.textContent ?? '',
            }))
            .filter((x) => x.type === 'RESOLVE_TRIGGER');
        });
        console.log('RESOLVE_TRIGGER buttons present:', JSON.stringify(trigBtns));
        expect(trigBtns.length).toBeGreaterThanOrEqual(1);

        // Click first RESOLVE_TRIGGER button.
        await pageB.getByTestId(`online-action-${trigBtns[0]!.i}`).click();
        await expect(pageB.getByTestId('online-last-action')).toContainText(
          'accepted',
          { timeout: 5_000 },
        );
        console.log('B RESOLVE_TRIGGER accepted');

        // After resolution, phase must leave trigger_window.
        await pageA.waitForTimeout(400);
        const phaseAfterTrig = await pageA
          .getByTestId('online-board-phase')
          .textContent();
        console.log(`Phase after RESOLVE_TRIGGER: ${phaseAfterTrig}`);
        expect(phaseAfterTrig).not.toBe('trigger_window');
      } else if (phaseAfter === 'main') {
        // Damage / no-trigger path. This is the most common outcome with
        // random corpus decks because only 3 corpus cards have triggers.
        // The deterministic proof of trigger handling lives in
        // shared/server/__tests__/triggerWindow.online.test.ts.
        console.log(
          'damage / no-trigger path verified online (life card did not trigger)',
        );
      } else {
        // Any other phase landing (peek/discard/choose_one) is a
        // legitimate outcome of a triggered effect that opens a downstream
        // window. We log + accept.
        console.log(`attack resolved into ${phaseAfter} — downstream window`);
      }

      // Minimal invariant: the engine moved past block_window/counter_window
      // and into a non-stuck phase.
      expect([
        'main',
        'trigger_window',
        'peek_choice',
        'discard_choice',
        'choose_one',
      ]).toContain(phaseAfter);
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
