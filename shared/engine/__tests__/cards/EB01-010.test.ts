// EB01-010 "There's No Way You Could Defeat Me!!" (event).
//   "[Counter] K.O. up to 1 of your opponent's Characters with 6000 base
//    power or less."
import { describe, expect, it } from 'vitest';
import { applyActionV2, resolveTargetV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_010 = ALL_CARDS.find(c => c.id === 'EB01-010')!;

function boot() {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['red'], cost: null,
    power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['red'],
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

function placeOppChar(s: any, id: string, basePower: number, attachedDon = 0) {
  const c: CharacterCard = {
    id: `C_${id}`, name: id, kind: 'character', colors: ['red'],
    cost: 3, power: basePower, counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances[id] = {
    instanceId: id, cardId: c.id, controller: 'B',
    rested: false,
    attachedDon: attachedDon > 0 ? s.players.A.donCostArea.splice(0, attachedDon) : [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.B.field.push(s.instances[id]);
}

describe('EB01-010 — Theres No Way You Could Defeat Me!!', () => {
  const clause = EB01_010.effectSpecV2!.clauses![0];

  it('KOs a 6000-base opp char (== cap)', () => {
    const s = boot();
    placeOppChar(s, 'c1', 6000);
    applyActionV2(s, { sourceInstanceId: 'evt', controller: 'A' }, clause.action, ['c1']);
    expect(s.players.B.field.some((i: { instanceId: string }) => i.instanceId === 'c1')).toBe(false);
    expect(s.players.B.trash).toContain('c1');
  });

  it('target resolution INCLUDES a 6000-base char (basePowerMax)', () => {
    const s = boot();
    placeOppChar(s, 'c1', 6000);
    const ids = resolveTargetV2(s, 'A', 'evt', clause.target);
    expect(ids).toContain('c1');
  });

  it('target resolution EXCLUDES a 7000-base char', () => {
    const s = boot();
    placeOppChar(s, 'c2', 7000);
    const ids = resolveTargetV2(s, 'A', 'evt', clause.target);
    expect(ids).not.toContain('c2');
  });

  it('target resolution INCLUDES a 5000-base char with 2 DON attached (current=7000, base=5000)', () => {
    const s = boot();
    placeOppChar(s, 'c3', 5000, 2);
    const ids = resolveTargetV2(s, 'A', 'evt', clause.target);
    expect(ids).toContain('c3');
  });
});
