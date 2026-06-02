/**
 * Engine V2 — main-phase reducers.
 *
 * Per-action reducers for the main-phase actions: ATTACH_DON, PLAY_CARD,
 * PLAY_STAGE, ACTIVATE_MAIN. Each one:
 *   1. Validates phase + player + target legality
 *   2. Mutates working state
 *   3. Emits history events
 *   4. Refold is handled by `applyAction` (top-level wrap)
 *
 * Cross-references:
 * - Implementation spec §6.3 + §5.6
 * - Plan v1 §4.7 (C10, C11)
 */

import { EffectDispatcher } from '../effects/EffectDispatcher.js';
import type {
  ActionActivateMain,
  ActionAttachDon,
  ActionPlayCard,
  ActionPlayStage,
} from '../protocol/actions.js';
import { detachAllAttachedDon } from '../state/derived/don.js';
import { resetInstanceTransientState } from '../state/derived/reset.js';
import {
  type CardInstance,
  FIELD_CAP,
  type GameState,
  type PlayerId,
} from '../state/types.js';
import type { Card } from '../cards/Card.js';
import { isCharacter, isStage } from '../cards/Card.js';
import { registerActionReducer } from './registry.js';

function activeMainGuard(state: GameState, player: PlayerId): boolean {
  return (
    state.activePlayer === player &&
    state.phase === 'main' &&
    state.pending === null &&
    state.result === null
  );
}

function lookupCard(state: GameState, inst: CardInstance): Card | undefined {
  return state.cardLibrary[inst.cardId] as Card | undefined;
}

// ─── ATTACH_DON
// Move 1 DON from active-player's donCostArea → target's attachedDon.
// Target must be a character on active player's field (or their leader).
function attachDonReducer(
  state: GameState,
  action: ActionAttachDon,
  player: PlayerId,
): GameState {
  if (!activeMainGuard(state, player)) return state;
  const pl = state.players[player];
  if (pl.donCostArea.length === 0) return state;

  // Resolve target — must be active-player's leader OR a character on field.
  const target = state.instances[action.targetInstanceId];
  if (target === undefined) return state;
  if (target.controller !== player) return state;
  const onField =
    pl.leader.instanceId === target.instanceId ||
    pl.field.some((c) => c.instanceId === target.instanceId);
  if (!onField) return state;

  // Move 1 DON.
  const donId = pl.donCostArea.shift();
  if (donId === undefined) return state;
  target.attachedDon.push(donId);

  (state.history as Array<unknown>).push({
    type: 'DON_ATTACHED',
    targetInstanceId: target.instanceId,
    donInstanceId: donId,
    controller: player,
  });
  return state;
}

// ─── PLAY_CARD (Character)
// 1. Validate it's a character in hand.
// 2. Validate player can pay don cost.
// 3. If field at cap, validate replaceTargetId is on player's field.
// 4. Pay don cost.
// 5. Move card hand → field (or replace).
// 6. Reset transient state; set summoningSick = true.
// 7. Fire on_play.
function playCardReducer(
  state: GameState,
  action: ActionPlayCard,
  player: PlayerId,
): GameState {
  if (!activeMainGuard(state, player)) return state;
  const pl = state.players[player];
  const inst = state.instances[action.instanceId];
  if (inst === undefined) return state;
  if (inst.controller !== player) return state;
  if (!pl.hand.includes(inst.instanceId)) return state;

  const card = lookupCard(state, inst);
  if (card === undefined) return state;
  if (!isCharacter(card)) return state;

  // Cost
  const donAvailable = pl.donCostArea.length;
  const cost = Math.max(0, card.cost + (pl.nextPlayCostModifier ?? 0));
  if (donAvailable < cost) return state;

  // Field cap check + replace
  const charCount = pl.field.length;
  if (charCount >= FIELD_CAP) {
    if (action.replaceTargetId === null) return state;
    const replaceIdx = pl.field.findIndex((c) => c.instanceId === action.replaceTargetId);
    if (replaceIdx === -1) return state;
    const removed = pl.field[replaceIdx]!;
    detachAllAttachedDon(state, removed, player);
    pl.field.splice(replaceIdx, 1);
    pl.trash.push(removed.instanceId);
    (state.history as Array<unknown>).push({
      type: 'CARD_TRASHED_BY_RULE',
      instanceId: removed.instanceId,
      reason: 'field_cap_replace',
    });
  }

  // Pay DON (cost area → rested DON pile)
  for (let i = 0; i < cost; i++) {
    const id = pl.donCostArea.shift();
    if (id !== undefined) pl.donRested.push(id);
  }

  // Move hand → field
  const handIdx = pl.hand.indexOf(inst.instanceId);
  pl.hand.splice(handIdx, 1);
  resetInstanceTransientState(inst);
  inst.summoningSick = true;
  inst.rested = false;
  pl.field.push(inst);

  // Clear single-shot play-cost modifier
  pl.nextPlayCostModifier = undefined;

  (state.history as Array<unknown>).push({
    type: 'CHARACTER_PLAYED',
    instanceId: inst.instanceId,
    cardId: inst.cardId,
    controller: player,
    cost,
  });

  // Fire on_play
  return EffectDispatcher.dispatch(state, {
    sourceInstanceId: inst.instanceId,
    controller: player,
  }, 'on_play');
}

