// OnlinePlayfield — fresh layout that renders the server-projected
// `PublicGameState` for the lobby view (Phase F-7d.2; rewritten under
// F-7k BUG-009 for human playability).
//
// Hidden-info contract: this component reads only what
// `projectionToBoard` exposes. Opp hand is rendered as card backs
// only; opp face-down life as card backs; opp deck as a count.
//
// BUG-009 changes — UI-only; no engine/server contracts touched:
//   1. Pending-window banner (block / counter / trigger / discard /
//      peek / choose / target-pick) — when `state.pending !== null` or
//      `phase` is a reactive window, a HUGE banner sits above the
//      action panel so the human cannot miss the response window.
//   2. Grouped action panel — legal actions are bucketed by
//      `actionGroup(...)` and rendered under labeled sections
//      (Blocker Response / Counter Response / Trigger Response /
//      Discard / Choose / Card Effects / Play Events / Play
//      Characters / Play Stage / Attack / Attach DON / Turn / Concede)
//      so the player can find them by phase context.
//   3. Stable field slots — fields render as fixed 5-slot rows with
//      empty placeholders; KO'ing a card no longer shifts surviving
//      cards across the row.
//
// Buttons submit the EXACT server-supplied action object via
// `useOnlineMatch.sendAction`. No client-side legality, no synth.

import { useMemo } from 'react';
import type { Action } from '@shared/engine-v2/protocol/actions';
import type { OnlineBoardViewModel } from './projectionToBoard';
import { useOnlineMatch } from './useOnlineMatch';
import {
  actionGroup,
  actionResolvesCleanly,
  labelAction,
  type ActionGroup,
} from './labelAction';

interface OnlinePlayfieldProps {
  readonly board: OnlineBoardViewModel;
  /** Whether the connected match is currently in 'connected' phase. */
  readonly connected: boolean;
}

const FIELD_CAP = 5;

const PENDING_PHASES: ReadonlyArray<string> = [
  'block_window',
  'counter_window',
  'trigger_window',
  'discard_choice',
  'peek_choice',
  'choose_one',
  'attack_target_pick',
];

const PHASE_BANNER: Record<
  string,
  { title: string; subtitle: string; tone: 'response' | 'attack' | 'info' }
