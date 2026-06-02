/**
 * Engine V2 — magnitude formula evaluator.
 *
 * `magnitude` on an action can be:
 *   - number (literal): pass through
 *   - { kind: 'match_opp_don' }: opp's donCostArea.length
 *   - { kind: 'read_state', source }: source-string read
 *   - { kind: 'per_count', countSource, divisor, perUnit }:
 *       Math.floor(readCountSource(countSource) / divisor) * perUnit
 *
 * Cross-references:
 * - V1 reference: shared/engine/effectSpec/runner-v2.ts:609-650
 * - cards.json: 12 distinct formula shapes (verified via grep)
 */

import type { EffectActionV2 } from '../../spec/types.js';
import type { GameState, PlayerId } from '../../state/types.js';
import type { HandlerCtx } from '../types.js';

const OTHER: Record<PlayerId, PlayerId> = { A: 'B', B: 'A' };

function readCountSource(
  state: GameState,
  controller: PlayerId,
  source: string,
  fallback = 0,
): number {
  const me = state.players[controller];
  const opp = state.players[OTHER[controller]];
  switch (source) {
    case 'own_trash_count': return me.trash.length;
    case 'opp_trash_count': return opp.trash.length;
    case 'own_hand_count': return me.hand.length;
    case 'opp_hand_count': return opp.hand.length;
    case 'own_life_count': return me.life.length;
    case 'opp_life_count': return opp.life.length;
    case 'own_don_count': return me.donCostArea.length;
    case 'opp_don_count': return opp.donCostArea.length;
    case 'own_rested_don_count': return me.donRested.length;
    case 'own_trash_event_count': {
      // V1: count of events in own trash
      let n = 0;
      for (const id of me.trash) {
        const inst = state.instances[id];
        if (inst === undefined) continue;
        const card = state.cardLibrary[inst.cardId] as { kind?: string } | undefined;
        if (card?.kind === 'event') n += 1;
      }
      return n;
    }
    case 'cards_trashed_this_resolution': {
      // V0: not tracked yet — would require per-resolution counter. Return 0.
      return 0;
    }
    default:
      return fallback;
  }
}

/**
 * Resolve a magnitude value: literal number passes through; formula objects
 * evaluate against state.
 */
export function resolveMagnitude(
  state: GameState,
  ctx: HandlerCtx,
  raw: unknown,
  fallback = 0,
): number {
  if (typeof raw === 'number') return raw;
  if (raw === null || typeof raw !== 'object') return fallback;
  const m = raw as { kind?: unknown; [k: string]: unknown };
  if (typeof m.kind !== 'string') return fallback;

  if (m.kind === 'match_opp_don') {
    return state.players[OTHER[ctx.controller]].donCostArea.length;
  }
  if (m.kind === 'read_state') {
    const source = typeof m['source'] === 'string' ? (m['source'] as string) : '';
    return readCountSource(state, ctx.controller, source, fallback);
  }
  if (m.kind === 'per_count') {
    const source = typeof m['countSource'] === 'string' ? (m['countSource'] as string) : '';
    const divisor = typeof m['divisor'] === 'number' ? (m['divisor'] as number) : 1;
    const perUnit = typeof m['perUnit'] === 'number' ? (m['perUnit'] as number) : 0;
    const total = readCountSource(state, ctx.controller, source, 0);
    if (divisor === 0) return fallback;
    return Math.floor(total / divisor) * perUnit;
  }
  return fallback;
}

/**
 * Canonical "how many" reader that ALSO understands formula objects.
 * Replaces the simpler count() in action handlers when the action's
 * magnitude can be a formula (most can).
 */
export function resolveCount(
  state: GameState,
  ctx: HandlerCtx,
  action: EffectActionV2,
  fallback = 0,
): number {
  const m = action['magnitude'];
  if (m !== undefined) return resolveMagnitude(state, ctx, m, fallback);
  const c = action['count'];
  if (typeof c === 'number') return c;
  const n = action['n'];
  if (typeof n === 'number') return n;
  return fallback;
}
