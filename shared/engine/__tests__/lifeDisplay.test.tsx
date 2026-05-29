// Regression test for the LifePill bug fixed in visual-spec-layout-correction.md §E.1.
//
// BEFORE the fix, CardArt.tsx read `lifeCount = card.life` — the leader's
// *printed* initial life. The pill stayed at 5 forever, even after damage.
// AFTER the fix, the pill reads `liveLifeCount = zones.life.length`, threaded
// in by the composer (PlayfieldStage FieldRow, AttackResolutionOverlay).
//
// This test drives the engine through 2 leader hits (one with +1000 DON to
// guarantee power > defender, so life is actually taken) and asserts the
// derivation helper returns the LIVE count, not the printed value.
//
// No DOM env / RTL — the bug is in a pure derivation; testing it as a pure
// function is sufficient and matches the rest of the engine test layout.

import { describe, expect, it } from 'vitest';
import { applyAction } from '../applyAction';
import { initialState } from '../GameState';
import { setupGame } from '../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../phases/turn';
import { deriveLifeCount } from '../../../src/components/CardArt';
import type { Card, CharacterCard, LeaderCard } from '../cards/Card';
import { attachDonCount, advanceOneFullCycle } from './_donHelpers';

function makeLeader(id: string, life = 5): LeaderCard {
  return {
    id, name: id, kind: 'leader', colors: ['red'], cost: null, power: 5000,
    life, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
}
function makeChar(id: string): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['red'], cost: 2, power: 3000,
    counterValue: 1000, traits: [], keywords: [], effectTags: ['vanilla'],
  };
}

function build(printedLeaderLife = 5) {
  const cards: Card[] = Array.from({ length: 50 }, (_, i) => makeChar(`C${i}`));
  return initialState({
    seed: 42,
    decks: {
      A: { leader: makeLeader('LA', printedLeaderLife), cards },
      B: { leader: makeLeader('LB', printedLeaderLife), cards },
    },
  });
}

function advanceToMain(s: ReturnType<typeof build>) {
  return runDonPhase(runDrawPhase(runRefreshPhase(setupGame(s))));
}

/** Drive a leader-on-leader attack through the 3-stage window flow. */
function attackLeader(
  s: ReturnType<typeof build>,
  attacker: 'A' | 'B',
  defender: 'A' | 'B',
) {
  const attackerLeader = s.players[attacker].leader.instanceId;
  const defenderLeader = s.players[defender].leader.instanceId;
  // Boost attacker to guarantee power > defender (5000 vs 5000 ties — no life taken).
  attachDonCount(s, attacker, attackerLeader, 1);
  let next = applyAction(s, attacker, {
    type: 'DECLARE_ATTACK',
    attackerInstanceId: attackerLeader,
    targetInstanceId: defenderLeader,
  }).state;
  next = applyAction(next, defender, { type: 'SKIP_BLOCKER' }).state;
  next = applyAction(next, defender, { type: 'SKIP_COUNTER' }).state;
  return next;
}

describe('LifePill display — visual-spec-layout-correction.md §E.1', () => {
  it('deriveLifeCount returns the live count, not the printed value, after 2 hits', () => {
    // Build a game where the printed leader life is 5 (default), then take 2 life.
    let s = advanceToMain(build(5));

    // Hand B's leader a hit on A's leader: A 5 → 4.
    s = endTurn(s);
    s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
    // D2 (CR §6-5-6-1): B can't battle on turn 2 (B's first turn). Skip ahead.
    s = advanceOneFullCycle(s);
    s = attackLeader(s, 'B', 'A');
    expect(s.players.A.life.length).toBe(4);

    // Re-arm: refresh A's turn (just to cycle phases), then end and let B hit again.
    s = endTurn(s);
    s = runDonPhase(runDrawPhase(runRefreshPhase(s))); // A's turn
    s = endTurn(s);
    s = runDonPhase(runDrawPhase(runRefreshPhase(s))); // B's turn again
    s = attackLeader(s, 'B', 'A');
    expect(s.players.A.life.length).toBe(3);

    // Engine ground truth: A has 3 life left.
    const live = s.players.A.life.length;
    const printed = (s.cardLibrary['LA'] as LeaderCard).life;

    // Printed life is the leader's initial value — would be 5, NOT 3.
    expect(printed).toBe(5);

    // The fixed derivation reads the live count.
    const displayed = deriveLifeCount({ isLeader: true, liveLifeCount: live });
    expect(displayed).toBe(3);
    expect(displayed).not.toBe(printed);
  });

  it('deriveLifeCount returns undefined for non-leaders', () => {
    // Non-leader rows (characters, hand cards) should not render a life pill.
    expect(deriveLifeCount({ isLeader: false, liveLifeCount: 5 })).toBeUndefined();
    expect(deriveLifeCount({ isLeader: false, liveLifeCount: undefined })).toBeUndefined();
  });

  it('deriveLifeCount returns the provided count even when 0 (no life left)', () => {
    // After lethal, life = 0 but the leader is still on the board until the next
    // damage resolution. The pill must read 0, not undefined and not the printed 5.
    expect(deriveLifeCount({ isLeader: true, liveLifeCount: 0 })).toBe(0);
  });
});
