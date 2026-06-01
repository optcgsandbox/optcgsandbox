// EB01-037 Mr. 9.
//   "[On Your Opponent's Attack] [Once Per Turn] DON!! −1: K.O. up to 1
//    of your opponent's Characters with a cost of 2 or less."
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
const EB01_037 = ALL_CARDS.find(c => c.id === 'EB01-037')!;

function boot() {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['purple'], cost: null,
    power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['purple'],
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

function placeOppChar(s: any, id: string, cost: number) {
  const c: CharacterCard = {
    id: `C_${id}`, name: id, kind: 'character', colors: ['purple'],
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

describe('EB01-037 — Mr. 9', () => {
  const clause = EB01_037.effectSpecV2!.clauses![0];

  it('cost donCostReturnToDeck:1 payable when 1+ cost-area DON', () => {
    const s = boot();
    expect(canPayClauseCost(s, 'A', 'src', clause.cost!)).toBe(true);
  });

  it('cost moves 1 from cost-area to deck', () => {
    const s = boot();
    const cBefore = s.players.A.donCostArea.length;
    const dBefore = s.players.A.donDeck.length;
    payClauseCost(s, 'A', 'src', clause.cost!);
    expect(s.players.A.donCostArea.length).toBe(cBefore - 1);
    expect(s.players.A.donDeck.length).toBe(dBefore + 1);
  });

  it('target excludes cost-3 opp char', () => {
    const s = boot();
    placeOppChar(s, 'big', 3);
    const ids = resolveTargetV2(s, 'A', 'src', clause.target);
    expect(ids).not.toContain('big');
  });

  it('action KOs cost-2 opp char', () => {
    const s = boot();
    placeOppChar(s, 'small', 2);
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, ['small']);
    expect(s.players.B.field.some((i: { instanceId: string }) => i.instanceId === 'small')).toBe(false);
    expect(s.players.B.trash).toContain('small');
  });
});
