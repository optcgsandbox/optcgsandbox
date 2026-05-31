// Game store — Zustand slice wrapping the engine.
// Source of truth = a single GameState. Actions dispatch through engine.applyAction.

import { create } from 'zustand';
import { applyAction } from '@shared/engine/applyAction';
import { EasyAi } from '@shared/engine/ai/EasyAi';
import { MediumAi } from '@shared/engine/ai/MediumAi';
import { HardAi } from '@shared/engine/ai/HardAi';
import type { AiDriver } from '@shared/engine/ai/AiDriver';
import { initialState } from '@shared/engine/GameState';
import { setupGame } from '@shared/engine/phases/setup';
import { endTurn, runDonPhase, runDrawPhase, runRefreshPhase } from '@shared/engine/phases/turn';
import { getLegalActions } from '@shared/engine/rules/legality';
import type { Action } from '@shared/protocol/actions';
import type { Card, LeaderCard } from '@shared/engine/cards/Card';
import type { GameState, PlayerId } from '@shared/engine/GameState';
import cardsDataRaw from '@shared/data/cards.json';

/** Imported OPTCG corpus from Crew Builder (synced via
 *  scripts/sync-from-crewbuilder.mjs). 2489 cards across leader/character/
 *  event/stage. Used to build per-color decks for the demo. */
const ALL_CARDS = cardsDataRaw as unknown as Card[];

export type GameMode = 'vs-easy' | 'vs-medium' | 'vs-hard';

type DeckColor = 'red' | 'green' | 'blue' | 'purple' | 'black' | 'yellow';

/** Pick the first single-color leader matching `color` from the corpus.
 *  Falls back to throwing if none exists (would mean the import broke). */
function pickLeader(color: DeckColor): LeaderCard {
  const match = ALL_CARDS.find(
    (c) => c.kind === 'leader' && c.colors.length === 1 && c.colors[0] === color,
  );
  if (!match) throw new Error(`No single-color ${color} leader in corpus`);
  return match as LeaderCard;
}

/** Build a 50-card deck from the corpus filtered to cards sharing the
 *  leader's color. Per OPTCG rules a card is legal in a deck if any of its
 *  colors matches the leader's color set (CR §5-1). For V0 we take the first
 *  50 unique non-leader cards that include `color` — engine shuffles on
 *  setup. Mixes characters, events, and stages so the demo exercises every
 *  zone. */
