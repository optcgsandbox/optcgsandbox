// Game store — Zustand slice wrapping the engine.
// Source of truth = a single GameState. Actions dispatch through engine.applyAction.

import { create } from 'zustand';
import { applyAction } from '@shared/engine-v2/reducers/applyAction';
import { EasyAi } from '@shared/engine-v2/ai/EasyAi';
import { MediumAi } from '@shared/engine-v2/ai/MediumAi';
import { HardAi } from '@shared/engine-v2/ai/HardAi';
import type { AiDriver } from '@shared/engine-v2/ai/AiDriver';
import { initialState } from '@shared/engine-v2/setup/initialState';
import { setupGame } from '@shared/engine-v2/setup/setupGame';
import { PhaseScheduler } from '@shared/engine-v2/phases/PhaseScheduler';
import { getLegalActions } from '@shared/engine-v2/rules/legality';
import { registerAllHandlers } from '@shared/engine-v2/registry/handlers/index';
import { registerAllReducers } from '@shared/engine-v2/reducers/index';
import type { Action } from '@shared/engine-v2/protocol/actions';
import type { Card, LeaderCard } from '@shared/engine-v2/cards/Card';
import type { GameState, PlayerId } from '@shared/engine-v2/state/types';
import cardsDataRaw from '@shared/data/cards.json';

// One-time engine boot.
let _engineBooted = false;
function bootEngineIfNeeded(): void {
  if (_engineBooted) return;
  registerAllReducers();
  registerAllHandlers();
  _engineBooted = true;
}

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

/** Pick a specific leader by id. Used to override the default `pickLeader`
 *  when we want a known-clean leader for the demo (e.g., one whose effect
 *  doesn't add DON / draw / search at game start or via triggers we haven't
 *  finished wiring). */
function pickLeaderById(id: string): LeaderCard {
  const match = ALL_CARDS.find((c) => c.id === id && c.kind === 'leader');
  if (!match) throw new Error(`Leader ${id} not in corpus`);
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
  // Driver-only coverage injection. Production behavior is unchanged when
  // the localStorage key is absent (the only condition that exists in normal
  // user sessions). The automated play-driver may set
  //   localStorage.setItem('PLAY_DRIVER_PREFER', JSON.stringify(cardIds))
  // before page.goto to bias deck construction toward untested cards. The
  // injection still produces 50 legal cards in the leader's color (filtered
  // by `pool.filter` above) — only the priority order changes.
  let prefer: string[] = [];
  try {
    const raw =
      typeof window !== 'undefined'
        ? window.localStorage.getItem('PLAY_DRIVER_PREFER')
        : null;
    if (raw !== null) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) prefer = parsed.filter((s): s is string => typeof s === 'string');
    }
  } catch {
    // localStorage parse failure → fall back to production behavior.
  }
  if (prefer.length === 0) return pool.slice(0, 50);
  const preferSet = new Set(prefer);
  const preferred = pool.filter((c) => preferSet.has(c.id));
  const rest = pool.filter((c) => !preferSet.has(c.id));
  return [...preferred, ...rest].slice(0, 50);
}

/** D24 (CR §5-2-1-4) + D10 (CR §5-2-1-6): `setupGame` leaves the engine in
 *  the dice-roll window with life cards undealt. The store stops here so the
 *  UI can prompt the active player. Once both players resolve dice-roll,
 *  first-player choice, and mulligan via their respective prompts, the
 *  dispatch path calls `runFirstTurnPhases` to deal life and run the first
 *  player's refresh → draw → don. */
