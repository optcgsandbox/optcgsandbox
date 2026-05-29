// PlayfieldStage — design-reference.md §2 + §7 + §10.
//
// Official Bandai-aligned playmat for the 430px portrait phone frame. Layout
// follows the playsheet's two-player mirror (design-reference §2):
//
//   ┌──┬─────────────────────────────────────────────┐
//   │L │ DonDeck │ CostArea │ Trash                  │  ← opp far row
//   │I │ Phase │ Leader │ Stage │ Deck                │  ← opp leader row
//   │F │ ── Character Area (5 slots) ────────────────│  ← opp chars (closest to contact)
//   │E │═══════════════ CONTACT ZONE ═══════════════ │  ← attacks cross here
//   │  │ ── Character Area (5 slots) ────────────────│  ← your chars (closest to contact)
//   │c │ Phase │ Leader │ Stage │ Deck                │  ← your leader row
//   │ol│ DonDeck │ CostArea │ Trash                  │  ← your far row
//   └──┴─────────────────────────────────────────────┘
//                                              [HAND]
//
// The playmat surface is CREAM PAPER (cream `.paper-playmat`) — not felt.
// Tap-outside-card on the surface clears inspectedCardId AND deselects any
// pending attacker.

import { memo, useCallback } from 'react';
import { LayoutGroup } from 'framer-motion';
import { useGameStore } from '../store/game';
import { useDonArm } from '../store/donArm';
import { CardArt } from './CardArt';
import { ZoneSlot } from './ZoneSlot';
import { HandFan } from './HandFan';
import { CardDetailModal } from './CardDetailModal';
import { AttackResolutionOverlay } from './AttackResolutionOverlay';
import { TriggerPrompt } from './TriggerPrompt';
import { LifeRevealOverlay } from './LifeRevealOverlay';
import { EventCardOverlay } from './EventCardOverlay';
import { LifeStack } from './zones/LifeStack';
import { StageSlot } from './zones/StageSlot';
import { DeckSlot } from './zones/DeckSlot';
import { TrashSlot } from './zones/TrashSlot';
import { DonDeckSlot } from './zones/DonDeckSlot';
import { CostAreaBand } from './zones/CostAreaBand';
import { PhaseColumn } from './zones/PhaseColumn';
import type { CardInstance, PlayerId, PlayerZones } from '@shared/engine/GameState';
import type { Card } from '@shared/engine/cards/Card';

// ─────────────────────────────────────────────────────────────────────────────
// Hooks: legal-action lookups for tap-routing affordances.
// ─────────────────────────────────────────────────────────────────────────────

/** Returns the set of instance IDs that are legal DECLARE_ATTACK targets for
 *  the currently-selected attacker (or empty set if no attacker selected). */
function useLegalAttackTargets(): Set<string> {
  const selectedAttackerId = useGameStore((s) => s.selectedAttackerId);
  const legalActions = useGameStore((s) => s.legalActions);
  if (!selectedAttackerId) return new Set();
  const out = new Set<string>();
  for (const a of legalActions) {
    if (a.type === 'DECLARE_ATTACK' && a.attackerInstanceId === selectedAttackerId) {
      out.add(a.targetInstanceId);
    }
  }
  return out;
}

// useAttackerCandidates removed 2026-05-29 — attacker selection now flows
// through the CardDetailModal (tap field card → see options → SELECT AS ATTACKER).

