// EB01-051 Finger Pistol (event).
//   "[Main] You may trash 2 cards from the top of your deck: K.O. up to
//    1 of your opponent's Characters with a cost of 5 or less."
import { describe, expect, it } from 'vitest';
import { applyActionV2 } from '../../effectSpec/runner-v2';
import { canPayClauseCost, payClauseCost } from '../../effectSpec/replacements-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_051 = ALL_CARDS.find(c => c.id === 'EB01-051')!;

function boot() {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['black'], cost: null,
    power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['black'],
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

describe('EB01-051 — Finger Pistol', () => {
  const clause = EB01_051.effectSpecV2!.clauses![0];

  it('cost millSelf:2 payable when deck has 2+', () => {
    const s = boot();
    expect(canPayClauseCost(s, 'A', 'src', clause.cost!)).toBe(true);
  });

  it('paying cost mills 2 from deck to trash', () => {
    const s = boot();
    const trashBefore = s.players.A.trash.length;
    const deckBefore = s.players.A.deck.length;
    payClauseCost(s, 'A', 'src', clause.cost!);
    expect(s.players.A.trash.length).toBe(trashBefore + 2);
    expect(s.players.A.deck.length).toBe(deckBefore - 2);
  });

  it('action KOs cost<=5 opp char', () => {
    const s = boot();
    placeOppChar(s, 'c5', 5);
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, ['c5']);
    expect(s.players.B.field.some((i: { instanceId: string }) => i.instanceId === 'c5')).toBe(false);
  });
});
