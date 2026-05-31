// Action handlers. Pure functions: (state, player, action) → next state.
// Source: rules-reference.md §1.4–§1.6.
//
// Attack flow (rules-reference.md §1.6) is now a 3-step state machine:
//   1. DECLARE_ATTACK  → phase = 'block_window'  (defender may declare Blocker or skip)
//   2. DECLARE_BLOCKER / SKIP_BLOCKER → phase = 'counter_window'  (defender may play counters or skip)
//   3. SKIP_COUNTER (or PLAY_COUNTER then SKIP_COUNTER) → resolve damage, phase = 'main'
//
// pendingAttack on GameState carries the in-flight attack across phases.
//
// Trigger window (rules-reference.md §1.7): when a life card with the `trigger`
// effect tag is flipped, damage processing suspends, phase becomes
// 'trigger_window', and pendingTrigger carries the choice point until the
// controller RESOLVE_TRIGGERs (activate or decline).

import type { Action } from '../protocol/actions';
import type { Card, CharacterCard, LeaderCard } from './cards/Card';
import { fireEffects } from './cards/effects/dispatch';
import type { CardInstance, GameEvent, GameState, PlayerId, PendingAttack } from './GameState';
import { applyMulligan, chooseFirstPlayer, dealLifeCards, rollDice } from './phases/setup';
import { endTurn as runEndTurn } from './phases/turn';
import { Random } from './Random';
import { publishTrigger } from './effectSpec/triggerBus-v2';

const OTHER: Record<PlayerId, PlayerId> = { A: 'B', B: 'A' };

export function applyAction(
  state: GameState,
  player: PlayerId,
  action: Action,
): { state: GameState; events: GameEvent[] } {
  if (state.result) return { state, events: [] };

  switch (action.type) {
    case 'PLAY_CARD':
      return playCard(state, player, action.instanceId, action.replaceTargetId);
    case 'PLAY_STAGE':
      return playStage(state, player, action.instanceId);
    case 'ATTACH_DON':
      return attachDon(state, player, action.targetInstanceId);
    case 'DECLARE_ATTACK':
      return declareAttack(state, player, action.attackerInstanceId, action.targetInstanceId);
    case 'DECLARE_BLOCKER':
      return declareBlocker(state, player, action.blockerInstanceId);
    case 'SKIP_BLOCKER':
      return skipBlocker(state);
    case 'PLAY_COUNTER':
      return playCounter(state, player, action.instanceId);
    case 'SKIP_COUNTER':
      return resolvePending(state);
    case 'RESOLVE_TRIGGER':
      return resolveTrigger(state, player, action.activate);
    case 'END_TURN':
      return runEndTurnReshim(state);
    case 'RESIGN':
      return resign(state, player);
    case 'MULLIGAN':
      return resolveMulliganDecision(state, player, /* mulligan */ true);
    case 'KEEP_HAND':
      return resolveMulliganDecision(state, player, /* mulligan */ false);
    case 'ROLL_DICE':
      return resolveDiceRoll(state, action.player);
    case 'CHOOSE_FIRST':
      return resolveFirstPlayerChoice(state, player, /* goesFirst === chooser */ true);
    case 'CHOOSE_SECOND':
      return resolveFirstPlayerChoice(state, player, /* goesFirst === chooser */ false);
    case 'ACTIVATE_MAIN':
      return activateMain(state, player, action.instanceId);
    case 'RESOLVE_PEEK':
      return resolvePeek(state, player, action.instanceIds);
    case 'SKIP_PEEK':
      return resolvePeek(state, player, []);
    case 'RESOLVE_DISCARD':
      return resolveDiscard(state, player, action.instanceId);
  }
}

// === V3-3 RESOLVE_PEEK / SKIP_PEEK ===
// Resolve the peek window: add picked instances to controller's hand, shuffle
// the rest back into the deck via the seeded RNG, restore the resumePhase.
function resolvePeek(
  state: GameState,
  player: PlayerId,
  pickedIds: string[],
): { state: GameState; events: GameEvent[] } {
  const pp = state.pendingPeek;
  if (!pp) return { state, events: [] };
  if (player !== pp.controller) return { state, events: [] };
  if (state.phase !== 'peek_choice') return { state, events: [] };
  if (pickedIds.length > pp.addCount) return { state, events: [] };
  for (const id of pickedIds) {
    if (!pp.peekedIds.includes(id)) return { state, events: [] };
  }

  const next: GameState = structuredClone(state);
  const start = next.history.length;
  const p = next.players[player];

  // Picked → controller's hand.
  for (const id of pickedIds) p.hand.push(id);

  // Remaining → back into deck, shuffled.
  const remaining = pp.peekedIds.filter((id) => !pickedIds.includes(id));
  if (remaining.length > 0) {
    // Insert into deck and shuffle the deck via the engine's seeded RNG.
    p.deck.push(...remaining);
    const rng = new Random(next.seed ^ next.turn ^ 0x91a3f7);
    p.deck = rng.shuffle(p.deck);
  }

  next.pendingPeek = null;
  next.phase = pp.resumePhase;
  return { state: next, events: next.history.slice(start) };
}

