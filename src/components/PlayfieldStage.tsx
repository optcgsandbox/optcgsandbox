// PlayfieldStage — design-reference.md §3.4.
//
// Official Bandai-aligned playmat for the 430px portrait phone frame. Layout
// follows the playsheet's two-player mirror (design-reference §2 + §3.4):
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
// The LIFE column is a fixed-width strip on the far LEFT of the playmat,
// full height. Opp's LifeStack sits in the top half of that strip, your
// LifeStack in the bottom half. Per §3.4 L1, your column's cards stack
// vertically with ~4px overlap — handled inside LifeStack.
//
// The playmat surface itself is tournament felt-green (§3.4 L8) via the
// `.felt-playmat` class in `src/index.css`. The masthead/app chrome stays
// cream paper (handled by App.tsx).

import { memo } from 'react';
import { LayoutGroup } from 'framer-motion';
import { useGameStore } from '../store/game';
import { CardArt } from './CardArt';
import { ZoneSlot } from './ZoneSlot';
import { HandFan } from './HandFan';
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
// Sub-row components.
// ─────────────────────────────────────────────────────────────────────────────

interface HalfProps {
  zones: PlayerZones;
  playerId: PlayerId;
  isYou: boolean;
  leaderCard: Card;
}

/** Wrap CardArt with the card lookup so field characters render with their library data. */
function FieldCharacter({ inst, card }: { inst: CardInstance; card: Card }) {
  return <CardArt inst={inst} card={card} size="field" />;
}

/** Row of 5 character slots — design-reference §3.4 L2. Sits closest to the
 *  contact zone so attacks visually "cross" between rows. */
function CharacterRow({ zones, playerId }: { zones: PlayerZones; playerId: PlayerId }) {
  const library = useGameStore((s) => s.state.cardLibrary);
  // Always render exactly 5 slots so empty positions still hit-test.
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
          {inst && <FieldCharacter inst={inst} card={library[inst.cardId]} />}
        </ZoneSlot>
      ))}
    </div>
  );
}

/** Leader row — design-reference §3.4 L3. Phase column (left) → Leader (center)
 *  → Stage (right of leader) → Deck (far right). */
function LeaderRow({ zones, playerId, isYou, leaderCard }: HalfProps) {
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
              // Source of truth = engine state; printed `card.life` is the *initial*
              // value and stays at 5 forever once any life is taken. See
              // visual-spec-layout-correction.md §E.1.
              liveLifeCount={zones.life.length}
            />
          </div>
        </ZoneSlot>
        <StageSlot playerId={playerId} isYou={isYou} />
        <DeckSlot playerId={playerId} isYou={isYou} />
      </div>
    </div>
  );
}

/** Far row — design-reference §3.4 L4/L5/L6. DonDeck (left corner) →
 *  CostArea (wide center) → Trash (right corner). */
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

/** Opponent half — top-to-bottom: FarRow, LeaderRow, CharacterRow (closest to contact). */
function OpponentHalf(props: HalfProps) {
  return (
    <div
      className="grid h-full w-full"
      style={{ gridTemplateRows: '1fr 1fr 1fr', rowGap: 'var(--playmat-band-px, 4px)' }}
      role="region"
      aria-label="Opponent half"
    >
      <FarRow playerId={props.playerId} isYou={false} />
      <LeaderRow {...props} />
      <CharacterRow zones={props.zones} playerId={props.playerId} />
    </div>
  );
}

/** Your half — top-to-bottom (mirror of opp): CharacterRow (closest to contact), LeaderRow, FarRow. */
function YourHalf(props: HalfProps) {
  return (
    <div
      className="grid h-full w-full"
      style={{ gridTemplateRows: '1fr 1fr 1fr', rowGap: 'var(--playmat-band-px, 4px)' }}
      role="region"
      aria-label="Your half"
    >
      <CharacterRow zones={props.zones} playerId={props.playerId} />
      <LeaderRow {...props} />
      <FarRow playerId={props.playerId} isYou={true} />
    </div>
  );
}

/** Contact zone — the visual mirror line where attacks cross. */
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
  const opponentSeat: PlayerId = seat === 'A' ? 'B' : 'A';

  const you = state.players[seat];
  const opp = state.players[opponentSeat];
  const youLeader = state.cardLibrary[you.leader.cardId];
  const oppLeader = state.cardLibrary[opp.leader.cardId];

  return (
    <LayoutGroup>
      <div className="absolute inset-0 overflow-hidden" style={{ perspective: '1200px' }}>
        {/* Felt-green playmat surface — design-reference §3.4 L8. */}
        <div
          className="felt-playmat absolute inset-0"
          style={{
            transform: 'rotateX(8deg)',
            transformOrigin: '50% 60%',
          }}
        >
          {/* Top-level: LIFE column (far left) + field. */}
          <div
            className="grid h-full w-full"
            style={{
              gridTemplateColumns: 'var(--playmat-life-col-w, 32px) 1fr',
              // Leave room at the bottom for the hand fan (~24dvh) and a bit
              // for the top-bar header (~6dvh) so nothing collides.
              paddingTop: '6dvh',
              paddingBottom: '24dvh',
              paddingLeft: '2px',
              paddingRight: '4px',
            }}
          >
            {/* ────────── LIFE column — design-reference §3.4 L1. ────────── */}
            <div
              className="grid h-full w-full"
              style={{ gridTemplateRows: '1fr 6px 1fr' }}
              role="region"
              aria-label="Life columns"
            >
              <div className="flex h-full items-start justify-center pt-1">
                <LifeStack playerId={opponentSeat} hideLabel />
              </div>
              <div aria-hidden="true" />
              <div className="flex h-full items-end justify-center pb-1">
                <LifeStack playerId={seat} hideLabel />
              </div>
            </div>

            {/* ────────── Field column — opp half / contact / your half. ────────── */}
            <div
              className="grid h-full w-full"
              style={{ gridTemplateRows: '1fr auto 1fr' }}
            >
              <OpponentHalf
                zones={opp}
                playerId={opponentSeat}
                isYou={false}
                leaderCard={oppLeader}
              />
              <ContactZone />
              <YourHalf
                zones={you}
                playerId={seat}
                isYou={true}
                leaderCard={youLeader}
              />
            </div>
          </div>
        </div>

        {/* Hand fan is absolute-positioned to bottom; sits over the tilt so cards stay flat. */}
        <HandFan playerId={seat} interactive />

        {/* Damage / counter overlay — only renders when pendingAttack + counter_window. */}
        <AttackResolutionOverlay />

        {/* Life reveal — center-screen flip when one of YOUR life cards is taken,
            with shared-element layoutId flight into the hand on dismiss. */}
        <LifeRevealOverlay />

        {/* Event card reveal — center-screen flash when an event resolves,
            with shared-element flight into the trash on dismiss. */}
        <EventCardOverlay />

        {/* Trigger prompt — modal Activate/Decline dialog when state.pendingTrigger
            is set AND the viewer is the trigger's controller. */}
        <TriggerPrompt />
      </div>
    </LayoutGroup>
  );
});
