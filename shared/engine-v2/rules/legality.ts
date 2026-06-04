/**
 * Engine V2 — legal-action enumerator. Port of V1 shared/engine/rules/legality.ts.
 *
 * Single source of truth for "what can `player` do right now?" — used by
 * AI tiers and server-side validation. UI may call this to gate buttons.
 *
 * Phase-aware: returns the legal set for the current state's phase.
 * Adjusted for engine-v2 Action type names + PendingState discriminated
 * shape.
 *
 * Cross-references:
 * - V1 reference: shared/engine/rules/legality.ts (332 lines)
 * - CR §1.4–§1.6
 * - Plan v2 §3.6 (counter-window legality)
 */

import type { Card } from '../cards/Card.js';
import type { Action } from '../protocol/actions.js';
import {
  type CardInstance,
  FIELD_CAP,
  type GameState,
  OTHER_PLAYER,
  type PlayerId,
} from '../state/types.js';

const RUSH_KEYWORDS = ['rush', 'rush_character'] as const;

function hasKeyword(state: GameState, inst: CardInstance, kw: string): boolean {
  const card = state.cardLibrary[inst.cardId] as Card | undefined;
  if (card?.keywords.includes(kw as never) === true) return true;
  if (inst.grantedKeywordsContinuous?.includes(kw)) return true;
  if (inst.grantedKeywordsOneShot?.some((g) => g.keyword === kw)) return true;
  return false;
}

function sharesColorWithLeader(card: Card, leader: Card): boolean {
  const leaderColors = new Set(leader.colors);
  return card.colors.some((c) => leaderColors.has(c));
}

export function getLegalActions(state: GameState, player: PlayerId): Action[] {
  if (state.result !== null) return [];

  // Dice-roll window
  if (state.phase === 'dice_roll') {
    const slot = state.diceRoll?.[player];
    if (slot !== null && slot !== undefined) return [{ type: 'CONCEDE' }];
    return [{ type: 'ROLL_DICE', player }, { type: 'CONCEDE' }];
  }

  if (state.phase === 'first_player_choice') {
    if (player !== state.activePlayer) return [{ type: 'CONCEDE' }];
    return [
      { type: 'CHOOSE_FIRST' },
      { type: 'CHOOSE_SECOND' },
      { type: 'CONCEDE' },
    ];
  }

  if (state.phase === 'mulligan_first' || state.phase === 'mulligan_second') {
    const decider: PlayerId = state.activePlayer;
    if (player !== decider) return [{ type: 'CONCEDE' }];
    return [{ type: 'MULLIGAN' }, { type: 'KEEP_HAND' }, { type: 'CONCEDE' }];
  }

  // Trigger window
  if (state.phase === 'trigger_window') {
    if (state.pending === null || state.pending.kind !== 'trigger') return [{ type: 'CONCEDE' }];
    if (state.pending.pendingTrigger.controller !== player) return [{ type: 'CONCEDE' }];
    return [
      { type: 'RESOLVE_TRIGGER', targetInstanceId: null, activate: true },
      { type: 'RESOLVE_TRIGGER', targetInstanceId: null, activate: false },
      { type: 'CONCEDE' },
    ];
  }

  // Peek choice window
  if (state.phase === 'peek_choice') {
    if (state.pending === null || state.pending.kind !== 'peek') return [{ type: 'CONCEDE' }];
    if (state.pending.pendingPeek.controller !== player) return [{ type: 'CONCEDE' }];
    const out: Action[] = [];
    out.push({ type: 'RESOLVE_PEEK', pickedIds: [] });
    for (const id of state.pending.pendingPeek.peekedIds) {
      out.push({ type: 'RESOLVE_PEEK', pickedIds: [id] });
    }
    out.push({ type: 'CONCEDE' });
    return out;
  }

  // Discard choice window
  if (state.phase === 'discard_choice') {
    if (state.pending === null || state.pending.kind !== 'discard') return [{ type: 'CONCEDE' }];
    if (state.pending.pendingDiscard.controller !== player) return [{ type: 'CONCEDE' }];
    const pd = state.pending.pendingDiscard;
    const targetHand = pd.revealedFrom === 'self_hand'
      ? state.players[pd.controller].hand
      : state.players[OTHER_PLAYER[pd.controller]].hand;
    const out: Action[] = [];
    for (const id of targetHand) out.push({ type: 'RESOLVE_DISCARD', pickedId: id });
    out.push({ type: 'RESOLVE_DISCARD', pickedId: null });
    out.push({ type: 'CONCEDE' });
    return out;
  }

  // Choose-one window
  if (state.phase === 'choose_one') {
    if (state.pending === null || state.pending.kind !== 'choose_one') return [{ type: 'CONCEDE' }];
    if (state.pending.pendingChoose.controller !== player) return [{ type: 'CONCEDE' }];
    const out: Action[] = [];
    for (let i = 0; i < state.pending.pendingChoose.options.length; i++) {
      out.push({ type: 'RESOLVE_CHOOSE_ONE', optionIndex: i });
    }
    out.push({ type: 'CONCEDE' });
    return out;
  }

  // Attack target pick
  if (state.phase === 'attack_target_pick') {
    if (state.pending === null || state.pending.kind !== 'attack_target_pick') return [{ type: 'CONCEDE' }];
    if (state.pending.pendingTargetPick.controller !== player) return [{ type: 'CONCEDE' }];
    const out: Action[] = [];
    for (const id of state.pending.pendingTargetPick.candidateIds) {
      out.push({ type: 'RESOLVE_TARGET_PICK', pickedId: id });
    }
    out.push({ type: 'CONCEDE' });
    return out;
  }

  // Inactive-player reactive windows
  if (state.activePlayer !== player) {
    if (state.phase === 'block_window') {
      return [{ type: 'SKIP_BLOCKER' }, ...blockerActions(state, player), { type: 'CONCEDE' }];
    }
    if (state.phase === 'counter_window') {
      return [{ type: 'SKIP_COUNTER' }, ...counterActions(state, player), { type: 'CONCEDE' }];
    }
    return [{ type: 'CONCEDE' }];
  }

  // Active player main phase
  const out: Action[] = [];
  if (state.phase === 'main') {
    out.push({ type: 'END_TURN' });
    out.push(...playCardActions(state, player));
    out.push(...attachDonActions(state, player));
    out.push(...attackActions(state, player));
    out.push(...activateMainActions(state, player));
  }
  out.push({ type: 'CONCEDE' });
  return out;
}

