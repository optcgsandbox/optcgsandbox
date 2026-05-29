// NavyCardBack — playmat-redesign.md §3.7.
//
// Shared face-down card back for the main deck, hand cards drawn face-down,
// and the life stack (life cards are deck cards waiting to be drawn per
// CR §5-2-1-7, so they share the same navy back).
//
// Rule-manual.pdf p2 shows Bandai's Character/Event/Stage back: deep navy
// body, brass compass rose at center, "ONE PIECE CARD GAME" wordmark below.
// We use "CREW SIM" to avoid the trademark.
//
// The component absolutely-fills its parent so it can be dropped into any
// card-sized container without sizing math.

import { memo } from 'react';

interface NavyCardBackProps {
  /** When true the wordmark is hidden — useful at lifeStack 28×38 where the
   *  text would be unreadable. */
  hideWordmark?: boolean;
  /** Override the rounding to match the parent card's radius. */
  radius?: number;
}

export const NavyCardBack = memo(function NavyCardBack({
  hideWordmark = false,
  radius = 4,
}: NavyCardBackProps) {
  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{
        borderRadius: radius,
        // Deep navy ground with a soft top-down sheen so the back reads like
        // a physical printed card, not a flat rectangle.
        background:
          'radial-gradient(ellipse at 50% 20%, #143C40 0%, #082A2D 65%, #04161A 100%)',
        boxShadow:
          'inset 0 0 0 1px rgba(212,160,23,0.30), 0 1px 2px rgba(0,0,0,0.35)',
      }}
      aria-hidden="true"
    >
      {/* Brass-canary inset hairline frame — Bandai-back signature. */}
      <div
        className="absolute"
        style={{
          inset: 2.5,
          borderRadius: Math.max(0, radius - 1.5),
          boxShadow: 'inset 0 0 0 0.75px rgba(212,160,23,0.55)',
        }}
      />
      {/* Compass rose — concentric ring + crossed needle diamonds. */}
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{ paddingBottom: hideWordmark ? 0 : '20%' }}
      >
        <svg
          viewBox="0 0 24 24"
          className="text-brass-canary"
          style={{ width: '58%', height: '58%' }}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx={12} cy={12} r={7.5} opacity={0.85} />
          <circle cx={12} cy={12} r={5} opacity={0.55} />
          {/* North-south needle (filled hot, dimmed cold). */}
          <polygon
            points="12,4 13.6,12 12,20 10.4,12"
            fill="currentColor"
            fillOpacity={0.9}
            stroke="none"
          />
          {/* East-west crossbar. */}
          <polygon
            points="4,12 12,10.6 20,12 12,13.4"
            fill="currentColor"
            fillOpacity={0.45}
            stroke="none"
          />
          {/* Tiny center pivot bead. */}
          <circle cx={12} cy={12} r={0.9} fill="#082A2D" stroke="currentColor" strokeWidth={0.6} />
        </svg>
      </div>
      {/* Wordmark sits at the bottom of the card, mirroring the Bandai back. */}
      {!hideWordmark && (
        <div
          className="absolute inset-x-0 flex items-center justify-center"
          style={{ bottom: '10%' }}
        >
          <span
            className="font-display tabular text-brass-canary/90"
            style={{
              fontSize: 'clamp(5.5px, 1.4cqw, 8px)',
              letterSpacing: '0.14em',
              lineHeight: 1,
              textShadow: '0 1px 0 rgba(0,0,0,0.45)',
            }}
          >
            CREW SIM
          </span>
        </div>
      )}
    </div>
  );
});
