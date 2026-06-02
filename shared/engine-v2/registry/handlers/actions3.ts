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
import { effectivePower } from '../../state/derived/power.js';
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
import { resolveCount } from './formula.js';

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
  const n = resolveCount(state, ctx, action, 1);
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

const takeDamageSelf: ActionHandler = (state, ctx, action) => {
  const n = resolveCount(state, ctx, action, 1);
  const pl = state.players[ctx.controller];
  for (let i = 0; i < n; i++) {
    const id = pl.life.shift();
    if (id === undefined) {
      state.result = { loser: ctx.controller, reason: 'life_zero' };
      return state;
    }
    pl.hand.push(id);
  }
  return state;
};

const dealDamageOpp: ActionHandler = (state, ctx, action) => {
  const n = resolveCount(state, ctx, action, 1);
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
  const n = resolveCount(state, ctx, action, 1);
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
const giveCostBuff: ActionHandler = (state, ctx, action, targets) => {
  const n = resolveCount(state, ctx, action, 0);
  for (const id of targets) {
    const inst = state.instances[id];
    if (inst === undefined) continue;
    inst.costModifierOneShot = (inst.costModifierOneShot ?? 0) + n;
    inst.costModifierExpiresInTurns = inst.costModifierExpiresInTurns ?? 0;
  }
  return state;
};

const costReduction: ActionHandler = (state, ctx, action) => {
  const n = resolveCount(state, ctx, action, -1);
  state.players[ctx.controller].nextPlayCostModifier =
    (state.players[ctx.controller].nextPlayCostModifier ?? 0) + n;
  return state;
};

const removalCostReduce: ActionHandler = (state, ctx, action, targets) => {
  const n = resolveCount(state, ctx, action, -1);
  for (const id of targets) {
    const inst = state.instances[id];
    if (inst === undefined) continue;
    inst.costModifierOneShot = (inst.costModifierOneShot ?? 0) + n;
    inst.costModifierExpiresInTurns = inst.costModifierExpiresInTurns ?? 0;
  }
  return state;
};

const setBasePower: ActionHandler = (state, ctx, action, targets) => {
  // cards.json uses `basePower` (preferred) OR `magnitude` for the value.
  const n = num(action, 'basePower', resolveCount(state, ctx, action, 0));
  for (const id of targets) {
    const inst = state.instances[id];
    if (inst === undefined) continue;
    inst.basePowerOverrideOneShot = n;
    inst.basePowerOverrideExpiresInTurns = expiresInTurnsFor(action['duration']);
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

// set_base_power_copy_from:
//   - Anchor = resolve(action.source) — e.g., "opp_leader", "opp_character"
//   - Destination = each target (typically "self" = source instance)
//   - Effect: each destination's basePowerOverrideOneShot ← anchor's effectivePower
//   - Per CR card text "This Character's base power becomes the same as <X>"
const setBasePowerCopyFrom: ActionHandler = (state, ctx, action, targets) => {
  const sourceKind = typeof action['source'] === 'string' ? (action['source'] as string) : 'opp_leader';
  // Resolve the anchor through the target resolvers (same dispatch as targets).
  const anchorIds = ((): InstanceId[] => {
    if (sourceKind === 'opp_leader') {
      return [state.players[OTHER[ctx.controller]].leader.instanceId];
    }
    if (sourceKind === 'opp_character') {
      // V0: pick first opp character (full player-choice via PendingTargetPick).
      const f = state.players[OTHER[ctx.controller]].field;
      return f.length > 0 ? [f[0]!.instanceId] : [];
    }
    if (sourceKind === 'own_leader') {
      return [state.players[ctx.controller].leader.instanceId];
    }
    return [];
  })();

  if (anchorIds.length === 0) return state;
  const anchor = state.instances[anchorIds[0]!];
  if (anchor === undefined) return state;
  const anchorPower = effectivePower(state, anchor);
  const expires = expiresInTurnsFor(action['duration']);

  for (const id of targets) {
    const dest = state.instances[id];
    if (dest === undefined) continue;
    dest.basePowerOverrideOneShot = anchorPower;
    dest.basePowerOverrideExpiresInTurns = expires;
  }
  return state;
};

// set_base_power_copy_from_target:
//   - Anchor = targets[0] (the chosen opp character)
//   - Destination = ctx.sourceInstanceId (the effect's source — "This Character")
//   - Per EB01-061: "Select an opp character. This Character's base power becomes
//     the same as the selected Character's power"
const setBasePowerCopyFromTarget: ActionHandler = (state, ctx, action, targets) => {
  if (targets.length === 0) return state;
  const anchor = state.instances[targets[0]!];
  if (anchor === undefined) return state;
  const anchorPower = effectivePower(state, anchor);
  const dest = state.instances[ctx.sourceInstanceId];
  if (dest === undefined) return state;
  dest.basePowerOverrideOneShot = anchorPower;
  dest.basePowerOverrideExpiresInTurns = expiresInTurnsFor(action['duration']);
  return state;
};

// Map EffectDuration → expiresInTurns counter for OneShot bookkeeping.
//   'this_turn' / 'this_battle' → 0 (cleared at next enterEnd of controller)
//   'opp_next_turn' / 'opp_next_end_phase' → 1
//   'permanent' → undefined (sentinel: don't tick; effectively continuous-half
//     would be the right home but caller chose OneShot — write 99 as "doesn't
//     expire this game")
function expiresInTurnsFor(duration: unknown): number {
  if (duration === 'opp_next_turn' || duration === 'opp_next_end_phase') return 1;
  if (duration === 'permanent') return 99;
  // 'this_turn' | 'this_battle' | undefined
  return 0;
}

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

const negateTargetEffects: ActionHandler = (state, _ctx, action, targets) => {
  // duration: 'this_turn' is by far the common case in cards.json.
  // Permanent negation is rare; engine has no per-duration negation field —
  // a future tick at enterEnd of action.duration scope handles clearing.
  // For V0: set effectsNegated=true; PhaseScheduler.enterEnd does NOT yet
  // clear this. TODO: tie this to a duration-aware ticker.
  const _duration = action['duration'];
  void _duration;
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

// restrict_opp_attack uses { unless: <cost-key/value> } per cards.json.
// V0: interpret as "opp must discard N cards or skip attack" — extract from
// unless object if numeric; fall back to discardCount/legacy `n`.
const restrictOppAttack: ActionHandler = (state, ctx, action) => {
  const opp = state.players[OTHER[ctx.controller]];
  const unless = action['unless'];
  let n = 1;
  if (typeof unless === 'number') n = unless;
  else if (typeof unless === 'object' && unless !== null) {
    const u = unless as { discardHand?: unknown; donCost?: unknown };
    if (typeof u.discardHand === 'number') n = u.discardHand;
    else if (typeof u.donCost === 'number') n = u.donCost;
  }
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
  const n = resolveCount(state, ctx, action, 1);
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

// ─── peek_opp_deck: deterministic exposure. Take top N of opp deck, add to
//     knownByViewer[ctx.controller]. No PendingPeek (no player decision).
const peekOppDeck: ActionHandler = (state, ctx, action) => {
  const n = resolveCount(state, ctx, action, 1);
  const opp = state.players[OTHER[ctx.controller]];
  const peeked = opp.deck.slice(0, Math.min(n, opp.deck.length));
  const known = state.knownByViewer[ctx.controller] ?? [];
  for (const id of peeked) {
    if (!known.includes(id)) known.push(id);
  }
  state.knownByViewer[ctx.controller] = known;
  return state;
};

// ─── reveal_opp_hand: deterministic exposure. Add opp's hand IDs to viewer's
//     knownByViewer.
const revealOppHand: ActionHandler = (state, ctx) => {
  const opp = state.players[OTHER[ctx.controller]];
  const known = state.knownByViewer[ctx.controller] ?? [];
  for (const id of opp.hand) {
    if (!known.includes(id)) known.push(id);
  }
  state.knownByViewer[ctx.controller] = known;
  return state;
};

// ─── searcher_peek: suspend via PendingPeek so the player can pick up to
//     `addCount` cards from top `lookCount` of own deck. Existing
//     resolvePeekReducer (choiceResolve.ts) moves picked → hand and leftovers
//     → top of deck in original order, then resumes phase.
const searcherPeek: ActionHandler = (state, ctx, action) => {
  const lookCount = num(action, 'lookCount', resolveCount(state, ctx, action, 1));
  const addCount = num(action, 'addCount', 1);
  const pl = state.players[ctx.controller];
  const peeked = pl.deck.slice(0, Math.min(lookCount, pl.deck.length));
  if (peeked.length === 0) return state;
  state.pending = {
    kind: 'peek',
    pendingPeek: {
      controller: ctx.controller,
      sourceInstanceId: ctx.sourceInstanceId,
      peekedIds: peeked,
      addCount,
      resumePhase: state.phase,
    },
  };
  state.phase = 'peek_choice';
  // Mark peeked IDs as known to the viewer.
  const known = state.knownByViewer[ctx.controller] ?? [];
  for (const id of peeked) {
    if (!known.includes(id)) known.push(id);
  }
  state.knownByViewer[ctx.controller] = known;
  return state;
};

// Shared filter check used by all reveal_* variants. Reads filter fields
// off `action.filter` OR off `action` (cards.json uses both shapes).
function revealMatchesFilter(
  card: { kind: string; cost?: number | null; power?: number | null; traits?: ReadonlyArray<string>; colors?: ReadonlyArray<string> },
  action: EffectActionV2,
): boolean {
  const f = action['filter'];
  const filter = typeof f === 'object' && f !== null ? f as Record<string, unknown> : action;
  const cost = typeof card.cost === 'number' ? card.cost : 0;
  const power = typeof card.power === 'number' ? card.power : 0;
  if (filter['kind'] !== undefined && card.kind !== filter['kind']) return false;
  const trait = filter['trait'];
  if (typeof trait === 'string' && !(card.traits ?? []).includes(trait)) return false;
  const typeStr = filter['typeIncludes'];
  if (typeof typeStr === 'string' && !(card.traits ?? []).some((t) => t.includes(typeStr))) return false;
  const color = filter['color'];
  if (typeof color === 'string' && !(card.colors ?? []).includes(color)) return false;
  const minCost = filter['minCost'] ?? action['minCost'];
  if (typeof minCost === 'number' && cost < minCost) return false;
  const maxCost = filter['maxCost'] ?? filter['costMax'] ?? action['maxCost'];
  if (typeof maxCost === 'number' && cost > maxCost) return false;
  const minPower = filter['minPower'] ?? filter['powerMin'];
  if (typeof minPower === 'number' && power < minPower) return false;
  const maxPower = filter['maxPower'] ?? filter['powerMax'];
  if (typeof maxPower === 'number' && power > maxPower) return false;
  return true;
}

// ─── reveal_top_and_conditional_play: reveal top of deck; if matches filter,
//     PLAY the revealed card for free; on miss OR after play of non-char,
//     send revealed card to bottom of deck (per CR text "place the revealed
//     card at the bottom of your deck").
const revealTopAndConditionalPlay: ActionHandler = (state, ctx, action) => {
  const pl = state.players[ctx.controller];
  const topId = pl.deck[0];
  if (topId === undefined) return state;
  const inst = state.instances[topId];
  if (inst === undefined) return state;
  const card = state.cardLibrary[inst.cardId] as { kind: string; cost?: number | null; power?: number | null; traits?: ReadonlyArray<string>; colors?: ReadonlyArray<string> } | undefined;
  if (card === undefined) return state;
  const matches = revealMatchesFilter(card, action);

  // Always expose the revealed card.
  const known = state.knownByViewer[ctx.controller] ?? [];
  if (!known.includes(topId)) known.push(topId);
  state.knownByViewer[ctx.controller] = known;

  pl.deck.shift();
  if (matches && card.kind === 'character') {
    resetInstanceTransientState(inst);
    // Summoning sickness applies on any play unless the card explicitly says
    // otherwise. "Play it rested" controls inst.rested only, not sickness.
    inst.summoningSick = true;
    inst.rested = action['rested'] === true;
    pl.field.push(inst);
    (state.history as Array<unknown>).push({
      type: 'CHARACTER_PLAYED',
      instanceId: topId,
      cardId: inst.cardId,
      controller: ctx.controller,
      cost: 0,
      reason: 'reveal_top_and_conditional_play',
    });
  } else {
    // No match OR not a character → bottom of deck.
    pl.deck.push(topId);
  }
  return state;
};

// ─── reveal_top_then_if_filter / _if_cost_min: reveal top, if matches,
//     dispatch action.thenAction with the parent's targets. Always send the
//     revealed card to bottom of deck after (per CR text "Then, place the
//     revealed card at the bottom of your deck").
function revealTopThenIf(state: GameState, ctx: HandlerCtxLite, action: EffectActionV2, targets: ReadonlyArray<InstanceId>): GameState {
  const pl = state.players[ctx.controller];
  const topId = pl.deck[0];
  if (topId === undefined) return state;
  const inst = state.instances[topId];
  if (inst === undefined) return state;
  const card = state.cardLibrary[inst.cardId] as { kind: string; cost?: number | null; power?: number | null; traits?: ReadonlyArray<string>; colors?: ReadonlyArray<string> } | undefined;
  if (card === undefined) return state;
  const matches = revealMatchesFilter(card, action);

  const known = state.knownByViewer[ctx.controller] ?? [];
  if (!known.includes(topId)) known.push(topId);
  state.knownByViewer[ctx.controller] = known;

  pl.deck.shift();
  pl.deck.push(topId); // always to bottom

  let next = state;
  if (matches) {
    const thenAction = action['thenAction'];
    if (typeof thenAction === 'object' && thenAction !== null && typeof (thenAction as { kind?: string }).kind === 'string') {
      const sub = thenAction as EffectActionV2;
      if (actionHandlers.has(sub.kind)) {
        next = actionHandlers.get(sub.kind)(next, ctx, sub, targets);
      }
    }
  }
  return next;
}

interface HandlerCtxLite {
  readonly sourceInstanceId: InstanceId;
  readonly controller: PlayerId;
}

const revealTopThenIfCostMin: ActionHandler = (state, ctx, action, targets) =>
  revealTopThenIf(state, ctx, action, targets);

const revealTopThenIfFilter: ActionHandler = (state, ctx, action, targets) =>
  revealTopThenIf(state, ctx, action, targets);

// ─── peek_and_reorder_*: V0 look-only. Expose the relevant top N to
//     knownByViewer[ctx.controller]; do NOT actually reorder (true reorder
//     requires PendingReorder + player decision — see #80 follow-up).
//     Engine learns the cards' identities; downstream effects depending on
//     reorder behavior (rare) still won't function correctly.
function exposeToKnown(state: GameState, viewer: PlayerId, ids: ReadonlyArray<InstanceId>): void {
  const known = state.knownByViewer[viewer] ?? [];
  for (const id of ids) {
    if (!known.includes(id)) known.push(id);
  }
  state.knownByViewer[viewer] = known;
}

const peekAndReorderOwnDeck: ActionHandler = (state, ctx, action) => {
  const n = resolveCount(state, ctx, action, state.players[ctx.controller].deck.length);
  const ids = state.players[ctx.controller].deck.slice(0, Math.min(n, state.players[ctx.controller].deck.length));
  exposeToKnown(state, ctx.controller, ids);
  return state;
};

const peekAndReorderOwnLife: ActionHandler = (state, ctx, action) => {
  const n = resolveCount(state, ctx, action, state.players[ctx.controller].life.length);
  const ids = state.players[ctx.controller].life.slice(0, Math.min(n, state.players[ctx.controller].life.length));
  exposeToKnown(state, ctx.controller, ids);
  return state;
};

const peekAndReorderOppLife: ActionHandler = (state, ctx, action) => {
  const opp = state.players[OTHER[ctx.controller]];
  const n = resolveCount(state, ctx, action, opp.life.length);
  const ids = opp.life.slice(0, Math.min(n, opp.life.length));
  exposeToKnown(state, ctx.controller, ids);
  return state;
};

// ─── choose_one: suspend via PendingChoose with the supplied options array.
//     resolveChooseOneReducer (choiceResolve.ts) fires options[optionIndex].action.
const chooseOne: ActionHandler = (state, ctx, action) => {
  const options = action['options'];
  if (!Array.isArray(options) || options.length === 0) return state;
  state.pending = {
    kind: 'choose_one',
    pendingChoose: {
      controller: ctx.controller,
      sourceInstanceId: ctx.sourceInstanceId,
      options: options as ReadonlyArray<unknown>,
      resumePhase: state.phase,
    },
  };
  state.phase = 'choose_one';
  return state;
};

const chooseCostRevealOppMatch: ActionHandler = noop;

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
