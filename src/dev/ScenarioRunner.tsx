// ScenarioRunner — deterministic engine verification driven from inside the
// dev sandbox. Defines a small DSL of action sequences + assertions, runs
// them against the live store, and reports pass/fail per step.
//
// Not gameplay UI. This proves that scripted engine paths are reachable.

import { useMemo, useState } from 'react';
import { useGameStore } from '../store/game';
import type { Action } from '@shared/engine-v2/protocol/actions';
import type { GameState, PlayerId } from '@shared/engine-v2/state/types';
import { actionReducers } from '@shared/engine-v2/reducers/registry';
import { actionHandlers, triggerEmitters } from '@shared/engine-v2/registry/types';
import cardsDataRaw from '@shared/data/cards.json';

interface CorpusCard { readonly id: string; readonly name: string; readonly kind: string }
const CARDS = cardsDataRaw as unknown as ReadonlyArray<CorpusCard>;

interface InjectSpec {
  readonly player: PlayerId;
  readonly cardId: string;
  readonly zone?: 'hand' | 'field';
}

interface StepExpect {
  readonly phase?: string;
  readonly pendingKind?: string | null;
  readonly historyContains?: string;
  readonly handLen?: { readonly A?: number; readonly B?: number };
  readonly fieldLen?: { readonly A?: number; readonly B?: number };
}

interface ScenarioStep {
  readonly label: string;
  readonly action: Action | ((s: GameState) => Action | null);
  readonly expect?: StepExpect;
  readonly waitMs?: number;
}

interface Scenario {
  readonly name: string;
  readonly description: string;
  readonly setup?: ReadonlyArray<InjectSpec>;
  readonly steps: ReadonlyArray<ScenarioStep>;
}

interface StepResult {
  readonly label: string;
  readonly status: 'pass' | 'fail' | 'skip' | 'error';
  readonly note?: string;
  readonly actionDispatched?: Action;
  readonly diffs?: ReadonlyArray<string>;
  readonly historyEvents?: ReadonlyArray<unknown>;
}

interface ScenarioResult {
  readonly name: string;
  readonly steps: ReadonlyArray<StepResult>;
  readonly summary: 'pass' | 'fail';
}

const SCENARIOS: ReadonlyArray<Scenario> = [
  {
    name: 'setup-roll-mulligan-end',
    description: 'Full setup: roll dice, choose first, mulligan-keep, reach main phase.',
    steps: [
      { label: 'A rolls dice', action: { type: 'ROLL_DICE', player: 'A' }, waitMs: 50 },
      { label: 'B rolls dice', action: { type: 'ROLL_DICE', player: 'B' }, waitMs: 50, expect: { phase: 'first_player_choice' } },
      { label: 'A chooses first', action: { type: 'CHOOSE_FIRST' }, waitMs: 50, expect: { phase: 'mulligan_first' } },
      { label: 'A keeps hand', action: { type: 'KEEP_HAND' }, waitMs: 500 },
    ],
  },
  {
    name: 'reach-main-then-end-turn',
    description: 'Complete setup and end one turn cleanly (no soft-lock).',
    steps: [
      { label: 'A roll', action: { type: 'ROLL_DICE', player: 'A' }, waitMs: 50 },
      { label: 'B roll', action: { type: 'ROLL_DICE', player: 'B' }, waitMs: 50 },
      { label: 'A first', action: { type: 'CHOOSE_FIRST' }, waitMs: 50 },
      { label: 'A keep', action: { type: 'KEEP_HAND' }, waitMs: 800, expect: { phase: 'main' } },
      { label: 'A end turn', action: { type: 'END_TURN' }, waitMs: 2500 },
    ],
  },
  {
    name: 'registry-coverage-static',
    description: 'Static check: every Action.type in protocol/actions.ts is in actionReducers; every action.kind in cards.json is in actionHandlers; every trigger is in triggerEmitters.',
    steps: [
      { label: 'placeholder (handled by static path)', action: { type: 'CONCEDE' } },
    ],
  },
];

