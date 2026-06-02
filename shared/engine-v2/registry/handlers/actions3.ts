/**
 * Engine V2 — third batch of action handlers covering the remaining
 * primitives referenced by cards.json (corpus-validation-driven).
 *
 * V0 semantics: complex primitives that need PendingPeek/PendingChoose
 * continuation (peek_*, choose_one, reveal_*, searcher_peek) are
 * stub-noops registered so the boot gate passes. Real continuation
 * logic lands when PendingPeek/Choose wire through dispatch.
 *
 * Simple primitives (aliases, zone moves, single-state mutations) get
 * real V0 implementations.
 */

import { EffectDispatcher } from '../../effects/EffectDispatcher.js';
import { detachAllAttachedDon } from '../../state/derived/don.js';
import { resetInstanceTransientState } from '../../state/derived/reset.js';
import type { EffectActionV2 } from '../../spec/types.js';
import {
  type CardInstance,
  type EffectDuration,
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
function str(a: EffectActionV2, key: string): string {
  const v = a[key];
  return typeof v === 'string' ? v : '';
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

const noop: ActionHandler = (state) => state;

// ─── Aliases for existing handlers
const powerBuff: ActionHandler = (state, ctx, action, targets) =>
  actionHandlers.get('give_power')(state, ctx, action, targets);

const millSelf: ActionHandler = (state, ctx, action) =>
  actionHandlers.get('trash_top_of_deck')(state, ctx, action, []);

const millOpp: ActionHandler = (state, ctx, action) =>
  actionHandlers.get('mill')(state, ctx, action, []);

const setActive: ActionHandler = (state, ctx, action, targets) =>
  actionHandlers.get('active_target')(state, ctx, action, targets);

const oppDiscardFromHand: ActionHandler = (state, ctx, action) =>
  actionHandlers.get('discard_opp_hand')(state, ctx, action, []);

// ─── give_don_to_opp_target: like give_don_to_target but opp's DON
const giveDonToOppTarget: ActionHandler = (state, ctx, action, targets) => {
  const n = num(action, 'n', 1);
  const opp = state.players[OTHER[ctx.controller]];
  for (const id of targets) {
    const inst = state.instances[id];
    if (inst === undefined) continue;
    for (let i = 0; i < n; i++) {
      const donId = opp.donCostArea.shift();
      if (donId === undefined) break;
      inst.attachedDon.push(donId);
    }
  }
  return state;
};

// ─── life movement
const lifeToHand: ActionHandler = (state, ctx) => {
  const pl = state.players[ctx.controller];
  const id = pl.life.shift();
  if (id === undefined) {
    state.result = { loser: ctx.controller, reason: 'life_zero' };
    return state;
  }
  pl.hand.push(id);
  return state;
};

const addToOwnLifeTop: ActionHandler = (state, ctx) => {
  const pl = state.players[ctx.controller];
  const id = pl.deck.shift();
  if (id !== undefined) pl.life.unshift(id);
  return state;
};

const addToOppLifeTop: ActionHandler = (state, ctx) => {
  const opp = state.players[OTHER[ctx.controller]];
  const id = opp.deck.shift();
  if (id !== undefined) opp.life.unshift(id);
  return state;
};

const addToOppHandFromOppLife: ActionHandler = (state, ctx) => {
  const opp = state.players[OTHER[ctx.controller]];
  const id = opp.life.shift();
  if (id !== undefined) opp.hand.push(id);
  return state;
};

const trashFaceUpLife: ActionHandler = (state, ctx) => {
  const pl = state.players[ctx.controller];
  // V0: trash top face-up; future: target a specific face-up life entry
  for (const id of [...pl.life]) {
    if (pl.lifeFaceUp[id] === true) {
      const idx = pl.life.indexOf(id);
      if (idx !== -1) pl.life.splice(idx, 1);
      pl.trash.push(id);
      return state;
    }
  }
  return state;
};

const trashOwnLifeUntil: ActionHandler = (state, ctx, action) => {
  const target = num(action, 'until', 0);
  const pl = state.players[ctx.controller];
  while (pl.life.length > target) {
    const id = pl.life.shift();
    if (id !== undefined) pl.trash.push(id);
  }
  return state;
};

const turnAllOwnLifeFaceDown: ActionHandler = (state, ctx) => {
  const pl = state.players[ctx.controller];
  for (const id of pl.life) pl.lifeFaceUp[id] = false;
  return state;
};

const takeDamageSelf: ActionHandler = (state, ctx) => lifeToHand(state, ctx, { kind: 'take_damage_self' }, []);

const dealDamageOpp: ActionHandler = (state, ctx, action) => {
  const n = num(action, 'n', 1);
  const opp = state.players[OTHER[ctx.controller]];
  for (let i = 0; i < n; i++) {
    const id = opp.life.shift();
    if (id === undefined) {
      state.result = { loser: OTHER[ctx.controller], reason: 'life_zero' };
      return state;
    }
    opp.hand.push(id);
  }
  return state;
};

// ─── deck movements
const bottomOfDeckSelf: ActionHandler = (state, ctx) => {
  // Sends source character to bottom of its controller's deck.
  const inst = state.instances[ctx.sourceInstanceId];
  if (inst === undefined) return state;
  const z = findInstZone(state, inst.instanceId);
  if (z === null || (z.zone !== 'field' && z.zone !== 'stage')) return state;
  const pl = state.players[z.side];
  if (z.zone === 'field') {
    const idx = pl.field.findIndex((c) => c.instanceId === inst.instanceId);
    if (idx !== -1) pl.field.splice(idx, 1);
  } else if (z.zone === 'stage' && pl.stage?.instanceId === inst.instanceId) {
    pl.stage = null;
  }
  detachAllAttachedDon(state, inst, z.side);
  resetInstanceTransientState(inst);
  pl.deck.push(inst.instanceId);
  return state;
};

const bottomOfDeckFromHand: ActionHandler = (state, ctx, _action, targets) => {
  const pl = state.players[ctx.controller];
  for (const id of targets) {
    const idx = pl.hand.indexOf(id);
    if (idx === -1) continue;
    pl.hand.splice(idx, 1);
    pl.deck.push(id);
  }
  return state;
};

const bottomOfDeckFromTrash: ActionHandler = (state, ctx, _action, targets) => {
  const pl = state.players[ctx.controller];
  for (const id of targets) {
    const idx = pl.trash.indexOf(id);
    if (idx === -1) continue;
    pl.trash.splice(idx, 1);
    pl.deck.push(id);
  }
  return state;
};

const oppBottomOfDeckFromHand: ActionHandler = (state, ctx, _action, targets) => {
  const opp = state.players[OTHER[ctx.controller]];
  for (const id of targets) {
    const idx = opp.hand.indexOf(id);
    if (idx === -1) continue;
    opp.hand.splice(idx, 1);
    opp.deck.push(id);
  }
  return state;
};

const oppBottomOfDeckFromTrash: ActionHandler = (state, ctx, _action, targets) => {
  const opp = state.players[OTHER[ctx.controller]];
  for (const id of targets) {
    const idx = opp.trash.indexOf(id);
    if (idx === -1) continue;
    opp.trash.splice(idx, 1);
    opp.deck.push(id);
  }
  return state;
};

const bottomOfDeckToOppDeck: ActionHandler = (state, ctx, _action, targets) => {
  const opp = state.players[OTHER[ctx.controller]];
  for (const id of targets) {
    const z = findInstZone(state, id);
    if (z === null) continue;
    const pl = state.players[z.side];
    // Remove from current zone
    if (z.zone === 'field') {
      const idx = pl.field.findIndex((c) => c.instanceId === id);
      if (idx !== -1) {
        detachAllAttachedDon(state, pl.field[idx]!, z.side);
        resetInstanceTransientState(pl.field[idx]!);
        pl.field.splice(idx, 1);
      }
    } else if (z.zone === 'stage' && pl.stage?.instanceId === id) {
      detachAllAttachedDon(state, pl.stage, z.side);
      resetInstanceTransientState(pl.stage);
      pl.stage = null;
    }
    opp.deck.push(id);
  }
  return state;
};

const discardFromHand: ActionHandler = (state, ctx, action) => {
  const n = num(action, 'n', 1);
  const pl = state.players[ctx.controller];
  for (let i = 0; i < n; i++) {
    const id = pl.hand.shift();
    if (id === undefined) break;
    pl.trash.push(id);
  }
  return state;
};

const takeFromOppHand: ActionHandler = (state, ctx, _action, targets) => {
  const opp = state.players[OTHER[ctx.controller]];
  const me = state.players[ctx.controller];
  for (const id of targets) {
    const idx = opp.hand.indexOf(id);
    if (idx === -1) continue;
    opp.hand.splice(idx, 1);
    me.hand.push(id);
  }
  return state;
};

// ─── cost / power modifiers
const giveCostBuff: ActionHandler = (state, _ctx, action, targets) => {
  const n = num(action, 'n', 0);
  for (const id of targets) {
    const inst = state.instances[id];
    if (inst === undefined) continue;
    inst.costModifierOneShot = (inst.costModifierOneShot ?? 0) + n;
    inst.costModifierExpiresInTurns = inst.costModifierExpiresInTurns ?? 0;
  }
  return state;
};

const costReduction: ActionHandler = (state, ctx, action) => {
  const n = num(action, 'n', -1);
  state.players[ctx.controller].nextPlayCostModifier =
    (state.players[ctx.controller].nextPlayCostModifier ?? 0) + n;
  return state;
};

const removalCostReduce: ActionHandler = (state, _ctx, action, targets) => {
  const n = num(action, 'n', -1);
  for (const id of targets) {
    const inst = state.instances[id];
    if (inst === undefined) continue;
    inst.costModifierOneShot = (inst.costModifierOneShot ?? 0) + n;
    inst.costModifierExpiresInTurns = inst.costModifierExpiresInTurns ?? 0;
  }
  return state;
};

const setBasePower: ActionHandler = (state, _ctx, action, targets) => {
  const n = num(action, 'n', 0);
  for (const id of targets) {
    const inst = state.instances[id];
    if (inst === undefined) continue;
    inst.basePowerOverrideOneShot = n;
    inst.basePowerOverrideExpiresInTurns = inst.basePowerOverrideExpiresInTurns ?? 0;
  }
  return state;
};

const setPowerZero: ActionHandler = (state, _ctx, _action, targets) => {
  for (const id of targets) {
    const inst = state.instances[id];
    if (inst === undefined) continue;
    inst.basePowerOverrideOneShot = 0;
    inst.basePowerOverrideExpiresInTurns = inst.basePowerOverrideExpiresInTurns ?? 0;
  }
  return state;
};

const setBasePowerCopyFrom: ActionHandler = (state, ctx, _action, targets) => {
  // Copy power from source (sourceInstanceId) onto targets.
  const source = state.instances[ctx.sourceInstanceId];
  if (source === undefined) return state;
  const sourceCard = state.cardLibrary[source.cardId] as { power?: number | null } | undefined;
  const sourcePower = sourceCard?.power ?? 0;
  for (const id of targets) {
    const inst = state.instances[id];
    if (inst === undefined) continue;
    inst.basePowerOverrideOneShot = sourcePower;
    inst.basePowerOverrideExpiresInTurns = 0;
  }
  return state;
};

const setBasePowerCopyFromTarget: ActionHandler = setBasePowerCopyFrom;

// ─── immunity / negate
const grantImmunity: ActionHandler = (state, _ctx, action, targets) => {
  const against = str(action, 'against');
  for (const id of targets) {
    const inst = state.instances[id];
    if (inst === undefined) continue;
    inst.immunityOneShot = { against, until: 'this_turn' };
  }
  return state;
};

const negateTargetEffects: ActionHandler = (state, _ctx, _action, targets) => {
  for (const id of targets) {
    const inst = state.instances[id];
    if (inst === undefined) continue;
    inst.effectsNegated = true;
  }
  return state;
};

// ─── restrictions
const restrictOppBlocker: ActionHandler = (state, ctx) => {
  const opp = state.players[OTHER[ctx.controller]];
  opp.restrictions = {
    ...(opp.restrictions ?? {}),
    cantUseEffectType: 'blocker',
  };
  return state;
};

const restrictOppAttack: ActionHandler = (state, ctx, action) => {
  const opp = state.players[OTHER[ctx.controller]];
  const n = num(action, 'discardCount', 1);
  opp.restrictions = {
    ...(opp.restrictions ?? {}),
    oppAttackUnlessDiscard: n,
  };
  return state;
};

const restrictPlaySelfThisTurn: ActionHandler = (state, ctx) => {
  state.players[ctx.controller].restrictions = {
    ...(state.players[ctx.controller].restrictions ?? {}),
    cantPlayKind: 'character',
  };
  return state;
};

const restrictEffectType: ActionHandler = (state, _ctx, action, targets) => {
  const t = str(action, 'type');
  for (const id of targets) {
    const inst = state.instances[id];
    if (inst === undefined) continue;
    inst.restrictEffectType = t;
  }
  return state;
};

const damageImmunityAttribute: ActionHandler = (state, _ctx, action, targets) => {
  const attr = str(action, 'attribute');
  for (const id of targets) {
    const inst = state.instances[id];
    if (inst === undefined) continue;
    inst.damageImmunityAttribute = attr;
  }
  return state;
};

const attackLockUntilPhase: ActionHandler = (state, _ctx, action, targets) => {
  const untilRaw = action['duration'];
  const until: EffectDuration =
    untilRaw === 'this_turn' || untilRaw === 'opp_next_turn' || untilRaw === 'permanent'
      ? (untilRaw as EffectDuration)
      : 'this_turn';
  for (const id of targets) {
    const inst = state.instances[id];
    if (inst === undefined) continue;
    inst.attackLockedOneShot = { until };
  }
  return state;
};

const restLockUntilPhase: ActionHandler = (state, _ctx, _action, targets) => {
  for (const id of targets) {
    const inst = state.instances[id];
    if (inst === undefined) continue;
    inst.restLockedUntilTurn = state.turn;
  }
  return state;
};

// ─── self / scheduled
const selfTrashAtEndOfTurn: ActionHandler = (state, ctx) => {
  const inst = state.instances[ctx.sourceInstanceId];
  if (inst === undefined) return state;
  inst.endOfTurnTrash = true;
  return state;
};

const scheduleAtEndOfOwnTurn: ActionHandler = (state, ctx, action) => {
  const pl = state.players[ctx.controller];
  const queue = pl.pendingEndOfTurn ?? [];
  queue.push({
    action: action['action'] ?? action,
    sourceInstanceId: ctx.sourceInstanceId,
  });
  pl.pendingEndOfTurn = queue;
  return state;
};

// ─── attack manipulation
const attackRedirectToTarget: ActionHandler = (state, _ctx, _action, targets) => {
  if (state.pending === null || state.pending.kind !== 'attack') return state;
  if (targets.length === 0) return state;
  state.pending.pendingAttack.targetInstanceId = targets[0]!;
  return state;
};

// ─── opp DON manipulation
const restOppDon: ActionHandler = (state, ctx, action) => {
  const n = num(action, 'n', 1);
  const opp = state.players[OTHER[ctx.controller]];
  for (let i = 0; i < n; i++) {
    const id = opp.donCostArea.shift();
    if (id === undefined) break;
    opp.donRested.push(id);
  }
  return state;
};

// ─── activate_event_from_hand: play counter event from hand without paying
//     cost (rare; some cards do this for free during counter window)
const activateEventFromHand: ActionHandler = (state, ctx, _action, targets) => {
  const pl = state.players[ctx.controller];
  for (const id of targets) {
    const idx = pl.hand.indexOf(id);
    if (idx === -1) continue;
    pl.hand.splice(idx, 1);
    pl.trash.push(id);
    // Fire on_play on the event
    return EffectDispatcher.dispatch(state, {
      sourceInstanceId: id,
      controller: ctx.controller,
    }, 'on_play');
  }
  return state;
};

// ─── Complex primitives (PendingPeek / PendingChoose required) — V0 noops
const peekOppDeck: ActionHandler = noop;
const peekAndReorderOwnDeck: ActionHandler = noop;
const peekAndReorderOwnLife: ActionHandler = noop;
const peekAndReorderOppLife: ActionHandler = noop;
const searcherPeek: ActionHandler = noop;
const revealOppHand: ActionHandler = noop;
const revealTopAndConditionalPlay: ActionHandler = noop;
const revealTopThenIfCostMin: ActionHandler = noop;
const revealTopThenIfFilter: ActionHandler = noop;
const chooseCostRevealOppMatch: ActionHandler = noop;
const chooseOne: ActionHandler = noop;

// ────────────────────────────────────────────────────────────────────
// Registration
// ────────────────────────────────────────────────────────────────────

export function registerActionHandlers3(): void {
  // Aliases
  actionHandlers.register('power_buff', powerBuff);
  actionHandlers.register('mill_self', millSelf);
  actionHandlers.register('mill_opp', millOpp);
  actionHandlers.register('set_active', setActive);
  actionHandlers.register('opp_discard_from_hand', oppDiscardFromHand);
  actionHandlers.register('noop', noop);

  // DON to opp target
  actionHandlers.register('give_don_to_opp_target', giveDonToOppTarget);

  // Life flows
  actionHandlers.register('life_to_hand', lifeToHand);
  actionHandlers.register('add_to_own_life_top', addToOwnLifeTop);
  actionHandlers.register('add_to_opp_life_top', addToOppLifeTop);
  actionHandlers.register('add_to_opp_hand_from_opp_life', addToOppHandFromOppLife);
  actionHandlers.register('trash_face_up_life', trashFaceUpLife);
  actionHandlers.register('trash_own_life_until', trashOwnLifeUntil);
  actionHandlers.register('turn_all_own_life_face_down', turnAllOwnLifeFaceDown);
  actionHandlers.register('take_damage_self', takeDamageSelf);
  actionHandlers.register('deal_damage_opp', dealDamageOpp);

  // Deck zone movements
  actionHandlers.register('bottom_of_deck_self', bottomOfDeckSelf);
  actionHandlers.register('bottom_of_deck_from_hand', bottomOfDeckFromHand);
  actionHandlers.register('bottom_of_deck_from_trash', bottomOfDeckFromTrash);
  actionHandlers.register('opp_bottom_of_deck_from_hand', oppBottomOfDeckFromHand);
  actionHandlers.register('opp_bottom_of_deck_from_trash', oppBottomOfDeckFromTrash);
  actionHandlers.register('bottom_of_deck_to_opp_deck', bottomOfDeckToOppDeck);
  actionHandlers.register('discard_from_hand', discardFromHand);
  actionHandlers.register('take_from_opp_hand', takeFromOppHand);

  // Cost / power modifiers
  actionHandlers.register('give_cost_buff', giveCostBuff);
  actionHandlers.register('cost_reduction', costReduction);
  actionHandlers.register('removal_cost_reduce', removalCostReduce);
  actionHandlers.register('set_base_power', setBasePower);
  actionHandlers.register('set_power_zero', setPowerZero);
  actionHandlers.register('set_base_power_copy_from', setBasePowerCopyFrom);
  actionHandlers.register('set_base_power_copy_from_target', setBasePowerCopyFromTarget);

  // Immunity / negate
  actionHandlers.register('grant_immunity', grantImmunity);
  actionHandlers.register('negate_target_effects', negateTargetEffects);
  actionHandlers.register('damage_immunity_attribute', damageImmunityAttribute);

  // Restrictions
  actionHandlers.register('restrict_opp_blocker', restrictOppBlocker);
  actionHandlers.register('restrict_opp_attack', restrictOppAttack);
  actionHandlers.register('restrict_play_self_this_turn', restrictPlaySelfThisTurn);
  actionHandlers.register('restrict_effect_type', restrictEffectType);
  actionHandlers.register('attack_lock_until_phase', attackLockUntilPhase);
  actionHandlers.register('rest_lock_until_phase', restLockUntilPhase);

  // Self / scheduled
  actionHandlers.register('self_trash_at_end_of_turn', selfTrashAtEndOfTurn);
  actionHandlers.register('schedule_at_end_of_own_turn', scheduleAtEndOfOwnTurn);

  // Attack manipulation
  actionHandlers.register('attack_redirect_to_target', attackRedirectToTarget);

  // Opp DON manipulation
  actionHandlers.register('rest_opp_don', restOppDon);

  // Event activation
  actionHandlers.register('activate_event_from_hand', activateEventFromHand);

  // Complex (PendingPeek/Choose required) — V0 noops to satisfy boot gate
  actionHandlers.register('peek_opp_deck', peekOppDeck);
  actionHandlers.register('peek_and_reorder_own_deck', peekAndReorderOwnDeck);
  actionHandlers.register('peek_and_reorder_own_life', peekAndReorderOwnLife);
  actionHandlers.register('peek_and_reorder_opp_life', peekAndReorderOppLife);
  actionHandlers.register('searcher_peek', searcherPeek);
  actionHandlers.register('reveal_opp_hand', revealOppHand);
  actionHandlers.register('reveal_top_and_conditional_play', revealTopAndConditionalPlay);
  actionHandlers.register('reveal_top_then_if_cost_min', revealTopThenIfCostMin);
  actionHandlers.register('reveal_top_then_if_filter', revealTopThenIfFilter);
  actionHandlers.register('choose_cost_reveal_opp_match', chooseCostRevealOppMatch);
  actionHandlers.register('choose_one', chooseOne);
}

// Suppress unused
export type { CardInstance };
