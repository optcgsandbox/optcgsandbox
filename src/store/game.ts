// Game store — Zustand slice wrapping the engine.
// Source of truth = a single GameState. Actions dispatch through engine.applyAction.

import { create } from 'zustand';
import { applyAction } from '@shared/engine/applyAction';
import { EasyAi } from '@shared/engine/ai/EasyAi';
import { MediumAi } from '@shared/engine/ai/MediumAi';
import type { AiDriver } from '@shared/engine/ai/AiDriver';
import { initialState } from '@shared/engine/GameState';
import { setupGame } from '@shared/engine/phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '@shared/engine/phases/turn';
import { getLegalActions } from '@shared/engine/rules/legality';
import type { Action } from '@shared/protocol/actions';
import type { Card, CharacterCard, LeaderCard } from '@shared/engine/cards/Card';
import type { GameState, PlayerId } from '@shared/engine/GameState';

export type GameMode = 'hot-seat' | 'vs-easy' | 'vs-medium';

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
  /** UI-D3 (design-reference §5 + visual-design-spec §3.5):
   *  Instance ID of the hand or field card the player has "lifted" for
   *  inspection. Null when nothing is lifted. A second tap on a lifted hand
   *  card opens the CardDetailModal; tap-outside clears it. */
  inspectedCardId: string | null;
  /** UI-D3: When true, the CardDetailModal is open for `inspectedCardId`. */
  cardDetailOpen: boolean;
  /** UI-D2 (design-reference §7): Instance ID of the friendly character/leader
   *  selected as the attacker. Tapping a legal opp target dispatches
   *  DECLARE_ATTACK; tapping the same attacker again or an empty playmat
   *  cancels. Cleared whenever phase or activePlayer changes. */
  selectedAttackerId: string | null;
  dispatch: (action: Action) => void;
  reset: (seed?: number) => void;
  setMode: (m: GameMode) => void;
  endTurnAndAdvance: () => Promise<void>;
  setInspectedCardId: (id: string | null) => void;
  setCardDetailOpen: (open: boolean) => void;
  setSelectedAttackerId: (id: string | null) => void;
}

const AI_HUMAN: PlayerId = 'A';
const AI_OPPONENT: PlayerId = 'B';

async function runAiTurn(
  get: () => GameStore,
  set: (partial: Partial<GameStore>) => void,
): Promise<void> {
  const mode = get().mode;
  const ai: AiDriver = mode === 'vs-medium'
    ? new MediumAi()
    : new EasyAi((Date.now() & 0xffff) ^ get().state.turn);
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
    inspectedCardId: null,
    cardDetailOpen: false,
    selectedAttackerId: null,

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

      // UI-D2/D3: any phase or active-player change clears transient UI state.
      const phaseOrPlayerChanged =
        next.phase !== state.phase || next.activePlayer !== state.activePlayer;
      set({
        state: next,
        legalActions: getLegalActions(next, next.activePlayer),
        ...(phaseOrPlayerChanged
          ? { inspectedCardId: null, cardDetailOpen: false, selectedAttackerId: null }
          : {}),
      });
    },

    setInspectedCardId(id) {
      // Switching to a new card or clearing also closes any open detail modal.
      set({
        inspectedCardId: id,
        cardDetailOpen: id === null ? false : get().cardDetailOpen,
      });
    },

    setCardDetailOpen(open) {
      set({ cardDetailOpen: open });
    },

    setSelectedAttackerId(id) {
      set({ selectedAttackerId: id });
    },

    async endTurnAndAdvance() {
      let s = get().state;
      s = endTurn(s);
      s = runRefreshPhase(s);
      s = runDrawPhase(s);
      s = runDonPhase(s);
      const newViewAs = get().mode === 'hot-seat' ? s.activePlayer : AI_HUMAN;
      // UI-D2/D3: turn boundary clears transient UI state.
      set({
        state: s,
        legalActions: getLegalActions(s, s.activePlayer),
        viewAs: newViewAs,
        inspectedCardId: null,
        cardDetailOpen: false,
        selectedAttackerId: null,
      });

      const m = get().mode;
      if ((m === 'vs-easy' || m === 'vs-medium') && s.activePlayer === AI_OPPONENT && !s.result) {
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
        inspectedCardId: null,
        cardDetailOpen: false,
        selectedAttackerId: null,
      });
    },

    setMode(m) {
      set({ mode: m });
    },
  };
});
