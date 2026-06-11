// reset-repro — Phase 7 instrumentation. Reproduce the unexplained
// dice_roll reset that fires during long card-play workflows. Classifies
// the trigger via every available page-lifecycle hook.
//
// Per directive 2026-06-05: harness-only. No engine/UI/card-data changes.

import { test, expect, type Page } from '@playwright/test';
import { PlayerDriver } from './helpers/player';

interface LifecycleEvent {
  t: number;
  kind: string;
  detail?: string;
}

test('reset-repro: classify dice_roll resets during long gameplay', async ({ page, browser }) => {
  test.setTimeout(15 * 60_000); // 15 min budget

  const events: LifecycleEvent[] = [];
  const t0 = Date.now();
  const stamp = (): number => Date.now() - t0;

  // ─── instrumentation ──────────────────────────────────────────────
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      events.push({ t: stamp(), kind: 'framenavigated', detail: frame.url() });
    }
  });
  page.on('load', () => events.push({ t: stamp(), kind: 'load' }));
  page.on('domcontentloaded', () => events.push({ t: stamp(), kind: 'domcontentloaded' }));
  page.on('close', () => events.push({ t: stamp(), kind: 'page.close' }));
  page.on('crash', () => events.push({ t: stamp(), kind: 'page.crash' }));
  page.on('pageerror', (err) => events.push({ t: stamp(), kind: 'pageerror', detail: err.message.slice(0, 200) }));
  page.on('console', (msg) => {
    const text = msg.text();
    const lower = text.toLowerCase();
    if (lower.includes('[vite]') || lower.includes('reload') || lower.includes('reconnect') || lower.includes('hmr')) {
      events.push({ t: stamp(), kind: 'console.vite', detail: text.slice(0, 200) });
    }
    if (text.includes('InvariantError')) {
      events.push({ t: stamp(), kind: 'console.invariant', detail: text.slice(0, 200) });
    }
  });
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('?token=') || url.includes('/?test=1') || url.includes('/__vite_ping')) {
      events.push({ t: stamp(), kind: 'request', detail: req.method() + ' ' + url.slice(0, 120) });
    }
  });
  page.on('response', (res) => {
    if (res.status() >= 500 || res.url().includes('/__vite_ping')) {
      events.push({ t: stamp(), kind: 'response', detail: res.status() + ' ' + res.url().slice(0, 120) });
    }
  });
  try {
    page.context().on('close', () => events.push({ t: stamp(), kind: 'context.close' }));
    browser.on('disconnected', () => events.push({ t: stamp(), kind: 'browser.disconnected' }));
  } catch {}

  // Install client-side instrumentation BEFORE navigation: visibility,
  // beforeunload, pagehide. Run early so we capture the very first event.
  await page.addInitScript(() => {
    (window as unknown as { __reset_repro_log: Array<unknown> }).__reset_repro_log = [];
    const log = (window as unknown as { __reset_repro_log: Array<{ kind: string; t: number; detail?: string }> }).__reset_repro_log;
    const t0 = performance.now();
    const push = (kind: string, detail?: string): void => { log.push({ kind, t: Math.round(performance.now() - t0), detail }); };
    window.addEventListener('beforeunload', () => push('beforeunload'));
    window.addEventListener('pagehide', (e) => push('pagehide', `persisted=${e.persisted}`));
    window.addEventListener('pageshow', (e) => push('pageshow', `persisted=${e.persisted}`));
    document.addEventListener('visibilitychange', () => push('visibilitychange', document.visibilityState));
    // Click instrumentation — capture every button click target.
    document.addEventListener('click', (e) => {
      const tgt = e.target as HTMLElement | null;
      if (!tgt) return;
      const btn = tgt.closest('button');
      if (!btn) return;
      const label = btn.getAttribute('aria-label') ?? btn.textContent?.trim().slice(0, 60) ?? '?';
      push('click', label);
    }, true);
  });

  // ─── bootstrap ────────────────────────────────────────────────────
  const drv = new PlayerDriver(page);
  await drv.open();
  await drv.waitForPhase('dice_roll');
  await drv.rollDice();
  try { await drv.waitForPhase('first_player_choice', 15_000); await drv.chooseGoFirst(); } catch {}
  try { await drv.waitForPhase('mulligan', 8_000); await drv.keepMulliganHand(); } catch {}
  await expect.poll(
    async () => {
      const s = await drv.getState();
      return { phase: s.phase, activePlayer: s.activePlayer };
    },
    { timeout: 60_000 },
  ).toMatchObject({ phase: 'main', activePlayer: 'A' });

  const initialSnap = await page.evaluate(() => ({
    href: window.location.href,
    navType: (performance.getEntriesByType('navigation')[0] as { type?: string } | undefined)?.type ?? 'unknown',
  }));
  events.push({ t: stamp(), kind: 'bootstrap.done', detail: `phase=main activePlayer=A href=${initialSnap.href} navType=${initialSnap.navType}` });

  // ─── main loop: safe UI actions for 10 minutes, polling every 1s ──
  const LOOP_END = Date.now() + 10 * 60_000;
  let resetDetected = false;
  let resetAtMs = 0;
  let iteration = 0;

  while (Date.now() < LOOP_END) {
    iteration += 1;
    // Read current phase.
    const cur = await drv.getState().catch(() => null);
    if (cur === null) {
      events.push({ t: stamp(), kind: 'getState.failed' });
      break;
    }
    if (cur.phase === 'dice_roll' && iteration > 3) {
      resetDetected = true;
      resetAtMs = stamp();
      events.push({ t: resetAtMs, kind: 'RESET_DETECTED', detail: `iter=${iteration} phase=${cur.phase} activePlayer=${cur.activePlayer} turn=${cur.turn}` });
      // PRINT REPORT IMMEDIATELY — page may close before post-loop runs.
      // eslint-disable-next-line no-console
      console.log('=== EARLY_RESET_REPORT ===');
      // eslint-disable-next-line no-console
      console.log(`reset_at_ms: ${resetAtMs}`);
      // eslint-disable-next-line no-console
      console.log(`iteration: ${iteration}`);
      // eslint-disable-next-line no-console
      console.log('last 20 server-side events:');
      for (const e of events.slice(-20)) {
        // eslint-disable-next-line no-console
        console.log(`  [${e.t}ms] ${e.kind}${e.detail ? ' | ' + e.detail : ''}`);
      }
      break;
    }
    // If A is in main, do a quick action then end turn.
    if (cur.phase === 'main' && cur.activePlayer === 'A') {
      try { await drv.playCard(0); } catch {}
      try {
        await page.locator('button:has-text("CLOSE")').first().click({ timeout: 500 });
      } catch {}
      try { await drv.endTurn(); } catch {}
    }
    // Sleep 1s.
    await page.waitForTimeout(1_000);
  }

  // ─── collect client-side log (best-effort; page may be dead) ─────
  let clientLog: Array<{ kind: string; t: number; detail?: string }> = [];
  try {
    clientLog = await Promise.race([
      page.evaluate(() => (window as unknown as { __reset_repro_log?: Array<{ kind: string; t: number; detail?: string }> }).__reset_repro_log ?? []),
      new Promise<typeof clientLog>((resolve) => setTimeout(() => resolve([]), 3_000)),
    ]);
  } catch {
    clientLog = [];
  }

  // ─── classify ────────────────────────────────────────────────────
  const beforeReset = events.filter((e) => e.t < resetAtMs);
  const lastBeforeReset = beforeReset.slice(-15);
  const sawNavigation = lastBeforeReset.some((e) => e.kind === 'framenavigated' || e.kind === 'load' || e.kind === 'domcontentloaded');
  const sawViteReconnect = lastBeforeReset.some((e) => e.kind === 'console.vite' && /reconnect|reload|hmr|connection lost/i.test(e.detail ?? ''));
  const sawResetClick = clientLog.some((e) => /reset|easy|medium|hard|new game/i.test(e.detail ?? '') && e.kind === 'click');

  let classification: string;
  if (!resetDetected) {
    classification = 'NO_RESET_REPRODUCED';
  } else if (sawResetClick) {
    classification = 'HARNESS_MISCLICK';
  } else if (sawNavigation) {
    classification = 'VITE_OR_BROWSER_RELOAD';
  } else if (sawViteReconnect) {
    classification = 'VITE_HMR_CONTAMINATION';
  } else {
    // No nav, no vite reconnect, no reset click → app state reset somehow.
    classification = 'APP_STATE_RESET_OR_UNKNOWN';
  }

  // eslint-disable-next-line no-console
  console.log('=== RESET_REPRO REPORT ===');
  console.log(`classification: ${classification}`);
  console.log(`reset_detected: ${resetDetected}`);
  console.log(`reset_at_ms: ${resetAtMs}`);
  console.log(`iterations_before_reset: ${iteration}`);
  console.log('--- last 15 server-side events before reset ---');
  for (const e of lastBeforeReset) console.log(`  [${e.t}ms] ${e.kind}${e.detail ? ' | ' + e.detail : ''}`);
  console.log('--- last 15 client-side events before reset ---');
  for (const e of clientLog.filter((e) => e.t < resetAtMs).slice(-15)) {
    console.log(`  [${e.t}ms client] ${e.kind}${e.detail ? ' | ' + e.detail : ''}`);
  }
  console.log('=== END REPORT ===');

  // Hard assert NOTHING — this is a diagnostic test. We classify, report,
  // and pass so the report is captured even when reset doesn't reproduce.
});
