/**
 * Engine V2 — F-8D player-choice COST payments.
 *
 * Some cost keys pay with cards the PLAYER chooses (discard from hand,
 * bottom-deck from hand, rest/return own characters, ...). The V0 handlers
 * auto-pick deterministically (hand/field head) — correct for AI and
 * simulation, wrong for a human seat. This module is the single registry of
 * which cost keys involve a choice and what the candidate set is, derived
 * purely from the cost shape + game state (no card-specific logic).
 *
 * The dispatcher consults `nextCostChoiceKey` before paying a clause's cost
 * for a human seat; a non-null key suspends into the generic target picker
 * (pending.costPick). RESOLVE_TARGET_PICK re-enters the dispatcher with the
 * accumulated picks in `opts.chosenCostIds`; handlers consume them via
 * `ctx.chosenCostIds` and keep the V0 head-pick when absent.
 *
 * Source-fixed costs (trashSelf / koSelfCharacter / returnSelfChar pay with
 * the SOURCE instance) and fungible/zone-structural costs (donCost, millSelf,
 * flipLife, lifeToHand, restLeader, ...) involve no choice and stay V0.
 */

import type { EffectCostV2 } from '../../spec/types.js';
import type { GameState, InstanceId } from '../../state/types.js';
import type { HandlerCtx } from '../types.js';
import { filterCostCount, filterCostFilter, matchesCardFilter } from './filter.js';

export interface CostChoiceSpec {
  /** Exact number of cards the player must pick. */
  readonly count: number;
  /** Eligible instance ids (already filtered). */
  readonly candidateIds: ReadonlyArray<InstanceId>;
  /** Picker subtitle — human wording, never an internal key. */
  readonly summary: string;
}

function numVal(cost: EffectCostV2, key: string): number {
  const v = cost[key];
  return typeof v === 'number' ? v : 0;
}

function plural(n: number): string {
  return n === 1 ? 'card' : 'cards';
}

/** Candidate set + count for ONE choice-capable cost key, or null when the
 *  key involves no player choice. `exclude` removes ids already committed
 *  to earlier choice keys on the same cost object. */
export function costChoiceFor(
  state: GameState,
  ctx: HandlerCtx,
  cost: EffectCostV2,
  key: string,
  exclude?: ReadonlySet<InstanceId>,
): CostChoiceSpec | null {
  const pl = state.players[ctx.controller];
  const notExcluded = (id: InstanceId): boolean => exclude === undefined || !exclude.has(id);

  switch (key) {
    case 'discardHand': {
      const n = numVal(cost, key);
      if (n <= 0) return null;
      return {
        count: n,
        candidateIds: pl.hand.filter(notExcluded),
        summary: `Choose ${n} ${plural(n)} from your hand to trash.`,
      };
    }
    case 'trashFromHand': {
      const n = numVal(cost, key);
      if (n <= 0) return null;
      return {
        count: n,
        candidateIds: pl.hand.filter(notExcluded),
        summary: `Choose ${n} ${plural(n)} from your hand to trash.`,
      };
    }
    case 'bottomOfDeckFromHand': {
      const n = numVal(cost, key);
      if (n <= 0) return null;
      return {
        count: n,
        candidateIds: pl.hand.filter(notExcluded),
        summary: `Choose ${n} ${plural(n)} from your hand to place at the bottom of your deck.`,
      };
    }
    case 'discardHandFilter': {
      const value = cost[key];
      const count = filterCostCount(value);
      const filter = filterCostFilter(value);
      if (count <= 0) return null;
      const candidates = pl.hand.filter((id) => {
        if (!notExcluded(id)) return false;
        const inst = state.instances[id];
        return inst !== undefined && matchesCardFilter(state, inst, filter);
      });
      return {
        count,
        candidateIds: candidates,
        summary: `Choose ${count} matching ${plural(count)} from your hand to trash.`,
      };
    }
    case 'revealHand': {
      return {
        count: 1,
        candidateIds: pl.hand.filter(notExcluded),
        summary: 'Choose 1 card from your hand to reveal.',
      };
    }
    case 'restOwnCharFilter': {
      const value = cost[key];
      const count = filterCostCount(value);
      const filter = filterCostFilter(value);
      if (count <= 0) return null;
      const candidates = pl.field
        .filter((c) => c.rested === false && matchesCardFilter(state, c, filter))
        .map((c) => c.instanceId)
        .filter(notExcluded);
      return {
        count,
        candidateIds: candidates,
        summary: `Choose ${count} of your Characters to rest.`,
      };
    }
    case 'returnOwnCharFilter': {
      const value = cost[key];
      const count = filterCostCount(value);
      const filter = filterCostFilter(value);
      if (count <= 0) return null;
      const candidates = pl.field
        .filter((c) => matchesCardFilter(state, c, filter))
        .map((c) => c.instanceId)
        .filter(notExcluded);
      return {
        count,
        candidateIds: candidates,
        summary: `Choose ${count} of your Characters to return to your hand.`,
      };
    }
    case 'bottomOfDeckOwnChar': {
      const value = cost[key];
      const count = filterCostCount(value);
      const filter = filterCostFilter(value);
      if (count <= 0) return null;
      const candidates = pl.field
        .filter((c) => matchesCardFilter(state, c, filter))
        .map((c) => c.instanceId)
        .filter(notExcluded);
      return {
        count,
        candidateIds: candidates,
        summary: `Choose ${count} of your Characters to place at the bottom of your deck.`,
      };
    }
    default:
      return null;
  }
}

/**
 * First cost key on `cost` that still needs a player choice: choice-capable,
 * not yet answered in `chosen`, and with MORE candidates than required (when
 * candidates exactly equal the required count there is no choice to make —
 * the V0 deterministic payment is the only legal payment).
 */
export function nextCostChoiceKey(
  state: GameState,
  ctx: HandlerCtx,
  cost: EffectCostV2,
  chosen?: Readonly<Record<string, ReadonlyArray<InstanceId>>>,
): { readonly key: string; readonly spec: CostChoiceSpec } | null {
  const committed = new Set<InstanceId>();
  if (chosen !== undefined) {
    for (const ids of Object.values(chosen)) for (const id of ids) committed.add(id);
  }
  for (const key of Object.keys(cost)) {
    if (key === 'bind') continue;
    if (chosen?.[key] !== undefined) continue;
    const spec = costChoiceFor(state, ctx, cost, key, committed);
    if (spec === null) continue;
    if (spec.candidateIds.length > spec.count) return { key, spec };
  }
  return null;
}
