// EB02-024 Sogeking.
//   "[On Play] Draw 2 cards and place 2 cards from your hand at the
//    bottom of your deck in any order. Then, return up to 1 Character
//    with a cost of 1 or less to the owner's hand."
import { describe, expect, it } from 'vitest';
import { applyActionV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB02_024 = ALL_CARDS.find(c => c.id === 'EB02-024')!;

function boot() {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['blue'], cost: null,
    power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['blue'],
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

describe('EB02-024 — Sogeking', () => {
  const clauses = EB02_024.effectSpecV2!.clauses!;

  it('clause 0: draws 2', () => {
    const s = boot();
    const before = s.players.A.hand.length;
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clauses[0].action, []);
    expect(s.players.A.hand.length).toBe(before + 2);
  });

  it('clause 1: moves 2 hand cards to deck bottom', () => {
    const s = boot();
    const deckBefore = s.players.A.deck.length;
    const handBefore = s.players.A.hand.length;
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clauses[1].action, []);
    expect(s.players.A.hand.length).toBe(handBefore - 2);
    expect(s.players.A.deck.length).toBe(deckBefore + 2);
  });

  it('clause 2: bounces cost-1 opp char', () => {
    const s = boot();
    const c: CharacterCard = {
      id: 'CH', name: 'CH', kind: 'character', colors: ['blue'],
      cost: 1, power: 2000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
    };
    s.cardLibrary[c.id] = c;
    s.instances['ch'] = {
      instanceId: 'ch', cardId: c.id, controller: 'B',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.B.field.push(s.instances['ch']);
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clauses[2].action, ['ch']);
    expect(s.players.B.field.some((i: { instanceId: string }) => i.instanceId === 'ch')).toBe(false);
    expect(s.players.B.hand).toContain('ch');
  });

  it('name alias Usopp recorded', () => {
    const r = (EB02_024.effectSpecV2 as { rules?: { nameAliases?: string[] } } | undefined)?.rules;
    expect(r?.nameAliases).toContain('Usopp');
  });
});
