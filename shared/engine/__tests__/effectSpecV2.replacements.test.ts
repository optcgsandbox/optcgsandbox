import { describe, expect, it } from 'vitest';
import { tryApplyReplacement } from '../effectSpec/replacements-v2';
import { initialState } from '../GameState';
import { setupGame } from '../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../cards/Card';
import type { ReplacementEffectV2 } from '../effectSpec/types-v2';
import { closeMulliganKeepBoth, setDonActive } from './_donHelpers';

function makeLeader(id: string): LeaderCard {
  return {
    id, name: id, kind: 'leader', colors: ['red'], cost: null, power: 5000,
    life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
}
function makeChar(id: string, opts: { cost?: number; power?: number; traits?: string[] } = {}): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['red'],
    cost: opts.cost ?? 2, power: opts.power ?? 3000,
    counterValue: 1000, traits: opts.traits ?? [], keywords: [], effectTags: ['vanilla'],
  };
}
function placeOnField(state: any, controller: 'A' | 'B', card: CharacterCard, instanceId: string) {
  state.cardLibrary[card.id] = card;
  state.instances[instanceId] = {
    instanceId, cardId: card.id, controller,
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  state.players[controller].field.push(state.instances[instanceId]);
}
function boot() {
  const cards: Card[] = Array.from({ length: 50 }, (_, i) => makeChar(`C${i}`));
  let s = initialState({
    seed: 1,
    decks: { A: { leader: makeLeader('LA'), cards }, B: { leader: makeLeader('LB'), cards } },
  });
  s = setupGame(s);
  s = closeMulliganKeepBoth(s);
  s = endTurn(s);
  s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
  return s;
}

describe('EffectSpec v2 — tryApplyReplacement', () => {
  it('no matching replacement → replaced: false', () => {
    const s = boot();
    placeOnField(s, 'A', makeChar('R1'), 'r1');
    const result = tryApplyReplacement(s, { sourceInstanceId: 'r1', controller: 'A' }, 'would_be_ko', []);
    expect(result.replaced).toBe(false);
  });

  it('matching replacement fires action and returns replaced: true', () => {
    const s = boot();
    placeOnField(s, 'A', makeChar('R2'), 'r2');
    const repl: ReplacementEffectV2 = {
      trigger: 'would_be_ko',
      action: { kind: 'draw', magnitude: 1 },
      conditional: false,
      verified: 'ground-truth',
    };
    const handBefore = s.players.A.hand.length;
    const result = tryApplyReplacement(s, { sourceInstanceId: 'r2', controller: 'A' }, 'would_be_ko', [repl]);
    expect(result.replaced).toBe(true);
    expect(result.state.players.A.hand.length).toBe(handBefore + 1);
  });

  it('discardHand cost is paid before replacement fires', () => {
    const s = boot();
    placeOnField(s, 'A', makeChar('R3'), 'r3');
    s.players.A.hand = ['h1', 'h2', 'h3'];
    const repl: ReplacementEffectV2 = {
      trigger: 'would_be_ko',
      cost: { discardHand: 1 },
      action: { kind: 'draw', magnitude: 1 },
      conditional: true,
      verified: 'ground-truth',
    };
    const result = tryApplyReplacement(s, { sourceInstanceId: 'r3', controller: 'A' }, 'would_be_ko', [repl]);
    expect(result.replaced).toBe(true);
    // 1 discard (hand 3→2) + 1 draw (hand 2→3). Net same length, but trash grew.
    expect(result.state.players.A.trash.length).toBeGreaterThan(0);
  });

  it('donCost cost is paid before replacement fires', () => {
    const s = boot();
    placeOnField(s, 'A', makeChar('R4'), 'r4');
    setDonActive(s, 'A', 3);
    const repl: ReplacementEffectV2 = {
      trigger: 'would_be_ko',
      cost: { donCost: 2 },
      action: { kind: 'draw', magnitude: 1 },
      conditional: true,
      verified: 'ground-truth',
    };
    const result = tryApplyReplacement(s, { sourceInstanceId: 'r4', controller: 'A' }, 'would_be_ko', [repl]);
    expect(result.replaced).toBe(true);
    expect(result.state.players.A.donCostArea.length).toBe(1);
    expect(result.state.players.A.donRested.length).toBe(2);
  });

  it('donCostReturnToDeck returns DON to DON deck (not rested)', () => {
    const s = boot();
    placeOnField(s, 'A', makeChar('R5'), 'r5');
    setDonActive(s, 'A', 3);
    const beforeDeck = s.players.A.donDeck.length;
    const repl: ReplacementEffectV2 = {
      trigger: 'would_be_ko',
      cost: { donCostReturnToDeck: 1 },
      action: { kind: 'draw', magnitude: 1 },
      conditional: true,
      verified: 'ground-truth',
    };
    const result = tryApplyReplacement(s, { sourceInstanceId: 'r5', controller: 'A' }, 'would_be_ko', [repl]);
    expect(result.replaced).toBe(true);
    expect(result.state.players.A.donDeck.length).toBe(beforeDeck + 1);
  });

  it('conditional cost that cannot be paid skips the replacement', () => {
    const s = boot();
    placeOnField(s, 'A', makeChar('R6'), 'r6');
    s.players.A.hand = []; // cannot discard
    setDonActive(s, 'A', 0); // cannot pay DON
    const repl: ReplacementEffectV2 = {
      trigger: 'would_be_ko',
      cost: { discardHand: 1 },
      action: { kind: 'draw', magnitude: 1 },
      conditional: true,
      verified: 'ground-truth',
    };
    const result = tryApplyReplacement(s, { sourceInstanceId: 'r6', controller: 'A' }, 'would_be_ko', [repl]);
    expect(result.replaced).toBe(false);
  });

  it('non-matching trigger leaves state unchanged', () => {
    const s = boot();
    placeOnField(s, 'A', makeChar('R7'), 'r7');
    const repl: ReplacementEffectV2 = {
      trigger: 'would_be_ko',
      action: { kind: 'draw', magnitude: 1 },
      conditional: false,
      verified: 'ground-truth',
    };
    const before = JSON.stringify(s);
    const result = tryApplyReplacement(s, { sourceInstanceId: 'r7', controller: 'A' }, 'would_take_damage', [repl]);
    expect(result.replaced).toBe(false);
    expect(JSON.stringify(result.state)).toBe(before);
  });

  it('condition filter skips replacements that don\'t apply', () => {
    const s = boot();
    placeOnField(s, 'A', makeChar('R8'), 'r8');
    const repl: ReplacementEffectV2 = {
      trigger: 'would_be_ko',
      condition: { type: 'if_leader_is', name: 'Buggy' },
      action: { kind: 'draw', magnitude: 1 },
      conditional: false,
      verified: 'ground-truth',
    };
    const result = tryApplyReplacement(s, { sourceInstanceId: 'r8', controller: 'A' }, 'would_be_ko', [repl]);
    expect(result.replaced).toBe(false);
  });

  it('first matching replacement wins (later ones not evaluated)', () => {
    const s = boot();
    placeOnField(s, 'A', makeChar('R9'), 'r9');
    const repls: ReplacementEffectV2[] = [
      { trigger: 'would_be_ko', action: { kind: 'draw', magnitude: 2 }, conditional: false, verified: 'ground-truth' },
      { trigger: 'would_be_ko', action: { kind: 'draw', magnitude: 5 }, conditional: false, verified: 'ground-truth' },
    ];
    const handBefore = s.players.A.hand.length;
    const result = tryApplyReplacement(s, { sourceInstanceId: 'r9', controller: 'A' }, 'would_be_ko', repls);
    expect(result.replaced).toBe(true);
    expect(result.state.players.A.hand.length).toBe(handBefore + 2);
  });

  it('trashSelf cost moves source from field to trash', () => {
    const s = boot();
    placeOnField(s, 'A', makeChar('R10'), 'r10');
    const repl: ReplacementEffectV2 = {
      trigger: 'would_be_ko',
      cost: { trashSelf: true },
      action: { kind: 'draw', magnitude: 1 },
      conditional: false,
      verified: 'ground-truth',
    };
    const result = tryApplyReplacement(s, { sourceInstanceId: 'r10', controller: 'A' }, 'would_be_ko', [repl]);
    expect(result.replaced).toBe(true);
    expect(result.state.players.A.field.find((i) => i.instanceId === 'r10')).toBeUndefined();
    expect(result.state.players.A.trash).toContain('r10');
  });
});
