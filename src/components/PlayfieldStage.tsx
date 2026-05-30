// PlayfieldStage — playmat-redesign.md §1 + §2 (Bandai playsheet rebuild).
//
// Mobile portrait (430 × dvh) playmat. Each player's half mirrors the
// official Bandai single-player playsheet, with the opp half rotated 180°
// so the two halves meet at the center contact zone (physical-table
// convention).
//
// ┌──────┬──────────────────────────────────────────┐
// │      │            CHARACTER  AREA               │
// │ LIFE ├────┬─────────┬───────┬──────────────────┤
// │      │ PH │ Leader  │ Stage │       Deck       │
// │      ├────┴─────────┴───────┴──────────────────┤
// │ DON  │    COST  AREA            │    TRASH     │
// │ DECK │                          │              │
// └──────┴──────────────────────────────────────────┘
//
//  - LIFE column hugs the inside-LEFT of each half, full height of the
//    CHARACTER + LEADER rows.
//  - DON DECK sits BELOW the LIFE column in the FAR row's left bay.
//  - CHARACTER AREA is one wide gray banner with 5 dashed slots inside.
//  - LEADER row: phase column → leader → stage → deck.
//  - FAR row: DON DECK → COST AREA → TRASH.
//  - Opp half is the same layout rotated 180° (one block).
//  - Hand fan + End-Turn button live below the playmat (out of scope here).
//
// Cream-paper playmat surface (NO felt). Card sizes / CardArt unchanged.

import { memo, useCallback } from 'react';
import { LayoutGroup } from 'framer-motion';
import { useGameStore } from '../store/game';
import { useDonArm } from '../store/donArm';
import { CardArt } from './CardArt';
import { ZoneSlot } from './ZoneSlot';
import { HandFan } from './HandFan';
import { CardDetailModal } from './CardDetailModal';
import { TrashViewer } from './TrashViewer';
import { AttackResolutionOverlay } from './AttackResolutionOverlay';
import { TriggerPrompt } from './TriggerPrompt';
import { MulliganPrompt } from './MulliganPrompt';
import { DiceRollPrompt } from './DiceRollPrompt';
import { FirstPlayerChoicePrompt } from './FirstPlayerChoicePrompt';
import { LifeRevealOverlay } from './LifeRevealOverlay';
import { EventCardOverlay } from './EventCardOverlay';
import { LifeStack } from './zones/LifeStack';
import { StageSlot } from './zones/StageSlot';
import { DeckSlot } from './zones/DeckSlot';
import { TrashSlot } from './zones/TrashSlot';
import { DonDeckSlot } from './zones/DonDeckSlot';
import { CostAreaBand } from './zones/CostAreaBand';
import { PhaseColumn } from './zones/PhaseColumn';
import { EndTurnButton } from './EndTurnButton';
import type { CardInstance, PlayerId, PlayerZones } from '@shared/engine/GameState';
import type { Card } from '@shared/engine/cards/Card';

// ─────────────────────────────────────────────────────────────────────────────
// Tap-routing affordances.
// ─────────────────────────────────────────────────────────────────────────────

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

function useDonAttachCandidates(): Set<string> {
  const legalActions = useGameStore((s) => s.legalActions);
  const out = new Set<string>();
  for (const a of legalActions) {
    if (a.type === 'ATTACH_DON') out.add(a.targetInstanceId);
  }
  return out;
}

/** Single tap on any field card opens CardDetailModal — owner direction
 *  2026-05-29. */
