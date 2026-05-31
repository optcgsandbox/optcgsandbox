import { describe, expect, it } from 'vitest';
import { EFFECT_SPEC_V2_ENABLED, fireV2Effects, shouldUseV2 } from '../effectSpec/migration-v2';
import { initialState } from '../GameState';
import { setupGame } from '../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../phases/turn';
import { applyAction } from '../applyAction';
import type { Card, CharacterCard, LeaderCard } from '../cards/Card';
import type { EffectSpecV2 } from '../effectSpec/types-v2';
import { closeMulliganKeepBoth, setDonActive, advanceOneFullCycle } from './_donHelpers';

function makeLeader(id: string): LeaderCard {
  return {
    id, name: id, kind: 'leader', colors: ['red'], cost: null, power: 5000,
    life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
}
function makeChar(id: string, opts: { spec?: EffectSpecV2; effectTags?: CharacterCard['effectTags'] } = {}): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: ['red'],
    cost: 2, power: 3000, counterValue: 1000, traits: [],
    keywords: [], effectTags: opts.effectTags ?? ['vanilla'],
    effectSpecV2: opts.spec,
  };
}
function boot(cards: Card[]) {
  let s = initialState({
    seed: 1,
    decks: { A: { leader: makeLeader('LA'), cards: cards.length === 50 ? cards : Array.from({ length: 50 }, (_, i) => makeChar(`C${i}`)) }, B: { leader: makeLeader('LB'), cards: Array.from({ length: 50 }, (_, i) => makeChar(`X${i}`)) } },
  });
  s = setupGame(s);
  s = closeMulliganKeepBoth(s);
  s = endTurn(s);
  s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
  return s;
}

