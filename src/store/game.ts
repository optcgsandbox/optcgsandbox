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
import type { Card, CharacterCard, EventCard, LeaderCard, StageCard } from '@shared/engine/cards/Card';
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
function makeEvent(id: string, cost: number, color: 'red' | 'blue' = 'red'): EventCard {
  return {
    id, name: id, kind: 'event', colors: [color], cost, power: null,
    counterValue: null, counterEventBoost: null,
    traits: [], keywords: [], effectTags: ['vanilla'],
    effectText: 'No effect yet — placeholder event.',
  };
}
function makeStage(id: string, cost: number, color: 'red' | 'blue' = 'red'): StageCard {
  return {
    id, name: id, kind: 'stage', colors: [color], cost, power: null,
    counterValue: null, traits: [], keywords: [], effectTags: ['vanilla'],
    effectText: 'No effect yet — placeholder stage.',
  };
}

/** Quick test deck: 50 cards mixing all kinds so the modal + zones can be
 *  visually exercised. ~35 characters + ~10 events + ~5 stages. */
function quickDeck(color: 'red' | 'blue'): Card[] {
  const deck: Card[] = [];
  // Characters — 4× each at cost 1-8 + filler to ~35 total.
  for (let cost = 1; cost <= 8; cost++) {
    for (let copy = 0; copy < 4; copy++) {
      deck.push(makeChar(`${color}-c-${cost}-${copy}`, cost, cost * 1000 + 1000, color));
    }
  }
  while (deck.length < 35) {
    deck.push(makeChar(`${color}-c-x-${deck.length}`, 4, 5000, color));
  }
  // Events — 2× each at cost 1-5 = 10.
  for (let cost = 1; cost <= 5; cost++) {
    for (let copy = 0; copy < 2; copy++) {
      deck.push(makeEvent(`${color}-e-${cost}-${copy}`, cost, color));
    }
  }
  // Stages — 1× each at cost 1-5 = 5.
  for (let cost = 1; cost <= 5; cost++) {
    deck.push(makeStage(`${color}-s-${cost}`, cost, color));
  }
  return deck.slice(0, 50);
}

/** D24 (CR §5-2-1-4) + D10 (CR §5-2-1-6): `setupGame` leaves the engine in
 *  the dice-roll window with life cards undealt. The store stops here so the
 *  UI can prompt the active player. Once both players resolve dice-roll,
 *  first-player choice, and mulligan via their respective prompts, the
 *  dispatch path calls `runFirstTurnPhases` to deal life and run the first
 *  player's refresh → draw → don. */
function bootGame(seed: number): GameState {
  let s = initialState({
    seed,
    decks: {
      A: { leader: makeLeader('LA', 'red'), cards: quickDeck('red') },
      B: { leader: makeLeader('LB', 'blue'), cards: quickDeck('blue') },
    },
  });
  s = setupGame(s);
  // Phase is now 'dice_roll'. Do NOT run refresh/draw/don yet.
  return s;
}

/** Pacing constants for AI / phase transitions.
 *
 *  Owner direction 2026-05-29 (round 2): banner removed; pacing slowed so each
 *  move + phase change is plainly watchable. AI ticks hold ~2.5s between
 *  decisions, R/D/DON steps breathe at 1.5s, and the AI→human handoff pauses
 *  for 2s. OPP_VISIBLE_HOLD_MS is an additional hold AFTER each AI action
 *  commits to the store, so the field-state change has time to render before
 *  the next tick fires. Without the banner the move animation + zone state
 *  ARE the readability surface — they need room to land.
 */
