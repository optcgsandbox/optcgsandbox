/**
 * F-12 — three generic engine primitives that unblocked the last 3 known-wrong
 * cards (all generic; zero card-ID branches):
 *  1. `top_of_deck_from_hand` action + `binding` target resolver (ST22-001).
 *  2. clause-level `mode: main|counter` gate in EffectDispatcher (OP14-058).
 *  3. `leader_power_buff` continuous handler (ST28-004).
 */

import { beforeAll, describe, expect, it } from 'vitest';

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { fileURLToPath } from 'node:url';

import type { Card, CharacterCard, LeaderCard, EventCard } from '../cards/Card.js';
import { EffectDispatcher } from '../effects/EffectDispatcher.js';
import { ContinuousManager } from '../effects/ContinuousManager.js';
import { registerAllHandlers } from '../registry/handlers/index.js';
import { registerAllReducers } from '../reducers/index.js';
import { buildState, makeInst } from './cards/_fixtures.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

const LA: LeaderCard = {
  id: '__F12_LA', name: 'F12 LA', kind: 'leader', colors: ['red'],
  cost: null, power: 5000, counterValue: null, traits: [], keywords: [], effectTags: [], life: 5,
};
const LB: LeaderCard = { ...LA, id: '__F12_LB' };
const WB: CharacterCard = {
  id: '__F12_WB', name: 'F12 WB', kind: 'character', colors: ['red'],
  cost: 2, power: 3000, counterValue: 1000, traits: ['Whitebeard Pirates'], keywords: [], effectTags: [],
};
const DECKCARD: CharacterCard = { ...WB, id: '__F12_DK', name: 'F12 Deck', traits: [] };

let cards: Card[];
const byId = (id: string) => cards.find((c) => (c as { id: string }).id === id)!;

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
  cards = JSON.parse(readFileSync(resolve(__dirname, '../../data/cards.json'), 'utf8')) as Card[];
});

