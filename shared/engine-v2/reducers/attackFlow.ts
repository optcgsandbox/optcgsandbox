/**
 * Engine V2 — attack-flow reducers.
 *
 * Phase chain: main → block_window → counter_window → damage_resolution
 *   → (trigger_window if life flipped) → back to main.
 *
 * Per-action reducers:
 *   - DECLARE_ATTACK    (main → block_window): set up PendingAttack
 *   - DECLARE_BLOCKER   (block_window → counter_window): redirect target
 *   - SKIP_BLOCKER      (block_window → counter_window)
 *   - PLAY_COUNTER      (counter_window): counter event from hand; stay in
 *                        counter_window for chain (re-enters until SKIP)
 *   - SKIP_COUNTER      (counter_window → damage_resolution): resolve damage
 *
 * Single source of truth for clearing PendingAttack: `clearPendingAttack`.
 * Single source of truth for detaching DON on KO: `detachAllAttachedDon`.
 *
 * Cross-references:
 * - Implementation spec §9 (counter-window)
 * - Plan v1 §4.3 + §4.5
 * - CR §7-1 / §7-2 / §7-3
 */

import type { Card } from '../cards/Card.js';
import { isCharacter, isEvent, isLeader } from '../cards/Card.js';
import { EffectDispatcher } from '../effects/EffectDispatcher.js';
import { ReplacementManager } from '../effects/ReplacementManager.js';
import { triggerEmitters } from '../registry/types.js';
import { safeProcessSimEvent } from '../../sim/integrate.js';
import type {
  ActionDeclareAttack,
  ActionDeclareBlocker,
  ActionPlayCounter,
  ActionSkipBlocker,
  ActionSkipCounter,
} from '../protocol/actions.js';
import { detachAllAttachedDon } from '../state/derived/don.js';
import {
  instAttackLocked,
  instHasKeyword,
} from '../state/derived/keyword.js';
import { effectivePower } from '../state/derived/power.js';
import { resetInstanceTransientState } from '../state/derived/reset.js';
import {
  type CardInstance,
  type GameState,
  OTHER_PLAYER,
  type PlayerId,
} from '../state/types.js';
import { registerActionReducer } from './registry.js';

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function clearPendingAttack(state: GameState): GameState {
  if (state.pending === null || state.pending.kind !== 'attack') return state;
  for (const side of ['A', 'B'] as PlayerId[]) {
    const pl = state.players[side];
    pl.leader.powerModifierThisBattle = undefined;
    for (const inst of pl.field) inst.powerModifierThisBattle = undefined;
    if (pl.stage !== null) pl.stage.powerModifierThisBattle = undefined;
  }
  state.pending = null;
  return state;
}

function koCharacter(state: GameState, target: CardInstance, side: PlayerId): GameState {
  // Replacement: would_be_ko (battle-source).
  const repl = ReplacementManager.tryReplace(
    state,
    { sourceInstanceId: target.instanceId, controller: side, source: 'battle' },
    'would_be_ko',
  );
  let next = repl.state;
  if (repl.replaced) {
    (next.history as Array<unknown>).push({
      type: 'KO_REPLACED',
      instanceId: target.instanceId,
      reason: 'would_be_ko_battle',
    });
    return next;
  }

  const pl = next.players[side];
  const idx = pl.field.findIndex((c) => c.instanceId === target.instanceId);
  if (idx === -1) return next;
  detachAllAttachedDon(next, target, side);
  pl.field.splice(idx, 1);
  pl.trash.push(target.instanceId);
  // Track the KO source so on_ko clauses + conditions like
  // if_self_kod_by_opp_effect can distinguish battle vs effect KO
  // (mirrors removal_ko pattern at registry/handlers/actions.ts:170-173).
  next.koSourceStack.push({
    instanceId: target.instanceId,
    source: 'battle',
  });
  (next.history as Array<unknown>).push({
    type: 'CHARACTER_KOD',
    instanceId: target.instanceId,
    controller: side,
  });
  // Fire on_ko on the KO'd character (before reset so it can read attached DON).
  next = EffectDispatcher.dispatch(next, {
    sourceInstanceId: target.instanceId,
    controller: side,
  }, 'on_ko');
  next = safeProcessSimEvent(next, { sourceInstanceId: target.instanceId, controller: side }, 'on_ko');
  resetInstanceTransientState(target);
  // Broadcast on_battle_ko + on_any_char_ko / on_any_opp_char_ko.
  if (triggerEmitters.has('on_battle_ko')) {
    next = triggerEmitters.get('on_battle_ko')(next, { kind: 'on_battle_ko' }, side);
  }
  if (triggerEmitters.has('on_any_char_ko')) {
    next = triggerEmitters.get('on_any_char_ko')(next, { kind: 'on_any_char_ko' }, side);
  }
  const opp = OTHER_PLAYER[side];
  if (triggerEmitters.has('on_any_opp_char_ko')) {
    next = triggerEmitters.get('on_any_opp_char_ko')(next, { kind: 'on_any_opp_char_ko' }, opp);
  }
  return next;
}

