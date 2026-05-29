// Action handlers. Pure functions: (state, action) → next state.
// Routes by action.type to per-handler logic. Source: rules-reference.md §1.4–§1.6.
//
// V0 simplifications:
// - Blocker / counter / trigger windows are NOT modeled yet; attacks resolve immediately
//   on declaration. This keeps the v0 engine playable end-to-end while we layer in
//   reactive windows in v0.1.
// - Card-specific effects (on_play, when_attacking, etc.) are not yet wired.

import type { Action } from '../protocol/actions';
import type { Card, CharacterCard, LeaderCard } from './cards/Card';
import type { CardInstance, GameEvent, GameState, PlayerId } from './GameState';
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
      return resolveAttack(state, player, action.attackerInstanceId, action.targetInstanceId);
    case 'END_TURN':
      return runEndTurnReshim(state);
    case 'RESIGN':
      return resign(state, player);
    case 'MULLIGAN_CONFIRM':
    case 'ACTIVATE_MAIN':
    case 'DECLARE_BLOCKER':
    case 'PLAY_COUNTER':
    case 'SKIP_COUNTER':
    case 'SKIP_BLOCKER':
    case 'RESOLVE_TRIGGER':
      // v0.1 hooks — return state untouched for now.
      return { state, events: [] };
  }
}

function playCard(
  state: GameState,
  player: PlayerId,
  instanceId: string,
  replaceTargetId: string | null,
): { state: GameState; events: GameEvent[] } {
  const next: GameState = structuredClone(state);
  const p = next.players[player];
  const inst = next.instances[instanceId];
  if (!inst || inst.controller !== player) return { state, events: [] };

  const handIdx = p.hand.indexOf(instanceId);
  if (handIdx === -1) return { state, events: [] };

  const card = next.cardLibrary[inst.cardId];
  if (card.cost === null || card.cost > p.donActive) return { state, events: [] };

  // Pay cost: rest N DON.
  p.donActive -= card.cost;
  p.donRested += card.cost;

  p.hand.splice(handIdx, 1);

  if (card.kind === 'character') {
    if (replaceTargetId) {
      const replaceIdx = p.field.findIndex((c) => c.instanceId === replaceTargetId);
      if (replaceIdx !== -1) {
        const removed = p.field.splice(replaceIdx, 1)[0];
        p.trash.push(removed.instanceId);
        next.history.push({ type: 'CARD_KOED', instanceId: removed.instanceId });
      }
    }
    p.field.push(inst);
  } else if (card.kind === 'stage') {
    // Stages replace the previous stage (if any). v0: no stage slot — push to field.
    p.field.push(inst);
  } else if (card.kind === 'event') {
    // Events resolve immediately and go to trash. v0: no effect, just trash.
    p.trash.push(instanceId);
  }

  next.history.push({ type: 'CARD_PLAYED', player, instanceId, cost: card.cost });
  return { state: next, events: [next.history[next.history.length - 1]] };
}

function attachDon(
  state: GameState,
  player: PlayerId,
  targetInstanceId: string,
): { state: GameState; events: GameEvent[] } {
  const next: GameState = structuredClone(state);
  const p = next.players[player];
  if (p.donActive <= 0) return { state, events: [] };

  let target: CardInstance | null = null;
  if (p.leader.instanceId === targetInstanceId) target = p.leader;
  else target = p.field.find((i) => i.instanceId === targetInstanceId) ?? null;

  if (!target || target.controller !== player) return { state, events: [] };

  target.attachedDon += 1;
  p.donActive -= 1;
  next.history.push({ type: 'DON_ATTACHED', targetInstanceId, count: 1 });
  return { state: next, events: [next.history[next.history.length - 1]] };
}

function resolveAttack(
  state: GameState,
  player: PlayerId,
  attackerId: string,
  targetId: string,
): { state: GameState; events: GameEvent[] } {
  const next: GameState = structuredClone(state);
  const attackerSide = next.players[player];
  const defenderSide = next.players[OTHER[player]];

  const attacker = findInstance(next, attackerId);
  const target = findInstance(next, targetId);
  if (!attacker || !target) return { state, events: [] };

  // Mark attacker rested + attacked.
  attacker.rested = true;
  attacker.perTurn.hasAttacked = true;

  next.history.push({ type: 'ATTACK_DECLARED', attacker: attackerId, target: targetId });

  const attackerCard = next.cardLibrary[attacker.cardId];
  const targetCard = next.cardLibrary[target.cardId];
  const attackerPower = effectivePower(attackerCard, attacker);
  const targetPower = effectivePower(targetCard, target);

  if (targetCard.kind === 'leader') {
    // Attack on leader → take a life card (top to hand) UNLESS attacker power < target.
    if (attackerPower < targetPower) {
      // Whiff. Per §1.6 unmatched leader attack does nothing.
      return { state: next, events: [] };
    }
    const lifeId = defenderSide.life.shift();
    if (lifeId) {
      defenderSide.hand.push(lifeId);
      next.history.push({ type: 'LIFE_TAKEN', player: OTHER[player], instanceId: lifeId });
    } else {
      // No life cards left → final attack = lethal.
      next.result = { winner: player, reason: 'lethal' };
      next.history.push({ type: 'GAME_ENDED', result: next.result });
    }
  } else if (targetCard.kind === 'character') {
    if (attackerPower >= targetPower) {
      const idx = defenderSide.field.findIndex((i) => i.instanceId === targetId);
      if (idx !== -1) {
        const removed = defenderSide.field.splice(idx, 1)[0];
        // Detached DON returns to opponent's rested pool.
        defenderSide.donRested += removed.attachedDon;
        removed.attachedDon = 0;
        defenderSide.trash.push(removed.instanceId);
        next.history.push({ type: 'CARD_KOED', instanceId: targetId });
      }
    }
    // attackerPower < targetPower → attack fizzles.
  }

  return { state: next, events: [] };
}

function effectivePower(card: Card, inst: CardInstance): number {
  let base = 0;
  if (card.kind === 'leader') base = (card as LeaderCard).power;
  if (card.kind === 'character') base = (card as CharacterCard).power;
  return base + inst.attachedDon * 1000;
}

function findInstance(state: GameState, id: string): CardInstance | null {
  return state.instances[id] ?? null;
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
