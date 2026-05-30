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

/** Reduce target's cost by N this turn (transient — model as marker). */
export const removal_cost_reduce: EffectFn = (state, _ctx) => {
  // v0: not yet wired (needs turn-scoped modifier system).
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

/** +N power to a target this turn. v0: skipped (needs turn-scoped modifier system). */
export const power_buff: EffectFn = (state, _ctx) => state;

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

/** Reduce cost of plays this turn. v0: skipped. */
export const cost_reduction: EffectFn = (state, _ctx) => state;

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
} as const;
