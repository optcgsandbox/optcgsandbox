// Test helpers for the DON-as-CardInstance refactor (2026-05-28).
//
// Before the refactor, tests set numeric DON counts directly:
//   s.players.A.donActive = 2;
//   s.players.B.leader.attachedDon = 1;
//
// After the refactor, those fields are string[] of DON instance IDs. These
// helpers pop DON instances from the donDeck and place them in the cost area
// or attach them to a target — reproducing the same effective state with
// real instance plumbing.
//
// All helpers mutate state in-place. They are test-only conveniences and
// should NEVER be imported from src/ or the engine itself.

import { applyAction } from '../applyAction';
import type { GameState, PlayerId } from '../GameState';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../phases/turn';

/** Advance the game past the first-turn-no-attack window for both players
 *  (D2 / CR §6-5-6-1). Given a state where the next `runRefresh→Draw→DON` will
 *  start `nextPlayer`'s turn N, this runs one extra full turn cycle so that
 *  same `nextPlayer` becomes active again on a turn ≥ 3, when attacks are
 *  legal.
 *
 *  Typical use after the existing `endTurn → runRefresh/Draw/Don` boilerplate:
 *
 *      s = endTurn(s);                                         // → B, turn 2
 *      s = runDonPhase(runDrawPhase(runRefreshPhase(s)));      // B turn 2 main
 *      s = advanceOneFullCycle(s);                             // → B, turn 4 main
 *
 *  The caller is responsible for being on a main phase when calling.
 */
export function advanceOneFullCycle(state: GameState): GameState {
  // End current player's turn → other player's refresh/draw/don main → end that → back to caller's main.
  let s = endTurn(state);
  s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
  s = endTurn(s);
  s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
  return s;
}

/** D10 (CR §5-2-1-6): close the mulligan window for both players with KEEP
 *  decisions. After `setupGame`, the state sits in `'mulligan_first'` with
 *  empty life arrays. Tests that don't exercise the mulligan flow use this
 *  helper to advance to the post-mulligan world (life dealt, phase = refresh)
 *  so the rest of their setup chain (`runRefreshPhase`, `endTurn`, etc.) works
 *  as it did pre-D10. */
export function closeMulliganKeepBoth(state: GameState): GameState {
  // P1 (activePlayer) decides first per CR §5-2-1-6.
  const p1 = state.activePlayer;
  const p2: PlayerId = p1 === 'A' ? 'B' : 'A';
  const r1 = applyAction(state, p1, { type: 'KEEP_HAND' });
  const r2 = applyAction(r1.state, p2, { type: 'KEEP_HAND' });
  return r2.state;
}

/** Force the cost area to contain exactly `count` active DON. Surplus is
 *  dropped to donRested so the total DON stays conserved across (deck +
 *  costArea + rested + attached) ≤ DON_DECK_SIZE per player. */
export function setDonActive(state: GameState, player: PlayerId, count: number): void {
  const p = state.players[player];
  // Recall every DON anywhere on the field/cost area back to the deck head.
  const allOwned: string[] = [
    ...p.donCostArea,
    ...p.donRested,
    ...p.leader.attachedDon,
    ...p.field.flatMap((c) => c.attachedDon),
  ];
  p.donCostArea = [];
  p.donRested = [];
  p.leader.attachedDon = [];
  for (const c of p.field) c.attachedDon = [];
  // Put owned DON back on top of deck so the helper is the single source.
  for (const id of allOwned) p.donDeck.unshift(id);

  // Now pop `count` into costArea.
  for (let i = 0; i < count && p.donDeck.length > 0; i++) {
    p.donCostArea.push(p.donDeck.shift()!);
  }
}

/** Attach exactly `count` DON to the target (leader or any field instance).
 *  Pulls from the player's donCostArea first, then donDeck if needed. */
export function attachDonCount(
  state: GameState,
  player: PlayerId,
  targetInstanceId: string,
  count: number,
): void {
  const p = state.players[player];
  const target =
    p.leader.instanceId === targetInstanceId
      ? p.leader
      : p.field.find((i) => i.instanceId === targetInstanceId);
  if (!target) throw new Error(`attachDonCount: target ${targetInstanceId} not found`);

  for (let i = 0; i < count; i++) {
    const donId = p.donCostArea.shift() ?? p.donDeck.shift();
    if (!donId) throw new Error('attachDonCount: out of DON');
    target.attachedDon.push(donId);
  }
}
