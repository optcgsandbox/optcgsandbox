// Pure action → human label + group resolver for OnlinePlayfield.
//
// Discriminates on `action.type` and resolves instanceIds via the
// projected `state.instances` + `state.cardLibrary`. If an instanceId
// can't be resolved (e.g. opponent-side stub), falls back to the raw
// id rather than crashing.
//
// All 21 Action union members covered (verified against
// `shared/engine-v2/protocol/actions.ts:18-104`). Tests in
// `src/online/labelAction.test.ts` enforce one label per type.
//
// F-7k BUG-009.D/E — labels for PLAY_CARD now distinguish character vs
// event vs stage by reading the card's `kind` from the projected
// cardLibrary. Pre-fix all PLAY_CARD actions read "Play X" with no
// hint of what would happen (character to field vs event to trash vs
// stage to single-slot zone). Same fix surfaces ACTIVATE_MAIN labeling
// already in place ("Activate X").
//
// F-7k BUG-009 — `actionGroup` classifier groups legal actions for the
// human UI panel so each phase's actionable buttons are immediately
// findable (Turn / Play Characters / Play Events / Play Stage /
// Attach DON / Attack / Card Effects / Blocker Response / Counter
// Response / Trigger Response / Discard / Choose / Setup / Concede).

import type { Action } from '@shared/engine-v2/protocol/actions';
import type { PublicGameState } from '@shared/server/publicProjection';

interface CardLibEntry {
  readonly id?: string;
  readonly name?: string;
  readonly kind?: string;
}