/** Returns the set of friendly instance IDs that are legal ATTACH_DON targets. */
function useDonAttachCandidates(): Set<string> {
  const legalActions = useGameStore((s) => s.legalActions);
  const out = new Set<string>();
  for (const a of legalActions) {
    if (a.type === 'ATTACH_DON') out.add(a.targetInstanceId);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tap routing for field cards (Leader + Character + Stage).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Owner direction 2026-05-29: tap on ANY field card (friendly OR opponent,
 * leader OR character OR stage) opens the CardDetailModal. Actions
 * (ATTACH DON / SELECT AS ATTACKER / ATTACK THIS) are exposed from inside
 * the modal so the owner can always read the card before committing.
 */
function useFieldTapRouter() {
  const setInspectedCardId = useGameStore((s) => s.setInspectedCardId);
  const setCardDetailOpen = useGameStore((s) => s.setCardDetailOpen);

  return useCallback(
    (instanceId: string, _isFriendly: boolean) => {
      setInspectedCardId(instanceId);
      setCardDetailOpen(true);
    },
    [
      setInspectedCardId,
      setCardDetailOpen,
    ],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-row components.
// ─────────────────────────────────────────────────────────────────────────────

interface HalfProps {
  zones: PlayerZones;
  playerId: PlayerId;
  isYou: boolean;
  leaderCard: Card;
}

function FieldCharacter({
  inst,
  card,
  isFriendly,
  onTap,
}: {
  inst: CardInstance;
  card: Card;
  isFriendly: boolean;
  onTap?: () => void;
}) {
  const selectedAttackerId = useGameStore((s) => s.selectedAttackerId);
  const armedDonId = useDonArm((s) => s.armedDonId);
  const legalAttackTargets = useLegalAttackTargets();
  const donAttachCandidates = useDonAttachCandidates();

  const isSelectedAttacker = selectedAttackerId === inst.instanceId;
  const isPendingTarget =
    !isFriendly && !!selectedAttackerId && legalAttackTargets.has(inst.instanceId);
  const isDonDropTarget =
    isFriendly && !!armedDonId && donAttachCandidates.has(inst.instanceId);

  return (
    <CardArt
      inst={inst}
      card={card}
      size="field"
      onTap={onTap}
      selectedAttacker={isSelectedAttacker}
      pendingTarget={isPendingTarget}
      donDropTarget={isDonDropTarget}
    />
  );
}

/** Row of 5 character slots — design-reference §2. */
function CharacterRow({
  zones,
  playerId,
  isFriendly,
}: {
  zones: PlayerZones;
  playerId: PlayerId;
  isFriendly: boolean;
}) {
  const library = useGameStore((s) => s.state.cardLibrary);
  const tapRouter = useFieldTapRouter();
  const slots: (CardInstance | null)[] = [];
  for (let i = 0; i < 5; i++) slots[i] = zones.field[i] ?? null;
  return (
    <div
      className="grid h-full w-full grid-cols-5 items-center gap-1 px-1"
      role="region"
      aria-label="Character area, 5 slots"
    >
      {slots.map((inst, i) => (
        <ZoneSlot key={`${playerId}-char-${i}`} kind="character" playerId={playerId} index={i}>
          {inst && (
            <FieldCharacter
              inst={inst}
              card={library[inst.cardId]}
              isFriendly={isFriendly}
              onTap={() => tapRouter(inst.instanceId, isFriendly)}
            />
          )}
        </ZoneSlot>
      ))}
    </div>
  );
}

/** Leader row — Phase column / Leader / Stage / Deck. */
function LeaderRow({ zones, playerId, isYou, leaderCard }: HalfProps) {
  const tapRouter = useFieldTapRouter();
  const selectedAttackerId = useGameStore((s) => s.selectedAttackerId);
  const armedDonId = useDonArm((s) => s.armedDonId);
  const legalAttackTargets = useLegalAttackTargets();
  const donAttachCandidates = useDonAttachCandidates();

  const leaderId = zones.leader.instanceId;
  const isSelectedAttacker = selectedAttackerId === leaderId;
  const isPendingTarget =
    !isYou && !!selectedAttackerId && legalAttackTargets.has(leaderId);
  const isDonDropTarget =
    isYou && !!armedDonId && donAttachCandidates.has(leaderId);

  return (
    <div className="flex h-full w-full items-center justify-between gap-1 px-1">
      <PhaseColumn playerId={playerId} isYou={isYou} />
      <div className="flex grow items-center justify-center gap-1.5">
        <ZoneSlot kind="leader" playerId={playerId} ariaLabel={`${leaderCard.name} (leader)`}>
          <div style={{ transform: 'scale(var(--zone-leader-scale, 1.15))' }}>
            <CardArt
              inst={zones.leader}
              card={leaderCard}
              size="leader"
              liveLifeCount={zones.life.length}
              onTap={() => tapRouter(leaderId, isYou)}
              selectedAttacker={isSelectedAttacker}
              pendingTarget={isPendingTarget}
              donDropTarget={isDonDropTarget}
            />
          </div>
        </ZoneSlot>
        <StageSlot playerId={playerId} isYou={isYou} />
        <DeckSlot playerId={playerId} isYou={isYou} />
      </div>
    </div>
  );
}

/** Far row — DonDeck / CostArea / Trash. */
function FarRow({ playerId, isYou }: { playerId: PlayerId; isYou: boolean }) {
  return (
    <div className="flex h-full w-full items-center justify-between gap-1.5 px-1">
      <DonDeckSlot playerId={playerId} isYou={isYou} />
      <div className="flex h-full grow items-center">
        <CostAreaBand playerId={playerId} isYou={isYou} />
      </div>
      <TrashSlot playerId={playerId} isYou={isYou} />
    </div>
  );
}

/**
 * OpponentHalf uses the SAME row order as YourHalf so that when the entire
 * opp section is rotated 180° (per owner direction 2026-05-29 reference image
 * showing two-player playmat with opp's side flipped), the opp's character
 * row visually lands closest to the contact zone — matching the physical
 * Bandai table convention.
 */
// D6 (playmat-redesign §1.3) — explicit dvh budget so the layout doesn't
// drift when the hand strip compresses on smaller phones. After the opp
// half is rotated 180°, its row1 (character, 11dvh) lands at the bottom
// of the opp area (closest to the contact zone), row2 (leader, 12dvh) in
// the middle, row3 (far, 8dvh) at the top of the screen. Your half stays
// upright: character 11dvh (top, closest to contact), leader 12dvh, far
// 8dvh (bottom). Sum each half = 31dvh × 2 + contact 1dvh + chrome 6dvh +
// hand 24dvh = 93dvh, leaving ~7dvh for safe-area compression.
const HALF_GRID_ROWS = '11dvh 12dvh 8dvh';

function OpponentHalf(props: HalfProps) {
  return (
    <div
      className="grid h-full w-full"
      style={{ gridTemplateRows: HALF_GRID_ROWS, rowGap: 'var(--playmat-band-px, 4px)' }}
      role="region"
      aria-label="Opponent half"
    >
      <CharacterRow zones={props.zones} playerId={props.playerId} isFriendly={false} />
      <LeaderRow {...props} />
      <FarRow playerId={props.playerId} isYou={false} />
    </div>
  );
}

function YourHalf(props: HalfProps) {
  return (
    <div
      className="grid h-full w-full"
      style={{ gridTemplateRows: HALF_GRID_ROWS, rowGap: 'var(--playmat-band-px, 4px)' }}
      role="region"
      aria-label="Your half"
    >
      <CharacterRow zones={props.zones} playerId={props.playerId} isFriendly={true} />
      <LeaderRow {...props} />
      <FarRow playerId={props.playerId} isYou={true} />
    </div>
  );
}

/** Contact-zone strip — brass-canary glow line between halves. */
function ContactZone() {
  return (
    <div
      className="relative flex items-center justify-center"
      aria-hidden="true"
      style={{ minHeight: 6 }}
    >
      <div className="h-px w-full bg-brass-canary/70 shadow-[0_0_6px_rgba(232,180,61,0.35)]" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root.
// ─────────────────────────────────────────────────────────────────────────────

export const PlayfieldStage = memo(function PlayfieldStage() {
  const state = useGameStore((s) => s.state);
  const seat = useGameStore((s) => s.viewAs);
  const setInspectedCardId = useGameStore((s) => s.setInspectedCardId);
  const inspectedCardId = useGameStore((s) => s.inspectedCardId);
  const setSelectedAttackerId = useGameStore((s) => s.setSelectedAttackerId);
  const selectedAttackerId = useGameStore((s) => s.selectedAttackerId);
  const disarmDon = useDonArm((s) => s.disarm);
  const armedDonId = useDonArm((s) => s.armedDonId);
  const opponentSeat: PlayerId = seat === 'A' ? 'B' : 'A';

  const you = state.players[seat];
  const opp = state.players[opponentSeat];
  const youLeader = state.cardLibrary[you.leader.cardId];
  const oppLeader = state.cardLibrary[opp.leader.cardId];

  // Tap-outside-card on the playmat surface clears transient UI state.
  const onPlaymatTap = useCallback(() => {
    if (inspectedCardId) setInspectedCardId(null);
    if (selectedAttackerId) setSelectedAttackerId(null);
    if (armedDonId) disarmDon();
  }, [
    inspectedCardId,
    setInspectedCardId,
    selectedAttackerId,
    setSelectedAttackerId,
    armedDonId,
    disarmDon,
  ]);

  return (
    <LayoutGroup>
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ perspective: '1200px' }}
        onClick={onPlaymatTap}
      >
        {/* Cream-paper playmat surface — design-reference §3 (replaces felt-green). */}
        <div
          className="paper-playmat paper-grain absolute inset-0"
          style={{
            transform: 'rotateX(8deg)',
            transformOrigin: '50% 60%',
          }}
        >
          {/* Top-level container — single column. Each half (opp + you)
              hosts its own LIFE column internally. The opp half is rotated
              180° so the playmat reads like two players sitting opposite. */}
          <div
            className="grid h-full w-full"
            style={{
              gridTemplateColumns: '1fr',
              // design-reference §10 edge padding + safe area.
              paddingTop: 'calc(env(safe-area-inset-top, 0px) + 6dvh)',
              paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24dvh)',
              paddingLeft: 16,
              paddingRight: 16,
            }}
          >
            {/* Single-column playmat layout — physical-table convention per
                owner direction 2026-05-29: opp's entire half is rotated 180°
                so their cards face me, their text reads upside-down, and
                their LIFE column ends up on my top-right (was their far-left).
                Each half hosts its own LIFE column + field side-by-side. */}
            <div
              className="grid h-full w-full"
              style={{
                // D6 — explicit dvh per playmat-redesign §1.3.
                // Two halves at 31dvh each + 1dvh contact-zone strip = 63dvh
                // of vertical content between the 6dvh chrome (paddingTop) and
                // 24dvh hand strip (paddingBottom). 7dvh slack absorbs the
                // safe-area inset compression noted in §1.3.
                gridTemplateRows: '31dvh 1dvh 31dvh',
              }}
            >
              {/* TOP HALF — opponent. Rotated 180° as one unit.
                  Per design-reference §3 the OPP half carries a faint
                  --color-sky-horizon wash as a subtle "distance cue" so the
                  eye reads it as further away than YOUR half. Cool-blue tint
                  at low opacity over cream so the surface stays cream-paper. */}
              <div
                className="grid h-full w-full relative"
                style={{
                  gridTemplateColumns: 'var(--playmat-life-col-w, 32px) 1fr',
                  transform: 'rotate(180deg)',
                  backgroundColor: 'rgba(201, 220, 230, 0.18)',
                  boxShadow: 'inset 0 0 24px rgba(15, 69, 73, 0.05)',
                }}
                aria-label="Opponent playmat"
              >
                <div className="flex h-full items-end justify-center pb-1">
                  <LifeStack playerId={opponentSeat} hideLabel />
                </div>
                <OpponentHalf
                  zones={opp}
                  playerId={opponentSeat}
                  isYou={false}
                  leaderCard={oppLeader}
                />
              </div>

              <ContactZone />

              {/* BOTTOM HALF — you. Normal orientation. */}
              <div
                className="grid h-full w-full"
                style={{ gridTemplateColumns: 'var(--playmat-life-col-w, 32px) 1fr' }}
                aria-label="Your playmat"
              >
                <div className="flex h-full items-end justify-center pb-1">
                  <LifeStack playerId={seat} hideLabel />
                </div>
                <YourHalf
                  zones={you}
                  playerId={seat}
                  isYou={true}
                  leaderCard={youLeader}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Hand fan — absolute-bottom, sits over the tilt so cards stay flat. */}
        <HandFan playerId={seat} interactive />

        {/* Card detail modal — second-tap on inspected card opens it. */}
        <CardDetailModal />

        <AttackResolutionOverlay />
        <LifeRevealOverlay />
        <EventCardOverlay />
        <TriggerPrompt />
      </div>
    </LayoutGroup>
  );
});
