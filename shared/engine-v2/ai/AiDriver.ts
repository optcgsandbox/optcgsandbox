/**
 * Engine V2 — AI driver interface.
 *
 * All difficulty tiers implement this surface. The game loop / Worker
 * asks the driver "what's your next action?" when it's the AI's turn.
 *
 * V1 reference: shared/engine/ai/AiDriver.ts
 */

import type { Action } from '../protocol/actions.js';
import type { GameState, PlayerId } from '../state/types.js';

export type AiTier = 'easy' | 'medium' | 'hard' | 'expert';

export interface AiDriver {
  readonly tier: AiTier;
  /** Returns the AI's chosen action. Promise so Worker-hosted AIs can be async. */
  chooseAction(state: GameState, player: PlayerId, deadlineMs: number): Promise<Action>;
}
