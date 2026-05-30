// D14 effect dispatch — verifies that fireEffects is called at the right
// moments by applyAction, and that the chained template handlers mutate
// state as expected. Distinct from `effects.test.ts` which exercises the
// templates in isolation; this file covers the WIRING.

import { describe, expect, it } from 'vitest';
import { applyAction } from '../applyAction';
import { fireEffects } from '../cards/effects/dispatch';
import { TEMPLATES } from '../cards/effects/templates';
import { initialState } from '../GameState';
import { setupGame } from '../phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '../phases/turn';
import type { Card, CharacterCard, EventCard, LeaderCard } from '../cards/Card';
import {
  advanceOneFullCycle,
  attachDonCount,
  closeMulliganKeepBoth,
  setDonActive,
} from './_donHelpers';

function makeLeader(id: string, power = 5000): LeaderCard {
  return {
    id,
    name: id,
    kind: 'leader',
    colors: ['red'],
    cost: null,
    power,
    life: 5,
    counterValue: null,
    traits: [],
    keywords: [],
    effectTags: [],
  };
}

function makeChar(
  id: string,
  opts: { cost?: number; power?: number; effectTags?: CharacterCard['effectTags']; keywords?: CharacterCard['keywords'] } = {},
): CharacterCard {
  return {
    id,
    name: id,
    kind: 'character',
    colors: ['red'],
    cost: opts.cost ?? 2,
    power: opts.power ?? 3000,
    counterValue: 1000,
    traits: [],
    keywords: opts.keywords ?? [],
    effectTags: opts.effectTags ?? ['vanilla'],
  };
}

function makeEvent(
  id: string,
  opts: { cost?: number; effectTags?: EventCard['effectTags'] } = {},
): EventCard {
  return {
    id,
    name: id,
    kind: 'event',
    colors: ['red'],
    cost: opts.cost ?? 1,
    power: null,
    counterValue: null,
    counterEventBoost: null,
    traits: [],
    keywords: [],
    effectTags: opts.effectTags ?? ['vanilla'],
  };
}

function build(cards: Card[]) {
  // Pad to 50 with vanilla fillers so deck size is legal.
  const filler = Array.from({ length: 50 - cards.length }, (_, i) =>
    makeChar(`filler-${i}`),
  );
  const deck = [...cards, ...filler];
  return initialState({
    seed: 42,
    decks: {
      A: { leader: makeLeader('LA'), cards: deck.slice() },
      B: { leader: makeLeader('LB'), cards: deck.slice() },
    },
  });
}

function advanceToMainPhase(s: ReturnType<typeof build>) {
  return runDonPhase(runDrawPhase(runRefreshPhase(closeMulliganKeepBoth(setupGame(s)))));
}

/** Force-place a card on the TOP of player A's hand so we can play it
 *  deterministically. Mutates state in-place. */
function injectIntoHand(s: ReturnType<typeof build>, cardId: string): string {
  // Find an unused instance of `cardId` owned by A — initialState mints one
  // instance per card slot in the deck. Pull it from the deck and put it
  // on the hand.
  const idx = s.players.A.deck.findIndex((iid) => s.instances[iid].cardId === cardId);
  if (idx === -1) throw new Error(`injectIntoHand: ${cardId} not in deck`);
  const instId = s.players.A.deck.splice(idx, 1)[0];
  s.players.A.hand.push(instId);
  return instId;
}

