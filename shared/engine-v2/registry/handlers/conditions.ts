/**
 * Engine V2 — atomic condition handlers.
 *
 * Per-kind pure functions over GameState. Combinators (and/or/not) are
 * handled in EffectDispatcher.evaluateCondition before any handler dispatch,
 * so this file registers ONLY atomics.
 *
 * Cross-references:
 * - Implementation spec §3.2
 * - Plan v1 §3.2 (56 atomic) + C31 / C32 (2 new declared)
 * - V1 reference: shared/engine/effectSpec/runner-v2.ts:34-...
 */

import type { Card } from '../../cards/Card.js';
import { totalDon } from '../../state/derived/keyword.js';
import { effectivePower } from '../../state/derived/power.js';
import type { EffectConditionV2 } from '../../spec/types.js';
import type { GameState, PlayerId } from '../../state/types.js';
import {
  type ConditionHandler,
  conditionHandlers,
  type HandlerCtx,
} from '../types.js';

const OTHER: Record<PlayerId, PlayerId> = { A: 'B', B: 'A' };

function leaderCard(state: GameState, side: PlayerId): Card | undefined {
  const inst = state.players[side].leader;
  return state.cardLibrary[inst.cardId] as Card | undefined;
}

function num(c: EffectConditionV2, key: string): number {
  const v = c[key];
  return typeof v === 'number' ? v : 0;
}
function str(c: EffectConditionV2, key: string): string {
  const v = c[key];
  return typeof v === 'string' ? v : '';
}

// ────────────────────────────────────────────────────────────────────
// Always
// ────────────────────────────────────────────────────────────────────

const always: ConditionHandler = () => true;

// ────────────────────────────────────────────────────────────────────
// Leader identity (7)
// ────────────────────────────────────────────────────────────────────

const ifLeaderIs: ConditionHandler = (s, ctx, c) => {
  const card = leaderCard(s, ctx.controller);
  return card?.name === str(c, 'name');
};
const ifLeaderHasTrait: ConditionHandler = (s, ctx, c) => {
  const card = leaderCard(s, ctx.controller);
  return card?.traits.includes(str(c, 'trait')) === true;
};
const ifLeaderHasType: ConditionHandler = (s, ctx, c) => {
  const card = leaderCard(s, ctx.controller);
  const needle = str(c, 'typeString');
  return card?.traits.some((t) => t.includes(needle)) === true;
};
const ifLeaderMulticolored: ConditionHandler = (s, ctx) => {
  const card = leaderCard(s, ctx.controller);
  return (card?.colors.length ?? 0) >= 2;
};
const ifLeaderHasColor: ConditionHandler = (s, ctx, c) => {
  const card = leaderCard(s, ctx.controller);
  return card?.colors.includes(str(c, 'color') as Card['colors'][number]) === true;
};
const ifLeaderPowerMax: ConditionHandler = (s, ctx, c) => {
  const inst = s.players[ctx.controller].leader;
  return effectivePower(s, inst) <= num(c, 'n');
};
const ifLeaderPowerMin: ConditionHandler = (s, ctx, c) => {
  const inst = s.players[ctx.controller].leader;
  return effectivePower(s, inst) >= num(c, 'n');
};
const ifLeaderAttributeIs: ConditionHandler = (s, ctx, c) => {
  const card = leaderCard(s, ctx.controller);
  return card !== undefined && card.attribute === str(c, 'attribute');
};

// ────────────────────────────────────────────────────────────────────
// Resource counts (18)
// ────────────────────────────────────────────────────────────────────

const ifDonMin: ConditionHandler = (s, ctx, c) =>
  s.players[ctx.controller].donCostArea.length >= num(c, 'n');
const ifDonMax: ConditionHandler = (s, ctx, c) =>
  s.players[ctx.controller].donCostArea.length <= num(c, 'n');
const ifOppDonMin: ConditionHandler = (s, ctx, c) =>
  s.players[OTHER[ctx.controller]].donCostArea.length >= num(c, 'n');