// === V3-4 RESOLVE_DISCARD ===
// Controller picks one instance from opp's hand to discard.
function resolveDiscard(
  state: GameState,
  player: PlayerId,
  instanceId: string,
): { state: GameState; events: GameEvent[] } {
  const pd = state.pendingDiscard;
  if (!pd) return { state, events: [] };
  if (player !== pd.controller) return { state, events: [] };
  if (state.phase !== 'discard_choice') return { state, events: [] };

  const next: GameState = structuredClone(state);
  const start = next.history.length;
  const oppZones = next.players[pd.revealedFrom];
  const idx = oppZones.hand.indexOf(instanceId);
  if (idx === -1) return { state, events: [] };
  oppZones.hand.splice(idx, 1);
  oppZones.trash.push(instanceId);

  next.pendingDiscard = null;
  next.phase = pd.resumePhase;
  return { state: next, events: next.history.slice(start) };
}

// === Phase C / D12: ACTIVATE_MAIN ===
// CR §10-2-13: rest the card (the cost) and fire its activate_main effect
// tags through fireEffects. Re-activation is naturally prevented because a
// rested card is not eligible (legality + this handler guard).
function activateMain(
  state: GameState,
  player: PlayerId,
  instanceId: string,
): { state: GameState; events: GameEvent[] } {
  if (state.phase !== 'main') return { state, events: [] };
  if (state.activePlayer !== player) return { state, events: [] };
  const inst = state.instances[instanceId];
  if (!inst) return { state, events: [] };
  if (inst.controller !== player) return { state, events: [] };
  const card = state.cardLibrary[inst.cardId];
  if (!card || !card.keywords.includes('activate_main')) return { state, events: [] };
  // Rested guard reads from the per-zone struct because that's the canonical
  // source the refresh phase clears (`runRefreshPhase` at phases/turn.ts:41-50
  // does NOT walk state.instances). Reading inst.rested here would give a stale
  // true after the first turn and silently no-op subsequent activations — the
  // exact regression caught by Code Reviewer 2026-05-29.
  const p = state.players[player];
  const zoneInst =
    p.leader.instanceId === instanceId
      ? p.leader
      : p.field.find((i) => i.instanceId === instanceId) ??
        (p.stage && p.stage.instanceId === instanceId ? p.stage : null);
  if (!zoneInst) return { state, events: [] };
  if (zoneInst.rested) return { state, events: [] };

  // D17 (CR §10-2-10): [DON!!−X] cost. Validate the player has X active DON
  // available in the cost area BEFORE mutating anything. Attached-DON payment
  // is voluntary and not modeled in v0.
  const donCost = getDonCost(card);
  if (donCost > p.donCostArea.length) return { state, events: [] };

  const start = state.history.length;
  const next: GameState = structuredClone(state);

  // Rest IS the rest cost (always paid).
  next.instances[instanceId].rested = true;
  // Mirror onto the per-zone struct so UI + legality see the rested state.
  const np = next.players[player];
  if (np.leader.instanceId === instanceId) np.leader.rested = true;
  for (const onField of np.field) {
    if (onField.instanceId === instanceId) onField.rested = true;
  }
  if (np.stage && np.stage.instanceId === instanceId) np.stage.rested = true;

  // D17: pay X DON back to the DON deck (end). Pull from cost area head.
  if (donCost > 0) {
    for (let i = 0; i < donCost; i++) {
      const donId = np.donCostArea.shift();
      if (donId) np.donDeck.push(donId);
    }
  }

  const after = fireEffects(next, instanceId, 'activate_main', player);
  Object.assign(next, after);

  return { state: next, events: next.history.slice(start) };
}

/** D17: extract the [DON!!−X] cost from a card, 0 when unset / inapplicable. */
function getDonCost(card: Card): number {
  if (card.kind !== 'leader' && card.kind !== 'character' && card.kind !== 'stage') return 0;
  return card.donCost ?? 0;
}

