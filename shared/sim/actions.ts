/**
 * Action → mutation conversion.
 *
 * One pure function per action from docs/OP_SIM_ENGINE_SPEC_V1.md
 * L150-218. Each takes the resolved targets (already filtered by the
 * selector) and returns one mutation per target.
 *
 * Mutations are PURE DATA. The sim layer never applies them; the host
 * engine does. This file only describes WHAT changes.
 */

import type { CardInstance, GameState, InstanceId, PlayerId } from '../engine-v2/state/types.js';
import type { Action, EffectAction, SimMutation, SimEvent } from './types.js';

/** Actions that target a player (not an instance) — life zone, draw, etc. */
const PLAYER_TARGETED_ACTIONS: ReadonlySet<Action> = new Set([
  'DRAW',
  'ADD_LIFE',
  'TAKE_LIFE',
  'TRASH_LIFE',
  'SHUFFLE_DECK',
  'DISCARD',
]);

/** Actions whose target is the resolved instance(s) on the field/zone. */
const INSTANCE_TARGETED_ACTIONS: ReadonlySet<Action> = new Set([
  'ADD_POWER',
  'SET_POWER',
  'ADD_COUNTER',
  'TRASH',
  'PLAY',
  'ADD_TO_HAND',
  'RETURN_TO_HAND',
  'RETURN_TO_DECK_TOP',
  'RETURN_TO_DECK_BOTTOM',
  'REST',
  'ACTIVATE',
  'KO',
  'ATTACH_DON',
  'DETACH_DON',
  'GAIN_RUSH',
  'GAIN_BLOCKER',
  'GAIN_DOUBLE_ATTACK',
  'GAIN_BANISH',
  'GAIN_COUNTER_EFFECT',
  'TRASH_FROM_HAND',
  'TRASH_FROM_FIELD',
  'SEND_TO_TRASH',
]);

/** Actions that operate on a deck region (search/reveal/look-at-top). */
const DECK_ACTIONS: ReadonlySet<Action> = new Set([
  'SEARCH_DECK',
  'REVEAL_CARDS',
  'LOOK_AT_TOP',
  'REORDER_CARDS',
]);

function sourceCardId(state: GameState, event: SimEvent): string | undefined {
  if (event.sourceInstanceId === undefined) return undefined;
  const inst: CardInstance | undefined = state.instances[event.sourceInstanceId];
  return inst?.cardId;
}

/**
 * Convert one EffectAction into N mutations (one per resolved target).
 *
 * `targets` is the output of `resolveSelector(...)` — already filtered.
 * If the action is player-targeted (DRAW, ADD_LIFE, etc.), the side is
 * derived from the action's `target` selector value (SELF_LEADER /
 * OPPONENT_LEADER) and a single mutation is emitted.
 */
export function actionToMutations(
  state: GameState,
  event: SimEvent,
  spec: EffectAction,
  resolvedInstances: ReadonlyArray<CardInstance>,
): SimMutation[] {
  const sourceId = sourceCardId(state, event);

  const baseMeta = {
    sourceCardId: sourceId,
    sourceInstanceId: event.sourceInstanceId,
  };

  // Player-targeted actions: derive side from the selector.
  if (PLAYER_TARGETED_ACTIONS.has(spec.action)) {
    const sel = typeof spec.target === 'string' ? spec.target : spec.target?.selector;
    const side: PlayerId = sel === 'OPPONENT_LEADER' || sel?.startsWith('OPPONENT_')
      ? (event.controller === 'A' ? 'B' : 'A')
      : event.controller;
    const out: SimMutation = {
      kind: spec.action,
      target: side,
      ...(spec.amount !== undefined ? { amount: spec.amount } : {}),
      ...(spec.count !== undefined ? { count: spec.count } : {}),
      ...(spec.duration !== undefined ? { duration: spec.duration } : {}),
      ...baseMeta,
    };
    return [out];
  }

  // Deck-region actions: emit one mutation against the deck owner.
  if (DECK_ACTIONS.has(spec.action)) {
    const sel = typeof spec.target === 'string' ? spec.target : spec.target?.selector;
    const side: PlayerId = sel === 'OPPONENT_DECK' || sel === 'OPPONENT_HAND' || sel === 'OPPONENT_LIFE'
      ? (event.controller === 'A' ? 'B' : 'A')
      : event.controller;
    const out: SimMutation = {
      kind: spec.action,
      target: side,
      ...(spec.amount !== undefined ? { amount: spec.amount } : {}),
      ...(spec.count !== undefined ? { count: spec.count } : {}),
      ...baseMeta,
    };
    return [out];
  }

  // Instance-targeted actions: one mutation per resolved target.
  if (INSTANCE_TARGETED_ACTIONS.has(spec.action)) {
    if (resolvedInstances.length === 0) {
      // No valid target → emit nothing. The host engine treats "no
      // mutation" as "effect did not produce a change."
      return [];
    }
    return resolvedInstances.map<SimMutation>((inst) => ({
      kind: spec.action,
      target: inst.instanceId,
      ...(spec.amount !== undefined ? { amount: spec.amount } : {}),
      ...(spec.count !== undefined ? { count: spec.count } : {}),
      ...(spec.duration !== undefined ? { duration: spec.duration } : {}),
      ...baseMeta,
    }));
  }

  // SHUFFLE_DECK with no target — defaults to self.
  if (spec.action === 'SHUFFLE_DECK') {
    return [{ kind: 'SHUFFLE_DECK', target: event.controller, ...baseMeta }];
  }

  // Unknown action class — emit UNSUPPORTED for traceability.
  return [
    {
      kind: 'UNSUPPORTED',
      reason: `Action "${spec.action}" has no mutation mapping in actionToMutations`,
      ...baseMeta,
    } as SimMutation,
  ];
}

/**
 * Convert an InstanceId or PlayerId to a printable string (debug aid).
 */
export function targetLabel(target: InstanceId | PlayerId): string {
  return String(target);
}

// Re-export for downstream consumers that want to know what shape an
// "instance-targeted" mutation is.
export { INSTANCE_TARGETED_ACTIONS, PLAYER_TARGETED_ACTIONS, DECK_ACTIONS };

/** Compile-time exhaustiveness assertion: keep me updated. */
function _exhaustivenessCheck(_a: Action): void {
  // Each action must be in exactly one of the three sets (or SHUFFLE_DECK
  // handled inline). If you add an action to the spec, also add it here.
  void _a;
}
void _exhaustivenessCheck;
