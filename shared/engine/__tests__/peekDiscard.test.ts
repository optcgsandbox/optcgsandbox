import { describe, expect, it } from 'vitest';
import { applyAction } from '../applyAction';
import { TEMPLATES } from '../cards/effects/templates';
import { initialState } from '../GameState';
import { setupGame } from '../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../phases/turn';
import { getLegalActions } from '../rules/legality';
import type { Card, CharacterCard, LeaderCard } from '../cards/Card';
import { closeMulliganKeepBoth } from './_donHelpers';

function makeLeader(id: string): LeaderCard {
  return {
    id, name: id, kind: 'leader', colors: ['red'], cost: null, power: 5000,
    life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
}
function makeChar(id: string, cost = 2): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['red'], cost, power: 3000,
    counterValue: 1000, traits: [], keywords: [], effectTags: ['vanilla'],
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

describe('V3-3 peek_choice window (real searcher)', () => {
  it('searcher with object param opens peek_choice and stashes top N', () => {
    const s = boot();
    const beforeDeck = s.players.B.deck.length;
    const s2 = TEMPLATES.searcher(s, {
      sourceInstanceId: 'src', controller: 'B', trigger: 'on_play',
      param: { lookCount: 5, addCount: 1 } as any,
    });
    expect(s2.phase).toBe('peek_choice');
    expect(s2.pendingPeek).not.toBeNull();
    expect(s2.pendingPeek!.peekedIds.length).toBe(5);
    expect(s2.players.B.deck.length).toBe(beforeDeck - 5);
    // V3-9: peeked ids registered in B's knownByViewer overlay.
    for (const id of s2.pendingPeek!.peekedIds) {
      expect(s2.knownByViewer.B).toContain(id);
    }
  });

  it('RESOLVE_PEEK adds picked, shuffles remaining back, restores resumePhase', () => {
    const s = boot();
    const originalDeckLen = s.players.B.deck.length;
    const opened = TEMPLATES.searcher(s, {
      sourceInstanceId: 'src', controller: 'B', trigger: 'on_play',
      param: { lookCount: 5, addCount: 1 } as any,
    });
    const pickId = opened.pendingPeek!.peekedIds[2];
    const handBefore = opened.players.B.hand.length;
    const { state: after } = applyAction(opened, 'B', {
      type: 'RESOLVE_PEEK',
      instanceIds: [pickId],
    });
    expect(after.players.B.hand).toContain(pickId);
    expect(after.players.B.hand.length).toBe(handBefore + 1);
    expect(after.phase).toBe('main');
    expect(after.pendingPeek).toBeNull();
    // Remaining 4 went back into deck (total = original − 1 in hand).
    expect(after.players.B.deck.length).toBe(originalDeckLen - 1);
  });

  it('SKIP_PEEK returns all peeked cards to deck', () => {
    const s = boot();
    const originalDeckLen = s.players.B.deck.length;
    const opened = TEMPLATES.searcher(s, {
      sourceInstanceId: 'src', controller: 'B', trigger: 'on_play',
      param: { lookCount: 5, addCount: 1 } as any,
    });
    const { state: after } = applyAction(opened, 'B', { type: 'SKIP_PEEK' });
    expect(after.phase).toBe('main');
    expect(after.pendingPeek).toBeNull();
    expect(after.players.B.deck.length).toBe(originalDeckLen);
  });

  it('legality in peek_choice = SKIP_PEEK + RESOLVE_PEEK per peeked card + RESIGN', () => {
    const s = boot();
    const opened = TEMPLATES.searcher(s, {
      sourceInstanceId: 'src', controller: 'B', trigger: 'on_play',
      param: { lookCount: 3, addCount: 1 } as any,
    });
    const legal = getLegalActions(opened, 'B');
    const types = legal.map((a) => a.type);
    expect(types).toContain('SKIP_PEEK');
    expect(types.filter((t) => t === 'RESOLVE_PEEK').length).toBe(3);
    expect(types).toContain('RESIGN');
  });

  it('searcher with numeric / undefined param keeps V0 take-top-1 shortcut', () => {
    const s = boot();
    const handBefore = s.players.A.hand.length;
    const s2 = TEMPLATES.searcher(s, {
      sourceInstanceId: 'src', controller: 'A', trigger: 'on_play',
    });
    expect(s2.phase).toBe(s.phase); // unchanged
    expect(s2.pendingPeek).toBeNull();
    expect(s2.players.A.hand.length).toBe(handBefore + 1);
  });
});

describe('V3-4 discard_choice window (real disruption)', () => {
  it('disruption with reveal:true opens discard_choice + exposes opp hand to controller', () => {
    const s = boot();
    const s2 = TEMPLATES.disruption(s, {
      sourceInstanceId: 'src', controller: 'B', trigger: 'on_play',
      param: { reveal: true } as any,
    });
    expect(s2.phase).toBe('discard_choice');
    expect(s2.pendingDiscard).not.toBeNull();
    expect(s2.pendingDiscard!.revealedFrom).toBe('A');
    for (const id of s2.players.A.hand) {
      expect(s2.knownByViewer.B).toContain(id);
    }
  });

  it('RESOLVE_DISCARD moves chosen opp card to opp trash + restores phase', () => {
    const s = boot();
    const opened = TEMPLATES.disruption(s, {
      sourceInstanceId: 'src', controller: 'B', trigger: 'on_play',
      param: { reveal: true } as any,
    });
    const pickId = opened.players.A.hand[1];
    const trashBefore = opened.players.A.trash.length;
    const { state: after } = applyAction(opened, 'B', {
      type: 'RESOLVE_DISCARD',
      instanceId: pickId,
    });
    expect(after.players.A.hand).not.toContain(pickId);
    expect(after.players.A.trash).toContain(pickId);
    expect(after.players.A.trash.length).toBe(trashBefore + 1);
    expect(after.phase).toBe('main');
    expect(after.pendingDiscard).toBeNull();
  });

  it('disruption with numeric / undefined param keeps V0 blind-discard shortcut', () => {
    const s = boot();
    const before = s.players.A.hand.length;
    const s2 = TEMPLATES.disruption(s, {
      sourceInstanceId: 'src', controller: 'B', trigger: 'on_play',
    });
    expect(s2.phase).toBe(s.phase);
    expect(s2.pendingDiscard).toBeNull();
    expect(s2.players.A.hand.length).toBe(before - 1);
  });
});
