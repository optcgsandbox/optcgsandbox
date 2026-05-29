// Legal-action enumeration. The single source of truth for "what can the
// active player do right now?" — used by both server validation and AI.
//
// Source: docs/optcg-sim/rules-reference.md §1.4–§1.6.

import type { Action } from '../../protocol/actions';
import type { Card } from '../cards/Card';
import type { CardInstance, GameState, PlayerId, PlayerZones } from '../GameState';
import { RULES } from '../GameState';

export function getLegalActions(state: GameState, player: PlayerId): Action[] {
  if (state.result) return [];
  if (state.activePlayer !== player) {
    // Only the inactive player has the limited set of reactive actions
    // (counter, blocker). Those are gated by phase.
    if (state.phase === 'block_window') return [{ type: 'SKIP_BLOCKER' }, ...blockerActions(state, player)];
    if (state.phase === 'counter_window') return [{ type: 'SKIP_COUNTER' }, ...counterActions(state, player)];
    return [];
  }

  const actions: Action[] = [];

  if (state.phase === 'main') {
    actions.push({ type: 'END_TURN' });
    actions.push(...playCardActions(state, player));
    actions.push(...attachDonActions(state, player));
    actions.push(...attackActions(state, player));
  }

  actions.push({ type: 'RESIGN' });
  return actions;
}

function playCardActions(state: GameState, player: PlayerId): Action[] {
  const p = state.players[player];
  const out: Action[] = [];
  const characterCount = p.field.filter((inst) => state.cardLibrary[inst.cardId].kind === 'character').length;

  for (const instanceId of p.hand) {
    const inst = state.instances[instanceId];
    const card = state.cardLibrary[inst.cardId];
    if (card.cost === null || card.cost > p.donActive) continue;
    if (!cardColorMatchesLeader(card, p)) continue;

    if (card.kind === 'character') {
      if (characterCount < RULES.MAX_CHARACTERS_ON_FIELD) {
        out.push({ type: 'PLAY_CARD', instanceId, replaceTargetId: null });
      } else {
        // Must replace an existing character.
        for (const onField of p.field) {
          if (state.cardLibrary[onField.cardId].kind === 'character') {
            out.push({ type: 'PLAY_CARD', instanceId, replaceTargetId: onField.instanceId });
          }
        }
      }
    } else if (card.kind === 'event' || card.kind === 'stage') {
      out.push({ type: 'PLAY_CARD', instanceId, replaceTargetId: null });
    }
  }
  return out;
}

function attachDonActions(state: GameState, player: PlayerId): Action[] {
  const p = state.players[player];
  if (p.donActive <= 0) return [];

  const out: Action[] = [
    { type: 'ATTACH_DON', targetInstanceId: p.leader.instanceId },
  ];
  for (const inst of p.field) {
    if (state.cardLibrary[inst.cardId].kind === 'character') {
      out.push({ type: 'ATTACH_DON', targetInstanceId: inst.instanceId });
    }
  }
  return out;
}

function attackActions(state: GameState, player: PlayerId): Action[] {
  const p = state.players[player];
  const opp = state.players[player === 'A' ? 'B' : 'A'];
  const out: Action[] = [];

  // First-turn first-player cannot attack on turn 1.
  const cannotAttackTurn = state.turn === 1 && player === 'A';
  if (cannotAttackTurn) return out;

  const attackers: CardInstance[] = [];
  if (!p.leader.rested && !p.leader.perTurn.hasAttacked) attackers.push(p.leader);
  for (const inst of p.field) {
    const card = state.cardLibrary[inst.cardId];
    if (card.kind !== 'character') continue;
    if (inst.rested) continue;
    if (inst.perTurn.hasAttacked) continue;
    // Summoning sickness — no attacks the turn played unless Rush.
    if (cardHasRushAndPlayedThisTurn(card, inst, state)) attackers.push(inst);
    else if (!playedThisTurn(inst, state)) attackers.push(inst);
  }

  const targets: string[] = [opp.leader.instanceId];
  for (const inst of opp.field) {
    if (state.cardLibrary[inst.cardId].kind === 'character' && inst.rested) {
      targets.push(inst.instanceId);
    }
  }

  for (const att of attackers) {
    for (const tgt of targets) {
      out.push({ type: 'DECLARE_ATTACK', attackerInstanceId: att.instanceId, targetInstanceId: tgt });
    }
  }
  return out;
}

function blockerActions(state: GameState, player: PlayerId): Action[] {
  const p = state.players[player];
  const out: Action[] = [];
  for (const inst of p.field) {
    const card = state.cardLibrary[inst.cardId];
    if (card.keywords.includes('blocker') && !inst.rested) {
      out.push({ type: 'DECLARE_BLOCKER', blockerInstanceId: inst.instanceId });
    }
  }
  return out;
}

function counterActions(state: GameState, player: PlayerId): Action[] {
  const p = state.players[player];
  const out: Action[] = [];
  for (const instanceId of p.hand) {
    const card = state.cardLibrary[state.instances[instanceId].cardId];
    if (card.counterValue && card.counterValue > 0) {
      out.push({ type: 'PLAY_COUNTER', instanceId });
    }
  }
  return out;
}

function cardColorMatchesLeader(card: Card, p: PlayerZones): boolean {
  const leaderColors = new Set(p.leader.cardId.split(':').flatMap(() => [])); // placeholder
  // We don't have the leader's Card here without a state lookup; assume valid for v0.
  // Deck construction guarantees deckbuilding color match per §1.10; reuse.
  void leaderColors;
  return card.colors.length > 0;
}

function playedThisTurn(_inst: CardInstance, _state: GameState): boolean {
  // TODO: track played-this-turn flag. For v0, allow attacks freely.
  return false;
}

function cardHasRushAndPlayedThisTurn(card: Card, inst: CardInstance, state: GameState): boolean {
  return card.keywords.includes('rush') && playedThisTurn(inst, state);
}