function flipTopLifeToHand(state: GameState, side: PlayerId): {
  state: GameState;
  flippedInstanceId: string | null;
} {
  // Replacement: would_take_damage (damage to leader).
  const repl = ReplacementManager.tryReplace(
    state,
    {
      sourceInstanceId: state.players[side].leader.instanceId,
      controller: side,
      source: 'battle',
    },
    'would_take_damage',
  );
  if (repl.replaced) {
    (repl.state.history as Array<unknown>).push({
      type: 'DAMAGE_REPLACED',
      side,
    });
    return { state: repl.state, flippedInstanceId: null };
  }

  const pl = repl.state.players[side];
  const top = pl.life.shift();
  if (top === undefined) {
    repl.state.result = { loser: side, reason: 'life_zero' };
    return { state: repl.state, flippedInstanceId: null };
  }
  pl.hand.push(top);
  let next = repl.state;
  (next.history as Array<unknown>).push({
    type: 'LIFE_CARD_TO_HAND',
    instanceId: top,
    controller: side,
  });
  // Broadcast on_life_changed (both sides) + on_take_damage (defender) +
  // on_damage_taken (defender).
  if (triggerEmitters.has('on_life_changed')) {
    next = triggerEmitters.get('on_life_changed')(next, { kind: 'on_life_changed' }, side);
  }
  if (triggerEmitters.has('on_take_damage')) {
    next = triggerEmitters.get('on_take_damage')(next, { kind: 'on_take_damage' }, side);
  }
  if (triggerEmitters.has('on_damage_taken')) {
    next = triggerEmitters.get('on_damage_taken')(next, { kind: 'on_damage_taken' }, side);
  }
  return { state: next, flippedInstanceId: top };
}

// ────────────────────────────────────────────────────────────────────
// DECLARE_ATTACK
// ────────────────────────────────────────────────────────────────────