function playCardActions(state: GameState, player: PlayerId): Action[] {
  const p = state.players[player];
  const out: Action[] = [];
  const characterCount = p.field.length;
  const leaderCard = state.cardLibrary[p.leader.cardId] as Card | undefined;
  if (leaderCard === undefined) return out;

  for (const id of p.hand) {
    const inst = state.instances[id];
    if (inst === undefined) continue;
    const card = state.cardLibrary[inst.cardId] as Card | undefined;
    if (card === undefined || card.cost === null) continue;

    let modifier = p.nextPlayCostModifier ?? 0;
    const scope = p.nextPlayCostModifierScope as { cardName?: unknown; costMin?: unknown; costMax?: unknown } | undefined;
    if (scope !== undefined) {
      let matches = true;
      if (typeof scope.cardName === 'string' && card.name !== scope.cardName) matches = false;
      if (matches && typeof scope.costMin === 'number' && card.cost < (scope.costMin as number)) matches = false;
      if (matches && typeof scope.costMax === 'number' && card.cost > (scope.costMax as number)) matches = false;
      if (!matches) modifier = 0;
    }
    const effCost = Math.max(0, card.cost + modifier);
    if (effCost > p.donCostArea.length) continue;
    if (!sharesColorWithLeader(card, leaderCard)) continue;

    if (card.kind === 'character') {
      if (characterCount < FIELD_CAP) {
        out.push({ type: 'PLAY_CARD', instanceId: id, replaceTargetId: null });
      } else {
        for (const onField of p.field) {
          out.push({ type: 'PLAY_CARD', instanceId: id, replaceTargetId: onField.instanceId });
        }
      }
    } else if (card.kind === 'event') {
      // [Counter] events not legal in main phase
      if (!card.effectText.startsWith('[Counter]')) {
        out.push({ type: 'PLAY_CARD', instanceId: id, replaceTargetId: null });
      }
    } else if (card.kind === 'stage') {
      out.push({ type: 'PLAY_STAGE', instanceId: id });
    }
  }
  return out;
}

function attachDonActions(state: GameState, player: PlayerId): Action[] {
  const p = state.players[player];
  if (p.donCostArea.length === 0) return [];
  const out: Action[] = [{ type: 'ATTACH_DON', targetInstanceId: p.leader.instanceId }];
  for (const inst of p.field) {
    out.push({ type: 'ATTACH_DON', targetInstanceId: inst.instanceId });
  }
  return out;
}

