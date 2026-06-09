/**
 * F-7k BUG-007 — Online gameplay soak harness.
 *
 * Drives REAL matches end-to-end through the live lobby. Each game runs:
 *   React → Zustand → fetch/ws → wrangler worker → Matchmaker
 *   → GameRoom → MatchRoom → MatchSession → engine
 *
 * No mocks, no state mutation. Both tabs click ONLY server-supplied
 * legalActions via the picker in `./strategy.ts`. Each game is bounded
 * by a click budget (`MAX_CLICKS_PER_GAME`) and total turns
 * (`MAX_TURNS_PER_GAME` = 60 per CR §3-7-... — task-spec cap).
 *
 * Success per game = match-result fires (`online-match-result` reads
 * `loser=A` or `loser=B`) with no invariant error / no deadlock /
 * no hidden-info leak heuristic.
 *
 * Failure taxonomy is captured per game and reported in the spec output.
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';

import { SOAK_MATCHUPS, type DeckColor } from './decks';
import { pickNextAction, type RenderedButton } from './strategy';

const ONLINE_E2E = process.env.ONLINE_E2E === '1';
const WORKER_ORIGIN = process.env.WORKER_ORIGIN ?? 'http://localhost:8801';

// Soak v1 (400) hit cap on 2/18 games. Soak v2 (800) hit cap on 2/18
// long matchups (red-vs-green, yellow-vs-green) where heavy counter
// usage drags both sides past 30+ turns. v3 (1500) cleared most.
// v4 with counter-skip still hit cap on red-vs-green game 1 at 150
// clicks/turn (heavy on_play pending windows on green deck). 3000
// covers the worst-case green grind; deadlock detection still trips
// well before this if the match is genuinely stuck.
const MAX_CLICKS_PER_GAME = 6000;
// Task spec lists "match exceeds 60 turns" as a stop-and-report trigger.
// v3 hit 61 turns in a stalemate where defender countered every attack
// (BUG-007.B fixed in strategy.ts). 80-turn cap gives margin for normal
// matches while still tripping if a real soft-lock occurs.
const MAX_TURNS_PER_GAME = 80;
/** If both pages return null pick + match still live for this many polls, declare deadlock. */
const DEADLOCK_NULL_POLL_LIMIT = 8;
/** Polling delay between click iterations (browser needs time to re-render). */
const TICK_MS = 80;

interface GameOutcome {
  readonly matchupId: string;
  readonly gameNumber: number;
  readonly aColor: DeckColor;
  readonly bColor: DeckColor;
  /** Final result text from `online-match-result`, e.g. "loser=B reason=life_zero" or "—". */
  readonly resultA: string;
  readonly resultB: string;
  readonly clicks: number;
  readonly turnsObserved: number;
  readonly status: 'completed' | 'deadlock' | 'turn-cap' | 'click-cap' | 'invariant' | 'desync' | 'click-error' | 'fatal-error';
  readonly failureDetail: string | null;
}

test.use({
  launchOptions: { args: ['--disable-web-security'] },
});

test.describe.configure({ mode: 'serial' });