// === D24: ROLL_DICE / CHOOSE_FIRST / CHOOSE_SECOND ===
// CR §5-2-1-4: before the mulligan window, each player resolves their own
// dice-roll. Per-player ROLL_DICE — each player presses their own button
// (hot-seat: two humans; vs-AI: human first then AI; remote MP: routed by
// socket). The engine rejects re-rolls (slot already non-null) until a tie
// nulls the slots. Once both slots are non-null:
//   - Equal → tie: null both slots, increment rolls, stay in 'dice_roll'.
//   - High roll → high roller becomes `activePlayer`, phase advances to
//     'first_player_choice'.
function resolveDiceRoll(
  state: GameState,
  player: PlayerId,
): { state: GameState; events: GameEvent[] } {
  if (state.phase !== 'dice_roll') return { state, events: [] };
  if (!state.diceRoll) return { state, events: [] };
  // Each player can only roll while their own slot is null. Re-rolls before
  // the opponent answers are rejected (defense in depth; legality.ts also
  // filters them out of the action surface).
  if (state.diceRoll[player] !== null) return { state, events: [] };
  const start = state.history.length;
  const next = rollDice(state, player);
  return { state: next, events: next.history.slice(start) };
}

function resolveFirstPlayerChoice(
  state: GameState,
  player: PlayerId,
  goesFirstIsChooser: boolean,
): { state: GameState; events: GameEvent[] } {
  if (state.phase !== 'first_player_choice') return { state, events: [] };
  // Only the dice-winner (activePlayer at this point) may declare.
  if (player !== state.activePlayer) return { state, events: [] };
  const goesFirst: PlayerId = goesFirstIsChooser
    ? player
    : (player === 'A' ? 'B' : 'A');
  const start = state.history.length;
  const next = chooseFirstPlayer(state, player, goesFirst);
  return { state: next, events: next.history.slice(start) };
}

// === D10: MULLIGAN / KEEP_HAND ===
// CR §5-2-1-6: each player may, once, return their opening hand to the deck,
// reshuffle, and redraw 5. First player decides first; the option is consumed
// either way (reshuffle OR explicit keep) by the phase transition.
function resolveMulliganDecision(
  state: GameState,
  player: PlayerId,
  mulligan: boolean,
): { state: GameState; events: GameEvent[] } {
  // Phase gate: only the correct player on the correct phase may act.
  //   mulligan_first  → active player (P1) decides.
  //   mulligan_second → other player (P2) decides.
  if (state.phase === 'mulligan_first') {
    if (player !== state.activePlayer) return { state, events: [] };
  } else if (state.phase === 'mulligan_second') {
    if (player === state.activePlayer) return { state, events: [] };
  } else {
    return { state, events: [] };
  }

  // Defense in depth: if the player already mulliganed in this window, reject.
  // The phase transitions already prevent a second MULLIGAN from the same
  // player, but `mulliganUsed` is the authoritative single-use guard per
  // CR §5-2-1-6-1.
  if (mulligan && state.mulliganUsed[player]) {
    return { state, events: [] };
  }

  const start = state.history.length;
  let next: GameState = mulligan
    ? applyMulligan(state, player)
    : structuredClone(state);

  next.history.push({ type: 'MULLIGAN_DECISION', player, kept: !mulligan });

  if (next.phase === 'mulligan_first') {
    next.phase = 'mulligan_second';
    next.history.push({ type: 'PHASE_CHANGED', phase: 'mulligan_second' });
  } else {
    // Both players have decided — close the window: deal life and head into
    // player A's first refresh phase (CR §5-2-1-7).
    next = dealLifeCards(next);
    next.history.push({ type: 'PHASE_CHANGED', phase: 'refresh' });
  }

  return { state: next, events: next.history.slice(start) };
}

