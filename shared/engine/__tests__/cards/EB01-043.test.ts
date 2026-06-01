// EB01-043 Spandine.
//   "[On Play] You may place 3 cards with a type including 'CP' from
//    your trash at the bottom of your deck in any order: Play up to 1
//    Character card with a type including 'CP' and a cost of 4 or less
//    other than [Spandine] from your trash rested."
import { describe, expect, it } from 'vitest';
import { applyActionV2 } from '../../effectSpec/runner-v2';
import { canPayClauseCost, payClauseCost } from '../../effectSpec/replacements-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_043 = ALL_CARDS.find(c => c.id === 'EB01-043')!;

function boot() {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['black'], cost: null,
    power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['black'],
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

function trashCard(s: any, id: string, traits: string[], name = id, cost = 2, kind: 'character'|'event'|'stage' = 'character') {
  const c: any = {
    id, name, kind, colors: ['black'], cost, power: 3000,
    counterValue: 1000, traits, keywords: [], effectTags: [],
  };
  s.cardLibrary[id] = c;
  s.instances[id] = {
    instanceId: id, cardId: id, controller: 'A',
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  s.players.A.trash.push(id);
}

describe('EB01-043 — Spandine', () => {
  const clause = EB01_043.effectSpecV2!.clauses![0];

  it('cost NOT payable with 0 CP-type cards in trash', () => {
    const s = boot();
    expect(canPayClauseCost(s, 'A', 'src', clause.cost!)).toBe(false);
  });

  it('cost NOT payable with 2 CP-type cards in trash (need 3)', () => {
    const s = boot();
    trashCard(s, 'cp1', ['CP0']);
    trashCard(s, 'cp2', ['CP6']);
    trashCard(s, 'other', ['Other']);
    expect(canPayClauseCost(s, 'A', 'src', clause.cost!)).toBe(false);
  });

  it('cost payable with 3 CP-type cards (mix of CP0/CP6/CP9)', () => {
    const s = boot();
    trashCard(s, 'cp1', ['CP0']);
    trashCard(s, 'cp2', ['CP6']);
    trashCard(s, 'cp3', ['CP9']);
    expect(canPayClauseCost(s, 'A', 'src', clause.cost!)).toBe(true);
  });

  it('paying cost moves 3 CP cards from trash to deck bottom', () => {
    const s = boot();
    trashCard(s, 'cp1', ['CP0']);
    trashCard(s, 'cp2', ['CP6']);
    trashCard(s, 'cp3', ['CP9']);
    trashCard(s, 'other', ['Other']);
    payClauseCost(s, 'A', 'src', clause.cost!);
    expect(s.players.A.trash).toContain('other');
    expect(s.players.A.trash).not.toContain('cp1');
    expect(s.players.A.deck.slice(-3)).toEqual(['cp1', 'cp2', 'cp3']);
  });

  it('action: plays cost-4 CP char from trash rested', () => {
    const s = boot();
    trashCard(s, 'cp4', ['CP9'], 'CP4Char', 4);
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, []);
    expect(s.players.A.field.some((i: { instanceId: string }) => i.instanceId === 'cp4')).toBe(true);
    expect(s.instances['cp4'].rested).toBe(true);
  });

  it('action: rejects Spandine itself (nameExcludes)', () => {
    const s = boot();
    trashCard(s, 'sp2', ['CP9'], 'Spandine', 3);
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, []);
    expect(s.players.A.trash).toContain('sp2');
  });
});
