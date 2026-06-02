/**
 * Engine V2 — reducer registration barrel.
 *
 * Call `registerAllReducers()` once at engine bootstrap (before the first
 * `applyAction` call). Registration order is irrelevant — Registry uses
 * (kind, handler) pairs and rejects duplicates.
 */

import { registerAttackFlowReducers } from './attackFlow.js';
import { registerChoiceResolveReducers } from './choiceResolve.js';
import { registerMainPhaseReducers } from './mainPhase.js';
import { registerSetupReducers } from './setup.js';
import { registerTurnFlowReducers } from './turnFlow.js';

export function registerAllReducers(): void {
  registerSetupReducers();
  registerTurnFlowReducers();
  registerMainPhaseReducers();
  registerAttackFlowReducers();
  registerChoiceResolveReducers();
}

export { applyAction } from './applyAction.js';
export type { ApplyActionResult, ApplyActionOptions } from './applyAction.js';
export { actionReducers, registerActionReducer } from './registry.js';
export type { ActionReducer } from './registry.js';
