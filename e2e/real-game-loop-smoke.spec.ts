// real-game-loop-smoke — exercise the game as a real player would, not as a
// static-injection harness. Walks 3 full human turns + AI turns back-to-back,
// asserting:
//   - no pageerror
//   - no invariant violation
//   - no stuck pending after each turn boundary
//   - turn number advances after each END_TURN
//   - if the AI ends the match early via game-over, that counts as PASS
//
// Per directive 2026-06-05: one terminal, no parallel runs, no hot-reload
// interference. Uses existing PlayerDriver helpers + a minimal inline attack
// flow against the leader (3-click sequence: leader → SELECT AS ATTACKER →
// opp leader → ATTACK THIS).

import { test, expect, type Page } from '@playwright/test';
import { PlayerDriver } from './helpers/player';

const TURNS_TO_PLAY = 3;

test.describe('Real game loop smoke', () => {
  test('boot → dice → mulligan → 3 turns of play + attack + end_turn', async ({ page }) => {
    // Default playwright timeout (120s) is too short for 3 cycles where
    // each AI turn can take ~30-45s of pacing. Allow 5 minutes overall.
    test.setTimeout(300_000);
    const pageErrors: string[] = [];
    const invariantErrors: string[] = [];

    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('InvariantError') || text.includes('invariant')) {
        invariantErrors.push(text);
      }
    });

    const drv = new PlayerDriver(page);
    await drv.open();

    // 1-2. Setup — dice flow.
    await drv.waitForPhase('dice_roll');
    await drv.rollDice();

    // 3. First-player choice (best-effort — the engine may auto-advance).
    try {
      await drv.waitForPhase('first_player_choice', 15_000);
      await drv.chooseGoFirst();
    } catch { /* engine already advanced */ }

    // 4. Mulligan keep.
    try {
      await drv.waitForPhase('mulligan', 8_000);
      await drv.keepMulliganHand();
    } catch { /* engine already advanced */ }

    // 5. Reach main phase as A.
    await drv.waitForPhase('main', 30_000);

    // 13. Loop TURNS_TO_PLAY full human turns.
    let endedNaturally = false;
    for (let turn = 0; turn < TURNS_TO_PLAY; turn += 1) {
      // Defensive: AI may have ended the game between turns.
      const stateBefore = await drv.getState().catch(() => null);
      if (stateBefore?.result) {
        endedNaturally = true;
        break;
      }
      // Defensive: close any stray CardDetailModal so EndTurnButton's
      // aria-hidden gate doesn't fire later.
      await closeAnyOpenModal(page);
      const startTurn = await drv.currentTurnNumber();

      // 6. Play first legal card found within the first 2 hand positions.
      // PlayerDriver.openHandCard at helpers/player.ts:83 uses an over-broad
      // selector that can match DON buttons by index — keeping the loop
      // shallow (2 attempts) avoids the costly DON-overlap range where each
      // failed click takes Playwright's default ~30s timeout.
      let played = false;
      for (let i = 0; i < 2; i += 1) {
        try {
          const ok = await drv.playCard(i);
          if (ok) { played = true; break; }
        } catch { /* selector matched a non-hand element; skip */ }
        await closeAnyOpenModal(page);
      }

      // 9. Drain any prompts the play surfaced.
      if (await drv.hasChoosePrompt()) {
        await drv.chooseOption(0);
        await expect.poll(async () => drv.currentPhase(), { timeout: 10_000 })
          .not.toContain('choose_one');
      }

      // 8. Attack opp leader via the real 3-click flow (matches play-driver
      // sequence: leader → SELECT AS ATTACKER → opp leader → ATTACK THIS).
      // Wrapped in best-effort try — leader may be rested or summoning-sick.
      const attacked = await attackOppLeader(page);
      void attacked; // optional: not required to succeed every turn

      // 10. End turn.
      await drv.endTurn();

      // 11+12. Wait for control to return — turn number must advance and
      //        we must be back in main phase.
      await expect.poll(async () => drv.currentTurnNumber(), {
        timeout: 60_000,
        message: `turn ${turn}: turn number did not advance after END_TURN`,
      }).toBeGreaterThan(startTurn);

      const stateAfter = await drv.getState();
      if (stateAfter.result) {
        endedNaturally = true;
        break;
      }
      // Wait for BOTH phase=main AND activePlayer=A (control truly returned
      // to the human). Polling only on phase matches when B is in their main
      // phase too. PlayerDriver.getState() returns {phase, activePlayer,
      // pendingKind, ...} per helpers/player.ts:159-190 — note 'activePlayer',
      // not 'ap', and 'pendingKind' (not 'pending').
      await expect.poll(
        async () => {
          const s = await drv.getState();
          return { phase: s.phase, activePlayer: s.activePlayer };
        },
        { timeout: 60_000, message: `turn ${turn}: control did not return to A in main` },
      ).toMatchObject({ phase: 'main', activePlayer: 'A' });

      // 14. No stuck pending after turn boundary. getState returns
      // pendingKind: null when no pending exists.
      const stateMid = await drv.getState();
      expect(stateMid.pendingKind, `turn ${turn}: pendingKind stuck after turn boundary`).toBeNull();
    }

    // 16. No pageerrors.
    expect(pageErrors, `unexpected pageerror events: ${pageErrors.join(' | ')}`).toEqual([]);
    // 17. No invariant violations.
    expect(invariantErrors, `unexpected invariant violations: ${invariantErrors.join(' | ')}`).toEqual([]);

    // 18. Game can continue (3 turns survived) OR ended naturally.
    if (endedNaturally) {
      // game-over reached during the loop — pass
      return;
    }
    const finalState = await drv.getState();
    expect(finalState.pendingKind, 'final state has stuck pendingKind').toBeNull();
  });
});

