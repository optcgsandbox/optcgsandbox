/**
 * Engine V2 — action handlers (initial batch).
 *
 * Each handler mutates `state` in place and returns it. ContinuousManager
 * refold is the caller's responsibility (applyAction does the top-level wrap).
 *
 * This file registers the highest-frequency primitives first; rarer ones
 * (transfer_attached_don, peek, choose_one, etc.) land in subsequent commits.
 *
 * Cross-references:
 * - Implementation spec §3.3
 * - Plan v1 §3.3
 * - V1 reference: shared/engine/effectSpec/runner-v2.ts:660-...
 */

import { EffectDispatcher } from '../../effects/EffectDispatcher.js';
import { detachAllAttachedDon } from '../../state/derived/don.js';
import { resetInstanceTransientState } from '../../state/derived/reset.js';
import type { EffectActionV2 } from '../../spec/types.js';
import type {
  CardInstance,
  EffectDuration,
  GameState,
  InstanceId,
  PlayerId,
} from '../../state/types.js';
import {
  type ActionHandler,
  actionHandlers,
  type HandlerCtx,
} from '../types.js';

const OTHER: Record<PlayerId, PlayerId> = { A: 'B', B: 'A' };

// Canonical "how many" reader for action handlers. cards.json uses
// `magnitude` for action counts (verified across 30+ action kinds, 268+
// cards); a few specs use `n`. Read magnitude first, fall back to n.
function count(a: EffectActionV2, fallback = 0): number {
  const m = a['magnitude'];
  if (typeof m === 'number') return m;
  const n = a['n'];
  if (typeof n === 'number') return n;
  return fallback;
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

// ────────────────────────────────────────────────────────────────────
// draw  — { kind: 'draw', n }
// ────────────────────────────────────────────────────────────────────
const draw: ActionHandler = (state, ctx, action) => {
  const n = count(action, 1);
  const pl = state.players[ctx.controller];
  for (let i = 0; i < n; i++) {
    const top = pl.deck.shift();
    if (top === undefined) {
      state.result = { loser: ctx.controller, reason: 'deck_out' };
      return state;
    }
    pl.hand.push(top);
  }
  (state.history as Array<unknown>).push({ type: 'CARDS_DRAWN', count: n, controller: ctx.controller });
  return state;
};

// ────────────────────────────────────────────────────────────────────
// give_power  — { kind: 'give_power', n, duration }
// ────────────────────────────────────────────────────────────────────
const givePower: ActionHandler = (state, _ctx, action, targets) => {
  const amount = count(action, 0);
  const durationRaw = action['duration'];
  const duration: EffectDuration =
    durationRaw === 'this_battle' ||
    durationRaw === 'this_turn' ||
    durationRaw === 'opp_next_turn' ||
    durationRaw === 'opp_next_end_phase' ||
    durationRaw === 'permanent'
      ? durationRaw
      : 'this_turn';

  for (const id of targets) {
    const inst = state.instances[id];
    if (inst === undefined) continue;
    if (duration === 'this_battle') {
      inst.powerModifierThisBattle = (inst.powerModifierThisBattle ?? 0) + amount;
    } else if (duration === 'permanent') {
      inst.powerModifierContinuous = (inst.powerModifierContinuous ?? 0) + amount;
    } else {
      inst.powerModifierOneShot = (inst.powerModifierOneShot ?? 0) + amount;
      // Encode duration via expiresInTurns: 'this_turn' => 0, 'opp_next_turn' => 1
      const turns = duration === 'this_turn' ? 0 : 1;
      const cur = inst.powerModifierExpiresInTurns;
      inst.powerModifierExpiresInTurns = cur === undefined ? turns : Math.max(cur, turns);
    }
  }
  return state;
};

// ────────────────────────────────────────────────────────────────────
// give_keyword  — { kind: 'give_keyword', keyword, duration }
// ────────────────────────────────────────────────────────────────────
const giveKeyword: ActionHandler = (state, _ctx, action, targets) => {
  const keyword = typeof action['keyword'] === 'string' ? (action['keyword'] as string) : '';
  if (keyword === '') return state;
  const durationRaw = action['duration'];
  const isThisTurn =
    durationRaw === undefined ||
    durationRaw === 'this_turn' ||
    durationRaw === 'this_battle';

  for (const id of targets) {
    const inst = state.instances[id];
    if (inst === undefined) continue;
    if (isThisTurn) {
      const cur = inst.grantedKeywordsOneShot ?? [];
      if (!cur.some((g) => g.keyword === keyword)) {
        inst.grantedKeywordsOneShot = [...cur, { keyword, until: 'this_turn' }];
      }
    } else {
      // permanent / continuous-granted
      const cur = inst.grantedKeywordsContinuous ?? [];
      if (!cur.includes(keyword)) {
        inst.grantedKeywordsContinuous = [...cur, keyword];
      }
    }
  }
  return state;
};

// ────────────────────────────────────────────────────────────────────
// removal_ko  — KO target characters
// ────────────────────────────────────────────────────────────────────
const removalKo: ActionHandler = (state, ctx, _action, targets) => {
  let next = state;
  for (const id of targets) {
    const z = findInstZone(next, id);
    if (z === null || z.zone !== 'field') continue;
    const pl = next.players[z.side];
    const idx = pl.field.findIndex((c) => c.instanceId === id);
    if (idx === -1) continue;
    const inst = pl.field[idx]!;
    detachAllAttachedDon(next, inst, z.side);
    pl.field.splice(idx, 1);
    // CR-4 audit fix: source is 'own_effect' when source controller equals
    // KO'd char's side (self-sac); otherwise 'opp_effect'.
    next.koSourceStack.push({
      instanceId: id,
      source: z.side === ctx.controller ? 'own_effect' : 'opp_effect',
    });
    (next.history as Array<unknown>).push({
      type: 'CHARACTER_KOD',
      instanceId: id,
      controller: z.side,
      reason: 'removal_ko',
    });
    // CR-5 audit fix: fire on_ko clauses BEFORE resetting transient state
    // (clauses may read inst fields like attached DON count, etc.).
    next = EffectDispatcher.dispatch(next, {
      sourceInstanceId: id,
      controller: z.side,
    }, 'on_ko');
    resetInstanceTransientState(inst);
    pl.trash.push(id);
  }
  return next;
};

// ────────────────────────────────────────────────────────────────────
// removal_bounce  — return target to controller's hand
// ────────────────────────────────────────────────────────────────────
const removalBounce: ActionHandler = (state, _ctx, _action, targets) => {
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
    (state.history as Array<unknown>).push({
      type: 'CARD_BOUNCED',
      instanceId: id,
      controller: z.side,
    });
  }
  return state;
};

