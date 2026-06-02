/**
 * Engine V2 — target resolvers.
 *
 * Pure functions from (state, ctx, target) → InstanceId[]. No mutation.
 * Filter matching (color / trait / cost / power / keyword) handled by
 * `matchesFilter` inline below.
 *
 * Cross-references:
 * - Implementation spec §3.3
 * - Plan v1 §3.3
 * - V1 reference: shared/engine/effectSpec/runner-v2.ts:470-...
 */

import type { Card } from '../../cards/Card.js';
import { instHasKeyword } from '../../state/derived/keyword.js';
import { effectivePower } from '../../state/derived/power.js';
import type { EffectTargetV2 } from '../../spec/types.js';
import {
  type CardInstance,
  type GameState,
  type InstanceId,
  type PlayerId,
} from '../../state/types.js';
import {
  type HandlerCtx,
  type TargetResolver,
  targetResolvers,
} from '../types.js';

const OTHER: Record<PlayerId, PlayerId> = { A: 'B', B: 'A' };

// ────────────────────────────────────────────────────────────────────
// Filter matcher
// ────────────────────────────────────────────────────────────────────

interface TargetFilter {
  readonly color?: string;
  readonly trait?: string;
  readonly type?: string;
  readonly keyword?: string;
  readonly minCost?: number;
  readonly maxCost?: number;
  readonly minPower?: number;
  readonly maxPower?: number;
  readonly notSelf?: boolean;
  readonly rested?: boolean;
  readonly active?: boolean;
}

function getFilter(target: EffectTargetV2): TargetFilter | undefined {
  const f = target['filter'];
  return typeof f === 'object' && f !== null ? (f as TargetFilter) : undefined;
}

function getCount(target: EffectTargetV2): number {
  const c = target['count'];
  return typeof c === 'number' ? c : 1;
}

function matchesFilter(
  state: GameState,
  inst: CardInstance,
  filter: TargetFilter | undefined,
  selfInstanceId?: InstanceId,
): boolean {
  if (filter === undefined) return true;
  const card = state.cardLibrary[inst.cardId] as Card | undefined;
  if (card === undefined) return false;

  if (filter.color !== undefined && !card.colors.includes(filter.color as never)) return false;
  if (filter.trait !== undefined && !card.traits.includes(filter.trait)) return false;
  if (filter.type !== undefined && !card.traits.some((t) => t.includes(filter.type!))) return false;
  if (filter.keyword !== undefined && !instHasKeyword(state, inst, filter.keyword)) return false;

  if (filter.minCost !== undefined || filter.maxCost !== undefined) {
    const cost = (card.kind === 'character' || card.kind === 'event' || card.kind === 'stage')
      ? card.cost
      : 0;
    if (filter.minCost !== undefined && cost < filter.minCost) return false;
    if (filter.maxCost !== undefined && cost > filter.maxCost) return false;
  }
  if (filter.minPower !== undefined || filter.maxPower !== undefined) {
    const power = effectivePower(state, inst);
    if (filter.minPower !== undefined && power < filter.minPower) return false;
    if (filter.maxPower !== undefined && power > filter.maxPower) return false;
  }
  if (filter.notSelf === true && selfInstanceId !== undefined && inst.instanceId === selfInstanceId) {
    return false;
  }
  if (filter.rested === true && inst.rested !== true) return false;
  if (filter.active === true && inst.rested === true) return false;

  return true;
}

// ────────────────────────────────────────────────────────────────────
// Target resolvers
// ────────────────────────────────────────────────────────────────────

const selfTarget: TargetResolver = (state, ctx) => {
  return state.instances[ctx.sourceInstanceId] !== undefined ? [ctx.sourceInstanceId] : [];
};

function yourLeader(state: GameState, ctx: HandlerCtx): InstanceId[] {
  return [state.players[ctx.controller].leader.instanceId];
}
function oppLeader(state: GameState, ctx: HandlerCtx): InstanceId[] {
  return [state.players[OTHER[ctx.controller]].leader.instanceId];
}

function yourCharacter(state: GameState, ctx: HandlerCtx, t: EffectTargetV2): InstanceId[] {
  const pl = state.players[ctx.controller];
  const filter = getFilter(t);
  const hits = pl.field.filter((i) => matchesFilter(state, i, filter, ctx.sourceInstanceId));
  return hits.slice(0, getCount(t)).map((i) => i.instanceId);
}
function yourLeaderOrCharacter(state: GameState, ctx: HandlerCtx, t: EffectTargetV2): InstanceId[] {
  const pl = state.players[ctx.controller];
  const filter = getFilter(t);
  const out: InstanceId[] = [];
  if (matchesFilter(state, pl.leader, filter, ctx.sourceInstanceId)) {
    out.push(pl.leader.instanceId);
  }
  for (const inst of pl.field) {
    if (matchesFilter(state, inst, filter, ctx.sourceInstanceId)) out.push(inst.instanceId);
  }
  return out.slice(0, getCount(t));
}
function oppCharacter(state: GameState, ctx: HandlerCtx, t: EffectTargetV2): InstanceId[] {
  const pl = state.players[OTHER[ctx.controller]];
  const filter = getFilter(t);
  const hits = pl.field.filter((i) => matchesFilter(state, i, filter, ctx.sourceInstanceId));
  return hits.slice(0, getCount(t)).map((i) => i.instanceId);
}
function oppLeaderOrCharacter(state: GameState, ctx: HandlerCtx, t: EffectTargetV2): InstanceId[] {
  const pl = state.players[OTHER[ctx.controller]];
  const filter = getFilter(t);
  const out: InstanceId[] = [];
  if (matchesFilter(state, pl.leader, filter, ctx.sourceInstanceId)) {
    out.push(pl.leader.instanceId);
  }
  for (const inst of pl.field) {
    if (matchesFilter(state, inst, filter, ctx.sourceInstanceId)) out.push(inst.instanceId);
  }
  return out.slice(0, getCount(t));
}
function anyCharacter(state: GameState, ctx: HandlerCtx, t: EffectTargetV2): InstanceId[] {
  const filter = getFilter(t);
  const oppHits = state.players[OTHER[ctx.controller]].field.filter(
    (i) => matchesFilter(state, i, filter, ctx.sourceInstanceId),
  );
  const ownHits = state.players[ctx.controller].field.filter(
    (i) => matchesFilter(state, i, filter, ctx.sourceInstanceId),
  );
  return [...oppHits, ...ownHits].slice(0, getCount(t)).map((i) => i.instanceId);
}

