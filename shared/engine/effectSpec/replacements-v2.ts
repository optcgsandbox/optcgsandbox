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
import { applyActionV2, broadcastTriggerToOwnField, resolveTargetV2 } from './runner-v2';
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
    if (!evaluateConditionV2(state, ctx.controller, r.condition, ctx.sourceInstanceId)) continue;

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
  if (cost.restLeader) {
    if (me.leader.rested) return false;
  }
  if (cost.restLeaderOrStageFilter) {
    const trait = cost.restLeaderOrStageFilter.filter?.trait;
    const leaderCard = state.cardLibrary[me.leader.cardId];
    const leaderEligible = !me.leader.rested && (!trait || leaderCard?.traits?.includes(trait));
    const stageEligible = me.stage && !me.stage.rested && (!trait || state.cardLibrary[me.stage.cardId]?.traits?.includes(trait));
    if (!leaderEligible && !stageEligible) return false;
  }
  if (cost.restOwnCharFilter) {
    const need = cost.restOwnCharFilter.count;
    const filter = cost.restOwnCharFilter.filter;
    const matches = me.field.filter((inst) => {
      if (inst.rested) return false;
      if (!filter) return true;
      const card = state.cardLibrary[inst.cardId];
      if (!card) return false;
      if (typeof filter.costMin === 'number') {
        const c = typeof card.cost === 'number' ? card.cost + (inst.costModifier ?? 0) : -1;
        if (c < 0 || c < filter.costMin) return false;
      }
      if (typeof filter.costMax === 'number') {
        const c = typeof card.cost === 'number' ? card.cost + (inst.costModifier ?? 0) : -1;
        if (c < 0 || c > filter.costMax) return false;
      }
      if (filter.trait && !card.traits?.includes(filter.trait)) return false;
      return true;
    });
    if (matches.length < need) return false;
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
  if (cost.returnSelfChar) {
    const filter = cost.returnSelfChar.filter;
    const matches = me.field.filter((inst) => {
      const card = state.cardLibrary[inst.cardId];
      if (!card) return false;
      if (!filter) return true;
      if (filter.trait && (!card.traits || !card.traits.includes(filter.trait))) return false;
      if (typeof filter.costMin === 'number') {
        const c = typeof card.cost === 'number' ? card.cost + (inst.costModifier ?? 0) : -1;
        if (c < 0 || c < filter.costMin) return false;
      }
      if (typeof filter.costMax === 'number') {
        const c = typeof card.cost === 'number' ? card.cost + (inst.costModifier ?? 0) : -1;
        if (c < 0 || c > filter.costMax) return false;
      }
      return true;
    });
    if (matches.length === 0) return false;
  }
  if (typeof cost.bottomOfDeckFromTrash === 'number' && me.trash.length < cost.bottomOfDeckFromTrash) return false;
  if (cost.bottomOfDeckFromTrashFilter) {
    const { count, filter } = cost.bottomOfDeckFromTrashFilter;
    const matches = me.trash.filter((id) => {
      const inst = state.instances[id];
      const card = inst ? state.cardLibrary[inst.cardId] : undefined;
      if (!card) return false;
      if (filter.typeIncludes && !card.traits?.some((t) => t.includes(filter.typeIncludes!))) return false;
      if (filter.trait && !card.traits?.includes(filter.trait)) return false;
      if (filter.kind && card.kind !== filter.kind) return false;
      return true;
    });
    if (matches.length < count) return false;
  }
  if (typeof cost.bottomOfDeckFromHand === 'number' && me.hand.length < cost.bottomOfDeckFromHand) return false;
  if (cost.bottomOfDeckSelf) {
    const inst = state.instances[sourceInstanceId];
    if (!inst) return false;
  }
  if (typeof cost.lifeToHand === 'number' && me.life.length < cost.lifeToHand) return false;
  if (typeof cost.selfPowerCost === 'number') {
    // Cost requires an active own leader (text: 'give your 1 active Leader −X power').
    if (me.leader.rested) return false;
  }
  if (typeof cost.donRestedToActive === 'number' && me.donRested.length < cost.donRestedToActive) return false;
  if (typeof cost.millSelf === 'number' && me.deck.length < cost.millSelf) return false;
  if (cost.bottomOfDeckOwnChar) {
    const filter = cost.bottomOfDeckOwnChar.filter;
    const matches = me.field.filter((inst) => {
      if (!filter) return true;
      const card = state.cardLibrary[inst.cardId];
      if (!card) return false;
      if (typeof filter.powerMax === 'number' && (typeof (card as { power?: number }).power !== 'number' || (card as { power: number }).power > filter.powerMax)) return false;
      if (typeof filter.powerMin === 'number' && (typeof (card as { power?: number }).power !== 'number' || (card as { power: number }).power < filter.powerMin)) return false;
      if (filter.trait && (!card.traits || !card.traits.includes(filter.trait))) return false;
      return true;
    });
    if (matches.length === 0) return false;
  }
  if (cost.discardHandFilter) {
    const need = cost.discardHandFilter.count;
    const filter = cost.discardHandFilter.filter;
    const matches = me.hand.filter((id) => {
      const inst = state.instances[id];
      const card = inst ? state.cardLibrary[inst.cardId] : undefined;
      if (!card) return false;
      if (filter.kind && card.kind !== filter.kind) return false;
      if (filter.kindsAny && !filter.kindsAny.includes(card.kind as 'character' | 'event' | 'stage')) return false;
      if (filter.trait && (!card.traits || !card.traits.includes(filter.trait))) return false;
      return true;
    });
    if (matches.length < need) return false;
  }
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
    // F2: dispatch on_own_don_returned for any spec clauses listening on the
    // controller's field (EB02-035 Sanji & Pudding etc.).
    state = broadcastTriggerToOwnField(state, 'on_own_don_returned', controller);
  }
  if (typeof cost.discardHand === 'number') {
    for (let i = 0; i < cost.discardHand && me.hand.length > 0; i++) {
      me.trash.push(me.hand.shift()!);
    }
  }
  if (typeof cost.flipLife === 'number') {
    // F6 (CR §10-1-3): "Flip N of your Life cards face-up". Top N stay in
    // the life zone but become revealed to both players via lifeFaceUp.
    // Distinct from attack-life-flip (which REMOVES the life card); this
    // cost reveals WITHOUT removing.
    for (let i = 0; i < cost.flipLife && i < me.life.length; i++) {
      me.lifeFaceUp[me.life[i]] = true;
    }
  }
  if (cost.restSelf) {
    const inst = state.instances[sourceInstanceId];
    if (inst) inst.rested = true;
  }
  if (cost.restLeader) {
    me.leader.rested = true;
    const leaderInst = state.instances[me.leader.instanceId];
    if (leaderInst) leaderInst.rested = true;
  }
  if (cost.restLeaderOrStageFilter) {
    // Prefer resting stage first if available (preserves leader for attacks).
    if (me.stage && !me.stage.rested) {
      me.stage.rested = true;
      const inst = state.instances[me.stage.instanceId];
      if (inst) inst.rested = true;
    } else if (!me.leader.rested) {
      me.leader.rested = true;
      const inst = state.instances[me.leader.instanceId];
      if (inst) inst.rested = true;
    }
  }
  if (cost.restOwnCharFilter) {
    const need = cost.restOwnCharFilter.count;
    const filter = cost.restOwnCharFilter.filter;
    let rested = 0;
    for (const inst of me.field) {
      if (rested >= need) break;
      if (inst.rested) continue;
      if (filter) {
        const card = state.cardLibrary[inst.cardId];
        if (!card) continue;
        if (typeof filter.costMin === 'number') {
          const c = typeof card.cost === 'number' ? card.cost + (inst.costModifier ?? 0) : -1;
          if (c < 0 || c < filter.costMin) continue;
        }
        if (typeof filter.costMax === 'number') {
          const c = typeof card.cost === 'number' ? card.cost + (inst.costModifier ?? 0) : -1;
          if (c < 0 || c > filter.costMax) continue;
        }
        if (filter.trait && !card.traits?.includes(filter.trait)) continue;
      }
      inst.rested = true;
      const ref = state.instances[inst.instanceId];
      if (ref) ref.rested = true;
      rested++;
    }
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
  if (cost.returnSelfChar) {
    const filter = cost.returnSelfChar.filter;
    const match = me.field.find((inst) => {
      const card = state.cardLibrary[inst.cardId];
      if (!card) return false;
      if (!filter) return true;
      if (filter.trait && (!card.traits || !card.traits.includes(filter.trait))) return false;
      if (typeof filter.costMin === 'number') {
        const c = typeof card.cost === 'number' ? card.cost + (inst.costModifier ?? 0) : -1;
        if (c < 0 || c < filter.costMin) return false;
      }
      if (typeof filter.costMax === 'number') {
        const c = typeof card.cost === 'number' ? card.cost + (inst.costModifier ?? 0) : -1;
        if (c < 0 || c > filter.costMax) return false;
      }
      return true;
    });
    if (match) {
      const idx = me.field.findIndex((i) => i.instanceId === match.instanceId);
      const removed = me.field.splice(idx, 1)[0];
      while (removed.attachedDon.length > 0) me.donRested.push(removed.attachedDon.shift()!);
      me.hand.push(removed.instanceId);
      // Reset transient flags so it can re-enter play cleanly.
      state.instances[removed.instanceId].summoningSick = false;
      state.instances[removed.instanceId].rested = false;
    }
  }
  if (typeof cost.bottomOfDeckFromTrash === 'number') {
    for (let i = 0; i < cost.bottomOfDeckFromTrash && me.trash.length > 0; i++) {
      me.deck.push(me.trash.shift()!);
    }
  }
  if (cost.bottomOfDeckFromTrashFilter) {
    const { count, filter } = cost.bottomOfDeckFromTrashFilter;
    let moved = 0;
    for (let i = 0; i < me.trash.length && moved < count;) {
      const id = me.trash[i];
      const inst = state.instances[id];
      const card = inst ? state.cardLibrary[inst.cardId] : undefined;
      const match = !!card
        && (!filter.typeIncludes || card.traits?.some((t) => t.includes(filter.typeIncludes!)))
        && (!filter.trait || card.traits?.includes(filter.trait))
        && (!filter.kind || card.kind === filter.kind);
      if (match) {
        me.trash.splice(i, 1);
        me.deck.push(id);
        moved++;
      } else {
        i++;
      }
    }
  }
  if (typeof cost.bottomOfDeckFromHand === 'number') {
    for (let i = 0; i < cost.bottomOfDeckFromHand && me.hand.length > 0; i++) {
      me.deck.push(me.hand.shift()!);
    }
  }
  if (cost.bottomOfDeckSelf) {
    const inst = state.instances[sourceInstanceId];
    if (inst) {
      for (const pid of ['A', 'B'] as PlayerId[]) {
        const pl = state.players[pid];
        const idx = pl.field.findIndex((i) => i.instanceId === sourceInstanceId);
        if (idx !== -1) {
          pl.field.splice(idx, 1);
          pl.deck.push(sourceInstanceId);
          break;
        }
        // Self stage cards
        if (pl.stage && pl.stage.instanceId === sourceInstanceId) {
          pl.deck.push(sourceInstanceId);
          pl.stage = null;
          break;
        }
      }
    }
  }
  if (typeof cost.lifeToHand === 'number') {
    for (let i = 0; i < cost.lifeToHand && me.life.length > 0; i++) {
      me.hand.push(me.life.shift()!);
    }
  }
  if (typeof cost.selfPowerCost === 'number') {
    me.leader.powerModifier = (me.leader.powerModifier ?? 0) - cost.selfPowerCost;
    // 'this turn' duration is implicit; engine clears powerModifier at end of turn.
  }
  if (typeof cost.donRestedToActive === 'number') {
    for (let i = 0; i < cost.donRestedToActive && me.donRested.length > 0; i++) {
      me.donCostArea.push(me.donRested.shift()!);
    }
  }
  if (typeof cost.millSelf === 'number') {
    for (let i = 0; i < cost.millSelf && me.deck.length > 0; i++) {
      me.trash.push(me.deck.shift()!);
    }
  }
  if (cost.bottomOfDeckOwnChar) {
    const filter = cost.bottomOfDeckOwnChar.filter;
    const match = me.field.find((inst) => {
      if (!filter) return true;
      const card = state.cardLibrary[inst.cardId];
      if (!card) return false;
      if (typeof filter.powerMax === 'number' && (typeof (card as { power?: number }).power !== 'number' || (card as { power: number }).power > filter.powerMax)) return false;
      if (typeof filter.powerMin === 'number' && (typeof (card as { power?: number }).power !== 'number' || (card as { power: number }).power < filter.powerMin)) return false;
      if (filter.trait && (!card.traits || !card.traits.includes(filter.trait))) return false;
      return true;
    });
    if (match) {
      const idx = me.field.findIndex((i) => i.instanceId === match.instanceId);
      me.field.splice(idx, 1);
      me.deck.push(match.instanceId);
    }
  }
  if (cost.discardHandFilter) {
    const filter = cost.discardHandFilter.filter;
    const sourceInst = state.instances[sourceInstanceId];
    for (let i = 0; i < cost.discardHandFilter.count; i++) {
      const idx = me.hand.findIndex((id) => {
        const inst = state.instances[id];
        const card = inst ? state.cardLibrary[inst.cardId] : undefined;
        if (!card) return false;
        if (filter.kind && card.kind !== filter.kind) return false;
        if (filter.kindsAny && !filter.kindsAny.includes(card.kind as 'character' | 'event' | 'stage')) return false;
        if (filter.trait && (!card.traits || !card.traits.includes(filter.trait))) return false;
        if (typeof filter.powerMax === 'number'
            && (typeof (card as { power?: number }).power !== 'number'
              || (card as { power: number }).power > filter.powerMax)) return false;
        return true;
      });
      if (idx === -1) break;
      const discardedId = me.hand.splice(idx, 1)[0];
      // Stamp source's lastDiscardedName for follow-up
      // "same name as the trashed card" constraints (EB02-039 etc.).
      const discInst = state.instances[discardedId];
      const discCard = discInst ? state.cardLibrary[discInst.cardId] : undefined;
      if (sourceInst && discCard) sourceInst.lastDiscardedName = discCard.name;
      me.trash.push(discardedId);
    }
  }
  // OTHER reference used only for diagnostic ergonomics — keep around.
  void OTHER;
  void controller;
  return state;
}

/** Public cost helpers — used by migration-v2 to pay clause costs before
 *  dispatching applyActionV2. Replacements path uses the internal versions. */
export function canPayClauseCost(
  state: GameState,
  controller: PlayerId,
  sourceInstanceId: string,
  cost: EffectCostV2,
): boolean {
  return canPayCost(state, controller, sourceInstanceId, cost);
}

export function payClauseCost(
  state: GameState,
  controller: PlayerId,
  sourceInstanceId: string,
  cost: EffectCostV2,
): GameState | null {
  return payCost(state, controller, sourceInstanceId, cost);
}

/** Re-export the cost type so callers don't need to dig into types-v2. */
export type { EffectCostV2 };