// Inline attack flow — 3-click sequence against the opp leader. Returns
// true if the attack landed, false if any precondition (visible/enabled)
// failed. NOT an assertion — turn loop tolerates skipped attacks.
//
// IMPORTANT: every early-exit path closes any open CardDetailModal first.
// The CardDetailModal sets `cardDetailOpen=true` in the store, which makes
// EndTurnButton.tsx:89 render with `aria-hidden=true`. Playwright's role
// query skips aria-hidden buttons, so a stuck modal causes
// `drv.endTurn()` to time out at 15s even though the button is in DOM.
async function attackOppLeader(page: Page): Promise<boolean> {
  try {
    // Step 1: click our leader (last [aria-label*="(leader)"] — opp renders
    // first in PlayfieldStage, so .last() prefers self).
    const ownLeader = page.locator('[aria-label*="(leader)" i]').last();
    if (!(await ownLeader.isVisible().catch(() => false))) return false;
    await ownLeader.click({ timeout: 3_000 });
    await page.waitForTimeout(250);

    // Step 2: "SELECT AS ATTACKER" must appear.
    const selBtn = page.locator('button:has-text("SELECT AS ATTACKER")').first();
    if (!(await selBtn.isVisible().catch(() => false))) { await closeAnyOpenModal(page); return false; }
    await selBtn.click({ timeout: 3_000 });
    await page.waitForTimeout(250);

    // Step 3: click opp leader (first in PlayfieldStage DOM order).
    const oppLeader = page.locator('[aria-label*="(leader)" i]').first();
    if (!(await oppLeader.isVisible().catch(() => false))) { await closeAnyOpenModal(page); return false; }
    await oppLeader.click({ timeout: 3_000 });
    await page.waitForTimeout(250);

    // Step 4: "ATTACK THIS" must appear and be clickable.
    const atkBtn = page.locator('button:has-text("ATTACK THIS")').first();
    if (!(await atkBtn.isVisible().catch(() => false))) { await closeAnyOpenModal(page); return false; }
    await atkBtn.click({ timeout: 3_000 });
    await page.waitForTimeout(2_000); // damage resolution + AI counter window
    return true;
  } catch {
    await closeAnyOpenModal(page);
    return false;
  }
}

// Force the CardDetailModal closed (if visible) so the EndTurnButton's
// aria-hidden gate clears and Playwright's role queries can see it again.
async function closeAnyOpenModal(page: Page): Promise<void> {
  try {
    const closeBtn = page.locator('button:has-text("CLOSE")').first();
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click({ timeout: 2_000 });
      await page.waitForTimeout(180);
    }
  } catch { /* best-effort */ }
}
