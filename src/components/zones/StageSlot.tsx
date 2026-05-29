// StageSlot — design-reference.md §3.4 L3 + rules-reference.md §4.7.
// Single Stage Area slot, sits right of the Leader in the mid-row. Renders
// `state.players[X].stage: CardInstance | null`. When null, shows a faint
// "STAGE" label inside a dashed marine-fog outline. When occupied, renders
// the Stage card at `size="field"` (same dims as a character slot).

import { memo } from 'react';
import { useGameStore } from '../../store/game';
import { ZoneSlot } from '../ZoneSlot';
import { CardArt, CARD_DIMS } from '../CardArt';
import type { PlayerId } from '@shared/engine/GameState';

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
    <ZoneSlot kind="stage" playerId={playerId} ariaLabel={label}>
      <div className="relative" style={{ width: dims.w, height: dims.h }}>
        {stage && card ? (
          <CardArt inst={stage} card={card} size="field" />
        ) : (
          <div
            className="absolute inset-0 flex items-center justify-center rounded-md
                       border-2 border-dashed border-ink-iron/35 bg-paper-fog/35"
            aria-hidden="true"
          >
            <span className="font-body text-[0.6rem] font-extrabold uppercase tracking-wider text-ink-iron/75">
              Stage
            </span>
          </div>
        )}
      </div>
    </ZoneSlot>
  );
});
