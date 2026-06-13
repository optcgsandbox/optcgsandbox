// presentationBusy — a tiny shared flag bridging the PresentationQueue (a
// React component that owns the cinematic beat queue) and the AI turn loop
// (in the game store, outside React).
//
// Owner 2026-06-12: the AI used to advance on a FIXED ~1.3s timer regardless
// of how long a move's animation actually took, so a long beat-chain (play →
// on-play effect → combat result) got cut off when the AI fired its next
// move. PresentationQueue now publishes whether any beat is playing/queued
// here; the AI loop waits for this to clear (floored at the 1.3s rhythm,
// ceiling-capped so it can never hang) before its next move or end-turn.

import { create } from 'zustand';

interface PresentationBusyStore {
  /** True while a cinematic beat is playing or queued. */
  busy: boolean;
  setBusy: (busy: boolean) => void;
}

export const usePresentationBusy = create<PresentationBusyStore>((set) => ({
  busy: false,
  setBusy: (busy) => set((s) => (s.busy === busy ? s : { busy })),
}));
