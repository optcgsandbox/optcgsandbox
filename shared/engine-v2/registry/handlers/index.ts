/**
 * Engine V2 — handler-registration barrel.
 *
 * Call `registerAllHandlers()` once at engine bootstrap (BEFORE the first
 * `applyAction` call AND before `validateCardsAgainstRegistry`).
 */

import { registerActionHandlers } from './actions.js';
import { registerConditionHandlers } from './conditions.js';
import { registerTargetResolvers } from './targets.js';

export function registerAllHandlers(): void {
  registerConditionHandlers();
  registerTargetResolvers();
  registerActionHandlers();
  // TODO: triggers.ts (22 trigger emitters)
  // TODO: costs.ts (21 cost handlers)
  // TODO: continuous.ts (18 continuous handlers)
  // TODO: replacements.ts (4 replacement triggers)
  // Remaining actions to register: peek, choose_one, search_deck,
  //   transfer_attached_don, set_active_don, return_opp_don_to_deck,
  //   play_for_free, recursion (trash→hand), shuffle_hand_to_deck, etc.
}