function buildDeck(color: DeckColor): Card[] {
  const pool = ALL_CARDS.filter(
    (c) => c.kind !== 'leader' && c.colors.includes(color),
  );
  return pool.slice(0, 50);
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
      A: { leader: pickLeader('red'), cards: buildDeck('red') },
      B: { leader: pickLeader('blue'), cards: buildDeck('blue') },
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
const TURN_HANDOFF_DELAY_MS = 800;
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
/** Whether the upcoming REFRESH phase has anything visible to do. If none of
 *  these are true the un-rest action is a no-op; we skip the action-hold so
 *  the pill still ticks through (250ms PILL_BEAT_MS) but we don't wait an
 *  extra ~1s for imaginary cards. Owner direction 2026-05-30. */
function hasRefreshWork(state: GameState): boolean {
  const p = state.players[state.activePlayer];
  if (p.leader.rested) return true;
  if (p.leader.attachedDon.length > 0) return true;
  if (p.donRested.length > 0) return true;
  if (p.stage && (p.stage.rested || p.stage.attachedDon.length > 0)) return true;
  for (const inst of p.field) {
    if (inst.rested) return true;
    if (inst.summoningSick) return true;
    if (inst.attachedDon.length > 0) return true;
  }
  return false;
}

async function runPhasePipelineWithDelays(
  get: () => GameStore,
  set: (partial: Partial<GameStore>) => void,
): Promise<void> {
  if (get().state.phase !== 'refresh') return;

  // Sequential pacing (owner direction 2026-05-30): pill flashes for
  // PILL_BEAT_MS BEFORE the phase's action runs. After the action commits, we
  // hold BETWEEN_PHASE_DELAY_MS + POST_ACTION_PAUSE_MS — but ONLY if the
  // phase actually did visible work. Empty phases skip the action-hold so the
  // sequence stays REFRESH-pill → DRAW-pill → DON-pill at PILL_BEAT_MS cadence
  // with action waits inserted only where motion exists.

  // === REFRESH ===
  await wait(PILL_BEAT_MS);
  const refreshDidWork = hasRefreshWork(get().state);
  let s = runRefreshPhase(get().state);
  const last = s.history.length - 1;
  if (last >= 0 && s.history[last].type === 'PHASE_CHANGED') {
    s.history.splice(last, 0, { type: 'PHASE_CHANGED', phase: 'refresh' });
  } else {
    s.history.push({ type: 'PHASE_CHANGED', phase: 'refresh' });
  }
  s = { ...s, phase: 'refresh' };
  set({ state: s, legalActions: getLegalActions(s, s.activePlayer) });
  if (refreshDidWork) {
    await wait(BETWEEN_PHASE_DELAY_MS);
    await wait(POST_ACTION_PAUSE_MS);
  }

  // === DRAW ===
  set({ state: { ...get().state, phase: 'draw' } });
  await wait(PILL_BEAT_MS);
  const handBefore = get().state.players[get().state.activePlayer].hand.length;
  s = runDrawPhase(get().state);
  s = { ...s, phase: 'draw' };
  set({ state: s, legalActions: getLegalActions(s, s.activePlayer) });
  const drawDidWork = s.players[s.activePlayer].hand.length > handBefore;
  if (drawDidWork) {
    await wait(BETWEEN_PHASE_DELAY_MS);
    await wait(POST_ACTION_PAUSE_MS);
  }

  // === DON ===
  set({ state: { ...get().state, phase: 'don' } });
  await wait(PILL_BEAT_MS);
  const costBefore = get().state.players[get().state.activePlayer].donCostArea.length;
  s = runDonPhase(get().state);
  s = { ...s, phase: 'don' };
  set({ state: s, legalActions: getLegalActions(s, s.activePlayer) });
  const donDidWork = s.players[s.activePlayer].donCostArea.length > costBefore;
  if (donDidWork) {
    await wait(BETWEEN_PHASE_DELAY_MS);
    await wait(POST_ACTION_PAUSE_MS);
  }

  // === MAIN ===
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
  /** Whose seat we render. Always 'A' in V0 (single-player vs AI). Retained
   *  as a field because UI components key off it; future online MP will swap
   *  it per session. */
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
  const ai: AiDriver = mode === 'vs-hard'
    ? new HardAi()
    : mode === 'vs-medium'
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
      if (aiDeciderInFirst || aiDeciderInSecond) {
        const aiResult = applyAction(next, AI_OPPONENT, { type: 'KEEP_HAND' });
        next = aiResult.state;
      }
      void aiMode;

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
            post.phase === 'main' &&
            post.activePlayer === AI_OPPONENT &&
            !post.result
          ) {
            await runAiTurn(get, set);
          }
        })();
        return;
      }

      // V0: single-player vs AI. viewAs stays 'A' throughout. The mulligan
      // window and dice-roll flips that previously hand off the seat in
      // hot-seat are no-ops here — the AI handles its own decisions via the
      // auto-fire branches above.

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

    setViewingTrashOf(id) {
      set({ viewingTrashOf: id });
    },

    async endTurnAndAdvance() {
      // End the active player's turn — engine flips activePlayer + sets
      // phase='refresh' for the new active player. Commit that state THEN
      // pace through R/D/D so each step is visible.
      const ended = endTurn(get().state);
      set({
        state: ended,
        legalActions: getLegalActions(ended, ended.activePlayer),
        viewAs: AI_HUMAN,
        inspectedCardId: null,
        cardDetailOpen: false,
        selectedAttackerId: null,
      });
      await wait(TURN_HANDOFF_DELAY_MS);
      await runPhasePipelineWithDelays(get, set);

      const post = get().state;
      if (post.activePlayer === AI_OPPONENT && !post.result) {
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
