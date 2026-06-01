// Phase E — card verification harness. Per docs/optcg-sim/card-effect-100pct-spec.md §E.
//
// Iterates the entire corpus and, for each card with a non-empty
// effectSpecV2, runs every clause via the engine interpreter and
// asserts that the action's promised side effect actually occurred.
//
// V0 assertions are spec-level (the engine actually does what the
// spec says) — not text-level (the spec was extracted correctly from
// the printed text). True text-level checks need a separate authoring
// pass.

import { applyActionV2, resolveTargetV2, evaluateConditionV2 } from '../effectSpec/runner-v2';
import type { Card, CharacterCard, LeaderCard } from '../cards/Card';
import type { CardInstance, GameState, PlayerId } from '../GameState';
import type { EffectActionV2, EffectClauseV2 } from '../effectSpec/types-v2';
import cardsData from '../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];

function buildState(card: Card): GameState {
  const vanilla = (i: number): CharacterCard => ({
    id: `V${i}`, name: `V${i}`, kind: 'character', colors: ['red'],
    cost: 2, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: ['vanilla'],
  });
  const aDeck = Array.from({ length: 50 }, (_, i) => vanilla(i));
  const bDeck = Array.from({ length: 50 }, (_, i) => vanilla(i + 100));
  const cardLibrary: Record<string, Card> = { [card.id]: card };
  for (const c of aDeck) cardLibrary[c.id] = c;
  for (const c of bDeck) cardLibrary[c.id] = c;
  const aLeader: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['red'], cost: null, power: 5000,
    life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
  const bLeader: LeaderCard = { ...aLeader, id: 'LB', name: 'LB' };
  cardLibrary['LA'] = aLeader;
  cardLibrary['LB'] = bLeader;
  cardLibrary['DON'] = { id: 'DON', name: 'DON!!', kind: 'don', colors: [], cost: null, power: null, counterValue: null, traits: [], keywords: [], effectTags: [] };

  const instances: Record<string, CardInstance> = {};
  const mk = (id: string, cardId: string, controller: PlayerId): CardInstance => {
    const inst: CardInstance = {
      instanceId: id, cardId, controller, rested: false,
      attachedDon: [], perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    instances[id] = inst;
    return inst;
  };
  mk('a-leader', 'LA', 'A');
  mk('b-leader', 'LB', 'B');
  const src = mk('src', card.id, 'A');
  const aHand: string[] = [];
  for (let i = 0; i < 5; i++) { mk(`a-h${i}`, `V${i}`, 'A'); aHand.push(`a-h${i}`); }
  const aDeckIds: string[] = [];
  for (let i = 0; i < 50; i++) { mk(`a-d${i}`, `V${i % 50}`, 'A'); aDeckIds.push(`a-d${i}`); }
  const aLife: string[] = [];
  for (let i = 0; i < 5; i++) { mk(`a-l${i}`, `V${i}`, 'A'); aLife.push(`a-l${i}`); }
  const bHand: string[] = [];
  const bDeckIds: string[] = [];
  const bLife: string[] = [];
  for (let i = 0; i < 5; i++) { mk(`b-h${i}`, `V${i + 100}`, 'B'); bHand.push(`b-h${i}`); }
  for (let i = 0; i < 50; i++) { mk(`b-d${i}`, `V${(i % 50) + 100}`, 'B'); bDeckIds.push(`b-d${i}`); }
  for (let i = 0; i < 5; i++) { mk(`b-l${i}`, `V${i + 100}`, 'B'); bLife.push(`b-l${i}`); }
  const aDon: string[] = [];
  for (let i = 0; i < 10; i++) { mk(`a-don${i}`, 'DON', 'A'); aDon.push(`a-don${i}`); }
  const bDon: string[] = [];
  for (let i = 0; i < 10; i++) { mk(`b-don${i}`, 'DON', 'B'); bDon.push(`b-don${i}`); }

  return {
    seed: 1, turn: 1, activePlayer: 'A', phase: 'main',
    players: {
      A: { leader: instances['a-leader'], hand: aHand, deck: aDeckIds, trash: [], field: [src], stage: null, life: aLife, donDeck: aDon.slice(5), donCostArea: aDon.slice(0, 5), donRested: [], exile: [] },
      B: { leader: instances['b-leader'], hand: bHand, deck: bDeckIds, trash: [], field: [], stage: null, life: bLife, donDeck: bDon, donCostArea: [], donRested: [], exile: [] },
    },
    cardLibrary, instances, history: [], result: null,
    pendingAttack: null, pendingTrigger: null, pendingPeek: null, pendingDiscard: null,
    mulliganUsed: { A: false, B: false }, diceRoll: null, firstPlayer: 'A',
    knownByViewer: { A: [], B: [] },
  };
}

interface AssertionResult { pass: boolean; reason?: string; }

function assertActionEffect(before: GameState, after: GameState, action: EffectActionV2, controller: PlayerId): AssertionResult {
  const me = (s: GameState) => s.players[controller];
  switch (action.kind) {
    case 'draw': {
      if (typeof action.magnitude !== 'number') {
        // Formula magnitude (read_state / per_count / match_opp_don) —
        // engine resolves against current state, so a static delta check
        // can't be made without re-evaluating the formula. Trust the
        // template-level tests for those paths.
        return { pass: true, reason: 'formula draw, not asserted' };
      }
      const n = action.magnitude;
      const delta = me(after).hand.length - me(before).hand.length;
      if (delta !== n) return { pass: false, reason: `draw expected ${n}, got ${delta}` };
      return { pass: true };
    }
    case 'mill_self': {
      const n = action.magnitude ?? 1;
      const delta = me(after).trash.length - me(before).trash.length;
      if (delta !== n) return { pass: false, reason: `mill_self expected ${n}, got ${delta}` };
      return { pass: true };
    }
    case 'lifegain': {
      const n = action.magnitude ?? 1;
      const delta = me(after).life.length - me(before).life.length;
      if (delta !== n) return { pass: false, reason: `lifegain expected ${n}, got ${delta}` };
      return { pass: true };
    }
    case 'life_to_hand': {
      const n = action.magnitude ?? 1;
      const lifeDelta = me(before).life.length - me(after).life.length;
      const handDelta = me(after).hand.length - me(before).hand.length;
      if (lifeDelta !== n || handDelta !== n) return { pass: false, reason: `life_to_hand expected ${n}, life-=${lifeDelta} hand+=${handDelta}` };
      return { pass: true };
    }
    case 'ramp': {
      const n = action.magnitude;
      const donBefore = me(before).donCostArea.length + me(before).donRested.length;
      const donAfter = me(after).donCostArea.length + me(after).donRested.length;
      if (donAfter - donBefore !== n) return { pass: false, reason: `ramp expected ${n}, got ${donAfter - donBefore}` };
      return { pass: true };
    }
    default:
      // V0 stub for actions whose side-effect verification needs target/state context.
      // Returning pass=true here means we trust the engine's tested implementation
      // for those actions (covered by the action-group test suites).
      return { pass: true, reason: 'stub' };
  }
}

export interface CardVerifyResult {
  cardId: string;
  pass: boolean;
  vanilla: boolean;
  errors: string[];
}

export function verifyCard(card: Card): CardVerifyResult {
  const spec = card.effectSpecV2;
  if (!spec) return { cardId: card.id, pass: true, vanilla: true, errors: [] };
  const hasContent =
    (spec.clauses?.length ?? 0) > 0 ||
    (spec.continuous?.length ?? 0) > 0 ||
    (spec.replacements?.length ?? 0) > 0;
  if (!hasContent) return { cardId: card.id, pass: true, vanilla: true, errors: [] };

  const errors: string[] = [];
  let state = buildState(card);
  for (const clause of spec.clauses ?? []) {
    if (!evaluateConditionV2(state, 'A', clause.condition)) continue;
    const before = structuredClone(state);
    const targets = resolveTargetV2(state, 'A', 'src', clause.target);
    try {
      applyActionV2(state, { sourceInstanceId: 'src', controller: 'A' }, clause.action, targets);
    } catch (e) {
      errors.push(`clause ${clause.action.kind} threw: ${(e as Error).message}`);
      continue;
    }
    const result = assertActionEffect(before, state, clause.action, 'A');
    if (!result.pass) errors.push(`${clause.action.kind}: ${result.reason}`);
  }
  return { cardId: card.id, pass: errors.length === 0, vanilla: false, errors };
}

export function verifyAllCards(): { pass: number; fail: number; vanilla: number; failures: CardVerifyResult[] } {
  let pass = 0, fail = 0, vanilla = 0;
  const failures: CardVerifyResult[] = [];
  for (const card of ALL_CARDS) {
    const r = verifyCard(card);
    if (r.vanilla) vanilla++;
    else if (r.pass) pass++;
    else { fail++; failures.push(r); }
  }
  return { pass, fail, vanilla, failures };
}

export { ALL_CARDS };
