// EB01-053 Gastino.
//   "[On Play] Place up to 1 of your opponent's Characters with a cost
//    of 3 or less at the top or bottom of your opponent's Life cards
//    face-up."
import { describe, expect, it } from 'vitest';
import { applyActionV2, resolveTargetV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_053 = ALL_CARDS.find(c => c.id === 'EB01-053')!;

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

function placeOppChar(s: any, id: string, cost: number) {
  const c: CharacterCard = {
    id: `C_${id}`, name: id, kind: 'character', colors: ['yellow'],
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

describe('EB01-053 — Gastino', () => {
  const clause = EB01_053.effectSpecV2!.clauses![0];

  it('moves cost-3 opp char from field to TOP of opp life', () => {
    const s = boot();
    placeOppChar(s, 'c3', 3);
    const lifeBefore = s.players.B.life.length;
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, ['c3']);
    expect(s.players.B.field.some((i: { instanceId: string }) => i.instanceId === 'c3')).toBe(false);
    expect(s.players.B.life.length).toBe(lifeBefore + 1);
    expect(s.players.B.life[0]).toBe('c3');
  });

  it('cost-4 opp char is not targetable (filter rejects)', () => {
    const s = boot();
    placeOppChar(s, 'c4', 4);
    // Direct apply with c4 still works (target validation lives in resolveTargetV2),
    // but to confirm filter behavior we use resolveTargetV2 path.
    const ids = resolveTargetV2(s, 'A', 'src', clause.target);
    expect(ids).not.toContain('c4');
  });
});
