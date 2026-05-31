// 18 effect template handlers. Per docs/optcg-sim/rules-reference.md §2.
//
// These are GENERIC implementations of each effect category. A specific
// card's effect is composed by: pick template(s) + bind parameters in
// card data. E.g., "Looking-Glass Pirate" might have:
//   effectTags: ['searcher'],
//   templateParams: { searcher: { lookCount: 5, addCount: 1, traitFilter: 'Pirate' } }
//
// For v0 these are minimal stubs that mutate state correctly enough for the
// engine to keep running. Real card-by-card tuning happens once the corpus
// is ingested (task #72).

// Performance contract (Batch 4 / audit 2026-05-30):
// `fireEffects` (cards/effects/dispatch.ts) clones GameState ONCE before the
// template chain begins, then passes the same clone through `cur = handler(cur, ctx)`.
// Templates therefore MUTATE the passed state in place — no internal
// structuredClone. This avoids N clones for N matched tags on a single fire,
// which becomes the dominant cost once cardLibrary grows (vegapull corpus).
// Templates that early-return on a "no-op" branch return the input state
// unchanged, which the caller's pre-clone already separated from the user's
// pre-fire state.

import type { PlayerId } from '../../GameState';
import type { EffectFn } from './types';

const OTHER: Record<PlayerId, PlayerId> = { A: 'B', B: 'A' };

/** Look at top N, add 1 to hand, shuffle the rest back. v0 = take top card. */
export const searcher: EffectFn = (state, ctx) => {
  const p = state.players[ctx.controller];
  const top = p.deck.shift();
  if (top) p.hand.push(top);
  return state;
};

/** Draw N cards. Default 1. */
export const draw: EffectFn = (state, ctx) => {
  const p = state.players[ctx.controller];
  const n = ctx.param ?? 1;
  for (let i = 0; i < n && p.deck.length > 0; i++) {
    p.hand.push(p.deck.shift()!);
  }
  return state;
};

/** KO target character. */
export const removal_ko: EffectFn = (state, ctx) => {
  if (!ctx.targetInstanceId) return state;
  for (const pid of ['A', 'B'] as PlayerId[]) {
    const idx = state.players[pid].field.findIndex((i) => i.instanceId === ctx.targetInstanceId);
    if (idx !== -1) {
      const removed = state.players[pid].field.splice(idx, 1)[0];
      while (removed.attachedDon.length > 0) {
        state.players[pid].donRested.push(removed.attachedDon.shift()!);
      }
      state.players[pid].trash.push(removed.instanceId);
      return state;
    }
  }
  return state;
};

/** Bounce target to owner's hand. */
export const removal_bounce: EffectFn = (state, ctx) => {
  if (!ctx.targetInstanceId) return state;
  for (const pid of ['A', 'B'] as PlayerId[]) {
    const idx = state.players[pid].field.findIndex((i) => i.instanceId === ctx.targetInstanceId);
    if (idx !== -1) {
      const removed = state.players[pid].field.splice(idx, 1)[0];
      while (removed.attachedDon.length > 0) {
        state.players[pid].donRested.push(removed.attachedDon.shift()!);
      }
      state.players[pid].hand.push(removed.instanceId);
      return state;
    }
  }
  return state;
};

/** V3-2: Reduce target's effective cost by N this turn. Sets
 *  `target.costModifier = -(ctx.param ?? 1)`. Cleared in `endTurn`. The
 *  modifier is read by cost-cap removal effects (none in engine yet — wired
 *  for V3-5). Requires `ctx.targetInstanceId`. */
export const removal_cost_reduce: EffectFn = (state, ctx) => {
  if (!ctx.targetInstanceId) return state;
  const inst = state.instances[ctx.targetInstanceId];
  if (!inst) return state;
  const delta = -(ctx.param ?? 1);
  const next = (inst.costModifier ?? 0) + delta;
  state.instances[ctx.targetInstanceId].costModifier = next;
  for (const pid of ['A', 'B'] as const) {
    const pl = state.players[pid];
    if (pl.leader.instanceId === ctx.targetInstanceId) pl.leader.costModifier = next;
    for (const f of pl.field) if (f.instanceId === ctx.targetInstanceId) f.costModifier = next;
    if (pl.stage && pl.stage.instanceId === ctx.targetInstanceId) pl.stage.costModifier = next;
  }
  return state;
};

/** Marker for Blocker keyword — passive, no per-effect action. */
export const blocker: EffectFn = (state, _ctx) => state;

