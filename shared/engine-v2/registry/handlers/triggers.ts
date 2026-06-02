/**
 * Engine V2 — trigger emitters.
 *
 * Two trigger families:
 *   1. POINT triggers — fire on a single source (on_play, on_ko, when_attacking,
 *      activate_main, trigger, on_block). These are dispatched inline by the
 *      action reducer that owns the event, so the registered emitter here is
 *      a no-op (registration exists so `validateCardsAgainstRegistry` doesn't
 *      throw).
 *
 *   2. BROADCAST triggers — fire across every live source matching a scope
 *      (e.g., on_opp_play_character → every char on opp's field). The
 *      emitter walks the scope and calls EffectDispatcher.dispatch per source.
 *
 * Cross-references:
 * - Implementation spec §3.1
 * - Plan v1 §3.1 (T01-T26)
 */

import { EffectDispatcher } from '../../effects/EffectDispatcher.js';
import type {
  CardInstance,
  GameState,
  PlayerId,
} from '../../state/types.js';
import {
  type TriggerEmitter,
  triggerEmitters,
} from '../types.js';

const OTHER: Record<PlayerId, PlayerId> = { A: 'B', B: 'A' };

function liveSources(state: GameState, side: PlayerId): CardInstance[] {
  const pl = state.players[side];
  const out: CardInstance[] = [pl.leader, ...pl.field];
  if (pl.stage !== null) out.push(pl.stage);
  return out;
}

/**
 * Broadcast `triggerName` to every live source on `targetSide`. Each source
 * gets a normal EffectDispatcher.dispatch call; that call internally skips
 * any source whose effectSpecV2.clauses doesn't include the trigger.
 */
function broadcast(
  state: GameState,
  triggerName: string,
  targetSide: PlayerId,
): GameState {
  let next = state;
  for (const source of liveSources(next, targetSide)) {
    next = EffectDispatcher.dispatch(
      next,
      { sourceInstanceId: source.instanceId, controller: source.controller },
      triggerName,
    );
  }
  return next;
}

// ─── Point triggers — no-op emitters (dispatched inline by reducers)
const pointTriggerNoop: TriggerEmitter = (state) => state;

// ─── Broadcast emitters (one per relevant trigger name)
const onOppPlayCharacter: TriggerEmitter = (state, _trigger, controller) =>
  broadcast(state, 'on_opp_play_character', OTHER[controller]);

const onAnyOppCharKo: TriggerEmitter = (state, _trigger, controller) =>
  broadcast(state, 'on_any_opp_char_ko', OTHER[controller]);

const onAnyCharKo: TriggerEmitter = (state, _trigger) => {
  let next = broadcast(state, 'on_any_char_ko', 'A');
  next = broadcast(next, 'on_any_char_ko', 'B');
  return next;
};

const onLifeChanged: TriggerEmitter = (state) => {
  let next = broadcast(state, 'on_life_changed', 'A');
  next = broadcast(next, 'on_life_changed', 'B');
  return next;
};

const atStartOfGame: TriggerEmitter = (state) => {
  let next = broadcast(state, 'at_start_of_game', 'A');
  next = broadcast(next, 'at_start_of_game', 'B');
  return next;
};

const atEndOfTurnAll: TriggerEmitter = (state) => {
  let next = broadcast(state, 'at_end_of_turn', 'A');
  next = broadcast(next, 'at_end_of_turn', 'B');
  return next;
};

const atEndOfTurnSelf: TriggerEmitter = (state, _trigger, controller) =>
  broadcast(state, 'at_end_of_turn_self', controller);

const atOppRefresh: TriggerEmitter = (state, _trigger, controller) =>
  broadcast(state, 'at_opp_refresh', controller);

const onOwnDonReturned: TriggerEmitter = (state, _trigger, controller) =>
  broadcast(state, 'on_own_don_returned', controller);