// ─── PLAY_STAGE
// Single-slot zone; playing a new stage trashes the existing one (CR §3-8-5-1).
function playStageReducer(
  state: GameState,
  action: ActionPlayStage,
  player: PlayerId,
): GameState {
  if (!activeMainGuard(state, player)) return state;
  const pl = state.players[player];
  const inst = state.instances[action.instanceId];
  if (inst === undefined) return state;
  if (inst.controller !== player) return state;
  if (!pl.hand.includes(inst.instanceId)) return state;

  const card = lookupCard(state, inst);
  if (card === undefined || !isStage(card)) return state;

  const cost = Math.max(0, card.cost + (pl.nextPlayCostModifier ?? 0));
  if (pl.donCostArea.length < cost) return state;

  // Trash existing stage if any
  if (pl.stage !== null) {
    const old = pl.stage;
    detachAllAttachedDon(state, old, player);
    pl.trash.push(old.instanceId);
    pl.stage = null;
    (state.history as Array<unknown>).push({
      type: 'STAGE_TRASHED_BY_RULE',
      instanceId: old.instanceId,
    });
  }

  // Pay cost
  for (let i = 0; i < cost; i++) {
    const id = pl.donCostArea.shift();
    if (id !== undefined) pl.donRested.push(id);
  }

  // Move hand → stage
  const handIdx = pl.hand.indexOf(inst.instanceId);
  pl.hand.splice(handIdx, 1);
  resetInstanceTransientState(inst);
  pl.stage = inst;
  pl.nextPlayCostModifier = undefined;

  (state.history as Array<unknown>).push({
    type: 'STAGE_PLAYED',
    instanceId: inst.instanceId,
    cardId: inst.cardId,
    controller: player,
    cost,
  });

  return EffectDispatcher.dispatch(state, {
    sourceInstanceId: inst.instanceId,
    controller: player,
  }, 'on_play');
}

// ─── ACTIVATE_MAIN
// Fire activate_main clauses on an on-field source. Eligible: leader, field
// characters, stage. Source must not be summoning-sick (per CR §6-4-2 leaders
// excepted from sickness; characters checked).
function activateMainReducer(
  state: GameState,
  action: ActionActivateMain,
  player: PlayerId,
): GameState {
  if (!activeMainGuard(state, player)) return state;
  const pl = state.players[player];
  const inst = state.instances[action.instanceId];
  if (inst === undefined) return state;
  if (inst.controller !== player) return state;

  const isLeader = pl.leader.instanceId === inst.instanceId;
  const isOnField = pl.field.some((c) => c.instanceId === inst.instanceId);
  const isOnStage = pl.stage?.instanceId === inst.instanceId;
  if (!isLeader && !isOnField && !isOnStage) return state;

  // Summoning sickness only blocks characters' attacks, not their activate_main
  // (per CR §6-4-2 — activate_main works on the turn played). No guard needed.

  return EffectDispatcher.dispatch(state, {
    sourceInstanceId: inst.instanceId,
    controller: player,
  }, 'activate_main');
}

export function registerMainPhaseReducers(): void {
  registerActionReducer('ATTACH_DON', attachDonReducer);
  registerActionReducer('PLAY_CARD', playCardReducer);
  registerActionReducer('PLAY_STAGE', playStageReducer);
  registerActionReducer('ACTIVATE_MAIN', activateMainReducer);
}
