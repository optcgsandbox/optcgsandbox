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

import type { GameState, PlayerId } from '../GameState';

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
