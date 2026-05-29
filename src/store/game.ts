// Game store — Zustand slice wrapping the engine.
// Source of truth = a single GameState. Actions dispatch through engine.applyAction.

import { create } from 'zustand';
import { applyAction } from '@shared/engine/applyAction';
import { initialState } from '@shared/engine/GameState';
import { setupGame } from '@shared/engine/phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '@shared/engine/phases/turn';
import { getLegalActions } from '@shared/engine/rules/legality';
import type { Action } from '@shared/protocol/actions';
import type { Card, CharacterCard, LeaderCard } from '@shared/engine/cards/Card';
import type { GameState, PlayerId } from '@shared/engine/GameState';

function makeLeader(id: string, color: 'red' | 'blue' = 'red'): LeaderCard {
  return {
    id, name: id, kind: 'leader', colors: [color], cost: null, power: 5000,
    life: 5, counterValue: null, traits: ['Straw Hat Crew'], keywords: [], effectTags: [],
  };
}
function makeChar(id: string, cost: number, power: number, color: 'red' | 'blue' = 'red'): CharacterCard {
  return {
    id, name: id, kind: 'character', colors: [color], cost, power,
    counterValue: 1000, traits: [], keywords: [], effectTags: ['vanilla'],
  };
}

/** Quick test deck: 50 vanilla characters at varying costs. */
function quickDeck(color: 'red' | 'blue'): Card[] {
  const deck: Card[] = [];
  // 4× each at cost 1-9 + 2× cost 10 = ~50 cards
  for (let cost = 1; cost <= 9; cost++) {
    for (let copy = 0; copy < 4; copy++) {
      deck.push(makeChar(`${color}-${cost}-${copy}`, cost, cost * 1000 + 1000, color));
    }
  }
  // Filler
  while (deck.length < 50) {
    deck.push(makeChar(`${color}-x-${deck.length}`, 4, 5000, color));
  }
  return deck.slice(0, 50);
}

function bootGame(seed: number): GameState {
  let s = initialState({
    seed,
    decks: {
      A: { leader: makeLeader('LA', 'red'), cards: quickDeck('red') },
      B: { leader: makeLeader('LB', 'blue'), cards: quickDeck('blue') },
    },
  });
  s = setupGame(s);
  s = runRefreshPhase(s);
  s = runDrawPhase(s);
  s = runDonPhase(s);
  return s;
}

interface GameStore {
  state: GameState;
  /** Hot-seat: who is the human player "controlling" this device. In hot-seat both. */
  viewAs: PlayerId;
  legalActions: Action[];
  dispatch: (action: Action) => void;
  reset: (seed?: number) => void;
  setViewAs: (p: PlayerId) => void;
  endTurnAndAdvance: () => void;
}

export const useGameStore = create<GameStore>((set, get) => {
  const initial = bootGame(Date.now() & 0xffffffff);
  return {
    state: initial,
    viewAs: 'A',
    legalActions: getLegalActions(initial, 'A'),

    dispatch(action) {
      const { state } = get();
      const result = applyAction(state, state.activePlayer, action);
      const next = result.state;
      set({
        state: next,
        legalActions: getLegalActions(next, next.activePlayer),
      });
    },

    endTurnAndAdvance() {
      let s = get().state;
      s = endTurn(s);
      s = runRefreshPhase(s);
      s = runDrawPhase(s);
      s = runDonPhase(s);
      set({ state: s, legalActions: getLegalActions(s, s.activePlayer), viewAs: s.activePlayer });
    },

    reset(seed) {
      const fresh = bootGame(seed ?? (Date.now() & 0xffffffff));
      set({ state: fresh, legalActions: getLegalActions(fresh, fresh.activePlayer), viewAs: 'A' });
    },

    setViewAs(p) {
      set({ viewAs: p, legalActions: getLegalActions(get().state, p) });
    },
  };
});
