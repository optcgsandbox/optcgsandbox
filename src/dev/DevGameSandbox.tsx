// DevGameSandbox — engine-only debug overlay. Read access to every registered
// engine handler (snapshot() from Registry) + every legal action + every
// pending-state resolution path. Activate with `?dev=1`.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useGameStore } from '../store/game';
import type { Action } from '@shared/engine-v2/protocol/actions';
import type { CardInstance, GameState, InstanceId, PlayerId } from '@shared/engine-v2/state/types';
import {
  actionHandlers,
  triggerEmitters,
  conditionHandlers,
  continuousHandlers,
  replacementHandlers,
  costHandlers,
  targetResolvers,
} from '@shared/engine-v2/registry/types';
import { actionReducers } from '@shared/engine-v2/reducers/registry';
import cardsDataRaw from '@shared/data/cards.json';
import ScenarioRunner from './ScenarioRunner';

// Static enum of every player-dispatchable Action.type discriminator
// (mirrors shared/engine-v2/protocol/actions.ts Action union). The sandbox
// also reads `actionReducers.snapshot()` at runtime to confirm coverage.
const ALL_ACTION_TYPES: ReadonlyArray<string> = [
  'ROLL_DICE', 'CHOOSE_FIRST', 'CHOOSE_SECOND', 'MULLIGAN', 'KEEP_HAND',
  'PLAY_CARD', 'PLAY_STAGE', 'ATTACH_DON', 'ACTIVATE_MAIN',
  'DECLARE_ATTACK', 'DECLARE_BLOCKER', 'PLAY_COUNTER', 'SKIP_COUNTER', 'SKIP_BLOCKER',
  'RESOLVE_TRIGGER', 'RESOLVE_PEEK', 'RESOLVE_DISCARD', 'RESOLVE_CHOOSE_ONE', 'RESOLVE_TARGET_PICK',
  'END_TURN', 'CONCEDE',
];

interface LogEntry {
  readonly id: number;
  readonly ts: string;
  readonly kind: 'dispatch' | 'transition';
  readonly action?: Action;
  readonly prevPhase: string;
  readonly nextPhase: string;
  readonly prevPending: string;
  readonly nextPending: string;
  readonly activePlayer: PlayerId;
  readonly events: ReadonlyArray<unknown>;
  readonly prevSnap: object;
  readonly nextSnap: object;
}

function summarizeState(s: GameState): object {
  return {
    phase: s.phase,
    turn: s.turn,
    activePlayer: s.activePlayer,
    pending: s.pending,
    result: s.result,
    A: {
      hand: s.players.A.hand.length,
      field: s.players.A.field.length,
      life: s.players.A.life.length,
      deck: s.players.A.deck.length,
      trash: s.players.A.trash.length,
      donCost: s.players.A.donCostArea.length,
      donRested: s.players.A.donRested.length,
    },
    B: {
      hand: s.players.B.hand.length,
      field: s.players.B.field.length,
      life: s.players.B.life.length,
      deck: s.players.B.deck.length,
      trash: s.players.B.trash.length,
      donCost: s.players.B.donCostArea.length,
      donRested: s.players.B.donRested.length,
    },
  };
}

function labelForAction(state: GameState, action: Action): string {
  const t = action.type;
  const inst = (id: string | null | undefined) => (id ? state.instances[id] : undefined);
  const name = (id: string | null | undefined) => {
    const i = inst(id);
    return i ? (state.cardLibrary[i.cardId]?.name ?? i.cardId) : '?';
  };
  switch (t) {
    case 'PLAY_CARD': {
      const a = action as { instanceId: string; replaceTargetId: string | null };
      return `PLAY_CARD ${name(a.instanceId)}${a.replaceTargetId ? ` (replace ${a.replaceTargetId})` : ''}`;
    }
    case 'PLAY_STAGE': return `PLAY_STAGE ${name((action as { instanceId: string }).instanceId)}`;
    case 'ACTIVATE_MAIN': return `ACTIVATE_MAIN ${name((action as { instanceId: string }).instanceId)}`;
    case 'ATTACH_DON': return `ATTACH_DON → ${name((action as { targetInstanceId: string }).targetInstanceId)}`;
    case 'DECLARE_ATTACK': {
      // protocol field is targetInstanceId (actions.ts:59) — old
      // `defenderInstanceId` was pre-cutover drift.
      const a = action as { attackerInstanceId: string; targetInstanceId: string };
      return `DECLARE_ATTACK ${name(a.attackerInstanceId)} → ${name(a.targetInstanceId)}`;
    }
    case 'DECLARE_BLOCKER': return `DECLARE_BLOCKER ${name((action as { blockerInstanceId: string }).blockerInstanceId)}`;
    case 'PLAY_COUNTER': return `PLAY_COUNTER ${name((action as { instanceId: string }).instanceId)}`;
    case 'ROLL_DICE': return `ROLL_DICE ${(action as { player: string }).player}`;
    default: return t;
  }
}

