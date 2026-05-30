// Legal-action enumeration. The single source of truth for "what can the
// active player do right now?" — used by both server validation and AI.
//
// Source: docs/optcg-sim/rules-reference.md §1.4–§1.6.

import type { Action } from '../../protocol/actions';
import type { Card } from '../cards/Card';
import type { CardInstance, GameState, PlayerId } from '../GameState';
import { RULES } from '../GameState';

export function getLegalActions(state: GameState, player: PlayerId): Action[] {
  if (state.result) return [];

  // D24 (CR §5-2-1-4): dice-roll window. Each player rolls FOR THEMSELVES
  // (per-player ROLL_DICE) — hot-seat hands the device between humans;
  // remote MP routes each ROLL_DICE through that player's socket. A player
  // whose slot is already filled waits — only RESIGN remains until the
  // round closes (tie → both slots null; winner → phase advances).
  if (state.phase === 'dice_roll') {
    const alreadyRolled = state.diceRoll?.[player] !== null && state.diceRoll?.[player] !== undefined;
    if (alreadyRolled) return [{ type: 'RESIGN' }];
    return [{ type: 'ROLL_DICE', player }, { type: 'RESIGN' }];
  }

  // D24 (CR §5-2-1-4): only the dice-winner (activePlayer) may declare first
  // or second. The loser can only RESIGN.
  if (state.phase === 'first_player_choice') {
    if (player !== state.activePlayer) return [{ type: 'RESIGN' }];
    return [
      { type: 'CHOOSE_FIRST' },
      { type: 'CHOOSE_SECOND' },
      { type: 'RESIGN' },
    ];
  }

  // D10 (CR §5-2-1-6): mulligan window. The relevant player may choose
  // MULLIGAN or KEEP_HAND; everything else is illegal except RESIGN.
  //   mulligan_first  → state.activePlayer (P1) decides.
  //   mulligan_second → the OTHER player (P2) decides.
  // The non-deciding player can only RESIGN (concession is always available
  // per CR §1-2-3).
  if (state.phase === 'mulligan_first' || state.phase === 'mulligan_second') {
    const decider: PlayerId = state.phase === 'mulligan_first'
      ? state.activePlayer
      : (state.activePlayer === 'A' ? 'B' : 'A');
    if (player !== decider) return [{ type: 'RESIGN' }];
    return [
      { type: 'MULLIGAN' },
      { type: 'KEEP_HAND' },
      { type: 'RESIGN' },
    ];
  }

  // Trigger window: only the trigger's controller may act on the trigger; all
  // game-state actions are illegal — damage resolution is suspended. RESIGN is
  // a universal out-of-band action and remains available to both players
  // (rules-reference.md §1.11; you can always concede a stuck game).
  if (state.phase === 'trigger_window') {
    if (!state.pendingTrigger || state.pendingTrigger.controller !== player) {
      return [{ type: 'RESIGN' }];
    }
    return [
      { type: 'RESOLVE_TRIGGER', targetInstanceId: null, activate: true },
      { type: 'RESOLVE_TRIGGER', targetInstanceId: null, activate: false },
      { type: 'RESIGN' },
    ];
  }

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
  const leaderCard = state.cardLibrary[p.leader.cardId];

  for (const instanceId of p.hand) {
    const inst = state.instances[instanceId];
    const card = state.cardLibrary[inst.cardId];
    if (card.cost === null || card.cost > p.donCostArea.length) continue;
    if (!sharesColorWithLeader(card, leaderCard)) continue;

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
    } else if (card.kind === 'event') {
      out.push({ type: 'PLAY_CARD', instanceId, replaceTargetId: null });
    } else if (card.kind === 'stage') {
      // D1 (CR §3-8): Stage uses its own action so callers/UI never confuse
      //               the single-slot Stage zone with the 5-slot character field.
      out.push({ type: 'PLAY_STAGE', instanceId });
    }
  }
  return out;
}

function attachDonActions(state: GameState, player: PlayerId): Action[] {
  const p = state.players[player];
  if (p.donCostArea.length <= 0) return [];

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

  // D2 (CR §6-5-6-1): NEITHER player can battle on their first turn.
  //   - Turn 1 = first player's (A) first turn → no attacks.
  //   - Turn 2 = second player's (B) first turn → no attacks.
  // Prior implementation only blocked turn 1, letting P2 attack on turn 2.
  const cannotAttackTurn =
    (state.turn === 1 && player === 'A') ||
    (state.turn === 2 && player === 'B');
  if (cannotAttackTurn) return out;

  const attackers: CardInstance[] = [];
  if (!p.leader.rested && !p.leader.perTurn.hasAttacked) attackers.push(p.leader);
  for (const inst of p.field) {
    const card = state.cardLibrary[inst.cardId];
    if (card.kind !== 'character') continue;
    if (inst.rested) continue;
    if (inst.perTurn.hasAttacked) continue;
    // Summoning sickness (rules-reference.md §1.6): characters cannot attack the
    // turn they're played unless they have Rush.
    if (inst.summoningSick && !card.keywords.includes('rush')) continue;
    attackers.push(inst);
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

  // D8 (CR §10-1-7): defender CANNOT activate Blocker against an attacker
  //                  with `[Unblockable]`. Skip blocker enumeration entirely.
  const attackerId = state.pendingAttack?.attackerInstanceId;
  if (attackerId) {
    const attacker = state.instances[attackerId];
    if (attacker) {
      const attackerCard = state.cardLibrary[attacker.cardId];
      if (attackerCard.keywords.includes('unblockable')) return out;
    }
  }

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
    if (card.kind === 'event') {
      // D3 (CR §7-1-3-2-2): Event counter — must have a boost AND defender
      //                    must be able to pay the event's cost.
      if (
        card.counterEventBoost &&
        card.counterEventBoost > 0 &&
        card.cost !== null &&
        card.cost <= p.donCostArea.length
      ) {
        out.push({ type: 'PLAY_COUNTER', instanceId });
      }
    } else if (card.counterValue && card.counterValue > 0) {
      // Character counter (CR §7-1-3-2-1): trash from hand for printed chip.
      out.push({ type: 'PLAY_COUNTER', instanceId });
    }
  }
  return out;
}

/** Per rules-reference.md §1.10: a card may be played only if it shares ≥1 color with the leader. */
function sharesColorWithLeader(card: Card, leader: Card): boolean {
  const leaderColors = new Set(leader.colors);
  return card.colors.some((c) => leaderColors.has(c));
}
