// TrashSlot — playmat-redesign.md §2.8.
//
// Bottom-RIGHT corner of each player's FAR row. Single 52×72 slot showing
// the TOP card of the trash (last index per CR §3-5). When the pile has
// more than 1 card, a small cream count chip overlays bottom-right. When
// empty, the slot collapses to the dashed empty outline + "TRASH" wordmark.
//
// Tap behavior (2026-05-29): opens the TrashViewer modal for THIS player's
// trash, exposing the full ordered stack. Per CR §3-5 + §3-1-5 both
// players may inspect either trash, so tapping the opp's trash slot opens
// THEIR trash contents. (Pre-2026-05-29: tap opened CardDetailModal for
// only the top card — no way to scroll the rest. Replaced.)

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
  const setViewingTrashOf = useGameStore((s) => s.setViewingTrashOf);

  const dims = CARD_DIMS.field;
  const count = trash.length;
  const label =
    count === 0
      ? `${isYou ? 'Your' : 'Opponent'} trash — empty (tap to open viewer)`
      : `${isYou ? 'Your' : 'Opponent'} trash — ${count} cards (tap to open viewer)`;

  const topInstanceId = count > 0 ? trash[count - 1] : null;
  const topInst = topInstanceId ? instances[topInstanceId] : undefined;
  const topCard = topInst ? library[topInst.cardId] : undefined;

  // Open the TrashViewer for THIS slot's player — works for either side
  // (CR §3-5: trash is open to both players). Empty trash is still tappable
  // so the viewer can render the "Trash is empty" affordance.
  const onTapSlot = () => {
    setViewingTrashOf(playerId);
  };

  return (
    <ZoneSlot
      kind="trash"
      playerId={playerId}
      ariaLabel={label}
      width={dims.w}
      height={dims.h}
      emptyLabel="TRASH"
    >
      {topInst && topCard ? (
        <div
          className="relative cursor-pointer"
          style={{ width: dims.w, height: dims.h }}
          onClick={onTapSlot}
          role="button"
          tabIndex={0}
          aria-label={label}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onTapSlot();
            }
          }}
        >
          <CardArt inst={topInst} card={topCard} size="field" />
          {count > 1 && (
            <span
              className="absolute bottom-1 right-1 z-10 rounded-[3px] bg-paper-cream/95
                         font-display tabular text-ink-black ring-[0.5px] ring-ink-black/40
                         shadow-[0_1px_2px_rgba(0,0,0,0.45)]"
              style={{
                padding: '0.5px 5px',
                fontSize: '0.7rem',
                lineHeight: 1.1,
              }}
              aria-hidden="true"
            >
              {count}
            </span>
          )}
        </div>
      ) : (
        // Empty trash — still tappable so the viewer can open + show
        // "Trash is empty". Cover the full slot so the tap target meets
        // the iOS HIG minimum.
        <button
          type="button"
          onClick={onTapSlot}
          aria-label={label}
          className="absolute inset-0 bg-transparent border-0
                     focus-visible:outline-none focus-visible:ring-2
                     focus-visible:ring-sun-brass cursor-pointer"
        />
      )}
    </ZoneSlot>
  );
});