// === PLAY_CARD ===
function playCard(
  state: GameState,
  player: PlayerId,
  instanceId: string,
  replaceTargetId: string | null,
): { state: GameState; events: GameEvent[] } {
  const next: GameState = structuredClone(state);
  const start = next.history.length;
  const p = next.players[player];
  const inst = next.instances[instanceId];
  if (!inst || inst.controller !== player) return { state, events: [] };

  const handIdx = p.hand.indexOf(instanceId);
  if (handIdx === -1) return { state, events: [] };

  const card = next.cardLibrary[inst.cardId];
  if (card.cost === null) return { state, events: [] };
  // V3-2: cost_reduction modifier reduces the cost paid for THIS play, then
  // is consumed. Negative modifier → less DON spent.
  const playCost = Math.max(0, card.cost + (p.nextPlayCostModifier ?? 0));
  if (playCost > p.donCostArea.length) return { state, events: [] };

  // Pay cost: rest `playCost` DON from the cost area.
  for (let i = 0; i < playCost; i++) {
    p.donRested.push(p.donCostArea.shift()!);
  }
  // V3-2: one-shot — consume the modifier so subsequent plays pay full cost.
  if (p.nextPlayCostModifier !== undefined) delete p.nextPlayCostModifier;
  p.hand.splice(handIdx, 1);

  if (card.kind === 'character') {
    if (replaceTargetId) {
      const idx = p.field.findIndex((c) => c.instanceId === replaceTargetId);
      if (idx !== -1) {
        const removed = p.field.splice(idx, 1)[0];
        // Detach DON before trashing (rules-reference.md §1.4).
        while (removed.attachedDon.length > 0) {
          p.donRested.push(removed.attachedDon.shift()!);
        }
        p.trash.push(removed.instanceId);
        // V3-7 (D6, CR §3-7-6-1-1): rule processing, not K.O. — no [On K.O.]
        // cascade. Distinct event type signals downstream consumers (UI log /
        // future on_ko handlers) that this is NOT a K.O.
        next.history.push({ type: 'CARD_TRASHED_BY_RULE', instanceId: removed.instanceId });
      }
    }
    inst.summoningSick = true;
    p.field.push(inst);
  } else if (card.kind === 'stage') {
    // D1: Stage cards must use PLAY_STAGE (CR §3-8). Reject PLAY_CARD for Stage
    //     to keep the action surface aligned with zone separation.
    return { state, events: [] };
  } else if (card.kind === 'event') {
    // D13 / D14 (CR §8 / §10-1-5): Event main effect fires BEFORE the card
    // goes to trash. The dispatched templates mutate `next` via a chain;
    // we then trash the event so its state-leaving rules trigger correctly.
    const after = fireEffects(next, instanceId, 'on_play', player);
    // Splice the post-effect state into our working `next` (preserve history
    // append discipline by writing back the full structuredClone).
    Object.assign(next, after);
    next.players[player].trash.push(instanceId);
  }

  next.history.push({ type: 'CARD_PLAYED', player, instanceId, cost: card.cost });

  // D14 (CR §8): on_play dispatch for character. Event already fired above
  // (it needs to resolve BEFORE trashing); leader has no on_play (it's
  // pre-placed at setup). Stage on_play handled in playStage.
  if (card.kind === 'character') {
    const after = fireEffects(next, instanceId, 'on_play', player);
    Object.assign(next, after);
    // A.3.9: publish on_opp_play_character so reactive cards on the
    // opposite side can respond. No-op in V0 (no subscribers).
    publishTrigger('on_opp_play_character', next, { opp: player, instanceId, cardId: card.id });
  }

  return { state: next, events: next.history.slice(start) };
}

// === PLAY_STAGE === D1, CR §3-8-5
// Stage Area is a single-slot zone. Playing a new Stage when one already
// exists trashes the existing Stage (CR §3-8-5-1). The trashed Stage's
// attached DON return to the cost area rested (CR §6-5-5-4).
function playStage(
  state: GameState,
  player: PlayerId,
  instanceId: string,
): { state: GameState; events: GameEvent[] } {
  const next: GameState = structuredClone(state);
  const start = next.history.length;
  const p = next.players[player];
  const inst = next.instances[instanceId];
  if (!inst || inst.controller !== player) return { state, events: [] };

  const handIdx = p.hand.indexOf(instanceId);
  if (handIdx === -1) return { state, events: [] };

  const card = next.cardLibrary[inst.cardId];
  if (card.kind !== 'stage') return { state, events: [] };
  if (card.cost === null || card.cost > p.donCostArea.length) return { state, events: [] };

  // Pay cost: rest `card.cost` DON from the cost area.
  for (let i = 0; i < card.cost; i++) {
    p.donRested.push(p.donCostArea.shift()!);
  }
  p.hand.splice(handIdx, 1);

  // Trash existing Stage if any (CR §3-8-5-1). DON returns rested.
  if (p.stage) {
    const existing = p.stage;
    while (existing.attachedDon.length > 0) {
      p.donRested.push(existing.attachedDon.shift()!);
    }
    p.trash.push(existing.instanceId);
  }
  p.stage = inst;

  next.history.push({ type: 'CARD_PLAYED', player, instanceId, cost: card.cost });

  // D14 (CR §8): on_play dispatch for Stage. Most stages are passive
  // (no effect tags), so this is usually a no-op; tagged stages like
  // [On Play] ramp / lifegain pickups fire here.
  const after = fireEffects(next, instanceId, 'on_play', player);
  Object.assign(next, after);

  return { state: next, events: next.history.slice(start) };
}

// === ATTACH_DON ===
function attachDon(
  state: GameState,
  player: PlayerId,
  targetInstanceId: string,
): { state: GameState; events: GameEvent[] } {
  const next: GameState = structuredClone(state);
  const start = next.history.length;
  const p = next.players[player];
  if (p.donCostArea.length <= 0) return { state, events: [] };

  let target: CardInstance | null = null;
  if (p.leader.instanceId === targetInstanceId) target = p.leader;
  else target = p.field.find((i) => i.instanceId === targetInstanceId) ?? null;

  if (!target || target.controller !== player) return { state, events: [] };

  // Move a DON instance from the cost area onto the target.
  const donInstanceId = p.donCostArea.shift()!;
  target.attachedDon.push(donInstanceId);
  next.history.push({ type: 'DON_ATTACHED', targetInstanceId, count: 1 });
  return { state: next, events: next.history.slice(start) };
}

