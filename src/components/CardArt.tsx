// CardArt — visual-spec.md §5.3. Replaces CardChip.
// Renders real card art when card.imageUrl is present, otherwise a colored
// gradient fallback with name + cost + power. Face-down cards show the
// generic anchor-and-rope card back (SVG, no Bandai imagery).

import { memo, useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { Card } from '@shared/engine/cards/Card';
import type { CardInstance } from '@shared/engine/GameState';
import { springs } from '../lib/animationTokens';

export type CardArtSize = 'hand' | 'field' | 'leader' | 'mini';

// OPTCG cards are 600:838 ~ 0.716 aspect. Heights chosen so:
//  - hand cards comfortably hit ≥ 44pt tap targets (HIG)
//  - 5 character slots fit horizontally within 430px frame
//  - leader is 1.15× the character slot focal
export const CARD_DIMS: Record<CardArtSize, { w: number; h: number }> = {
  hand: { w: 92, h: 128 },
  field: { w: 60, h: 84 },
  leader: { w: 72, h: 100 },
  mini: { w: 28, h: 40 },
};

interface CardArtProps {
  /** Engine instance — provides instanceId for layoutId and per-instance state (rest, attached DON). */
  inst?: CardInstance;
  card?: Card;
  size: CardArtSize;
  faceDown?: boolean;
  onTap?: () => void;
  highlighted?: boolean;
  /** When true, render with a glowing valid-drop ring. */
  validDrop?: boolean;
}

// Deterministic color tint per color, used as the fallback when no image URL exists.
const COLOR_FILL: Record<string, string> = {
  red: '#A8261F',
  blue: '#1D4FA8',
  green: '#2A7A3F',
  purple: '#5D2C7B',
  black: '#15140F',
  yellow: '#D4A017',
};

function describeForA11y(card: Card | undefined, inst: CardInstance | undefined): string {
  if (!card) return 'Card';
  const parts: string[] = [card.name];
  if (card.kind) parts.push(card.kind);
  if (card.cost !== null && card.cost !== undefined) parts.push(`cost ${card.cost}`);
  if (card.power !== null && card.power !== undefined) parts.push(`power ${card.power}`);
  if (inst?.attachedDon && inst.attachedDon > 0) {
    parts.push(`+${inst.attachedDon * 1000} attached DON`);
  }
  if (inst?.rested) parts.push('rested');
  return parts.join(', ');
}

/**
 * Deterministic placeholder gradient when card art is missing.
 * Seeded by card.id so the same card always paints the same way.
 */
function PlaceholderArt({ card }: { card: Card }) {
  const primary = COLOR_FILL[card.colors[0] ?? ''] ?? '#3A372E';
  // Hash card.id → secondary hue, keeps v0.1 visually varied.
  const seed = useMemo(() => {
    let h = 0;
    for (const ch of card.id) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return Math.abs(h) % 360;
  }, [card.id]);
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-between p-1 text-paper-cream"
      style={{
        background: `linear-gradient(155deg, ${primary} 0%, hsl(${seed}, 35%, 22%) 100%)`,
      }}
      aria-hidden="true"
    >
      <span className="font-display text-[0.65rem] leading-tight text-center w-full truncate px-0.5">
        {card.name}
      </span>
      <div className="flex w-full justify-between px-0.5 text-[0.6rem] font-body font-bold tabular">
        {card.cost !== null && <span>{card.cost}c</span>}
        {card.power !== null && <span>{card.power}</span>}
      </div>
    </div>
  );
}

/** Anchor-on-teal generic card back, drawn inline. v0.1 placeholder for the commissioned asset. */
function CardBack() {
  return (
    <div
      className="absolute inset-0 bg-hull-teal flex items-center justify-center"
      aria-hidden="true"
    >
      <div className="absolute inset-1 rounded-lg ring-1 ring-brass-canary/70" />
      <svg viewBox="0 0 24 24" className="w-1/2 h-1/2 text-brass-canary" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {/* anchor — generic sea-adventure motif, no Bandai/One Piece IP */}
        <circle cx="12" cy="5" r="1.6" />
        <line x1="12" y1="6.6" x2="12" y2="20" />
        <line x1="9" y1="9" x2="15" y2="9" />
        <path d="M5 15c0 3 3 5 7 5s7-2 7-5" />
        <line x1="5" y1="15" x2="3.5" y2="13.5" />
        <line x1="19" y1="15" x2="20.5" y2="13.5" />
      </svg>
    </div>
  );
}

