import type { CardInstance } from '@shared/engine/GameState';
import type { Card } from '@shared/engine/cards/Card';

interface Props {
  inst: CardInstance;
  card: Card;
  onTap?: () => void;
  highlighted?: boolean;
  rested?: boolean;
}

export function CardChip({ inst, card, onTap, highlighted, rested }: Props) {
  const colorClass = card.colors[0] === 'red' ? 'bg-red-100 border-red-700' :
                     card.colors[0] === 'blue' ? 'bg-blue-100 border-blue-700' :
                     'bg-stone-100 border-stone-700';
  return (
    <button
      onClick={onTap}
      disabled={!onTap}
      className={`
        relative flex flex-col items-center justify-center
        rounded border text-ink-black text-[10px] leading-tight
        ${colorClass}
        ${highlighted ? 'ring-2 ring-brass-canary' : ''}
        ${rested ? 'rotate-90 opacity-70' : ''}
        ${onTap ? 'cursor-pointer hover:scale-105 transition-transform' : ''}
        h-16 w-12 px-1 py-0.5
      `}
    >
      <div className="font-bold truncate w-full text-center">{card.name}</div>
      {card.cost !== null && (
        <div className="text-[9px] opacity-70">⛁{card.cost}</div>
      )}
      {card.power !== null && (
        <div className="text-[9px]">{card.power}</div>
      )}
      {inst.attachedDon > 0 && (
        <div className="absolute -top-1 -right-1 bg-brass-canary text-ink-black text-[9px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
          +{inst.attachedDon}
        </div>
      )}
    </button>
  );
}