// ────────────────────────────────────────────────────────────────────
// rest_target  — set rested=true on each target
// ────────────────────────────────────────────────────────────────────
const restTarget: ActionHandler = (state, _ctx, _action, targets) => {
  for (const id of targets) {
    const inst = state.instances[id];
    if (inst === undefined) continue;
    inst.rested = true;
    (state.history as Array<unknown>).push({
      type: 'TARGET_RESTED',
      instanceId: id,
    });
  }
  return state;
};

// ────────────────────────────────────────────────────────────────────
// active_target  — set rested=false on each target
// ────────────────────────────────────────────────────────────────────
const activeTarget: ActionHandler = (state, _ctx, _action, targets) => {
  for (const id of targets) {
    const inst = state.instances[id];
    if (inst === undefined) continue;
    inst.rested = false;
  }
  return state;
};

// ────────────────────────────────────────────────────────────────────
// ramp  — { kind: 'ramp', n }: move n DON from donDeck → donCostArea (active)
// ────────────────────────────────────────────────────────────────────
const ramp: ActionHandler = (state, ctx, action) => {
  const n = count(action, 1);
  const pl = state.players[ctx.controller];
  let moved = 0;
  while (moved < n && pl.donDeck.length > 0) {
    const id = pl.donDeck.shift();
    if (id !== undefined) {
      pl.donCostArea.push(id);
      moved += 1;
    }
  }
  return state;
};

// ────────────────────────────────────────────────────────────────────
// give_don_to_target  — { kind: 'give_don_to_target', n }: attach n DON from
// controller's donCostArea to each target.
// ────────────────────────────────────────────────────────────────────
const giveDonToTarget: ActionHandler = (state, ctx, action, targets) => {
  const n = count(action, 1);
  const pl = state.players[ctx.controller];
  for (const id of targets) {
    const inst = state.instances[id];
    if (inst === undefined) continue;
    for (let i = 0; i < n; i++) {
      const donId = pl.donCostArea.shift();
      if (donId === undefined) break;
      inst.attachedDon.push(donId);
    }
  }
  return state;
};

// ────────────────────────────────────────────────────────────────────
// trash_top_of_deck  — { kind: 'trash_top_of_deck', n }
// ────────────────────────────────────────────────────────────────────
const trashTopOfDeck: ActionHandler = (state, ctx, action) => {
  const n = count(action, 1);
  const pl = state.players[ctx.controller];
  for (let i = 0; i < n; i++) {
    const id = pl.deck.shift();
    if (id === undefined) break;
    pl.trash.push(id);
  }
  return state;
};

// ────────────────────────────────────────────────────────────────────
// discard_opp_hand  — { kind: 'discard_opp_hand', n }: opp picks n to discard
// (V0: discards from the head of opp's hand deterministically; full
// player-choice routing arrives with PendingDiscard wiring in Phase 3)
// ────────────────────────────────────────────────────────────────────
const discardOppHand: ActionHandler = (state, ctx, action) => {
  const n = count(action, 1);
  const oppSide = OTHER[ctx.controller];
  const opp = state.players[oppSide];
  for (let i = 0; i < n; i++) {
    const id = opp.hand.shift();
    if (id === undefined) break;
    opp.trash.push(id);
    (state.history as Array<unknown>).push({
      type: 'CARD_DISCARDED',
      instanceId: id,
      fromSide: oppSide,
      reason: 'discard_opp_hand',
    });
  }
  return state;
};

// ────────────────────────────────────────────────────────────────────
// Registration
// ────────────────────────────────────────────────────────────────────

export function registerActionHandlers(): void {
  actionHandlers.register('draw', draw);
  actionHandlers.register('give_power', givePower);
  actionHandlers.register('give_keyword', giveKeyword);
  actionHandlers.register('removal_ko', removalKo);
  actionHandlers.register('removal_bounce', removalBounce);
  actionHandlers.register('rest_target', restTarget);
  actionHandlers.register('active_target', activeTarget);
  actionHandlers.register('ramp', ramp);
  actionHandlers.register('give_don_to_target', giveDonToTarget);
  actionHandlers.register('trash_top_of_deck', trashTopOfDeck);
  actionHandlers.register('discard_opp_hand', discardOppHand);
}

export type { HandlerCtx };
