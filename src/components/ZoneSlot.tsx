// ZoneSlot — visual-spec.md §5.2. Generic positioned dropzone container.
// Replaces PlayerSide as the per-zone primitive. Wraps children in a
// pulsing brass ring when the engine flags this zone as a valid drop target.
//
// data-zone attribute powers the DOMRect-based hit-test in src/lib/hitTest.ts.

import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';
import { springs } from '../lib/animationTokens';
import { zoneKey } from '../lib/hitTest';

export type ZoneKind = 'leader' | 'character' | 'life' | 'don' | 'deck' | 'trash';

interface ZoneSlotProps {
  kind: ZoneKind;
  playerId: 'A' | 'B';
  index?: number;
  /** Engine signals this zone is currently a valid drop target. */
  validDrop?: boolean;
  /** Tighten the visual chrome for chrome rows (deck/trash mini stacks). */
  compact?: boolean;
  children?: ReactNode;
  ariaLabel?: string;
}

export function ZoneSlot({
  kind,
  playerId,
  index,
  validDrop,
  compact,
  children,
  ariaLabel,
}: ZoneSlotProps) {
  const reduced = useReducedMotion() ?? false;
  const spring = springs(reduced);
  const id = zoneKey(kind, playerId, index);

  // Minimum tap target = 44pt per iOS HIG. Even when empty, the slot is hit-testable.
  const minDim = compact ? '36px' : '44px';

  return (
    <motion.div
      data-zone={id}
      role="region"
      aria-label={ariaLabel ?? `${kind} ${playerId}${typeof index === 'number' ? ` slot ${index + 1}` : ''}`}
      className="relative rounded-2xl ring-1 ring-marine-fog/40 bg-paper-fog/20 flex items-center justify-center"
      style={{ minWidth: minDim, minHeight: minDim }}
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
      {children}
    </motion.div>
  );
}
