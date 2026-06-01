// EB02-011 Arlong.
//   "[On Play] If your Leader has the {Fish-Man} or {East Blue} type,
//    give up to 1 rested DON!! card to 1 of your Leader. Then, up to
//    1 of your opponent's Characters with a cost of 5 or less cannot
//    be rested until the end of your opponent's next turn."
import { describe, expect, it } from 'vitest';
import { applyActionV2, evaluateConditionV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB02_011 = ALL_CARDS.find(c => c.id === 'EB02-011')!;

function boot(traits: string[]) {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['green'], cost: null,
    power: 5000, life: 5, counterValue: null, traits, keywords: [], effectTags: [],
  };
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['green'],
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

describe('EB02-011 — Arlong', () => {
  const [donClause, lockClause] = EB02_011.effectSpecV2!.clauses!;

  it('condition TRUE: Fish-Man leader', () => {
    const s = boot(['Fish-Man']);
    expect(evaluateConditionV2(s, 'A', donClause.condition, 'src')).toBe(true);
  });

  it('condition TRUE: East Blue leader', () => {
    const s = boot(['East Blue']);
    expect(evaluateConditionV2(s, 'A', donClause.condition, 'src')).toBe(true);
  });

  it('condition FALSE: other leader', () => {
    const s = boot(['Other']);
    expect(evaluateConditionV2(s, 'A', donClause.condition, 'src')).toBe(false);
  });

  it('don clause: give_don_to_target attaches 1 DON to leader', () => {
    const s = boot(['Fish-Man']);
    const leaderId = s.players.A.leader.instanceId;
    const cBefore = s.players.A.donCostArea.length;
    const attBefore = s.instances[leaderId].attachedDon.length;
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, donClause.action, [leaderId]);
    expect(s.instances[leaderId].attachedDon.length).toBe(attBefore + 1);
    expect(s.players.A.donCostArea.length).toBe(cBefore - 1);
  });

  it('lock clause: sets restLocked on opp char', () => {
    const s = boot(['Fish-Man']);
    const c: CharacterCard = {
      id: 'OC', name: 'OC', kind: 'character', colors: ['green'],
      cost: 5, power: 5000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
    };
    s.cardLibrary[c.id] = c;
    s.instances['oc'] = {
      instanceId: 'oc', cardId: c.id, controller: 'B',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.B.field.push(s.instances['oc']);
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, lockClause.action, ['oc']);
    expect(s.instances['oc'].restLocked).toBe(true);
  });
});