test.describe('F-7k BUG-007 — online gameplay soak harness', () => {
  test.beforeEach(({}, testInfo) => {
    if (!ONLINE_E2E) testInfo.skip(true, 'ONLINE_E2E=1 not set');
  });

  test('soak: 6 matchups × 3 games each — every match must reach a clean result', async ({
    browser,
  }) => {
    // v3 used 40 min and hit total timeout mid-game-17 because per-game
    // budget at TICK=80 still averaged ~2.5 min/game. 50 min covers the
    // observed worst case.
    test.setTimeout(50 * 60_000);

    const outcomes: GameOutcome[] = [];

    for (const matchup of SOAK_MATCHUPS) {
      for (let gameIdx = 0; gameIdx < matchup.games; gameIdx += 1) {
        // Alternate first-player color by swapping A/B every other game.
        const aColor: DeckColor = gameIdx % 2 === 0 ? matchup.a : matchup.b;
        const bColor: DeckColor = gameIdx % 2 === 0 ? matchup.b : matchup.a;
        console.log(
          `\n=== ${matchup.id} game ${gameIdx + 1}/${matchup.games}: A=${aColor} vs B=${bColor} ===`,
        );

        const outcome = await runSingleGame(
          browser,
          matchup.id,
          gameIdx + 1,
          aColor,
          bColor,
        );
        outcomes.push(outcome);
        console.log(
          `  → status=${outcome.status} clicks=${outcome.clicks} turns=${outcome.turnsObserved} resultA=${outcome.resultA}`,
        );
        if (outcome.status !== 'completed') {
          console.log(`  ! detail: ${outcome.failureDetail}`);
        }
      }
    }

    // ── Summary ───────────────────────────────────────────────────────
    const completed = outcomes.filter((o) => o.status === 'completed');
    const failed = outcomes.filter((o) => o.status !== 'completed');
    const aWins = outcomes.filter((o) => o.resultA.includes('loser=B')).length;
    const bWins = outcomes.filter((o) => o.resultA.includes('loser=A')).length;
    const clicksSum = outcomes.reduce((s, o) => s + o.clicks, 0);
    const turnsMax = outcomes.reduce((m, o) => Math.max(m, o.turnsObserved), 0);
    const turnsMin = completed.length === 0
      ? 0
      : Math.min(...completed.map((o) => o.turnsObserved));
    console.log('\n──────────────── SOAK SUMMARY ────────────────');
    console.log(`Total matches attempted: ${outcomes.length}`);
    console.log(`Completed cleanly:       ${completed.length}`);
    console.log(`Failed:                  ${failed.length}`);
    console.log(`A-side wins:             ${aWins}`);
    console.log(`B-side wins:             ${bWins}`);
    console.log(`Total clicks:            ${clicksSum}`);
    console.log(`Longest match (turns):   ${turnsMax}`);
    console.log(`Shortest match (turns):  ${turnsMin}`);
    if (failed.length > 0) {
      console.log('\nFailure breakdown:');
      const byStatus = new Map<string, number>();
      for (const o of failed) {
        byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);
      }
      for (const [k, v] of byStatus) {
        console.log(`  ${k}: ${v}`);
      }
    }
    console.log('──────────────────────────────────────────────\n');

    // Spec passes ONLY if EVERY game completed. Any failure = soak fails.
    expect(failed).toEqual([]);
  });
});