// === ATTACK FLOW ===

/** Stage 1: attacker declares. Move to block_window. */
function declareAttack(
  state: GameState,
  player: PlayerId,
  attackerId: string,
  targetId: string,
): { state: GameState; events: GameEvent[] } {
  if (state.activePlayer !== player) return { state, events: [] };
  // D2 (CR §6-5-6-1): neither player may attack on their first turn.
  //   Turn 1 = first player's first turn; turn 2 = second player's first turn.
  //   Uses GameState.firstPlayer so the gate follows the actual first player
  //   rather than hardcoding A.
  if (state.firstPlayer !== null) {
    const second: PlayerId = state.firstPlayer === 'A' ? 'B' : 'A';
    if ((state.turn === 1 && player === state.firstPlayer) || (state.turn === 2 && player === second)) {
      return { state, events: [] };
    }
  } else if ((state.turn === 1 && player === 'A') || (state.turn === 2 && player === 'B')) {
    // Legacy path (firstPlayer not set — pre-D24 tests): preserve old behavior.
    return { state, events: [] };
  }
  const next: GameState = structuredClone(state);
  const start = next.history.length;
  const attacker = next.instances[attackerId];
  const target = next.instances[targetId];
  if (!attacker || !target) return { state, events: [] };

  attacker.rested = true;
  attacker.perTurn.hasAttacked = true;

  next.pendingAttack = { attackerInstanceId: attackerId, targetInstanceId: targetId, counterBoost: 0 };
  next.phase = 'block_window';
  next.history.push({ type: 'ATTACK_DECLARED', attacker: attackerId, target: targetId });
  next.history.push({ type: 'PHASE_CHANGED', phase: 'block_window' });

  // D14 (CR §8): when_attacking dispatch. Fires after rest + perTurn flag so
  // any handler that reads attacker state sees "yes, this card just attacked".
  const after = fireEffects(next, attackerId, 'when_attacking', player);
  Object.assign(next, after);

  // A.3.9: publish on_opp_attack to the v2 trigger bus so reactive cards
  // owned by the defender can respond. V0 has no subscribers — the publish
  // is a no-op until A.3.10 wires the runner up.
  const defender: PlayerId = player === 'A' ? 'B' : 'A';
  publishTrigger('on_opp_attack', next, { attacker: attackerId, target: targetId, defender });

  return { state: next, events: next.history.slice(start) };
}

/** Stage 2a: defender activates a Blocker. The blocker becomes the new attack target. */
function declareBlocker(
  state: GameState,
  player: PlayerId,
  blockerInstanceId: string,
): { state: GameState; events: GameEvent[] } {
  if (state.phase !== 'block_window' || !state.pendingAttack) return { state, events: [] };
  if (state.activePlayer === player) return { state, events: [] }; // only inactive player blocks

  const next: GameState = structuredClone(state);
  const start = next.history.length;
  const blocker = next.instances[blockerInstanceId];
  if (!blocker || blocker.controller !== player) return { state, events: [] };
  const blockerCard = next.cardLibrary[blocker.cardId];
  if (!blockerCard.keywords.includes('blocker')) return { state, events: [] };
  if (blocker.rested) return { state, events: [] };

  // Redirect the attack to the blocker; rest it as per Blocker rules.
  blocker.rested = true;
  next.pendingAttack!.targetInstanceId = blockerInstanceId;
  next.phase = 'counter_window';
  next.history.push({ type: 'BLOCKER_ACTIVATED', blocker: blockerInstanceId });
  next.history.push({ type: 'PHASE_CHANGED', phase: 'counter_window' });

  // D14 (CR §8): on_block dispatch. Fires for the defender (blocker
  // controller). Most blocker cards have no on_block effect; ones that do
  // (e.g. draw on block) chain in here.
  const after = fireEffects(next, blockerInstanceId, 'on_block', player);
  Object.assign(next, after);

  return { state: next, events: next.history.slice(start) };
}

/** Stage 2b: defender skips Blocker → move directly to counter window. */
function skipBlocker(state: GameState): { state: GameState; events: GameEvent[] } {
  if (state.phase !== 'block_window' || !state.pendingAttack) return { state, events: [] };
  const next: GameState = structuredClone(state);
  const start = next.history.length;
  next.phase = 'counter_window';
  next.history.push({ type: 'PHASE_CHANGED', phase: 'counter_window' });
  return { state: next, events: next.history.slice(start) };
}

