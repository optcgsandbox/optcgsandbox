// Game store — Zustand slice wrapping the engine.
// Source of truth = a single GameState. Actions dispatch through engine.applyAction.

import { create } from 'zustand';
import { applyAction } from '@shared/engine/applyAction';
import { EasyAi } from '@shared/engine/ai/EasyAi';
import { initialState } from '@shared/engine/GameState';
import { setupGame } from '@shared/engine/phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '@shared/engine/phases/turn';
import { getLegalActions } from '@shared/engine/rules/legality';
import type { Action } from '@shared/protocol/actions';
import type { Card, CharacterCard, LeaderCard } from '@shared/engine/cards/Card';
import type { GameState, PlayerId } from '@shared/engine/GameState';

export type GameMode = 'hot-seat' | 'vs-easy';

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
  mode: GameMode;
  /** Whose seat we render. In hot-seat = activePlayer; in vs-AI = always 'A'. */
  viewAs: PlayerId;
  legalActions: Action[];
  aiThinking: boolean;
  dispatch: (action: Action) => void;
  reset: (seed?: number) => void;
  setMode: (m: GameMode) => void;
  endTurnAndAdvance: () => Promise<void>;
}

const AI_HUMAN: PlayerId = 'A';
const AI_OPPONENT: PlayerId = 'B';

async function runAiTurn(
  get: () => GameStore,
  set: (partial: Partial<GameStore>) => void,
): Promise<void> {
  const ai = new EasyAi((Date.now() & 0xffff) ^ get().state.turn);
  set({ aiThinking: true });
  // Loop until AI hits END_TURN or game ends.
  // Cap iterations to avoid runaway in case of a bug.
  let safety = 0;
  while (safety++ < 200) {
    const s = get().state;
    if (s.result || s.activePlayer !== AI_OPPONENT) break;
    const action = await ai.chooseAction(s, AI_OPPONENT, 100);
    const { state: next } = applyAction(s, AI_OPPONENT, action);
    set({ state: next, legalActions: getLegalActions(next, next.activePlayer) });
    if (action.type === 'END_TURN' || action.type === 'RESIGN') break;
    // Yield to the event loop so the UI can render mid-turn.
    await new Promise((r) => setTimeout(r, 250));
  }
  // After AI ends turn, advance phases back to human's main.
  if (!get().state.result && get().state.activePlayer === AI_OPPONENT) {
    // AI hit safety cap — force end turn.
    let s = endTurn(get().state);
    s = runDonPhase(runDrawPhase(runRefreshPhase(s)));
    set({ state: s, legalActions: getLegalActions(s, s.activePlayer) });
  } else if (!get().state.result) {
    // AI ended turn; we already called endTurn implicitly inside dispatch. Run human's R/D/D.
    let s = runDonPhase(runDrawPhase(runRefreshPhase(get().state)));
    set({ state: s, legalActions: getLegalActions(s, s.activePlayer) });
  }
  set({ aiThinking: false });
}

export const useGameStore = create<GameStore>((set, get) => {
  const initial = bootGame(Date.now() & 0xffffffff);
  return {
    state: initial,
    mode: 'vs-easy',
    viewAs: 'A',
    legalActions: getLegalActions(initial, 'A'),
    aiThinking: false,

    dispatch(action) {
      const { state } = get();
      // Reactive-window actions come from the *inactive* player. Route accordingly.
      const player = (state.phase === 'block_window' || state.phase === 'counter_window')
        ? (state.activePlayer === 'A' ? 'B' : 'A')
        : state.activePlayer;
      const result = applyAction(state, player, action);
      let next = result.state;

      // Auto-skip windows for the human if no meaningful response.
      // (v0: humans can opt in to block/counter via dedicated buttons in v0.1 UI; for now,
      // we auto-resolve when the inactive player has no blocker / counter cards.)
      while (next.phase === 'block_window' || next.phase === 'counter_window') {
        const reactivePlayer = next.activePlayer === 'A' ? 'B' : 'A';
        const opts = getLegalActions(next, reactivePlayer).filter(
          (a) => a.type !== 'RESIGN' && a.type !== 'SKIP_BLOCKER' && a.type !== 'SKIP_COUNTER'
        );
        if (opts.length > 0) break;
        const skip: Action = next.phase === 'block_window' ? { type: 'SKIP_BLOCKER' } : { type: 'SKIP_COUNTER' };
        next = applyAction(next, reactivePlayer, skip).state;
      }

      set({
        state: next,
        legalActions: getLegalActions(next, next.activePlayer),
      });
    },

    async endTurnAndAdvance() {
      let s = get().state;
      s = endTurn(s);
      s = runRefreshPhase(s);
      s = runDrawPhase(s);
      s = runDonPhase(s);
      const newViewAs = get().mode === 'hot-seat' ? s.activePlayer : AI_HUMAN;
      set({ state: s, legalActions: getLegalActions(s, s.activePlayer), viewAs: newViewAs });

      if (get().mode === 'vs-easy' && s.activePlayer === AI_OPPONENT && !s.result) {
        await runAiTurn(get, set);
      }
    },

    reset(seed) {
      const fresh = bootGame(seed ?? (Date.now() & 0xffffffff));
      set({
        state: fresh,
        legalActions: getLegalActions(fresh, fresh.activePlayer),
        viewAs: 'A',
        aiThinking: false,
      });
    },

    setMode(m) {
      set({ mode: m });
    },
  };
});