> = {
  block_window: {
    title: 'BLOCK STEP',
    subtitle: 'Choose a blocker or skip',
    tone: 'response',
  },
  counter_window: {
    title: 'COUNTER STEP',
    subtitle: 'Play a counter or skip',
    tone: 'response',
  },
  trigger_window: {
    title: 'TRIGGER STEP',
    subtitle: 'Activate the trigger or decline',
    tone: 'response',
  },
  discard_choice: {
    title: 'DISCARD REQUIRED',
    subtitle: 'Pick a card to discard',
    tone: 'response',
  },
  peek_choice: {
    title: 'PEEK CHOICE',
    subtitle: 'Pick what to keep',
    tone: 'response',
  },
  choose_one: {
    title: 'CHOOSE ONE',
    subtitle: 'Pick an option to resolve',
    tone: 'response',
  },
  attack_target_pick: {
    title: 'PICK ATTACK TARGET',
    subtitle: 'Choose a target',
    tone: 'response',
  },
};

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

  const pendingKind =
    typeof (board.pending as { kind?: unknown } | null)?.kind === 'string'
      ? ((board.pending as { kind: string }).kind ?? null)
      : null;
  const pendingControllerSide: 'A' | 'B' | null = (() => {
    const p = board.pending as
      | { kind?: string; pendingDiscard?: { controller?: 'A' | 'B' }; pendingTrigger?: { controller?: 'A' | 'B' }; pendingChoose?: { controller?: 'A' | 'B' }; pendingPeek?: { controller?: 'A' | 'B' }; pendingTargetPick?: { controller?: 'A' | 'B' } }
      | null;
    if (p === null) return null;
    return (
      p.pendingDiscard?.controller ??
      p.pendingTrigger?.controller ??
      p.pendingChoose?.controller ??
      p.pendingPeek?.controller ??
      p.pendingTargetPick?.controller ??
      null
    );
  })();
  const phaseBanner = PHASE_BANNER[board.phase];
  const responseNeededForYou =
    phaseBanner !== undefined &&
    phaseBanner.tone === 'response' &&
    (pendingControllerSide === null
      ? // block_window + counter_window have no controller field — defender
        // is the non-active player.
        board.activePlayer !== youSide
      : pendingControllerSide === youSide);

  return (
    <div style={shellStyle} data-testid="online-playfield-root">
      <h2 style={{ margin: 0, fontSize: '1rem' }}>Online playfield</h2>

      {/* Status strip */}
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

      {/* BUG-009 — pending-window banner. Big, obvious, top of frame. */}
      {phaseBanner !== undefined && !isOver && (
        <PendingBanner
          phaseKey={board.phase}
          title={phaseBanner.title}
          subtitle={phaseBanner.subtitle}
          needsResponseFromYou={responseNeededForYou}
          waitingFor={
            responseNeededForYou
              ? 'You'
              : pendingControllerSide ?? (board.activePlayer === youSide ? oppSide : youSide)
          }
        />
      )}

      <SidePanel
        title={`Opponent (Player ${oppSide})`}
        side={opp}
        viewerSide={youSide}
        testIdPrefix="opp"
      />
      <SidePanel
        title={`You (Player ${youSide})`}
        side={you}
        viewerSide={youSide}
        testIdPrefix="you"
      />

      <div style={controlsStyle}>
        <button
          type="button"
          onClick={() => requestSnapshot()}
          disabled={!connected}
          style={btnSecondary}
        >
          Request Snapshot
        </button>
        {/* Legacy CONCEDE shortcut — existing F-7h spec locates this
            button via `data-testid="online-concede"`. The Concede
            action is ALSO surfaced under the Concede group in the
            grouped action panel (with `data-testid="online-action-N"`)
            so action-type dumps still see it. */}
        <button
          type="button"
          onClick={() => sendAction({ type: 'CONCEDE' })}
          disabled={!connected || isOver}
          style={btnSecondary}
          data-testid="online-concede"
        >
          Concede
        </button>
      </div>

      {currentLegalActions.length > 0 && (
        <GroupedActions
          actions={currentLegalActions}
          connected={connected}
          pendingKind={pendingKind}
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
// Pending-window banner
// ─────────────────────────────────────────────────────────────────────

function PendingBanner({
  phaseKey,
  title,
  subtitle,
  needsResponseFromYou,
  waitingFor,
}: {
  readonly phaseKey: string;
  readonly title: string;
  readonly subtitle: string;
  readonly needsResponseFromYou: boolean;
  readonly waitingFor: string;
}) {
  return (
    <div
      data-testid="online-pending-banner"
      data-pending-phase={phaseKey}
      data-needs-response={needsResponseFromYou ? 'you' : 'opp'}
      style={{
        marginTop: '0.75rem',
        padding: '0.65rem 0.85rem',
        background: needsResponseFromYou ? '#572a17' : '#1f3447',
        border: `2px solid ${needsResponseFromYou ? '#f5a25d' : '#5b8fbe'}`,
        borderRadius: '6px',
        color: '#F8EED8',
        fontWeight: 700,
      }}
    >
      <div style={{ fontSize: '1rem', letterSpacing: '0.04em' }}>
        {needsResponseFromYou ? '⚡ YOUR RESPONSE ' : '⏳ '}
        {title}
      </div>
      <div style={{ fontSize: '0.8rem', fontWeight: 500, opacity: 0.9, marginTop: '0.15rem' }}>
        {subtitle}
        {' · '}
        <span data-testid="online-pending-waiting">waiting for {waitingFor}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Grouped action panel
// ─────────────────────────────────────────────────────────────────────

const MAX_VISIBLE_PER_GROUP = 24;

function GroupedActions({
  actions,
  connected,
  pendingKind,
}: {
  readonly actions: ReadonlyArray<Action>;
  readonly connected: boolean;
  readonly pendingKind: string | null;
}) {
  const sendAction = useOnlineMatch((s) => s.sendAction);
  const fullState = useOnlineMatch((s) => s.currentState);

  // Build groups. Each group entry preserves its global index into
  // `actions` so `online-action-N` testIds remain stable for browser
  // specs. The render order of groups is dictated by the MINIMUM
  // global index within each group, so DOM iteration order matches
  // the engine's legality enumeration order (and matches the
  // legacy flat-list contract that specs encode).
  const orderedGroups = useMemo(() => {
    if (fullState === null) return [] as Array<{ group: ActionGroup; entries: Array<{ global: number; action: Action }> }>;
    const m = new Map<ActionGroup, Array<{ global: number; action: Action }>>();
    actions.forEach((a, i) => {
      const g = actionGroup(a, fullState);
      const arr = m.get(g);
      if (arr === undefined) m.set(g, [{ global: i, action: a }]);
      else arr.push({ global: i, action: a });
    });
    const out: Array<{ group: ActionGroup; entries: Array<{ global: number; action: Action }> }> = [];
    for (const [group, entries] of m) {
      entries.sort((a, b) => a.global - b.global);
      out.push({ group, entries });
    }
    out.sort((a, b) => a.entries[0]!.global - b.entries[0]!.global);
    return out;
  }, [actions, fullState]);

  if (fullState === null) return null;

  // Promote response groups to the top when a pending kind is active —
  // the order in ACTION_GROUP_ORDER already does this, but we also
  // visually highlight the relevant group.
  const highlightGroup: ActionGroup | null = (() => {
    if (pendingKind === 'attack') return 'Blocker Response'; // block_window
    if (pendingKind === 'trigger') return 'Trigger Response';
    if (pendingKind === 'discard') return 'Discard';
    if (pendingKind === 'peek') return 'Choose';
    if (pendingKind === 'choose_one') return 'Choose';
    if (pendingKind === 'attack_target_pick') return 'Choose';
    return null;
  })();

  return (
    <div style={panelStyle}>
      <div style={{ fontWeight: 600, marginBottom: '0.45rem', fontSize: '0.85rem' }}>
        Available actions ({actions.length})
      </div>
      {orderedGroups.map(({ group, entries }) => {
        const visible = entries.slice(0, MAX_VISIBLE_PER_GROUP);
        const hiddenCount = entries.length - visible.length;
        const isHighlighted = highlightGroup === group;
        return (
          <div
            key={group}
            data-testid={`online-group-${group.replace(/\s+/g, '-')}`}
            style={{
              ...groupBlockStyle,
              border: `1px solid ${isHighlighted ? '#f5a25d' : '#443'}`,
              background: isHighlighted ? '#2c2218' : '#15140F',
            }}
          >
            <div style={groupHeaderStyle}>
              {group}{' '}
              <span style={{ opacity: 0.55, fontWeight: 400 }}>
                ({entries.length})
              </span>
            </div>
            <div style={buttonRowStyle}>
              {visible.map(({ global, action }) => {
                const label = labelAction(action, fullState);
                const clean = actionResolvesCleanly(action, fullState);
                return (
                  <button
                    key={`${group}-${global}`}
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
                    data-testid={`online-action-${global}`}
                    data-action-type={action.type}
                    data-action-group={group}
                    data-action-index={String(global)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {hiddenCount > 0 && (
              <div style={{ marginTop: '0.25rem', fontSize: '0.7rem', opacity: 0.6 }}>
                {hiddenCount} more action(s) hidden (cap = {MAX_VISIBLE_PER_GROUP})
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Side panels — stable-slot field rendering (BUG-009 issue 6)
// ─────────────────────────────────────────────────────────────────────

function SidePanel({
  title,
  side,
  viewerSide,
  testIdPrefix,
}: {
  readonly title: string;
  readonly side: import('./projectionToBoard').OnlineSideView;
  readonly viewerSide: import('@shared/engine-v2/state/types').PlayerId;
  readonly testIdPrefix: string;
}) {
  const isOpp = side.side !== viewerSide;
  // Field is rendered as FIELD_CAP fixed slots. Empty slots stay in
  // place when a card is KO'd, so surviving cards don't shift across
  // the row (BUG-009 issue 6).
  const slots = new Array(FIELD_CAP).fill(null) as Array<
    import('./projectionToBoard').OnlineCardView | null
  >;
  for (let i = 0; i < Math.min(side.field.length, FIELD_CAP); i += 1) {
    slots[i] = side.field[i]!;
  }

  return (
    <div style={sidePanelStyle}>
      <div style={{ fontWeight: 600, marginBottom: '0.35rem' }}>{title}</div>
      <Row label="leader">
        {`${side.leader.name} (${side.leader.cardId})`}
        {side.leader.rested ? ' [rested]' : ''}
      </Row>

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
        <div
          data-testid={`${testIdPrefix}-field-slots`}
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${FIELD_CAP}, 1fr)`,
            gap: '0.25rem',
            width: '100%',
          }}
        >
          {slots.map((s, i) => (
            <div
              key={i}
              data-testid={`${testIdPrefix}-field-slot-${i}`}
              data-slot-occupied={s !== null ? 'true' : 'false'}
              style={{
                minHeight: '36px',
                padding: '4px 6px',
                fontSize: '0.7rem',
                border: '1px dashed #443',
                borderRadius: '4px',
                background: s !== null ? '#23211a' : 'transparent',
                opacity: s !== null ? 1 : 0.35,
                wordBreak: 'break-word',
              }}
              title={s !== null ? `${s.name} (${s.cardId})` : 'empty slot'}
            >
              {s !== null ? (
                <>
                  {s.name}
                  {s.rested ? ' [rested]' : ''}
                  {s.summoningSick ? ' [sleep]' : ''}
                </>
              ) : (
                '—'
              )}
            </div>
          ))}
        </div>
      </Row>

      <Row label="stage">{side.stage ? side.stage.name : '—'}</Row>

      <Row label="don">
        ready {side.don.ready} · rested {side.don.rested} · deck {side.don.deck}
      </Row>

      <Row label="trash">
        <span data-testid={`${testIdPrefix}-trash-count`}>{side.trash.count}</span>
      </Row>

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
// Pending pseudo-banner is the only PENDING_PHASES consumer in this
// file; reference it so unused-import lint doesn't complain.
// ─────────────────────────────────────────────────────────────────────
void PENDING_PHASES;

// ─────────────────────────────────────────────────────────────────────
// Styles (inline — functional, not polished)
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

const panelStyle: React.CSSProperties = {
  marginTop: '0.75rem',
  padding: '0.5rem',
  background: '#15140F',
  borderRadius: '4px',
};

const groupBlockStyle: React.CSSProperties = {
  padding: '0.4rem 0.45rem',
  borderRadius: '4px',
  marginTop: '0.35rem',
};

const groupHeaderStyle: React.CSSProperties = {
  fontWeight: 600,
  marginBottom: '0.25rem',
  fontSize: '0.78rem',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
};

const buttonRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.3rem',
};

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