/** Stage 3a: defender plays a Counter from hand.
 *
 *  Two paths per CR §7-1-3-2:
 *   - **Character counter** (CR §7-1-3-2-1): trash a Character from hand for
 *     its printed Counter value (yellow chip). No DON cost.
 *   - **Event counter** (CR §7-1-3-2-2, D3): pay the Event's printed cost AND
 *     trash the Event from hand. The boost is the Event's `counterEventBoost`.
 *
 *  Both paths add to `pendingAttack.counterBoost`. The cost-payment step is
 *  Event-specific.
 */
function playCounter(
  state: GameState,
  player: PlayerId,
  instanceId: string,
): { state: GameState; events: GameEvent[] } {
  if (state.phase !== 'counter_window' || !state.pendingAttack) return { state, events: [] };
  if (state.activePlayer === player) return { state, events: [] }; // only inactive plays counters

  const next: GameState = structuredClone(state);
  const start = next.history.length;
  const p = next.players[player];
  const handIdx = p.hand.indexOf(instanceId);
  if (handIdx === -1) return { state, events: [] };
  const inst = next.instances[instanceId];
  const card = next.cardLibrary[inst.cardId];

  let boost: number;
  if (card.kind === 'event') {
    // D3 (CR §7-1-3-2-2): Event counter — must pay cost + trash event.
    if (card.counterEventBoost === null || card.counterEventBoost <= 0) {
      return { state, events: [] };
    }
    if (card.cost === null || card.cost > p.donCostArea.length) {
      return { state, events: [] };
    }
    // Pay cost: rest `card.cost` DON.
    for (let i = 0; i < card.cost; i++) {
      p.donRested.push(p.donCostArea.shift()!);
    }
    boost = card.counterEventBoost;
  } else {
    // Character counter (CR §7-1-3-2-1): use printed Counter chip; no cost.
    if (!card.counterValue || card.counterValue <= 0) return { state, events: [] };
    boost = card.counterValue;
  }

  // Move from hand to trash, add counter boost to pendingAttack.
  p.hand.splice(handIdx, 1);
  p.trash.push(instanceId);
  next.pendingAttack!.counterBoost += boost;
  next.history.push({ type: 'COUNTER_PLAYED', instanceId, boost });
  return { state: next, events: next.history.slice(start) };
}

/** Stage 3b: defender ends counter window → resolve damage. */
function resolvePending(state: GameState): { state: GameState; events: GameEvent[] } {
  if (state.phase !== 'counter_window' || !state.pendingAttack) return { state, events: [] };
  return resolveDamage(state);
}

/** Compute power, apply life loss / KO, return phase to main.
 *
 *  Rules-reference.md §1.7: if the life card drawn has [Trigger], damage
 *  processing SUSPENDS and the controller is asked to activate. We model that
 *  by setting `pendingTrigger` and `phase = 'trigger_window'` instead of
 *  pushing the card straight to hand. The controller resolves via
 *  RESOLVE_TRIGGER, which either runs the effect or just adds the card to hand
 *  (decline path), then resumes.
 *
 *  Rules-reference.md §1.8 (Double Attack): if the attacker has the
 *  `double_attack` keyword and the target is the opposing leader, 2 life cards
 *  are flipped in sequence. A trigger on either flip suspends mid-flow, with
 *  the second flip resumed after RESOLVE_TRIGGER returns the engine to
 *  'damage_resolution'.
 */