function shortInstSummary(state: GameState, instId: string): string {
  const inst = state.instances[instId];
  if (!inst) return instId;
  const card = state.cardLibrary[inst.cardId];
  const flags = [
    inst.rested ? 'rested' : '',
    inst.summoningSick ? 'sick' : '',
    inst.attachedDon.length > 0 ? `+${inst.attachedDon.length}DON` : '',
  ].filter(Boolean).join(' ');
  return `${card?.name ?? inst.cardId} [${instId}]${flags ? ' ' + flags : ''}`;
}

function PlayerPanel({ state, pid, viewer }: { state: GameState; pid: PlayerId; viewer: PlayerId }) {
  const p = state.players[pid];
  const isYou = pid === viewer;
  return (
    <div className="rounded border border-zinc-700 p-2 text-[11px] leading-snug">
      <div className="mb-1 font-bold text-amber-300">
        Player {pid} {isYou ? '(YOU)' : ''}
        {state.activePlayer === pid && <span className="ml-2 text-green-400">ACTIVE</span>}
      </div>
      <div>Leader: {shortInstSummary(state, p.leader.instanceId)}</div>
      <div>Life: {p.life.length} | Deck: {p.deck.length} | Trash: {p.trash.length}</div>
      <div>DON Deck: {p.donDeck.length} | Cost: {p.donCostArea.length} | Rested: {p.donRested.length}</div>
      <div>Stage: {p.stage ? shortInstSummary(state, p.stage.instanceId) : '—'}</div>
      <div className="mt-1">
        <div className="font-semibold text-sky-300">Hand ({p.hand.length}):</div>
        {p.hand.map((id) => (
          <div key={id} className="ml-2 truncate">· {shortInstSummary(state, id)}</div>
        ))}
      </div>
      <div className="mt-1">
        <div className="font-semibold text-sky-300">Field ({p.field.length}):</div>
        {p.field.map((inst: CardInstance) => (
          <div key={inst.instanceId} className="ml-2 truncate">· {shortInstSummary(state, inst.instanceId)}</div>
        ))}
      </div>
    </div>
  );
}

