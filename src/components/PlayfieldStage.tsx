// PlayfieldStage — visual-spec.md §5.1 + §4.
// Root composition for the 430px portrait-phone frame. Establishes the
// `perspective: 1200px` outer + gentle `rotateX(8deg)` inner tilt on the
// playmat surface, then stacks the six vertical bands per §4.2:
//
//   12% opponent chrome / 22% opponent field / 6% phase ribbon /
//   22% your field    /  10% your chrome   / 28% hand
//
// No commissioned playmat asset yet — the surface is a code-drawn cream felt
// with marine-fog zone outlines. Swap in `/assets/playmat-light.webp` when art lands.

import { memo, useMemo } from 'react';
import { LayoutGroup } from 'framer-motion';
import { useGameStore } from '../store/game';
import { CardArt } from './CardArt';
import { ZoneSlot } from './ZoneSlot';
import { PhaseRibbon } from './PhaseRibbon';
import { HandFan } from './HandFan';
import { AttackResolutionOverlay } from './AttackResolutionOverlay';
import type { CardInstance, PlayerId, PlayerZones } from '@shared/engine/GameState';
import type { Card } from '@shared/engine/cards/Card';

interface ChromeRowProps {
  zones: PlayerZones;
  isYou: boolean;
  playerId: PlayerId;
  leaderCard: Card;
}

/** Chrome strip — opponent label, life pill, DON readout, deck/trash mini stacks. */
function ChromeRow({ zones, isYou, playerId, leaderCard }: ChromeRowProps) {
  const label = isYou ? 'You' : 'Opponent';
  return (
    <div className="flex h-full items-center justify-between gap-3 px-4 py-1">
      <div className="flex items-center gap-2">
        <span
          className="text-[0.6875rem] font-body font-extrabold uppercase tracking-wider text-ink-iron"
        >
          {label}
        </span>
        <div
          className="flex items-center gap-1 rounded-full bg-paper-cream/70 px-2 py-0.5 ring-1 ring-seal-red"
          aria-label={`${label} life ${zones.life.length}`}
        >
          <svg viewBox="0 0 16 16" className="h-3 w-3 text-seal-red" fill="currentColor" aria-hidden="true">
            <path d="M8 14s-5-3.2-5-7a3 3 0 0 1 5-2.2A3 3 0 0 1 13 7c0 3.8-5 7-5 7Z" />
          </svg>
          <span className="font-display tabular text-[1.05rem] leading-none text-ink-black">
            {zones.life.length}
          </span>
        </div>
        <div
          className="flex items-center gap-1 rounded-full bg-brass-canary/80 px-2 py-0.5"
          aria-label={`${label} DON ${zones.donActive} active, ${zones.donRested} rested`}
        >
          <span className="font-body text-[0.6875rem] font-extrabold uppercase tracking-wider text-ink-black">
            DON
          </span>
          <span className="font-display tabular text-[0.95rem] leading-none text-ink-black">
            {zones.donActive}
          </span>
          <span className="font-body tabular text-[0.6875rem] text-ink-iron">
            / {zones.donRested}r
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <ZoneSlot
          kind="deck"
          playerId={playerId}
          compact
          ariaLabel={`${label} deck, ${zones.deck.length} cards`}
        >
          <div className="flex h-full w-full flex-col items-center justify-center px-1">
            <span className="font-body text-[0.6rem] font-extrabold uppercase tracking-wider text-ink-iron">
              Deck
            </span>
            <span className="font-display tabular text-[0.85rem] leading-none text-ink-black">
              {zones.deck.length}
            </span>
          </div>
        </ZoneSlot>
        <ZoneSlot
          kind="trash"
          playerId={playerId}
          compact
          ariaLabel={`${label} trash, ${zones.trash.length} cards`}
        >
          <div className="flex h-full w-full flex-col items-center justify-center px-1">
            <span className="font-body text-[0.6rem] font-extrabold uppercase tracking-wider text-ink-iron">
              Trash
            </span>
            <span className="font-display tabular text-[0.85rem] leading-none text-ink-black">
              {zones.trash.length}
            </span>
          </div>
        </ZoneSlot>
        {/* Hand-count badge (opponent only — your hand renders in HandFan). */}
        {!isYou && (
          <div
            className="flex h-9 min-w-[40px] flex-col items-center justify-center rounded-2xl
                       bg-paper-fog/40 px-2 ring-1 ring-marine-fog/40"
            aria-label={`Opponent hand, ${zones.hand.length} cards`}
          >
            <span className="font-body text-[0.6rem] font-extrabold uppercase tracking-wider text-ink-iron">
              Hand
            </span>
            <span className="font-display tabular text-[0.85rem] leading-none text-ink-black">
              {zones.hand.length}
            </span>
          </div>
        )}
        {/* Mini leader chip so the player can see whose leader is on top at a glance. */}
        <span
          className="hidden text-[0.6rem] font-body font-bold tracking-wider text-ink-iron sm:inline"
          aria-hidden="true"
        >
          {leaderCard.name}
        </span>
      </div>
    </div>
  );
}

