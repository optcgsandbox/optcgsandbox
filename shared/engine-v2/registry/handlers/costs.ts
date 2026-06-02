/**
 * Engine V2 — cost handlers.
 *
 * Each cost-key in an EffectCostV2 object gets one (canPay, pay) pair.
 * Per CostPayer contract: canPay returns boolean; pay returns next state
 * or null if it failed mid-pay. Atomicity is the caller's concern.
 *
 * Cross-references:
 * - Implementation spec §3.5
 * - Plan v1 §3.5 (21 cost keys)
 */

import type { EffectCostV2 } from '../../spec/types.js';
import {
  type CostHandler,
  costHandlers,
  type HandlerCtx,
} from '../types.js';

function num(c: EffectCostV2, key: string): number {
  const v = c[key];
  return typeof v === 'number' ? v : 0;
}

// ─── donCost: pay N DON from controller's donCostArea → donRested
const donCost: CostHandler = {
  canPay(state, ctx, cost) {
    return state.players[ctx.controller].donCostArea.length >= num(cost, 'donCost');
  },
  pay(state, ctx, cost) {
    const n = num(cost, 'donCost');
    const pl = state.players[ctx.controller];
    if (pl.donCostArea.length < n) return null;
    for (let i = 0; i < n; i++) {
      const id = pl.donCostArea.shift();
      if (id === undefined) return null;
      pl.donRested.push(id);
    }
    return state;
  },
};

// ─── restSource: rest the source instance
const restSource: CostHandler = {
  canPay(state, ctx) {
    const inst = state.instances[ctx.sourceInstanceId];
    return inst !== undefined && inst.rested === false;
  },
  pay(state, ctx) {
    const inst = state.instances[ctx.sourceInstanceId];
    if (inst === undefined || inst.rested === true) return null;
    inst.rested = true;
    return state;
  },
};

// ─── trashFromHand: discard N cards from controller's hand
const trashFromHand: CostHandler = {
  canPay(state, ctx, cost) {
    return state.players[ctx.controller].hand.length >= num(cost, 'trashFromHand');
  },
  pay(state, ctx, cost) {
    const n = num(cost, 'trashFromHand');
    const pl = state.players[ctx.controller];
    if (pl.hand.length < n) return null;
    for (let i = 0; i < n; i++) {
      const id = pl.hand.shift();
      if (id === undefined) return null;
      pl.trash.push(id);
      state.cardsTrashedThisResolution += 1;
    }
    return state;
  },
};

// ─── trashFromTrash: send N from trash to bottom of deck (recursion cost)
const trashFromTrash: CostHandler = {
  canPay(state, ctx, cost) {
    return state.players[ctx.controller].trash.length >= num(cost, 'trashFromTrash');
  },
  pay(state, ctx, cost) {
    const n = num(cost, 'trashFromTrash');
    const pl = state.players[ctx.controller];
    if (pl.trash.length < n) return null;
    for (let i = 0; i < n; i++) {
      const id = pl.trash.shift(); // bottom of trash (oldest)
      if (id === undefined) return null;
      pl.deck.push(id); // bottom of deck
    }
    return state;
  },
};

// ─── returnAttachedDon: return N attached DON from source → donRested
const returnAttachedDon: CostHandler = {
  canPay(state, ctx, cost) {
    const inst = state.instances[ctx.sourceInstanceId];
    if (inst === undefined) return false;
    return inst.attachedDon.length + inst.attachedDonRested.length >= num(cost, 'returnAttachedDon');
  },
  pay(state, ctx, cost) {
    const n = num(cost, 'returnAttachedDon');
    const inst = state.instances[ctx.sourceInstanceId];
    if (inst === undefined) return null;
    const pl = state.players[ctx.controller];
    let returned = 0;
    while (returned < n && inst.attachedDon.length > 0) {
      const id = inst.attachedDon.shift();
      if (id !== undefined) {
        pl.donRested.push(id);
        returned += 1;
      }
    }
    while (returned < n && inst.attachedDonRested.length > 0) {
      const id = inst.attachedDonRested.shift();
      if (id !== undefined) {
        pl.donRested.push(id);
        returned += 1;
      }
    }
    if (returned < n) return null;
    return state;
  },
};

// ─── returnOwnDon: return N DON from controller's donCostArea → donDeck
const returnOwnDon: CostHandler = {
  canPay(state, ctx, cost) {
    return state.players[ctx.controller].donCostArea.length >= num(cost, 'returnOwnDon');
  },
  pay(state, ctx, cost) {
    const n = num(cost, 'returnOwnDon');
    const pl = state.players[ctx.controller];
    if (pl.donCostArea.length < n) return null;
    for (let i = 0; i < n; i++) {
      const id = pl.donCostArea.shift();
      if (id === undefined) return null;
      pl.donDeck.push(id);
    }
    return state;
  },
};

// ────────────────────────────────────────────────────────────────────
// Registration
// ────────────────────────────────────────────────────────────────────

export function registerCostHandlers(): void {
  costHandlers.register('donCost', donCost);
  costHandlers.register('restSource', restSource);
  costHandlers.register('trashFromHand', trashFromHand);
  costHandlers.register('trashFromTrash', trashFromTrash);
  costHandlers.register('returnAttachedDon', returnAttachedDon);
  costHandlers.register('returnOwnDon', returnOwnDon);
}

export type { HandlerCtx };
