// Pure action → human label resolver for OnlinePlayfield.
//
// Discriminates on `action.type` and resolves instanceIds via the
// projected `state.instances` + `state.cardLibrary`. If an instanceId
// can't be resolved (e.g. opponent-side stub), falls back to the raw
// id rather than crashing.
//
// All 21 Action union members covered (verified against
// `shared/engine-v2/protocol/actions.ts:18-104`). Tests in
// `src/online/labelAction.test.ts` enforce one label per type.

import type { Action } from '@shared/engine-v2/protocol/actions';
import type { PublicGameState } from '@shared/server/publicProjection';

interface CardLibEntry {
  readonly id?: string;
  readonly name?: string;
}

function resolveName(state: PublicGameState, instanceId: string): string {
  const inst = (state.instances as Record<string, { cardId?: string } | undefined>)[instanceId];
  if (inst === undefined) return instanceId;
  const cardId = inst.cardId;
  if (typeof cardId !== 'string') return instanceId;
  const card = (state.cardLibrary as Record<string, CardLibEntry | undefined>)[cardId];
  if (card !== undefined && typeof card.name === 'string') {
    return `${card.name} (${cardId})`;
  }
  return cardId;
}

/**
 * Produce a short, human-readable label for a legal action. Always
 * returns a non-empty string; never throws on missing data.
 */
export function labelAction(action: Action, state: PublicGameState): string {
  switch (action.type) {
    case 'CONCEDE':
      return 'Concede';
    case 'END_TURN':
      return 'End Turn';
    case 'ROLL_DICE':
      return `Roll dice (player ${action.player})`;
    case 'CHOOSE_FIRST':
      return 'Choose: go first';
    case 'CHOOSE_SECOND':
      return 'Choose: go second';
    case 'MULLIGAN':
      return 'Mulligan';
    case 'KEEP_HAND':
      return 'Keep hand';
    case 'PLAY_CARD':
      return `Play ${resolveName(state, action.instanceId)}${
        action.replaceTargetId !== null
          ? ` (replace ${resolveName(state, action.replaceTargetId)})`
          : ''
      }`;
    case 'PLAY_STAGE':
      return `Play stage ${resolveName(state, action.instanceId)}`;
    case 'ATTACH_DON':
      return `Attach DON → ${resolveName(state, action.targetInstanceId)}`;
    case 'ACTIVATE_MAIN':
      return `Activate ${resolveName(state, action.instanceId)}`;
    case 'DECLARE_ATTACK':
      return `${resolveName(state, action.attackerInstanceId)} → ${resolveName(
        state,
        action.targetInstanceId,
      )}`;
    case 'DECLARE_BLOCKER':
      return `Block with ${resolveName(state, action.blockerInstanceId)}`;
    case 'PLAY_COUNTER':
      return `Counter with ${resolveName(state, action.instanceId)}`;
    case 'SKIP_COUNTER':
      return 'Skip counter';
    case 'SKIP_BLOCKER':
      return 'Skip blocker';
    case 'RESOLVE_TRIGGER': {
      const choice = action.activate ? 'activate' : 'skip';
      const target =
        action.targetInstanceId !== null
          ? ` → ${resolveName(state, action.targetInstanceId)}`
          : '';
      return `Trigger: ${choice}${target}`;
    }
    case 'RESOLVE_PEEK':
      return `Peek pick (${action.pickedIds.length})`;
    case 'RESOLVE_DISCARD':
      return action.pickedId !== null
        ? `Discard ${resolveName(state, action.pickedId)}`
        : 'Discard (no pick)';
    case 'RESOLVE_CHOOSE_ONE':
      return `Choose option ${action.optionIndex + 1}`;
    case 'RESOLVE_TARGET_PICK':
      return `Pick target ${resolveName(state, action.pickedId)}`;
    default: {
      // Exhaustiveness guard. If a new action type lands without a label
      // here, surface a clear "fallback" rather than crashing.
      const exhaustive: never = action;
      return `(unlabeled ${
        (exhaustive as { type?: string }).type ?? 'unknown'
      })`;
    }
  }
}

/**
 * Whether the labeler could resolve every instanceId referenced by
 * `action` against the projected state. Returns `true` when:
 *   - the action carries no instanceId, or
 *   - every instanceId it carries is in `state.instances`.
 * Used by the UI to warn (not block) on unresolved ids — clicking still
 * sends the exact action; only the label is degraded.
 */
export function actionResolvesCleanly(
  action: Action,
  state: PublicGameState,
): boolean {
  const instances = state.instances as Record<string, unknown>;
  const ids = collectInstanceIds(action);
  for (const id of ids) {
    if (instances[id] === undefined) return false;
  }
  return true;
}

function collectInstanceIds(action: Action): ReadonlyArray<string> {
  switch (action.type) {
    case 'PLAY_CARD':
      return action.replaceTargetId !== null
        ? [action.instanceId, action.replaceTargetId]
        : [action.instanceId];
    case 'PLAY_STAGE':
    case 'ACTIVATE_MAIN':
    case 'PLAY_COUNTER':
      return [action.instanceId];
    case 'ATTACH_DON':
      return [action.targetInstanceId];
    case 'DECLARE_ATTACK':
      return [action.attackerInstanceId, action.targetInstanceId];
    case 'DECLARE_BLOCKER':
      return [action.blockerInstanceId];
    case 'RESOLVE_TRIGGER':
      return action.targetInstanceId !== null ? [action.targetInstanceId] : [];
    case 'RESOLVE_PEEK':
      return action.pickedIds.slice();
    case 'RESOLVE_DISCARD':
      return action.pickedId !== null ? [action.pickedId] : [];
    case 'RESOLVE_TARGET_PICK':
      return [action.pickedId];
    default:
      return [];
  }
}