function PendingPanel({ state, dispatch }: { state: GameState; dispatch: (a: Action) => void }) {
  const pending = state.pending;
  if (pending === null) return null;

  if (pending.kind === 'choose_one') {
    const pc = pending.pendingChoose;
    return (
      <div className="rounded border-2 border-amber-400 bg-amber-950/40 p-2">
        <div className="mb-2 font-bold text-amber-200">PENDING: choose_one (controller {pc.controller})</div>
        <div className="text-[11px] text-zinc-300 mb-2">{pc.options.length} options</div>
        <div className="flex flex-col gap-1">
          {pc.options.length === 0 && (
            <div className="text-rose-400 text-[11px]">⚠ No options! Engine pause has empty options array.</div>
          )}
          {pc.options.map((opt, i) => {
            const o = opt as { action?: { kind?: string } };
            const k = o?.action?.kind ?? '?';
            return (
              <button
                key={i}
                type="button"
                onClick={() => dispatch({ type: 'RESOLVE_CHOOSE_ONE', optionIndex: i })}
                className="rounded bg-amber-700 px-2 py-1 text-left text-[11px] hover:bg-amber-600"
              >
                Option {i + 1}: {k.replace(/_/g, ' ')}
              </button>
            );
          })}
        </div>
        <details className="mt-2">
          <summary className="cursor-pointer text-[10px] text-zinc-400">raw options JSON</summary>
          <pre className="mt-1 max-h-40 overflow-auto text-[9px]">{JSON.stringify(pc.options, null, 2)}</pre>
        </details>
      </div>
    );
  }

  if (pending.kind === 'peek') {
    const pp = pending.pendingPeek;
    return (
      <div className="rounded border-2 border-purple-400 bg-purple-950/40 p-2">
        <div className="mb-2 font-bold text-purple-200">PENDING: peek (controller {pp.controller})</div>
        <div className="flex flex-col gap-1">
          {pp.peekedIds.map((id: InstanceId) => (
            <button
              key={id}
              type="button"
              onClick={() => dispatch({ type: 'RESOLVE_PEEK', pickedIds: [id] })}
              className="rounded bg-purple-700 px-2 py-1 text-left text-[11px] hover:bg-purple-600"
            >
              Pick: {shortInstSummary(state, id)}
            </button>
          ))}
          <button
            type="button"
            onClick={() => dispatch({ type: 'RESOLVE_PEEK', pickedIds: [] })}
            className="rounded bg-zinc-700 px-2 py-1 text-left text-[11px] hover:bg-zinc-600"
          >
            Skip (pick none)
          </button>
        </div>
      </div>
    );
  }

  if (pending.kind === 'discard') {
    const pd = pending.pendingDiscard;
    // Candidates are the target hand per revealedFrom — mirrors
    // resolveDiscardReducer (choiceResolve.ts): self_hand → controller's
    // own hand; opp_hand → the controller's opponent's hand.
    const discardSide = pd.revealedFrom === 'self_hand'
      ? pd.controller
      : (pd.controller === 'A' ? 'B' : 'A');
    const discardCandidates = state.players[discardSide].hand;
    return (
      <div className="rounded border-2 border-rose-400 bg-rose-950/40 p-2">
        <div className="mb-2 font-bold text-rose-200">PENDING: discard (controller {pd.controller})</div>
        <div className="flex flex-col gap-1">
          {discardCandidates.map((id: InstanceId) => (
            <button
              key={id}
              type="button"
              onClick={() => dispatch({ type: 'RESOLVE_DISCARD', pickedId: id })}
              className="rounded bg-rose-700 px-2 py-1 text-left text-[11px] hover:bg-rose-600"
            >
              Discard: {shortInstSummary(state, id)}
            </button>
          ))}
          <button
            type="button"
            onClick={() => dispatch({ type: 'RESOLVE_DISCARD', pickedId: null })}
            className="rounded bg-zinc-700 px-2 py-1 text-left text-[11px] hover:bg-zinc-600"
          >
            Skip (pick none)
          </button>
        </div>
      </div>
    );
  }

  if (pending.kind === 'trigger') {
    const pt = pending.pendingTrigger;
    return (
      <div className="rounded border-2 border-cyan-400 bg-cyan-950/40 p-2">
        <div className="mb-2 font-bold text-cyan-200">PENDING: trigger (controller {pt.controller})</div>
        <div className="flex gap-1">
          <button onClick={() => dispatch({ type: 'RESOLVE_TRIGGER', activate: true, targetInstanceId: null })} className="flex-1 rounded bg-cyan-700 px-2 py-1 text-[11px] hover:bg-cyan-600">Activate</button>
          <button onClick={() => dispatch({ type: 'RESOLVE_TRIGGER', activate: false, targetInstanceId: null })} className="flex-1 rounded bg-zinc-700 px-2 py-1 text-[11px] hover:bg-zinc-600">Decline</button>
        </div>
      </div>
    );
  }

  if (pending.kind === 'attack_target_pick') {
    const pt = pending.pendingTargetPick;
    return (
      <div className="rounded border-2 border-red-400 bg-red-950/40 p-2">
        <div className="mb-2 font-bold text-red-200">PENDING: target_pick (controller {pt.controller})</div>
        <div className="flex flex-col gap-1">
          {pt.candidateIds.map((id: InstanceId) => (
            <button
              key={id}
              type="button"
              onClick={() => dispatch({ type: 'RESOLVE_TARGET_PICK', pickedId: id })}
              className="rounded bg-red-700 px-2 py-1 text-left text-[11px] hover:bg-red-600"
            >
              Target: {shortInstSummary(state, id)}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded border-2 border-zinc-500 bg-zinc-900/40 p-2">
      <div className="font-bold text-zinc-300">PENDING (unknown kind): {(pending as { kind: string }).kind}</div>
      <pre className="mt-1 max-h-40 overflow-auto text-[10px]">{JSON.stringify(pending, null, 2)}</pre>
    </div>
  );
}

function RegistryPanel() {
  const [open, setOpen] = useState(false);
  const snaps = useMemo(() => ({
    actions: actionHandlers.snapshot(),
    triggers: triggerEmitters.snapshot(),
    conditions: conditionHandlers.snapshot(),
    continuous: continuousHandlers.snapshot(),
    replacements: replacementHandlers.snapshot(),
    costs: costHandlers.snapshot(),
    targets: targetResolvers.snapshot(),
    reducers: actionReducers.snapshot(),
  }), []);
  const reducerSet = new Set(snaps.reducers);
  const missingDispatchableTypes = ALL_ACTION_TYPES.filter((t) => !reducerSet.has(t));
  const extraReducers = snaps.reducers.filter((t) => !ALL_ACTION_TYPES.includes(t));

  return (
    <div className="rounded border border-zinc-700 p-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left font-bold text-emerald-300 text-[11px]"
      >
        {open ? '▼' : '▶'} Engine Registry Snapshot
        <span className="ml-2 text-zinc-400 font-normal">
          {snaps.actions.length}A / {snaps.triggers.length}T / {snaps.conditions.length}C / {snaps.continuous.length}Co / {snaps.replacements.length}R / {snaps.costs.length}$ / {snaps.targets.length}Tg / {snaps.reducers.length}Rd
        </span>
      </button>
      {open && (
        <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
          {(['actions','triggers','conditions','continuous','replacements','costs','targets','reducers'] as const).map((k) => (
            <details key={k} className="rounded border border-zinc-800 bg-zinc-900 p-1">
              <summary className="cursor-pointer font-semibold text-emerald-200">{k} ({snaps[k].length})</summary>
              <div className="mt-1 max-h-40 overflow-auto">
                {snaps[k].map((name) => (
                  <div key={name} className="text-zinc-300">· {name}</div>
                ))}
              </div>
            </details>
          ))}
          <div className="col-span-2 rounded border border-rose-700 bg-rose-950/30 p-1">
            <div className="font-semibold text-rose-300">Dispatchable-Type Coverage Check</div>
            <div className="mt-1">Action union types not in reducer registry: {missingDispatchableTypes.length === 0 ? <span className="text-green-400">none ✓</span> : <span className="text-rose-400">{missingDispatchableTypes.join(', ')}</span>}</div>
            <div>Reducer registry types not in Action union: {extraReducers.length === 0 ? <span className="text-green-400">none ✓</span> : <span className="text-rose-400">{extraReducers.join(', ')}</span>}</div>
          </div>
        </div>
      )}
    </div>
  );
}

interface CorpusCard {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly colors: ReadonlyArray<string>;
}

const CARDS = cardsDataRaw as unknown as ReadonlyArray<CorpusCard>;

function CardInjector({ activePlayer, viewAs }: { activePlayer: PlayerId; viewAs: PlayerId }) {
  const [query, setQuery] = useState('');
  const [targetSide, setTargetSide] = useState<PlayerId>(viewAs);
  const matches = useMemo(() => {
    if (query.trim().length < 2) return [];
    const q = query.trim().toLowerCase();
    return CARDS.filter((c) =>
      c.kind !== 'leader' && (c.id.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
    ).slice(0, 20);
  }, [query]);

  const injectToHand = (card: CorpusCard) => {
    useGameStore.setState((store) => {
      const s = store.state;
      const ids = Object.keys(s.instances);
      let n = 1;
      let candidate = `dev${n}`;
      while (ids.includes(candidate)) { n += 1; candidate = `dev${n}`; }
      const inst: CardInstance = {
        instanceId: candidate as InstanceId,
        cardId: card.id,
        controller: targetSide,
        rested: false,
        summoningSick: false,
        attachedDon: [],
        attachedDonRested: [],
        perTurn: { hasAttacked: false, effectsUsed: [] },
      };
      const nextState = {
        ...s,
        instances: { ...s.instances, [candidate]: inst },
        cardLibrary: s.cardLibrary[card.id] ? s.cardLibrary : { ...s.cardLibrary, [card.id]: card as never },
        players: {
          ...s.players,
          [targetSide]: {
            ...s.players[targetSide],
            hand: [...s.players[targetSide].hand, candidate as InstanceId],
          },
        },
      };
      return { state: nextState as GameState };
    });
  };

  return (
    <div className="rounded border border-zinc-700 p-2">
      <div className="mb-2 font-bold text-sky-300 text-[11px]">Card injector (force-add to hand)</div>
      <div className="flex gap-1 mb-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="search card id or name…"
          className="flex-1 rounded bg-zinc-900 px-2 py-1 text-[11px] border border-zinc-700"
        />
        <button
          type="button"
          onClick={() => setTargetSide(targetSide === 'A' ? 'B' : 'A')}
          className="rounded bg-zinc-700 px-2 py-1 text-[11px] hover:bg-zinc-600"
        >
          → {targetSide}
        </button>
      </div>
      <div className="max-h-48 overflow-auto">
        {matches.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => injectToHand(c)}
            className="block w-full text-left rounded px-2 py-1 text-[11px] hover:bg-zinc-800"
            title={`${c.kind} · ${(c.colors ?? []).join('/')}`}
          >
            <span className="text-emerald-300">{c.id}</span> · <span className="text-zinc-300">{c.name}</span> <span className="text-zinc-500">[{c.kind}]</span>
          </button>
        ))}
        {query.trim().length >= 2 && matches.length === 0 && (
          <div className="italic text-zinc-500 text-[11px]">(no matches)</div>
        )}
        {query.trim().length < 2 && (
          <div className="italic text-zinc-500 text-[11px]">(type ≥2 chars to search)</div>
        )}
      </div>
      <div className="mt-1 text-[10px] text-zinc-500">
        Active: {activePlayer} · viewer: {viewAs} · injecting to: {targetSide}
      </div>
    </div>
  );
}

export default function DevGameSandbox() {
  const state = useGameStore((s) => s.state);
  const legalActions = useGameStore((s) => s.legalActions);
  const dispatch = useGameStore((s) => s.dispatch);
  const reset = useGameStore((s) => s.reset);
  const mode = useGameStore((s) => s.mode);
  const setMode = useGameStore((s) => s.setMode);
  const viewAs = useGameStore((s) => s.viewAs);

  const [log, setLog] = useState<LogEntry[]>([]);
  const [stateExpanded, setStateExpanded] = useState(false);
  const logIdRef = useRef(0);
  const prevStateRef = useRef(state);

  const wrappedDispatch = useMemo(() => {
    return (action: Action) => {
      const prev = useGameStore.getState().state;
      const prevHistoryLen = prev.history.length;
      const prevPhase = prev.phase;
      const prevPending = prev.pending ? prev.pending.kind : 'null';
      const prevSnap = summarizeState(prev);
      dispatch(action);
      const next = useGameStore.getState().state;
      const events = (next.history as ReadonlyArray<unknown>).slice(prevHistoryLen);
      const id = ++logIdRef.current;
      const entry: LogEntry = {
        id,
        ts: new Date().toISOString().slice(11, 23),
        kind: 'dispatch',
        action,
        prevPhase,
        nextPhase: next.phase,
        prevPending,
        nextPending: next.pending ? next.pending.kind : 'null',
        activePlayer: prev.activePlayer,
        events,
        prevSnap,
        nextSnap: summarizeState(next),
      };
      setLog((l) => [entry, ...l].slice(0, 200));
      // eslint-disable-next-line no-console
      console.log('[DevGameSandbox] dispatch', entry);
    };
  }, [dispatch]);

  // Auto-log any phase or pending transition that wasn't user-initiated
  // (AI loop, async R/D/D pipelines, refold side effects).
  useEffect(() => {
    const prev = prevStateRef.current;
    if (prev === state) return;
    if (prev.phase !== state.phase || (prev.pending?.kind ?? null) !== (state.pending?.kind ?? null) || prev.activePlayer !== state.activePlayer) {
      const id = ++logIdRef.current;
      setLog((l) => [{
        id,
        ts: new Date().toISOString().slice(11, 23),
        kind: 'transition' as const,
        prevPhase: prev.phase,
        nextPhase: state.phase,
        prevPending: prev.pending ? prev.pending.kind : 'null',
        nextPending: state.pending ? state.pending.kind : 'null',
        activePlayer: state.activePlayer,
        events: (state.history as ReadonlyArray<unknown>).slice(prev.history.length),
        prevSnap: summarizeState(prev),
        nextSnap: summarizeState(state),
      }, ...l].slice(0, 200));
    }
    prevStateRef.current = state;
  }, [state]);

  const otherPid: PlayerId = viewAs === 'A' ? 'B' : 'A';

  return (
    <div className="fixed inset-0 z-[10000] flex flex-col bg-zinc-950 text-zinc-100 font-mono text-[12px]">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-700 bg-zinc-900 p-2">
        <span className="font-bold text-amber-400">DEV SANDBOX</span>
        <span className="text-zinc-500">|</span>
        <span>Turn {state.turn}</span>
        <span className="text-zinc-500">|</span>
        <span className="text-green-400">phase: {state.phase}</span>
        <span className="text-zinc-500">|</span>
        <span>active: {state.activePlayer}</span>
        <span className="text-zinc-500">|</span>
        <span>pending: <span className="text-amber-300">{state.pending?.kind ?? 'null'}</span></span>
        <span className="text-zinc-500">|</span>
        <span>mode: {mode}</span>
        <div className="ml-auto flex gap-1">
          <button onClick={() => setMode('vs-easy')} className="rounded bg-zinc-700 px-2 py-0.5 hover:bg-zinc-600">Easy</button>
          <button onClick={() => setMode('vs-medium')} className="rounded bg-zinc-700 px-2 py-0.5 hover:bg-zinc-600">Med</button>
          <button onClick={() => setMode('vs-hard')} className="rounded bg-zinc-700 px-2 py-0.5 hover:bg-zinc-600">Hard</button>
          <button onClick={() => reset()} className="rounded bg-rose-700 px-2 py-0.5 hover:bg-rose-600">Reset</button>
          <button
            onClick={() => { const u = new URL(window.location.href); u.searchParams.delete('dev'); window.location.href = u.toString(); }}
            className="rounded bg-zinc-700 px-2 py-0.5 hover:bg-zinc-600"
          >Exit</button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 overflow-hidden p-2" style={{ height: 'calc(100vh - 42px)' }}>
        {/* Column 1: Players + state + registry */}
        <div className="flex flex-col gap-2 overflow-auto">
          <PlayerPanel state={state} pid={otherPid} viewer={viewAs} />
          <PlayerPanel state={state} pid={viewAs} viewer={viewAs} />
          <RegistryPanel />
          <button
            type="button"
            onClick={() => setStateExpanded((v) => !v)}
            className="rounded bg-zinc-700 px-2 py-1 text-left text-[11px] hover:bg-zinc-600"
          >
            {stateExpanded ? '▼' : '▶'} Raw state JSON
          </button>
          {stateExpanded && (
            <pre className="max-h-[40vh] overflow-auto rounded border border-zinc-700 bg-zinc-900 p-2 text-[10px]">
              {JSON.stringify({
                phase: state.phase,
                turn: state.turn,
                activePlayer: state.activePlayer,
                pending: state.pending,
                diceRoll: state.diceRoll,
                firstPlayer: state.firstPlayer,
                result: state.result,
              }, null, 2)}
            </pre>
          )}
        </div>

        {/* Column 2: Pending + legal actions + setup shortcuts + card injector */}
        <div className="flex flex-col gap-2 overflow-auto">
          <PendingPanel state={state} dispatch={wrappedDispatch} />
          <div className="rounded border border-zinc-700 p-2">
            <div className="mb-2 font-bold text-green-400">
              Legal actions for {state.activePlayer} ({legalActions.length})
            </div>
            <div className="flex flex-col gap-1">
              {legalActions.length === 0 && (
                <div className="text-[11px] italic text-zinc-500">(no legal actions)</div>
              )}
              {legalActions.map((a, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => wrappedDispatch(a)}
                  className="rounded bg-emerald-800 px-2 py-1 text-left text-[11px] hover:bg-emerald-700"
                >
                  {labelForAction(state, a)}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded border border-zinc-700 p-2">
            <div className="mb-1 font-bold text-cyan-400">Setup + Turn shortcuts</div>
            <div className="flex flex-wrap gap-1">
              {state.phase === 'dice_roll' && (
                <>
                  <button onClick={() => wrappedDispatch({ type: 'ROLL_DICE', player: 'A' })} className="rounded bg-cyan-700 px-2 py-1 text-[11px] hover:bg-cyan-600">Roll A</button>
                  <button onClick={() => wrappedDispatch({ type: 'ROLL_DICE', player: 'B' })} className="rounded bg-cyan-700 px-2 py-1 text-[11px] hover:bg-cyan-600">Roll B</button>
                </>
              )}
              {state.phase === 'first_player_choice' && (
                <>
                  <button onClick={() => wrappedDispatch({ type: 'CHOOSE_FIRST' })} className="rounded bg-cyan-700 px-2 py-1 text-[11px] hover:bg-cyan-600">Go First</button>
                  <button onClick={() => wrappedDispatch({ type: 'CHOOSE_SECOND' })} className="rounded bg-cyan-700 px-2 py-1 text-[11px] hover:bg-cyan-600">Go Second</button>
                </>
              )}
              {(state.phase === 'mulligan_first' || state.phase === 'mulligan_second') && (
                <>
                  <button onClick={() => wrappedDispatch({ type: 'KEEP_HAND' })} className="rounded bg-cyan-700 px-2 py-1 text-[11px] hover:bg-cyan-600">Keep</button>
                  <button onClick={() => wrappedDispatch({ type: 'MULLIGAN' })} className="rounded bg-cyan-700 px-2 py-1 text-[11px] hover:bg-cyan-600">Mulligan</button>
                </>
              )}
              {state.phase === 'main' && state.activePlayer === viewAs && (
                <button onClick={() => wrappedDispatch({ type: 'END_TURN' })} className="rounded bg-amber-700 px-2 py-1 text-[11px] hover:bg-amber-600">END_TURN</button>
              )}
              <button onClick={() => wrappedDispatch({ type: 'CONCEDE' })} className="rounded bg-rose-700 px-2 py-1 text-[11px] hover:bg-rose-600">CONCEDE</button>
            </div>
          </div>
          <CardInjector activePlayer={state.activePlayer} viewAs={viewAs} />
          <ScenarioRunner />
        </div>

        {/* Column 3: Dispatch log with per-entry diff */}
        <div className="flex flex-col gap-2 overflow-hidden">
          <div className="flex items-center justify-between">
            <div className="font-bold text-amber-400">Dispatch log ({log.length})</div>
            <button onClick={() => setLog([])} className="rounded bg-zinc-700 px-2 py-0.5 text-[11px] hover:bg-zinc-600">Clear</button>
          </div>
          <div className="flex-1 overflow-auto rounded border border-zinc-700 bg-zinc-900 p-2">
            {log.map((e) => (
              <details key={e.id} className="mb-2 border-b border-zinc-800 pb-1 text-[10px]">
                <summary className="cursor-pointer">
                  <span className={e.kind === 'dispatch' ? 'text-amber-300' : 'text-zinc-400'}>
                    {e.ts} · {e.kind === 'dispatch' ? e.action?.type : 'TRANSITION'} · p={e.activePlayer}
                  </span>
                  <div className="text-zinc-400">
                    phase: <span className="text-rose-300">{e.prevPhase}</span> → <span className="text-emerald-300">{e.nextPhase}</span>
                    {' | '}
                    pending: <span className="text-rose-300">{e.prevPending}</span> → <span className="text-emerald-300">{e.nextPending}</span>
                    {' | '}
                    events: {e.events.length}
                  </div>
                </summary>
                {e.action && (
                  <div className="mt-1">
                    <div className="font-semibold text-amber-200">action:</div>
                    <pre className="overflow-auto text-[9px] text-zinc-400">{JSON.stringify(e.action, null, 2)}</pre>
                  </div>
                )}
                <div className="mt-1">
                  <div className="font-semibold text-rose-300">before:</div>
                  <pre className="overflow-auto text-[9px] text-zinc-400">{JSON.stringify(e.prevSnap, null, 2)}</pre>
                </div>
                <div className="mt-1">
                  <div className="font-semibold text-emerald-300">after:</div>
                  <pre className="overflow-auto text-[9px] text-zinc-400">{JSON.stringify(e.nextSnap, null, 2)}</pre>
                </div>
                {e.events.length > 0 && (
                  <div className="mt-1">
                    <div className="font-semibold text-sky-300">history events fired ({e.events.length}):</div>
                    <pre className="overflow-auto text-[9px] text-zinc-400">{JSON.stringify(e.events, null, 2)}</pre>
                  </div>
                )}
              </details>
            ))}
            {log.length === 0 && (
              <div className="italic text-zinc-500">(no actions dispatched yet)</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
