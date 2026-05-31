// Replacement effects — Phase A.3.7.
//
// Replacement effects fire INSTEAD of normal processing. Examples:
//   - "If this Character would be K.O.'d, you may return 1 DON to your
//     DON!! deck instead." (EB04-031)
//   - "If your Character would be removed from the field by your
//     opponent's effect, you may trash 1 card from your hand instead."
//     (ST22-005)
//
// Per CR §8-1-3-4: replacement REPLACES the would-be event — the K.O.
// (or removal, damage, life flip) didn't actually happen. on_ko / on_removed
// dispatches are skipped on the replaced branch.
//
// `tryApplyReplacement(state, ctx, trigger, replacements)`:
//   - returns `{ replaced: false }` if no replacement matched or could pay
//   - returns `{ replaced: true, state: GameState }` after applying the
//     replacement action AND paying its cost (V0: always pay)
//
// V0 simplifications:
//   - `conditional: true` is honored (cost is required), but the V0 path
//     always pays when possible. Real "If you do … / If you don't …"
//     branching would need a UI/AI choice.
//   - The replacement action is `EffectActionV2` — we delegate to
//     `applyActionV2` for the work.

import type { GameState, PlayerId } from '../GameState';
import { applyActionV2, resolveTargetV2 } from './runner-v2';
import { evaluateConditionV2 } from './runner-v2';
import type { EffectCostV2, ReplacementEffectV2 } from './types-v2';

const OTHER: Record<PlayerId, PlayerId> = { A: 'B', B: 'A' };

export type ReplacementTrigger =
  | 'would_be_ko'
  | 'would_be_removed'
  | 'would_take_damage'
  | 'on_life_flip';

export interface ReplacementResult {
  replaced: boolean;
  state: GameState;
}

/** Attempt to apply a replacement matching the trigger. Returns
 *  `replaced: false` if none matches or if costs can't be paid (when
 *  `conditional` is true). Otherwise pays the cost, runs the action, and
 *  returns `replaced: true` with the new state. */
export function tryApplyReplacement(
  state: GameState,
  ctx: { sourceInstanceId: string; controller: PlayerId },
  trigger: ReplacementTrigger,
  replacements: ReplacementEffectV2[],
): ReplacementResult {
  for (const r of replacements) {
    if (r.trigger !== trigger) continue;
    if (!evaluateConditionV2(state, ctx.controller, r.condition)) continue;

    // Check cost payability.
    if (r.cost && !canPayCost(state, ctx.controller, ctx.sourceInstanceId, r.cost)) {
      if (r.conditional) continue;
    }

    // Pay cost (if any).
    let next = state;
    if (r.cost) {
      const paid = payCost(next, ctx.controller, ctx.sourceInstanceId, r.cost);
      if (!paid) {
        // Conditional: skip this replacement entirely. Non-conditional: fall through.
        if (r.conditional) continue;
      } else {
        next = paid;
      }
    }

    // Apply the replacement's action.
    const tIds = resolveTargetV2(next, ctx.controller, ctx.sourceInstanceId, (r as unknown as { target?: any }).target);
    next = applyActionV2(next, ctx, r.action, tIds.length > 0 ? tIds : [ctx.sourceInstanceId]);

    return { replaced: true, state: next };
  }
  return { replaced: false, state };
}

/** Check whether a cost block can be paid given current state. */
function canPayCost(
  state: GameState,
  controller: PlayerId,
  sourceInstanceId: string,
  cost: EffectCostV2,
): boolean {
  const me = state.players[controller];
  if (typeof cost.donCost === 'number' && me.donCostArea.length < cost.donCost) return false;
  if (typeof cost.donCostReturnToDeck === 'number' && me.donCostArea.length < cost.donCostReturnToDeck) return false;
  if (typeof cost.discardHand === 'number' && me.hand.length < cost.discardHand) return false;
  if (typeof cost.flipLife === 'number' && me.life.length < cost.flipLife) return false;
  if (cost.restSelf) {
    const inst = state.instances[sourceInstanceId];
    if (!inst || inst.rested) return false;
  }
  if (cost.trashSelf) {
    const inst = state.instances[sourceInstanceId];
    if (!inst) return false;
  }
  if (cost.koSelfCharacter) {
    const matches = me.field.filter((inst) => {
      if (!cost.koSelfCharacter?.filter) return true;
      const card = state.cardLibrary[inst.cardId];
      if (cost.koSelfCharacter.filter.trait && (!card?.traits.includes(cost.koSelfCharacter.filter.trait))) return false;
      return true;
    });
    if (matches.length === 0) return false;
  }
  if (typeof cost.bottomOfDeckFromTrash === 'number' && me.trash.length < cost.bottomOfDeckFromTrash) return false;
  return true;
}

/** Pay a cost; mutates state in place and returns the same ref on success,
 *  or `null` if the cost couldn't be paid (idempotent — partial costs
 *  are rolled back by the caller not paying). */
function payCost(
  state: GameState,
  controller: PlayerId,
  sourceInstanceId: string,
  cost: EffectCostV2,
): GameState | null {
  if (!canPayCost(state, controller, sourceInstanceId, cost)) return null;
  const me = state.players[controller];

  if (typeof cost.donCost === 'number') {
    for (let i = 0; i < cost.donCost; i++) me.donRested.push(me.donCostArea.shift()!);
  }
  if (typeof cost.donCostReturnToDeck === 'number') {
    for (let i = 0; i < cost.donCostReturnToDeck; i++) me.donDeck.push(me.donCostArea.shift()!);
  }
  if (typeof cost.discardHand === 'number') {
    for (let i = 0; i < cost.discardHand && me.hand.length > 0; i++) {
      me.trash.push(me.hand.shift()!);
    }
  }
  if (typeof cost.flipLife === 'number') {
    // V0: trash N from top of life (face-flip mechanics deferred).
    for (let i = 0; i < cost.flipLife && me.life.length > 0; i++) {
      me.trash.push(me.life.shift()!);
    }
  }
  if (cost.restSelf) {
    const inst = state.instances[sourceInstanceId];
    if (inst) inst.rested = true;
  }
  if (cost.trashSelf) {
    const inst = state.instances[sourceInstanceId];
    if (inst) {
      // Find and remove from field.
      for (const pid of ['A', 'B'] as PlayerId[]) {
        const pl = state.players[pid];
        const idx = pl.field.findIndex((i) => i.instanceId === sourceInstanceId);
        if (idx !== -1) {
          pl.field.splice(idx, 1);
          pl.trash.push(sourceInstanceId);
          break;
        }
      }
    }
  }
  if (cost.koSelfCharacter) {
    const match = me.field.find((inst) => {
      if (!cost.koSelfCharacter?.filter) return true;
      const card = state.cardLibrary[inst.cardId];
      if (cost.koSelfCharacter.filter.trait && (!card?.traits.includes(cost.koSelfCharacter.filter.trait))) return false;
      return true;
    });
    if (match) {
      const idx = me.field.findIndex((i) => i.instanceId === match.instanceId);
      me.field.splice(idx, 1);
      me.trash.push(match.instanceId);
    }
  }
  if (typeof cost.bottomOfDeckFromTrash === 'number') {
    for (let i = 0; i < cost.bottomOfDeckFromTrash && me.trash.length > 0; i++) {
      me.deck.push(me.trash.shift()!);
    }
  }
  // OTHER reference used only for diagnostic ergonomics — keep around.
  void OTHER;
  void controller;
  return state;
}

/** Re-export the cost type so callers don't need to dig into types-v2. */
export type { EffectCostV2 };
