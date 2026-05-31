import { describe, expect, it } from 'vitest';
import { applyGameRuleOverrideV2 } from '../effectSpec/gameRules-v2';
import { initialState } from '../GameState';
import { setupGame } from '../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../phases/turn';
import type { Card, CharacterCard, LeaderCard, StageCard } from '../cards/Card';
import { closeMulliganKeepBoth } from './_donHelpers';

function makeLeader(id: string): LeaderCard {
  return {
    id, name: id, kind: 'leader', colors: ['red'], cost: null, power: 5000,
    life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
}
function makeChar(id: string): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['red'], cost: 2, power: 3000,
    counterValue: 1000, traits: [], keywords: [], effectTags: ['vanilla'],
  };
}
function makeStage(id: string, traits: string[] = []): StageCard {
  return {
    id, name: id, kind: 'stage', colors: ['red'], cost: 1, power: null,
    counterValue: null, traits, keywords: [], effectTags: ['vanilla'],
    effectText: 'stage',
  };
}
function boot() {
  const cards: Card[] = Array.from({ length: 50 }, (_, i) => makeChar(`C${i}`));
  let s = initialState({
    seed: 1,
    decks: { A: { leader: makeLeader('LA'), cards }, B: { leader: makeLeader('LB'), cards } },
  });
  s = setupGame(s);
  s = closeMulliganKeepBoth(s);
  s = endTurn(s);
  s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
  return s;
}

describe('EffectSpec v2 — applyGameRuleOverrideV2', () => {
  it('donDeckSize trims DON deck when override is smaller', () => {
    const s = boot();
    const beforeLen = s.players.A.donDeck.length;
    expect(beforeLen).toBeGreaterThan(4);
    applyGameRuleOverrideV2(s, 'A', { donDeckSize: 4 });
    expect(s.players.A.donDeck.length).toBe(4);
  });

  it('donDeckSize does NOT shrink when override is larger (V0: extension unsupported)', () => {
    const s = boot();
    s.players.A.donDeck = ['d1', 'd2'];
    applyGameRuleOverrideV2(s, 'A', { donDeckSize: 10 });
    expect(s.players.A.donDeck.length).toBe(2);
  });

  it('nameAliases write to gameRules.nameAliases per player', () => {
    const s = boot();
    applyGameRuleOverrideV2(s, 'A', { nameAliases: ['Trafalgar Law', 'Donquixote Rosinante'] });
    expect(s.gameRules?.nameAliases?.A).toEqual(['Trafalgar Law', 'Donquixote Rosinante']);
  });

  it('nameAliases append on repeated apply', () => {
    const s = boot();
    applyGameRuleOverrideV2(s, 'A', { nameAliases: ['Alias1'] });
    applyGameRuleOverrideV2(s, 'A', { nameAliases: ['Alias2'] });
    expect(s.gameRules?.nameAliases?.A).toEqual(['Alias1', 'Alias2']);
  });

  it('deckOutGrace marks controller', () => {
    const s = boot();
    applyGameRuleOverrideV2(s, 'A', { deckOutGrace: 'until_end_of_turn' });
    expect(s.gameRules?.deckOutGracePlayer).toBe('A');
  });

  it('deckRestrictions.bannedEventCostMin stored per player', () => {
    const s = boot();
    applyGameRuleOverrideV2(s, 'B', { deckRestrictions: { bannedEventCostMin: 2 } });
    expect(s.gameRules?.bannedEventCostMin?.B).toBe(2);
  });

  it('atStartOfGamePlay finds matching Stage in deck and moves it to stage area', () => {
    const s = boot();
    const stage = makeStage('SST', ['Mary Geoise']);
    s.cardLibrary['SST'] = stage;
    s.instances['sst-i'] = {
      instanceId: 'sst-i', cardId: 'SST', controller: 'A', rested: false,
      attachedDon: [], perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.deck.unshift('sst-i'); // place at top
    applyGameRuleOverrideV2(s, 'A', {
      atStartOfGamePlay: { fromZone: 'deck', filter: { trait: 'Mary Geoise' } as any },
    });
    expect(s.players.A.stage?.instanceId).toBe('sst-i');
    expect(s.players.A.deck).not.toContain('sst-i');
  });

  it('atStartOfGamePlay leaves stage unchanged when no match in deck', () => {
    const s = boot();
    const beforeStage = s.players.A.stage;
    applyGameRuleOverrideV2(s, 'A', {
      atStartOfGamePlay: { fromZone: 'deck', filter: { trait: 'NoSuchTrait' } as any },
    });
    expect(s.players.A.stage).toBe(beforeStage);
  });

  it('atStartOfGamePlay replaces existing stage (trashing it) when new match found', () => {
    const s = boot();
    // Place an existing stage.
    const existing = makeStage('OLD');
    s.cardLibrary['OLD'] = existing;
    s.instances['old-i'] = {
      instanceId: 'old-i', cardId: 'OLD', controller: 'A', rested: false,
      attachedDon: ['da'], perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.stage = s.instances['old-i'];
    // Plant new matching stage in deck.
    const stage = makeStage('NEW', ['Mary Geoise']);
    s.cardLibrary['NEW'] = stage;
    s.instances['new-i'] = {
      instanceId: 'new-i', cardId: 'NEW', controller: 'A', rested: false,
      attachedDon: [], perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.deck.unshift('new-i');
    applyGameRuleOverrideV2(s, 'A', {
      atStartOfGamePlay: { fromZone: 'deck', filter: { trait: 'Mary Geoise' } as any },
    });
    expect(s.players.A.stage?.instanceId).toBe('new-i');
    expect(s.players.A.trash).toContain('old-i');
    expect(s.players.A.donRested).toContain('da');
  });

  it('applying multiple overrides composes (donDeckSize + nameAliases + deckOutGrace)', () => {
    const s = boot();
    applyGameRuleOverrideV2(s, 'A', {
      donDeckSize: 6,
      nameAliases: ['Multi'],
      deckOutGrace: 'until_end_of_turn',
    });
    expect(s.players.A.donDeck.length).toBe(6);
    expect(s.gameRules?.nameAliases?.A).toEqual(['Multi']);
    expect(s.gameRules?.deckOutGracePlayer).toBe('A');
  });
});
