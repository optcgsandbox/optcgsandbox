/**
 * Engine V2 — second batch of cost handlers covering corpus cost keys.
 */

import type { EffectCostV2 } from '../../spec/types.js';
import type { CardInstance, GameState } from '../../state/types.js';
import {
  type CostHandler,
  costHandlers,
} from '../types.js';
import { writeBinding } from '../../effects/clauseScratch.js';
import { filterCostCount, filterCostFilter, matchesCardFilter } from './filter.js';

function num(c: EffectCostV2, key: string): number {
  const v = c[key];
  return typeof v === 'number' ? v : 0;
}

/** F-8D — player-picked payment cards for `key`, or null to use the V0
 *  deterministic pick. Valid only when exactly `count` ids were picked;
 *  per-id zone membership is verified by each handler at pay time. */
function chosenFor(
  ctx: { chosenCostIds?: Readonly<Record<string, ReadonlyArray<string>>> },
  key: string,
  count: number,
): ReadonlyArray<string> | null {
  const ids = ctx.chosenCostIds?.[key];
  return ids !== undefined && ids.length === count ? ids : null;
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

// ─── restLeaderOrStageFilter: rest leader OR stage matching filter.
const restLeaderOrStageFilter: CostHandler = {
  canPay(state, ctx, cost) {
    const filter = filterCostFilter(cost['restLeaderOrStageFilter']);
    const pl = state.players[ctx.controller];
    if (pl.leader.rested === false && matchesCardFilter(state, pl.leader, filter)) return true;
    if (pl.stage !== null && pl.stage.rested === false && matchesCardFilter(state, pl.stage, filter)) return true;
    return false;
  },
  pay(state, ctx, cost) {
    const filter = filterCostFilter(cost['restLeaderOrStageFilter']);
    const pl = state.players[ctx.controller];
    if (pl.leader.rested === false && matchesCardFilter(state, pl.leader, filter)) {
      pl.leader.rested = true;
      return state;
    }
    if (pl.stage !== null && pl.stage.rested === false && matchesCardFilter(state, pl.stage, filter)) {
      pl.stage.rested = true;
      return state;
    }
    return null;
  },
};

// ─── restOwnCharFilter: rest `count` own chars matching filter.
const restOwnCharFilter: CostHandler = {
  canPay(state, ctx, cost) {
    const value = cost['restOwnCharFilter'];
    const count = filterCostCount(value);
    const filter = filterCostFilter(value);
    const eligible = state.players[ctx.controller].field.filter(
      (c) => c.rested === false && matchesCardFilter(state, c, filter),
    );
    return eligible.length >= count;
  },
  pay(state, ctx, cost) {
    const value = cost['restOwnCharFilter'];
    const count = filterCostCount(value);
    const filter = filterCostFilter(value);
    const eligible = state.players[ctx.controller].field.filter(
      (c) => c.rested === false && matchesCardFilter(state, c, filter),
    );
    if (eligible.length < count) return null;
    const picked = chosenFor(ctx, 'restOwnCharFilter', count);
    const toRest = picked !== null
      ? picked.map((id) => eligible.find((c) => c.instanceId === id))
      : eligible.slice(0, count);
    for (const inst of toRest) {
      if (inst === undefined) return null; // pick not eligible
      inst.rested = true;
    }
    return state;
  },
};

// ─── returnOwnCharFilter: return `count` own chars matching filter from
//     field → owner's hand. Sister to restOwnCharFilter. Used by EB01-021
//     (Hannyabal) and similar "return X to owner's hand:" cost clauses.
const returnOwnCharFilter: CostHandler = {
  canPay(state, ctx, cost) {
    const value = cost['returnOwnCharFilter'];
    const count = filterCostCount(value);
    const filter = filterCostFilter(value);
    const eligible = state.players[ctx.controller].field.filter(
      (c) => matchesCardFilter(state, c, filter),
    );
    return eligible.length >= count;
  },
  pay(state, ctx, cost) {
    const value = cost['returnOwnCharFilter'];
    const count = filterCostCount(value);
    const filter = filterCostFilter(value);
    const pl = state.players[ctx.controller];
    const eligible = pl.field.filter((c) => matchesCardFilter(state, c, filter));
    if (eligible.length < count) return null;
    const picked = chosenFor(ctx, 'returnOwnCharFilter', count);
    const toReturn = picked !== null
      ? picked.map((id) => eligible.find((c) => c.instanceId === id))
      : eligible.slice(0, count);
    for (const inst of toReturn) {
      if (inst === undefined) return null; // pick not eligible
      const idx = pl.field.findIndex((c) => c.instanceId === inst.instanceId);
      if (idx === -1) return null;
      // Detach attached DON before moving the instance off field. Attached
      // DON returns to its owner's donRested pile.
      for (const donId of inst.attachedDon) pl.donRested.push(donId);
      for (const donId of inst.attachedDonRested) pl.donRested.push(donId);
      inst.attachedDon = [];
      inst.attachedDonRested = [];
      pl.field.splice(idx, 1);
      pl.hand.push(inst.instanceId);
    }
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
    const ids = chosenFor(ctx, 'discardHand', n) ?? pl.hand.slice(0, n);
    for (const id of ids) {
      const idx = pl.hand.indexOf(id);
      if (idx === -1) return null;
      pl.hand.splice(idx, 1);
      pl.trash.push(id);
      state.cardsTrashedThisResolution += 1;
    }
    return state;
  },
};

// ─── discardHandFilter: discard `count` cards from hand matching filter.
const discardHandFilter: CostHandler = {
  canPay(state, ctx, cost) {
    const value = cost['discardHandFilter'];
    const count = filterCostCount(value);
    const filter = filterCostFilter(value);
    const pl = state.players[ctx.controller];
    let matches = 0;
    for (const id of pl.hand) {
      const inst = state.instances[id];
      if (inst !== undefined && matchesCardFilter(state, inst, filter)) matches += 1;
      if (matches >= count) return true;
    }
    return matches >= count;
  },
  pay(state, ctx, cost) {
    const value = cost['discardHandFilter'];
    const count = filterCostCount(value);
    const filter = filterCostFilter(value);
    const pl = state.players[ctx.controller];
    let toDiscard: string[] = [];
    const picked = chosenFor(ctx, 'discardHandFilter', count);
    if (picked !== null) {
      // Player-picked payment — every pick must be in hand AND match the
      // printed filter; otherwise fail the pay (atomic restore upstream).
      for (const id of picked) {
        const inst = state.instances[id];
        if (!pl.hand.includes(id) || inst === undefined || !matchesCardFilter(state, inst, filter)) {
          return null;
        }
      }
      toDiscard = [...picked];
    } else {
      for (const id of pl.hand) {
        const inst = state.instances[id];
        if (inst !== undefined && matchesCardFilter(state, inst, filter)) toDiscard.push(id);
        if (toDiscard.length >= count) break;
      }
    }
    if (toDiscard.length < count) return null;
    for (const id of toDiscard) {
      const idx = pl.hand.indexOf(id);
      if (idx !== -1) pl.hand.splice(idx, 1);
      pl.trash.push(id);
      state.cardsTrashedThisResolution += 1;
    }
    // ClauseScratch binding: if cost.bind is declared, write the first
    // discarded card under the sentinel key '_costPicked'. The dispatcher
    // renames it to the declared bind name after the cost loop completes.
    const bind = cost['bind'];
    if (typeof bind === 'string' && bind !== '' && toDiscard[0] !== undefined) {
      writeBinding(state, ctx.scratch, '_costPicked', toDiscard[0]);
    }
    return state;
  },
};

// ─── revealHand: no zone change, just an exposure (used for "reveal a card
//     with X to do Y"). Future: tracks revealed in knownByViewer[opp].
//     F-8D: when the human player picked WHICH card to reveal, record the
//     exposure in history so the log/presentation can surface it. The V0
//     no-pick path stays a pure no-op (AI / sim / server unchanged).
const revealHand: CostHandler = {
  canPay(state, ctx) {
    return state.players[ctx.controller].hand.length > 0;
  },
  pay(state, ctx) {
    const picked = chosenFor(ctx, 'revealHand', 1);
    if (picked !== null) {
      if (!state.players[ctx.controller].hand.includes(picked[0]!)) return null;
      (state.history as Array<unknown>).push({
        type: 'HAND_CARD_REVEALED',
        controller: ctx.controller,
        instanceId: picked[0],
      });
    }
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

// koSelfCharacter / returnSelfChar / trashSelf: the cost-value filter (if
// present) is checked against the SOURCE inst — i.e., the source can only
// pay this if it matches the filter.
function sourceMatchesFilter(state: GameState, ctx: { sourceInstanceId: string }, value: unknown): boolean {
  const filter = filterCostFilter(value);
  const inst = state.instances[ctx.sourceInstanceId];
  if (inst === undefined) return false;
  return matchesCardFilter(state, inst, filter);
}

const koSelfCharacter: CostHandler = {
  canPay(state, ctx, cost) {
    const value = cost['koSelfCharacter'];
    if (!sourceMatchesFilter(state, ctx, value)) return false;
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

const trashSelf: CostHandler = koSelfCharacter;

const returnSelfChar: CostHandler = {
  canPay(state, ctx, cost) {
    const value = cost['returnSelfChar'];
    if (!sourceMatchesFilter(state, ctx, value)) return false;
    const pl = state.players[ctx.controller];
    return (
      pl.field.some((c) => c.instanceId === ctx.sourceInstanceId) ||
      pl.stage?.instanceId === ctx.sourceInstanceId
    );
  },
  pay(state, ctx, cost) {
    const pl = state.players[ctx.controller];
    const fieldIdx = pl.field.findIndex((c) => c.instanceId === ctx.sourceInstanceId);
    if (fieldIdx !== -1) {
      pl.field.splice(fieldIdx, 1);
      pl.hand.push(ctx.sourceInstanceId);
      if (typeof cost['bind'] === 'string') {
        writeBinding(state, ctx.scratch, '_costPicked', ctx.sourceInstanceId);
      }
      return state;
    }
    if (pl.stage?.instanceId === ctx.sourceInstanceId) {
      pl.stage = null;
      pl.hand.push(ctx.sourceInstanceId);
      if (typeof cost['bind'] === 'string') {
        writeBinding(state, ctx.scratch, '_costPicked', ctx.sourceInstanceId);
      }
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
    const ids = chosenFor(ctx, 'bottomOfDeckFromHand', n) ?? pl.hand.slice(0, n);
    for (const id of ids) {
      const idx = pl.hand.indexOf(id);
      if (idx === -1) return null;
      pl.hand.splice(idx, 1);
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

// ─── bottomOfDeckFromTrashFilter: send `count` trash cards matching filter
//     to bottom of deck.
const bottomOfDeckFromTrashFilter: CostHandler = {
  canPay(state, ctx, cost) {
    const value = cost['bottomOfDeckFromTrashFilter'];
    const count = filterCostCount(value);
    const filter = filterCostFilter(value);
    const pl = state.players[ctx.controller];
    let matches = 0;
    for (const id of pl.trash) {
      const inst = state.instances[id];
      if (inst !== undefined && matchesCardFilter(state, inst, filter)) matches += 1;
      if (matches >= count) return true;
    }
    return matches >= count;
  },
  pay(state, ctx, cost) {
    const value = cost['bottomOfDeckFromTrashFilter'];
    const count = filterCostCount(value);
    const filter = filterCostFilter(value);
    const pl = state.players[ctx.controller];
    const toMove: string[] = [];
    for (const id of pl.trash) {
      const inst = state.instances[id];
      if (inst !== undefined && matchesCardFilter(state, inst, filter)) toMove.push(id);
      if (toMove.length >= count) break;
    }
    if (toMove.length < count) return null;
    for (const id of toMove) {
      const idx = pl.trash.indexOf(id);
      if (idx !== -1) pl.trash.splice(idx, 1);
      pl.deck.push(id);
    }
    return state;
  },
};

// ─── bottomOfDeckOwnChar: send `count` own field chars matching filter to
//     bottom of deck. Default count = 1.
const bottomOfDeckOwnChar: CostHandler = {
  canPay(state, ctx, cost) {
    const value = cost['bottomOfDeckOwnChar'];
    const count = filterCostCount(value);
    const filter = filterCostFilter(value);
    const eligible = state.players[ctx.controller].field.filter((c) => matchesCardFilter(state, c, filter));
    return eligible.length >= count;
  },
  pay(state, ctx, cost) {
    const value = cost['bottomOfDeckOwnChar'];
    const count = filterCostCount(value);
    const filter = filterCostFilter(value);
    const pl = state.players[ctx.controller];
    const eligible = pl.field.filter((c) => matchesCardFilter(state, c, filter));
    if (eligible.length < count) return null;
    const picked = chosenFor(ctx, 'bottomOfDeckOwnChar', count);
    const toMove: ReadonlyArray<CardInstance | undefined> = picked !== null
      ? picked.map((id) => eligible.find((c) => c.instanceId === id))
      : eligible.slice(0, count);
    for (const inst of toMove) {
      if (inst === undefined) return null; // pick not eligible
      const idx = pl.field.findIndex((c) => c.instanceId === inst.instanceId);
      if (idx !== -1) pl.field.splice(idx, 1);
      pl.deck.push(inst.instanceId);
    }
    return state;
  },
};

// ─── selfPowerCost: "give your Leader -N power this turn" cost (e.g.
//     EB01-004 Koza). Writes a one-shot debuff onto controller's leader,
//     symmetric with the power_buff action handler at actions.ts:96-100,
//     with this_turn lifecycle (cleared by PhaseScheduler.enterEnd's
//     expiresInTurns tick). Cluster F fix.
const selfPowerCost: CostHandler = {
  canPay() {
    return true;
  },
  pay(state, ctx, cost) {
    const amount = typeof cost['selfPowerCost'] === 'number'
      ? (cost['selfPowerCost'] as number)
      : 0;
    if (amount === 0) return state;
    const leader = state.players[ctx.controller].leader;
    leader.powerModifierOneShot = (leader.powerModifierOneShot ?? 0) - amount;
    const cur = leader.powerModifierExpiresInTurns;
    leader.powerModifierExpiresInTurns = cur === undefined ? 0 : Math.max(cur, 0);
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
  costHandlers.register('returnOwnCharFilter', returnOwnCharFilter);
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
