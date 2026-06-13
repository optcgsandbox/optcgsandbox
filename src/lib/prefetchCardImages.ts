// prefetchCardImages — warm the Workbox `card-images` runtime cache
// (vite.config.ts) ahead of the player tapping a card to enlarge it.
//
// Owner goal (2026-06-12): "once I click a card to view it, it loads
// instantly." Card art is a real PNG fetched from R2 on first render, so a
// never-seen card flashes blank → loads. Warming the cache up front (your
// own deck) and reactively (cards as they enter your VISIBLE state) closes
// that gap. Online-safe by construction: this only ever receives card IDs
// the client already legitimately knows — your own decklist, or cards the
// server has revealed into your PublicGameState. It NEVER sees the
// opponent's hidden deck, so it can't leak or over-fetch it.
//
// Mechanism: a detached `new Image()` whose src triggers the same GET the
// <img> tag would, which the Workbox CacheFirst rule stores. Deduped via a
// module-level Set so each id is warmed at most once per session. Capped
// concurrency so a 50-card warm doesn't saturate the connection and starve
// the on-screen thumbnails that are fetching at the same time.

import { cardIdToR2Url } from './cardImageUrl';

/** Card ids whose image has been warmed (or is in flight) this session. */
const warmed = new Set<string>();
/** URLs queued but not yet started (concurrency gate). */
const queue: string[] = [];
let inFlight = 0;
const MAX_CONCURRENT = 4;

function pump(): void {
  while (inFlight < MAX_CONCURRENT && queue.length > 0) {
    const url = queue.shift()!;
    inFlight += 1;
    const img = new Image();
    const done = (): void => {
      inFlight -= 1;
      pump();
    };
    img.onload = done;
    // On error we still release the slot; the <img> tag's own onError will
    // fall back to the placeholder if the card genuinely has no art.
    img.onerror = done;
    img.decoding = 'async';
    img.src = url;
  }
}

/**
 * Warm the given card ids in the background. `priority` ids are enqueued
 * first (e.g. the opening hand before the rest of the deck). Non-OPTCG ids
 * (DON, test ids) and already-warmed ids are skipped. Fire-and-forget —
 * never blocks, never throws.
 */
export function prefetchCardImages(
  cardIds: Iterable<string>,
  priority: Iterable<string> = [],
): void {
  if (typeof window === 'undefined' || typeof Image === 'undefined') return;
  const enqueue = (id: string, front: boolean): void => {
    if (warmed.has(id)) return;
    const url = cardIdToR2Url(id);
    if (url === null) return;
    warmed.add(id);
    if (front) queue.unshift(url);
    else queue.push(url);
  };
  // Priority first (front of queue), in order.
  for (const id of priority) enqueue(id, true);
  for (const id of cardIds) enqueue(id, false);
  pump();
}

/** Test/diagnostic hook — reset the warmed-set + queue. */
export function __resetPrefetchForTest(): void {
  warmed.clear();
  queue.length = 0;
  inFlight = 0;
}
