/**
 * Engine V2 — second batch of action handlers (high-frequency, common).
 *
 * Adds composite + zone-movement actions needed by most cards:
 *   sequence, chained_actions, recursion (trash→hand), search_deck,
 *   play_for_free, mill, transfer_attached_don, set_active_don,
 *   return_opp_don_to_deck, return_to_hand_from_field, shuffle_deck,
 *   give_next_play_cost_modifier, end_of_turn_trash.
 */

import { detachAllAttachedDon } from '../../state/derived/don.js';
import { resetInstanceTransientState } from '../../state/derived/reset.js';
import { RngService } from '../../state/RngService.js';
import type { EffectActionV2 } from '../../spec/types.js';
import {
  type CardInstance,
  type GameState,
  type InstanceId,
  type PlayerId,
} from '../../state/types.js';
import {
  type ActionHandler,
  actionHandlers,
} from '../types.js';
import { resolveCount } from './formula.js';

const OTHER: Record<PlayerId, PlayerId> = { A: 'B', B: 'A' };

function num(a: EffectActionV2, key: string, fallback = 0): number {
  const v = a[key];
  return typeof v === 'number' ? v : fallback;
}

function findInstZone(state: GameState, instanceId: InstanceId): {
  side: PlayerId;
  zone: 'leader' | 'field' | 'stage' | 'hand' | 'deck' | 'trash' | 'life' | 'exile';
} | null {
  for (const side of ['A', 'B'] as PlayerId[]) {
    const pl = state.players[side];
    if (pl.leader.instanceId === instanceId) return { side, zone: 'leader' };
    if (pl.field.some((c) => c.instanceId === instanceId)) return { side, zone: 'field' };
    if (pl.stage?.instanceId === instanceId) return { side, zone: 'stage' };
    if (pl.hand.includes(instanceId)) return { side, zone: 'hand' };
    if (pl.deck.includes(instanceId)) return { side, zone: 'deck' };
    if (pl.trash.includes(instanceId)) return { side, zone: 'trash' };
    if (pl.life.includes(instanceId)) return { side, zone: 'life' };
    if (pl.exile.includes(instanceId)) return { side, zone: 'exile' };
  }
  return null;
}

// ─── sequence: run sub-actions in order, sharing state
const sequence: ActionHandler = (state, ctx, action, targets) => {
  const subs = action['actions'];
  if (!Array.isArray(subs)) return state;
  let next = state;
  for (const sub of subs as EffectActionV2[]) {
    if (typeof sub !== 'object' || sub === null || typeof sub.kind !== 'string') continue;
    if (!actionHandlers.has(sub.kind)) continue;
    const handler = actionHandlers.get(sub.kind);
    next = handler(next, ctx, sub, targets);
  }
  return next;
};

// ─── chained_actions: alias for sequence (some cards use this name)
const chainedActions: ActionHandler = sequence;

// ─── recursion: targets are own_trash_card instances → move to hand
const recursion: ActionHandler = (state, ctx, _action, targets) => {
  const pl = state.players[ctx.controller];
  for (const id of targets) {
    const idx = pl.trash.indexOf(id);
    if (idx === -1) continue;
    pl.trash.splice(idx, 1);
    pl.hand.push(id);
    (state.history as Array<unknown>).push({
      type: 'CARD_RETURNED_TO_HAND_FROM_TRASH',
      instanceId: id,
      controller: ctx.controller,
    });
  }
  return state;
};

// ─── mill: trash N from top of opp's deck
const mill: ActionHandler = (state, ctx, action) => {
  const n = resolveCount(state, ctx, action, 1);
  const pl = state.players[OTHER[ctx.controller]];
  for (let i = 0; i < n; i++) {
    const id = pl.deck.shift();
    if (id === undefined) {
      state.result = { loser: OTHER[ctx.controller], reason: 'deck_out' };
      return state;
    }
    pl.trash.push(id);
  }
  return state;
};

// ─── shuffle_deck: deterministic via RngService
const shuffleDeck: ActionHandler = (state, ctx) => {
  const rng = RngService.pull(state);
  rng.shuffle(state.players[ctx.controller].deck);
  return state;
};

// ─── transfer_attached_don: move N DON → first target. Honors action.fromKind:
//     'your_leader' → drain from own leader's attached pools.
//     'any_own' → drain from any own field char (first non-empty source).
//     default → drain from source instance.
//     Drains active pool first, then rested, preserving per-pool state.
const transferAttachedDon: ActionHandler = (state, ctx, action, targets) => {
  if (targets.length === 0) return state;
  const n = resolveCount(state, ctx, action, 1);
  const dest = state.instances[targets[0]!];
  if (dest === undefined) return state;
  const fromKind = typeof action['fromKind'] === 'string' ? (action['fromKind'] as string) : 'self';
  const pl = state.players[ctx.controller];

  const drainPool: CardInstance[] = [];
  if (fromKind === 'your_leader') {
    drainPool.push(pl.leader);
  } else if (fromKind === 'any_own') {
    drainPool.push(pl.leader, ...pl.field);
    if (pl.stage !== null) drainPool.push(pl.stage);
  } else {
    const src = state.instances[ctx.sourceInstanceId];
    if (src !== undefined) drainPool.push(src);
  }

  let moved = 0;
  for (const src of drainPool) {
    while (moved < n && src.attachedDon.length > 0) {
      const id = src.attachedDon.shift();
      if (id !== undefined) {
        dest.attachedDon.push(id);
        moved += 1;
      }
    }
  }
  for (const src of drainPool) {
    while (moved < n && src.attachedDonRested.length > 0) {
      const id = src.attachedDonRested.shift();
      if (id !== undefined) {
        dest.attachedDonRested.push(id);
        moved += 1;
      }
    }
  }
  return state;
};

