// StageSlot — playmat-redesign.md §2.4.
//
// Sits immediately to the RIGHT of the LEADER in the mid-row, identical
// dimensions to a character slot (52×72). Max 1 stage at a time per CR
// §3-8-5. When empty, shows the dashed empty outline + "STAGE CARD"
// wordmark matching the Bandai playsheet print. When occupied, renders
// the Stage card at size="field" (placeholder anatomy in CardArt suppresses
// the power stamp and counter chip for stages per §3.4).

import { memo } from 'react';
import { useGameStore } from '../../store/game';
import { ZoneSlot } from '../ZoneSlot';
import { CardArt, CARD_DIMS } from '../CardArt';
import type { PlayerId } from '@shared/engine-v2/state/types';

interface StageSlotProps {
  playerId: PlayerId;
  isYou: boolean;
}

export const StageSlot = memo(function StageSlot({ playerId, isYou }: StageSlotProps) {
  const stage = useGameStore((s) => s.state.players[playerId].stage);
  const library = useGameStore((s) => s.state.cardLibrary);
  const dims = CARD_DIMS.field;
  const label = stage
    ? `${isYou ? 'Your' : 'Opponent'} stage — ${library[stage.cardId]?.name ?? 'card'}`
    : `${isYou ? 'Your' : 'Opponent'} stage slot — empty`;

  const card = stage ? library[stage.cardId] : undefined;

  return (
    <ZoneSlot
      kind="stage"
      playerId={playerId}
      ariaLabel={label}
      // Rested stage rotates 90° → 72 wide. Widen the slot so the rotated
      // card stays inside; flex row pushes neighbors. Empty stage stays 52.
      // Owner direction 2026-05-29.
      width={stage?.rested ? 72 : dims.w}
      height={dims.h}
      emptyLabel="STAGE"
    >
      {stage && card && (
        <div
          className="relative"
          style={{ width: dims.w, height: dims.h }}
        >
          <CardArt inst={stage} card={card} size="field" />
        </div>
      )}
    </ZoneSlot>
  );
});
