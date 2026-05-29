import { useState } from 'react';
import { useGameStore } from './store/game';
import { PlayerSide } from './components/PlayerSide';

export default function App() {
  const state = useGameStore((s) => s.state);
  const legalActions = useGameStore((s) => s.legalActions);
  const dispatch = useGameStore((s) => s.dispatch);
  const endTurnAndAdvance = useGameStore((s) => s.endTurnAndAdvance);
  const reset = useGameStore((s) => s.reset);

  const [attachDonMode, setAttachDonMode] = useState(false);
  const active = state.activePlayer;
  const inactive = active === 'A' ? 'B' : 'A';

  const onCardInHandTap = (instanceId: string) => {
    dispatch({ type: 'PLAY_CARD', instanceId, replaceTargetId: null });
  };
  const onAttachDonTap = (targetInstanceId: string) => {
    dispatch({ type: 'ATTACH_DON', targetInstanceId });
  };

  const canAttack = legalActions.some((a) => a.type === 'DECLARE_ATTACK');
  const onAttackLeader = () => {
    const attack = legalActions.find(
      (a) => a.type === 'DECLARE_ATTACK'
    );
    if (attack) dispatch(attack);
  };

  if (state.result) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-paper-cream p-6 text-ink-black gap-4">
        <h1 className="text-3xl font-bold">Game over</h1>
        <p>Winner: {state.result.winner} · {state.result.reason}</p>
        <button
          className="border border-ink-black px-4 py-2 rounded"
          onClick={() => reset()}
        >
          New game
        </button>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-paper-cream text-ink-black p-3 flex flex-col gap-3">
      <header className="flex items-center justify-between border-b border-ink-black/20 pb-2">
        <div>
          <h1 className="text-lg font-bold tracking-tight">OPTCGSandbox</h1>
          <p className="text-[10px] uppercase tracking-widest text-ink-iron">
            T{state.turn} · {state.phase} · Active: {active}
          </p>
        </div>
        <button
          className="text-[10px] uppercase tracking-widest border border-ink-black/40 px-2 py-1 rounded"
          onClick={() => reset()}
        >
          Reset
        </button>
      </header>

      {/* Opponent (top) */}
      <PlayerSide
        state={state}
        playerId={inactive}
        isYou={false}
        showHand={false}
        attachDonMode={false}
      />

      {/* Action bar */}
      <div className="flex flex-wrap gap-2 text-[11px]">
        <button
          className={`border px-3 py-1 rounded ${attachDonMode ? 'bg-brass-canary' : 'border-ink-black/60'}`}
          onClick={() => setAttachDonMode((v) => !v)}
          disabled={state.players[active].donActive <= 0}
          aria-pressed={attachDonMode}
        >
          {attachDonMode ? 'Cancel attach' : `Attach DON (${state.players[active].donActive} avail)`}
        </button>
        <button
          className="border border-ink-black/40 px-3 py-1 rounded disabled:opacity-30"
          onClick={onAttackLeader}
          disabled={!canAttack}
        >
          Attack opponent's leader
        </button>
        <button
          className="border border-seal-red text-seal-red px-3 py-1 rounded"
          onClick={endTurnAndAdvance}
        >
          End turn →
        </button>
      </div>

      {/* You (bottom) */}
      <PlayerSide
        state={state}
        playerId={active}
        isYou={true}
        showHand={true}
        onCardInHandTap={onCardInHandTap}
        onAttachDonTap={onAttachDonTap}
        attachDonMode={attachDonMode}
      />

      <details className="text-[10px] text-ink-iron mt-2">
        <summary className="cursor-pointer">History ({state.history.length})</summary>
        <pre className="whitespace-pre-wrap text-[9px] mt-1 max-h-32 overflow-y-auto">
          {state.history.slice(-20).map((e, i) => (
            <div key={i}>{JSON.stringify(e)}</div>
          ))}
        </pre>
      </details>
    </main>
  );
}
