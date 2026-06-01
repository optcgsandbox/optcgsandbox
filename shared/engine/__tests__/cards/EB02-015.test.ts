// EB02-015 Jewelry Bonney.
//   "[On Play] Up to 1 of your opponent's rested Characters will not
//    become active in your opponent's next Refresh Phase. Then, set up
//    to 1 of your DON!! cards as active at the end of this turn."
import { describe, expect, it } from 'vitest';
import { applyActionV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB02_015 = ALL_CARDS.find(c => c.id === 'EB02-015')!;

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

describe('EB02-015 — Jewelry Bonney', () => {
  const [lockClause, donClause] = EB02_015.effectSpecV2!.clauses!;

  it('lock clause: sets restLocked on rested opp char', () => {
    const s = boot();
    const c: CharacterCard = {
      id: 'OC', name: 'OC', kind: 'character', colors: ['green'],
      cost: 3, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
    };
    s.cardLibrary[c.id] = c;
    s.instances['oc'] = {
      instanceId: 'oc', cardId: c.id, controller: 'B',
      rested: true, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.B.field.push(s.instances['oc']);
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, lockClause.action, ['oc']);
    expect(s.instances['oc'].restLocked).toBe(true);
  });

  it('don clause: set_active_don 1 moves 1 from rested to cost area', () => {
    const s = boot();
    s.players.A.donRested = ['r1'];
    const cBefore = s.players.A.donCostArea.length;
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, donClause.action, []);
    expect(s.players.A.donRested.length).toBe(0);
    expect(s.players.A.donCostArea.length).toBe(cBefore + 1);
  });

  it('at_end_of_turn_self broadcast: Bonney on field fires don clause', () => {
    const s = boot();
    s.cardLibrary['EB02-015'] = EB02_015 as unknown as CharacterCard;
    s.instances['bonney'] = {
      instanceId: 'bonney', cardId: 'EB02-015', controller: 'A',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.field.push(s.instances['bonney']);
    s.players.A.donRested = ['r1'];
    const s2 = endTurn(s);
    // After endTurn the active player flips; donRested should be reduced.
    expect(s2.players.A.donRested.length).toBe(0);
    expect(s2.players.A.donCostArea.length).toBeGreaterThan(0);
  });
});