const AI_ACTION_DELAY_MS = 2500;
const BETWEEN_PHASE_DELAY_MS = 900;
const TURN_HANDOFF_DELAY_MS = 2000;
const OPP_VISIBLE_HOLD_MS = 800;
// Owner direction 2026-05-30: pill→action→pill→action, tight. Pill alone for
// PILL_BEAT_MS so it's perceivable, then action runs for
// BETWEEN_PHASE_DELAY_MS (~animation length), then brief pause before next
// pill. Previously 600/1500/500 = 2600ms per phase = too slow.
const PILL_BEAT_MS = 250;
const POST_ACTION_PAUSE_MS = 150;

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Run the active player's refresh → draw → don pipeline with visible pacing.
 *  Each phase commits to the store before the next, and a delay between them
 *  gives the UI time to render the state change. Used by both
 *  `runFirstTurnPhases` (post-mulligan kickoff for whichever player goes
 *  first) and `runAiTurn` (handoff back to the human at the end of AI's turn).
 *  No-op if the current phase isn't 'refresh'.
 *
 *  The engine emits PHASE_CHANGED→draw at the end of runRefreshPhase but
 *  never emits PHASE_CHANGED→refresh (phase is set directly by endTurn /
 *  mulligan close). We splice a synthetic refresh marker into history right
 *  before the draw marker so any history-driven UI reads R → D → DON in
 *  order. (The OpponentActionBanner that previously consumed this was
 *  removed 2026-05-29 per owner direction — slow visible moves beat banner
 *  pills.) */
async function runPhasePipelineWithDelays(
  get: () => GameStore,
  set: (partial: Partial<GameStore>) => void,
): Promise<void> {
  if (get().state.phase !== 'refresh') return;

  // Sequential pacing (owner direction 2026-05-30): each phase shows its pill
  // FIRST for PILL_BEAT_MS, then runs its action while the pill is still
  // highlighted (BETWEEN_PHASE_DELAY_MS), then pauses before advancing the
  // pill. The engine's phase-functions auto-advance state.phase to the NEXT
  // phase as a side-effect; we override that back to the CURRENT phase so the
  // pill stays aligned with the visible action, then explicitly transition
  // between actions.

  // === REFRESH ===
  // Entry: state.phase === 'refresh' already (set by endTurn / mulligan close).
  // Pill highlights REFRESH alone for a beat before any motion.
  await wait(PILL_BEAT_MS);
  // Run engine refresh; it sets phase='draw'. Override back to 'refresh' so
  // the pill stays on REFRESH while the un-rest animation plays out. Splice a
  // synthetic refresh marker into history for any history-driven UI.
  let s = runRefreshPhase(get().state);
  const last = s.history.length - 1;
  if (last >= 0 && s.history[last].type === 'PHASE_CHANGED') {
    s.history.splice(last, 0, { type: 'PHASE_CHANGED', phase: 'refresh' });
  } else {
    s.history.push({ type: 'PHASE_CHANGED', phase: 'refresh' });
  }
  s = { ...s, phase: 'refresh' };
  set({ state: s, legalActions: getLegalActions(s, s.activePlayer) });
  await wait(BETWEEN_PHASE_DELAY_MS);
  await wait(POST_ACTION_PAUSE_MS);

  // === DRAW ===
  // Advance pill to DRAW alone first.
  set({ state: { ...get().state, phase: 'draw' } });
  await wait(PILL_BEAT_MS);
  // Run engine draw; engine sets phase='don'. Override back to 'draw'.
  s = runDrawPhase(get().state);
  s = { ...s, phase: 'draw' };
  set({ state: s, legalActions: getLegalActions(s, s.activePlayer) });
  await wait(BETWEEN_PHASE_DELAY_MS);
  await wait(POST_ACTION_PAUSE_MS);

  // === DON ===
  set({ state: { ...get().state, phase: 'don' } });
  await wait(PILL_BEAT_MS);
  s = runDonPhase(get().state);
  s = { ...s, phase: 'don' };
  set({ state: s, legalActions: getLegalActions(s, s.activePlayer) });
  await wait(BETWEEN_PHASE_DELAY_MS);
  await wait(POST_ACTION_PAUSE_MS);

  // === MAIN ===
  // Final transition — legalActions recomputed under 'main' so the player can act.
  const mainState: GameState = { ...get().state, phase: 'main' };
  set({ state: mainState, legalActions: getLegalActions(mainState, mainState.activePlayer) });
}

/** Run the first player's first turn pipeline (refresh → draw → don) after
 *  the engine transitions out of the mulligan window into 'refresh'. Async +
 *  paced so the player can SEE each phase (D24 bug: when AI was first, the
 *  sync pipeline ran R/D/D in one tick and the human saw nothing). Updates
 *  the store directly via the paced helper. */
async function runFirstTurnPhases(
  get: () => GameStore,
  set: (partial: Partial<GameStore>) => void,
): Promise<void> {
  if (get().state.phase !== 'refresh') return;
  await runPhasePipelineWithDelays(get, set);
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
  /** TrashViewer (rules-reference.md §4.4 / CR §3-5): which player's trash
   *  the player is currently inspecting via TrashSlot tap. Null when the
   *  viewer is closed. Both players' trashes are open per CR §3-1-5, so
   *  any seat may inspect either side. */
  viewingTrashOf: PlayerId | null;
  dispatch: (action: Action) => void;
  reset: (seed?: number) => void;
  setMode: (m: GameMode) => void;
  endTurnAndAdvance: () => Promise<void>;
  setInspectedCardId: (id: string | null) => void;
  setCardDetailOpen: (open: boolean) => void;
  setSelectedAttackerId: (id: string | null) => void;
  setViewingTrashOf: (id: PlayerId | null) => void;
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
    // Two-stage pacing: hold AFTER the action commits so the player sees the
    // field state change (OPP_VISIBLE_HOLD_MS), THEN wait the longer think
    // delay before the next AI tick (AI_ACTION_DELAY_MS - OPP_VISIBLE_HOLD_MS).
    // Net delay matches AI_ACTION_DELAY_MS; splitting it just guarantees the
    // commit is visible before any "thinking" silence.
    await wait(OPP_VISIBLE_HOLD_MS);
    await wait(Math.max(0, AI_ACTION_DELAY_MS - OPP_VISIBLE_HOLD_MS));
  }
  // After AI ends turn, advance phases back to human's main.
  if (!get().state.result && get().state.activePlayer === AI_OPPONENT) {
    // AI hit safety cap — force end turn, then pace the human's R/D/D so each
    // step is visible (matches the post-END_TURN branch below).
    const ended = endTurn(get().state);
    set({ state: ended, legalActions: getLegalActions(ended, ended.activePlayer) });
    await wait(TURN_HANDOFF_DELAY_MS);
    await runPhasePipelineWithDelays(get, set);
  } else if (!get().state.result) {
    // AI ended turn; endTurn already set phase=refresh + flipped activePlayer
    // to the human. Pause for the handoff, then run the human's R/D/D paced
    // so the player sees each step instead of a blink to main.
    await wait(TURN_HANDOFF_DELAY_MS);
    await runPhasePipelineWithDelays(get, set);
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
    viewingTrashOf: null,

    dispatch(action) {
      const { state } = get();
      // Reactive-window actions come from the *inactive* player. Route accordingly.
      //   - block_window / counter_window: opponent of activePlayer reacts.
      //   - mulligan_second: opponent of activePlayer decides (D10, CR §5-2-1-6).
      // Mulligan_first / dice_roll / first_player_choice use activePlayer.
      //   D24 (per-player ROLL_DICE 2026-05-29): ROLL_DICE carries its own
      //   `player` field — applyAction routes by the action's player, not by
      //   the dispatch's player. We still pass activePlayer here as the
      //   nominal sender for parity with other phases; the engine reads
      //   action.player for the actual slot assignment.
      const isInactivePlayerPhase =
        state.phase === 'block_window' ||
        state.phase === 'counter_window' ||
        state.phase === 'mulligan_second';
      const player = isInactivePlayerPhase
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

      // D10: AI auto-mulligan. When the AI is player B (vs-easy / vs-medium)
      // and the engine is awaiting the AI's decision, auto-KEEP for the AI
      // so the human isn't stuck waiting. Per the task spec, both Easy and
      // Medium AI just KEEP_HAND.
      //
      // D24 (2026-05-29) update: post-dice-roll the AI may be the FIRST
      // player (if it won the roll and chose to go first, or the human won
      // and chose to go second). When that happens the AI is the decider in
      // `mulligan_first`, NOT mulligan_second — extend the auto-fire to
      // either window depending on who needs to decide next.
      const aiMode = get().mode;
      const aiDeciderInFirst =
        next.phase === 'mulligan_first' && next.activePlayer === AI_OPPONENT;
      const aiDeciderInSecond =
        next.phase === 'mulligan_second' && next.activePlayer === AI_HUMAN;
      if ((aiMode === 'vs-easy' || aiMode === 'vs-medium') && (aiDeciderInFirst || aiDeciderInSecond)) {
        const aiResult = applyAction(next, AI_OPPONENT, { type: 'KEEP_HAND' });
        next = aiResult.state;
      }

      // D10 / D24: if either the human's mulligan close OR the AI's
      // auto-KEEP just transitioned the engine into 'refresh', commit the
      // pre-pipeline state THEN run the paced first-turn pipeline. Was a
      // synchronous chain pre-2026-05-29 (R/D/D in one tick) — caused the
      // AI-first turn to flash by invisibly. Async + paced now so each
      // phase is visible. After the pipeline, the AI-first path needs to
      // kick into runAiTurn.
      const needsFirstTurnPipeline =
        next.phase === 'refresh' && state.phase !== 'refresh';
      if (needsFirstTurnPipeline) {
        set({
          state: next,
          legalActions: getLegalActions(next, next.activePlayer),
          inspectedCardId: null,
          cardDetailOpen: false,
          selectedAttackerId: null,
        });
        void (async () => {
          await runFirstTurnPhases(get, set);
          // D24: if first-turn phases just put the AI on its main phase
          // (because the AI is the first player after dice-roll), kick
          // off the AI turn loop so it plays + ends turn back to the
          // human. Re-read store state since the pipeline mutated it.
          const post = get().state;
          if (
            (aiMode === 'vs-easy' || aiMode === 'vs-medium') &&
            post.phase === 'main' &&
            post.activePlayer === AI_OPPONENT &&
            !post.result
          ) {
            await runAiTurn(get, set);
          }
        })();
        return;
      }

      // D10 (hot-seat): when the mulligan window advances to mulligan_second,
      // hand the viewer over to player B so the prompt renders for the
      // correct human. activePlayer stays the FIRST player throughout the
      // window (per CR §5-2-1-6 "first player decides first"), so we use
      // phase + mode as the trigger rather than activePlayer change.
      const isHotSeat = get().mode === 'hot-seat';
      const viewAsMulliganSecond =
        isHotSeat && state.phase === 'mulligan_first' && next.phase === 'mulligan_second'
          ? (next.activePlayer === 'A' ? 'B' as PlayerId : 'A' as PlayerId)
          : null;
      // D24 (hot-seat): when ROLL_DICE produces a winner, hand the viewer
      // over to the winner so they see the FirstPlayerChoicePrompt with the
      // Go-First / Go-Second buttons. Both players had access to ROLL_DICE
      // so the prior viewAs may be either; this flip normalizes.
      const viewAsFirstChoice =
        isHotSeat && state.phase === 'dice_roll' && next.phase === 'first_player_choice'
          ? next.activePlayer
          : null;
      // D24 (hot-seat): once first-player choice closes into the mulligan
      // window, the FIRST player (next.activePlayer) is the decider. Snap
      // viewAs to them so MulliganPrompt renders on the right seat.
      const viewAsMulliganFirst =
        isHotSeat && state.phase === 'first_player_choice' && next.phase === 'mulligan_first'
          ? next.activePlayer
          : null;
      // When mulligan finishes in hot-seat, hand the seat back to the active
      // player (whoever ended up going first).
      const viewAsAfterMulligan =
        isHotSeat && next.phase === 'don' && state.phase !== 'don'
          ? next.activePlayer
          : null;

      // UI-D2/D3: any phase or active-player change clears transient UI state.
      const phaseOrPlayerChanged =
        next.phase !== state.phase || next.activePlayer !== state.activePlayer;
      // viewAs override priority (later wins): mulligan_second flip, dice→
      // choice flip, choice→mulligan_first flip, mulligan→post flip.
      const viewAsOverride =
        viewAsAfterMulligan ?? viewAsMulliganFirst ?? viewAsFirstChoice ?? viewAsMulliganSecond ?? null;
      set({
        state: next,
        legalActions: getLegalActions(next, next.activePlayer),
        ...(viewAsOverride ? { viewAs: viewAsOverride } : {}),
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

    setViewingTrashOf(id) {
      set({ viewingTrashOf: id });
    },

    async endTurnAndAdvance() {
      // End the active player's turn — engine flips activePlayer + sets
      // phase='refresh' for the new active player. Commit that state THEN
      // pace through R/D/D so the banner can label each step. Pre-2026-05-29
      // this ran R/D/D in one tick which felt like a blink.
      const ended = endTurn(get().state);
      const newViewAs = get().mode === 'hot-seat' ? ended.activePlayer : AI_HUMAN;
      set({
        state: ended,
        legalActions: getLegalActions(ended, ended.activePlayer),
        viewAs: newViewAs,
        inspectedCardId: null,
        cardDetailOpen: false,
        selectedAttackerId: null,
      });
      await wait(TURN_HANDOFF_DELAY_MS);
      await runPhasePipelineWithDelays(get, set);

      const m = get().mode;
      const post = get().state;
      if ((m === 'vs-easy' || m === 'vs-medium') && post.activePlayer === AI_OPPONENT && !post.result) {
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
        viewingTrashOf: null,
      });
    },

    setMode(m) {
      set({ mode: m });
    },
  };
});