const onOppAttack: TriggerEmitter = (state, _trigger, controller) =>
  broadcast(state, 'on_opp_attack', controller);

const onOppActivateEvent: TriggerEmitter = (state, _trigger, controller) =>
  broadcast(state, 'on_opp_activate_event', OTHER[controller]);

const onSelfActivateEvent: TriggerEmitter = (state, _trigger, controller) =>
  broadcast(state, 'on_self_activate_event', controller);

const onTakeDamage: TriggerEmitter = (state, _trigger, controller) =>
  broadcast(state, 'on_take_damage', controller);

const onDamageTaken: TriggerEmitter = (state, _trigger, controller) =>
  broadcast(state, 'on_damage_taken', controller);

const onHandTrashedByEffect: TriggerEmitter = (state, _trigger, controller) =>
  broadcast(state, 'on_hand_trashed_by_effect', controller);

const onBecomeRested: TriggerEmitter = (state, _trigger, controller) =>
  broadcast(state, 'on_become_rested', controller);

const onAttackDealDamage: TriggerEmitter = (state, _trigger, controller) =>
  broadcast(state, 'on_attack_deal_damage', controller);

const onOppCharBounceByMe: TriggerEmitter = (state, _trigger, controller) =>
  broadcast(state, 'on_opp_char_bounce_by_me', controller);

const onOwnCharRemovedByOppEffect: TriggerEmitter = (state, _trigger, controller) =>
  broadcast(state, 'on_own_char_removed_by_opp_effect', controller);

const onBattleKo: TriggerEmitter = (state, _trigger, controller) =>
  broadcast(state, 'on_battle_ko', controller);

// ────────────────────────────────────────────────────────────────────
// Registration — all 22 clause triggers
// ────────────────────────────────────────────────────────────────────

export function registerTriggerEmitters(): void {
  // Point triggers — emitter no-op; reducer dispatches inline
  triggerEmitters.register('on_play', pointTriggerNoop);
  triggerEmitters.register('on_ko', pointTriggerNoop);
  triggerEmitters.register('on_block', pointTriggerNoop);
  triggerEmitters.register('when_attacking', pointTriggerNoop);
  triggerEmitters.register('activate_main', pointTriggerNoop);
  triggerEmitters.register('trigger', pointTriggerNoop);

  // Broadcast triggers
  triggerEmitters.register('at_start_of_game', atStartOfGame);
  triggerEmitters.register('at_end_of_turn_self', atEndOfTurnSelf);
  triggerEmitters.register('at_end_of_turn', atEndOfTurnAll);
  triggerEmitters.register('on_opp_attack', onOppAttack);
  triggerEmitters.register('on_life_changed', onLifeChanged);
  triggerEmitters.register('on_become_rested', onBecomeRested);
  triggerEmitters.register('on_hand_trashed_by_effect', onHandTrashedByEffect);
  triggerEmitters.register('at_opp_refresh', atOppRefresh);
  triggerEmitters.register('on_damage_taken', onDamageTaken);
  triggerEmitters.register('on_own_don_returned', onOwnDonReturned);
  triggerEmitters.register('on_opp_play_character', onOppPlayCharacter);
  triggerEmitters.register('on_own_char_removed_by_opp_effect', onOwnCharRemovedByOppEffect);
  triggerEmitters.register('on_opp_activate_event', onOppActivateEvent);
  triggerEmitters.register('on_self_activate_event', onSelfActivateEvent);
  triggerEmitters.register('on_battle_ko', onBattleKo);
  triggerEmitters.register('on_take_damage', onTakeDamage);
  triggerEmitters.register('on_any_opp_char_ko', onAnyOppCharKo);
  triggerEmitters.register('on_any_char_ko', onAnyCharKo);
  triggerEmitters.register('on_opp_char_bounce_by_me', onOppCharBounceByMe);
  triggerEmitters.register('on_attack_deal_damage', onAttackDealDamage);
}
