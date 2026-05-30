// ZoneSlot — playmat-redesign.md §2.
//
// Generic positioned dropzone container for a single card-shaped slot
// (Leader, Stage, Deck, Trash, DON DECK, character slot, life card). Renders:
//
//   - Empty: a dashed cream-on-cream outline ("playmat-slot-empty") with an
//     optional centered wordmark ("LEADER" / "STAGE" / "DECK" / etc.) so the
//     player can identify the empty zone at a glance.
//   - Occupied: just renders children (the card itself), with optional pulsing
//     brass ring overlay when the engine flags this zone as a valid drop
//     target.
//
// Replaces the old ring-1 / dashed-character / ring-marine-fog hodgepodge
// with a single consistent visual language matching the Bandai playsheet:
// gray-on-cream filled zone tiles + dashed empty slots inside them.
//
// data-zone attribute powers the DOMRect-based hit-test in src/lib/hitTest.ts.

import { motion, useReducedMotion } from 'framer-motion';
import type { CSSProperties, ReactNode } from 'react';
import { springs } from '../lib/animationTokens';
import { zoneKey } from '../lib/hitTest';

export type ZoneKind =
  | 'leader'
  | 'character'
  | 'life'
  | 'don'       // legacy alias for donDeck (some hit-test call sites)
  | 'donDeck'
  | 'deck'
  | 'trash'
  | 'stage'
  | 'costArea'
  | 'phase';

interface ZoneSlotProps {
  kind: ZoneKind;
  playerId: 'A' | 'B';
  index?: number;
  /** Engine signals this zone is currently a valid drop target. */
  validDrop?: boolean;
  /** Override the inner empty-state wordmark. Falls back to the kind's
   *  default label (e.g. "Leader", "Stage", "Deck"). Pass `null` for none. */
  emptyLabel?: string | null;
  /** When true the empty-slot dashed outline is suppressed (e.g. character
   *  slots inside the wide CHARACTER AREA band — the band IS the outline). */
  hideEmptyOutline?: boolean;
  /** Explicit dimensions for the slot box. */
  width?: number | string;
  height?: number | string;
  /** Extra className for the outer wrapper. */
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  ariaLabel?: string;
}

const DEFAULT_LABEL: Record<ZoneKind, string | null> = {
  leader: 'Leader',
  character: null, // characters live inside a labeled CHARACTER AREA band
  life: null,      // life cards live inside a labeled LIFE column
  don: 'Don',
  donDeck: 'Don Deck',
  deck: 'Deck',
  trash: 'Trash',
  stage: 'Stage',
  costArea: 'Cost',
  phase: null,
};

export function ZoneSlot({
  kind,
  playerId,
  index,
  validDrop,
  emptyLabel,
  hideEmptyOutline,
  width,
  height,
  className,
  style,
  children,
  ariaLabel,
}: ZoneSlotProps) {
  const reduced = useReducedMotion() ?? false;
  const spring = springs(reduced);
  const id = zoneKey(kind, playerId, index);

  const label =
    emptyLabel === undefined ? DEFAULT_LABEL[kind] : emptyLabel;
  const isOccupied = !!children;

  const wrapperStyle: CSSProperties = {
    width,
    height,
    minWidth: 44, // iOS HIG min hit target
    minHeight: 44,
    // Smooth width animation when slot widens on rest (leader/stage 52 → 72).
    // Owner direction 2026-05-29: rested slot widens so rotated card fits
    // inside its own slot and neighbors shift via flex layout.
    transition: 'width 220ms cubic-bezier(0.4, 0, 0.2, 1)',
    ...style,
  };

  return (
    <motion.div
      data-zone={id}
      role="region"
      aria-label={
        ariaLabel ??
        `${kind} ${playerId}${typeof index === 'number' ? ` slot ${index + 1}` : ''}`
      }
      className={[
        'relative flex items-center justify-center',
        className ?? '',
      ].join(' ')}
      style={wrapperStyle}
      animate={
        validDrop && !reduced
          ? {
              boxShadow: [
                '0 0 0 0px var(--color-sun-brass)',
                '0 0 0 3px var(--color-sun-brass)',
                '0 0 0 0px var(--color-sun-brass)',
              ],
              scale: [1, 1.02, 1],
            }
          : { boxShadow: '0 0 0 0px transparent', scale: 1 }
      }
      transition={validDrop ? spring.zonePulse : { duration: 0.2 }}
    >
      {!isOccupied && !hideEmptyOutline && (
        <div
          className="playmat-slot-empty absolute inset-0 flex items-center justify-center"
          aria-hidden="true"
        >
          {label && (
            <span
              className="playmat-zone__label font-display"
              style={{ fontSize: 9, lineHeight: 1.2, textAlign: 'center' }}
            >
              {label}
            </span>
          )}
        </div>
      )}
      {children}
    </motion.div>
  );
}
