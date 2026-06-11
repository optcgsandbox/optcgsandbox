// single-match-isolation — Phase 7 long single-match stability run.
// Combines harness stabilization from page-close-repro with END-TURN
// resilience so the test can survive a single missing button without
// killing the page. Runs ONE match for up to 20 turns or natural
// game-over. Reports lifecycle + per-turn metrics.
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
interface TurnMetric { turn: number; phase: string; activePlayer: string; pendingKind: string | null; cardsPlayed: number; attacks: number; promptsResolved: number; }

test('single-match-isolation: one long match under stabilized harness', async ({ page, browser, context }) => {
  test.setTimeout(15 * 60_000);

  const events: Evt[] = [];
  const turnMetrics: TurnMetric[] = [];
  const t0 = Date.now();
  const stamp = (): number => Date.now() - t0;
  let lastAction = 'init';
  const setAction = (a: string): void => { lastAction = a; events.push({ t: stamp(), kind: 'action.start', detail: a }); };
  let pageCloses = 0;
  let crashes = 0;
  let contextCloses = 0;
  let browserDisconnects = 0;
  let pageErrors = 0;
  let totalCardsPlayed = 0;
  let totalAttacks = 0;
  let totalPromptsResolved = 0;

  // ── lifecycle logging ─────────────────────────────────────────────
  page.on('close', () => { pageCloses += 1; events.push({ t: stamp(), kind: 'page.close', lastAction }); });
  page.on('crash', () => { crashes += 1; events.push({ t: stamp(), kind: 'page.crash', lastAction }); });
  page.on('pageerror', (err) => { pageErrors += 1; events.push({ t: stamp(), kind: 'pageerror', detail: err.message.slice(0, 200), lastAction }); });
  page.on('requestfailed', (req) => events.push({ t: stamp(), kind: 'requestfailed', detail: `${req.method()} ${req.url().slice(0, 120)} ${req.failure()?.errorText ?? '?'}`, lastAction }));
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) events.push({ t: stamp(), kind: 'framenavigated', detail: frame.url(), lastAction });
  });
  page.on('load', () => events.push({ t: stamp(), kind: 'load', lastAction }));
  page.on('domcontentloaded', () => events.push({ t: stamp(), kind: 'domcontentloaded', lastAction }));
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.toLowerCase().includes('[vite]') || text.includes('InvariantError') || msg.type() === 'error' || msg.type() === 'warning') {
      events.push({ t: stamp(), kind: 'console.' + msg.type(), detail: text.slice(0, 200), lastAction });
    }
  });
  try {
    context.on('close', () => { contextCloses += 1; events.push({ t: stamp(), kind: 'context.close', lastAction }); });
    browser.on('disconnected', () => { browserDisconnects += 1; events.push({ t: stamp(), kind: 'browser.disconnected', lastAction }); });
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

  // ── helpers ───────────────────────────────────────────────────────
  async function closeAnyOpenModal(): Promise<void> {
    try {
      const closeBtn = page.locator('button:has-text("CLOSE")').first();
      if (await closeBtn.isVisible({ timeout: 300 }).catch(() => false)) {
        await closeBtn.click({ timeout: 1_500 });
        await page.waitForTimeout(150);
      }
    } catch {}
  }
  // Direct-click prompt resolver — NO PlayerDriver.chooseOption.
  async function resolveAnyPromptDirect(): Promise<boolean> {
    try {
      const choose = page.locator('[data-pending-kind="choose_one"]').first();
      if (await choose.isVisible({ timeout: 300 }).catch(() => false)) {
        const first = page.locator('button[aria-label^="Choose option 1:"]').first();
        if (await first.isVisible({ timeout: 300 }).catch(() => false)) {
          await first.click({ timeout: 1_500 });
          return true;
        }
      }
    } catch {}
    return false;
  }
  // END-TURN resilient click: scan, modal-close, AI wait, retry once.
  // Returns: 'clicked' | 'missing_button_classified' | 'state_anomaly'.
  async function resilientEndTurn(): Promise<'clicked' | 'missing_button_classified' | 'state_anomaly'> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const btn = page.locator('button[aria-label="END TURN"]').first();
      if (await btn.isVisible({ timeout: 1_000 }).catch(() => false)) {
        try { await btn.click({ timeout: 2_000 }); return 'clicked'; } catch {}
      }
      await closeAnyOpenModal();
      await page.waitForTimeout(2_000);
      const s = await drv.getState().catch(() => null);
      if (s === null) return 'state_anomaly';
      if (s.activePlayer === 'B') {
        // AI thinking — wait for control to return.
        try {
          await expect.poll(
            async () => {
              const s2 = await drv.getState();
              return { phase: s2.phase, activePlayer: s2.activePlayer, result: s2.result };
            },
            { timeout: 60_000 },
          ).toMatchObject({ phase: 'main', activePlayer: 'A' });
        } catch { return 'state_anomaly'; }
        continue; // retry endTurn now that A is back
      }
      // activePlayer === A and still no button → next iteration will retry once.
    }
    return 'missing_button_classified';
  }

  // ── play 1 match up to 20 turns ──────────────────────────────────
  let turnsCompleted = 0;
  let endedNaturally = false;
  let blocker: string | null = null;

  for (let turn = 0; turn < 20; turn += 1) {
    setAction(`turn ${turn}.checkState`);
    const cur = await drv.getState().catch((e: Error) => { events.push({ t: stamp(), kind: 'getState.threw', detail: e.message.slice(0, 120), lastAction }); return null; });
    if (cur === null) { blocker = 'getState_threw'; break; }
    if (cur.result) { endedNaturally = true; break; }

    let cardsThisTurn = 0;
    let attacksThisTurn = 0;
    let promptsThisTurn = 0;

    setAction(`turn ${turn}.playCard`);
    try {
      const ok = await drv.playCard(turn % 2);
      if (ok) { cardsThisTurn += 1; totalCardsPlayed += 1; }
    } catch (e) { events.push({ t: stamp(), kind: 'playCard.threw', detail: (e as Error).message.slice(0, 120), lastAction }); }

    setAction(`turn ${turn}.resolvePrompt`);
    if (await resolveAnyPromptDirect()) { promptsThisTurn += 1; totalPromptsResolved += 1; }
    await closeAnyOpenModal();

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
              attacksThisTurn += 1; totalAttacks += 1;
              await page.waitForTimeout(2_500);
            }
          }
        }
      }
    } catch (e) { events.push({ t: stamp(), kind: 'attack.threw', detail: (e as Error).message.slice(0, 120), lastAction }); }

    setAction(`turn ${turn}.endTurn`);
    const endResult = await resilientEndTurn();
    if (endResult === 'missing_button_classified') {
      const s = await drv.getState().catch(() => null);
      events.push({ t: stamp(), kind: 'MISSING_BUTTON_classified', detail: `phase=${s?.phase} ap=${s?.activePlayer} pending=${s?.pendingKind}`, lastAction });
      blocker = 'MISSING_BUTTON'; break;
    }
    if (endResult === 'state_anomaly') {
      blocker = 'STATE_ANOMALY'; break;
    }

    // Record per-turn metric.
    const before = cur;
    turnMetrics.push({
      turn,
      phase: before.phase,
      activePlayer: before.activePlayer,
      pendingKind: before.pendingKind ?? null,
      cardsPlayed: cardsThisTurn,
      attacks: attacksThisTurn,
      promptsResolved: promptsThisTurn,
    });

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
      blocker = 'AI_TIME_BUDGET'; break;
    }
    turnsCompleted = turn + 1;
    const final = await drv.getState().catch(() => null);
    if (final?.result) { endedNaturally = true; break; }
  }

  // ── final state ──────────────────────────────────────────────────
  const finalState = await drv.getState().catch(() => ({ phase: '?', activePlayer: '?', pendingKind: null as string | null, result: null }));

  // ── print report ─────────────────────────────────────────────────
  // eslint-disable-next-line no-console
  console.log('=== SINGLE_MATCH_ISOLATION REPORT ===');
  console.log(`completed: ${endedNaturally || turnsCompleted >= 20}`);
  console.log(`turnsCompleted: ${turnsCompleted}`);
  console.log(`endedNaturally: ${endedNaturally}`);
  console.log(`blocker: ${blocker ?? 'none'}`);
  console.log(`finalState: phase=${finalState.phase} activePlayer=${finalState.activePlayer} pendingKind=${finalState.pendingKind} result=${JSON.stringify(finalState.result)}`);
  console.log(`pageCloses=${pageCloses} crashes=${crashes} contextCloses=${contextCloses} browserDisconnects=${browserDisconnects} pageErrors=${pageErrors}`);
  console.log(`totalCardsPlayed=${totalCardsPlayed} totalAttacks=${totalAttacks} totalPromptsResolved=${totalPromptsResolved}`);
  console.log(`lastAction at end: ${lastAction}`);
  console.log('--- per-turn metrics ---');
  for (const m of turnMetrics) {
    console.log(`  turn=${m.turn} phase=${m.phase} ap=${m.activePlayer} pending=${m.pendingKind ?? 'null'} cards=${m.cardsPlayed} attacks=${m.attacks} prompts=${m.promptsResolved}`);
  }
  console.log('--- last 30 lifecycle events ---');
  for (const e of events.slice(-30)) {
    console.log(`  [${e.t}ms] ${e.kind}${e.detail ? ' | ' + e.detail : ''}${e.lastAction ? ' | during=' + e.lastAction : ''}`);
  }
  console.log('=== END REPORT ===');
});
