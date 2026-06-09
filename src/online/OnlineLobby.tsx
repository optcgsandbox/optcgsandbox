// Online lobby — minimal functional UI.
//
// Not polished. Submit deck → see status → reach WS or wall. Mounted
// from `src/App.tsx` when `?online=1` is present in the URL.

import { useEffect, useMemo, useRef, useState } from 'react';

import { useOnlineMatch } from './useOnlineMatch';
import type { DeckColor } from './buildDeck';
import OnlinePlayfield from './OnlinePlayfield';
import { projectionToBoard } from './projectionToBoard';

const COLOR_OPTIONS: DeckColor[] = ['red', 'green', 'blue', 'purple', 'black', 'yellow'];

export default function OnlineLobby() {
  const {
    phase,
    sessionId,
    color,
    queueLen,
    paired,
    errorReason,
    lastServerMessage,
    currentState,
    setSessionId,
    setColor,
    findMatch,
    disconnect,
  } = useOnlineMatch();

  const board = useMemo(
    () =>
      currentState !== null && paired !== null
        ? projectionToBoard(currentState, paired.you)
        : null,
    [currentState, paired],
  );

  // Force-rerender every second while connected so message-time displays update.
  const [, setNow] = useState(0);
  const tickRef = useRef<number | null>(null);
  useEffect(() => {
    if (phase === 'connected' || phase === 'queued') {
      tickRef.current = window.setInterval(() => setNow((x) => x + 1), 1000);
      return () => {
        if (tickRef.current !== null) window.clearInterval(tickRef.current);
      };
    }
    return undefined;
  }, [phase]);

  return (
    <div
      style={{
        minHeight: '100dvh',
        background: '#15140F',
        color: '#F2E8D2',
        padding: '20px',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      }}
    >
      <div style={{ maxWidth: '480px', margin: '0 auto' }} data-testid="online-lobby-root">
        <h1 style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>
          OPTCGSandbox · Online Lobby
        </h1>
        <p style={{ opacity: 0.7, fontSize: '0.85rem', marginTop: 0 }}>
          F-7b functional smoke. Dev identity (`dev:&lt;sessionId&gt;`).
        </p>

        <section style={panelStyle}>
          <Row label="phase">
            <span data-testid="online-phase">{phase}</span>
          </Row>
          <Row label="sessionId">
            <input
              type="text"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              disabled={phase !== 'idle' && phase !== 'error'}
              style={inputStyle}
              data-testid="online-session-id"
            />
          </Row>
          <Row label="color">
            <select
              value={color}
              onChange={(e) => setColor(e.target.value as DeckColor)}
              disabled={phase !== 'idle' && phase !== 'error'}
              style={inputStyle}
              data-testid="online-color-select"
            >
              {COLOR_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Row>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
            <button
              type="button"
              onClick={() => void findMatch()}
              disabled={phase !== 'idle' && phase !== 'error'}
              style={btnPrimary}
              data-testid="online-find-match"
            >
              Find Match
            </button>
            <button type="button" onClick={() => disconnect()} style={btnSecondary}>
              Reset
            </button>
          </div>
        </section>

        {phase === 'queued' && (
          <section style={panelStyle}>
            <Row label="status">QUEUED</Row>
            <Row label="queueLen">{String(queueLen)}</Row>
            <p style={{ opacity: 0.7, fontSize: '0.85rem' }}>
              Polling every 2s. Open a second tab + Find Match to pair.
            </p>
          </section>
        )}

        {paired && (phase === 'paired' || phase === 'connecting' || phase === 'connected') && (
          <section style={panelStyle}>
            <Row label="status">PAIRED · you are Player {paired.you}</Row>
            <Row label="roomId">{paired.roomId.slice(0, 16)}…</Row>
            <Row label="leader A">{paired.leaderA.name}</Row>
            <Row label="leader B">{paired.leaderB.name}</Row>
            <Row label="ws phase">{phase}</Row>
          </section>
        )}

        {lastServerMessage && (
          <section style={panelStyle}>
            <Row label="last server msg">{lastServerMessage.type}</Row>
          </section>
        )}

        {/* F-7d.2: full server-projected playfield rendered via OnlinePlayfield. */}
        {board && (
          <OnlinePlayfield board={board} connected={phase === 'connected'} />
        )}

        {phase === 'error' && errorReason && (
          <section style={{ ...panelStyle, borderColor: '#a33' }}>
            <Row label="status">ERROR</Row>
            <pre style={{ ...preStyle, color: '#fcc' }}>{errorReason}</pre>
          </section>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Inline styles (intentional — F-7b is functional, not polished)
// ────────────────────────────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  marginTop: '1rem',
  padding: '0.75rem',
  border: '1px solid #443',
  borderRadius: '6px',
  background: '#222019',
};

const inputStyle: React.CSSProperties = {
  background: '#15140F',
  color: '#F2E8D2',
  border: '1px solid #443',
  borderRadius: '4px',
  padding: '4px 6px',
  fontSize: '0.85rem',
  minWidth: '180px',
};

const btnPrimary: React.CSSProperties = {
  background: '#B98038',
  color: '#15140F',
  border: 'none',
  borderRadius: '4px',
  padding: '6px 12px',
  cursor: 'pointer',
  fontSize: '0.9rem',
  fontWeight: 600,
};

const btnSecondary: React.CSSProperties = {
  ...btnPrimary,
  background: '#443',
  color: '#F2E8D2',
};

const preStyle: React.CSSProperties = {
  margin: 0,
  padding: '0.5rem',
  background: '#15140F',
  borderRadius: '4px',
  fontSize: '0.75rem',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: '0.5rem',
        alignItems: 'center',
        marginBottom: '0.35rem',
        fontSize: '0.85rem',
      }}
    >
      <span style={{ minWidth: '120px', opacity: 0.65 }}>{label}</span>
      <span style={{ flex: 1 }}>{children}</span>
    </div>
  );
}
