// Hard AI — 1-ply lookahead + state-value heuristic. Per
// docs/optcg-sim/ai-design.md §3.3.
//
// For each legal action: simulate via applyAction → score the resulting state
// with a heuristic that reads only zones the AI is allowed to inspect
// (no opp hand peek, no own life peek, no own deck order peek). Pick the
// action with the highest score; ties broken by category preference.
//
// The simulator (applyAction) runs on the REAL GameState because physics
// requires it — but the EVALUATION function refuses to read hidden info, so
// the AI never makes a decision contingent on knowledge a human player
// wouldn't have.

import type { Action } from '../../protocol/actions';
import { applyAction } from '../applyAction';
import type { Card, CharacterCard, LeaderCard } from '../cards/Card';
import type { CardInstance, GameState, PlayerId } from '../GameState';
import { getLegalActions } from '../rules/legality';
import type { AiDriver, AiTier } from './AiDriver';
import { drawProbability } from '../view/viewForPlayer';

export class HardAi implements AiDriver {
  readonly tier: AiTier = 'hard';

  async chooseAction(state: GameState, player: PlayerId, _deadlineMs: number): Promise<Action> {
    const legal = getLegalActions(state, player).filter((a) => a.type !== 'RESIGN');
    if (legal.length === 0) return { type: 'END_TURN' };

    let bestAction: Action = legal[0];
    let bestScore = -Infinity;

    for (const action of legal) {
      // 1-ply: simulate this action on the real state. applyAction is pure,
      // so the original state is unaffected. Reactive windows (block_window /
      // counter_window / trigger_window) are auto-resolved with the most-
      // likely outcome so the evaluator sees the post-resolution position.
      let nextState: GameState;
      try {
        nextState = simulateAction(state, player, action);
      } catch {
        continue;
      }

      // Score the resulting position from this player's perspective. The
      // evaluator NEVER reads hidden zones (see evaluateForPlayer).
      const score = evaluateForPlayer(nextState, player) + categoryBonus(action, state, player);
      if (score > bestScore) {
        bestScore = score;
        bestAction = action;
      }
    }
    return bestAction;
  }
}

/** Simulate `action` then auto-resolve any reactive windows (block / counter
 *  / trigger) with the most-likely outcome so the lookahead sees a state we
 *  can score.
 *
 *  Most-likely outcomes for V0:
 *    - block_window  → opp skips (no blocker played).
 *    - counter_window → opp skips (no counter played).
 *    - trigger_window → trigger declined (controller doesn't activate).
 *
 *  This is the optimistic-attacker / passive-defender assumption. For V0 it
 *  works because counters are sparse mid-game; future Hard tiers can model
 *  opp's reactive options probabilistically. */
function simulateAction(state: GameState, player: PlayerId, action: Action): GameState {
  let s = applyAction(state, player, action).state;
  let safety = 0;
  while (safety++ < 32) {
    const opp: PlayerId = player === 'A' ? 'B' : 'A';
    if (s.phase === 'block_window') {
      s = applyAction(s, opp, { type: 'SKIP_BLOCKER' }).state;
      continue;
    }
    if (s.phase === 'counter_window') {
      s = applyAction(s, opp, { type: 'SKIP_COUNTER' }).state;
      continue;
    }
    if (s.phase === 'trigger_window' && s.pendingTrigger) {
      const owner = s.pendingTrigger.controller;
      // V3-8: simulate both branches (activate vs decline) and pick the one
      // that produces a higher position score from the original `player`'s
      // perspective. Owner is whoever's life flipped, NOT necessarily `player`.
      const decline = applyAction(s, owner, { type: 'RESOLVE_TRIGGER', activate: false, targetInstanceId: null }).state;
      const activate = applyAction(s, owner, { type: 'RESOLVE_TRIGGER', activate: true, targetInstanceId: null }).state;
      // If owner === player we want to maximize player's score; if owner is opp,
      // we still pick from player's perspective (worst-case modelling).
      const declineScore = evaluateForPlayer(decline, player);
      const activateScore = evaluateForPlayer(activate, player);
      s = activateScore > declineScore ? activate : decline;
      continue;
    }
    break;
  }
  return s;
}

