/**
 * Engine V2 — handler-registration barrel.
 *
 * Call `registerAllHandlers()` once at engine bootstrap (BEFORE the first
 * `applyAction` call AND before `validateCardsAgainstRegistry`).
 */

import { registerActionHandlers } from './actions.js';
import { registerActionHandlers2 } from './actions2.js';
import { registerActionHandlers3 } from './actions3.js';
import { registerConditionHandlers } from './conditions.js';
import { registerConditionHandlers2 } from './conditions2.js';
import { registerContinuousHandlers } from './continuous.js';
import { registerContinuousHandlers2 } from './continuous2.js';
import { registerCostHandlers } from './costs.js';
import { registerCostHandlers2 } from './costs2.js';
import { registerReplacementHandlers } from './replacements.js';
import { registerTargetResolvers } from './targets.js';
import { registerTargetResolvers2 } from './targets2.js';
import { registerTriggerEmitters } from './triggers.js';

export function registerAllHandlers(): void {
  registerConditionHandlers();
  registerConditionHandlers2();
  registerTargetResolvers();
  registerTargetResolvers2();
  registerActionHandlers();
  registerActionHandlers2();
  registerActionHandlers3();
  registerTriggerEmitters();
  registerCostHandlers();
  registerCostHandlers2();
  registerContinuousHandlers();
  registerContinuousHandlers2();
  registerReplacementHandlers();
  // Remaining actions to register: peek, choose_one, search_deck,
  //   transfer_attached_don, set_active_don, return_opp_don_to_deck,
  //   play_for_free, recursion (trash→hand), shuffle_hand_to_deck, etc.
}