/** Marker for Rush keyword — passive. */
export const rush: EffectFn = (state, _ctx) => state;

/** Marker for Double Attack — passive (resolved during damage step). */
export const double_attack: EffectFn = (state, _ctx) => state;

/** Counter event — +N power to defender during battle. v0: handled inline. */
export const counter_event: EffectFn = (state, _ctx) => state;

/** Counter character — same v0 pattern. */
export const counter_character: EffectFn = (state, _ctx) => state;

/** V3-1 (CR §10-2-9 "(+N) power for the turn"): +N power to a target this
 *  turn. Adds `ctx.param ?? 1000` to the target's `powerModifier` and mirrors
 *  onto the per-zone struct so legality + UI read the buffed value. Cleared
 *  in `endTurn` alongside `set_power_zero` per the same D16 infra. */
export const power_buff: EffectFn = (state, ctx) => {
  if (!ctx.targetInstanceId) return state;
  const inst = state.instances[ctx.targetInstanceId];
  if (!inst) return state;
  const delta = ctx.param ?? 1000;
  const next = (inst.powerModifier ?? 0) + delta;
  state.instances[ctx.targetInstanceId].powerModifier = next;
  for (const pid of ['A', 'B'] as const) {
    const pl = state.players[pid];
    if (pl.leader.instanceId === ctx.targetInstanceId) pl.leader.powerModifier = next;
    for (const f of pl.field) if (f.instanceId === ctx.targetInstanceId) f.powerModifier = next;
    if (pl.stage && pl.stage.instanceId === ctx.targetInstanceId) pl.stage.powerModifier = next;
  }
  return state;
};

/** D16 (CR §4-12): set a target's effective power to 0 for the rest of the
 *  turn. Spec: "Reduces target's power by (current power amount). If already
 *  negative → no effect." Implemented as `inst.powerModifier = -currentEff`
 *  so subsequent buffs (e.g. new DON attached) still add on top of the 0.
 *  Cleared in endTurn (phases/turn.ts). Requires `ctx.targetInstanceId`. */
export const set_power_zero: EffectFn = (state, ctx) => {
  if (!ctx.targetInstanceId) return state;
  const inst = state.instances[ctx.targetInstanceId];
  if (!inst) return state;
  const card = state.cardLibrary[inst.cardId];
  if (!card) return state;
  const currentBase =
    card.kind === 'leader' ? (card as { power: number }).power :
    card.kind === 'character' ? (card as { power: number }).power : 0;
  const currentEff = currentBase + inst.attachedDon.length * 1000 + (inst.powerModifier ?? 0);
  if (currentEff <= 0) return state; // spec: already-negative → no-op
  // Apply delta so the card reads as 0. Subsequent +1000 DON would add to 0,
  // giving 1000 — matches CR §4-12 "reduces by current power".
  state.instances[ctx.targetInstanceId].powerModifier =
    (state.instances[ctx.targetInstanceId].powerModifier ?? 0) - currentEff;
  // Mirror onto per-zone struct(s) since legality / UI read from per-zone.
  for (const pid of ['A', 'B'] as const) {
    const pl = state.players[pid];
    if (pl.leader.instanceId === ctx.targetInstanceId) {
      pl.leader.powerModifier = state.instances[ctx.targetInstanceId].powerModifier;
    }
    for (const f of pl.field) {
      if (f.instanceId === ctx.targetInstanceId) {
        f.powerModifier = state.instances[ctx.targetInstanceId].powerModifier;
      }
    }
    if (pl.stage && pl.stage.instanceId === ctx.targetInstanceId) {
      pl.stage.powerModifier = state.instances[ctx.targetInstanceId].powerModifier;
    }
  }
  return state;
};

/** V3-2: Reduce the controller's next PLAY_CARD cost by `ctx.param ?? 1`.
 *  Stored on `PlayerZones.nextPlayCostModifier` as a negative number; consumed
 *  by `applyAction.playCard` after the next play OR cleared in `endTurn`. */
export const cost_reduction: EffectFn = (state, ctx) => {
  const p = state.players[ctx.controller];
  const delta = -(ctx.param ?? 1);
  p.nextPlayCostModifier = (p.nextPlayCostModifier ?? 0) + delta;
  return state;
};