function attackActions(state: GameState, player: PlayerId): Action[] {
  const p = state.players[player];
  const opp = state.players[OTHER_PLAYER[player]];
  const out: Action[] = [];

  // CR §6-5-6-1: neither player can battle on their first turn.
  const fp: PlayerId = state.firstPlayer ?? 'A';
  const sp: PlayerId = OTHER_PLAYER[fp];
  const cannotAttack =
    (state.turn === 1 && player === fp) ||
    (state.turn === 2 && player === sp);
  if (cannotAttack) return out;

  const attackers: CardInstance[] = [];
  if (!p.leader.rested && !p.leader.perTurn.hasAttacked) attackers.push(p.leader);
  for (const inst of p.field) {
    if (inst.rested) continue;
    if (inst.perTurn.hasAttacked) continue;
    if (inst.summoningSick && !RUSH_KEYWORDS.some((kw) => hasKeyword(state, inst, kw))) continue;
    if (inst.attackLockedContinuous === true || inst.attackLockedOneShot !== undefined) continue;
    attackers.push(inst);
  }

  const oppLeaderId = opp.leader.instanceId;
  const targets: string[] = [oppLeaderId];
  for (const inst of opp.field) {
    if (inst.rested) targets.push(inst.instanceId);
  }

  for (const att of attackers) {
    const hasRush = hasKeyword(state, att, 'rush');
    const hasRushChar = hasKeyword(state, att, 'rush_character');
    const leaderForbidden = att.summoningSick && hasRushChar && !hasRush;
    for (const tgt of targets) {
      if (leaderForbidden && tgt === oppLeaderId) continue;
      out.push({ type: 'DECLARE_ATTACK', attackerInstanceId: att.instanceId, targetInstanceId: tgt });
    }
  }
  return out;
}

function blockerActions(state: GameState, player: PlayerId): Action[] {
  const p = state.players[player];
  const out: Action[] = [];
  // Unblockable attacker: no blocker enumeration
  if (state.pending !== null && state.pending.kind === 'attack') {
    const attacker = state.instances[state.pending.pendingAttack.attackerInstanceId];
    if (attacker !== undefined && hasKeyword(state, attacker, 'unblockable')) return out;
  }
  for (const inst of p.field) {
    if (inst.rested) continue;
    if (!hasKeyword(state, inst, 'blocker')) continue;
    out.push({ type: 'DECLARE_BLOCKER', blockerInstanceId: inst.instanceId });
  }
  return out;
}

function counterActions(state: GameState, player: PlayerId): Action[] {
  const p = state.players[player];
  const out: Action[] = [];
  for (const id of p.hand) {
    const inst = state.instances[id];
    if (inst === undefined) continue;
    const card = state.cardLibrary[inst.cardId] as Card | undefined;
    if (card === undefined) continue;
    if (card.kind === 'event') {
      const boost = card.counterEventBoost ?? 0;
      if (boost > 0 && card.cost !== null && card.cost <= p.donCostArea.length) {
        out.push({ type: 'PLAY_COUNTER', instanceId: id });
      }
    } else if (card.counterValue !== null && (card.counterValue ?? 0) > 0) {
      out.push({ type: 'PLAY_COUNTER', instanceId: id });
    }
  }
  return out;
}

function activateMainActions(state: GameState, player: PlayerId): Action[] {
  const p = state.players[player];
  const out: Action[] = [];

  const leaderCard = state.cardLibrary[p.leader.cardId] as Card | undefined;
  if (leaderCard?.keywords.includes('activate_main') === true && !p.leader.rested) {
    out.push({ type: 'ACTIVATE_MAIN', instanceId: p.leader.instanceId });
  }
  for (const inst of p.field) {
    const card = state.cardLibrary[inst.cardId] as Card | undefined;
    if (card?.keywords.includes('activate_main') === true && !inst.rested) {
      out.push({ type: 'ACTIVATE_MAIN', instanceId: inst.instanceId });
    }
  }
  if (p.stage !== null) {
    const stageCard = state.cardLibrary[p.stage.cardId] as Card | undefined;
    if (stageCard?.keywords.includes('activate_main') === true && !p.stage.rested) {
      out.push({ type: 'ACTIVATE_MAIN', instanceId: p.stage.instanceId });
    }
  }
  return out;
}