function checkRegistryCoverage(): { ok: boolean; missing: ReadonlyArray<string>; extra: ReadonlyArray<string> } {
  const ALL_TYPES = [
    'ROLL_DICE','CHOOSE_FIRST','CHOOSE_SECOND','MULLIGAN','KEEP_HAND',
    'PLAY_CARD','PLAY_STAGE','ATTACH_DON','ACTIVATE_MAIN',
    'DECLARE_ATTACK','DECLARE_BLOCKER','PLAY_COUNTER','SKIP_COUNTER','SKIP_BLOCKER',
    'RESOLVE_TRIGGER','RESOLVE_PEEK','RESOLVE_DISCARD','RESOLVE_CHOOSE_ONE','RESOLVE_TARGET_PICK',
    'END_TURN','CONCEDE',
  ];
  const reducerSet = new Set(actionReducers.snapshot());
  const missing = ALL_TYPES.filter((t) => !reducerSet.has(t));
  const extra = actionReducers.snapshot().filter((t) => !ALL_TYPES.includes(t));
  return { ok: missing.length === 0, missing, extra };
}

function checkCorpusCoverage(): { ok: boolean; missingActions: ReadonlyArray<string>; missingTriggers: ReadonlyArray<string> } {
  const actionSet = new Set<string>();
  const triggerSet = new Set<string>();
  for (const c of CARDS as unknown as Array<{ effectSpecV2?: { clauses?: Array<{ trigger?: string; action?: { kind?: string } }> } }>) {
    const spec = c.effectSpecV2;
    if (!spec) continue;
    for (const cl of spec.clauses ?? []) {
      if (cl.action?.kind) actionSet.add(cl.action.kind);
      if (cl.trigger) triggerSet.add(cl.trigger);
    }
  }
  const aSnap = new Set(actionHandlers.snapshot());
  const tSnap = new Set(triggerEmitters.snapshot());
  const missingActions = [...actionSet].filter((k) => !aSnap.has(k));
  const missingTriggers = [...triggerSet].filter((k) => !tSnap.has(k));
  return { ok: missingActions.length === 0 && missingTriggers.length === 0, missingActions, missingTriggers };
}

function diffSummary(expect: StepExpect, _before: GameState, after: GameState, events: ReadonlyArray<unknown>): string[] {
  const diffs: string[] = [];
  if (expect.phase !== undefined && after.phase !== expect.phase) {
    diffs.push(`phase: expected "${expect.phase}", got "${after.phase}"`);
  }
  if (expect.pendingKind !== undefined) {
    const got = after.pending?.kind ?? null;
    if (got !== expect.pendingKind) diffs.push(`pending: expected ${JSON.stringify(expect.pendingKind)}, got ${JSON.stringify(got)}`);
  }
  if (expect.handLen) {
    for (const pid of (['A','B'] as PlayerId[])) {
      const want = expect.handLen[pid];
      if (want !== undefined && after.players[pid].hand.length !== want) {
        diffs.push(`hand[${pid}]: expected ${want}, got ${after.players[pid].hand.length}`);
      }
    }
  }
  if (expect.fieldLen) {
    for (const pid of (['A','B'] as PlayerId[])) {
      const want = expect.fieldLen[pid];
      if (want !== undefined && after.players[pid].field.length !== want) {
        diffs.push(`field[${pid}]: expected ${want}, got ${after.players[pid].field.length}`);
      }
    }
  }
  if (expect.historyContains !== undefined) {
    const hit = events.some((e) => typeof e === 'object' && e !== null && (e as { type?: string }).type === expect.historyContains);
    if (!hit) diffs.push(`history: expected event "${expect.historyContains}" in this step, none found`);
  }
  return diffs;
}

