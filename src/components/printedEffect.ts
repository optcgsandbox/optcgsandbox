// printedEffect — F-8D: prompts show the card's PRINTED effect text, never
// internal action/cost keys. Pure presentation helper: extracts the segment
// of `card.effectText` that belongs to the firing trigger so multi-ability
// cards don't dump unrelated text into a prompt. Mapping is rules
// vocabulary (trigger key → printed timing marker) — zero card-specific
// logic. Falls back to the full printed text when no marker matches, and
// the caller falls back to the engine-generated summary when the card has
// no printed text at all (synthetic/test cards).

/** Printed timing markers that START a new ability segment. */
const SEGMENT_MARKERS = [
  '[On Play]',
  '[When Attacking]',
  '[Activate: Main]',
  '[Activate:Main]',
  '[On K.O.]',
  '[Trigger]',
  '[On Block]',
  '[Blocker]',
  '[Counter]',
  '[Main]',
  '[End of Your Turn]',
  '[On Your Opponent’s Attack]',
  "[On Your Opponent's Attack]",
] as const;

/** Engine trigger key → the printed markers it corresponds to. */
const TRIGGER_TO_MARKERS: Readonly<Record<string, ReadonlyArray<string>>> = {
  on_play: ['[On Play]'],
  when_attacking: ['[When Attacking]'],
  activate_main: ['[Activate: Main]', '[Activate:Main]', '[Main]'],
  on_ko: ['[On K.O.]'],
  trigger: ['[Trigger]'],
  on_block: ['[On Block]', '[Blocker]'],
  counter: ['[Counter]'],
  end_of_turn: ['[End of Your Turn]'],
  on_opponent_attack: ['[On Your Opponent’s Attack]', "[On Your Opponent's Attack]"],
};

/** Index of the segment marker the trigger maps to, or -1. */
function markerIndexFor(effectText: string, trigger: string): number {
  const markers = TRIGGER_TO_MARKERS[trigger];
  if (markers === undefined) return -1;
  for (const m of markers) {
    const idx = effectText.indexOf(m);
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * The printed-text segment for `trigger`: from the trigger's timing marker
 * (including any condition/DON!! modifier brackets directly before it) up
 * to the next segment marker. Whole text when the trigger marker is absent;
 * null when the card has no printed text.
 */
export function printedSegmentFor(
  effectText: string | undefined,
  trigger: string | undefined,
): string | null {
  const text = (effectText ?? '').trim();
  if (text === '') return null;
  if (trigger === undefined) return text;

  let start = markerIndexFor(text, trigger);
  if (start === -1) return text;

  // Back up over modifier brackets directly preceding the timing marker
  // (e.g. "[DON!! x1] [When Attacking] ..." / "[Once Per Turn] [On Play]").
  for (;;) {
    const before = text.slice(0, start).trimEnd();
    if (!before.endsWith(']')) break;
    const open = before.lastIndexOf('[');
    if (open === -1) break;
    const bracket = before.slice(open);
    // Never swallow a previous SEGMENT marker.
    if ((SEGMENT_MARKERS as ReadonlyArray<string>).includes(bracket)) break;
    start = open;
  }

  // Segment runs to the next segment marker after the trigger's own marker.
  const afterMarker = markerIndexFor(text, trigger) + 1;
  let end = text.length;
  for (const m of SEGMENT_MARKERS) {
    const idx = text.indexOf(m, afterMarker);
    if (idx !== -1 && idx > afterMarker && idx < end && idx > start) end = idx;
  }
  return text.slice(start, end).trim();
}