function resolveDamage(state: GameState): { state: GameState; events: GameEvent[] } {
  const pa: PendingAttack = state.pendingAttack!;
  const next: GameState = structuredClone(state);
  const start = next.history.length;
  const attacker = next.instances[pa.attackerInstanceId];
  const target = next.instances[pa.targetInstanceId];
  if (!attacker || !target) {
    next.pendingAttack = null;
    next.phase = 'main';
    return { state: next, events: [] };
  }

  const attackerCard = next.cardLibrary[attacker.cardId];
  const targetCard = next.cardLibrary[target.cardId];
  const attackerPower = effectivePower(attackerCard, attacker);
  const targetPower = effectivePower(targetCard, target) + pa.counterBoost;
  const player = next.activePlayer;
  const defenderSide = next.players[OTHER[player]];

  if (targetCard.kind === 'leader') {
    if (attackerPower >= targetPower) {
      // Double Attack flips 2 life cards in sequence (§1.8). Standard attack = 1.
      const lifeFlipsOwed = attackerCard.keywords.includes('double_attack') ? 2 : 1;
      // D7 (CR §10-1-3): [Banish] short-circuits the flip → trash, no trigger.
      const attackerHasBanish = attackerCard.keywords.includes('banish');
      return flipLifeCards(next, OTHER[player], lifeFlipsOwed, start, attackerHasBanish);
    }
  } else if (targetCard.kind === 'character') {
    if (attackerPower >= targetPower) {
      const idx = defenderSide.field.findIndex((i) => i.instanceId === pa.targetInstanceId);
      if (idx !== -1) {
        const removed = defenderSide.field.splice(idx, 1)[0];
        const koedController = removed.controller;
        // Detach DON before trashing (rules-reference.md §1.4 — DON returns rested).
        while (removed.attachedDon.length > 0) {
          defenderSide.donRested.push(removed.attachedDon.shift()!);
        }

        // D19 (CR §8-1-3-4): replacement effect. If the card's effect tags
        // include `replace_ko_to_hand`, the K.O. is REPLACED with "move to
        // hand". Per CR §8-1-3-4 the original processing (trash + on_ko)
        // does NOT occur. V0 always-yes; the optional-decline path is
        // deferred.
        const hasReplaceKo = targetCard.effectTags.includes('replace_ko_to_hand');
        if (hasReplaceKo) {
          defenderSide.hand.push(removed.instanceId);
          next.history.push({ type: 'CARD_KOED', instanceId: pa.targetInstanceId });
        } else {
          defenderSide.trash.push(removed.instanceId);
          next.history.push({ type: 'CARD_KOED', instanceId: pa.targetInstanceId });

          // D14 (CR §8): on_ko dispatch. Fires under the KO'd card's FORMER
          // controller — the player who controlled the dying character. The
          // instance is now in trash; fireEffects still reads it from
          // state.instances which is keyed by instanceId, not zone.
          const after = fireEffects(next, removed.instanceId, 'on_ko', koedController);
          Object.assign(next, after);
        }
      }
    }
  }

  next.pendingAttack = null;
  next.phase = 'main';
  next.history.push({ type: 'PHASE_CHANGED', phase: 'main' });
  return { state: next, events: next.history.slice(start) };
}

/** Flip up to `flipsOwed` life cards for `defenderId`, one at a time.
 *
 *  Per flip:
 *   - If life is empty → lethal, game ends.
 *   - If the top life card has the `trigger` effect tag → suspend into
 *     'trigger_window'. `pendingTrigger.remainingLifeFlips` carries the count
 *     of flips still owed AFTER this one resolves. `resumePhase` is
 *     'damage_resolution' if more flips remain (so resolveTrigger can call
 *     back into this helper), or 'main' if this was the last flip.
 *   - Else → standard "life to hand", continue the loop.
 *
 *  When the loop completes naturally (no triggers, no lethal), the phase is
 *  set to 'main' and pendingAttack is cleared.
 *
 *  `start` is the history index from before any of this attack's events were
 *  appended, so the returned events array includes the entire chain.
 */
function flipLifeCards(
  state: GameState,
  defenderId: PlayerId,
  flipsOwed: number,
  start: number,
  attackerHasBanish: boolean = false,
): { state: GameState; events: GameEvent[] } {
  const next = state;
  const defenderSide = next.players[defenderId];
  const activePlayer = next.activePlayer;

  let remaining = flipsOwed;
  while (remaining > 0) {
    const lifeId = defenderSide.life.shift();
    if (!lifeId) {
      next.result = { winner: activePlayer, reason: 'lethal' };
      next.history.push({ type: 'GAME_ENDED', result: next.result });
      next.pendingAttack = null;
      return { state: next, events: next.history.slice(start) };
    }

    const lifeInst = next.instances[lifeId];
    const lifeCard = lifeInst ? next.cardLibrary[lifeInst.cardId] : null;
    const hasTrigger = !!lifeCard && lifeCard.effectTags.includes('trigger');

    next.history.push({ type: 'LIFE_TAKEN', player: defenderId, instanceId: lifeId });

    // A.3.9: publish on_damage_taken + on_life_changed. No subscribers in V0.
    publishTrigger('on_damage_taken', next, { player: defenderId, lifeId });
    publishTrigger('on_life_changed', next, { player: defenderId, delta: -1, lifeId });

    // D7 (CR §10-1-3): when the attacker has [Banish], the life card is
    // trashed without revealing and Trigger does NOT fire. Short-circuit
    // both the trigger window and the to-hand path.
    if (attackerHasBanish) {
      defenderSide.trash.push(lifeId);
      remaining -= 1;
      continue;
    }

    if (hasTrigger) {
      // Suspend: controller must RESOLVE_TRIGGER. Carry the remaining flip count
      // so the resume path can finish the sequence.
      const flipsAfterThis = remaining - 1;
      next.pendingTrigger = {
        lifeCardInstanceId: lifeId,
        controller: defenderId,
        resumePhase: flipsAfterThis > 0 ? 'damage_resolution' : 'main',
        remainingLifeFlips: flipsAfterThis,
      };
      next.phase = 'trigger_window';
      next.history.push({ type: 'TRIGGER_FLIPPED', player: defenderId, instanceId: lifeId });
      next.history.push({ type: 'PHASE_CHANGED', phase: 'trigger_window' });
      // Keep pendingAttack only if we still need its context after resume; the
      // helper itself doesn't read pa again, so it's safe to clear either way.
      next.pendingAttack = null;
      return { state: next, events: next.history.slice(start) };
    }

    // No trigger: standard "life to hand", move on to next flip if owed.
    defenderSide.hand.push(lifeId);
    remaining -= 1;
  }

  next.pendingAttack = null;
  next.phase = 'main';
  next.history.push({ type: 'PHASE_CHANGED', phase: 'main' });
  return { state: next, events: next.history.slice(start) };
}