function useFieldTapRouter() {
  const setInspectedCardId = useGameStore((s) => s.setInspectedCardId);
  const setCardDetailOpen = useGameStore((s) => s.setCardDetailOpen);

  return useCallback(
    (instanceId: string) => {
      setInspectedCardId(instanceId);
      setCardDetailOpen(true);
    },
    [setInspectedCardId, setCardDetailOpen],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CHARACTER AREA — wide horizontal banner with 5 character slots inside.
// ─────────────────────────────────────────────────────────────────────────────

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

function CharacterArea({
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
      className="playmat-zone playmat-zone--strong relative flex h-full w-full items-center justify-center"
      role="region"
      aria-label="Character area, 5 slots"
      style={{ padding: '4px 6px' }}
    >
      {/* Wordmark — printed center-top on Bandai's cardboard mat. Stays
          visible behind cards at low opacity so the zone is identifiable. */}
      <span
        className="playmat-zone__label absolute font-display"
        style={{
          top: 3,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontSize: 9,
          letterSpacing: '0.16em',
        }}
        aria-hidden="true"
      >
        CHARACTER AREA
      </span>
      <div className="grid h-full w-full grid-cols-5 items-center gap-1.5 pt-2.5">
        {slots.map((inst, i) => (
          <div
            key={`${playerId}-char-${i}`}
            className="flex items-center justify-center"
          >
            <ZoneSlot
              kind="character"
              playerId={playerId}
              index={i}
              width={52}
              height={72}
              emptyLabel={null}
            >
              {inst && (
                <FieldCharacter
                  inst={inst}
                  card={library[inst.cardId]}
                  isFriendly={isFriendly}
                  onTap={() => tapRouter(inst.instanceId)}
                />
              )}
            </ZoneSlot>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LEADER row — Phase column → Leader → Stage → Deck.
// ─────────────────────────────────────────────────────────────────────────────

function LeaderRow({
  zones,
  playerId,
  isYou,
  leaderCard,
}: {
  zones: PlayerZones;
  playerId: PlayerId;
  isYou: boolean;
  leaderCard: Card;
}) {
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
    <div
      className="flex h-full w-full items-center"
      style={{ paddingLeft: 2, paddingRight: 2, gap: 4 }}
    >
      <PhaseColumn playerId={playerId} isYou={isYou} />
      <div
        className="flex grow items-center justify-end"
        style={{ gap: 6 }}
      >
        <ZoneSlot
          kind="leader"
          playerId={playerId}
          ariaLabel={`${leaderCard.name} (leader)`}
          // Rested leader rotates 90° → its rotated bbox is 72 wide. Widen
          // the slot so the rotated card stays inside its own slot and the
          // flex row pushes neighbors (stage, deck) accordingly. Owner
          // direction 2026-05-29.
          width={zones.leader.rested ? 72 : 52}
          height={72}
          emptyLabel={null}
        >
          <div>
            <CardArt
              inst={zones.leader}
              card={leaderCard}
              size="leader"
              liveLifeCount={zones.life.length}
              onTap={() => tapRouter(leaderId)}
              selectedAttacker={isSelectedAttacker}
              pendingTarget={isPendingTarget}
              donDropTarget={isDonDropTarget}
            />
          </div>
        </ZoneSlot>
        <StageSlot playerId={playerId} isYou={isYou} />
        <DeckSlot playerId={playerId} isYou={isYou} />
        {/* End Turn button fills the empty space to the right of the deck.
            Only renders on YOUR side — opp side stays empty. Owner direction
            2026-05-29: pack leader/stage/deck left + End Turn next to them. */}
        {isYou && (
          <div className="flex h-full items-center">
            <EndTurnButton />
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FAR row — COST AREA (with TRASH on the right). DON DECK is rendered in
// the LIFE column's bottom bay, so this row carries Cost + Trash only.
// ─────────────────────────────────────────────────────────────────────────────

function FarRow({ playerId, isYou }: { playerId: PlayerId; isYou: boolean }) {
  return (
    <div
      className="flex h-full w-full items-center"
      style={{ paddingLeft: 4, paddingRight: 4, gap: 6 }}
    >
      <div className="flex h-full grow items-center">
        <CostAreaBand playerId={playerId} isYou={isYou} />
      </div>
      <TrashSlot playerId={playerId} isYou={isYou} />
    </div>
  );
}

// Each player's half consumes 31dvh: 12dvh CHAR + 11dvh LEADER + 8dvh FAR.
// Defined here so LeftBay below can share the same grid template.
const HALF_TEMPLATE_ROWS = '12dvh 11dvh 8dvh';

// ─────────────────────────────────────────────────────────────────────────────
// LIFE column + DON DECK bay — left edge of each half.
//
// Per the Bandai playsheet the LIFE column is full-height of CHARACTER +
// LEADER rows, and the DON DECK sits in its own card-shaped slot in the
// FAR row's left bay (directly below the LIFE column). Stacked vertically
// they form the left edge of each player's half.
// ─────────────────────────────────────────────────────────────────────────────

function LeftBay({
  playerId,
  isYou,
}: {
  playerId: PlayerId;
  isYou: boolean;
}) {
  // Use the SAME grid template as HalfBody so the LIFE column lines up
  // exactly with the CHAR+LEADER bands, and the DON DECK lines up with
  // the FAR row. The LIFE column spans the first two row tracks.
  return (
    <div
      className="grid h-full"
      style={{
        width: 'var(--zone-life-col-w, 40px)',
        minWidth: 'var(--zone-life-col-w, 40px)',
        gridTemplateRows: HALF_TEMPLATE_ROWS,
        rowGap: 'var(--playmat-band-gap, 6px)',
      }}
    >
      {/* LIFE column spans both CHAR (row 1) and LEADER (row 2). */}
      <div style={{ gridRow: '1 / span 2' }} className="relative">
        <LifeStack playerId={playerId} isYou={isYou} />
      </div>
      {/* DON DECK sits in the FAR-row bay below LIFE. */}
      <div
        style={{ gridRow: '3 / span 1' }}
        className="flex items-center justify-center"
      >
        <DonDeckSlot playerId={playerId} isYou={isYou} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Half = LeftBay (LIFE + DON DECK) + RightStack (CHAR / LEADER / FAR).
// ─────────────────────────────────────────────────────────────────────────────

interface HalfProps {
  zones: PlayerZones;
  playerId: PlayerId;
  isYou: boolean;
  leaderCard: Card;
}

function HalfBody({ zones, playerId, isYou, leaderCard }: HalfProps) {
  return (
    <div
      className="grid h-full w-full"
      style={{
        gridTemplateRows: HALF_TEMPLATE_ROWS,
        rowGap: 'var(--playmat-band-gap, 6px)',
      }}
    >
      <CharacterArea zones={zones} playerId={playerId} isFriendly={isYou} />
      <LeaderRow zones={zones} playerId={playerId} isYou={isYou} leaderCard={leaderCard} />
      <FarRow playerId={playerId} isYou={isYou} />
    </div>
  );
}

function PlayerHalf(props: HalfProps) {
  return (
    <div
      className="flex h-full w-full items-stretch"
      style={{ gap: 'var(--playmat-band-gap, 6px)', padding: '0 var(--playmat-band-h-pad, 8px)' }}
      role="region"
      aria-label={props.isYou ? 'Your half' : 'Opponent half'}
    >
      <LeftBay playerId={props.playerId} isYou={props.isYou} />
      <div className="flex h-full grow">
        <HalfBody {...props} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Contact zone — thin brass-canary hairline + glow between halves.
// ─────────────────────────────────────────────────────────────────────────────

function ContactZone() {
  return (
    <div
      className="relative flex items-center justify-center"
      aria-hidden="true"
      style={{ minHeight: 6 }}
    >
      <div className="h-px w-[88%] bg-brass-canary/70 shadow-[0_0_6px_rgba(232,180,61,0.45)]" />
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
        {/* Cream-paper playmat surface — no felt, soft vignette only. */}
        <div className="paper-playmat paper-grain absolute inset-0">
          <div
            className="grid h-full w-full"
            style={{
              // Top — app chrome from App.tsx (6dvh).
              // Bottom — hand fan strip (24dvh).
              paddingTop: 'calc(env(safe-area-inset-top, 0px) + 6dvh)',
              paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24dvh)',
              paddingLeft: 4,
              paddingRight: 4,
              gridTemplateRows: '1fr auto 1fr',
              rowGap: 0,
            }}
          >
            {/* OPP half — rotated 180° so zones land in mirrored positions
                (Bandai 2-player playmat convention). Owner direction
                2026-05-29: counter-rotate the visible LEAF content
                (text labels + card faces + badges) inside so the viewer
                can READ them upright. `is-opp-content-flip` CSS targets
                those leaf elements; positions stay in their mirrored slots. */}
            <div
              className="relative is-opp-content-flip"
              style={{
                transform: 'rotate(180deg)',
                transformOrigin: '50% 50%',
              }}
              aria-label="Opponent playmat"
            >
              <PlayerHalf
                zones={opp}
                playerId={opponentSeat}
                isYou={false}
                leaderCard={oppLeader}
              />
            </div>

            <ContactZone />

            {/* YOUR half — upright. */}
            <div className="relative" aria-label="Your playmat">
              <PlayerHalf
                zones={you}
                playerId={seat}
                isYou={true}
                leaderCard={youLeader}
              />
            </div>
          </div>
        </div>

        {/* Hand fan — absolute-bottom overlay strip. */}
        <HandFan playerId={seat} interactive />

        <CardDetailModal />
        <TrashViewer />
        <AttackResolutionOverlay />
        <LifeRevealOverlay />
        <EventCardOverlay />
        <TriggerPrompt />
        <DiceRollPrompt />
        <FirstPlayerChoicePrompt />
        <MulliganPrompt />
      </div>
    </LayoutGroup>
  );
});
