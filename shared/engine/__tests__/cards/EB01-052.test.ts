// EB01-052 Viola.
//   "[Blocker]
//    [On Play] Choose one:
//      • Look at all of your opponent's Life cards and place them back
//        in their Life area in any order.
//      • Turn all of your Life cards face-down."
//
// V0 engine notes: peek_and_reorder_opp_life and turn_all_own_life_face_down
// are intentional no-ops (engine doesn't track per-life face state).
// choose_one deterministically picks option 0.
import { describe, expect, it } from 'vitest';
import { applyActionV2 } from '../../effectSpec/runner-v2';
import { applyContinuousEffectsV2ToInstance } from '../../effectSpec/continuous-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_052 = ALL_CARDS.find(c => c.id === 'EB01-052')!;

function boot() {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['yellow'], cost: null,
    power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['yellow'],
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

describe('EB01-052 — Viola', () => {
  it('continuous grants blocker', () => {
    const s = boot();
    const c: CharacterCard = {
      id: 'VI', name: 'Viola', kind: 'character', colors: ['yellow'],
      cost: 2, power: 0, counterValue: 1000, traits: ['Dressrosa'], keywords: [], effectTags: [],
    };
    s.cardLibrary[c.id] = c;
    s.instances['vi'] = {
      instanceId: 'vi', cardId: c.id, controller: 'A',
      rested: false, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.A.field.push(s.instances['vi']);
    applyContinuousEffectsV2ToInstance(s, 'vi', EB01_052.effectSpecV2!.continuous!);
    expect(s.instances['vi'].grantedKeywords).toContain('blocker');
  });

  it('on-play choose_one resolves without error (V0 no-op for both branches)', () => {
    const s = boot();
    const before = JSON.stringify(s);
    expect(() =>
      applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, EB01_052.effectSpecV2!.clauses![0].action, []),
    ).not.toThrow();
    // peek_and_reorder is a no-op in V0; state should be untouched.
    expect(JSON.stringify(s)).toBe(before);
  });
});
