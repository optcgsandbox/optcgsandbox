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
  const n = num(action, 'n', 1);
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

// ─── transfer_attached_don: move N DON from source's attached → first target
//     (the action's `from` and `to` semantics — V0: from source to target[0])
const transferAttachedDon: ActionHandler = (state, ctx, action, targets) => {
  if (targets.length === 0) return state;
  const n = num(action, 'n', 1);
  const source = state.instances[ctx.sourceInstanceId];
  const dest = state.instances[targets[0]!];
  if (source === undefined || dest === undefined) return state;
  let moved = 0;
  while (moved < n && source.attachedDon.length > 0) {
    const id = source.attachedDon.shift();
    if (id !== undefined) {
      dest.attachedDon.push(id);
      moved += 1;
    }
  }
  return state;
};

// ─── set_active_don: un-rest N DON in controller's donRested → donCostArea
const setActiveDon: ActionHandler = (state, ctx, action) => {
  const n = num(action, 'n', 1);
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
  const n = num(action, 'n', 1);
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
  const n = num(action, 'n', 0);
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

// ─── play_for_free: move card from hand to field/stage without paying cost
//     V0: only applies to characters (the most common case)
const playForFree: ActionHandler = (state, ctx, _action, targets) => {
  const pl = state.players[ctx.controller];
  for (const id of targets) {
    const z = findInstZone(state, id);
    if (z === null || z.zone !== 'hand') continue;
    if (z.side !== ctx.controller) continue; // only own hand
    const inst = state.instances[id];
    if (inst === undefined) continue;
    // Remove from hand
    const handIdx = pl.hand.indexOf(id);
    if (handIdx === -1) continue;
    pl.hand.splice(handIdx, 1);
    resetInstanceTransientState(inst);
    inst.summoningSick = true;
    pl.field.push(inst);
    (state.history as Array<unknown>).push({
      type: 'CHARACTER_PLAYED',
      instanceId: id,
      cardId: inst.cardId,
      controller: ctx.controller,
      cost: 0,
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

// ─── search_deck: V0 deterministic — pull top N matching card, add to hand,
//     reshuffle rest. Full peek/choose flow lands when PendingPeek wires
//     through dispatch.
const searchDeck: ActionHandler = (state, ctx, action) => {
  const addCount = num(action, 'addCount', 1);
  // V0: just draw addCount from top — full deck-search with filter requires
  // PendingPeek continuation, not yet plumbed.
  const pl = state.players[ctx.controller];
  for (let i = 0; i < addCount; i++) {
    const id = pl.deck.shift();
    if (id === undefined) break;
    pl.hand.push(id);
  }
  // Reshuffle remaining deck.
  const rng = RngService.pull(state);
  rng.shuffle(pl.deck);
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
