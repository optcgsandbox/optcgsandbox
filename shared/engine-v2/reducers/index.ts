/**
 * Engine V2 — reducer registration barrel.
 *
 * Call `registerAllReducers()` once at engine bootstrap (before the first
 * `applyAction` call). Registration order is irrelevant — Registry uses
 * (kind, handler) pairs and rejects duplicates.
 */

import { registerAttackFlowReducers } from './attackFlow.js';
import { registerMainPhaseReducers } from './mainPhase.js';
import { registerTurnFlowReducers } from './turnFlow.js';

export function registerAllReducers(): void {
  registerTurnFlowReducers();
  registerMainPhaseReducers();
  registerAttackFlowReducers();
  // TODO: choiceResolve.ts (RESOLVE_TRIGGER, RESOLVE_PEEK, RESOLVE_DISCARD,
  //       RESOLVE_CHOOSE_ONE, RESOLVE_TARGET_PICK)
  // TODO: setup.ts (ROLL_DICE, CHOOSE_FIRST, CHOOSE_SECOND, MULLIGAN, KEEP_HAND)
}

export { applyAction } from './applyAction.js';
export type { ApplyActionResult, ApplyActionOptions } from './applyAction.js';
export { actionReducers, registerActionReducer } from './registry.js';
export type { ActionReducer } from './registry.js';