/** RESOLVE_TRIGGER: controller activates or declines a flipped life-card trigger.
 *
 *  v0: per-card trigger effects are not yet registered. The TRIGGER_RESOLVED
 *  event carries `activated: boolean` so the UI can clearly distinguish
 *  "trigger declined" (card to hand) vs "trigger activated (effect handler
 *  pending — card to trash per rule_comprehensive.pdf 10-1-5 default)".
 *  Future cards with bespoke trigger effects will dispatch via
 *  cards/effects/templates by tag; the call site goes here.
 *
 *  Resume semantics:
 *   - If pendingTrigger.resumePhase === 'damage_resolution' and there are
 *     more life flips owed (Double Attack), continue the flip loop in place.
 *   - Otherwise restore the stored resumePhase (currently always 'main' for
 *     single-flip attacks).
 */
function resolveTrigger(
  state: GameState,
  player: PlayerId,
  activate: boolean,
): { state: GameState; events: GameEvent[] } {
  if (state.phase !== 'trigger_window' || !state.pendingTrigger) return { state, events: [] };
  if (state.pendingTrigger.controller !== player) return { state, events: [] };

  const next: GameState = structuredClone(state);
  const start = next.history.length;
  const pt = next.pendingTrigger!;
  const lifeCardInstanceId = pt.lifeCardInstanceId;
  const triggerOwner = next.players[pt.controller];

  if (activate) {
    // Phase D / D11 (CR §10-1-5): fire the trigger card's effect tags via
    // dispatch.ts (trigger → draw/searcher/removal/etc.) BEFORE the default
    // trash placement so the effect resolves while the card is still
    // "in flight." Per CR §10-1-5-3 the card then goes to trash unless its
    // text says otherwise — card-specific override semantics are not modeled
    // (those need per-card handlers); the dispatched tags cover the common
    // trigger templates.
    const after = fireEffects(next, lifeCardInstanceId, 'trigger', pt.controller);
    Object.assign(next, after);
    // Re-resolve triggerOwner after Object.assign: fireEffects returns a
    // new state whose `players` subtree replaces next.players, so the
    // earlier `triggerOwner` reference now points to a stale subtree.
    next.players[pt.controller].trash.push(lifeCardInstanceId);
  } else {
    // Decline: card goes to hand as if no trigger was present.
    triggerOwner.hand.push(lifeCardInstanceId);
  }

  next.history.push({
    type: 'TRIGGER_RESOLVED',
    player: pt.controller,
    instanceId: lifeCardInstanceId,
    activated: activate,
  });

  const remaining = pt.remainingLifeFlips;
  next.pendingTrigger = null;

  if (pt.resumePhase === 'damage_resolution' && remaining > 0) {
    // Resume Double Attack mid-flow: keep flipping for the same defender.
    next.phase = 'damage_resolution';
    next.history.push({ type: 'PHASE_CHANGED', phase: 'damage_resolution' });
    return flipLifeCards(next, pt.controller, remaining, start);
  }

  next.phase = pt.resumePhase;
  next.history.push({ type: 'PHASE_CHANGED', phase: pt.resumePhase });
  return { state: next, events: next.history.slice(start) };
}

function effectivePower(card: Card, inst: CardInstance): number {
  let base = 0;
  if (card.kind === 'leader') base = (card as LeaderCard).power;
  if (card.kind === 'character') base = (card as CharacterCard).power;
  // D16 (CR §4-12): turn-scoped power delta from `set_power_zero` etc.
  const modifier = inst.powerModifier ?? 0;
  return base + inst.attachedDon.length * 1000 + modifier;
}

function runEndTurnReshim(state: GameState): { state: GameState; events: GameEvent[] } {
  const next = runEndTurn(state);
  return { state: next, events: [] };
}

function resign(state: GameState, player: PlayerId): { state: GameState; events: GameEvent[] } {
  const next: GameState = structuredClone(state);
  next.result = { winner: OTHER[player], reason: 'resignation' };
  next.history.push({ type: 'GAME_ENDED', result: next.result });
  return { state: next, events: [] };
}
