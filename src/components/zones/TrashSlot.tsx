// TrashSlot — design-reference.md §3.4 L6.
// Bottom-right corner of player's half (mirror top-right for opp). Single
// slot, face-up. When the trash has cards, show the TOP card (last index) art.
// When empty, show a "TRASH" label inside a dashed marine-fog outline.
// Count = `state.players[X].trash.length` (never render the string[] array).

import { memo } from 'react';
import { useGameStore } from '../../store/game';
import { ZoneSlot } from '../ZoneSlot';
import { CardArt, CARD_DIMS } from '../CardArt';
import type { PlayerId } from '@shared/engine/GameState';

interface TrashSlotProps {
  playerId: PlayerId;
  isYou: boolean;
}

export const TrashSlot = memo(function TrashSlot({ playerId, isYou }: TrashSlotProps) {
  const trash = useGameStore((s) => s.state.players[playerId].trash);
  const instances = useGameStore((s) => s.state.instances);
  const library = useGameStore((s) => s.state.cardLibrary);
  const dims = CARD_DIMS.field;
  const count = trash.length;
  const label =
    count === 0
      ? `${isYou ? 'Your' : 'Opponent'} trash — empty`
      : `${isYou ? 'Your' : 'Opponent'} trash — ${count} cards`;

  // Top of trash = last index (CR §3-5 — new cards placed on top).
  const topInstanceId = count > 0 ? trash[count - 1] : null;
  const topInst = topInstanceId ? instances[topInstanceId] : undefined;
  const topCard = topInst ? library[topInst.cardId] : undefined;

  return (
    <ZoneSlot kind="trash" playerId={playerId} ariaLabel={label}>
      <div className="relative" style={{ width: dims.w, height: dims.h }}>
        {topInst && topCard ? (
          <>
            <CardArt inst={topInst} card={topCard} size="field" />
            {count > 1 && (
              <span
                className="absolute bottom-0.5 right-0.5 rounded-sm bg-paper-cream/95 px-1 py-px
                           font-display tabular text-[0.65rem] leading-none text-ink-black
                           shadow-[0_1px_2px_rgba(0,0,0,0.35)]"
                aria-hidden="true"
              >
                {count}
              </span>
            )}
          </>
        ) : (
          <div
            className="absolute inset-0 flex items-center justify-center rounded-md
                       border border-dashed border-marine-fog/60 bg-paper-fog/10"
            aria-hidden="true"
          >
            <span className="font-body text-[0.55rem] font-extrabold uppercase tracking-wider text-paper-cream/80">
              Trash
            </span>
          </div>
        )}
      </div>
    </ZoneSlot>
  );
});
