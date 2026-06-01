// EB01-061 Mr.2.Bon.Kurei(Bentham).
//   "[On Play] Add up to 1 DON!! card from your DON!! deck and set it
//    as active.
//    [When Attacking] Select up to 1 of your opponent's Characters.
//    This Character's base power becomes the same as the selected
//    Character's power during this turn."
import { describe, expect, it } from 'vitest';
import { applyActionV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_061 = ALL_CARDS.find(c => c.id === 'EB01-061')!;

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

describe('EB01-061 — Mr.2.Bon.Kurei(Bentham)', () => {
  const [onPlay, whenAttacking] = EB01_061.effectSpecV2!.clauses!;

  it('on-play: ramp 1 (active)', () => {
    const s = boot();
    const before = s.players.A.donCostArea.length;
    const deckBefore = s.players.A.donDeck.length;
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, onPlay.action, []);
    expect(s.players.A.donCostArea.length).toBe(before + 1);
    expect(s.players.A.donDeck.length).toBe(deckBefore - 1);
  });

  it('when-attacking: base power copies from opp char target', () => {
    const s = boot();
    const benthamCard: CharacterCard = {
      id: 'BEN', name: 'Bentham', kind: 'character', colors: ['purple'],
      cost: 4, power: 1000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
    };
    s.cardLibrary[benthamCard.id] = benthamCard;
    s.instances['ben'] = {
      instanceId: 'ben', cardId: benthamCard.id, controller: 'A',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.field.push(s.instances['ben']);

    const oppCard: CharacterCard = {
      id: 'O', name: 'Big', kind: 'character', colors: ['purple'],
      cost: 6, power: 7000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
    };
    s.cardLibrary[oppCard.id] = oppCard;
    s.instances['big'] = {
      instanceId: 'big', cardId: oppCard.id, controller: 'B',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.B.field.push(s.instances['big']);

    applyActionV2(s, { sourceInstanceId: 'ben', controller: 'A' }, whenAttacking.action, ['big']);
    expect(s.instances['ben'].basePowerOverride).toBe(7000);
  });
});
