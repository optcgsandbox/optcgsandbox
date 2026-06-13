// useWarmVisibleCards — reactively warm the card-image cache for every card
// the player can currently SEE, so tapping any of them to enlarge is instant.
//
// Owner goal (2026-06-12): "once I click a card to view it, it loads
// instantly." Boot-time prefetch covers your own deck; this covers everything
// else you're allowed to view as it appears — the opponent's played cards,
// stages, trash piles, flipped life. Driven purely off VISIBLE zones, so it's
// online-safe by construction: the opponent's hidden hand/deck are never
// walked (and in online they aren't even in the client's state). Dedup +
// concurrency live in prefetchCardImages, so re-running on every state tick is
// cheap (Set lookups).

import { useEffect } from 'react';
import { useGameStore } from '../store/game';
import { prefetchCardImages } from '../lib/prefetchCardImages';

export function useWarmVisibleCards(): void {
  const state = useGameStore((s) => s.state);
  const viewAs = useGameStore((s) => s.viewAs);

  useEffect(() => {
    const ids: string[] = [];
    const push = (iid: string | undefined | null): void => {
      if (!iid) return;
      const cid = state.instances[iid]?.cardId;
      if (cid) ids.push(cid);
    };

    // Both leaders are public.
    push(state.players.A.leader.instanceId);
    push(state.players.B.leader.instanceId);
    // Your own hand (the opponent's hand is hidden — never walked).
    for (const iid of state.players[viewAs].hand) push(iid);
    // Public board + trash + face-up life for BOTH players.
    for (const p of ['A', 'B'] as const) {
      const z = state.players[p];
      for (const inst of z.field) push(inst.instanceId);
      if (z.stage) push(z.stage.instanceId);
      for (const iid of z.trash) push(iid);
      for (const iid of z.life) if (z.lifeFaceUp[iid]) push(iid);
    }

    if (ids.length > 0) prefetchCardImages(ids);
  }, [state, viewAs]);
}
