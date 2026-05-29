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
  // A11y: color carries semantic meaning per OPTCG rules — surface it as text + label,
  // not via Tailwind class alone. Fixes WCAG 1.4.1 (do not use color alone).
  const colorLabel = card.colors.join(', ').toUpperCase() || 'COLORLESS';
  const colorClass = card.colors[0] === 'red' ? 'bg-red-100 border-red-700' :
                     card.colors[0] === 'blue' ? 'bg-blue-100 border-blue-700' :
                     'bg-stone-100 border-stone-700';
  const ariaLabel = [
    card.name,
    `${colorLabel} ${card.kind}`,
    card.cost !== null ? `cost ${card.cost}` : null,
    card.power !== null ? `power ${card.power}` : null,
    inst.attachedDon > 0 ? `+${inst.attachedDon * 1000} attached DON` : null,
    rested ? 'rested' : 'active',
  ].filter(Boolean).join(', ');
  return (
    <button
      onClick={onTap}
      disabled={!onTap}
      aria-label={ariaLabel}
      title={card.name}
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
      {/* Color dot — visible signal beyond border tint, supports color-blind users. */}
      <div
        aria-hidden="true"
        className={`absolute top-0.5 left-0.5 w-1.5 h-1.5 rounded-full ${
          card.colors[0] === 'red' ? 'bg-red-700' :
          card.colors[0] === 'blue' ? 'bg-blue-700' :
          card.colors[0] === 'green' ? 'bg-green-700' :
          card.colors[0] === 'purple' ? 'bg-purple-700' :
          card.colors[0] === 'black' ? 'bg-black' :
          card.colors[0] === 'yellow' ? 'bg-yellow-500' :
          'bg-stone-500'
        }`}
      />
      {card.cost !== null && (
        <div className="text-[9px] opacity-70">⛁{card.cost}</div>
      )}
      {card.power !== null && (
        <div className="text-[9px]">{card.power}</div>
      )}
      {inst.attachedDon > 0 && (
        <div className="absolute -top-1 -right-1 bg-brass-canary text-ink-black text-[9px] rounded-full w-4 h-4 flex items-center justify-center font-bold" aria-hidden="true">
          +{inst.attachedDon}
        </div>
      )}
    </button>
  );
}