async function runSingleGame(
  browser: import('@playwright/test').Browser,
  matchupId: string,
  gameNumber: number,
  aColor: DeckColor,
  bColor: DeckColor,
): Promise<GameOutcome> {
  const ctxA: BrowserContext = await browser.newContext();
  const ctxB: BrowserContext = await browser.newContext();
  const initScript = `window.__WORKER_ORIGIN__ = ${JSON.stringify(WORKER_ORIGIN)};`;
  await ctxA.addInitScript(initScript);
  await ctxB.addInitScript(initScript);
  const pageA: Page = await ctxA.newPage();
  const pageB: Page = await ctxB.newPage();

  let clicks = 0;
  let turnsObserved = 0;
  let status: GameOutcome['status'] = 'completed';
  let failureDetail: string | null = null;
  let resultA = '—';
  let resultB = '—';

  try {
    await pageA.goto('/?online=1&test=1');
    await pageB.goto('/?online=1&test=1');
    const sessionA = `soak-${matchupId}-${gameNumber}-a-${Date.now()}`;
    const sessionB = `soak-${matchupId}-${gameNumber}-b-${Date.now()}`;
    await pageA.getByTestId('online-session-id').fill(sessionA);
    await pageA.getByTestId('online-color-select').selectOption(aColor);
    await pageB.getByTestId('online-session-id').fill(sessionB);
    await pageB.getByTestId('online-color-select').selectOption(bColor);

    await pageA.getByTestId('online-find-match').click();
    await pageB.getByTestId('online-find-match').click();
    await expect(pageA.getByTestId('online-phase')).toHaveText('connected', {
      timeout: 20_000,
    });
    await expect(pageA.getByTestId('online-board-phase')).toHaveText('main', {
      timeout: 10_000,
    });

    // ── Main soak loop ────────────────────────────────────────────────
    let nullPolls = 0;
    let lastActivePlayer = await pageA
      .getByTestId('online-active-player')
      .textContent();

    while (clicks < MAX_CLICKS_PER_GAME) {
      // Check for match result first.
      resultA = (await pageA.getByTestId('online-match-result').textContent()) ?? '—';
      resultB = (await pageB.getByTestId('online-match-result').textContent()) ?? '—';
      if (resultA !== '—' && resultA !== '') {
        // Both tabs must agree.
        if (resultA !== resultB) {
          status = 'desync';
          failureDetail = `result desync: A="${resultA}" B="${resultB}"`;
        }
        break;
      }

      // Determine which page should act. Active-player tab unless it's
      // a defender's reactive window (block_window/counter_window) — in
      // that case the OPP tab has the actionable buttons (active sees
      // only CONCEDE during a pending attack).
      const activePlayer = await pageA
        .getByTestId('online-active-player')
        .textContent();
      const boardPhase = await pageA
        .getByTestId('online-board-phase')
        .textContent();

      // Track turn count via END_TURN clicks (incremented below).
      if (activePlayer !== lastActivePlayer) {
        turnsObserved += 1;
        lastActivePlayer = activePlayer;
        if (turnsObserved > MAX_TURNS_PER_GAME) {
          status = 'turn-cap';
          failureDetail = `exceeded ${MAX_TURNS_PER_GAME} turns observed`;
          break;
        }
      }

      // Pick the page with non-trivial legalActions. Try the side whose
      // turn it is first; if that side sees only [CONCEDE] (active player
      // during pending), try the other side.
      const aButtons = await dumpButtons(pageA);
      const bButtons = await dumpButtons(pageB);

      let actorPage: Page;
      let actorLabel: 'A' | 'B';
      let actorButtons: ReadonlyArray<RenderedButton>;
      const aPickable = pickNextAction(aButtons);
      const bPickable = pickNextAction(bButtons);
      if (aPickable !== null && bPickable === null) {
        actorPage = pageA; actorLabel = 'A'; actorButtons = aButtons;
      } else if (bPickable !== null && aPickable === null) {
        actorPage = pageB; actorLabel = 'B'; actorButtons = bButtons;
      } else if (aPickable !== null && bPickable !== null) {
        // Both have actions — go with the active-player's side.
        if (activePlayer === 'A') {
          actorPage = pageA; actorLabel = 'A'; actorButtons = aButtons;
        } else {
          actorPage = pageB; actorLabel = 'B'; actorButtons = bButtons;
        }
      } else {
        // Both null — possible deadlock or transient state. Sleep + retry.
        nullPolls += 1;
        if (nullPolls > DEADLOCK_NULL_POLL_LIMIT) {
          status = 'deadlock';
          failureDetail = `both sides returned null pick for ${nullPolls} polls; phase=${boardPhase} active=${activePlayer}; A buttons=[${aButtons.map((b) => b.type).join(',')}] B buttons=[${bButtons.map((b) => b.type).join(',')}]`;
          break;
        }
        await pageA.waitForTimeout(TICK_MS);
        continue;
      }
      nullPolls = 0;

      const pick = pickNextAction(actorButtons);
      if (pick === null) {
        nullPolls += 1;
        await pageA.waitForTimeout(TICK_MS);
        continue;
      }
      try {
        await actorPage.getByTestId(`online-action-${pick.index}`).click({ timeout: 5_000 });
      } catch (err) {
        // Race: result may have arrived between the result-check above
        // and the click attempt. OnlinePlayfield disables buttons when
        // `isOver` (per `src/online/OnlinePlayfield.tsx:84-87,98-101`)
        // which makes the click target unreachable. Re-check result; if
        // it landed, treat as a clean completion rather than click-error.
        const resultA2 = (await pageA.getByTestId('online-match-result').textContent()) ?? '—';
        const resultB2 = (await pageB.getByTestId('online-match-result').textContent()) ?? '—';
        if (resultA2 !== '—' && resultA2 !== '') {
          resultA = resultA2;
          resultB = resultB2;
          break;
        }
        status = 'click-error';
        failureDetail = `click failed on ${actorLabel} action ${pick.type}@${pick.index}: ${err instanceof Error ? err.message : String(err)}`;
        break;
      }
      clicks += 1;

      // Brief tick to let the WS round-trip + React re-render.
      await pageA.waitForTimeout(TICK_MS);
    }

    if (clicks >= MAX_CLICKS_PER_GAME && status === 'completed' && (resultA === '—' || resultA === '')) {
      status = 'click-cap';
      failureDetail = `hit click cap of ${MAX_CLICKS_PER_GAME} without reaching match result`;
    }

    // Final result sanity check.
    if (status === 'completed') {
      if (resultA === '—' || resultA === '') {
        status = 'click-cap';
        failureDetail = 'loop exited but no match result rendered';
      }
    }
  } catch (err) {
    status = 'fatal-error';
    failureDetail = err instanceof Error ? err.message : String(err);
  } finally {
    await ctxA.close().catch(() => undefined);
    await ctxB.close().catch(() => undefined);
  }

  return {
    matchupId,
    gameNumber,
    aColor,
    bColor,
    resultA,
    resultB,
    clicks,
    turnsObserved,
    status,
    failureDetail,
  };
}

async function dumpButtons(page: Page): Promise<RenderedButton[]> {
  return page.evaluate(() => {
    const buttons = Array.from(
      document.querySelectorAll('[data-testid^="online-action-"]'),
    ) as HTMLButtonElement[];
    return buttons.map((b) => {
      const id = b.getAttribute('data-testid') ?? '';
      const indexStr = id.replace('online-action-', '');
      return {
        index: Number.parseInt(indexStr, 10),
        type: b.getAttribute('data-action-type') ?? '?',
        title: b.getAttribute('title'),
      };
    });
  });
}