function declareAttackReducer(
  state: GameState,
  action: ActionDeclareAttack,
  player: PlayerId,
): GameState {
  if (state.activePlayer !== player) return state;
  if (state.phase !== 'main') return state;
  if (state.pending !== null) return state;

  // Attacker must be controller's leader or active field char.
  const pl = state.players[player];
  const attackerInst =
    pl.leader.instanceId === action.attackerInstanceId
      ? pl.leader
      : pl.field.find((c) => c.instanceId === action.attackerInstanceId);
  if (attackerInst === undefined) return state;
  if (attackerInst.rested === true) return state;
  if (attackerInst.summoningSick === true && !instHasKeyword(state, attackerInst, 'rush')) {
    return state;
  }
  if (attackerInst.perTurn.hasAttacked === true) return state;
  if (instAttackLocked(attackerInst)) return state;

  // Target must be opp's leader or a rested opp character.
  const opp = OTHER_PLAYER[player];
  const oppZ = state.players[opp];
  const targetInst =
    oppZ.leader.instanceId === action.targetInstanceId
      ? oppZ.leader
      : oppZ.field.find(
          (c) =>
            c.instanceId === action.targetInstanceId && c.rested === true,
        );
  if (targetInst === undefined) return state;

  // Rest the attacker.
  attackerInst.rested = true;
  attackerInst.perTurn.hasAttacked = true;

  // Set PendingAttack + phase.
  state.pending = {
    kind: 'attack',
    pendingAttack: {
      attackerInstanceId: attackerInst.instanceId,
      targetInstanceId: targetInst.instanceId,
      counterBoost: 0,
      armedReplacements: [],
    },
  };
  state.phase = 'block_window';

  (state.history as Array<unknown>).push({
    type: 'ATTACK_DECLARED',
    attackerInstanceId: attackerInst.instanceId,
    targetInstanceId: targetInst.instanceId,
    controller: player,
  });

  // Fire when_attacking clauses on the attacker.
  let next = EffectDispatcher.dispatch(state, {
    sourceInstanceId: attackerInst.instanceId,
    controller: player,
  }, 'when_attacking');
  next = safeProcessSimEvent(next, { sourceInstanceId: attackerInst.instanceId, controller: player, attackingInstanceId: attackerInst.instanceId }, 'when_attacking');
  // Broadcast on_opp_attack to defender's live sources.
  if (triggerEmitters.has('on_opp_attack')) {
    next = triggerEmitters.get('on_opp_attack')(next, { kind: 'on_opp_attack' }, OTHER_PLAYER[player]);
  }
  return next;
}

// ────────────────────────────────────────────────────────────────────
// DECLARE_BLOCKER
// ────────────────────────────────────────────────────────────────────

function declareBlockerReducer(
  state: GameState,
  action: ActionDeclareBlocker,
  player: PlayerId,
): GameState {
  if (state.phase !== 'block_window') return state;
  if (state.pending === null || state.pending.kind !== 'attack') return state;
  // Only defender (non-active player) blocks.
  if (state.activePlayer === player) return state;

  const pl = state.players[player];
  const blocker = pl.field.find((c) => c.instanceId === action.blockerInstanceId);
  if (blocker === undefined) return state;
  if (blocker.rested === true) return state;
  if (!instHasKeyword(state, blocker, 'blocker')) return state;

  // Redirect the attack onto the blocker.
  state.pending.pendingAttack.targetInstanceId = blocker.instanceId;
  blocker.rested = true;
  state.phase = 'counter_window';

  (state.history as Array<unknown>).push({
    type: 'BLOCKER_DECLARED',
    blockerInstanceId: blocker.instanceId,
    controller: player,
  });

  // Fire on_block clauses on the blocker.
  {
    const next = EffectDispatcher.dispatch(state, {
      sourceInstanceId: blocker.instanceId,
      controller: player,
    }, 'on_block');
    return safeProcessSimEvent(next, { sourceInstanceId: blocker.instanceId, controller: player }, 'on_block');
  }
}

// ────────────────────────────────────────────────────────────────────
// SKIP_BLOCKER
// ────────────────────────────────────────────────────────────────────

function skipBlockerReducer(
  state: GameState,
  _action: ActionSkipBlocker,
  player: PlayerId,
): GameState {
  if (state.phase !== 'block_window') return state;
  if (state.pending === null || state.pending.kind !== 'attack') return state;
  if (state.activePlayer === player) return state;
  state.phase = 'counter_window';
  return state;
}

// ────────────────────────────────────────────────────────────────────
// PLAY_COUNTER (counter event from hand)
// ────────────────────────────────────────────────────────────────────