/** Floating life pill above leader's top edge — visual-spec §5.3. */
function LifePill({ count }: { count: number }) {
  return (
    <div
      className="absolute -top-3 left-1/2 -translate-x-1/2 z-10
                 bg-paper-cream ring-2 ring-seal-red rounded-full
                 px-2 py-0.5 shadow-card"
      aria-label={`Life ${count}`}
    >
      <span className="font-display text-[0.95rem] leading-none text-ink-black tabular">
        {count}
      </span>
    </div>
  );
}

/** Attached DON badge top-right — keeps reading of "+N" boost. */
function DonBadge({ count }: { count: number }) {
  return (
    <motion.div
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      transition={{ type: 'spring', stiffness: 500, damping: 25 }}
      className="absolute -top-1 -right-1 bg-brass-canary text-ink-black
                 text-[0.6rem] font-body font-bold rounded-full
                 w-4 h-4 flex items-center justify-center tabular"
      aria-hidden="true"
    >
      +{count}
    </motion.div>
  );
}

export const CardArt = memo(function CardArt({
  inst,
  card,
  size,
  faceDown,
  onTap,
  highlighted,
  validDrop,
}: CardArtProps) {
  const dims = CARD_DIMS[size];
  const reduced = useReducedMotion() ?? false;
  const spring = springs(reduced);
  const isLeader = card?.kind === 'leader';
  const lifeCount = isLeader && card && 'life' in card ? card.life : undefined;
  // Engine-level life lives in PlayerZones, but the leader card's printed life
  // is the *initial* count; the playing pill source-of-truth is set by the
  // composer that places the leader. Render only when explicitly provided.

  const a11y = describeForA11y(card, inst);
  const interactive = !!onTap && size !== 'mini';

  const base = (
    <motion.button
      layoutId={inst?.instanceId}
      layout
      onClick={onTap}
      disabled={!interactive}
      aria-label={a11y}
      title={card?.name}
      transition={spring.cardTravel}
      whileHover={interactive && !reduced ? { y: -2, transition: { duration: 0.15 } } : undefined}
      whileTap={interactive && !reduced ? { scale: 0.97 } : undefined}
      style={{ width: dims.w, height: dims.h }}
      className={[
        'relative rounded-xl overflow-visible',
        'outline-none focus-visible:ring-2 focus-visible:ring-sun-brass',
        interactive ? 'cursor-pointer' : 'cursor-default',
        inst?.rested ? 'rotate-90' : '',
        highlighted ? 'ring-2 ring-brass-canary' : '',
      ].join(' ')}
    >
      <div
        className="absolute inset-0 rounded-xl overflow-hidden shadow-[0_4px_12px_rgba(15,20,15,0.18)]"
        style={validDrop ? { boxShadow: '0 0 0 3px var(--color-sun-brass), 0 4px 12px rgba(15,20,15,0.18)' } : undefined}
      >
        {faceDown || !card ? (
          <CardBack />
        ) : card.imageUrl ? (
          // v0.1: corpus has no real image URLs yet. When provided later, this branch
          // renders the Bandai SAMPLE-watermarked WebP from Cloudflare R2.
          <img
            src={card.imageUrl}
            alt=""
            className="w-full h-full object-cover"
            decoding={size === 'hand' || size === 'leader' ? 'sync' : 'async'}
            loading={size === 'mini' ? 'lazy' : 'eager'}
          />
        ) : (
          <PlaceholderArt card={card} />
        )}
      </div>
      {isLeader && typeof lifeCount === 'number' && <LifePill count={lifeCount} />}
      {inst && inst.attachedDon > 0 && <DonBadge count={inst.attachedDon} />}
    </motion.button>
  );

  return base;
});

// Add `imageUrl` to the Card type via module augmentation so engine types stay
// pure. Engine never reads imageUrl; only CardArt does.
declare module '@shared/engine/cards/Card' {
  interface CardBase {
    imageUrl?: string;
  }
}
