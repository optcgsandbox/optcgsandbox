// EB01-040 Kyros (leader).
//   "[Activate: Main] [Once Per Turn] You may turn 1 card from the top
//    of your Life cards face-up: K.O. up to 1 of your opponent's
//    Characters with a cost of 0."
//
// V0 engine note: flipLife cost is implemented as "trash 1 life from top"
// rather than literal face-up flip. The on-attack life-flip trigger
// mechanic is deferred. This test verifies the V0 semantics: a life card
// is consumed when paying the cost.
import { describe, expect, it } from 'vitest';
import { applyActionV2, resolveTargetV2 } from '../../effectSpec/runner-v2';
import { canPayClauseCost, payClauseCost } from '../../effectSpec/replacements-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_040 = ALL_CARDS.find(c => c.id === 'EB01-040')!;

function boot() {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['black'], cost: null,
    power: 5000, life: 5, counterValue: null, traits: ['Dressrosa'], keywords: [], effectTags: [],
  };
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['black'],
    cost: 2, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: ['vanilla'],
  }));
  let s = initialState({
    seed: 1,
    decks: { A: { leader: lead, cards: filler }, B: { leader: { ...lead, id: 'LB', name: 'LB', traits: [] }, cards: filler } },
  });
  s = setupGame(s);
  s = closeMulliganKeepBoth(s);
  s = endTurn(s); s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
  s = endTurn(s); s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
  return s;
}

function placeOppChar(s: any, id: string, cost: number) {
  const c: CharacterCard = {
    id: `C_${id}`, name: id, kind: 'character', colors: ['black'],
    cost, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances[id] = {
    instanceId: id, cardId: c.id, controller: 'B',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.B.field.push(s.instances[id]);
}

describe('EB01-040 — Kyros (leader)', () => {
  const clause = EB01_040.effectSpecV2!.clauses![0];

  it('cost flipLife:1 payable when life >= 1', () => {
    const s = boot();
    expect(canPayClauseCost(s, 'A', s.players.A.leader.instanceId, clause.cost!)).toBe(true);
  });

  it('cost flipLife:1 NOT payable when life empty', () => {
    const s = boot();
    s.players.A.life = [];
    expect(canPayClauseCost(s, 'A', s.players.A.leader.instanceId, clause.cost!)).toBe(false);
  });

  it('paying cost consumes 1 life card (V0 trashes face-up flip)', () => {
    const s = boot();
    const lifeBefore = s.players.A.life.length;
    payClauseCost(s, 'A', s.players.A.leader.instanceId, clause.cost!);
    expect(s.players.A.life.length).toBe(lifeBefore - 1);
  });

  it('target includes cost-0 opp char', () => {
    const s = boot();
    placeOppChar(s, 'z', 0);
    const ids = resolveTargetV2(s, 'A', 'src', clause.target);
    expect(ids).toContain('z');
  });

  it('target excludes cost-1 opp char (cap is 0)', () => {
    const s = boot();
    placeOppChar(s, 'one', 1);
    const ids = resolveTargetV2(s, 'A', 'src', clause.target);
    expect(ids).not.toContain('one');
  });

  it('action KOs cost-0 target', () => {
    const s = boot();
    placeOppChar(s, 'z', 0);
    applyActionV2(s, { sourceInstanceId: s.players.A.leader.instanceId, controller: 'A' }, clause.action, ['z']);
    expect(s.players.B.field.some((i: { instanceId: string }) => i.instanceId === 'z')).toBe(false);
    expect(s.players.B.trash).toContain('z');
  });
});
