// EB02-007 Cloven Rose Blizzard (event).
//   "[Main] Up to a total of 3 of your Leader and Character cards gain
//    +1000 power during this turn. Then, K.O. up to 1 of your
//    opponent's Characters with 3000 power or less."
import { describe, expect, it } from 'vitest';
import { applyActionV2, resolveTargetV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB02_007 = ALL_CARDS.find(c => c.id === 'EB02-007')!;

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

function placeAlly(s: any, id: string) {
  const c: CharacterCard = {
    id: `C_${id}`, name: id, kind: 'character', colors: ['red'],
    cost: 2, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
  };
  s.cardLibrary[c.id] = c;
  s.instances[id] = {
    instanceId: id, cardId: c.id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.field.push(s.instances[id]);
}

describe('EB02-007 — Cloven Rose Blizzard', () => {
  const [buffClause, koClause] = EB02_007.effectSpecV2!.clauses!;

  it('target resolution: includes leader and chars up to count=3', () => {
    const s = boot();
    placeAlly(s, 'a1');
    placeAlly(s, 'a2');
    placeAlly(s, 'a3');
    const ids = resolveTargetV2(s, 'A', 'src', buffClause.target);
    expect(ids).toHaveLength(3);
    expect(ids).toContain(s.players.A.leader.instanceId);
  });

  it('buff applied to multiple targets', () => {
    const s = boot();
    placeAlly(s, 'a1');
    placeAlly(s, 'a2');
    const leaderId = s.players.A.leader.instanceId;
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, buffClause.action, [leaderId, 'a1', 'a2']);
    expect(s.instances[leaderId].powerModifier).toBe(1000);
    expect(s.instances['a1'].powerModifier).toBe(1000);
    expect(s.instances['a2'].powerModifier).toBe(1000);
  });

  it('KO clause: KOs opp char with power 3000', () => {
    const s = boot();
    const oc: CharacterCard = {
      id: 'OC', name: 'OC', kind: 'character', colors: ['red'],
      cost: 3, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
    };
    s.cardLibrary[oc.id] = oc;
    s.instances['oc'] = {
      instanceId: 'oc', cardId: oc.id, controller: 'B',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.B.field.push(s.instances['oc']);
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, koClause.action, ['oc']);
    expect(s.players.B.field.some((i: { instanceId: string }) => i.instanceId === 'oc')).toBe(false);
  });
});