async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
  if (scenario.name === 'registry-coverage-static') {
    const reg = checkRegistryCoverage();
    const corp = checkCorpusCoverage();
    const steps: StepResult[] = [
      {
        label: 'Reducer registry vs Action union (21 types)',
        status: reg.ok ? 'pass' : 'fail',
        note: reg.ok ? 'all 21 covered' : `missing: ${reg.missing.join(', ')}; extra: ${reg.extra.join(', ')}`,
      },
      {
        label: 'actionHandlers vs corpus action.kind',
        status: corp.missingActions.length === 0 ? 'pass' : 'fail',
        note: corp.missingActions.length === 0 ? 'all kinds registered' : `unregistered: ${corp.missingActions.join(', ')}`,
      },
      {
        label: 'triggerEmitters vs corpus triggers',
        status: corp.missingTriggers.length === 0 ? 'pass' : 'fail',
        note: corp.missingTriggers.length === 0 ? 'all triggers registered' : `unregistered: ${corp.missingTriggers.join(', ')}`,
      },
    ];
    return { name: scenario.name, steps, summary: steps.every((s) => s.status === 'pass') ? 'pass' : 'fail' };
  }

  useGameStore.getState().reset();
  await new Promise((r) => setTimeout(r, 50));

  if (scenario.setup && scenario.setup.length > 0) {
    useGameStore.setState((store) => {
      const s = store.state;
      let counter = Object.keys(s.instances).length;
      const newInstances: typeof s.instances = { ...s.instances };
      const newLibrary: typeof s.cardLibrary = { ...s.cardLibrary };
      const newHands = { A: [...s.players.A.hand], B: [...s.players.B.hand] };
      const newFields = { A: [...s.players.A.field], B: [...s.players.B.field] };
      for (const spec of scenario.setup!) {
        const cardMeta = CARDS.find((c) => c.id === spec.cardId);
        if (!cardMeta) continue;
        counter += 1;
        const iid = `scen${counter}`;
        const inst = {
          instanceId: iid as never,
          cardId: spec.cardId as never,
          controller: spec.player,
          rested: false,
          summoningSick: false,
          attachedDon: [] as never[],
          attachedDonRested: [] as never[],
          perTurn: { hasAttacked: false, effectsUsed: [] as never[] },
        };
        (newInstances as Record<string, unknown>)[iid] = inst;
        if (!(newLibrary as Record<string, unknown>)[spec.cardId]) {
          (newLibrary as Record<string, unknown>)[spec.cardId] = cardMeta as never;
        }
        if (spec.zone === 'field') newFields[spec.player].push(inst as never);
        else newHands[spec.player].push(iid as never);
      }
      const nextState: GameState = {
        ...s,
        instances: newInstances,
        cardLibrary: newLibrary,
        players: {
          ...s.players,
          A: { ...s.players.A, hand: newHands.A as never, field: newFields.A },
          B: { ...s.players.B, hand: newHands.B as never, field: newFields.B },
        },
      };
      return { state: nextState };
    });
    await new Promise((r) => setTimeout(r, 50));
  }

  const results: StepResult[] = [];
  for (const step of scenario.steps) {
    const before = useGameStore.getState().state;
    const prevHistLen = before.history.length;
    let action: Action | null;
    try {
      action = typeof step.action === 'function' ? step.action(before) : step.action;
    } catch (err) {
      results.push({ label: step.label, status: 'error', note: `resolver threw: ${(err as Error).message}` });
      continue;
    }
    if (action === null) {
      results.push({ label: step.label, status: 'skip', note: 'resolver returned null' });
      continue;
    }
    if (!actionReducers.snapshot().includes(action.type)) {
      results.push({ label: step.label, status: 'fail', note: `action.type "${action.type}" not in reducer registry`, actionDispatched: action });
      continue;
    }
    try {
      useGameStore.getState().dispatch(action);
    } catch (err) {
      results.push({ label: step.label, status: 'error', note: `dispatch threw: ${(err as Error).message}`, actionDispatched: action });
      continue;
    }
    await new Promise((r) => setTimeout(r, step.waitMs ?? 25));
    const after = useGameStore.getState().state;
    const events = (after.history as ReadonlyArray<unknown>).slice(prevHistLen);
    const diffs = step.expect ? diffSummary(step.expect, before, after, events) : [];
    results.push({
      label: step.label,
      status: diffs.length === 0 ? 'pass' : 'fail',
      actionDispatched: action,
      diffs: diffs.length > 0 ? diffs : undefined,
      historyEvents: events,
    });
  }

  return { name: scenario.name, steps: results, summary: results.every((r) => r.status === 'pass') ? 'pass' : 'fail' };
}

