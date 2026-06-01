// EB01-059 Kingdom Come (event).
//   "[Main] K.O. up to 1 of your opponent's Characters. Then, trash
//    cards from the top of your Life cards until you have 1 Life card."
import { describe, expect, it } from 'vitest';
import { applyActionV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_059 = ALL_CARDS.find(c => c.id === 'EB01-059')!;

function boot() {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['yellow'], cost: null,
    power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['yellow'],
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

describe('EB01-059 — Kingdom Come', () => {
  const [koClause, lifeClause] = EB01_059.effectSpecV2!.clauses!;

  it('KO clause: removes target opp char', () => {
    const s = boot();
    const c: CharacterCard = {
      id: 'OC', name: 'OC', kind: 'character', colors: ['yellow'],
      cost: 9, power: 9000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
    };
    s.cardLibrary[c.id] = c;
    s.instances['oc'] = {
      instanceId: 'oc', cardId: c.id, controller: 'B',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.B.field.push(s.instances['oc']);
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, koClause.action, ['oc']);
    expect(s.players.B.field.some((i: { instanceId: string }) => i.instanceId === 'oc')).toBe(false);
  });

  it('life-trash clause: reduces life to 1 (from 5)', () => {
    const s = boot();
    expect(s.players.A.life.length).toBeGreaterThan(1);
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, lifeClause.action, []);
    expect(s.players.A.life.length).toBe(1);
  });

  it('life-trash clause: no-op when life already <= 1', () => {
    const s = boot();
    s.players.A.life = ['l1'];
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, lifeClause.action, []);
    expect(s.players.A.life.length).toBe(1);
  });
});