// ──────────────────────────────────────────────────────────────────────
// State value
// ──────────────────────────────────────────────────────────────────────

/** Heuristic position score from `viewer`'s perspective. Higher = better.
 *
 *  Only reads info `viewer` is legitimately allowed to inspect:
 *    - own hand (full)         - opp hand (count only)
 *    - own/opp field (full)    - own/opp leader/stage (full)
 *    - own/opp trash (full)    - own/opp life (count only)
 *    - own/opp DON areas (full — DON identity is universal)
 *
 *  Does NOT read: opp hand card identities, opp deck card identities, life
 *  card identities, own deck order. Reading those would let the AI cheat.
 *
 *  Tuned by playtesting; weights live in WEIGHTS below.
 */
export function evaluateForPlayer(state: GameState, viewer: PlayerId): number {
  // Terminal results dominate everything else.
  if (state.result) {
    if (state.result.winner === viewer) return 1_000_000;
    if (state.result.winner === 'draw') return 0;
    return -1_000_000;
  }

  const opp: PlayerId = viewer === 'A' ? 'B' : 'A';
  const me = state.players[viewer];
  const them = state.players[opp];

  // Life advantage — primary axis. Each life is roughly worth a 5000-power
  // attack absorbed for free.
  const lifeAdv = (me.life.length - them.life.length) * WEIGHTS.lifePerCard;

  // Board power. Sum of effective powers (printed + attached DON). Cards that
  // can't attack this turn (summoning sick, already attacked, rested) are
  // discounted because they don't pressure opp on this turn.
  const myBoard = fieldPowerSum(state, me.field, me.leader, /*tempo=*/true);
  const oppBoard = fieldPowerSum(state, them.field, them.leader, /*tempo=*/false);
  const boardAdv = (myBoard - oppBoard) * WEIGHTS.powerPerPoint;

  // Hand size — proxy for resources + counter availability.
  const handAdv = (me.hand.length - them.hand.length) * WEIGHTS.handPerCard;

  // DON economy. Active DON in cost area can be spent this turn; rested DON
  // will refresh next turn. Both contribute, active more so.
  const myDon = me.donCostArea.length * WEIGHTS.donActive + me.donRested.length * WEIGHTS.donRested;
  const oppDon = them.donCostArea.length * WEIGHTS.donActive + them.donRested.length * WEIGHTS.donRested;
  const donAdv = myDon - oppDon;

  // Threat presence — heavy opp characters on board are dangerous. Subtract
  // a non-linear bonus for opp's biggest threat so the AI prioritises removal.
  const biggestOppThreat = biggestThreatPower(state, them.field);
  const threatPenalty = (biggestOppThreat / 1000) * WEIGHTS.threatPerKilo;

  // Lethal pressure — if our committed-power swing this turn equals or beats
  // (opp.leader.power + (opp.life × 1000)) we have a clean win on board.
  // Use a small bonus to reward "near lethal" states even if not quite there.
  const swing = mySwingableThisTurn(state, viewer);
  const oppDefence = effectivePower(state.cardLibrary[them.leader.cardId], them.leader)
    + them.life.length * WEIGHTS.lethalLifeDiscount;
  const lethalBonus = swing >= oppDefence ? WEIGHTS.lethalBonus : 0;

  // Draw-probability term — small bias toward holding DON when residual is
  // heavy on high-cost finishers. Encourages "save resources for the topdeck"
  // mindset on near-empty hand turns.
  const finisherP = drawProbability(state, viewer, (c) => isFinisher(c));
  const drawTerm = finisherP * WEIGHTS.drawFinisher;

  return lifeAdv + boardAdv + handAdv + donAdv - threatPenalty + lethalBonus + drawTerm;
}

