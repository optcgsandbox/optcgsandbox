// EB01-016 Bingoh.
//   "[Activate: Main] You may rest this Character: K.O. up to 1 of your
//    opponent's rested Characters with a cost of 1 or less."
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
const EB01_016 = ALL_CARDS.find(c => c.id === 'EB01-016')!;

function boot() {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['green'], cost: null,
    power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['green'],
    cost: 2, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: ['vanilla'],
  }));
  let s = initialState({
    seed: 1,
    decks: { A: { leader: lead, cards: filler }, B: { leader: { ...lead, id: 'LB', name: 'LB' }, cards: filler } },
  });
  s = setupGame(s);
  s = closeMulliganKeepBoth(s);
  s = endTurn(s); s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
  s = endTurn(s); s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
  return s;
}

function placeBingoh(s: any) {
  const b: CharacterCard = {
    id: 'BIN', name: 'Bingoh', kind: 'character', colors: ['green'],
    cost: 1, power: 0, counterValue: 1000,
    traits: ['Land of Wano'], keywords: [], effectTags: [],
  };
  s.cardLibrary[b.id] = b;
  s.instances['b'] = {
    instanceId: 'b', cardId: b.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.field.push(s.instances['b']);
}

function placeOppChar(s: any, id: string, cost: number, rested: boolean) {
  const c: CharacterCard = {
    id: `C_${id}`, name: id, kind: 'character', colors: ['green'],
    cost, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances[id] = {
    instanceId: id, cardId: c.id, controller: 'B',
    rested, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.B.field.push(s.instances[id]);
}

describe('EB01-016 — Bingoh', () => {
  const clause = EB01_016.effectSpecV2!.clauses![0];

  it('cost restSelf payable when Bingoh is active', () => {
    const s = boot();
    placeBingoh(s);
    expect(canPayClauseCost(s, 'A', 'b', clause.cost!)).toBe(true);
  });

  it('cost restSelf unpayable when Bingoh is already rested', () => {
    const s = boot();
    placeBingoh(s);
    s.instances['b'].rested = true;
    expect(canPayClauseCost(s, 'A', 'b', clause.cost!)).toBe(false);
  });

  it('paying cost rests Bingoh', () => {
    const s = boot();
    placeBingoh(s);
    payClauseCost(s, 'A', 'b', clause.cost!);
    expect(s.instances['b'].rested).toBe(true);
  });

  it('target excludes active opp char', () => {
    const s = boot();
    placeBingoh(s);
    placeOppChar(s, 'active', 1, /*rested*/ false);
    const ids = resolveTargetV2(s, 'A', 'b', clause.target);
    expect(ids).not.toContain('active');
  });

  it('target includes rested cost-1 opp char', () => {
    const s = boot();
    placeBingoh(s);
    placeOppChar(s, 'restcheap', 1, /*rested*/ true);
    const ids = resolveTargetV2(s, 'A', 'b', clause.target);
    expect(ids).toContain('restcheap');
  });

  it('target excludes rested cost-2 opp char (cost cap is 1)', () => {
    const s = boot();
    placeBingoh(s);
    placeOppChar(s, 'rest2', 2, /*rested*/ true);
    const ids = resolveTargetV2(s, 'A', 'b', clause.target);
    expect(ids).not.toContain('rest2');
  });

  it('action KOs the targeted rested opp char', () => {
    const s = boot();
    placeBingoh(s);
    placeOppChar(s, 'restcheap', 1, /*rested*/ true);
    applyActionV2(s, { sourceInstanceId: 'b', controller: 'A' }, clause.action, ['restcheap']);
    expect(s.players.B.field.some((i: { instanceId: string }) => i.instanceId === 'restcheap')).toBe(false);
    expect(s.players.B.trash).toContain('restcheap');
  });
});
