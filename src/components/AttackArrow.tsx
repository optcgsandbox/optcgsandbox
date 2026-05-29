// AttackArrow — visual-spec.md §5.5.
// SVG arc drawn from attacker rect center → target rect center during attack
// declaration. Aiming = dashed seal-red, animating dash offset (looping unless
// reduced-motion). Committed = solid hull-teal with an arrowhead marker.

import { memo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

export type ArrowState = 'aiming' | 'committed';

interface AttackArrowProps {
  from: DOMRect;
  to: DOMRect;
  state?: ArrowState;
}

function midPoint(r: DOMRect): { x: number; y: number } {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * Quadratic-bezier control point lifted off the chord midpoint, perpendicular
 * to the chord direction. Lift = 22% of the chord length — gentle arc that
 * doesn't run off the screen on tall portrait frames.
 */
function controlPoint(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { x: number; y: number } {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  // Perpendicular unit vector — pick the upward direction so the arc bows toward the top.
  let px = -dy / len;
  let py = dx / len;
  if (py > 0) {
    // Bow always away from the bottom of the screen.
    px = -px;
    py = -py;
  }
  const lift = len * 0.22;
  return { x: mx + px * lift, y: my + py * lift };
}

export const AttackArrow = memo(function AttackArrow({
  from,
  to,
  state = 'aiming',
}: AttackArrowProps) {
  const reduced = useReducedMotion() ?? false;
  const a = midPoint(from);
  const b = midPoint(to);
  const c = controlPoint(a, b);
  const path = `M ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`;

  const isAiming = state === 'aiming';
  const stroke = isAiming ? 'var(--color-seal-red)' : 'var(--color-hull-teal)';
  const strokeWidth = isAiming ? 3 : 4;

  return (
    <svg
      className="pointer-events-none fixed inset-0 z-50 h-full w-full"
      aria-hidden="true"
      role="presentation"
      viewBox={`0 0 ${typeof window !== 'undefined' ? window.innerWidth : 430} ${
        typeof window !== 'undefined' ? window.innerHeight : 932
      }`}
      preserveAspectRatio="none"
    >
      <defs>
        <marker
          id="attack-arrowhead"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 Z" fill={stroke} />
        </marker>
      </defs>
      <motion.path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={isAiming ? '6 4' : undefined}
        markerEnd={!isAiming ? 'url(#attack-arrowhead)' : undefined}
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{
          pathLength: 1,
          opacity: 1,
          // Loop dash offset only while aiming AND reduced-motion is off.
          strokeDashoffset: isAiming && !reduced ? [0, -10] : 0,
        }}
        transition={
          isAiming && !reduced
            ? {
                pathLength: { duration: 0.2 },
                opacity: { duration: 0.15 },
                strokeDashoffset: { duration: 0.6, repeat: Infinity, ease: 'linear' },
              }
            : { pathLength: { duration: 0.2 }, opacity: { duration: 0.15 } }
        }
      />
    </svg>
  );
});