// ─── set_active_don: un-rest N DON in controller's donRested → donCostArea
const setActiveDon: ActionHandler = (state, ctx, action) => {
  const n = resolveCount(state, ctx, action, 1);
  const pl = state.players[ctx.controller];
  let moved = 0;
  while (moved < n && pl.donRested.length > 0) {
    const id = pl.donRested.shift();
    if (id !== undefined) {
      pl.donCostArea.push(id);
      moved += 1;
    }
  }
  return state;
};

// ─── return_opp_don_to_deck: opp's donCostArea N → donDeck
const returnOppDonToDeck: ActionHandler = (state, ctx, action) => {
  const n = resolveCount(state, ctx, action, 1);
  const opp = state.players[OTHER[ctx.controller]];
  let moved = 0;
  while (moved < n && opp.donCostArea.length > 0) {
    const id = opp.donCostArea.shift();
    if (id !== undefined) {
      opp.donDeck.push(id);
      moved += 1;
      state.pendingDonReturned[ctx.controller] = (state.pendingDonReturned[ctx.controller] ?? 0) + 1;
    }
  }
  return state;
};

// ─── give_next_play_cost_modifier: set nextPlayCostModifier (e.g., -1 reduces
//     next play cost by 1)
const giveNextPlayCostModifier: ActionHandler = (state, ctx, action) => {
  const n = resolveCount(state, ctx, action, 0);
  state.players[ctx.controller].nextPlayCostModifier =
    (state.players[ctx.controller].nextPlayCostModifier ?? 0) + n;
  return state;
};

// ─── end_of_turn_trash: queue source for trash at end of turn
const endOfTurnTrash: ActionHandler = (state, ctx) => {
  const inst = state.instances[ctx.sourceInstanceId];
  if (inst === undefined) return state;
  inst.endOfTurnTrash = true;
  return state;
};

// ─── play_for_free: zone (hand/trash) → field at zero cost.
//     Honors action.from ('hand' default, 'trash'), action.rested
//     (plays the card rested if true), action.count (limits how many of the
//     resolved targets to actually play — cards.json provides count).
//     Filter params (colorMustDifferFromLastBounced, nameMatchesLastDiscarded,
//     uniqueByName) are V0 best-effort — gate via resolved target list since
//     the parent clause's target resolver already filtered.
const playForFree: ActionHandler = (state, ctx, action, targets) => {
  const pl = state.players[ctx.controller];
  const from = typeof action['from'] === 'string' ? (action['from'] as string) : 'hand';
  const rested = action['rested'] === true;
  const count = typeof action['count'] === 'number' ? (action['count'] as number) : targets.length;
  let played = 0;
  for (const id of targets) {
    if (played >= count) break;
    const z = findInstZone(state, id);
    if (z === null) continue;
    if (z.side !== ctx.controller) continue; // only own zone
    if (from === 'hand' && z.zone !== 'hand') continue;
    if (from === 'trash' && z.zone !== 'trash') continue;
    const inst = state.instances[id];
    if (inst === undefined) continue;
    // Remove from source zone
    if (z.zone === 'hand') {
      const idx = pl.hand.indexOf(id);
      if (idx === -1) continue;
      pl.hand.splice(idx, 1);
    } else if (z.zone === 'trash') {
      const idx = pl.trash.indexOf(id);
      if (idx === -1) continue;
      pl.trash.splice(idx, 1);
    } else {
      continue;
    }
    resetInstanceTransientState(inst);
    inst.summoningSick = true;
    inst.rested = rested;
    pl.field.push(inst);
    played += 1;
    (state.history as Array<unknown>).push({
      type: 'CHARACTER_PLAYED',
      instanceId: id,
      cardId: inst.cardId,
      controller: ctx.controller,
      cost: 0,
      from,
      rested,
      reason: 'play_for_free',
    });
  }
  return state;
};

