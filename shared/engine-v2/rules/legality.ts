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
import { evaluateCondition } from '../effects/EffectDispatcher.js';
import { costHandlers } from '../registry/types.js';
import { isOptUsed, makeOptKey } from '../state/derived/opt.js';
import type { EffectClauseV2 } from '../spec/types.js';

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

// Counter-event playability signal. Returns true if `card` is an event
// that should be offered as PLAY_COUNTER. Logic: A OR (B AND C).
//   A — legacy: `counterEventBoost > 0` (always-on defensive boost).
//   B AND C — printed-strict zero-boost counter event: corpus must
//       explicitly mark the card as a counter event (`effectTags`
//       contains `'counter_event'`) AND the spec must contain at least
//       one on_play `power_buff` action targeting a defender-side
//       instance. The conjunction is required to prevent unrelated
//       main-phase events (whose power_buff clauses target your_leader /
//       your_character but have no counter_event tag — e.g. EB02-007
//       Cloven Rose Blizzard, OP03-016 Flame Emperor, OP05-115 Two-Hundred
//       Million Volts Amaru) from becoming counter-playable.
// `effectTags` is corpus-side metadata; not declared on `CardBase`. Read
// via a narrow runtime cast so the engine doesn't need a schema change.
function isCounterEventPlayable(card: Card): boolean {
  const boost = (card as { counterEventBoost?: number | null }).counterEventBoost ?? 0;
  if (boost > 0) return true; // Path A
  const spec = card.effectSpecV2;
  const hasDefensivePowerBuff = (spec?.clauses ?? []).some((c) => {
    if (c.trigger !== 'on_play') return false;
    if (c.action.kind !== 'power_buff') return false;
    const tk = c.target?.kind;
    return tk === 'your_leader' || tk === 'your_character'
        || tk === 'your_leader_or_character' || tk === 'self';
  });
  const tags = (card as { effectTags?: ReadonlyArray<string> }).effectTags;
  const hasCounterEventTag = Array.isArray(tags) && tags.includes('counter_event');
  return hasDefensivePowerBuff && hasCounterEventTag; // Path B AND C
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
      if (isCounterEventPlayable(card) && card.cost !== null && card.cost <= p.donCostArea.length) {
        out.push({ type: 'PLAY_COUNTER', instanceId: id });
      }
    } else if (card.counterValue !== null && (card.counterValue ?? 0) > 0) {
      out.push({ type: 'PLAY_COUNTER', instanceId: id });
    }
  }
  return out;
}

// F-14a — an ACTIVATE_MAIN action is only offered when at least one of the
// card's [Activate: Main] clauses is actually VIABLE in the current state, so
// the legality layer (not just the UI) stops offering dead activations.
// A clause is viable iff: trigger is activate_main, mode is main (not a
// [Counter]-only clause), it is not an already-used once-per-turn (opt) clause,
// its condition is true, AND every cost key it carries is payable now.
// Target presence is intentionally NOT required — a cost-payable clause with no
// legal target still activates and resolves to no-valid-target (CR-compliant),
// so we must not hide it (F-14a requirement 6). Fully generic: no card IDs.
function hasViableActivateMainClause(state: GameState, controller: PlayerId, inst: CardInstance, card: Card): boolean {
  const clauses = (card.effectSpecV2?.clauses ?? []) as ReadonlyArray<EffectClauseV2>;
  const amClauses = clauses
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.trigger === 'activate_main');
  // No modeled [Activate: Main] clause (keyword-only / non-clause effect) →
  // preserve legacy behavior and keep offering it.
  if (amClauses.length === 0) return true;
  const ctx = { sourceInstanceId: inst.instanceId, controller };
  for (const { c, i } of amClauses) {
    const mode = (c as { mode?: 'main' | 'counter' }).mode;
    if (mode !== undefined && mode !== 'main') continue;
    if (c.opt === true && isOptUsed(inst, makeOptKey('opt', 'activate_main', i))) continue;
    if (!evaluateCondition(state, ctx, c.condition)) continue;
    let payable = true;
    const cost = c.cost as Record<string, unknown> | undefined;
    if (cost) {
      for (const k of Object.keys(cost)) {
        if (k === 'bind') continue;
        if (!costHandlers.has(k) || !costHandlers.get(k).canPay(state, ctx, c.cost as never)) { payable = false; break; }
      }
    }
    if (payable) return true; // at least one clause can actually be activated
  }
  return false;
}

function activateMainActions(state: GameState, player: PlayerId): Action[] {
  const p = state.players[player];
  const out: Action[] = [];

  const leaderCard = state.cardLibrary[p.leader.cardId] as Card | undefined;
  if (leaderCard?.keywords.includes('activate_main') === true && !p.leader.rested
      && hasViableActivateMainClause(state, player, p.leader, leaderCard)) {
    out.push({ type: 'ACTIVATE_MAIN', instanceId: p.leader.instanceId });
  }
  for (const inst of p.field) {
    const card = state.cardLibrary[inst.cardId] as Card | undefined;
    if (card?.keywords.includes('activate_main') === true && !inst.rested
        && hasViableActivateMainClause(state, player, inst, card)) {
      out.push({ type: 'ACTIVATE_MAIN', instanceId: inst.instanceId });
    }
  }
  if (p.stage !== null) {
    const stageCard = state.cardLibrary[p.stage.cardId] as Card | undefined;
    if (stageCard?.keywords.includes('activate_main') === true && !p.stage.rested
        && hasViableActivateMainClause(state, player, p.stage, stageCard)) {
      out.push({ type: 'ACTIVATE_MAIN', instanceId: p.stage.instanceId });
    }
  }
  return out;
}
