/**
 * Engine V2 — second batch of cost handlers covering corpus cost keys.
 */

import type { EffectCostV2 } from '../../spec/types.js';
import {
  type CostHandler,
  costHandlers,
} from '../types.js';

function num(c: EffectCostV2, key: string): number {
  const v = c[key];
  return typeof v === 'number' ? v : 0;
}

// ─── restSelf: rest source as cost (alias for restSource)
const restSelf: CostHandler = {
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

// ─── restLeader: rest your leader as cost
const restLeader: CostHandler = {
  canPay(state, ctx) {
    return state.players[ctx.controller].leader.rested === false;
  },
  pay(state, ctx) {
    const leader = state.players[ctx.controller].leader;
    if (leader.rested === true) return null;
    leader.rested = true;
    return state;
  },
};

// ─── restLeaderOrStageFilter: rest leader OR stage (V0: prefers leader)
const restLeaderOrStageFilter: CostHandler = {
  canPay(state, ctx) {
    const pl = state.players[ctx.controller];
    return pl.leader.rested === false || (pl.stage !== null && pl.stage.rested === false);
  },
  pay(state, ctx) {
    const pl = state.players[ctx.controller];
    if (pl.leader.rested === false) {
      pl.leader.rested = true;
      return state;
    }
    if (pl.stage !== null && pl.stage.rested === false) {
      pl.stage.rested = true;
      return state;
    }
    return null;
  },
};

// ─── restOwnCharFilter: rest a matching own char (V0: rest first non-rested)
const restOwnCharFilter: CostHandler = {
  canPay(state, ctx) {
    return state.players[ctx.controller].field.some((c) => c.rested === false);
  },
  pay(state, ctx) {
    const inst = state.players[ctx.controller].field.find((c) => c.rested === false);
    if (inst === undefined) return null;
    inst.rested = true;
    return state;
  },
};

// ─── discardHand: discard N from controller's hand (V0 from head)
const discardHand: CostHandler = {
  canPay(state, ctx, cost) {
    return state.players[ctx.controller].hand.length >= num(cost, 'discardHand');
  },
  pay(state, ctx, cost) {
    const n = num(cost, 'discardHand');
    const pl = state.players[ctx.controller];
    if (pl.hand.length < n) return null;
    for (let i = 0; i < n; i++) {
      const id = pl.hand.shift();
      if (id === undefined) return null;
      pl.trash.push(id);
    }
    return state;
  },
};

// ─── discardHandFilter: discard N matching filter (V0 same as discardHand)
const discardHandFilter: CostHandler = discardHand;

// ─── revealHand: no state change, just an exposure (used for "reveal a card
//     with X to do Y"). Future: tracks revealed in knownByViewer[opp].
const revealHand: CostHandler = {
  canPay(state, ctx) {
    return state.players[ctx.controller].hand.length > 0;
  },
  pay(state) {
    return state;
  },
};

// ─── lifeToHand: top N life cards → hand as cost. Honors the cost-key's
//     numeric value; defaults to 1 when the key value is non-numeric.
const lifeToHand: CostHandler = {
  canPay(state, ctx, cost) {
    const n = Math.max(1, num(cost, 'lifeToHand'));
    return state.players[ctx.controller].life.length >= n;
  },
  pay(state, ctx, cost) {
    const n = Math.max(1, num(cost, 'lifeToHand'));
    const pl = state.players[ctx.controller];
    if (pl.life.length < n) return null;
    for (let i = 0; i < n; i++) {
      const id = pl.life.shift();
      if (id === undefined) return null;
      pl.hand.push(id);
    }
    return state;
  },
};

// ─── flipLife: flip top N life cards face-up (no zone change). Honors the
//     cost-key's numeric value; defaults to 1.
const flipLife: CostHandler = {
  canPay(state, ctx, cost) {
    const n = Math.max(1, num(cost, 'flipLife'));
    return state.players[ctx.controller].life.length >= n;
  },
  pay(state, ctx, cost) {
    const n = Math.max(1, num(cost, 'flipLife'));
    const pl = state.players[ctx.controller];
    if (pl.life.length < n) return null;
    for (let i = 0; i < n; i++) {
      const id = pl.life[i];
      if (id === undefined) return null;
      pl.lifeFaceUp[id] = true;
    }
    return state;
  },
};

// ─── millSelf: trash N from top of own deck as cost
const millSelf: CostHandler = {
  canPay(state, ctx, cost) {
    return state.players[ctx.controller].deck.length >= num(cost, 'millSelf');
  },
  pay(state, ctx, cost) {
    const n = num(cost, 'millSelf');
    const pl = state.players[ctx.controller];
    if (pl.deck.length < n) return null;
    for (let i = 0; i < n; i++) {
      const id = pl.deck.shift();
      if (id === undefined) return null;
      pl.trash.push(id);
    }
    return state;
  },
};

// ─── koSelfCharacter: KO source as cost (sac)
const koSelfCharacter: CostHandler = {
  canPay(state, ctx) {
    const inst = state.instances[ctx.sourceInstanceId];
    if (inst === undefined) return false;
    // Source must be in field or stage to KO
    for (const side of ['A', 'B'] as const) {
      const pl = state.players[side];
      if (pl.field.some((c) => c.instanceId === ctx.sourceInstanceId)) return true;
      if (pl.stage?.instanceId === ctx.sourceInstanceId) return true;
    }
    return false;
  },
  pay(state, ctx) {
    const inst = state.instances[ctx.sourceInstanceId];
    if (inst === undefined) return null;
    const pl = state.players[ctx.controller];
    const fieldIdx = pl.field.findIndex((c) => c.instanceId === ctx.sourceInstanceId);
    if (fieldIdx !== -1) {
      pl.field.splice(fieldIdx, 1);
      pl.trash.push(ctx.sourceInstanceId);
      return state;
    }
    if (pl.stage?.instanceId === ctx.sourceInstanceId) {
      pl.stage = null;
      pl.trash.push(ctx.sourceInstanceId);
      return state;
    }
    return null;
  },
};

// ─── trashSelf: alias for koSelfCharacter
const trashSelf: CostHandler = koSelfCharacter;

// ─── returnSelfChar: return source to hand as cost (instead of KO)
const returnSelfChar: CostHandler = {
  canPay(state, ctx) {
    const inst = state.instances[ctx.sourceInstanceId];
    if (inst === undefined) return false;
    const pl = state.players[ctx.controller];
    return (
      pl.field.some((c) => c.instanceId === ctx.sourceInstanceId) ||
      pl.stage?.instanceId === ctx.sourceInstanceId
    );
  },
  pay(state, ctx) {
    const pl = state.players[ctx.controller];
    const fieldIdx = pl.field.findIndex((c) => c.instanceId === ctx.sourceInstanceId);
    if (fieldIdx !== -1) {
      pl.field.splice(fieldIdx, 1);
      pl.hand.push(ctx.sourceInstanceId);
      return state;
    }
    if (pl.stage?.instanceId === ctx.sourceInstanceId) {
      pl.stage = null;
      pl.hand.push(ctx.sourceInstanceId);
      return state;
    }
    return null;
  },
};

// ─── donCostReturnToDeck: pay N DON back to deck (different from donCost)
const donCostReturnToDeck: CostHandler = {
  canPay(state, ctx, cost) {
    return state.players[ctx.controller].donCostArea.length >= num(cost, 'donCostReturnToDeck');
  },
  pay(state, ctx, cost) {
    const n = num(cost, 'donCostReturnToDeck');
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

// ─── bottomOfDeckSelf: send source to bottom of deck as cost
const bottomOfDeckSelf: CostHandler = {
  canPay(state, ctx) {
    return state.instances[ctx.sourceInstanceId] !== undefined;
  },
  pay(state, ctx) {
    const inst = state.instances[ctx.sourceInstanceId];
    if (inst === undefined) return null;
    const pl = state.players[ctx.controller];
    const fieldIdx = pl.field.findIndex((c) => c.instanceId === ctx.sourceInstanceId);
    if (fieldIdx !== -1) {
      pl.field.splice(fieldIdx, 1);
      pl.deck.push(ctx.sourceInstanceId);
      return state;
    }
    if (pl.stage?.instanceId === ctx.sourceInstanceId) {
      pl.stage = null;
      pl.deck.push(ctx.sourceInstanceId);
      return state;
    }
    return null;
  },
};

// ─── bottomOfDeckFromHand: hand → bottom of deck as cost
const bottomOfDeckFromHand: CostHandler = {
  canPay(state, ctx, cost) {
    return state.players[ctx.controller].hand.length >= num(cost, 'bottomOfDeckFromHand');
  },
  pay(state, ctx, cost) {
    const n = num(cost, 'bottomOfDeckFromHand');
    const pl = state.players[ctx.controller];
    if (pl.hand.length < n) return null;
    for (let i = 0; i < n; i++) {
      const id = pl.hand.shift();
      if (id === undefined) return null;
      pl.deck.push(id);
    }
    return state;
  },
};

// ─── bottomOfDeckFromTrash: trash → bottom of deck as cost
const bottomOfDeckFromTrash: CostHandler = {
  canPay(state, ctx, cost) {
    return state.players[ctx.controller].trash.length >= num(cost, 'bottomOfDeckFromTrash');
  },
  pay(state, ctx, cost) {
    const n = num(cost, 'bottomOfDeckFromTrash');
    const pl = state.players[ctx.controller];
    if (pl.trash.length < n) return null;
    for (let i = 0; i < n; i++) {
      const id = pl.trash.shift();
      if (id === undefined) return null;
      pl.deck.push(id);
    }
    return state;
  },
};

const bottomOfDeckFromTrashFilter: CostHandler = bottomOfDeckFromTrash;

// ─── bottomOfDeckOwnChar: send target own char to bottom of deck as cost
//     V0: picks first own field char
const bottomOfDeckOwnChar: CostHandler = {
  canPay(state, ctx) {
    return state.players[ctx.controller].field.length > 0;
  },
  pay(state, ctx) {
    const pl = state.players[ctx.controller];
    if (pl.field.length === 0) return null;
    const inst = pl.field.shift();
    if (inst === undefined) return null;
    pl.deck.push(inst.instanceId);
    return state;
  },
};

// ─── selfPowerCost: pay by source contributing power (used in counter calc)
//     V0: zero-effect at cost-pay level; semantic handled at attack resolve
const selfPowerCost: CostHandler = {
  canPay() {
    return true;
  },
  pay(state) {
    return state;
  },
};

// ────────────────────────────────────────────────────────────────────
// Registration
// ────────────────────────────────────────────────────────────────────

export function registerCostHandlers2(): void {
  costHandlers.register('restSelf', restSelf);
  costHandlers.register('restLeader', restLeader);
  costHandlers.register('restLeaderOrStageFilter', restLeaderOrStageFilter);
  costHandlers.register('restOwnCharFilter', restOwnCharFilter);
  costHandlers.register('discardHand', discardHand);
  costHandlers.register('discardHandFilter', discardHandFilter);
  costHandlers.register('revealHand', revealHand);
  costHandlers.register('lifeToHand', lifeToHand);
  costHandlers.register('flipLife', flipLife);
  costHandlers.register('millSelf', millSelf);
  costHandlers.register('koSelfCharacter', koSelfCharacter);
  costHandlers.register('trashSelf', trashSelf);
  costHandlers.register('returnSelfChar', returnSelfChar);
  costHandlers.register('donCostReturnToDeck', donCostReturnToDeck);
  costHandlers.register('bottomOfDeckSelf', bottomOfDeckSelf);
  costHandlers.register('bottomOfDeckFromHand', bottomOfDeckFromHand);
  costHandlers.register('bottomOfDeckFromTrash', bottomOfDeckFromTrash);
  costHandlers.register('bottomOfDeckFromTrashFilter', bottomOfDeckFromTrashFilter);
  costHandlers.register('bottomOfDeckOwnChar', bottomOfDeckOwnChar);
  costHandlers.register('selfPowerCost', selfPowerCost);
}