/** Return target from trash to hand or deck. */
export const recursion: EffectFn = (state, ctx) => {
  if (!ctx.targetInstanceId) return state;
  const p = state.players[ctx.controller];
  const idx = p.trash.indexOf(ctx.targetInstanceId);
  if (idx !== -1) {
    p.trash.splice(idx, 1);
    p.hand.push(ctx.targetInstanceId);
  }
  return state;
};

/** +1 DON to active pool. Stage cards / "ramp" effects. */
export const ramp: EffectFn = (state, ctx) => {
  const p = state.players[ctx.controller];
  if (p.donDeck.length > 0) {
    p.donCostArea.push(p.donDeck.shift()!);
  }
  return state;
};

/** +1 life card from top of deck. */
export const lifegain: EffectFn = (state, ctx) => {
  const p = state.players[ctx.controller];
  const top = p.deck.shift();
  if (top) p.life.unshift(top); // push to top of life stack (face-down)
  return state;
};

/** Top of life → hand (reverse of taking damage). */
export const life_to_hand: EffectFn = (state, ctx) => {
  const p = state.players[ctx.controller];
  const lifeId = p.life.shift();
  if (lifeId) p.hand.push(lifeId);
  return state;
};

/** Disrupt opponent: discard 1 from hand (random for v0). */
export const disruption: EffectFn = (state, ctx) => {
  const opp = state.players[OTHER[ctx.controller]];
  if (opp.hand.length === 0) return state;
  const idx = 0; // v0: discard first card; engine doesn't expose RNG mid-effect yet.
  const dropped = opp.hand.splice(idx, 1)[0];
  opp.trash.push(dropped);
  return state;
};

/** Vanilla — no effect. */
export const vanilla: EffectFn = (state, _ctx) => state;

// ─────────────────────────────────────────────────────────────────────
// V3-5 new tag templates
// ─────────────────────────────────────────────────────────────────────

/** V3-5: Move N of opponent's active DON → opponent's rested DON.
 *  param = N (default 1). Common Yellow tempo effect. */
export const rest_opp_don: EffectFn = (state, ctx) => {
  const opp = state.players[OTHER[ctx.controller]];
  const n = ctx.param ?? 1;
  for (let i = 0; i < n && opp.donCostArea.length > 0; i++) {
    opp.donRested.push(opp.donCostArea.shift()!);
  }
  return state;
};

/** V3-5: Mill — top N of CONTROLLER's deck → controller's trash. param = N.
 *  v0: always self-mill; for opp-mill ship a separate tag if needed. */
export const mill: EffectFn = (state, ctx) => {
  const p = state.players[ctx.controller];
  const n = ctx.param ?? 1;
  for (let i = 0; i < n && p.deck.length > 0; i++) {
    p.trash.push(p.deck.shift()!);
  }
  return state;
};

/** V3-5/V3-9: Expose opp's hand to the controller. Adds every current opp
 *  hand instance id to `state.knownByViewer[controller]` so viewForPlayer
 *  unredacts them when the controller queries the view. The set persists
 *  until that zone is shuffled — for V0 there is no shuffle hook clearing
 *  the overlay, so revealed identities stay known for the rest of the game. */
export const reveal_opp_hand: EffectFn = (state, ctx) => {
  const opp = state.players[OTHER[ctx.controller]];
  const known = state.knownByViewer[ctx.controller];
  for (const id of opp.hand) {
    if (!known.includes(id)) known.push(id);
  }
  return state;
};

/** V3-5: Move 1 card from opp's hand → controller's hand. V0 picks the first
 *  card (deterministic); V3-4 will upgrade to a choice UI. Also adds the
 *  taken card to the controller's `knownByViewer` overlay since the card is
 *  now in their hand. */
export const take_from_opp_hand: EffectFn = (state, ctx) => {
  const opp = state.players[OTHER[ctx.controller]];
  if (opp.hand.length === 0) return state;
  const taken = opp.hand.shift()!;
  state.players[ctx.controller].hand.push(taken);
  const known = state.knownByViewer[ctx.controller];
  if (!known.includes(taken)) known.push(taken);
  return state;
};

/** V3-5: Search controller's deck for the first card matching `param`
 *  (currently unused — V0 takes the first deck entry), add to hand, leave the
 *  rest of the deck in place. Real cards require a filter — v0 = "tutor any
 *  card." */
export const search_deck: EffectFn = (state, ctx) => {
  const p = state.players[ctx.controller];
  if (p.deck.length === 0) return state;
  const top = p.deck.shift()!;
  p.hand.push(top);
  return state;
};

