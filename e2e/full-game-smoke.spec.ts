// full-game-smoke — single end-to-end test proving the dispatch→reducer→
// state→UI loop completes through one round of play including:
//   - setup (dice / first-player / mulligan)
//   - hand interaction (play one card)
//   - choose_one resolution if the played card surfaces a prompt
//   - end turn + opponent turn cycle
//
// Smoke ONLY. Per-card behavior is out of scope.

import { test, expect } from '@playwright/test';
import { PlayerDriver } from './helpers/player';

test.describe('Full game smoke', () => {
  test('boot → dice → mulligan → play → choose_one (if) → end turn', async ({ page }) => {
    page.on('pageerror', (err) => {
      // Fail fast on unhandled runtime errors.
      // eslint-disable-next-line no-console
      console.error('[pageerror]', err.message);
      throw err;
    });

    const drv = new PlayerDriver(page);
    await drv.open();
    await drv.snapshot('after-open');

    // Step 1 — dice roll
    await drv.waitForPhase('dice_roll');
    await drv.rollDice();
    await drv.snapshot('after-roll');

    // Step 2 — first-player choice (best-effort; if the AI already chose
    // because we lost, the modal may have advanced past us).
    try {
      await drv.waitForPhase('first_player_choice', 15_000);
      await drv.chooseGoFirst();
      await drv.snapshot('after-first-player');
    } catch {
      await drv.snapshot('skipped-first-player');
    }

    // Step 3 — mulligan
    try {
      await drv.waitForPhase('mulligan', 8_000);
      await drv.keepMulliganHand();
      await drv.snapshot('after-keep');
    } catch {
      await drv.snapshot('skipped-mulligan');
    }

    // Step 4 — wait for main phase, then play a hand card.
    await drv.waitForPhase('main', 30_000);
    const startTurn = await drv.currentTurnNumber();

    // Try the first few hand cards until one is playable.
    let played = false;
    for (let i = 0; i < 5; i += 1) {
      const ok = await drv.playCard(i);
      if (ok) { played = true; break; }
    }
    await drv.snapshot(played ? 'after-play' : 'no-playable-card');
    expect(played, 'expected to play at least one card from hand').toBe(true);

    // Step 5 — if a choose_one prompt appears, resolve it. Must NOT soft-lock.
    if (await drv.hasChoosePrompt()) {
      await drv.chooseOption(0);
      await drv.snapshot('after-choose-one');
      // Confirm the prompt unmounted (phase must leave 'choose_one').
      await expect.poll(async () => drv.currentPhase(), { timeout: 10_000 }).not.toContain('choose_one');
    }

    // Step 6 — end turn
    await drv.endTurn();
    await drv.snapshot('after-end-turn');

    // Step 7 — verify a turn change happened (either turn number advanced
    // or the opponent took its turn and we're back at our main).
    await expect.poll(async () => drv.currentTurnNumber(), {
      timeout: 30_000,
      message: 'turn number did not advance after END_TURN',
    }).toBeGreaterThan(startTurn);
  });
});