function allYourCharacters(state: GameState, ctx: HandlerCtx, t: EffectTargetV2): InstanceId[] {
  const filter = getFilter(t);
  return state.players[ctx.controller].field
    .filter((i) => matchesFilter(state, i, filter, ctx.sourceInstanceId))
    .map((i) => i.instanceId);
}
function allOppCharacters(state: GameState, ctx: HandlerCtx, t: EffectTargetV2): InstanceId[] {
  const filter = getFilter(t);
  return state.players[OTHER[ctx.controller]].field
    .filter((i) => matchesFilter(state, i, filter, ctx.sourceInstanceId))
    .map((i) => i.instanceId);
}
function allCharacters(state: GameState, ctx: HandlerCtx, t: EffectTargetV2): InstanceId[] {
  const filter = getFilter(t);
  return [
    ...state.players[ctx.controller].field,
    ...state.players[OTHER[ctx.controller]].field,
  ]
    .filter((i) => matchesFilter(state, i, filter, ctx.sourceInstanceId))
    .map((i) => i.instanceId);
}

function oppHandCard(state: GameState, ctx: HandlerCtx, t: EffectTargetV2): InstanceId[] {
  const pl = state.players[OTHER[ctx.controller]];
  const filter = getFilter(t);
  for (const id of pl.hand) {
    const inst = state.instances[id];
    if (inst === undefined) continue;
    if (matchesFilter(state, inst, filter, ctx.sourceInstanceId)) return [id];
  }
  return [];
}
function ownTrashCard(state: GameState, ctx: HandlerCtx, t: EffectTargetV2): InstanceId[] {
  const pl = state.players[ctx.controller];
  const filter = getFilter(t);
  // Most-recent-first scan (top of trash)
  for (let i = pl.trash.length - 1; i >= 0; i--) {
    const id = pl.trash[i]!;
    const inst = state.instances[id];
    if (inst === undefined) continue;
    if (matchesFilter(state, inst, filter, ctx.sourceInstanceId)) return [id];
  }
  return [];
}

function topOfDeck(state: GameState, ctx: HandlerCtx): InstanceId[] {
  const pl = state.players[ctx.controller];
  const top = pl.deck[0];
  return top !== undefined ? [top] : [];
}
function topOfOppDeck(state: GameState, ctx: HandlerCtx): InstanceId[] {
  const pl = state.players[OTHER[ctx.controller]];
  const top = pl.deck[0];
  return top !== undefined ? [top] : [];
}
function ownLifeTop(state: GameState, ctx: HandlerCtx): InstanceId[] {
  const pl = state.players[ctx.controller];
  const top = pl.life[0];
  return top !== undefined ? [top] : [];
}
function oppLifeTop(state: GameState, ctx: HandlerCtx): InstanceId[] {
  const pl = state.players[OTHER[ctx.controller]];
  const top = pl.life[0];
  return top !== undefined ? [top] : [];
}

// ────────────────────────────────────────────────────────────────────
// Registration
// ────────────────────────────────────────────────────────────────────

export function registerTargetResolvers(): void {
  targetResolvers.register('self', selfTarget);
  targetResolvers.register('your_leader', yourLeader);
  targetResolvers.register('opp_leader', oppLeader);
  targetResolvers.register('your_character', yourCharacter);
  targetResolvers.register('your_leader_or_character', yourLeaderOrCharacter);
  targetResolvers.register('opp_character', oppCharacter);
  targetResolvers.register('opp_leader_or_character', oppLeaderOrCharacter);
  targetResolvers.register('any_character', anyCharacter);
  targetResolvers.register('all_your_characters', allYourCharacters);
  targetResolvers.register('all_opp_characters', allOppCharacters);
  targetResolvers.register('all_characters', allCharacters);
  targetResolvers.register('opp_hand_card', oppHandCard);
  targetResolvers.register('own_trash_card', ownTrashCard);
  targetResolvers.register('top_of_deck', topOfDeck);
  targetResolvers.register('top_of_opp_deck', topOfOppDeck);
  targetResolvers.register('own_life_top', ownLifeTop);
  targetResolvers.register('opp_life_top', oppLifeTop);
}
