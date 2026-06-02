/**
 * Engine V2 — Phase transition table.
 *
 * Encodes the next phase for every phase in the FSM. 'context' means the
 * scheduler decides at runtime based on game state (attack pending? end
 * declared? pending choice resumed?). Static transitions are enforced by
 * PhaseScheduler; runtime ones are computed by the per-phase reducer.
 *
 * Cross-references:
 * - Implementation spec §11.1
 * - Plan v1 §1.7
 */

import type { Phase } from '../state/types.js';

export type PhaseTransition = Phase | 'context';

export const PHASE_TRANSITIONS: Readonly<Record<Phase, PhaseTransition>> = {
  dice_roll: 'first_player_choice',
  first_player_choice: 'mulligan_first',
  mulligan_first: 'mulligan_second',
  mulligan_second: 'deal_life',
  deal_life: 'refresh',
  refresh: 'draw',
  draw: 'don',
  don: 'main',
  main: 'context', // → attack_declaration not in enum; main → block_window or end
  block_window: 'counter_window',
  counter_window: 'damage_resolution',
  damage_resolution: 'context', // → trigger_window | main | end
  trigger_window: 'context', // → damage_resolution | main
  peek_choice: 'context', // → pending.resumePhase
  discard_choice: 'context', // → pending.resumePhase
  choose_one: 'context', // → pending.resumePhase
  attack_target_pick: 'context', // → block_window
  end: 'refresh', // next turn
};
