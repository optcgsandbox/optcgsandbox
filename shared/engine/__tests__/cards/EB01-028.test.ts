// EB01-028 Gum-Gum Champion Rifle.
//   "[Counter] If your Leader has the {Impel Down} type, up to 1 of
//    your Leader or Character cards gains +2000 power during this
//    battle. Then, your opponent returns 1 of their active Characters
//    to the owner's hand."
import { describe, expect, it } from 'vitest';
import { applyActionV2, evaluateConditionV2, resolveTargetV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_028 = ALL_CARDS.find(c => c.id === 'EB01-028')!;

function boot(traits: string[]) {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['blue'], cost: null,
    power: 5000, life: 5, counterValue: null, traits, keywords: [], effectTags: [],
  };
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['blue'],
    cost: 2, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: ['vanilla'],
  }));
  let s = initialState({
    seed: 1,
    decks: { A: { leader: lead, cards: filler }, B: { leader: { ...lead, id: 'LB', name: 'LB', traits: [] }, cards: filler } },
  });
  s = setupGame(s);
  s = closeMulliganKeepBoth(s);
  s = endTurn(s); s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
  s = endTurn(s); s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
  return s;
}

function placeOppChar(s: any, id: string, rested: boolean) {
  const c: CharacterCard = {
    id: `C_${id}`, name: id, kind: 'character', colors: ['blue'],
    cost: 3, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances[id] = {
    instanceId: id, cardId: c.id, controller: 'B',
    rested, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.B.field.push(s.instances[id]);
}

describe('EB01-028 — Gum-Gum Champion Rifle', () => {
  const [c0, c1] = EB01_028.effectSpecV2!.clauses!;

  it('clause 0 condition: leader Impel Down ⇒ true', () => {
    const s = boot(['Impel Down']);
    expect(evaluateConditionV2(s, 'A', c0.condition, 'src')).toBe(true);
  });

  it('clause 0 condition: non-Impel ⇒ false', () => {
    const s = boot(['Other']);
    expect(evaluateConditionV2(s, 'A', c0.condition, 'src')).toBe(false);
  });

  it('clause 0 applies +2000 to leader; clears at endTurn', () => {
    const s = boot(['Impel Down']);
    const leaderId = s.players.A.leader.instanceId;
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, c0.action, [leaderId]);
    expect(s.instances[leaderId].powerModifier).toBe(2000);
    expect(endTurn(s).instances[leaderId].powerModifier).toBeUndefined();
  });

  it('clause 1 target: includes active opp char', () => {
    const s = boot(['Impel Down']);
    placeOppChar(s, 'active', false);
    const ids = resolveTargetV2(s, 'A', 'src', c1.target);
    expect(ids).toContain('active');
  });

  it('clause 1 target: excludes rested opp char', () => {
    const s = boot(['Impel Down']);
    placeOppChar(s, 'rest', true);
    const ids = resolveTargetV2(s, 'A', 'src', c1.target);
    expect(ids).not.toContain('rest');
  });

  it('clause 1 action: bounces target opp char to owner hand', () => {
    const s = boot(['Impel Down']);
    placeOppChar(s, 'active', false);
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, c1.action, ['active']);
    expect(s.players.B.field.some((i: { instanceId: string }) => i.instanceId === 'active')).toBe(false);
    expect(s.players.B.hand).toContain('active');
  });
});
