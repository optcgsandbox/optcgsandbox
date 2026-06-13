// donArm — UI-only Zustand slice for the "tap-to-arm" DON attach interaction.
//
// Engine doesn't model a "selected DON" — the ATTACH_DON action simply pops
// the first DON from donCostArea onto a target. The UI nevertheless needs a
// transient "I'm armed, now tap a target" state so the player can:
//   1. Tap one or more coins → each pulses, shows arm ring (CostAreaBand)
//   2. Tap a character or leader → dispatch ATTACH_DON{ targetInstanceId }
//      once PER armed coin (engine pops the first DON each time), then disarm
//   3. Tap an already-armed coin again → deselect just that coin
//
// Multi-select: the armed set is a list of DON instance IDs. Since ATTACH_DON
// pops the FIRST DON regardless of which coin was tapped, the identities are
// cosmetic — only the COUNT matters for how many times we dispatch. Tracking
// IDs (not a bare count) lets each tapped coin show its own arm ring and lets
// a second tap on a specific coin deselect exactly that one.
//
// This is purely client-side; nothing flows over the wire. Engine receives
// only the final ATTACH_DON dispatches.

import { create } from 'zustand';

interface DonArmStore {
  /** Instance IDs of the DON the player has armed for attach (may be empty). */
  armedDonIds: string[];
  /** Add the coin if not armed, remove it if already armed. */
  toggle: (instanceId: string) => void;
  disarm: () => void;
}

export const useDonArm = create<DonArmStore>((set) => ({
  armedDonIds: [],
  toggle: (instanceId) =>
    set((s) => ({
      armedDonIds: s.armedDonIds.includes(instanceId)
        ? s.armedDonIds.filter((id) => id !== instanceId)
        : [...s.armedDonIds, instanceId],
    })),
  disarm: () => set({ armedDonIds: [] }),
}));
