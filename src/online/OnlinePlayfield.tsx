// OnlinePlayfield — fresh layout that renders the server-projected
// `PublicGameState` for the lobby view (Phase F-7d.2).
//
// Why fresh layout (NOT reusing `src/components/PlayfieldStage.tsx`):
// PlayfieldStage and 17 other game components hard-import
// `useGameStore` (see `src/components/PlayfieldStage.tsx:30,64-77` etc).
// Reusing them would require either refactoring every component's
// store access OR populating `useGameStore` from the online projection
// (which would couple online + local engine state). F-7d.2 chooses the
// parallel-renderer path to stay strictly read-only and decoupled.
//
// Hidden-info contract: this component reads only what
// `projectionToBoard` exposes. Opp hand is rendered as card backs
// only; opp face-down life as card backs; opp deck as a count.

import type { OnlineBoardViewModel } from './projectionToBoard';
import { useOnlineMatch } from './useOnlineMatch';
import { actionResolvesCleanly, labelAction } from './labelAction';

interface OnlinePlayfieldProps {
  readonly board: OnlineBoardViewModel;
  /** Whether the connected match is currently in 'connected' phase. */
  readonly connected: boolean;
}

export default function OnlinePlayfield({
  board,
  connected,
}: OnlinePlayfieldProps) {
  const sendAction = useOnlineMatch((s) => s.sendAction);
  const requestSnapshot = useOnlineMatch((s) => s.requestSnapshot);
  const lastActionResult = useOnlineMatch((s) => s.lastActionResult);
  const currentHash = useOnlineMatch((s) => s.currentHash);
  const serverSeq = useOnlineMatch((s) => s.serverSeq);
  const currentLegalActions = useOnlineMatch((s) => s.currentLegalActions);

  const youSide = board.viewer;
  const oppSide = youSide === 'A' ? 'B' : 'A';
  const you = board.sides[youSide];
  const opp = board.sides[oppSide];
  const isOver = board.result !== null;

  return (
    <div style={shellStyle} data-testid="online-playfield-root">
      <h2 style={{ margin: 0, fontSize: '1rem' }}>Online playfield</h2>

      <Row label="viewer">
        {`${board.viewer}`} {isOver ? '· match over' : ''}
      </Row>
      <Row label="phase / turn">
        <span data-testid="online-board-phase">{board.phase}</span> · turn {board.turn}
      </Row>
      <Row label="active">
        <span data-testid="online-active-player">{board.activePlayer}</span>
      </Row>
      <Row label="firstPlayer">{board.firstPlayer}</Row>
      <Row label="serverSeq">{String(serverSeq)}</Row>
      <Row label="hash">{(currentHash ?? '').slice(0, 16) || '—'}</Row>
      <Row label="result">
        <span data-testid="online-match-result">{formatResult(board.result)}</span>
      </Row>
      <Row label="legalActions">
        <span data-testid="online-legal-actions-count">{currentLegalActions.length}</span>
        {' available'}
      </Row>

      <SidePanel
        title={`Opponent (Player ${oppSide})`}
        side={opp}
        viewerSide={youSide}
      />
      <SidePanel
        title={`You (Player ${youSide})`}
        side={you}
        viewerSide={youSide}
      />

      <div style={controlsStyle}>
        <button
          type="button"
          onClick={() => sendAction({ type: 'CONCEDE' })}
          disabled={!connected || isOver}
          style={btnSecondary}
          title="CONCEDE is always-legal per MatchSession.validateLegalAction. Always available while the match is live."
          data-testid="online-concede"
        >
          Concede
        </button>
        <button
          type="button"
          onClick={() => sendAction({ type: 'END_TURN' })}
          disabled={!connected || isOver}
          style={btnSecondary}
          title="Attempts END_TURN. Server rejects with action_rejected if not currently legal — that's the F-7d.2 'send first attempt, server decides' pattern."
        >
          Attempt End Turn
        </button>
        <button
          type="button"
          onClick={() => requestSnapshot()}
          disabled={!connected}
          style={btnSecondary}
        >
          Request Snapshot
        </button>
      </div>

      {currentLegalActions.length > 0 && (
        <AvailableActions
          actions={currentLegalActions}
          state={board}
          connected={connected}
        />
      )}

      {lastActionResult !== null && (
        <Row label="last action">
          <span data-testid="online-last-action">
            {lastActionResult.kind === 'accepted'
              ? `accepted (clientSeq=${lastActionResult.clientSeq}, serverSeq=${lastActionResult.serverSeq})`
              : `rejected (clientSeq=${lastActionResult.clientSeq}): ${lastActionResult.reason}`}
          </span>
        </Row>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Available actions — clickable buttons, F-7e.2
// ─────────────────────────────────────────────────────────────────────

const MAX_VISIBLE_ACTIONS = 30;

function AvailableActions({
  actions,
  state: board,
  connected,
}: {
  readonly actions: ReadonlyArray<import('@shared/engine-v2/protocol/actions').Action>;
  readonly state: OnlineBoardViewModel;
  readonly connected: boolean;
}) {
  const sendAction = useOnlineMatch((s) => s.sendAction);
  const fullState = useOnlineMatch((s) => s.currentState);
  if (fullState === null) return null;

  const visible = actions.slice(0, MAX_VISIBLE_ACTIONS);
  const hiddenCount = actions.length - visible.length;
  void board;

  return (
    <div
      style={{
        marginTop: '0.75rem',
        padding: '0.5rem',
        background: '#15140F',
        borderRadius: '4px',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: '0.35rem', fontSize: '0.85rem' }}>
        Available actions ({actions.length})
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.35rem',
        }}
      >
        {visible.map((action, i) => {
          const label = labelAction(action, fullState);
          const clean = actionResolvesCleanly(action, fullState);
          return (
            <button
              key={`${action.type}-${i}`}
              type="button"
              onClick={() => sendAction(action)}
              disabled={!connected}
              style={{
                ...actionBtnStyle,
                opacity: clean ? 1 : 0.7,
                fontStyle: clean ? 'normal' : 'italic',
              }}
              title={
                clean
                  ? action.type
                  : `${action.type} — some instanceIds unresolved against the projection`
              }
              data-testid={`online-action-${i}`}
              data-action-type={action.type}
            >
              {label}
            </button>
          );
        })}
      </div>
      {hiddenCount > 0 && (
        <div
          style={{
            marginTop: '0.35rem',
            fontSize: '0.75rem',
            opacity: 0.6,
          }}
        >
          {hiddenCount} more action(s) hidden (cap = {MAX_VISIBLE_ACTIONS})
        </div>
      )}
    </div>
  );
}

const actionBtnStyle: React.CSSProperties = {
  background: '#2b2a23',
  color: '#F2E8D2',
  border: '1px solid #443',
  borderRadius: '4px',
  padding: '4px 8px',
  cursor: 'pointer',
  fontSize: '0.75rem',
  textAlign: 'left',
};

// ─────────────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────────────

function SidePanel({
  title,
  side,
  viewerSide,
}: {
  readonly title: string;
  readonly side: import('./projectionToBoard').OnlineSideView;
  readonly viewerSide: import('@shared/engine-v2/state/types').PlayerId;
}) {
  const isOpp = side.side !== viewerSide;

  return (
    <div style={sidePanelStyle}>
      <div style={{ fontWeight: 600, marginBottom: '0.35rem' }}>{title}</div>
      <Row label="leader">{`${side.leader.name} (${side.leader.cardId})`}</Row>

      <Row label="hand">
        {side.hand.kind === 'visible'
          ? `${side.hand.cards.length} · ${side.hand.cards
              .map((c) => c.cardId)
              .join(', ')}`
          : `${side.hand.count} · 🂠 (hidden)`}
      </Row>

      <Row label="deck">
        {side.deck.count} · {side.deck.hidden ? '🂠 (hidden)' : 'own'}
      </Row>

      <Row label="life">
        {side.life.total} · 🂠×{side.life.faceDownCount}
        {side.life.faceUp.length > 0
          ? ` + face-up: ${side.life.faceUp.map((c) => c.cardId).join(', ')}`
          : ''}
      </Row>

      <Row label="field">
        {side.field.length === 0
          ? '— (empty)'
          : side.field
              .map((c) => `${c.name}${c.rested ? ' [rested]' : ''}`)
              .join(', ')}
      </Row>

      <Row label="stage">{side.stage ? side.stage.name : '—'}</Row>

      <Row label="don">
        ready {side.don.ready} · rested {side.don.rested} · deck {side.don.deck}
      </Row>

      <Row label="trash">{side.trash.count}</Row>

      {isOpp && (
        <div style={{ fontSize: '0.7rem', opacity: 0.5, marginTop: '0.25rem' }}>
          (opponent: hand / deck / face-down life are server-redacted before
          arrival)
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: '0.5rem',
        alignItems: 'flex-start',
        marginBottom: '0.25rem',
        fontSize: '0.85rem',
      }}
    >
      <span style={{ minWidth: '110px', opacity: 0.65 }}>{label}</span>
      <span style={{ flex: 1, wordBreak: 'break-word' }}>{children}</span>
    </div>
  );
}

function formatResult(r: unknown): string {
  if (r === null || r === undefined) return '—';
  const o = r as { loser?: string; reason?: string };
  if (typeof o.loser !== 'string') return JSON.stringify(r);
  return `loser=${o.loser} reason=${o.reason ?? '?'}`;
}

// ─────────────────────────────────────────────────────────────────────
// Styles (inline — F-7d.2 is functional, not polished)
// ─────────────────────────────────────────────────────────────────────

const shellStyle: React.CSSProperties = {
  marginTop: '1rem',
  padding: '0.75rem',
  border: '1px solid #443',
  borderRadius: '6px',
  background: '#222019',
};

const sidePanelStyle: React.CSSProperties = {
  marginTop: '0.5rem',
  padding: '0.5rem',
  background: '#15140F',
  borderRadius: '4px',
};

const controlsStyle: React.CSSProperties = {
  display: 'flex',
  gap: '0.5rem',
  flexWrap: 'wrap',
  marginTop: '0.75rem',
};

const btnSecondary: React.CSSProperties = {
  background: '#443',
  color: '#F2E8D2',
  border: 'none',
  borderRadius: '4px',
  padding: '6px 12px',
  cursor: 'pointer',
  fontSize: '0.85rem',
  fontWeight: 600,
};
