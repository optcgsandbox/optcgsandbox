/**
 * MatchSession — public projection.
 *
 * Validates that `getPublicStateFor(viewer)` never leaks opponent hand
 * cardIds, deck ordering, or face-down life contents. The projection is
 * the safety layer protecting hidden info when the server later broadcasts
 * state to multiple clients over a wire.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { registerAllHandlers } from '../../engine-v2/registry/handlers/index.js';
import { registerAllReducers } from '../../engine-v2/reducers/index.js';
import {
  buildBasicGameState,
  moveTopOfDeckToHand,
} from '../../engine-v2/__tests__/fixtures.js';
import { MatchSession } from '../MatchSession.js';
import { projectForViewer } from '../publicProjection.js';

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

describe('MatchSession — public projection', () => {
  it("opponent's hand contents are anonymized but count preserved", () => {
    const initial = buildBasicGameState();
    // Give B 3 cards in hand.
    moveTopOfDeckToHand(initial, 'B');
    moveTopOfDeckToHand(initial, 'B');
    moveTopOfDeckToHand(initial, 'B');
    const oppHandIds = [...initial.players['B'].hand];
    const session = new MatchSession(initial);

    const viewA = session.getPublicStateFor('A');

    // Count preserved
    expect(viewA.players['B'].hand.length).toBe(3);
    expect(viewA.players['B'].handHidden).toBe(true);
    // None of the real IDs leak through
    for (const realId of oppHandIds) {
      expect(viewA.players['B'].hand).not.toContain(realId);
    }
    // No hidden instance entries point to the real card IDs
    for (const realId of oppHandIds) {
      expect(viewA.instances[realId]).toBeUndefined();
    }
    // Anonymized stubs are present
    for (const stub of viewA.players['B'].hand) {
      expect(stub).toMatch(/^__hidden_hand_B_\d+$/);
    }
  });

  it("opponent's deck is anonymized; own deck is also anonymized (top secrecy)", () => {
    const initial = buildBasicGameState();
    const session = new MatchSession(initial);

    const viewA = session.getPublicStateFor('A');
    expect(viewA.players['B'].deckHidden).toBe(true);
    for (const stub of viewA.players['B'].deck) {
      expect(stub).toMatch(/^__hidden_deck_B_\d+$/);
    }
    // Own deck stays visible by ID (the local engine needs deck refs for
    // mulligan, draws, etc.); but face-down life remains the player's own.
    expect(viewA.players['A'].deckHidden).toBe(false);
  });

  it('face-down life is anonymized for the opponent; face-up is identifiable', () => {
    const initial = buildBasicGameState();
    // Flip A.life[2] face-up by mutation (real game would only do this via
    // a `peek_life` effect; this is a test shortcut).
    const lifeId = initial.players['A'].life[2]!;
    initial.players['A'].lifeFaceUp = { [lifeId]: true };
    const session = new MatchSession(initial);

    const viewB = session.getPublicStateFor('B');
    // A is the opponent of B → face-up entry kept as real id, others hidden
    expect(viewB.players['A'].life).toContain(lifeId);
    expect(viewB.players['A'].lifeFaceUp[lifeId]).toBe(true);
    // Other 4 entries are hidden stubs
    const stubs = viewB.players['A'].life.filter((x) =>
      x.startsWith('__hidden_life_'),
    );
    expect(stubs.length).toBe(4);
    expect(viewB.players['A'].lifeHiddenCount).toBe(4);
  });

  it('spectator view hides BOTH players hidden zones', () => {
    const initial = buildBasicGameState();
    moveTopOfDeckToHand(initial, 'A');
    moveTopOfDeckToHand(initial, 'B');
    const session = new MatchSession(initial);

    const spectator = session.getPublicStateFor('spectator');
    expect(spectator.players['A'].handHidden).toBe(true);
    expect(spectator.players['B'].handHidden).toBe(true);
    expect(spectator.players['A'].deckHidden).toBe(true);
    expect(spectator.players['B'].deckHidden).toBe(true);
  });

  it('public zones (field, stage, leader, trash) remain visible to the opponent', () => {
    const initial = buildBasicGameState();
    const handId = moveTopOfDeckToHand(initial, 'A');
    const session = new MatchSession(initial);
    session.applyPlayerAction('A', {
      type: 'PLAY_CARD',
      instanceId: handId,
      replaceTargetId: null,
    });

    // B sees A's field/leader/stage as-is.
    const viewB = session.getPublicStateFor('B');
    expect(viewB.players['A'].field.length).toBe(1);
    expect(viewB.players['A'].field[0]!.instanceId).toBe(handId);
    expect(viewB.players['A'].leader.instanceId).toBe(
      session.getAuthoritativeState().players['A'].leader.instanceId,
    );
  });

  it('projection is pure — does not mutate the source state', () => {
    const state = buildBasicGameState();
    moveTopOfDeckToHand(state, 'A');
    moveTopOfDeckToHand(state, 'B');
    const before = JSON.stringify({
      ahand: state.players['A'].hand,
      bhand: state.players['B'].hand,
      adeck: state.players['A'].deck,
      bdeck: state.players['B'].deck,
    });

    projectForViewer(state, 'A');
    projectForViewer(state, 'B');
    projectForViewer(state, 'spectator');

    const after = JSON.stringify({
      ahand: state.players['A'].hand,
      bhand: state.players['B'].hand,
      adeck: state.players['A'].deck,
      bdeck: state.players['B'].deck,
    });
    expect(after).toBe(before);
  });
});
