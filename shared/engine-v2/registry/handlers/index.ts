/**
 * Engine V2 — handler-registration barrel.
 *
 * Call `registerAllHandlers()` once at engine bootstrap (BEFORE the first
 * `applyAction` call AND before `validateCardsAgainstRegistry`).
 */

import { registerActionHandlers } from './actions.js';
import { registerConditionHandlers } from './conditions.js';
import { registerContinuousHandlers } from './continuous.js';
import { registerCostHandlers } from './costs.js';
import { registerReplacementHandlers } from './replacements.js';
import { registerTargetResolvers } from './targets.js';
import { registerTriggerEmitters } from './triggers.js';

export function registerAllHandlers(): void {
  registerConditionHandlers();
  registerTargetResolvers();
  registerActionHandlers();
  registerTriggerEmitters();
  registerCostHandlers();
  registerContinuousHandlers();
  registerReplacementHandlers();
  // Remaining actions to register: peek, choose_one, search_deck,
  //   transfer_attached_don, set_active_don, return_opp_don_to_deck,
  //   play_for_free, recursion (trash→hand), shuffle_hand_to_deck, etc.
}
