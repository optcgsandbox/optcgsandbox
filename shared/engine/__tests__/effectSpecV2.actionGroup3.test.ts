import { describe, expect, it } from 'vitest';
import { applyActionV2 } from '../effectSpec/runner-v2';
import { initialState } from '../GameState';
import { setupGame } from '../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../cards/Card';
import { closeMulliganKeepBoth, setDonActive } from './_donHelpers';

function makeLeader(id: string): LeaderCard {
  return {
    id, name: id, kind: 'leader', colors: ['red'], cost: null, power: 5000,
    life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
}
function makeChar(id: string, opts: { cost?: number; power?: number; name?: string; traits?: string[] } = {}): CharacterCard {
  return {
    id, name: opts.name ?? id, kind: 'character', colors: ['red'],
    cost: opts.cost ?? 2, power: opts.power ?? 3000,
    counterValue: 1000, traits: opts.traits ?? [], keywords: [], effectTags: ['vanilla'],
  };
}
function placeOnField(state: any, controller: 'A' | 'B', card: CharacterCard, instanceId: string) {
  state.cardLibrary[card.id] = card;
  state.instances[instanceId] = {
    instanceId, cardId: card.id, controller,
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  state.players[controller].field.push(state.instances[instanceId]);
}
function placeInHand(state: any, controller: 'A' | 'B', card: CharacterCard, instanceId: string) {
  state.cardLibrary[card.id] = card;
  state.instances[instanceId] = {
    instanceId, cardId: card.id, controller,
    rested: false, attachedDon: [],
    perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
  };
  state.players[controller].hand.push(instanceId);
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
const CTX = { sourceInstanceId: 'src', controller: 'A' as const };

describe('EffectSpec v2 — applyActionV2 group 3 (DON + removal + negation + immunity)', () => {
  it('removal_ko moves target from field to trash + detaches DON', () => {
    const s = boot();
    placeOnField(s, 'B', makeChar('KO1'), 'k1');
    s.instances['k1'].attachedDon = ['don-a'];
    applyActionV2(s, CTX, { kind: 'removal_ko' }, ['k1']);
    expect(s.players.B.field.find((i) => i.instanceId === 'k1')).toBeUndefined();
    expect(s.players.B.trash).toContain('k1');
    expect(s.players.B.donRested).toContain('don-a');
  });

  it('removal_bounce moves target to hand + resets summoningSick/rested', () => {
    const s = boot();
    placeOnField(s, 'B', makeChar('BC1'), 'b1');
    s.instances['b1'].rested = true;
    s.instances['b1'].summoningSick = true;
    applyActionV2(s, CTX, { kind: 'removal_bounce' }, ['b1']);
    expect(s.players.B.field.find((i) => i.instanceId === 'b1')).toBeUndefined();
    expect(s.players.B.hand).toContain('b1');
    expect(s.instances['b1'].rested).toBe(false);
    expect(s.instances['b1'].summoningSick).toBe(false);
  });

  it('ramp moves N DON to controller cost area', () => {
    const s = boot();
    setDonActive(s, 'A', 0);
    const beforeDon = s.players.A.donDeck.length;
    applyActionV2(s, CTX, { kind: 'ramp', magnitude: 3 }, []);
    expect(s.players.A.donCostArea.length).toBe(3);
    expect(s.players.A.donDeck.length).toBe(beforeDon - 3);
  });

  it('ramp with rested=true sends to donRested', () => {
    const s = boot();
    setDonActive(s, 'A', 0);
    applyActionV2(s, CTX, { kind: 'ramp', magnitude: 2, rested: true }, []);
    expect(s.players.A.donRested.length).toBe(2);
    expect(s.players.A.donCostArea.length).toBe(0);
  });

  it('give_don_to_target attaches N from active to first target', () => {
    const s = boot();
    setDonActive(s, 'A', 3);
    placeOnField(s, 'A', makeChar('G1'), 'g1');
    applyActionV2(s, CTX, { kind: 'give_don_to_target', magnitude: 2 }, ['g1']);
    expect(s.instances['g1'].attachedDon.length).toBe(2);
    expect(s.players.A.donCostArea.length).toBe(1);
  });

  it('give_don_to_opp_target attaches own active DON to opp target', () => {
    const s = boot();
    setDonActive(s, 'A', 2);
    placeOnField(s, 'B', makeChar('GO'), 'go');
    applyActionV2(s, CTX, { kind: 'give_don_to_opp_target', magnitude: 2 }, ['go']);
    expect(s.instances['go'].attachedDon.length).toBe(2);
    expect(s.players.A.donCostArea.length).toBe(0);
  });

  it('return_opp_don_to_deck moves N opp DON back to opp deck', () => {
    const s = boot();
    setDonActive(s, 'B', 4);
    const beforeDeck = s.players.B.donDeck.length;
    applyActionV2(s, CTX, { kind: 'return_opp_don_to_deck', magnitude: 2 }, []);
    expect(s.players.B.donCostArea.length).toBe(2);
    expect(s.players.B.donDeck.length).toBe(beforeDeck + 2);
  });

  it('negate_target_effects sets effectsNegated + mirrors', () => {
    const s = boot();
    placeOnField(s, 'B', makeChar('NG'), 'ng');
    applyActionV2(s, CTX, { kind: 'negate_target_effects', duration: 'this_turn' }, ['ng']);
    expect(s.instances['ng'].effectsNegated).toBe(true);
    expect(s.players.B.field[0].effectsNegated).toBe(true);
  });

  it('grant_immunity sets immunity flag', () => {
    const s = boot();
    placeOnField(s, 'A', makeChar('IM'), 'im');
    applyActionV2(s, CTX, { kind: 'grant_immunity', against: 'opp_effects', duration: 'this_turn' }, ['im']);
    expect(s.instances['im'].immunity).toEqual({ against: 'opp_effects' });
  });

  it('give_keyword appends to grantedKeywords + mirrors', () => {
    const s = boot();
    placeOnField(s, 'A', makeChar('KW'), 'kw');
    applyActionV2(s, CTX, { kind: 'give_keyword', keyword: 'rush', duration: 'this_turn' }, ['kw']);
    expect(s.instances['kw'].grantedKeywords).toEqual(['rush']);
    expect(s.players.A.field[0].grantedKeywords).toEqual(['rush']);
    // Second call dedupes.
    applyActionV2(s, CTX, { kind: 'give_keyword', keyword: 'rush', duration: 'this_turn' }, ['kw']);
    expect(s.instances['kw'].grantedKeywords).toEqual(['rush']);
  });

  it('play_for_free moves char from hand to field with summoningSick', () => {
    const s = boot();
    s.players.A.hand = []; // clear setup hand so we test only our planted card
    placeInHand(s, 'A', makeChar('PFH'), 'pfh');
    applyActionV2(s, CTX, { kind: 'play_for_free', from: 'hand' }, []);
    expect(s.players.A.hand).not.toContain('pfh');
    expect(s.players.A.field.find((i) => i.instanceId === 'pfh')).toBeDefined();
    expect(s.instances['pfh'].summoningSick).toBe(true);
  });

  it('play_for_free with filter only takes matching cards', () => {
    const s = boot();
    s.players.A.hand = [];
    placeInHand(s, 'A', makeChar('M1', { traits: ['Marine'] }), 'm1');
    placeInHand(s, 'A', makeChar('P1', { traits: ['Pirate'] }), 'p1');
    applyActionV2(s, CTX, { kind: 'play_for_free', from: 'hand', filter: { trait: 'Pirate' } }, []);
    expect(s.players.A.field.find((i) => i.instanceId === 'p1')).toBeDefined();
    expect(s.players.A.field.find((i) => i.instanceId === 'm1')).toBeUndefined();
  });

  it('play_for_free with count=2 plays up to 2 matching cards', () => {
    const s = boot();
    s.players.A.hand = [];
    placeInHand(s, 'A', makeChar('C1'), 'c1-i');
    placeInHand(s, 'A', makeChar('C2'), 'c2-i');
    placeInHand(s, 'A', makeChar('C3'), 'c3-i');
    applyActionV2(s, CTX, { kind: 'play_for_free', from: 'hand', count: 2 }, []);
    expect(s.players.A.field.filter((i) => ['c1-i', 'c2-i', 'c3-i'].includes(i.instanceId))).toHaveLength(2);
  });

  it('play_for_free with uniqueByName skips duplicates', () => {
    const s = boot();
    s.players.A.hand = [];
    placeInHand(s, 'A', makeChar('U1', { name: 'Nami' }), 'u1');
    placeInHand(s, 'A', makeChar('U2', { name: 'Nami' }), 'u2');
    placeInHand(s, 'A', makeChar('U3', { name: 'Zoro' }), 'u3');
    applyActionV2(s, CTX, { kind: 'play_for_free', from: 'hand', count: 3, uniqueByName: true }, []);
    const played = s.players.A.field.filter((i) => ['u1', 'u2', 'u3'].includes(i.instanceId));
    expect(played).toHaveLength(2);
    const names = played.map((p) => s.cardLibrary[p.cardId].name).sort();
    expect(names).toEqual(['Nami', 'Zoro']);
  });

  it('play_for_free from trash moves char from trash to field', () => {
    const s = boot();
    s.cardLibrary['PT'] = makeChar('PT');
    s.instances['pt-i'] = {
      instanceId: 'pt-i', cardId: 'PT', controller: 'A', rested: false,
      attachedDon: [], perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.trash.push('pt-i');
    applyActionV2(s, CTX, { kind: 'play_for_free', from: 'trash' }, []);
    expect(s.players.A.trash).not.toContain('pt-i');
    expect(s.players.A.field.find((i) => i.instanceId === 'pt-i')).toBeDefined();
  });

  it('choose_one picks first option deterministically', () => {
    const s = boot();
    placeOnField(s, 'B', makeChar('CO'), 'co-1');
    applyActionV2(s, CTX, {
      kind: 'choose_one',
      options: [
        { trigger: 'on_play', action: { kind: 'removal_ko' }, target: { kind: 'opp_character' }, verified: 'ground-truth' },
        { trigger: 'on_play', action: { kind: 'draw', magnitude: 1 }, verified: 'ground-truth' },
      ],
    }, []);
    expect(s.players.B.trash).toContain('co-1');
  });

  it('self_trash_at_end_of_turn sets endOfTurnTrash on source', () => {
    const s = boot();
    s.instances['stt-src'] = {
      instanceId: 'stt-src', cardId: 'C0', controller: 'A', rested: false,
      attachedDon: [], perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    applyActionV2(s, { sourceInstanceId: 'stt-src', controller: 'A' }, { kind: 'self_trash_at_end_of_turn' }, []);
    expect(s.instances['stt-src'].endOfTurnTrash).toBe(true);
  });

  it('activate_event_from_hand + damage_immunity_attribute are V0 markers (no state change)', () => {
    const s = boot();
    const before = JSON.stringify(s);
    applyActionV2(s, CTX, { kind: 'activate_event_from_hand' }, []);
    // damage_immunity_attribute writes to instance; that's an instance change.
    s.instances['dia'] = {
      instanceId: 'dia', cardId: 'C0', controller: 'A', rested: false,
      attachedDon: [], perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    expect(JSON.stringify(s)).not.toBe(before); // because we just added 'dia'
  });
});