const ifOppDonMax: ConditionHandler = (s, ctx, c) =>
  s.players[OTHER[ctx.controller]].donCostArea.length <= num(c, 'n');
const ifOwnDonLeOpp: ConditionHandler = (s, ctx) =>
  s.players[ctx.controller].donCostArea.length <= s.players[OTHER[ctx.controller]].donCostArea.length;
const ifOwnRestedDonMin: ConditionHandler = (s, ctx, c) =>
  s.players[ctx.controller].donRested.length >= num(c, 'n');

const ifOwnLifeLtOpp: ConditionHandler = (s, ctx) =>
  s.players[ctx.controller].life.length < s.players[OTHER[ctx.controller]].life.length;
const ifOwnLifeLeOpp: ConditionHandler = (s, ctx) =>
  s.players[ctx.controller].life.length <= s.players[OTHER[ctx.controller]].life.length;
const ifOwnLifeMax: ConditionHandler = (s, ctx, c) =>
  s.players[ctx.controller].life.length <= num(c, 'n');
const ifOwnLifeMin: ConditionHandler = (s, ctx, c) =>
  s.players[ctx.controller].life.length >= num(c, 'n');
const ifOppLifeMax: ConditionHandler = (s, ctx, c) =>
  s.players[OTHER[ctx.controller]].life.length <= num(c, 'n');
const ifOppLifeMin: ConditionHandler = (s, ctx, c) =>
  s.players[OTHER[ctx.controller]].life.length >= num(c, 'n');

const ifHandMax: ConditionHandler = (s, ctx, c) =>
  s.players[ctx.controller].hand.length <= num(c, 'n');
const ifHandMin: ConditionHandler = (s, ctx, c) =>
  s.players[ctx.controller].hand.length >= num(c, 'n');
const ifOppHandMax: ConditionHandler = (s, ctx, c) =>
  s.players[OTHER[ctx.controller]].hand.length <= num(c, 'n');
const ifOppHandMin: ConditionHandler = (s, ctx, c) =>
  s.players[OTHER[ctx.controller]].hand.length >= num(c, 'n');

const ifTrashMin: ConditionHandler = (s, ctx, c) =>
  s.players[ctx.controller].trash.length >= num(c, 'n');
const ifTrashMax: ConditionHandler = (s, ctx, c) =>
  s.players[ctx.controller].trash.length <= num(c, 'n');
const ifOwnDeckMin: ConditionHandler = (s, ctx, c) =>
  s.players[ctx.controller].deck.length >= num(c, 'n');
const ifOwnDeckMax: ConditionHandler = (s, ctx, c) =>
  s.players[ctx.controller].deck.length <= num(c, 'n');

const ifTotalDonMin: ConditionHandler = (s, ctx, c) =>
  totalDon(s, ctx.controller) >= num(c, 'n');

// ────────────────────────────────────────────────────────────────────
// Field state (subset — character-count variants)
// ────────────────────────────────────────────────────────────────────

function charsOnField(state: GameState, side: PlayerId): number {
  return state.players[side].field.length;
}

const ifOwnCharsMin: ConditionHandler = (s, ctx, c) =>
  charsOnField(s, ctx.controller) >= num(c, 'n');
const ifOwnCharsMinRested: ConditionHandler = (s, ctx, c) =>
  s.players[ctx.controller].field.filter((i) => i.rested === true).length >= num(c, 'n');
const ifOppCharsMin: ConditionHandler = (s, ctx, c) =>
  charsOnField(s, OTHER[ctx.controller]) >= num(c, 'n');
const ifOppCharsMinRested: ConditionHandler = (s, ctx, c) =>
  s.players[OTHER[ctx.controller]].field.filter((i) => i.rested === true).length >= num(c, 'n');

const ifSelfActive: ConditionHandler = (s, ctx) => {
  const inst = s.instances[ctx.sourceInstanceId];
  return inst !== undefined && inst.rested === false;
};
const ifSelfRested: ConditionHandler = (s, ctx) => {
  const inst = s.instances[ctx.sourceInstanceId];
  return inst !== undefined && inst.rested === true;
};
const ifSelfKodByOppEffect: ConditionHandler = (s, ctx) => {
  const top = s.koSourceStack[s.koSourceStack.length - 1];
  if (top === undefined) return false;
  return top.instanceId === ctx.sourceInstanceId && top.source === 'opp_effect';
};

