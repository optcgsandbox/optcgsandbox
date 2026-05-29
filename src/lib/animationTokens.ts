// Animation tokens — visual-spec.md §7. Concrete numeric tokens for spring + tween.
// Components import the appropriate token rather than inlining magic numbers.
// useReducedMotion() at the component level swaps to SPRING_REDUCED.

import type { Transition } from 'framer-motion';

export const SPRING: Record<string, Transition> = {
  // Card travel: hand → field, deck → hand, KO → trash.
  cardTravel: { type: 'spring', stiffness: 260, damping: 28 },
  // Hand re-fan when adding/removing cards.
  handFan: { type: 'spring', stiffness: 300, damping: 30 },
  // Phase ribbon swap, chrome tweaks — ease-out-quart.
  ribbonSwap: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
  // Attack slam impact frame.
  attackSlam: { duration: 0.06, ease: [0.4, 0, 1, 1] },
  // Attack return to origin.
  attackReturn: { type: 'spring', stiffness: 220, damping: 20 },
  // Life flip rotation.
  lifeFlip: { duration: 0.3, ease: [0.22, 1, 0.36, 1] },
  // DON token deal stagger (parent variant carries staggerChildren).
  donStagger: { type: 'spring', stiffness: 280, damping: 26 },
  // Zone highlight pulse — loops.
  zonePulse: { duration: 1, repeat: Infinity, ease: 'easeInOut' },
  // KO discard.
  koDiscard: { duration: 0.25 },
};

// Reduced motion: snap to final state with a near-zero duration.
// Spec §7: looping pulses and dash-animated arrows must stop entirely.
export const SPRING_REDUCED: Record<string, Transition> = Object.fromEntries(
  Object.keys(SPRING).map((k) => [k, { duration: 0.01 }]),
);

// Convenience: hooked at component level to pick the right set.
export function springs(reducedMotion: boolean): Record<string, Transition> {
  return reducedMotion ? SPRING_REDUCED : SPRING;
}

// DON stagger child delay (used at the parent transition level).
export const STAGGER_DON = 0.06;
