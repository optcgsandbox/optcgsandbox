// EB02-014 Sarfunkel.
//   "[On Play] Play up to 1 [Gaimon] from your hand."
import { describe, expect, it } from 'vitest';
import { applyActionV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB02_014 = ALL_CARDS.find(c => c.id === 'EB02-014')!;

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

describe('EB02-014 — Sarfunkel', () => {
  const clause = EB02_014.effectSpecV2!.clauses![0];

  it('plays Gaimon from hand', () => {
    const s = boot();
    const c: CharacterCard = {
      id: 'GA', name: 'Gaimon', kind: 'character', colors: ['green'],
      cost: 1, power: 1000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
    };
    s.cardLibrary[c.id] = c;
    s.instances['ga'] = {
      instanceId: 'ga', cardId: c.id, controller: 'A',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.hand.push('ga');
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, []);
    expect(s.players.A.field.some((i: { instanceId: string }) => i.instanceId === 'ga')).toBe(true);
  });

  it('does NOT play non-Gaimon char', () => {
    const s = boot();
    const c: CharacterCard = {
      id: 'X', name: 'Other', kind: 'character', colors: ['green'],
      cost: 1, power: 1000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
    };
    s.cardLibrary[c.id] = c;
    s.instances['x'] = {
      instanceId: 'x', cardId: c.id, controller: 'A',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.hand.push('x');
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, []);
    expect(s.players.A.hand).toContain('x');
  });
});
