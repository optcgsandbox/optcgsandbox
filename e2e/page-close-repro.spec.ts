// page-close-repro — Phase 7 isolation. Identify what closes the Playwright
// page during long gameplay. Combines tasks A + B + C from the directive:
//   A. Comprehensive lifecycle event logging.
//   B. Bypass PlayerDriver.chooseOption — click prompt buttons directly.
//   C. Launch Chromium with stability flags (--disable-renderer-backgrounding
//      etc.) via test.use launchOptions.
//
// Per directive 2026-06-05: harness-only. No engine/UI/card-data changes.

import { test, expect, type Page } from '@playwright/test';
import { PlayerDriver } from './helpers/player';

test.use({
  launchOptions: {
    args: [
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--disable-dev-shm-usage',
      '--no-sandbox',
    ],
  },
  video: 'retain-on-failure',
  trace: 'retain-on-failure',
  screenshot: 'only-on-failure',
});

interface Evt { t: number; kind: string; detail?: string; lastAction?: string; }

test('page-close-repro: single match with full lifecycle instrumentation', async ({ page, browser, context }) => {
  test.setTimeout(15 * 60_000);

  const events: Evt[] = [];
  const t0 = Date.now();
  const stamp = (): number => Date.now() - t0;
  let lastAction = 'init';
  const setAction = (a: string): void => {
    lastAction = a;
    events.push({ t: stamp(), kind: 'action.start', detail: a });
  };

  // ── A. lifecycle event logging ────────────────────────────────────
  page.on('close', () => events.push({ t: stamp(), kind: 'page.close', lastAction }));
  page.on('crash', () => events.push({ t: stamp(), kind: 'page.crash', lastAction }));
  page.on('pageerror', (err) => events.push({ t: stamp(), kind: 'pageerror', detail: err.message.slice(0, 200), lastAction }));
  page.on('requestfailed', (req) => events.push({ t: stamp(), kind: 'requestfailed', detail: `${req.method()} ${req.url().slice(0, 120)} ${req.failure()?.errorText ?? '?'}`, lastAction }));
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) events.push({ t: stamp(), kind: 'framenavigated', detail: frame.url(), lastAction });
  });
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.toLowerCase().includes('[vite]') || text.includes('InvariantError') || msg.type() === 'error') {
      events.push({ t: stamp(), kind: 'console.' + msg.type(), detail: text.slice(0, 200), lastAction });
    }
  });
  try {
    context.on('close', () => events.push({ t: stamp(), kind: 'context.close', lastAction }));
    browser.on('disconnected', () => events.push({ t: stamp(), kind: 'browser.disconnected', lastAction }));
  } catch {}

  // ── bootstrap ─────────────────────────────────────────────────────
  setAction('bootstrap.open');
  const drv = new PlayerDriver(page);
  await drv.open();
  setAction('bootstrap.dice');
  await drv.waitForPhase('dice_roll');
  await drv.rollDice();
  setAction('bootstrap.firstPlayer');
  try { await drv.waitForPhase('first_player_choice', 15_000); await drv.chooseGoFirst(); } catch {}
  setAction('bootstrap.mulligan');
  try { await drv.waitForPhase('mulligan', 8_000); await drv.keepMulliganHand(); } catch {}
  setAction('bootstrap.waitForAMain');
  await expect.poll(
    async () => {
      const s = await drv.getState();
      return { phase: s.phase, activePlayer: s.activePlayer };
    },
    { timeout: 60_000 },
  ).toMatchObject({ phase: 'main', activePlayer: 'A' });
  events.push({ t: stamp(), kind: 'bootstrap.done' });

  // ── play 1 match up to 20 turns, bypassing chooseOption ──────────
  let turnsCompleted = 0;
  let endedNaturally = false;
  for (let turn = 0; turn < 20; turn += 1) {
    setAction(`turn ${turn}.checkState`);
    const cur = await drv.getState().catch((e: Error) => { events.push({ t: stamp(), kind: 'getState.threw', detail: e.message.slice(0, 120), lastAction }); return null; });
    if (cur === null) break;
    if (cur.result) { endedNaturally = true; break; }

    setAction(`turn ${turn}.playCard`);
    try { await drv.playCard((turn) % 2); } catch (e) { events.push({ t: stamp(), kind: 'playCard.threw', detail: (e as Error).message.slice(0, 120), lastAction }); }

    // B. bypass chooseOption — direct prompt button click.
    setAction(`turn ${turn}.resolvePromptDirect`);
    try {
      const choosePrompt = page.locator('[data-pending-kind="choose_one"]').first();
      if (await choosePrompt.isVisible({ timeout: 500 }).catch(() => false)) {
        const firstOption = page.locator('button[aria-label^="Choose option 1:"]').first();
        if (await firstOption.isVisible({ timeout: 500 }).catch(() => false)) {
          await firstOption.click({ timeout: 2_000 });
        }
      }
    } catch (e) { events.push({ t: stamp(), kind: 'promptResolve.threw', detail: (e as Error).message.slice(0, 120), lastAction }); }

    // Close any leftover CardDetailModal so endTurn can fire.
    setAction(`turn ${turn}.closeModal`);
    try {
      const closeBtn = page.locator('button:has-text("CLOSE")').first();
      if (await closeBtn.isVisible({ timeout: 300 }).catch(() => false)) {
        await closeBtn.click({ timeout: 1_500 });
      }
    } catch {}

    setAction(`turn ${turn}.attack`);
    try {
      const own = page.locator('[aria-label*="(leader)" i]').last();
      if (await own.isVisible({ timeout: 500 }).catch(() => false)) {
        await own.click({ timeout: 2_000 });
        const sel = page.locator('button:has-text("SELECT AS ATTACKER")').first();
        if (await sel.isVisible({ timeout: 500 }).catch(() => false)) {
          await sel.click({ timeout: 2_000 });
          const opp = page.locator('[aria-label*="(leader)" i]').first();
          if (await opp.isVisible({ timeout: 500 }).catch(() => false)) {
            await opp.click({ timeout: 2_000 });
            const atk = page.locator('button:has-text("ATTACK THIS")').first();
            if (await atk.isVisible({ timeout: 500 }).catch(() => false)) {
              await atk.click({ timeout: 2_000 });
            }
          }
        }
      }
    } catch (e) { events.push({ t: stamp(), kind: 'attack.threw', detail: (e as Error).message.slice(0, 120), lastAction }); }

    setAction(`turn ${turn}.endTurn`);
    try { await drv.endTurn(); } catch (e) { events.push({ t: stamp(), kind: 'endTurn.threw', detail: (e as Error).message.slice(0, 120), lastAction }); break; }

    setAction(`turn ${turn}.waitForAControl`);
    try {
      await expect.poll(
        async () => {
          const s = await drv.getState();
          if (s.result) return { phase: 'over', activePlayer: 'over' };
          return { phase: s.phase, activePlayer: s.activePlayer };
        },
        { timeout: 90_000 },
      ).toMatchObject({ phase: 'main', activePlayer: 'A' });
    } catch (e) {
      events.push({ t: stamp(), kind: 'waitForAControl.failed', detail: (e as Error).message.slice(0, 120), lastAction });
      break;
    }
    turnsCompleted = turn + 1;

    const after = await drv.getState().catch(() => null);
    if (after?.result) { endedNaturally = true; break; }
  }

  // ── print report ──────────────────────────────────────────────────
  // eslint-disable-next-line no-console
  console.log('=== PAGE_CLOSE_REPRO REPORT ===');
  // eslint-disable-next-line no-console
  console.log(`turnsCompleted: ${turnsCompleted}`);
  // eslint-disable-next-line no-console
  console.log(`endedNaturally: ${endedNaturally}`);
  // eslint-disable-next-line no-console
  console.log(`lastAction at end: ${lastAction}`);
  // eslint-disable-next-line no-console
  console.log('--- last 40 lifecycle events ---');
  for (const e of events.slice(-40)) {
    // eslint-disable-next-line no-console
    console.log(`  [${e.t}ms] ${e.kind}${e.detail ? ' | ' + e.detail : ''}${e.lastAction ? ' | during=' + e.lastAction : ''}`);
  }
  // eslint-disable-next-line no-console
  console.log('=== END REPORT ===');
});