function lookupCard(
  state: PublicGameState,
  instanceId: string,
): CardLibEntry | undefined {
  const inst = (state.instances as Record<string, { cardId?: string } | undefined>)[instanceId];
  if (inst === undefined) return undefined;
  const cardId = inst.cardId;
  if (typeof cardId !== 'string') return undefined;
  return (state.cardLibrary as Record<string, CardLibEntry | undefined>)[cardId];
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
    case 'PLAY_CARD': {
      const card = lookupCard(state, action.instanceId);
      const kind = (card?.kind ?? '').toString();
      const name = resolveName(state, action.instanceId);
      const verb =
        kind === 'event'
          ? 'Play Event'
          : kind === 'character'
            ? 'Play Character'
            : 'Play';
      const replace =
        action.replaceTargetId !== null
          ? ` (replace ${resolveName(state, action.replaceTargetId)})`
          : '';
      return `${verb}: ${name}${replace}`;
    }
    case 'PLAY_STAGE':
      return `Play Stage: ${resolveName(state, action.instanceId)}`;
    case 'ATTACH_DON':
      return `Attach DON → ${resolveName(state, action.targetInstanceId)}`;
    case 'ACTIVATE_MAIN':
      return `Activate: ${resolveName(state, action.instanceId)}`;
    case 'DECLARE_ATTACK':
      return `${resolveName(state, action.attackerInstanceId)} → ${resolveName(
        state,
        action.targetInstanceId,
      )}`;
    case 'DECLARE_BLOCKER':
      return `Block with: ${resolveName(state, action.blockerInstanceId)}`;
    case 'PLAY_COUNTER':
      return `Counter with: ${resolveName(state, action.instanceId)}`;
    case 'SKIP_COUNTER':
      return 'Skip counter';
    case 'SKIP_BLOCKER':
      return 'Skip blocker';
    case 'RESOLVE_TRIGGER': {
      const choice = action.activate ? 'Activate trigger' : 'Decline trigger';
      const target =
        action.targetInstanceId !== null
          ? ` → ${resolveName(state, action.targetInstanceId)}`
          : '';
      return `${choice}${target}`;
    }
    case 'RESOLVE_PEEK':
      return `Peek pick (${action.pickedIds.length})`;
    case 'RESOLVE_DISCARD':
      return action.pickedId !== null
        ? `Discard: ${resolveName(state, action.pickedId)}`
        : 'Discard (no pick)';
    case 'RESOLVE_CHOOSE_ONE':
      return `Choose option ${action.optionIndex + 1}`;
    case 'RESOLVE_TARGET_PICK':
      return action.pickedId !== null
        ? `Pick target ${resolveName(state, action.pickedId)}`
        : 'Choose no target';
    case 'RESOLVE_EFFECT_OFFER':
      // F-8D addendum — compile-required label only.
      return action.accept ? 'Use effect' : 'Skip effect';
    case 'RESOLVE_SEARCHER_PEEK':
      // F-8B — compile-required label only (online searcher UI is deferred).
      return action.pickedInstanceIds.length > 0
        ? `Search: take ${action.pickedInstanceIds.length}`
        : 'Search: take none';
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
 * Classify a legal action for grouped UI rendering. Stable categories
 * so the player can find the action by phase context.
 *
 * BUG-009: the prior flat 30-button list buried offensive moves,
 * response moves, and effect activations together. The picker / soak
 * harness coped fine; humans couldn't. Groups let the UI render each
 * category under a labeled section.
 */
export type ActionGroup =
  | 'Turn'
  | 'Play Characters'
  | 'Play Events'
  | 'Play Stage'
  | 'Attach DON'
  | 'Attack'
  | 'Card Effects'
  | 'Blocker Response'
  | 'Counter Response'
  | 'Trigger Response'
  | 'Discard'
  | 'Choose'
  | 'Setup'
  | 'Concede';

export function actionGroup(
  action: Action,
  state: PublicGameState,
): ActionGroup {
  switch (action.type) {
    case 'END_TURN':
      return 'Turn';
    case 'PLAY_CARD': {
      const card = lookupCard(state, action.instanceId);
      const kind = (card?.kind ?? '').toString();
      if (kind === 'event') return 'Play Events';
      return 'Play Characters';
    }
    case 'PLAY_STAGE':
      return 'Play Stage';
    case 'ATTACH_DON':
      return 'Attach DON';
    case 'DECLARE_ATTACK':
      return 'Attack';
    case 'ACTIVATE_MAIN':
      return 'Card Effects';
    case 'DECLARE_BLOCKER':
    case 'SKIP_BLOCKER':
      return 'Blocker Response';
    case 'PLAY_COUNTER':
    case 'SKIP_COUNTER':
      return 'Counter Response';
    case 'RESOLVE_TRIGGER':
      return 'Trigger Response';
    case 'RESOLVE_DISCARD':
      return 'Discard';
    case 'RESOLVE_CHOOSE_ONE':
    case 'RESOLVE_PEEK':
    case 'RESOLVE_TARGET_PICK':
      return 'Choose';
    case 'MULLIGAN':
    case 'KEEP_HAND':
    case 'ROLL_DICE':
    case 'CHOOSE_FIRST':
    case 'CHOOSE_SECOND':
      return 'Setup';
    case 'CONCEDE':
      return 'Concede';
    case 'RESOLVE_SEARCHER_PEEK':
    case 'RESOLVE_EFFECT_OFFER':
      return 'Choose';
    default: {
      const exhaustive: never = action;
      void exhaustive;
      return 'Choose';
    }
  }
}

/**
 * Recommended render-order for groups. Reactive responses come first
 * so a defender sees them at the top of the panel during a pending
 * window. Card-Effects → main-phase offense → turn → concede after.
 */
export const ACTION_GROUP_ORDER: ReadonlyArray<ActionGroup> = [
  'Blocker Response',
  'Counter Response',
  'Trigger Response',
  'Discard',
  'Choose',
  'Setup',
  'Card Effects',
  'Play Events',
  'Play Characters',
  'Play Stage',
  'Attack',
  'Attach DON',
  'Turn',
  'Concede',
];

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
      return action.pickedIds !== undefined
        ? action.pickedIds.slice()
        : action.pickedId !== null ? [action.pickedId] : [];
    default:
      return [];
  }
}