const isOppTurn: ConditionHandler = (s, ctx) => s.activePlayer !== ctx.controller;
const isOwnTurn: ConditionHandler = (s, ctx) => s.activePlayer === ctx.controller;
const duringOppTurn: ConditionHandler = (s, ctx) => s.activePlayer !== ctx.controller;

// ────────────────────────────────────────────────────────────────────
// Registration
// ────────────────────────────────────────────────────────────────────

export function registerConditionHandlers(): void {
  conditionHandlers.register('always', always);

  // Leader identity (7)
  conditionHandlers.register('if_leader_is', ifLeaderIs);
  conditionHandlers.register('if_leader_has_trait', ifLeaderHasTrait);
  conditionHandlers.register('if_leader_has_type', ifLeaderHasType);
  conditionHandlers.register('if_leader_multicolored', ifLeaderMulticolored);
  conditionHandlers.register('if_leader_has_color', ifLeaderHasColor);
  conditionHandlers.register('if_leader_power_max', ifLeaderPowerMax);
  conditionHandlers.register('if_leader_power_min', ifLeaderPowerMin);
  conditionHandlers.register('if_leader_attribute_is', ifLeaderAttributeIs);

  // Resource counts (18)
  conditionHandlers.register('if_don_min', ifDonMin);
  conditionHandlers.register('if_don_max', ifDonMax);
  conditionHandlers.register('if_opp_don_min', ifOppDonMin);
  conditionHandlers.register('if_opp_don_max', ifOppDonMax);
  conditionHandlers.register('if_own_don_le_opp', ifOwnDonLeOpp);
  conditionHandlers.register('if_own_rested_don_min', ifOwnRestedDonMin);
  conditionHandlers.register('if_own_life_lt_opp', ifOwnLifeLtOpp);
  conditionHandlers.register('if_own_life_le_opp', ifOwnLifeLeOpp);
  conditionHandlers.register('if_own_life_max', ifOwnLifeMax);
  conditionHandlers.register('if_own_life_min', ifOwnLifeMin);
  conditionHandlers.register('if_opp_life_max', ifOppLifeMax);
  conditionHandlers.register('if_opp_life_min', ifOppLifeMin);
  conditionHandlers.register('if_hand_max', ifHandMax);
  conditionHandlers.register('if_hand_min', ifHandMin);
  conditionHandlers.register('if_opp_hand_max', ifOppHandMax);
  conditionHandlers.register('if_opp_hand_min', ifOppHandMin);
  conditionHandlers.register('if_trash_min', ifTrashMin);
  conditionHandlers.register('if_trash_max', ifTrashMax);
  conditionHandlers.register('if_own_deck_min', ifOwnDeckMin);
  conditionHandlers.register('if_own_deck_max', ifOwnDeckMax);
  conditionHandlers.register('if_total_don_min', ifTotalDonMin);

  // Field state (subset)
  conditionHandlers.register('if_own_chars_min', ifOwnCharsMin);
  conditionHandlers.register('if_own_chars_min_rested', ifOwnCharsMinRested);
  conditionHandlers.register('if_opp_chars_min', ifOppCharsMin);
  conditionHandlers.register('if_opp_chars_min_rested', ifOppCharsMinRested);
  conditionHandlers.register('if_self_active', ifSelfActive);
  conditionHandlers.register('if_self_rested', ifSelfRested);
  conditionHandlers.register('if_self_kod_by_opp_effect', ifSelfKodByOppEffect);

  // Turn (3)
  conditionHandlers.register('is_opp_turn', isOppTurn);
  conditionHandlers.register('is_own_turn', isOwnTurn);
  conditionHandlers.register('during_opp_turn', duringOppTurn);
}

// suppress unused-imports warnings for forward-compat
export type { HandlerCtx };
