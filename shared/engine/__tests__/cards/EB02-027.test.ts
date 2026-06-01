// EB02-027 Vista.
//   "[On Play] Place up to 1 of your opponent's Characters with 1000
//    power or less at the bottom of the owner's deck."
import { describe, expect, it } from 'vitest';
import { applyActionV2, resolveTargetV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB02_027 = ALL_CARDS.find(c => c.id === 'EB02-027')!;

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

function placeOppChar(s: any, id: string, power: number) {
  const c: CharacterCard = {
    id: `C_${id}`, name: id, kind: 'character', colors: ['blue'],
    cost: 2, power, counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances[id] = {
    instanceId: id, cardId: c.id, controller: 'B',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.B.field.push(s.instances[id]);
}

describe('EB02-027 — Vista', () => {
  const clause = EB02_027.effectSpecV2!.clauses![0];

  it('target includes 1000-power opp char', () => {
    const s = boot();
    placeOppChar(s, 'p1', 1000);
    expect(resolveTargetV2(s, 'A', 'src', clause.target)).toContain('p1');
  });

  it('target excludes 2000-power opp char', () => {
    const s = boot();
    placeOppChar(s, 'p2', 2000);
    expect(resolveTargetV2(s, 'A', 'src', clause.target)).not.toContain('p2');
  });

  it('action: places opp char at bottom of opp deck', () => {
    const s = boot();
    placeOppChar(s, 'p1', 1000);
    const deckBefore = s.players.B.deck.length;
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, ['p1']);
    expect(s.players.B.field.some((i: { instanceId: string }) => i.instanceId === 'p1')).toBe(false);
    expect(s.players.B.deck.length).toBe(deckBefore + 1);
    expect(s.players.B.deck[s.players.B.deck.length - 1]).toBe('p1');
  });
});