function playCounterReducer(
  state: GameState,
  action: ActionPlayCounter,
  player: PlayerId,
): GameState {
  if (state.phase !== 'counter_window') return state;
  if (state.pending === null || state.pending.kind !== 'attack') return state;
  if (state.activePlayer === player) return state; // only defender

  const pl = state.players[player];
  if (!pl.hand.includes(action.instanceId)) return state;
  const inst = state.instances[action.instanceId];
  if (inst === undefined) return state;
  const card = state.cardLibrary[inst.cardId] as Card | undefined;
  if (card === undefined) return state;

  // Two counter paths per OPTCG CR §8-6:
  //   1. Counter event — pay DON cost, trash, apply counterEventBoost, fire on_play.
  //   2. Any other card with counterValue > 0 — no cost, trash, apply counterValue.
  // Both consume the hand card and boost the pending attack's defender power.
  const isEventCard = isEvent(card);
  if (isEventCard) {
    // Cost — honor nextPlayCostModifier scope (matches mainPhase event path).
    let modifier = pl.nextPlayCostModifier ?? 0;
    const scope = pl.nextPlayCostModifierScope;
    if (scope !== undefined) {
      const s = scope as { cardName?: unknown; costMin?: unknown; costMax?: unknown };
      let matches = true;
      if (typeof s.cardName === 'string' && card.name !== s.cardName) matches = false;
      if (matches && typeof s.costMin === 'number' && card.cost < (s.costMin as number)) matches = false;
      if (matches && typeof s.costMax === 'number' && card.cost > (s.costMax as number)) matches = false;
      if (!matches) modifier = 0;
    }
    const cost = Math.max(0, card.cost + modifier);
    if (pl.donCostArea.length < cost) return state;
    for (let i = 0; i < cost; i++) {
      const id = pl.donCostArea.shift();
      if (id !== undefined) pl.donRested.push(id);
    }
    pl.nextPlayCostModifier = undefined;
    pl.nextPlayCostModifierScope = undefined;

    // hand → trash.
    const handIdx = pl.hand.indexOf(action.instanceId);
    pl.hand.splice(handIdx, 1);
    pl.trash.push(action.instanceId);

    const boost = card.counterEventBoost ?? 0;
    if (boost > 0) state.pending.pendingAttack.counterBoost += boost;

    (state.history as Array<unknown>).push({
      type: 'COUNTER_PLAYED',
      instanceId: action.instanceId,
      controller: player,
      boost,
    });

    // Arm event's replacements (Plan §4.3 step 7) onto BOTH the battle-scoped
    // pendingAttack.armedReplacements AND the turn-scoped pl.armedReplacementsThisTurn.
    // Counter events with would_be_ko / would_take_damage replacements (e.g.,
    // EB02-030) silently fizzled without this step.
    const reps = (card.effectSpecV2?.replacements ?? []) as ReadonlyArray<unknown>;
    if (reps.length > 0) {
      const pa = state.pending.pendingAttack;
      const battleList = pa.armedReplacements ?? [];
      const turnList = pl.armedReplacementsThisTurn ?? [];
      for (let idx = 0; idx < reps.length; idx++) {
        const armed = {
          replacement: reps[idx],
          sourceInstanceId: action.instanceId,
          controller: player,
          cardReplacementIndex: idx,
        };
        battleList.push(armed);
        turnList.push(armed);
      }
      pa.armedReplacements = battleList;
      pl.armedReplacementsThisTurn = turnList;
    }

    // Fire on_play, then broadcast event-activation (mirrors mainPhase event path).
    let next = EffectDispatcher.dispatch(state, {
      sourceInstanceId: action.instanceId,
      controller: player,
    }, 'on_play');
    next = safeProcessSimEvent(next, { sourceInstanceId: action.instanceId, controller: player }, 'on_play');
    if (triggerEmitters.has('on_self_activate_event')) {
      const emitter = triggerEmitters.get('on_self_activate_event');
      next = emitter(next, { kind: 'on_self_activate_event' }, player);
    }
    if (triggerEmitters.has('on_opp_activate_event')) {
      const emitter = triggerEmitters.get('on_opp_activate_event');
      next = emitter(next, { kind: 'on_opp_activate_event' }, player);
    }
    return next;
  }

  // Non-event counter: discard for printed counterValue. No DON cost.
  const counterValue = card.counterValue ?? 0;
  if (counterValue <= 0) return state;

  const handIdx = pl.hand.indexOf(action.instanceId);
  pl.hand.splice(handIdx, 1);
  pl.trash.push(action.instanceId);

  state.pending.pendingAttack.counterBoost += counterValue;

  (state.history as Array<unknown>).push({
    type: 'COUNTER_PLAYED',
    instanceId: action.instanceId,
    controller: player,
    boost: counterValue,
  });
  return state;
}

