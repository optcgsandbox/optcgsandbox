// EB02-030 "And That's When Somebody Makes Fun of Their Friend's Dream!!!!"
//   "[Counter] If any of your Characters would be K.O.'d in battle
//    during this turn, you may trash 1 card from your hand instead."
//
// V0 engine notes:
// - Battle vs effect KO distinction is not enforced (audit note); the
//   would_be_ko replacement fires for effect KOs via removal_ko handler.
// - The "Counter" timing semantics are also not enforced.
// These tests verify the replacement-effect skeleton works on the
// effect-KO path (EB01-008-style flow); the in-battle gating is a known gap.
import { describe, expect, it } from 'vitest';
import { applyActionV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB02_030 = ALL_CARDS.find(c => c.id === 'EB02-030')!;

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

describe('EB02-030 — And That\'s When Somebody Makes Fun...', () => {
  it('spec has a would_be_ko replacement with discardHand cost', () => {
    const r = EB02_030.effectSpecV2!.replacements?.[0];
    expect(r?.trigger).toBe('would_be_ko');
    expect(r?.cost?.discardHand).toBe(1);
    expect(r?.action.kind).toBe('grant_immunity');
  });

  it('grant_immunity action sets immunity on target', () => {
    const s = boot();
    const c: CharacterCard = {
      id: 'TARG', name: 'T', kind: 'character', colors: ['blue'],
      cost: 2, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
    };
    s.cardLibrary[c.id] = c;
    s.instances['t'] = {
      instanceId: 't', cardId: c.id, controller: 'A',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.field.push(s.instances['t']);
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, EB02_030.effectSpecV2!.replacements![0].action, ['t']);
    expect(s.instances['t'].immunity).toEqual({ against: 'opp_removal' });
  });
});