const WEIGHTS = {
  lifePerCard: 5000,
  powerPerPoint: 1,
  handPerCard: 300,
  donActive: 250,
  donRested: 150,
  threatPerKilo: 200,
  lethalLifeDiscount: 1000,
  lethalBonus: 50_000,
  drawFinisher: 800,
};

function fieldPowerSum(
  state: GameState,
  field: CardInstance[],
  leader: CardInstance,
  tempo: boolean,
): number {
  let sum = 0;
  // Leader contributes if not rested + hasn't attacked.
  const leaderCard = state.cardLibrary[leader.cardId];
  const leaderUsable = tempo ? !leader.rested && !leader.perTurn.hasAttacked : true;
  if (leaderUsable) sum += effectivePower(leaderCard, leader);
  for (const inst of field) {
    const card = state.cardLibrary[inst.cardId];
    if (!card || card.kind !== 'character') continue;
    const usable = tempo
      ? !inst.summoningSick && !inst.rested && !inst.perTurn.hasAttacked
      : true;
    if (usable) sum += effectivePower(card, inst);
  }
  return sum;
}

function biggestThreatPower(state: GameState, field: CardInstance[]): number {
  let max = 0;
  for (const inst of field) {
    const card = state.cardLibrary[inst.cardId];
    if (!card || card.kind !== 'character') continue;
    const p = effectivePower(card, inst);
    if (p > max) max = p;
  }
  return max;
}

function mySwingableThisTurn(state: GameState, viewer: PlayerId): number {
  // Sum of effective power of attackers that COULD swing this turn (not
  // rested, not already attacked, not summoning sick for characters). Used
  // as an upper bound on this-turn pressure.
  const me = state.players[viewer];
  return fieldPowerSum(state, me.field, me.leader, /*tempo=*/true);
}

function effectivePower(card: Card | undefined, inst: CardInstance): number {
  let base = 0;
  if (card?.kind === 'leader') base = (card as LeaderCard).power;
  if (card?.kind === 'character') base = (card as CharacterCard).power;
  const mod = inst.powerModifier ?? 0;
  return Math.max(0, base + inst.attachedDon.length * 1000 + mod);
}

function isFinisher(card: Card): boolean {
  if (card.kind !== 'character') return false;
  return (card.cost ?? 0) >= 7 || (card.power ?? 0) >= 8000;
}

// ──────────────────────────────────────────────────────────────────────
// Category bias
// ──────────────────────────────────────────────────────────────────────

/** Small additive bias by action category. Keeps the AI from picking
 *  cosmetically-equal options arbitrarily (e.g. attaching DON to a leader
 *  that already attacked is "harmless" by heuristic but wastes a DON). */
function categoryBonus(action: Action, state: GameState, me: PlayerId): number {
  if (action.type === 'END_TURN') return -500;
  if (action.type === 'SKIP_BLOCKER' || action.type === 'SKIP_COUNTER') return -100;
  if (action.type === 'DECLARE_ATTACK') {
    // Mild bias toward leader attacks once opp life is low — heuristic
    // already rewards lethal, this just nudges between equal-value options.
    const opp: PlayerId = me === 'A' ? 'B' : 'A';
    const target = state.instances[action.targetInstanceId];
    if (target && target.instanceId === state.players[opp].leader.instanceId) {
      return state.players[opp].life.length <= 1 ? 5000 : 100;
    }
    return 50;
  }
  if (action.type === 'ATTACH_DON') {
    // Penalise attaching to a unit that's already used its action this turn.
    const target = state.instances[action.targetInstanceId];
    if (target && (target.rested || target.perTurn.hasAttacked)) return -2000;
    return 100;
  }
  if (action.type === 'PLAY_CARD') return 200;
  return 0;
}