/** V3-5: Send target instance to its controller's exile zone. Removes from
 *  field/stage/trash/hand wherever it currently sits. */
export const exile: EffectFn = (state, ctx) => {
  if (!ctx.targetInstanceId) return state;
  for (const pid of ['A', 'B'] as PlayerId[]) {
    const pl = state.players[pid];
    // Field
    const fIdx = pl.field.findIndex((i) => i.instanceId === ctx.targetInstanceId);
    if (fIdx !== -1) {
      const removed = pl.field.splice(fIdx, 1)[0];
      while (removed.attachedDon.length > 0) pl.donRested.push(removed.attachedDon.shift()!);
      pl.exile.push(removed.instanceId);
      return state;
    }
    // Stage
    if (pl.stage && pl.stage.instanceId === ctx.targetInstanceId) {
      while (pl.stage.attachedDon.length > 0) pl.donRested.push(pl.stage.attachedDon.shift()!);
      pl.exile.push(pl.stage.instanceId);
      pl.stage = null;
      return state;
    }
    // Trash
    const tIdx = pl.trash.indexOf(ctx.targetInstanceId);
    if (tIdx !== -1) {
      pl.trash.splice(tIdx, 1);
      pl.exile.push(ctx.targetInstanceId);
      return state;
    }
    // Hand
    const hIdx = pl.hand.indexOf(ctx.targetInstanceId);
    if (hIdx !== -1) {
      pl.hand.splice(hIdx, 1);
      pl.exile.push(ctx.targetInstanceId);
      return state;
    }
  }
  return state;
};

/** V3-5: Place a hand card on the controller's field without paying cost.
 *  Character only — events / stages with this tag are no-ops. Sets
 *  summoningSick=true per V3-6 default. */
export const play_for_free: EffectFn = (state, ctx) => {
  if (!ctx.targetInstanceId) return state;
  const p = state.players[ctx.controller];
  const handIdx = p.hand.indexOf(ctx.targetInstanceId);
  if (handIdx === -1) return state;
  const inst = state.instances[ctx.targetInstanceId];
  if (!inst) return state;
  const card = state.cardLibrary[inst.cardId];
  if (!card || card.kind !== 'character') return state;
  p.hand.splice(handIdx, 1);
  inst.summoningSick = true;
  p.field.push(inst);
  return state;
};

/** V3-5: Rest a target character/leader. Sets `rested = true` and mirrors
 *  onto per-zone struct. No DON movement. */
export const rest_target: EffectFn = (state, ctx) => {
  if (!ctx.targetInstanceId) return state;
  const inst = state.instances[ctx.targetInstanceId];
  if (!inst) return state;
  state.instances[ctx.targetInstanceId].rested = true;
  for (const pid of ['A', 'B'] as PlayerId[]) {
    const pl = state.players[pid];
    if (pl.leader.instanceId === ctx.targetInstanceId) pl.leader.rested = true;
    for (const f of pl.field) if (f.instanceId === ctx.targetInstanceId) f.rested = true;
    if (pl.stage && pl.stage.instanceId === ctx.targetInstanceId) pl.stage.rested = true;
  }
  return state;
};

/** V3-5: Move target from hand or trash → top of controller's deck. */
export const move_to_top: EffectFn = (state, ctx) => {
  if (!ctx.targetInstanceId) return state;
  const p = state.players[ctx.controller];
  const hIdx = p.hand.indexOf(ctx.targetInstanceId);
  if (hIdx !== -1) {
    p.hand.splice(hIdx, 1);
    p.deck.unshift(ctx.targetInstanceId);
    return state;
  }
  const tIdx = p.trash.indexOf(ctx.targetInstanceId);
  if (tIdx !== -1) {
    p.trash.splice(tIdx, 1);
    p.deck.unshift(ctx.targetInstanceId);
    return state;
  }
  return state;
};

/** Master registry: tag → handler function. */
export const TEMPLATES = {
  searcher,
  draw,
  removal_ko,
  removal_bounce,
  removal_cost_reduce,
  blocker,
  rush,
  double_attack,
  counter_event,
  counter_character,
  power_buff,
  set_power_zero,
  cost_reduction,
  recursion,
  ramp,
  lifegain,
  life_to_hand,
  disruption,
  vanilla,
  // V3-5:
  rest_opp_don,
  mill,
  reveal_opp_hand,
  take_from_opp_hand,
  search_deck,
  exile,
  play_for_free,
  rest_target,
  move_to_top,
} as const;