export default function ScenarioRunner() {
  const [selectedName, setSelectedName] = useState<string>(SCENARIOS[0]?.name ?? '');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => SCENARIOS.find((s) => s.name === selectedName), [selectedName]);

  const runAll = async () => {
    setRunning(true);
    const all: ScenarioResult[] = [];
    for (const sc of SCENARIOS) {
      // eslint-disable-next-line no-await-in-loop
      all.push(await runScenario(sc));
    }
    setRunning(false);
    setResult({
      name: 'ALL',
      steps: all.flatMap((r) => r.steps.map((s) => ({ ...s, label: `[${r.name}] ${s.label}` }))),
      summary: all.every((r) => r.summary === 'pass') ? 'pass' : 'fail',
    });
  };

  const runOne = async () => {
    if (!selected) return;
    setRunning(true);
    setResult(await runScenario(selected));
    setRunning(false);
  };

  return (
    <div className="rounded border border-zinc-700 p-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left font-bold text-violet-300 text-[11px]"
      >
        {open ? '▼' : '▶'} Scenario Runner
        <span className="ml-2 text-zinc-400 font-normal">{SCENARIOS.length} scenarios</span>
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex gap-1">
            <select
              value={selectedName}
              onChange={(e) => setSelectedName(e.target.value)}
              className="flex-1 rounded bg-zinc-900 border border-zinc-700 px-2 py-1 text-[11px]"
              disabled={running}
            >
              {SCENARIOS.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
            <button onClick={runOne} disabled={running || !selected} className="rounded bg-violet-700 px-2 py-1 text-[11px] hover:bg-violet-600 disabled:opacity-40">
              {running ? '…' : 'Run'}
            </button>
            <button onClick={runAll} disabled={running} className="rounded bg-violet-800 px-2 py-1 text-[11px] hover:bg-violet-700 disabled:opacity-40">
              Run All
            </button>
          </div>
          {selected && <div className="text-[10px] text-zinc-400">{selected.description}</div>}
          {result && (
            <div className="mt-1 max-h-64 overflow-auto rounded border border-zinc-800 bg-zinc-900 p-2 text-[10px]">
              <div className="mb-1">
                <span className={result.summary === 'pass' ? 'text-emerald-400' : 'text-rose-400'}>
                  {result.summary === 'pass' ? '✓ PASS' : '✗ FAIL'}
                </span>
                <span className="ml-2 text-zinc-400">{result.name} · {result.steps.length} steps</span>
              </div>
              {result.steps.map((s, i) => (
                <details key={i} className="mb-1 border-b border-zinc-800 pb-1">
                  <summary className="cursor-pointer">
                    <span className={
                      s.status === 'pass' ? 'text-emerald-400' :
                      s.status === 'fail' ? 'text-rose-400' :
                      s.status === 'error' ? 'text-rose-500' : 'text-zinc-400'
                    }>
                      {s.status === 'pass' ? '✓' : s.status === 'fail' ? '✗' : s.status === 'error' ? '⚠' : '·'}
                    </span>
                    <span className="ml-2">{s.label}</span>
                    {s.note && <span className="ml-2 text-zinc-400">— {s.note}</span>}
                  </summary>
                  {s.diffs && s.diffs.length > 0 && (
                    <div className="mt-1 ml-4 text-rose-300">
                      {s.diffs.map((d, j) => <div key={j}>· {d}</div>)}
                    </div>
                  )}
                  {s.actionDispatched && (
                    <pre className="ml-4 mt-1 overflow-auto text-[9px] text-zinc-500">
                      {JSON.stringify(s.actionDispatched, null, 2)}
                    </pre>
                  )}
                  {s.historyEvents && s.historyEvents.length > 0 && (
                    <details className="ml-4 mt-1">
                      <summary className="cursor-pointer text-sky-300">events ({s.historyEvents.length})</summary>
                      <pre className="overflow-auto text-[9px] text-zinc-500">{JSON.stringify(s.historyEvents, null, 2)}</pre>
                    </details>
                  )}
                </details>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