describe('EffectSpec v2 — migration cut-over (A.3.10)', () => {
  it('EFFECT_SPEC_V2_ENABLED defaults to true', () => {
    expect(EFFECT_SPEC_V2_ENABLED).toBe(true);
  });

  it('shouldUseV2 returns true only when card has effectSpecV2.clauses', () => {
    const noSpec = makeChar('NO');
    expect(shouldUseV2(noSpec)).toBe(false);

    const emptySpec = makeChar('EM', {
      spec: { clauses: [], schemaVersion: 2, verified: 'auto' },
    });
    expect(shouldUseV2(emptySpec)).toBe(false);

    const fullSpec = makeChar('FU', {
      spec: {
        clauses: [{ trigger: 'on_play', action: { kind: 'draw', magnitude: 1 }, verified: 'auto' }],
        schemaVersion: 2,
        verified: 'auto',
      },
    });
    expect(shouldUseV2(fullSpec)).toBe(true);
  });

  it('shouldUseV2 returns false on undefined card', () => {
    expect(shouldUseV2(undefined)).toBe(false);
  });

  it('fireV2Effects runs clauses matching the trigger', () => {
    const s = boot([]);
    s.cardLibrary['V2'] = makeChar('V2', {
      spec: {
        clauses: [
          { trigger: 'on_play', action: { kind: 'draw', magnitude: 2 }, verified: 'auto' },
        ],
        schemaVersion: 2,
        verified: 'auto',
      },
    });
    s.instances['v2-i'] = {
      instanceId: 'v2-i', cardId: 'V2', controller: 'A', rested: false,
      attachedDon: [], perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.field.push(s.instances['v2-i']);
    const handBefore = s.players.A.hand.length;
    const after = fireV2Effects(s, 'v2-i', 'on_play', 'A');
    expect(after.players.A.hand.length).toBe(handBefore + 2);
  });

  it('fireV2Effects skips non-matching triggers', () => {
    const s = boot([]);
    s.cardLibrary['NM'] = makeChar('NM', {
      spec: {
        clauses: [
          { trigger: 'on_play', action: { kind: 'draw', magnitude: 1 }, verified: 'auto' },
        ],
        schemaVersion: 2,
        verified: 'auto',
      },
    });
    s.instances['nm-i'] = {
      instanceId: 'nm-i', cardId: 'NM', controller: 'A', rested: false,
      attachedDon: [], perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.field.push(s.instances['nm-i']);
    const before = JSON.stringify(s);
    const after = fireV2Effects(s, 'nm-i', 'on_ko', 'A');
    expect(JSON.stringify(after)).toBe(before);
  });

  it('fireV2Effects skips clauses whose condition is false', () => {
    const s = boot([]);
    s.cardLibrary['CC'] = makeChar('CC', {
      spec: {
        clauses: [
          { trigger: 'on_play', condition: { type: 'if_leader_is', name: 'NotLuffy' },
            action: { kind: 'draw', magnitude: 1 }, verified: 'auto' },
        ],
        schemaVersion: 2,
        verified: 'auto',
      },
    });
    s.instances['cc-i'] = {
      instanceId: 'cc-i', cardId: 'CC', controller: 'A', rested: false,
      attachedDon: [], perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.field.push(s.instances['cc-i']);
    const before = s.players.A.hand.length;
    const after = fireV2Effects(s, 'cc-i', 'on_play', 'A');
    expect(after.players.A.hand.length).toBe(before);
  });

  it('legacy tag-dispatch path is unchanged for cards without effectSpecV2 (no regression)', () => {
    // Boot leaves B as active player; use B for PLAY_CARD.
    const s = boot([]);
    setDonActive(s, 'B', 2);
    const tagged: CharacterCard = {
      id: 'TAG', name: 'TAG', kind: 'character', colors: ['blue'],
      cost: 1, power: 1000, counterValue: 1000, traits: [],
      keywords: [], effectTags: ['draw'],
    };
    s.cardLibrary['TAG'] = tagged;
    s.cardLibrary[s.players.B.leader.cardId].colors = ['blue']; // ensure color match
    s.instances['tag-i'] = {
      instanceId: 'tag-i', cardId: 'TAG', controller: 'B', rested: false,
      attachedDon: [], perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.B.hand.push('tag-i');
    const before = s.players.B.deck.length;
    const { state: after } = applyAction(s, 'B', { type: 'PLAY_CARD', instanceId: 'tag-i', replaceTargetId: null });
    expect(before - after.players.B.deck.length).toBe(1);
  });

  it('v2 cards with effectSpecV2 still trigger via applyAction.PLAY_CARD', () => {
    const s = boot([]);
    setDonActive(s, 'B', 2);
    const v2Card: CharacterCard = makeChar('V2A', {
      spec: {
        clauses: [
          { trigger: 'on_play', action: { kind: 'draw', magnitude: 1 }, verified: 'auto' },
        ],
        schemaVersion: 2,
        verified: 'auto',
      },
    });
    v2Card.cost = 1;
    v2Card.colors = ['blue'];
    s.cardLibrary[s.players.B.leader.cardId].colors = ['blue'];
    s.cardLibrary['V2A'] = v2Card;
    s.instances['v2a-i'] = {
      instanceId: 'v2a-i', cardId: 'V2A', controller: 'B', rested: false,
      attachedDon: [], perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.B.hand.push('v2a-i');
    const deckBefore = s.players.B.deck.length;
    const { state: after } = applyAction(s, 'B', { type: 'PLAY_CARD', instanceId: 'v2a-i', replaceTargetId: null });
    expect(deckBefore - after.players.B.deck.length).toBe(1);
  });

  it('mixed deck — v2 cards and legacy cards both work', () => {
    const s = boot([]);
    setDonActive(s, 'B', 3);
    s.cardLibrary[s.players.B.leader.cardId].colors = ['blue'];
    const v2 = makeChar('V2M', {
      spec: { clauses: [{ trigger: 'on_play', action: { kind: 'draw', magnitude: 1 }, verified: 'auto' }], schemaVersion: 2, verified: 'auto' },
    });
    v2.cost = 1;
    v2.colors = ['blue'];
    const legacy: CharacterCard = {
      id: 'LEG', name: 'LEG', kind: 'character', colors: ['blue'],
      cost: 1, power: 1000, counterValue: 1000, traits: [],
      keywords: [], effectTags: ['draw'],
    };
    s.cardLibrary['V2M'] = v2;
    s.cardLibrary['LEG'] = legacy;
    s.instances['v2m-i'] = {
      instanceId: 'v2m-i', cardId: 'V2M', controller: 'B', rested: false,
      attachedDon: [], perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.instances['leg-i'] = {
      instanceId: 'leg-i', cardId: 'LEG', controller: 'B', rested: false,
      attachedDon: [], perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.B.hand.push('v2m-i', 'leg-i');
    const deckBefore = s.players.B.deck.length;
    const r1 = applyAction(s, 'B', { type: 'PLAY_CARD', instanceId: 'v2m-i', replaceTargetId: null });
    const r2 = applyAction(r1.state, 'B', { type: 'PLAY_CARD', instanceId: 'leg-i', replaceTargetId: null });
    expect(deckBefore - r2.state.players.B.deck.length).toBe(2);
  });
  void advanceOneFullCycle;
});