interface FieldRowProps {
  zones: PlayerZones;
  playerId: PlayerId;
  leaderCard: Card;
  isYou: boolean;
}

/** Wrap CardArt with the card lookup so field characters render with their library data. */
function FieldCharacter({ inst, card }: { inst: CardInstance; card: Card }) {
  return <CardArt inst={inst} card={card} size="field" />;
}

/** Field row — leader+life+don on one row, 5 character slots in another. */
function FieldRow(props: FieldRowProps) {
  const library = useGameStore((s) => s.state.cardLibrary);
  const { zones, playerId, leaderCard, isYou } = props;

  const charSlots: (CardInstance | null)[] = useMemo(() => {
    const arr: (CardInstance | null)[] = [];
    for (let i = 0; i < 5; i++) arr[i] = zones.field[i] ?? null;
    return arr;
  }, [zones.field]);

  const leaderRow = (
    <div className="flex items-center justify-center gap-2">
      <ZoneSlot
        kind="life"
        playerId={playerId}
        compact
        ariaLabel={`${isYou ? 'Your' : 'Opponent'} life, ${zones.life.length} cards`}
      >
        <div className="flex h-full w-full flex-col items-center justify-center">
          <span className="font-body text-[0.6rem] font-extrabold uppercase tracking-wider text-seal-red">
            Life
          </span>
          <span className="font-display tabular text-[0.85rem] leading-none text-ink-black">
            {zones.life.length}
          </span>
        </div>
      </ZoneSlot>
      <ZoneSlot kind="leader" playerId={playerId} ariaLabel={`${leaderCard.name} (leader)`}>
        <div style={{ transform: 'scale(1.15)' }}>
          <CardArt inst={zones.leader} card={leaderCard} size="leader" />
        </div>
      </ZoneSlot>
      <ZoneSlot
        kind="don"
        playerId={playerId}
        compact
        ariaLabel={`${isYou ? 'Your' : 'Opponent'} DON deck, ${zones.donDeck} left`}
      >
        <div className="flex h-full w-full flex-col items-center justify-center">
          <span className="font-body text-[0.6rem] font-extrabold uppercase tracking-wider text-ink-iron">
            DON
          </span>
          <span className="font-display tabular text-[0.85rem] leading-none text-ink-black">
            {zones.donDeck}
          </span>
        </div>
      </ZoneSlot>
    </div>
  );

  const characterRow = (
    <div className="grid grid-cols-5 gap-1 px-3">
      {charSlots.map((inst, i) => (
        <ZoneSlot key={`${playerId}-char-${i}`} kind="character" playerId={playerId} index={i}>
          {inst && <FieldCharacter inst={inst} card={library[inst.cardId]} />}
        </ZoneSlot>
      ))}
    </div>
  );

  return (
    <div className="flex h-full w-full flex-col justify-center gap-1.5 py-1">
      {isYou ? (
        <>
          {characterRow}
          {leaderRow}
        </>
      ) : (
        <>
          {leaderRow}
          {characterRow}
        </>
      )}
    </div>
  );
}

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
        {/* Tilted felt surface — visual-spec §5.1: gentle 8deg tilt (not Pokemon's 15deg). */}
        <div
          className="absolute inset-0 paper-grain bg-paper-cream"
          style={{
            transform: 'rotateX(8deg)',
            transformOrigin: '50% 60%',
          }}
        >
          <div
            className="grid h-full w-full"
            style={{
              // Owner-locked dvh budget — visual-spec §4.2
              gridTemplateRows: '12% 22% 6% 22% 10% 28%',
            }}
          >
            {/* Row 1: Opponent chrome */}
            <div className="bg-paper-fog/40 ring-1 ring-marine-fog/20">
              <ChromeRow zones={opp} isYou={false} playerId={opponentSeat} leaderCard={oppLeader} />
            </div>

            {/* Row 2: Opponent field */}
            <div>
              <FieldRow
                zones={opp}
                playerId={opponentSeat}
                leaderCard={oppLeader}
                isYou={false}
              />
            </div>

            {/* Row 3: Phase ribbon */}
            <div>
              <PhaseRibbon viewAs={seat} />
            </div>

            {/* Row 4: Your field */}
            <div>
              <FieldRow
                zones={you}
                playerId={seat}
                leaderCard={youLeader}
                isYou={true}
              />
            </div>

            {/* Row 5: Your chrome */}
            <div className="bg-paper-fog/40 ring-1 ring-marine-fog/20">
              <ChromeRow zones={you} isYou={true} playerId={seat} leaderCard={youLeader} />
            </div>

            {/* Row 6: Your hand (HandFan handles its own positioning at the bottom). */}
            <div className="relative" />
          </div>
        </div>

        {/* Hand fan is absolute-positioned to bottom; sits over the tilt so cards stay flat. */}
        <HandFan playerId={seat} interactive />

        {/* Damage / counter overlay — only renders when pendingAttack + counter_window. */}
        <AttackResolutionOverlay />
      </div>
    </LayoutGroup>
  );
});