// ─── return_to_hand_from_field: alias for removal_bounce but acts on controller's
//     own field as a neutral utility (no removal flavor)
const returnToHandFromField: ActionHandler = (state, _ctx, _action, targets) => {
  for (const id of targets) {
    const z = findInstZone(state, id);
    if (z === null || (z.zone !== 'field' && z.zone !== 'stage')) continue;
    const pl = state.players[z.side];
    let inst: CardInstance | undefined;
    if (z.zone === 'field') {
      const idx = pl.field.findIndex((c) => c.instanceId === id);
      if (idx === -1) continue;
      inst = pl.field[idx];
      pl.field.splice(idx, 1);
    } else if (z.zone === 'stage' && pl.stage?.instanceId === id) {
      inst = pl.stage;
      pl.stage = null;
    }
    if (inst === undefined) continue;
    detachAllAttachedDon(state, inst, z.side);
    resetInstanceTransientState(inst);
    pl.hand.push(id);
  }
  return state;
};

// ─── trash_opp_field: alias-style helper used by some cards (functionally
//     same as removal_ko but conveys removal-to-trash flavor explicitly).
const trashOppField: ActionHandler = (state, _ctx, _action, targets) => {
  for (const id of targets) {
    const z = findInstZone(state, id);
    if (z === null || z.zone !== 'field') continue;
    const pl = state.players[z.side];
    const idx = pl.field.findIndex((c) => c.instanceId === id);
    if (idx === -1) continue;
    const inst = pl.field[idx]!;
    detachAllAttachedDon(state, inst, z.side);
    pl.field.splice(idx, 1);
    resetInstanceTransientState(inst);
    pl.trash.push(id);
  }
  return state;
};

// ─── search_deck: look at top `lookCount`, take up to `addCount` matching
//     `filter`, reshuffle rest. V0 deterministic — picks FIRST matches in
//     top-down order; full player-choice flow lands when PendingPeek wires
//     through dispatch. (Closes AC2-2 audit finding — previous V0 ignored
//     lookCount + filter entirely.)
const searchDeck: ActionHandler = (state, ctx, action) => {
  const lookCount = num(action, 'lookCount', state.players[ctx.controller].deck.length);
  const addCount = num(action, 'addCount', 1);
  const filter = action['filter'];
  const f = typeof filter === 'object' && filter !== null
    ? (filter as { trait?: string; color?: string; type?: string; minCost?: number; maxCost?: number; keyword?: string })
    : undefined;
  const pl = state.players[ctx.controller];

  const peek = pl.deck.slice(0, Math.min(lookCount, pl.deck.length));
  const picked: string[] = [];
  const leftovers: string[] = [];

  for (const id of peek) {
    if (picked.length < addCount) {
      const inst = state.instances[id];
      const card = inst !== undefined
        ? (state.cardLibrary[inst.cardId] as { traits: ReadonlyArray<string>; colors: ReadonlyArray<string>; cost?: number; keywords?: ReadonlyArray<string> } | undefined)
        : undefined;
      let matches = true;
      if (f !== undefined && card !== undefined) {
        if (f.trait !== undefined && !card.traits.includes(f.trait)) matches = false;
        if (matches && f.color !== undefined && !card.colors.includes(f.color)) matches = false;
        if (matches && f.type !== undefined && !card.traits.some((t) => t.includes(f.type!))) matches = false;
        if (matches && f.minCost !== undefined && (card.cost ?? 0) < f.minCost) matches = false;
        if (matches && f.maxCost !== undefined && (card.cost ?? 0) > f.maxCost) matches = false;
        if (matches && f.keyword !== undefined && !(card.keywords ?? []).includes(f.keyword)) matches = false;
      }
      if (matches) {
        picked.push(id);
        continue;
      }
    }
    leftovers.push(id);
  }

  // Remove the peeked slice from the deck head.
  pl.deck.splice(0, peek.length);

  // Picked cards → hand.
  for (const id of picked) pl.hand.push(id);

  // Leftovers + remaining deck → reshuffle bottom.
  // Per CR §10-1-3-1: non-picked peeked cards go to bottom of deck in shuffled order.
  const rest = leftovers;
  pl.deck.push(...rest);

  const rng = RngService.pull(state);
  rng.shuffle(pl.deck);

  (state.history as Array<unknown>).push({
    type: 'DECK_SEARCHED',
    controller: ctx.controller,
    lookCount: peek.length,
    pickedCount: picked.length,
  });
  return state;
};

// ────────────────────────────────────────────────────────────────────
// Registration
// ────────────────────────────────────────────────────────────────────

export function registerActionHandlers2(): void {
  actionHandlers.register('sequence', sequence);
  actionHandlers.register('chained_actions', chainedActions);
  actionHandlers.register('recursion', recursion);
  actionHandlers.register('mill', mill);
  actionHandlers.register('shuffle_deck', shuffleDeck);
  actionHandlers.register('transfer_attached_don', transferAttachedDon);
  actionHandlers.register('set_active_don', setActiveDon);
  actionHandlers.register('return_opp_don_to_deck', returnOppDonToDeck);
  actionHandlers.register('give_next_play_cost_modifier', giveNextPlayCostModifier);
  actionHandlers.register('end_of_turn_trash', endOfTurnTrash);
  actionHandlers.register('play_for_free', playForFree);
  actionHandlers.register('return_to_hand_from_field', returnToHandFromField);
  actionHandlers.register('trash_opp_field', trashOppField);
  actionHandlers.register('search_deck', searchDeck);
}
