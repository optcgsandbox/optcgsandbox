import { describe, expect, it } from 'vitest';
import { applyActionV2 } from '../effectSpec/runner-v2';
import { initialState } from '../GameState';
import { setupGame } from '../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../cards/Card';
import { closeMulliganKeepBoth } from './_donHelpers';

function makeLeader(id: string): LeaderCard {
  return {
    id, name: id, kind: 'leader', colors: ['red'], cost: null, power: 5000,
    life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
}
function makeChar(id: string, cost = 2, name = id, traits: string[] = []): CharacterCard {
  return {
    id, name, kind: 'character', colors: ['red'], cost, power: 3000,
    counterValue: 1000, traits, keywords: [], effectTags: ['vanilla'],
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
const CTX = { sourceInstanceId: 'src', controller: 'A' as const };

describe('EffectSpec v2 — applyActionV2 group 1 (card movement & draw)', () => {
  it('draw with magnitude=2 moves 2 from deck to hand', () => {
    const s = boot();
    const handBefore = s.players.A.hand.length;
    applyActionV2(s, CTX, { kind: 'draw', magnitude: 2 }, []);
    expect(s.players.A.hand.length).toBe(handBefore + 2);
  });

  it('draw stops at empty deck', () => {
    const s = boot();
    s.players.A.deck = ['d1'];
    applyActionV2(s, CTX, { kind: 'draw', magnitude: 5 }, []);
    expect(s.players.A.deck.length).toBe(0);
  });

  it('draw with formula match_opp_don pulls equal to opp DON count', () => {
    const s = boot();
    s.players.B.donCostArea = ['x', 'y', 'z'];
    const handBefore = s.players.A.hand.length;
    applyActionV2(s, CTX, { kind: 'draw', magnitude: { kind: 'match_opp_don' } } as any, []);
    expect(s.players.A.hand.length).toBe(handBefore + 3);
  });

  it('draw with formula read_state(own_trash_count) uses trash size', () => {
    const s = boot();
    s.players.A.trash = ['t1', 't2'];
    const handBefore = s.players.A.hand.length;
    applyActionV2(s, CTX, { kind: 'draw', magnitude: { kind: 'read_state', source: 'own_trash_count' } } as any, []);
    expect(s.players.A.hand.length).toBe(handBefore + 2);
  });

  it('mill_self moves top N to trash', () => {
    const s = boot();
    const beforeDeck = s.players.A.deck.length;
    const beforeTrash = s.players.A.trash.length;
    applyActionV2(s, CTX, { kind: 'mill_self', magnitude: 3 }, []);
    expect(s.players.A.deck.length).toBe(beforeDeck - 3);
    expect(s.players.A.trash.length).toBe(beforeTrash + 3);
  });

  it('mill_opp moves top N of opp deck to opp trash', () => {
    const s = boot();
    const beforeDeck = s.players.B.deck.length;
    const beforeTrash = s.players.B.trash.length;
    applyActionV2(s, CTX, { kind: 'mill_opp', magnitude: 2 }, []);
    expect(s.players.B.deck.length).toBe(beforeDeck - 2);
    expect(s.players.B.trash.length).toBe(beforeTrash + 2);
  });

  it('lifegain moves top of deck to top of own life', () => {
    const s = boot();
    const lifeBefore = s.players.A.life.length;
    const deckTopBefore = s.players.A.deck[0];
    applyActionV2(s, CTX, { kind: 'lifegain', magnitude: 1 }, []);
    expect(s.players.A.life.length).toBe(lifeBefore + 1);
    expect(s.players.A.life[0]).toBe(deckTopBefore);
  });

  it('life_to_hand moves top life card to hand', () => {
    const s = boot();
    s.players.A.life = ['l1', 'l2', 'l3'];
    const handBefore = s.players.A.hand.length;
    applyActionV2(s, CTX, { kind: 'life_to_hand', magnitude: 1 }, []);
    expect(s.players.A.life).toEqual(['l2', 'l3']);
    expect(s.players.A.hand.length).toBe(handBefore + 1);
  });

  it('add_to_own_life_top from top_of_deck moves deck top to life top', () => {
    const s = boot();
    const lifeBefore = s.players.A.life.length;
    const top = s.players.A.deck[0];
    applyActionV2(s, CTX, { kind: 'add_to_own_life_top', faceUp: true, from: 'top_of_deck' }, []);
    expect(s.players.A.life[0]).toBe(top);
    expect(s.players.A.life.length).toBe(lifeBefore + 1);
  });

  it('add_to_own_life_top from hand uses targets[0]', () => {
    const s = boot();
    s.players.A.hand = ['h1', 'h2'];
    applyActionV2(s, CTX, { kind: 'add_to_own_life_top', faceUp: true, from: 'hand' }, ['h2']);
    expect(s.players.A.hand).toEqual(['h1']);
    expect(s.players.A.life[0]).toBe('h2');
  });

  it('add_to_own_life_top from own_trash uses targets[0]', () => {
    const s = boot();
    s.players.A.trash = ['t1', 't2'];
    applyActionV2(s, CTX, { kind: 'add_to_own_life_top', faceUp: true, from: 'own_trash' }, ['t1']);
    expect(s.players.A.trash).toEqual(['t2']);
    expect(s.players.A.life[0]).toBe('t1');
  });

  it('add_to_opp_life_top moves opp deck top to opp life top', () => {
    const s = boot();
    const beforeLife = s.players.B.life.length;
    const top = s.players.B.deck[0];
    applyActionV2(s, CTX, { kind: 'add_to_opp_life_top', faceUp: true }, []);
    expect(s.players.B.life[0]).toBe(top);
    expect(s.players.B.life.length).toBe(beforeLife + 1);
  });

  it('add_to_opp_hand_from_opp_life moves opp life top to opp hand', () => {
    const s = boot();
    s.players.B.life = ['lb1', 'lb2'];
    const beforeHand = s.players.B.hand.length;
    applyActionV2(s, CTX, { kind: 'add_to_opp_hand_from_opp_life' }, []);
    expect(s.players.B.life).toEqual(['lb2']);
    expect(s.players.B.hand.length).toBe(beforeHand + 1);
  });

  it('reveal_opp_hand populates knownByViewer[controller]', () => {
    const s = boot();
    s.players.B.hand = ['b1', 'b2'];
    applyActionV2(s, CTX, { kind: 'reveal_opp_hand' }, []);
    expect(s.knownByViewer.A).toContain('b1');
    expect(s.knownByViewer.A).toContain('b2');
  });

  it('peek_opp_deck adds top N of opp deck to controllers known overlay', () => {
    const s = boot();
    s.players.B.deck = ['ob1', 'ob2', 'ob3', 'ob4'];
    applyActionV2(s, CTX, { kind: 'peek_opp_deck', count: 2 }, []);
    expect(s.knownByViewer.A).toContain('ob1');
    expect(s.knownByViewer.A).toContain('ob2');
    expect(s.knownByViewer.A).not.toContain('ob3');
  });

  it('take_from_opp_hand defaults to first card and moves to controller', () => {
    const s = boot();
    s.players.B.hand = ['ob1', 'ob2'];
    const beforeMyHand = s.players.A.hand.length;
    applyActionV2(s, CTX, { kind: 'take_from_opp_hand' }, []);
    expect(s.players.B.hand).toEqual(['ob2']);
    expect(s.players.A.hand.length).toBe(beforeMyHand + 1);
    expect(s.players.A.hand).toContain('ob1');
  });

  it('take_from_opp_hand respects targets[0] when provided', () => {
    const s = boot();
    s.players.B.hand = ['ob1', 'ob2'];
    applyActionV2(s, CTX, { kind: 'take_from_opp_hand' }, ['ob2']);
    expect(s.players.B.hand).toEqual(['ob1']);
    expect(s.players.A.hand).toContain('ob2');
  });

  it('search_deck pulls first card matching filter', () => {
    const s = boot();
    s.cardLibrary['MATCH'] = makeChar('MATCH', 2, 'Special');
    s.instances['mi'] = {
      instanceId: 'mi', cardId: 'MATCH', controller: 'A', rested: false,
      attachedDon: [], perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.deck.push('mi');
    const handBefore = s.players.A.hand.length;
    applyActionV2(s, CTX, { kind: 'search_deck', filter: { nameIs: 'Special' } }, []);
    expect(s.players.A.hand).toContain('mi');
    expect(s.players.A.hand.length).toBe(handBefore + 1);
  });

  it('searcher_peek pulls first card matching filter (from top lookCount)', () => {
    const s = boot();
    s.cardLibrary['SEARCH'] = makeChar('SEARCH', 2, 'Sub', ['Straw Hat Crew']);
    s.instances['si'] = {
      instanceId: 'si', cardId: 'SEARCH', controller: 'A', rested: false,
      attachedDon: [], perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    // Searcher_peek only inspects the top `lookCount`; unshift to position 0.
    s.players.A.deck.unshift('si');
    applyActionV2(s, CTX, { kind: 'searcher_peek', lookCount: 5, addCount: 1, filter: { trait: 'Straw Hat Crew' } }, []);
    expect(s.players.A.hand).toContain('si');
  });

  it('bottom_of_deck_from_trash moves N from trash to deck bottom', () => {
    const s = boot();
    s.players.A.trash = ['t1', 't2', 't3'];
    const beforeDeckLen = s.players.A.deck.length;
    applyActionV2(s, CTX, { kind: 'bottom_of_deck_from_trash', magnitude: 2 }, []);
    expect(s.players.A.trash).toEqual(['t3']);
    expect(s.players.A.deck.length).toBe(beforeDeckLen + 2);
  });

  it('recursion with filter returns first matching trash card to hand', () => {
    const s = boot();
    s.cardLibrary['RT'] = makeChar('RT', 3, 'Recur', ['Marine']);
    s.instances['rti'] = {
      instanceId: 'rti', cardId: 'RT', controller: 'A', rested: false,
      attachedDon: [], perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.trash = ['t1', 'rti', 't2'];
    applyActionV2(s, CTX, { kind: 'recursion', filter: { trait: 'Marine' } }, []);
    expect(s.players.A.trash).toEqual(['t1', 't2']);
    expect(s.players.A.hand).toContain('rti');
  });

  it('move_to_top from hand puts target on top of deck', () => {
    const s = boot();
    s.players.A.hand = ['h1', 'h2'];
    applyActionV2(s, CTX, { kind: 'move_to_top' }, ['h2']);
    expect(s.players.A.hand).toEqual(['h1']);
    expect(s.players.A.deck[0]).toBe('h2');
  });

  it('exile from field moves instance to exile zone + detaches DON', () => {
    const s = boot();
    s.cardLibrary['EX'] = makeChar('EX', 2);
    s.instances['ex-i'] = {
      instanceId: 'ex-i', cardId: 'EX', controller: 'B', rested: false,
      attachedDon: ['d-attached'], perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.B.field.push(s.instances['ex-i']);
    applyActionV2(s, CTX, { kind: 'exile' }, ['ex-i']);
    expect(s.players.B.field).toHaveLength(0);
    expect(s.players.B.exile).toContain('ex-i');
    expect(s.players.B.donRested).toContain('d-attached');
  });

  it('exile from trash moves to exile', () => {
    const s = boot();
    s.players.A.trash = ['t1'];
    applyActionV2(s, CTX, { kind: 'exile' }, ['t1']);
    expect(s.players.A.trash).toEqual([]);
    expect(s.players.A.exile).toContain('t1');
  });

  it('reveal_top_and_conditional_play plays top card from deck when matching filter', () => {
    const s = boot();
    const deckLenBefore = s.players.A.deck.length;
    const fieldLenBefore = s.players.A.field.length;
    applyActionV2(s, CTX, { kind: 'reveal_top_and_conditional_play', filter: {} }, []);
    // Vanilla top card matches empty filter → moves from deck to field.
    expect(s.players.A.deck.length).toBe(deckLenBefore - 1);
    expect(s.players.A.field.length).toBe(fieldLenBefore + 1);
  });

  it('reveal_top_and_conditional_play is a no-op when filter rejects', () => {
    const s = boot();
    const before = JSON.stringify(s);
    applyActionV2(s, CTX, { kind: 'reveal_top_and_conditional_play', filter: { trait: '__nonexistent__' } }, []);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('other composite stubs (choose_cost_reveal_opp_match, empty choose_one) return state unchanged', () => {
    const s = boot();
    const before = JSON.stringify(s);
    applyActionV2(s, CTX, { kind: 'choose_cost_reveal_opp_match', thenAction: { kind: 'draw', magnitude: 1 } } as any, []);
    applyActionV2(s, CTX, { kind: 'choose_one', options: [] }, []);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('cross-group actions (power_buff, removal_ko) are no-ops in A.3.3', () => {
    const s = boot();
    const before = JSON.stringify(s);
    applyActionV2(s, CTX, { kind: 'power_buff', magnitude: 1000, duration: 'this_turn' }, []);
    applyActionV2(s, CTX, { kind: 'removal_ko' }, []);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('trash_face_up_life + turn_all_own_life_face_down are V0 no-ops (no faceUp tracking)', () => {
    const s = boot();
    const before = JSON.stringify(s);
    applyActionV2(s, CTX, { kind: 'trash_face_up_life' }, []);
    applyActionV2(s, CTX, { kind: 'turn_all_own_life_face_down' }, []);
    expect(JSON.stringify(s)).toBe(before);
  });
});
