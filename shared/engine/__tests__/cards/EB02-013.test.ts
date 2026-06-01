// EB02-013 Carrot.
//   "[On Play] If you have 3 or more DON!! cards on your field, look at
//    7 cards from the top of your deck; reveal up to 1 [Zou] and add
//    it to your hand. Then, place the rest at the bottom of your deck
//    in any order and play up to 1 [Zou] from your hand."
import { describe, expect, it } from 'vitest';
import { applyActionV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard, StageCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB02_013 = ALL_CARDS.find(c => c.id === 'EB02-013')!;

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

describe('EB02-013 — Carrot', () => {
  const [searchClause, playClause] = EB02_013.effectSpecV2!.clauses!;

  it('search clause: pulls a Zou stage from top 7 into hand', () => {
    const s = boot();
    const zou: StageCard = {
      id: 'ZOU', name: 'Zou', kind: 'stage', colors: ['green'],
      cost: 2, counterValue: null, traits: ['Minks'], effectTags: [],
    };
    s.cardLibrary[zou.id] = zou;
    s.instances['zou'] = {
      instanceId: 'zou', cardId: zou.id, controller: 'A',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.deck.unshift('zou');
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, searchClause.action, []);
    expect(s.players.A.hand).toContain('zou');
  });

  it('play clause: plays Zou stage from hand into stage slot', () => {
    const s = boot();
    const zou: StageCard = {
      id: 'ZOU', name: 'Zou', kind: 'stage', colors: ['green'],
      cost: 2, counterValue: null, traits: ['Minks'], effectTags: [],
    };
    s.cardLibrary[zou.id] = zou;
    s.instances['zou'] = {
      instanceId: 'zou', cardId: zou.id, controller: 'A',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.hand.push('zou');
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, playClause.action, []);
    expect(s.players.A.stage?.instanceId).toBe('zou');
    expect(s.players.A.hand).not.toContain('zou');
  });
});