// ────────────────────────────────────────────────────────────────────
// SKIP_COUNTER → damage_resolution → trigger_window or back to main
// ────────────────────────────────────────────────────────────────────

function resolveDamage(state: GameState, defender: PlayerId): GameState {
  const pa = state.pending !== null && state.pending.kind === 'attack'
    ? state.pending.pendingAttack
    : null;
  if (pa === null) return state;
  state.phase = 'damage_resolution';

  const attackerInst = state.instances[pa.attackerInstanceId];
  const targetInst = state.instances[pa.targetInstanceId];
  if (attackerInst === undefined || targetInst === undefined) {
    return clearPendingAttack(state);
  }

  const attackerPower = effectivePower(state, attackerInst);
  const baseTargetPower = effectivePower(state, targetInst);
  const targetPower = baseTargetPower + pa.counterBoost;

  (state.history as Array<unknown>).push({
    type: 'DAMAGE_RESOLVED',
    attackerPower,
    targetPower,
    counterBoost: pa.counterBoost,
  });

  // CR §7-2: attack succeeds if attackerPower >= targetPower.
  const success = attackerPower >= targetPower;
  if (!success) {
    return clearPendingAttack(state);
  }

  // Determine target type.
  const targetCard = state.cardLibrary[targetInst.cardId] as Card | undefined;
  if (targetCard !== undefined && isLeader(targetCard)) {
    // Damage leader → flip top life → hand. If 0 life → loss.
    const flipResult = flipTopLifeToHand(state, defender);
    if (state.result !== null) {
      return clearPendingAttack(flipResult.state);
    }
    // Suspend on trigger_window if the flipped life card has a `trigger` clause.
    if (flipResult.flippedInstanceId !== null) {
      const lifeInst = state.instances[flipResult.flippedInstanceId];
      const lifeCard = lifeInst !== undefined
        ? (state.cardLibrary[lifeInst.cardId] as Card | undefined)
        : undefined;
      const hasTrigger =
        lifeCard?.effectSpecV2?.clauses.some((cl) => cl.trigger === 'trigger') ?? false;
      if (hasTrigger && lifeInst !== undefined) {
        state.pending = {
          kind: 'trigger',
          pendingTrigger: {
            lifeCardInstanceId: lifeInst.instanceId,
            controller: defender,
            resumePhase: 'main',
          },
        };
        state.phase = 'trigger_window';
        // Note: don't clear pendingAttack yet — preserved across the trigger
        // window via state.pending swap. After RESOLVE_TRIGGER fires, the
        // resolver should restore phase and clear.
        return state;
      }
    }
    return clearPendingAttack(state);
  }

  if (targetCard !== undefined && isCharacter(targetCard)) {
    // KO the character.
    state = koCharacter(state, targetInst, defender);
    return clearPendingAttack(state);
  }

  return clearPendingAttack(state);
}

function skipCounterReducer(
  state: GameState,
  _action: ActionSkipCounter,
  player: PlayerId,
): GameState {
  if (state.phase !== 'counter_window') return state;
  if (state.pending === null || state.pending.kind !== 'attack') return state;
  if (state.activePlayer === player) return state; // only defender
  const defender = player;
  return resolveDamage(state, defender);
}

// ────────────────────────────────────────────────────────────────────
// Registration
// ────────────────────────────────────────────────────────────────────

export function registerAttackFlowReducers(): void {
  registerActionReducer('DECLARE_ATTACK', declareAttackReducer);
  registerActionReducer('DECLARE_BLOCKER', declareBlockerReducer);
  registerActionReducer('SKIP_BLOCKER', skipBlockerReducer);
  registerActionReducer('PLAY_COUNTER', playCounterReducer);
  registerActionReducer('SKIP_COUNTER', skipCounterReducer);
}
