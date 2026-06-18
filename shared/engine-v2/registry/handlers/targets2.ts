/**
 * Engine V2 — second batch of target resolvers (corpus gaps).
 */

import type { Card } from '../../cards/Card.js';
import type { EffectTargetV2 } from '../../spec/types.js';
import {
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

// ─── opp_don_or_character: prefer opp characters matching the filter;
//     fall back to opp DON area (DON has no per-instance target IDs in this
//     engine model — the `rest_opp_don`-style follow-up action consumes
//     DON from cost area directly). V0: returns opp characters only.
const oppDonOrCharacter: TargetResolver = (state: GameState, ctx: HandlerCtx, t: EffectTargetV2): InstanceId[] => {
  const opp = state.players[OTHER[ctx.controller]];
  const filter = t['filter'];
  const f = typeof filter === 'object' && filter !== null
    ? (filter as { trait?: string; color?: string; minCost?: number; maxCost?: number })
    : undefined;
  const count = typeof t['count'] === 'number' ? (t['count'] as number) : 1;
  const hits: InstanceId[] = [];
  for (const inst of opp.field) {
    if (hits.length >= count) break;
    if (f !== undefined) {
      const card = state.cardLibrary[inst.cardId] as Card | undefined;
      if (card === undefined) continue;
      if (f.trait !== undefined && !card.traits.includes(f.trait)) continue;
      if (f.color !== undefined && !card.colors.includes(f.color as never)) continue;
      const cost = card.kind === 'character' || card.kind === 'event' || card.kind === 'stage'
        ? card.cost
        : 0;
      if (f.minCost !== undefined && cost < f.minCost) continue;
      if (f.maxCost !== undefined && cost > f.maxCost) continue;
    }
    hits.push(inst.instanceId);
  }
  return hits;
};

// ─── binding: resolve a card bound earlier in the SAME clause (via a
//     cost.bind / target.bind write to ClauseScratch) to its live instance.
//     Generic — any action can target a prior binding (e.g. "place THE
//     REVEALED card on top of deck"). Returns [] if the binding is absent
//     or its instance is gone. Card-agnostic.
const bindingTarget: TargetResolver = (state: GameState, ctx: HandlerCtx, t: EffectTargetV2): InstanceId[] => {
  const name = typeof t['name'] === 'string' ? (t['name'] as string) : '';
  if (name === '' || ctx.scratch === undefined) return [];
  const snap = ctx.scratch[name];
  const id = snap?.instanceId ?? null;
  return id !== null && state.instances[id] !== undefined ? [id] : [];
};

export function registerTargetResolvers2(): void {
  targetResolvers.register('opp_don_or_character', oppDonOrCharacter);
  targetResolvers.register('binding', bindingTarget);
}
