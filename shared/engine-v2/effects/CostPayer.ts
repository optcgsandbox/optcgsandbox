/**
 * Engine V2 — cost payment façade.
 *
 * Thin wrapper over `costHandlers` registry. Each cost-key in an EffectCostV2
 * is paid independently; atomicity is the caller's concern — if any key
 * fails to pay, the caller MUST discard the partial state.
 *
 * Cross-references:
 * - Implementation spec §6 (cost slice of dispatch pipeline)
 * - Plan v1 §3.5 (21 cost keys)
 */

import { costHandlers, type HandlerCtx } from '../registry/types.js';
import type { EffectCostV2 } from '../spec/types.js';
import type { GameState } from '../state/types.js';

export const CostPayer = {
  canPay(state: GameState, ctx: HandlerCtx, cost: EffectCostV2): boolean {
    for (const key of Object.keys(cost)) {
      const handler = costHandlers.get(key);
      if (!handler.canPay(state, ctx, cost)) return false;
    }
    return true;
  },

  /**
   * Returns the new state on success, or `null` if any key failed mid-payment.
   * Caller must NOT use the partial state on null return — discard and retry.
   */
  pay(state: GameState, ctx: HandlerCtx, cost: EffectCostV2): GameState | null {
    let working = state;
    for (const key of Object.keys(cost)) {
      const handler = costHandlers.get(key);
      const next = handler.pay(working, ctx, cost);
      if (next === null) return null;
      working = next;
    }
    return working;
  },
} as const;
