// DOMRect-based zone hit-test — animation-architecture.md §1.2.
// Drag handlers cache zone rects (recomputed on resize) and call hitTestZone
// inside onDragEnd. We avoid document.elementFromPoint inside onDrag because
// it forces a layout pass on iOS Safari.

export interface ZoneRect {
  /** data-zone attribute value, e.g. "character:A:0", "leader:B", "trash:A". */
  zoneId: string;
  rect: DOMRect;
}

/**
 * Snapshot every element carrying `data-zone="…"` into a stable list of
 * {zoneId, rect}. Call after layout (mount, resize, orientation change).
 */
export function snapshotZones(root: HTMLElement | Document = document): ZoneRect[] {
  const nodes = root.querySelectorAll<HTMLElement>('[data-zone]');
  const result: ZoneRect[] = [];
  for (const node of nodes) {
    const zoneId = node.dataset.zone;
    if (!zoneId) continue;
    result.push({ zoneId, rect: node.getBoundingClientRect() });
  }
  return result;
}

/**
 * Returns the first zone containing the (x, y) viewport point.
 * Iteration order matches DOM order — leader and character slots overlap
 * the playmat field so list more-specific zones (character slots) before
 * the field background when wiring up call sites.
 */
export function hitTestZone(
  x: number,
  y: number,
  zones: ZoneRect[],
): string | null {
  for (const { zoneId, rect } of zones) {
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      return zoneId;
    }
  }
  return null;
}

/** Build the canonical zone key — keep in sync with ZoneSlot's data-zone attribute.
 *  `stage`, `donDeck`, `costArea` and `phase` were added 2026-05-29 for the
 *  official Bandai playmat rebuild (design-reference.md §3.4). */
export function zoneKey(
  kind:
    | 'leader'
    | 'character'
    | 'life'
    | 'don'
    | 'donDeck'
    | 'deck'
    | 'trash'
    | 'stage'
    | 'costArea'
    | 'phase',
  playerId: 'A' | 'B',
  index?: number,
): string {
  if (kind === 'character' && typeof index === 'number') {
    return `character:${playerId}:${index}`;
  }
  return `${kind}:${playerId}`;
}