// ─────────────────────────────────────────────────────────────────────
// Blocker 1 — top_of_deck_from_hand + binding (ST22-001)
// ─────────────────────────────────────────────────────────────────────
describe('F-12 Blocker 1 — top_of_deck_from_hand (ST22-001)', () => {
  function setup(human: boolean, chosen?: string) {
    const built = buildState({ leaderA: LA, leaderB: LB });
    const s = built.state;
    if (human) s.humanControllers = ['A'];
    s.cardLibrary['ST22-001'] = byId('ST22-001');
    const src = makeInst('ST22-001', 'A');
    s.instances[src.instanceId] = src;
    // ST22-001 is a leader; place as source. (We dispatch its activate_main directly.)
    s.cardLibrary[WB.id] = WB;
    const wb = makeInst(WB.id, 'A');
    s.instances[wb.instanceId] = wb;
    s.players.A.hand.push(wb.instanceId);
    s.cardLibrary[DECKCARD.id] = DECKCARD;
    const dk = makeInst(DECKCARD.id, 'A');
    s.instances[dk.instanceId] = dk;
    s.players.A.deck.push(dk.instanceId);
    const opts = chosen ? { chosenCostIds: { revealHand: [chosen] } } : undefined;
    const after = EffectDispatcher.dispatch(s, { sourceInstanceId: src.instanceId, controller: 'A' }, 'activate_main', 0, opts);
    return { after, wbId: wb.instanceId, dkId: dk.instanceId };
  }

  it('AI/sim path: the revealed WB card is removed from hand and becomes the TOP of deck; draw 1 happens', () => {
    const { after, wbId, dkId } = setup(false);
    expect(after.players.A.deck[0]).toBe(wbId);              // chosen card on TOP of deck
    expect(after.players.A.hand.includes(wbId)).toBe(false); // removed from hand
    expect(after.players.A.hand.includes(dkId)).toBe(true);  // the drawn card is in hand
  });

  it('human-choice path: the player-chosen revealed card (chosenCostIds) is the one placed on top', () => {
    // build explicitly so we can feed the real chosen hand-card id
    const s = buildState({ leaderA: LA, leaderB: LB }).state;
    s.humanControllers = ['A'];
    s.cardLibrary['ST22-001'] = byId('ST22-001');
    const src = makeInst('ST22-001', 'A'); s.instances[src.instanceId] = src;
    s.cardLibrary[WB.id] = WB;
    const wb = makeInst(WB.id, 'A'); s.instances[wb.instanceId] = wb; s.players.A.hand.push(wb.instanceId);
    const wb2 = makeInst(WB.id, 'A'); s.instances[wb2.instanceId] = wb2; s.players.A.hand.push(wb2.instanceId); // a second WB so the choice matters
    s.cardLibrary[DECKCARD.id] = DECKCARD;
    const dk = makeInst(DECKCARD.id, 'A'); s.instances[dk.instanceId] = dk; s.players.A.deck.push(dk.instanceId);
    const after = EffectDispatcher.dispatch(s, { sourceInstanceId: src.instanceId, controller: 'A' }, 'activate_main', 0, { chosenCostIds: { revealHand: [wb2.instanceId] } });
    expect(after.players.A.deck[0]).toBe(wb2.instanceId);          // the CHOSEN card, not the first
    expect(after.players.A.hand.includes(wb2.instanceId)).toBe(false);
  });

  it('no hidden-info leak: opponent hand/deck untouched by our top-of-deck move', () => {
    const { after } = setup(false);
    expect(after.players.B.hand.length).toBe(0);
    expect(after.players.B.deck.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Blocker 2 — clause mode gate (OP14-058)
// ─────────────────────────────────────────────────────────────────────
describe('F-12 Blocker 2 — [Main]/[Counter] mode gate (OP14-058)', () => {
  function play(mode: 'main' | 'counter') {
    const built = buildState({ leaderA: LA, leaderB: LB, donInCostA: 10 });
    const s = built.state;
    s.cardLibrary['OP14-058'] = byId('OP14-058');
    const ev = makeInst('OP14-058', 'A');
    s.instances[ev.instanceId] = ev;
    s.players.A.field.push(ev);
    s.cardLibrary[DECKCARD.id] = DECKCARD;
    const dk = makeInst(DECKCARD.id, 'A'); s.instances[dk.instanceId] = dk; s.players.A.deck.push(dk.instanceId);
    const opts = mode === 'counter' ? { mode: 'counter' as const } : undefined;
    return EffectDispatcher.dispatch(s, { sourceInstanceId: ev.instanceId, controller: 'A' }, 'on_play', 0, opts);
  }

  it('COUNTER mode: only the [Counter] clauses fire (draw 1 + Leader +3000 this battle)', () => {
    const after = play('counter');
    expect(after.players.A.hand.length).toBe(1);                          // drew 1 ([Counter])
    expect(after.players.A.leader.powerModifierThisBattle ?? 0).toBe(3000); // Leader +3000 ([Counter])
  });

  it('MAIN mode: the [Counter] clauses do NOT fire (no draw, no Leader +3000)', () => {
    const after = play('main');
    expect(after.players.A.deck.length).toBe(1);                          // no [Counter] draw (deck untouched)
    expect(after.players.A.leader.powerModifierThisBattle ?? 0).toBe(0);  // no [Counter] Leader buff
  });
});

// ─────────────────────────────────────────────────────────────────────
// Blocker 3 — leader_power_buff continuous (ST28-004)
// ─────────────────────────────────────────────────────────────────────
describe('F-12 Blocker 3 — leader_power_buff continuous (ST28-004)', () => {
  function withSource(opts: { lives: number; ownTurn: boolean; onField: boolean }) {
    const built = buildState({ leaderA: LA, leaderB: LB });
    const s = built.state;
    s.activePlayer = opts.ownTurn ? 'A' : 'B';
    s.cardLibrary['ST28-004'] = byId('ST28-004');
    if (opts.onField) {
      const src = makeInst('ST28-004', 'A');
      s.instances[src.instanceId] = src;
      s.players.A.field.push(src);
    }
    s.cardLibrary[DECKCARD.id] = DECKCARD;
    for (let i = 0; i < opts.lives; i++) { const li = makeInst(DECKCARD.id, 'A'); s.instances[li.instanceId] = li; s.players.A.life.push(li.instanceId); }
    return ContinuousManager.refold(s);
  }

  it('Leader gains +1000 from the character source when condition holds (≤2 Life, own turn)', () => {
    const s = withSource({ lives: 2, ownTurn: true, onField: true });
    expect(s.players.A.leader.powerModifierContinuous ?? 0).toBe(1000);
  });

  it('idempotent: a second refold does not stack the buff', () => {
    let s = withSource({ lives: 2, ownTurn: true, onField: true });
    s = ContinuousManager.refold(s);
    expect(s.players.A.leader.powerModifierContinuous ?? 0).toBe(1000);
  });

  it('buff is absent when condition is false (3 Life)', () => {
    const s = withSource({ lives: 3, ownTurn: true, onField: true });
    expect(s.players.A.leader.powerModifierContinuous ?? 0).toBe(0);
  });

  it('buff is absent when the source is not on the field', () => {
    const s = withSource({ lives: 2, ownTurn: true, onField: false });
    expect(s.players.A.leader.powerModifierContinuous ?? 0).toBe(0);
  });
});
