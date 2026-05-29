// donArm — UI-only Zustand slice for the "tap-to-arm" DON attach interaction.
//
// Engine doesn't model a "selected DON" — the ATTACH_DON action simply pops
// the first DON from donCostArea onto a target. The UI nevertheless needs a
// transient "I'm armed, now tap a target" state so the player can:
//   1. Tap a coin → coin pulses, shows arm ring (CostAreaStrip)
//   2. Tap a character or leader → dispatch ATTACH_DON{ targetInstanceId }
//      and disarm
//   3. Tap the same coin again, or any other coin → re-arm / disarm
//
// This is purely client-side; nothing flows over the wire. Engine receives
// only the final ATTACH_DON dispatch.

import { create } from 'zustand';

interface DonArmStore {
  /** Instance ID of the DON the player has armed for attach, or null. */
  armedDonId: string | null;
  arm: (instanceId: string) => void;
  disarm: () => void;
}

export const useDonArm = create<DonArmStore>((set) => ({
  armedDonId: null,
  arm: (instanceId) => set({ armedDonId: instanceId }),
  disarm: () => set({ armedDonId: null }),
}));
