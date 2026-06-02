// EB02-015 Jewelry Bonney.
//   "[On Play] Up to 1 of your opponent's rested Characters will not
//    become active in your opponent's next Refresh Phase. Then, set up
//    to 1 of your DON!! cards as active at the end of this turn."
//
// Spec shape: single on_play clause with action.kind='sequence':
//   1. rest_lock_until_phase on opp rested char
//   2. schedule_at_end_of_own_turn { set_active_don magnitude: 1 }
// The delayed don-active is enqueued at on_play, fires once at end of
// THIS turn, and is independent of Bonney's later presence on field.
import { describe, expect, it } from 'vitest';
import { applyActionV2 } from '../../effectSpec/runner-v2';
import { initialState } from '../../GameState';
import { setupGame } from '../../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../../phases/turn';
import type { Card, CharacterCard, LeaderCard } from '../../cards/Card';
import { closeMulliganKeepBoth } from '../_donHelpers';
import cardsData from '../../../data/cards.json';

const ALL_CARDS = cardsData as unknown as Card[];
const EB02_015 = ALL_CARDS.find(c => c.id === 'EB02-015')!;

function boot() {
  const lead: LeaderCard = {
    id: 'LA', name: 'LA', kind: 'leader', colors: ['green'], cost: null,
    power: 5000, life: 5, counterValue: null, traits: [], keywords: [], effectTags: [],
  };
  const filler = Array.from({ length: 50 }, (_, i): CharacterCard => ({
    id: `F${i}`, name: `F${i}`, kind: 'character', colors: ['green'],
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

describe('EB02-015 — Jewelry Bonney', () => {
  const clause = EB02_015.effectSpecV2!.clauses![0];

  it('on_play sequence: rest-lock target + schedule end-of-turn ramp', () => {
    const s = boot();
    const c: CharacterCard = {
      id: 'OC', name: 'OC', kind: 'character', colors: ['green'],
      cost: 3, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
    };
    s.cardLibrary[c.id] = c;
    s.instances['oc'] = {
      instanceId: 'oc', cardId: c.id, controller: 'B',
      rested: true, attachedDon: [],
      perTurn: { hasAttacked: false, effectsUsed: [] }, summoningSick: false,
    };
    s.players.B.field.push(s.instances['oc']);
    s.players.A.donRested = ['r1'];
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, []);
    expect(s.instances['oc'].restLocked).toBe(true);
    expect(s.players.A.pendingEndOfTurn?.length).toBe(1);
  });

  it('delayed action fires at end of THIS turn (don rest → active) and queue empties (one-shot)', () => {
    const s = boot();
    s.players.A.donRested = ['r1'];
    applyActionV2(s, { sourceInstanceId: 'src', controller: 'A' }, clause.action, []);
    expect(s.players.A.pendingEndOfTurn?.length).toBe(1);
    // End of A's current turn — should drain the queue and set 1 DON active.
    const s2 = endTurn(s);
    expect(s2.players.A.donRested.length).toBe(0);
    expect(s2.players.A.donCostArea.length).toBeGreaterThan(0);
    expect(s2.players.A.pendingEndOfTurn?.length ?? 0).toBe(0);
  });
});