function bootGame(seed: number): GameState {
  bootEngineIfNeeded();
  // Driver-only leader injection. Mirrors PLAY_DRIVER_PREFER. Production
  // behavior is unchanged when the localStorage key is absent (the only
  // condition that exists in normal user sessions). The automated
  // play-driver may set
  //   localStorage.setItem('PLAY_DRIVER_LEADER_ID', cardId)
  // before page.goto to rotate the seat-A leader across colors and unlock
  // coverage of cards in other colors.
  let driverLeader: LeaderCard | null = null;
  try {
    const raw =
      typeof window !== 'undefined'
        ? window.localStorage.getItem('PLAY_DRIVER_LEADER_ID')
        : null;
    if (raw !== null && raw.length > 0) {
      const candidate = ALL_CARDS.find(
        (c) => c.id === raw && c.kind === 'leader',
      );
      if (candidate !== undefined) driverLeader = candidate as LeaderCard;
    }
  } catch {
    // Fall back to production behavior on any read failure.
  }
  const leaderA: LeaderCard = driverLeader ?? pickLeader('red');
  // For the deck-color filter, use the leader's FIRST color. For multi-color
  // leaders, buildDeck currently takes a single color so we pick the primary;
  // the resulting deck still satisfies the OPTCG color-share rule because
  // any card matching the primary color is legal under the leader's identity.
  const colorA = (leaderA.colors[0] as DeckColor) ?? 'red';

  let s = initialState({
    seed,
    decks: {
      A: { leader: leaderA, cards: buildDeck(colorA) },
      // 2026-06-01: switch opp from OP01-060 Doflamingo to OP09-042 Buggy.
      // Doflamingo's auto-extracted effectTags include 'searcher'+'ramp',
      // which previously ghost-fired at game start. Even though the V1
      // fallback for at_start_of_game is now empty, picking a leader with
      // no draw/ramp/searcher tags (cost_reduction only) gives a cleaner
      // baseline for the demo while the rest of the engine is shored up.
      B: { leader: pickLeaderById('OP09-042'), cards: buildDeck('blue') },
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
  let s = PhaseScheduler.enterRefresh(get().state);
  const last = s.history.length - 1;
  const hist = s.history as Array<{ type: string; phase?: string }>;
  if (last >= 0 && hist[last]?.type === 'PHASE_CHANGED') {
    hist.splice(last, 0, { type: 'PHASE_CHANGED', phase: 'refresh' });
  } else {
    hist.push({ type: 'PHASE_CHANGED', phase: 'refresh' });
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
  s = PhaseScheduler.enterDraw(get().state);
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
  s = PhaseScheduler.enterDon(get().state);
  s = { ...s, phase: 'don' };
  set({ state: s, legalActions: getLegalActions(s, s.activePlayer) });
  const donDidWork = s.players[s.activePlayer].donCostArea.length > costBefore;
  if (donDidWork) {
    await wait(BETWEEN_PHASE_DELAY_MS);
    await wait(POST_ACTION_PAUSE_MS);
  }

  // === MAIN ===
  // F-7p — emit TURN_STARTED here so the GameFeed reads "Turn N — Your
  // turn / Opponent's turn." The store runs the refresh→draw→don→main
  // pipeline without calling PhaseScheduler.enterMain (the engine's
  // enterMain just refolds continuous; the store has its own pacing),
  // so the event has to be pushed here at the boundary.
  const mainBaseState = get().state;
  const mainHistory = [
    ...mainBaseState.history,
    {
      type: 'TURN_STARTED',
      turn: mainBaseState.turn,
      activePlayer: mainBaseState.activePlayer,
    },
  ];
  const mainState: GameState = { ...mainBaseState, phase: 'main', history: mainHistory };
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
  /** F-7n Phase A/B — true when `runAiTurn` returned early to yield a
   *  reactive window (block/counter/trigger) to the human. Re-entry
   *  guard at the end of dispatch resumes the AI loop ONLY when this
   *  flag is set, so seed-style harness tests that never went through
   *  runAiTurn are not pulled into an AI turn after dispatching an
   *  action while activePlayer === 'B'. Cleared when runAiTurn resumes. */
  aiPaused: boolean;
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
    let { state: next } = applyAction(s, AI_OPPONENT, action);
    // F-7n Phase A — narrowed force-skip of block/counter for the human
    // defender during AI attacks. ONLY auto-skip when the human has no
    // meaningful response (only SKIP_* / CONCEDE available). Otherwise
    // commit the pending state, yield to the UI (AttackResolutionOverlay
    // + CardDetailModal handle this), and EXIT the AI loop. After the
    // human resolves, dispatch's tail re-enters runAiTurn (see end-of-
    // dispatch re-entry guard).
    while (next.phase === 'block_window' || next.phase === 'counter_window') {
      const defender = AI_HUMAN;
      const opts = getLegalActions(next, defender).filter(
        (a) =>
          a.type !== 'CONCEDE' &&
          a.type !== 'SKIP_BLOCKER' &&
          a.type !== 'SKIP_COUNTER',
      );
      if (opts.length > 0) {
        // Human has a real choice. Commit + yield.
        set({
          state: next,
          legalActions: getLegalActions(next, defender),
          aiThinking: false,
          aiPaused: true,
        });
        return;
      }
      const skip: Action = next.phase === 'block_window' ? { type: 'SKIP_BLOCKER' } : { type: 'SKIP_COUNTER' };
      next = applyAction(next, defender, skip).state;
    }
    // F-7n Phase B — yield trigger_window to the human if they control it.
    // Pre-fix this auto-declined every human trigger silently. Now we
    // commit + return so TriggerPrompt can render.
    if (
      next.phase === 'trigger_window' &&
      next.pending !== null &&
      next.pending.kind === 'trigger' &&
      next.pending.pendingTrigger.controller === AI_HUMAN
    ) {
      set({
        state: next,
        legalActions: getLegalActions(next, AI_HUMAN),
        aiThinking: false,
        aiPaused: true,
      });
      return;
    }
    // Auto-resolve any prompt windows for ANY controller during AI turn —
    // discard / peek / choose_one (no UI for these yet). Hand-size-limit at
    // AI's end-turn produces pendingDiscard with controller=AI; card effects
    // may target the human. Either way, no UI to interact, so we resolve.
    let aiSafety = 0;
    while (aiSafety++ < 50 && next.pending !== null) {
      const p = next.pending;
      if (next.phase === 'discard_choice' && p.kind === 'discard') {
        const pid = p.pendingDiscard.controller;
        const hand = next.players[pid].hand;
        const pickedId = hand.length > 0 ? hand[0]! : null;
        next = applyAction(next, pid, { type: 'RESOLVE_DISCARD', pickedId }).state;
        continue;
      }
      if (next.phase === 'peek_choice' && p.kind === 'peek') {
        next = applyAction(next, p.pendingPeek.controller, { type: 'RESOLVE_PEEK', pickedIds: [] }).state;
        continue;
      }
      if (next.phase === 'choose_one' && p.kind === 'choose_one') {
        next = applyAction(next, p.pendingChoose.controller, { type: 'RESOLVE_CHOOSE_ONE', optionIndex: 0 }).state;
        continue;
      }
      if (next.phase === 'trigger_window' && p.kind === 'trigger') {
        next = applyAction(next, p.pendingTrigger.controller, {
          type: 'RESOLVE_TRIGGER', activate: false, targetInstanceId: null,
        }).state;
        continue;
      }
      break;
    }
    set({ state: next, legalActions: getLegalActions(next, next.activePlayer) });
    if (action.type === 'END_TURN' || action.type === 'CONCEDE') break;
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
    let ended = PhaseScheduler.enterEnd(get().state);
    // Force-resolve any pending arising from enterEnd (hand-size discard,
    // continuous effect triggers, etc.) — without this the game stalls
    // when the AI hits its safety cap with > 10 cards in hand.
    let s2 = 0;
    while (s2++ < 50 && ended.pending !== null) {
      const p = ended.pending;
      if (ended.phase === 'discard_choice' && p.kind === 'discard') {
        const pid = p.pendingDiscard.controller;
        const hand = ended.players[pid].hand;
        const pickedId = hand.length > 0 ? hand[0]! : null;
        ended = applyAction(ended, pid, { type: 'RESOLVE_DISCARD', pickedId }).state;
        continue;
      }
      if (ended.phase === 'peek_choice' && p.kind === 'peek') {
        ended = applyAction(ended, p.pendingPeek.controller, { type: 'RESOLVE_PEEK', pickedIds: [] }).state;
        continue;
      }
      if (ended.phase === 'choose_one' && p.kind === 'choose_one') {
        ended = applyAction(ended, p.pendingChoose.controller, { type: 'RESOLVE_CHOOSE_ONE', optionIndex: 0 }).state;
        continue;
      }
      if (ended.phase === 'trigger_window' && p.kind === 'trigger') {
        ended = applyAction(ended, p.pendingTrigger.controller, {
          type: 'RESOLVE_TRIGGER', activate: false, targetInstanceId: null,
        }).state;
        continue;
      }
      break;
    }
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
    aiPaused: false,
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
      // Engine-v2: activePlayer is the decider in mulligan_second (engine
      // flips at mulligan_first→second). Only true reactive windows route
      // to the inactive player.
      const isInactivePlayerPhase =
        state.phase === 'block_window' ||
        state.phase === 'counter_window';
      // trigger_window: the deciding player is pendingTrigger.controller
      // (the defender whose life flipped). activePlayer is still the
      // attacker. Mirrors the AI auto-pump routing at game.ts:575-583
      // which already dispatches via p.pendingTrigger.controller.
      const isTriggerWindow =
        state.phase === 'trigger_window' &&
        state.pending !== null &&
        state.pending.kind === 'trigger';
      const player = isTriggerWindow
        ? (state.pending as { pendingTrigger: { controller: PlayerId } }).pendingTrigger.controller
        : isInactivePlayerPhase
          ? (state.activePlayer === 'A' ? 'B' : 'A')
          : state.activePlayer;
      const result = applyAction(state, player, action);
      let next = result.state;

      // Auto-skip windows for the human if no meaningful response.
      // (v0: humans can opt in to block/counter via dedicated buttons in v0.1 UI; for now,
      // we auto-resolve when the inactive player has no blocker / counter cards.)
      //
      // In vs-AI modes, the reactive player IS the AI (`AI_OPPONENT='B'`) when
      // the active player is the human. There is no AI useEffect that
      // dispatches in block/counter windows; without forcing the skip here,
      // the game stalls with `state.pending.kind='attack'` and the human's
      // subsequent END_TURN no-ops (engine guards `state.pending !== null` at
      // turnFlow.ts:29). Force the skip whenever the reactive player is the
      // AI in vs-AI modes. (Symmetric of the existing mulligan auto-fire.)
      const aiModes: ReadonlyArray<GameMode> = ['vs-easy', 'vs-medium', 'vs-hard'];
      const currentMode = get().mode;
      const isAiGame = aiModes.includes(currentMode);
      while (next.phase === 'block_window' || next.phase === 'counter_window') {
        const reactivePlayer = next.activePlayer === 'A' ? 'B' : 'A';
        const reactiveIsAi = isAiGame && reactivePlayer === AI_OPPONENT;
        const opts = getLegalActions(next, reactivePlayer).filter(
          (a) => a.type !== 'CONCEDE' && a.type !== 'SKIP_BLOCKER' && a.type !== 'SKIP_COUNTER'
        );
        if (!reactiveIsAi && opts.length > 0) break;
        const skip: Action = next.phase === 'block_window' ? { type: 'SKIP_BLOCKER' } : { type: 'SKIP_COUNTER' };
        next = applyAction(next, reactivePlayer, skip).state;
      }
      // After block/counter resolves there may be a trigger_window pending
      // (life-flip with `trigger` clause). The AI doesn't auto-resolve
      // triggers either; force RESOLVE_TRIGGER with activate=false (decline)
      // so the human's flow isn't blocked.
      while (
        next.phase === 'trigger_window' &&
        next.pending !== null &&
        next.pending.kind === 'trigger' &&
        isAiGame &&
        next.pending.pendingTrigger.controller === AI_OPPONENT
      ) {
        next = applyAction(next, AI_OPPONENT, {
          type: 'RESOLVE_TRIGGER',
          activate: false,
          targetInstanceId: null,
        }).state;
      }
      // Auto-resolve discard / peek / choose_one for ANY controller (UI for
      // these doesn't exist yet; without auto-resolve the game stalls).
      // Hand-size-limit at end-of-turn (PhaseScheduler.enterEnd:335-348)
      // creates pendingDiscard with controller = ending player — could be
      // either the human at their end-turn OR the AI at theirs. Same for
      // discard/peek/choose_one arising from card effects on either side.
      // Auto-resolve loop. ONLY auto-resolves when:
      //   - the pending controller is the AI (AI cannot interact with UI), OR
      //   - the pending is a SYSTEM-driven discard (hand-size end-of-turn at
      //     PhaseScheduler.ts:341, sourceInstanceId === 'system').
      // For card-effect-driven pendings whose controller is the HUMAN, we
      // BREAK out of the loop so React renders the corresponding prompt
      // (ChoosePrompt, PeekChoicePrompt, DiscardChoicePrompt, TriggerPrompt).
      // Prior behavior auto-resolved every controller, which silently cleared
      // human-side prompts before they could mount — caused 35+ harness
      // failures in `[data-pending-kind=...]` selector waits.
      let safety = 0;
      while (safety++ < 50 && next.pending !== null) {
        const p = next.pending;
        if (next.phase === 'discard_choice' && p.kind === 'discard') {
          const pid = p.pendingDiscard.controller;
          const isSystemHandSize = p.pendingDiscard.sourceInstanceId === 'system';
          if (pid === AI_OPPONENT || isSystemHandSize) {
            const hand = next.players[pid].hand;
            // Pick the first card (or null) to satisfy the count. For
            // hand-size-limit excess, repeatedly pick first card until count
            // is met.
            const pickedId = hand.length > 0 ? hand[0]! : null;
            next = applyAction(next, pid, { type: 'RESOLVE_DISCARD', pickedId }).state;
            continue;
          }
          break;
        }
        if (next.phase === 'peek_choice' && p.kind === 'peek') {
          if (p.pendingPeek.controller === AI_OPPONENT) {
            next = applyAction(next, p.pendingPeek.controller, { type: 'RESOLVE_PEEK', pickedIds: [] }).state;
            continue;
          }
          break;
        }
        if (next.phase === 'choose_one' && p.kind === 'choose_one') {
          if (p.pendingChoose.controller === AI_OPPONENT) {
            next = applyAction(next, p.pendingChoose.controller, { type: 'RESOLVE_CHOOSE_ONE', optionIndex: 0 }).state;
            continue;
          }
          break;
        }
        if (next.phase === 'trigger_window' && p.kind === 'trigger') {
          if (p.pendingTrigger.controller === AI_OPPONENT) {
            next = applyAction(next, p.pendingTrigger.controller, {
              type: 'RESOLVE_TRIGGER', activate: false, targetInstanceId: null,
            }).state;
            continue;
          }
          break;
        }
        break;
      }

      // (Dice-roll + first-player AI auto-fire live in DiceRollPrompt and
      // FirstPlayerChoicePrompt useEffects — animations need to render, so
      // those flows are owned by the UI prompts, not the store.)

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
      // Engine-v2 flips activePlayer after mulligan_first → mulligan_second
      // (advanceMulliganPhase in shared/engine-v2/reducers/setup.ts). So the
      // decider in either window is ALWAYS activePlayer.
      while (
        (next.phase === 'mulligan_first' || next.phase === 'mulligan_second') &&
        next.activePlayer === AI_OPPONENT
      ) {
        const aiResult = applyAction(next, AI_OPPONENT, { type: 'KEEP_HAND' });
        next = aiResult.state;
      }
      void AI_HUMAN;

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
      // F-7q — during reactive windows (block/counter/trigger) the
      // DECIDING player is the inactive player. The store-level
      // legalActions field has to reflect THEIR options so the prompt
      // components (BlockerPrompt / CounterPrompt / TriggerPrompt) can
      // gate on `legalActions.length > 0`. Pre-fix we always computed
      // for next.activePlayer (the attacker / turn-owner), which
      // returned `[CONCEDE]` and made the prompts silently refuse to
      // mount. Phase A/B yields in runAiTurn set legalActions correctly
      // for the human; this finalisation block now matches that policy.
      const reactivePhase =
        next.phase === 'block_window' || next.phase === 'counter_window';
      const isTriggerReactive =
        next.phase === 'trigger_window' &&
        next.pending !== null &&
        next.pending.kind === 'trigger';
      const legalActionsFor: PlayerId = reactivePhase
        ? (next.activePlayer === 'A' ? 'B' : 'A')
        : isTriggerReactive
          ? (next.pending as { pendingTrigger: { controller: PlayerId } }).pendingTrigger.controller
          : next.activePlayer;
      set({
        state: next,
        legalActions: getLegalActions(next, legalActionsFor),
        ...(phaseOrPlayerChanged
          ? { inspectedCardId: null, cardDetailOpen: false, selectedAttackerId: null }
          : {}),
      });

      // F-7n Phase A/B re-entry — when the human resolves a reactive
      // window (block_window / counter_window / trigger_window) during
      // an AI turn, the AI loop was left mid-action (it exited early per
      // game.ts runAiTurn's narrowed yields). After the human's response
      // the AI still owns the turn but has no event to resume it. Kick
      // runAiTurn again when AI is active, no human pending remains,
      // and we're not already running.
      const aiModesReentry: ReadonlyArray<GameMode> = ['vs-easy', 'vs-medium', 'vs-hard'];
      const isAiGameReentry = aiModesReentry.includes(get().mode);
      const post = next;
      const aiCanResume =
        isAiGameReentry &&
        !post.result &&
        post.activePlayer === AI_OPPONENT &&
        // No human-controlled pending blocking the AI.
        !(
          post.pending !== null &&
          ((post.pending.kind === 'trigger' && post.pending.pendingTrigger.controller === AI_HUMAN) ||
            (post.pending.kind === 'discard' && post.pending.pendingDiscard.controller === AI_HUMAN) ||
            (post.pending.kind === 'peek' && post.pending.pendingPeek.controller === AI_HUMAN) ||
            (post.pending.kind === 'choose_one' && post.pending.pendingChoose.controller === AI_HUMAN))
        ) &&
        // Don't re-enter mid-block/counter window where the human is
        // reactive — those resolve via the same path on the human's next
        // click.
        post.phase !== 'block_window' &&
        post.phase !== 'counter_window' &&
        !get().aiThinking &&
        get().aiPaused;
      if (aiCanResume) {
        set({ aiPaused: false });
        void runAiTurn(get, set);
      }
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
      let ended = PhaseScheduler.enterEnd(get().state);
      // Force-resolve any pending arising from enterEnd. Without this the
      // hand-size-limit case (CR §6-5-7: hand > 10 at end-of-turn produces
      // pendingDiscard with controller = ending player) leaves the engine
      // suspended at phase=discard_choice and the turn never finishes.
      // Mirrors the runAiTurn safety-cap branch above (src/store/game.ts:413).
      // Auto-resolve loop — mirrors dispatch()'s controller-aware logic.
      // ONLY auto-resolves when controller is AI, OR (for discard) when the
      // source is the system-driven hand-size end-of-turn discard
      // (PhaseScheduler.ts:341). Human card-effect pendings break out so
      // React can render the corresponding prompt.
      let s2 = 0;
      while (s2++ < 50 && ended.pending !== null) {
        const p = ended.pending;
        if (ended.phase === 'discard_choice' && p.kind === 'discard') {
          const pid = p.pendingDiscard.controller;
          const isSystemHandSize = p.pendingDiscard.sourceInstanceId === 'system';
          if (pid === AI_OPPONENT || isSystemHandSize) {
            const hand = ended.players[pid].hand;
            const pickedId = hand.length > 0 ? hand[0]! : null;
            ended = applyAction(ended, pid, { type: 'RESOLVE_DISCARD', pickedId }).state;
            continue;
          }
          break;
        }
        if (ended.phase === 'peek_choice' && p.kind === 'peek') {
          if (p.pendingPeek.controller === AI_OPPONENT) {
            ended = applyAction(ended, p.pendingPeek.controller, { type: 'RESOLVE_PEEK', pickedIds: [] }).state;
            continue;
          }
          break;
        }
        if (ended.phase === 'choose_one' && p.kind === 'choose_one') {
          if (p.pendingChoose.controller === AI_OPPONENT) {
            ended = applyAction(ended, p.pendingChoose.controller, { type: 'RESOLVE_CHOOSE_ONE', optionIndex: 0 }).state;
            continue;
          }
          break;
        }
        if (ended.phase === 'trigger_window' && p.kind === 'trigger') {
          if (p.pendingTrigger.controller === AI_OPPONENT) {
            ended = applyAction(ended, p.pendingTrigger.controller, {
              type: 'RESOLVE_TRIGGER', activate: false, targetInstanceId: null,
            }).state;
            continue;
          }
          break;
        }
        break;
      }
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

// Driver-only state snapshot — exposes the store on window so the
// Playwright auto-player (tools/play-driver.mjs) can inspect the true
// engine state mid-stall. Gated on PLAY_DRIVER_SNAPSHOT localStorage key
// so production users never get the global. No gameplay behavior change.
// Mirrors the PLAY_DRIVER_PREFER / PLAY_DRIVER_LEADER_ID pattern.
try {
  if (typeof window !== 'undefined') {
    const enabled = window.localStorage.getItem('PLAY_DRIVER_SNAPSHOT');
    if (enabled !== null && enabled.length > 0) {
      // Read-only snapshot accessor. Returns a plain object the driver can
      // JSON-serialize. Never returns the store API itself, to avoid
      // accidental mutation from the driver side.
      (window as unknown as { __PLAY_DRIVER_SNAPSHOT__?: () => unknown }).__PLAY_DRIVER_SNAPSHOT__ =
        () => {
          const s = useGameStore.getState();
          return {
            phase: s.state.phase,
            activePlayer: s.state.activePlayer,
            turn: s.state.turn,
            pendingKind: s.state.pending?.kind ?? null,
            pendingController:
              s.state.pending !== null && 'controller' in (s.state.pending as object)
                ? (s.state.pending as unknown as { controller: string }).controller
                : s.state.pending?.kind === 'discard'
                  ? s.state.pending.pendingDiscard.controller
                  : s.state.pending?.kind === 'peek'
                    ? s.state.pending.pendingPeek.controller
                    : s.state.pending?.kind === 'choose_one'
                      ? s.state.pending.pendingChoose.controller
                      : s.state.pending?.kind === 'trigger'
                        ? s.state.pending.pendingTrigger.controller
                        : null,
            result: s.state.result,
            mode: s.mode,
            viewAs: s.viewAs,
            aiThinking: s.aiThinking,
            legalActionTypes: s.legalActions.map((a) => a.type),
            handCounts: { A: s.state.players.A.hand.length, B: s.state.players.B.hand.length },
            fieldCounts: { A: s.state.players.A.field.length, B: s.state.players.B.field.length },
            lifeCounts: { A: s.state.players.A.life.length, B: s.state.players.B.life.length },
            deckCounts: { A: s.state.players.A.deck.length, B: s.state.players.B.deck.length },
            trashCounts: { A: s.state.players.A.trash.length, B: s.state.players.B.trash.length },
            historyTail: (s.state.history as Array<unknown>).slice(-20),
          };
        };
    }
  }
} catch {}
