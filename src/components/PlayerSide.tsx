import type { GameState, PlayerId } from '@shared/engine/GameState';
import { CardChip } from './CardChip';

interface Props {
  state: GameState;
  playerId: PlayerId;
  isYou: boolean;
  showHand: boolean;
  onCardInHandTap?: (instanceId: string) => void;
  onAttachDonTap?: (targetInstanceId: string) => void;
  attachDonMode: boolean;
}

export function PlayerSide({
  state, playerId, isYou, showHand, onCardInHandTap, onAttachDonTap, attachDonMode,
}: Props) {
  const p = state.players[playerId];
  const leaderCard = state.cardLibrary[p.leader.cardId];

  return (
    <section className="flex flex-col gap-1 border border-ink-black/20 rounded p-2 bg-white/40">
      <header className="flex items-center justify-between text-[10px] uppercase tracking-widest text-ink-iron">
        <span>{isYou ? 'You' : 'Opponent'} ({playerId})</span>
        <span>Life {p.life.length} · Deck {p.deck.length} · Trash {p.trash.length}</span>
      </header>

      {/* DON area */}
      <div className="flex items-center gap-1 text-[10px]">
        <span className="font-bold">DON</span>
        <span className="text-amber-700">{p.donActive} active</span>
        <span className="text-stone-500">/ {p.donRested} rested</span>
        <span className="text-stone-400">/ {p.donDeck} in deck</span>
      </div>

      {/* Leader */}
      <div className="flex items-end gap-2">
        <CardChip
          inst={p.leader}
          card={leaderCard}
          rested={p.leader.rested}
          onTap={attachDonMode && isYou ? () => onAttachDonTap?.(p.leader.instanceId) : undefined}
        />
        <div className="text-[10px] text-ink-iron">{leaderCard.name} · {leaderCard.power} pow</div>
      </div>

      {/* Field */}
      {p.field.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {p.field.map((inst) => {
            const card = state.cardLibrary[inst.cardId];
            return (
              <CardChip
                key={inst.instanceId}
                inst={inst}
                card={card}
                rested={inst.rested}
                onTap={attachDonMode && isYou ? () => onAttachDonTap?.(inst.instanceId) : undefined}
              />
            );
          })}
        </div>
      )}

      {/* Hand */}
      {showHand ? (
        <div className="flex gap-1 flex-wrap border-t border-ink-black/10 pt-1">
          <span className="text-[10px] text-ink-iron self-center mr-1">Hand</span>
          {p.hand.map((instanceId) => {
            const inst = state.instances[instanceId];
            const card = state.cardLibrary[inst.cardId];
            return (
              <CardChip
                key={instanceId}
                inst={inst}
                card={card}
                onTap={isYou ? () => onCardInHandTap?.(instanceId) : undefined}
              />
            );
          })}
        </div>
      ) : (
        <div className="text-[10px] text-ink-iron border-t border-ink-black/10 pt-1">
          Hand: {p.hand.length} face-down
        </div>
      )}
    </section>
  );
}