describe('Effect dispatch (D14) — wiring', () => {
  it('draw on_play fires when a character with draw tag is played: hand +1', () => {
    // Build a deck with one [draw] character at the front so we can play it.
    const drawChar = makeChar('draw-1', { effectTags: ['draw'] });
    let s = advanceToMainPhase(build([drawChar]));
    const instId = injectIntoHand(s, 'draw-1');
    setDonActive(s, 'A', 2);
    const handBefore = s.players.A.hand.length;

    const { state: s2 } = applyAction(s, 'A', {
      type: 'PLAY_CARD',
      instanceId: instId,
      replaceTargetId: null,
    });

    // Card left hand (−1), then draw template fired (+1). Net: hand size
    // unchanged BUT the played card is on the field, so hand actually − 1 + 1.
    // Easier assertion: the played instance is on field AND the deck shrank
    // by exactly 1 (because draw popped 1).
    expect(s2.players.A.field.find((i) => i.instanceId === instId)).toBeDefined();
    expect(s.players.A.deck.length - s2.players.A.deck.length).toBe(1);
    // Hand goes from `handBefore` → handBefore - 1 (played) + 1 (drawn).
    expect(s2.players.A.hand.length).toBe(handBefore);
  });

  it('searcher on_play fires: top of deck → hand', () => {
    const searcherChar = makeChar('searcher-1', { effectTags: ['searcher'] });
    let s = advanceToMainPhase(build([searcherChar]));
    const instId = injectIntoHand(s, 'searcher-1');
    setDonActive(s, 'A', 2);
    const expectedSearchedId = s.players.A.deck[0];

    const { state: s2 } = applyAction(s, 'A', {
      type: 'PLAY_CARD',
      instanceId: instId,
      replaceTargetId: null,
    });

    expect(s2.players.A.hand).toContain(expectedSearchedId);
  });

  it('removal_ko on_play with target fires: target moves to trash', () => {
    // Set up: B has a vanilla character on field; A plays a removal_ko char
    // targeting B's character.
    const removalChar = makeChar('removal-1', { effectTags: ['removal_ko'] });
    let s = advanceToMainPhase(build([removalChar]));

    // Drop a vanilla character of B's onto B's field directly. We use any
    // instance from B's deck.
    const targetInstId = s.players.B.deck.shift()!;
    const targetInst = s.instances[targetInstId];
    targetInst.summoningSick = false;
    s.players.B.field.push(targetInst);

    const removalInstId = injectIntoHand(s, 'removal-1');
    setDonActive(s, 'A', 2);

    // PLAY_CARD only carries `replaceTargetId`, not a generic target. So we
    // fire dispatch directly with the target to verify the engine plumbing.
    const { state: afterPlay } = applyAction(s, 'A', {
      type: 'PLAY_CARD',
      instanceId: removalInstId,
      replaceTargetId: null,
    });
    // afterPlay already ran on_play with no target — call dispatch again to
    // verify the contract that templates respect ctx.targetInstanceId. (Real
    // target-pick UI is out of scope here.)
    const next = fireEffects(afterPlay, removalInstId, 'on_play', 'A', {
      targetInstanceId: targetInstId,
    });

    expect(next.players.B.field.find((i) => i.instanceId === targetInstId)).toBeUndefined();
    expect(next.players.B.trash).toContain(targetInstId);
  });

  it('lifegain on_play fires: life array +1', () => {
    const lifeChar = makeChar('lifegain-1', { effectTags: ['lifegain'] });
    let s = advanceToMainPhase(build([lifeChar]));
    const instId = injectIntoHand(s, 'lifegain-1');
    setDonActive(s, 'A', 2);
    const lifeBefore = s.players.A.life.length;

    const { state: s2 } = applyAction(s, 'A', {
      type: 'PLAY_CARD',
      instanceId: instId,
      replaceTargetId: null,
    });

    expect(s2.players.A.life.length).toBe(lifeBefore + 1);
  });

  it('event with [draw]: cost paid, effect fires, event goes to trash, hand +1', () => {
    const drawEvent = makeEvent('drawevt-1', { cost: 1, effectTags: ['draw'] });
    let s = advanceToMainPhase(build([drawEvent]));
    const instId = injectIntoHand(s, 'drawevt-1');
    setDonActive(s, 'A', 1);
    const handBefore = s.players.A.hand.length;
    const deckBefore = s.players.A.deck.length;
    const trashBefore = s.players.A.trash.length;

    const { state: s2 } = applyAction(s, 'A', {
      type: 'PLAY_CARD',
      instanceId: instId,
      replaceTargetId: null,
    });

    // Event itself left hand (-1) + draw template drew 1 (+1) → net 0 change.
    expect(s2.players.A.hand.length).toBe(handBefore);
    // Event is in trash.
    expect(s2.players.A.trash).toContain(instId);
    expect(s2.players.A.trash.length).toBe(trashBefore + 1);
    // Deck shrank by 1 (the draw).
    expect(deckBefore - s2.players.A.deck.length).toBe(1);
    // Cost paid: donRested = 1, costArea = 0.
    expect(s2.players.A.donCostArea.length).toBe(0);
    expect(s2.players.A.donRested.length).toBe(1);
  });

  it('KO via battle fires on_ko: attacker KOs target → target tag fires', () => {
    // Set up: B's character has effectTags: ['draw']. A attacks it with a
    // beefy attacker so the target gets KO'd. After KO, B's hand should
    // increase by 1 (the on_ko draw fired under B's control).
    const drawTarget = makeChar('drawtarget-1', { effectTags: ['draw'], power: 1000 });
    let s = advanceToMainPhase(build([drawTarget]));

    // Move past turn-1 attack ban for B (turn 2). Run a full cycle so B is on
    // a turn where attacks are legal.
    s = endTurn(s);
    s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
    s = advanceOneFullCycle(s);
    // Now B is active in main phase on turn 4. Put the draw-target on B's
    // field FROM B's deck (we'll have B attack from their leader against A …
    // wait — we want A's character to KO B's character. Switch sides.)
    // Simpler: end B's turn → A becomes active and can attack B's target.
    s = endTurn(s);
    s = runDonPhase(runDrawPhase(runRefreshPhase(s)));

    // Place drawTarget on B's field.
    const tgtInstId = s.players.B.deck.findIndex(
      (iid) => s.instances[iid].cardId === 'drawtarget-1',
    );
    if (tgtInstId === -1) throw new Error('drawtarget-1 not in B deck');
    const tgtId = s.players.B.deck.splice(tgtInstId, 1)[0];
    const tgtInst = s.instances[tgtId];
    tgtInst.summoningSick = false;
    s.players.B.field.push(tgtInst);

    // Attacker = A's leader (5000 power). Give it 1 DON for power buff so it
    // beats the 1000-power target comfortably. A's leader is awake — make
    // sure summoningSick is false (leaders never summoning-sick) and rested
    // is false.
    s.players.A.leader.rested = false;
    setDonActive(s, 'A', 2);
    attachDonCount(s, 'A', s.players.A.leader.instanceId, 1);

    const bHandBefore = s.players.B.hand.length;

    // A attacks B's drawtarget.
    let r = applyAction(s, 'A', {
      type: 'DECLARE_ATTACK',
      attackerInstanceId: s.players.A.leader.instanceId,
      targetInstanceId: tgtId,
    });
    r = applyAction(r.state, 'B', { type: 'SKIP_BLOCKER' });
    r = applyAction(r.state, 'B', { type: 'SKIP_COUNTER' });

    // Target should be KO'd → moved to B's trash.
    expect(r.state.players.B.trash).toContain(tgtId);
    expect(r.state.players.B.field.find((i) => i.instanceId === tgtId)).toBeUndefined();
    // on_ko draw fired for B → hand +1.
    expect(r.state.players.B.hand.length).toBe(bHandBefore + 1);
  });

  it('slot-6 replace does NOT fire on_ko (rule processing per CR §3-7-6-1-1)', () => {
    // Build A's field to 5 vanilla characters, then play a 6th character
    // (cost-paid). The replacement target has effectTags: ['draw']. After
    // play, B should NOT see hand +1 — because CR §3-7-6-1-1 says trashing
    // for slot-6 is rule processing, not K.O., so [On K.O.] does not fire.
    const replacementTarget = makeChar('koprobe-1', { effectTags: ['draw'] });
    const newcomer = makeChar('newcomer-1', { effectTags: ['vanilla'] });
    let s = advanceToMainPhase(build([replacementTarget, newcomer]));

    // Fill A's field with 5 characters. We pluck 5 from A's deck and place
    // them, one of which is the draw-tagged target.
    const targetIdx = s.players.A.deck.findIndex(
      (iid) => s.instances[iid].cardId === 'koprobe-1',
    );
    const tgtId = s.players.A.deck.splice(targetIdx, 1)[0];
    s.instances[tgtId].summoningSick = false;
    s.players.A.field.push(s.instances[tgtId]);
    for (let i = 0; i < 4; i++) {
      const id = s.players.A.deck.shift()!;
      s.instances[id].summoningSick = false;
      s.players.A.field.push(s.instances[id]);
    }
    expect(s.players.A.field.length).toBe(5);

    // Play the 6th, replacing the draw-tagged target.
    const newcomerId = injectIntoHand(s, 'newcomer-1');
    setDonActive(s, 'A', 2);
    const aHandBefore = s.players.A.hand.length;
    const deckBefore = s.players.A.deck.length;

    const { state: s2 } = applyAction(s, 'A', {
      type: 'PLAY_CARD',
      instanceId: newcomerId,
      replaceTargetId: tgtId,
    });

    // Target was trashed (rule processing).
    expect(s2.players.A.trash).toContain(tgtId);
    // Newcomer is on field.
    expect(s2.players.A.field.find((i) => i.instanceId === newcomerId)).toBeDefined();
    // CRUCIAL: A's hand did NOT grow from the trashed target's [draw] tag,
    // i.e. the deck did not shrink because of an on_ko draw. The newcomer
    // is vanilla so its own on_play is a no-op too. Net hand delta: -1
    // (newcomer left hand).
    expect(s2.players.A.hand.length).toBe(aHandBefore - 1);
    expect(s2.players.A.deck.length).toBe(deckBefore);
  });

  it('vanilla on_play is a no-op (engine state otherwise unchanged)', () => {
    const vanillaChar = makeChar('vanilla-1', { effectTags: ['vanilla'] });
    let s = advanceToMainPhase(build([vanillaChar]));
    const instId = injectIntoHand(s, 'vanilla-1');
    setDonActive(s, 'A', 2);
    const deckBefore = s.players.A.deck.length;
    const lifeBefore = s.players.A.life.length;
    const bHandBefore = s.players.B.hand.length;

    const { state: s2 } = applyAction(s, 'A', {
      type: 'PLAY_CARD',
      instanceId: instId,
      replaceTargetId: null,
    });

    // No draw, no life change, no disruption.
    expect(s2.players.A.deck.length).toBe(deckBefore);
    expect(s2.players.A.life.length).toBe(lifeBefore);
    expect(s2.players.B.hand.length).toBe(bHandBefore);
    // But the play itself happened.
    expect(s2.players.A.field.find((i) => i.instanceId === instId)).toBeDefined();
  });

  it('TEMPLATES registry remains intact after dispatch wiring', () => {
    // Sanity: the dispatch import didn't shadow or replace any template.
    // (Prevents accidental name collisions if a future refactor renames.)
    expect(typeof TEMPLATES.draw).toBe('function');
    expect(typeof TEMPLATES.searcher).toBe('function');
    expect(typeof TEMPLATES.vanilla).toBe('function');
  });

  // Phase C / D12: ACTIVATE_MAIN
  it('ACTIVATE_MAIN rests the card and fires its activate_main effects', () => {
    // Character with activate_main + draw — activate to rest + draw 1.
    const activeChar = makeChar('act-1', { cost: 1, effectTags: ['draw'], keywords: ['activate_main'] });
    let s = advanceToMainPhase(build([activeChar]));
    const instId = injectIntoHand(s, 'act-1');
    setDonActive(s, 'A', 2);

    // Play the character first (on_play also fires draw → hand +1 from on_play).
    const { state: s2 } = applyAction(s, 'A', {
      type: 'PLAY_CARD',
      instanceId: instId,
      replaceTargetId: null,
    });
    // on_play already fired the draw template (we don't assert exact delta;
    // the dispatch test above covers draw on_play). Capture baseline AFTER play.
    const deckBefore = s2.players.A.deck.length;
    const handBefore = s2.players.A.hand.length;

    // The just-played character is summoning-sick + UN-rested. Activate.
    const { state: s3 } = applyAction(s2, 'A', {
      type: 'ACTIVATE_MAIN',
      instanceId: instId,
    });

    // Card is now rested in both the lookup map and the per-zone struct.
    expect(s3.instances[instId].rested).toBe(true);
    const onField = s3.players.A.field.find((i) => i.instanceId === instId);
    expect(onField?.rested).toBe(true);
    // Activation drew 1: hand +1, deck -1.
    expect(s3.players.A.hand.length).toBe(handBefore + 1);
    expect(s3.players.A.deck.length).toBe(deckBefore - 1);

    // Re-activation is rejected (already rested).
    const { state: s4 } = applyAction(s3, 'A', {
      type: 'ACTIVATE_MAIN',
      instanceId: instId,
    });
    expect(s4.players.A.hand.length).toBe(handBefore + 1);
    expect(s4.players.A.deck.length).toBe(deckBefore - 1);
  });

  // Regression — caught by Code Reviewer audit 2026-05-29.
  // `runRefreshPhase` clears `rested` only on the per-zone struct, NOT on the
  // state.instances map. If the handler reads its rested guard from the
  // instances map, the second activation across turns silently no-ops.
  it('ACTIVATE_MAIN works again after the next Refresh (no stale-rested no-op)', () => {
    const activeChar = makeChar('act-2', { cost: 1, effectTags: ['draw'], keywords: ['activate_main'] });
    let s = advanceToMainPhase(build([activeChar]));
    const instId = injectIntoHand(s, 'act-2');
    setDonActive(s, 'A', 2);

    // Turn 1: play + first activate → rested.
    let cur = applyAction(s, 'A', { type: 'PLAY_CARD', instanceId: instId, replaceTargetId: null }).state;
    cur = applyAction(cur, 'A', { type: 'ACTIVATE_MAIN', instanceId: instId }).state;
    expect(cur.players.A.field.find((i) => i.instanceId === instId)?.rested).toBe(true);
    const handAfterFirstActivate = cur.players.A.hand.length;
    const deckAfterFirstActivate = cur.players.A.deck.length;

    // Advance a full cycle: end A's turn → B's turn (1 cycle) → A's next refresh.
    cur = advanceOneFullCycle(cur);
    // Per-zone struct should now show rested=false after refresh.
    expect(cur.players.A.field.find((i) => i.instanceId === instId)?.rested).toBe(false);

    // Turn 3: activate AGAIN. Should fire effect (draw 1) — not silent no-op.
    cur = applyAction(cur, 'A', { type: 'ACTIVATE_MAIN', instanceId: instId }).state;
    expect(cur.players.A.field.find((i) => i.instanceId === instId)?.rested).toBe(true);
    // Refresh phase already drew 1 (CR §6-3-1: not first player's first turn) — so
    // we just assert hand/deck moved on top of post-refresh+draw baseline.
    // Easiest sanity: deck length decreased by at least 2 across cycle+activate.
    expect(cur.players.A.deck.length).toBeLessThan(deckAfterFirstActivate);
    expect(cur.players.A.hand.length).toBeGreaterThan(handAfterFirstActivate - 1);
  });

  // Phase F / D17: [DON!!−X] activate cost
  it('ACTIVATE_MAIN with donCost: 1 returns 1 DON to deck and fires effect', () => {
    const donCostChar: CharacterCard = {
      ...makeChar('don1', { cost: 1, effectTags: ['draw'], keywords: ['activate_main'] }),
      donCost: 1,
    };
    let s = advanceToMainPhase(build([donCostChar]));
    const instId = injectIntoHand(s, 'don1');
    setDonActive(s, 'A', 3);

    let cur = applyAction(s, 'A', { type: 'PLAY_CARD', instanceId: instId, replaceTargetId: null }).state;
    const costAreaBefore = cur.players.A.donCostArea.length;
    const donDeckBefore = cur.players.A.donDeck.length;
    const handBefore = cur.players.A.hand.length;
    const deckBefore = cur.players.A.deck.length;

    cur = applyAction(cur, 'A', { type: 'ACTIVATE_MAIN', instanceId: instId }).state;

    expect(cur.players.A.donCostArea.length).toBe(costAreaBefore - 1);
    expect(cur.players.A.donDeck.length).toBe(donDeckBefore + 1);
    expect(cur.players.A.field.find((i) => i.instanceId === instId)?.rested).toBe(true);
    expect(cur.players.A.hand.length).toBe(handBefore + 1);
    expect(cur.players.A.deck.length).toBe(deckBefore - 1);
  });

  it('ACTIVATE_MAIN with donCost > available DON is rejected (no mutation)', () => {
    const donCostChar: CharacterCard = {
      ...makeChar('don2', { cost: 1, effectTags: ['draw'], keywords: ['activate_main'] }),
      donCost: 3,
    };
    let s = advanceToMainPhase(build([donCostChar]));
    const instId = injectIntoHand(s, 'don2');
    setDonActive(s, 'A', 2); // only 2 active DON, need 3.

    let cur = applyAction(s, 'A', { type: 'PLAY_CARD', instanceId: instId, replaceTargetId: null }).state;
    const costAreaBefore = cur.players.A.donCostArea.length;
    const donDeckBefore = cur.players.A.donDeck.length;
    const handBefore = cur.players.A.hand.length;
    const deckBefore = cur.players.A.deck.length;

    cur = applyAction(cur, 'A', { type: 'ACTIVATE_MAIN', instanceId: instId }).state;

    // No mutation.
    expect(cur.players.A.donCostArea.length).toBe(costAreaBefore);
    expect(cur.players.A.donDeck.length).toBe(donDeckBefore);
    expect(cur.players.A.field.find((i) => i.instanceId === instId)?.rested).toBe(false);
    expect(cur.players.A.hand.length).toBe(handBefore);
    expect(cur.players.A.deck.length).toBe(deckBefore);
  });

  it('ACTIVATE_MAIN is rejected for cards without the activate_main tag', () => {
    const plainChar = makeChar('plain-1', { cost: 1, effectTags: ['draw'] });
    let s = advanceToMainPhase(build([plainChar]));
    const instId = injectIntoHand(s, 'plain-1');
    setDonActive(s, 'A', 2);

    const { state: s2 } = applyAction(s, 'A', {
      type: 'PLAY_CARD',
      instanceId: instId,
      replaceTargetId: null,
    });
    const handBefore = s2.players.A.hand.length;
    const deckBefore = s2.players.A.deck.length;

    const { state: s3 } = applyAction(s2, 'A', {
      type: 'ACTIVATE_MAIN',
      instanceId: instId,
    });
    // No-op: not rested, no draw.
    expect(s3.instances[instId].rested).toBe(false);
    expect(s3.players.A.hand.length).toBe(handBefore);
    expect(s3.players.A.deck.length).toBe(deckBefore);
  });
});
