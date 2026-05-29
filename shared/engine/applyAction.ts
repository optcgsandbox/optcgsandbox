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
import type { CardInstance, GameEvent, GameState, PlayerId, PendingAttack } from './GameState';
import { endTurn as runEndTurn } from './phases/turn';

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
    case 'MULLIGAN_CONFIRM':
    case 'ACTIVATE_MAIN':
      // v0.1 hooks — return state untouched for now.
      return { state, events: [] };
  }
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
  if (card.cost === null || card.cost > p.donCostArea.length) return { state, events: [] };

  // Pay cost: rest `card.cost` DON from the cost area.
  for (let i = 0; i < card.cost; i++) {
    p.donRested.push(p.donCostArea.shift()!);
  }
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
        next.history.push({ type: 'CARD_KOED', instanceId: removed.instanceId });
      }
    }
    inst.summoningSick = true;
    p.field.push(inst);
  } else if (card.kind === 'stage') {
    p.field.push(inst);
  } else if (card.kind === 'event') {
    p.trash.push(instanceId);
  }

  next.history.push({ type: 'CARD_PLAYED', player, instanceId, cost: card.cost });
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

/** Stage 3a: defender plays a Counter card (or character with counter value). */
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
  if (!card.counterValue || card.counterValue <= 0) return { state, events: [] };

  // Move from hand to trash, add counter boost to pendingAttack.
  p.hand.splice(handIdx, 1);
  p.trash.push(instanceId);
  next.pendingAttack!.counterBoost += card.counterValue;
  next.history.push({ type: 'COUNTER_PLAYED', instanceId, boost: card.counterValue });
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
      return flipLifeCards(next, OTHER[player], lifeFlipsOwed, start);
    }
  } else if (targetCard.kind === 'character') {
    if (attackerPower >= targetPower) {
      const idx = defenderSide.field.findIndex((i) => i.instanceId === pa.targetInstanceId);
      if (idx !== -1) {
        const removed = defenderSide.field.splice(idx, 1)[0];
        // Detach DON before trashing (rules-reference.md §1.4 — DON returns rested).
        while (removed.attachedDon.length > 0) {
          defenderSide.donRested.push(removed.attachedDon.shift()!);
        }
        defenderSide.trash.push(removed.instanceId);
        next.history.push({ type: 'CARD_KOED', instanceId: pa.targetInstanceId });
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
    // v0: card-specific effect resolution is not wired yet. Per
    // rule_comprehensive.pdf 10-1-5 default ("trigger card is trashed unless
    // otherwise specified"), send the card to trash. UI shows "trigger
    // activated" based on the TRIGGER_RESOLVED event below.
    triggerOwner.trash.push(lifeCardInstanceId);
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
  return base + inst.attachedDon.length * 1000;
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
