// Hidden-information projection. Strips opponent's hidden zones (hand, deck
// order, face-down life contents) before exposing state to a viewer.
//
// Public per OPTCG rules:
//   - field, stage, leader, trash       — fully public
//   - donCostArea, donRested counts     — public (DON cards anonymous anyway)
//   - pending, phase, turn, activePlayer, result — public game-flow state
//
// Hidden:
//   - opponent.hand                     — count visible, contents anonymized
//   - opponent.deck                     — count visible, order anonymized
//   - opponent.life face-DOWN entries   — count visible, contents anonymized
//     (face-up entries kept identifiable — they were revealed by an effect)
//   - opponent.donDeck                  — count visible, contents anonymized
//
// Spectator: both players treated as opponent.

import type { GameState, PlayerId, CardInstance, InstanceId } from '../engine-v2/state/types.js';

export type ViewerId = PlayerId | 'spectator';

export interface PublicGameState {
  readonly phase: string;
  readonly turn: number;
  readonly activePlayer: PlayerId;
  readonly firstPlayer: PlayerId;
  readonly pending: unknown;
  readonly result: unknown;
  readonly players: Readonly<Record<PlayerId, PublicPlayerView>>;
  // instances limited to public-visible IDs (own + opponent's public zones)
  readonly instances: Readonly<Record<InstanceId, CardInstance>>;
  readonly cardLibrary: Readonly<Record<string, unknown>>;
  readonly viewer: ViewerId;
}

export interface PublicPlayerView {
  // hand may be visible IDs (own) or anonymized count-only stubs (opp)
  readonly hand: ReadonlyArray<string>;
  readonly handHidden: boolean; // true when this player's hand is anonymized
  readonly deck: ReadonlyArray<string>;
  readonly deckHidden: boolean;
  readonly trash: ReadonlyArray<InstanceId>;
  readonly field: ReadonlyArray<CardInstance>;
  readonly stage: CardInstance | null;
  readonly leader: CardInstance;
  readonly life: ReadonlyArray<string>;
  readonly lifeFaceUp: Readonly<Record<string, boolean>>;
  readonly lifeHiddenCount: number;
  readonly donDeck: ReadonlyArray<string>;
  readonly donCostArea: ReadonlyArray<string>;
  readonly donRested: ReadonlyArray<string>;
  readonly donDeckHidden: boolean;
}

const HIDDEN_HAND_PREFIX = '__hidden_hand_';
const HIDDEN_DECK_PREFIX = '__hidden_deck_';
const HIDDEN_LIFE_PREFIX = '__hidden_life_';
const HIDDEN_DON_PREFIX = '__hidden_don_';

function anonymize(prefix: string, side: PlayerId, n: number): string {
  return `${prefix}${side}_${n}`;
}

/**
 * Build the public state for a given viewer. Pure function — does not
 * mutate input state.
 *
 * Contract:
 *   - viewer === playerId: that player's own zones are fully visible;
 *     opponent's hand/deck/face-down-life/donDeck are anonymized.
 *   - viewer === 'spectator': BOTH players' hidden zones anonymized.
 *   - opponent's PUBLIC zones (field, stage, leader, trash, donCostArea,
 *     donRested counts, lifeFaceUp face-up entries) remain fully visible.
 */
export function projectForViewer(state: GameState, viewer: ViewerId): PublicGameState {
  const players: Record<PlayerId, PublicPlayerView> = {} as Record<PlayerId, PublicPlayerView>;
  const publicInstances: Record<InstanceId, CardInstance> = {};

  for (const side of ['A', 'B'] as PlayerId[]) {
    const hideThisSide = viewer === 'spectator' || viewer !== side;
    const p = state.players[side];

    // Hand: anonymize if hiding
    let hand: string[];
    let deck: string[];
    let donDeck: string[];
    if (hideThisSide) {
      hand = p.hand.map((_, i) => anonymize(HIDDEN_HAND_PREFIX, side, i));
      deck = p.deck.map((_, i) => anonymize(HIDDEN_DECK_PREFIX, side, i));
      donDeck = p.donDeck.map((_, i) => anonymize(HIDDEN_DON_PREFIX, side, i));
    } else {
      hand = [...p.hand];
      deck = [...p.deck];
      donDeck = [...p.donDeck];
      // Include each visible-to-self instance in publicInstances.
      for (const iid of hand) {
        const inst = state.instances[iid];
        if (inst !== undefined) publicInstances[iid] = inst;
      }
      // Decks intentionally not added to instances even for self (preserves
      // top-of-deck secrecy for fairness; replay/desync still works because
      // the SERVER's authoritative state contains them).
    }

    // Life: face-up entries identifiable; face-down anonymized
    const life: string[] = [];
    const lifeFaceUp: Record<string, boolean> = {};
    let lifeHiddenCount = 0;
    for (let i = 0; i < p.life.length; i++) {
      const iid = p.life[i]!;
      const isFaceUp = p.lifeFaceUp[iid] === true;
      if (isFaceUp) {
        life.push(iid);
        lifeFaceUp[iid] = true;
        const inst = state.instances[iid];
        if (inst !== undefined) publicInstances[iid] = inst;
      } else if (!hideThisSide) {
        // Own face-down life: keep ID visible to self (UI shows back of card
        // and lets the owner peek at it via card effects; the engine state
        // is fully visible to its owner already).
        life.push(iid);
        const inst = state.instances[iid];
        if (inst !== undefined) publicInstances[iid] = inst;
      } else {
        // Opponent's face-down life: anonymize
        life.push(anonymize(HIDDEN_LIFE_PREFIX, side, i));
        lifeHiddenCount++;
      }
    }

    // Public zones: field + stage + leader + trash always visible.
    // Add field/stage/leader to publicInstances.
    for (const inst of p.field) publicInstances[inst.instanceId] = inst;
    if (p.stage !== null) publicInstances[p.stage.instanceId] = p.stage;
    publicInstances[p.leader.instanceId] = p.leader;
    for (const iid of p.trash) {
      const inst = state.instances[iid];
      if (inst !== undefined) publicInstances[iid] = inst;
    }

    players[side] = {
      hand,
      handHidden: hideThisSide,
      deck,
      deckHidden: hideThisSide,
      trash: [...p.trash],
      field: [...p.field],
      stage: p.stage,
      leader: p.leader,
      life,
      lifeFaceUp,
      lifeHiddenCount,
      donDeck,
      donCostArea: hideThisSide
        ? p.donCostArea.map((_, i) => anonymize(HIDDEN_DON_PREFIX, side, i + 10000))
        : [...p.donCostArea],
      donRested: hideThisSide
        ? p.donRested.map((_, i) => anonymize(HIDDEN_DON_PREFIX, side, i + 20000))
        : [...p.donRested],
      donDeckHidden: hideThisSide,
    };
  }

  return {
    phase: state.phase,
    turn: state.turn,
    activePlayer: state.activePlayer,
    firstPlayer: state.firstPlayer ?? 'A',
    pending: state.pending,
    result: state.result,
    players: players as Readonly<Record<PlayerId, PublicPlayerView>>,
    instances: publicInstances,
    cardLibrary: state.cardLibrary,
    viewer,
  };
}
