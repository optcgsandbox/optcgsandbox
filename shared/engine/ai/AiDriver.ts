// AI driver interface. Per docs/optcg-sim/ai-architecture.md §2.
// All difficulty tiers implement the same surface; the engine asks the
// driver "what's your next action?" when it's the AI player's turn.

import type { GameState, PlayerId } from '../GameState';
import type { Action } from '../../protocol/actions';

export type AiTier = 'easy' | 'medium' | 'hard' | 'expert';

export interface AiDriver {
  readonly tier: AiTier;
  /** Returns the AI's chosen action. May Promise so AI can be Web-Worker-hosted later. */
  chooseAction(state: GameState, player: PlayerId, deadlineMs: number): Promise<Action>;
}
