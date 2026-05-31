// View-restriction helpers. Per docs/optcg-sim/ai-design.md §2.
//
// Returns a redacted GameState where zones a given viewer is not allowed to
// inspect have their card identities replaced with `UNKNOWN_CARD`. Counts and
// instance IDs are preserved so legal-action enumeration + UI counters still
// work against the redacted view.
//
// Engine code (applyAction / phase reducers) NEVER consumes redacted state —
// it always operates on the real state, because the simulator must know real
// cards to advance physics. The redacted view is consumed only by AI tiers
// that need a single-source guarantee they cannot read hidden info during
// decision-making.

import type { Card } from '../cards/Card';
import type { CardInstance, GameState, PlayerId, PlayerZones } from '../GameState';

/** Placeholder card representing "hidden — identity not known to viewer."
 *  Cost/power are zeroed so any code path that defensively reads them gets
 *  benign values; the AI's evaluator is the only consumer and it never
 *  inspects redacted-zone card data. */
export const UNKNOWN_CARD: Card = {
  id: 'UNKNOWN',
  name: 'Unknown',
  kind: 'character',
  colors: [],
  cost: 0,
  power: 0,
  counterValue: null,
  traits: [],
  keywords: [],
  effectTags: [],
};

/** Return a structurally identical GameState where all zones hidden from
 *  `viewer` have their instance cardIds rewritten to UNKNOWN_CARD.id.
 *
 *  Hidden from viewer:
 *    - viewer.deck (order is hidden — composition is known separately via decklist)
 *    - viewer.life (face-down)
 *    - opp.hand
 *    - opp.deck
 *    - opp.life
 *
 *  Visible (untouched):
 *    - viewer.hand, viewer.field, viewer.stage, viewer.leader, viewer.trash
 *    - opp.field, opp.stage, opp.leader, opp.trash
 *    - both donDeck / donCostArea / donRested (DON has a single canonical identity)
 *    - history (already a public log)
 */
export function viewForPlayer(state: GameState, viewer: PlayerId): GameState {
  const opp: PlayerId = viewer === 'A' ? 'B' : 'A';

  // Build the redacted instance map. Clone every instance; for hidden-zone
  // members swap cardId → UNKNOWN_CARD.id.
  const hiddenIds = new Set<string>();
  for (const id of state.players[viewer].deck) hiddenIds.add(id);
  for (const id of state.players[viewer].life) hiddenIds.add(id);
  for (const id of state.players[opp].hand) hiddenIds.add(id);
  for (const id of state.players[opp].deck) hiddenIds.add(id);
  for (const id of state.players[opp].life) hiddenIds.add(id);

  // V3-9: lift redaction for any instance the viewer has legitimately seen
  // via a past effect (peek / reveal / take). state.knownByViewer is the
  // canonical overlay; we read it defensively to support older state shapes.
  const knownIds = state.knownByViewer?.[viewer] ?? [];
  for (const id of knownIds) hiddenIds.delete(id);

  const instances: Record<string, CardInstance> = {};
  for (const [id, inst] of Object.entries(state.instances)) {
    if (hiddenIds.has(id)) {
      instances[id] = { ...inst, cardId: UNKNOWN_CARD.id };
    } else {
      instances[id] = inst;
    }
  }

  const cardLibrary: Record<string, Card> = {
    ...state.cardLibrary,
    [UNKNOWN_CARD.id]: UNKNOWN_CARD,
  };

  // Player zones are returned by reference for visible portions — only the
  // arrays themselves are shallow-copied because the engine treats state as
  // immutable, so any mutation in the AI layer would already be a bug.
  const players: Record<PlayerId, PlayerZones> = {
    A: { ...state.players.A },
    B: { ...state.players.B },
  };

  return {
    ...state,
    instances,
    cardLibrary,
    players,
  };
}

/** Multiset of cards the viewer believes are still in their (deck + life).
 *
 *  Computed as: viewer's decklist (leader excluded — leader lives in its own
 *  slot) minus cards currently in viewer's hand / field / stage / trash. The
 *  result counts both deck cards (face-down, awaiting draw) AND life cards
 *  (face-down, may be flipped on damage). Both are "cards I shipped with that
 *  I haven't seen yet" from the viewer's perspective.
 *
 *  Use the raw GameState here, not the redacted view — the redacted view
 *  would replace decklist contents with UNKNOWN. The viewer is reasoning
 *  about their OWN deck so the real identities are legitimately known.
 */
export function knownDeckResidual(state: GameState, viewer: PlayerId): Card[] {
  const zones = state.players[viewer];
  const exposed = new Set<string>();
  for (const id of zones.hand) exposed.add(id);
  for (const id of zones.trash) exposed.add(id);
  if (zones.stage) exposed.add(zones.stage.instanceId);
  for (const inst of zones.field) exposed.add(inst.instanceId);

  const residual: Card[] = [];
  for (const id of zones.deck) {
    if (exposed.has(id)) continue;
    const inst = state.instances[id];
    if (!inst) continue;
    const card = state.cardLibrary[inst.cardId];
    if (card) residual.push(card);
  }
  for (const id of zones.life) {
    if (exposed.has(id)) continue;
    const inst = state.instances[id];
    if (!inst) continue;
    const card = state.cardLibrary[inst.cardId];
    if (card) residual.push(card);
  }
  return residual;
}

/** P(next draw matches predicate), uniform over the deck portion of the
 *  residual. Life cards are excluded from this denominator because they are
 *  not drawn from the top of the deck — they only flip on damage. */
export function drawProbability(
  state: GameState,
  viewer: PlayerId,
  predicate: (card: Card) => boolean,
): number {
  const zones = state.players[viewer];
  if (zones.deck.length === 0) return 0;
  let matches = 0;
  for (const id of zones.deck) {
    const inst = state.instances[id];
    if (!inst) continue;
    const card = state.cardLibrary[inst.cardId];
    if (card && predicate(card)) matches++;
  }
  return matches / zones.deck.length;
}
