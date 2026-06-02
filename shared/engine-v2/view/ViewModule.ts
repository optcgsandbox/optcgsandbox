/**
 * Engine V2 — view redactor (M17).
 *
 * Port of V1's `shared/engine/view/viewForPlayer.ts`. Returns a structurally
 * identical GameState where every instance in a zone hidden from `viewer`
 * has its `cardId` rewritten to `UNKNOWN_CARD.id`. Counts + instance IDs
 * preserved so legal-action enumeration + UI counters still work.
 *
 * Engine reducers / phase scheduler / action handlers NEVER consume the
 * redacted view — they always operate on the real GameState. The redacted
 * view is consumed by AI tiers (and the network/MP layer when shipping
 * state to the opposing client) so they can't read hidden info.
 *
 * Cross-references:
 * - Implementation spec §13 + §13.1 (redaction rule)
 * - Plan v2 §5.10
 * - V1 reference: shared/engine/view/viewForPlayer.ts:50
 */

import type { Card } from '../cards/Card.js';
import {
  type CardId,
  type CardInstance,
  type GameState,
  type InstanceId,
  OTHER_PLAYER,
  type PlayerId,
} from '../state/types.js';

export const VIEW_SCHEMA_VERSION = 2;

/**
 * Placeholder card representing "hidden — identity not known to viewer".
 * Cost/power zeroed so any defensive read returns benign values; AI's
 * evaluator never inspects redacted-zone card data.
 */
export const UNKNOWN_CARD: Card = {
  id: 'UNKNOWN',
  name: 'Unknown',
  kind: 'character',
  cost: 0,
  power: 0,
  counterValue: null,
  colors: [],
  traits: [],
  keywords: [],
  effectText: '',
};

/**
 * Returns a redacted GameState. Hidden-from-viewer zones (viewer.deck,
 * viewer.life, opp.hand, opp.deck, opp.life) have cardIds rewritten to
 * UNKNOWN_CARD.id. `state.knownByViewer[viewer]` overlay LIFTS redaction
 * for instances the viewer has legitimately seen via prior effects.
 *
 * Face-up life cards (state.players[side].lifeFaceUp[id]===true) are
 * PUBLIC — not redacted.
 */
export function viewForPlayer(state: GameState, viewer: PlayerId): GameState {
  const opp = OTHER_PLAYER[viewer];
  const viewerZ = state.players[viewer];
  const oppZ = state.players[opp];

  const hidden = new Set<InstanceId>();
  for (const id of viewerZ.deck) hidden.add(id);
  for (const id of viewerZ.life) {
    if (viewerZ.lifeFaceUp[id] !== true) hidden.add(id);
  }
  for (const id of oppZ.hand) hidden.add(id);
  for (const id of oppZ.deck) hidden.add(id);
  for (const id of oppZ.life) {
    if (oppZ.lifeFaceUp[id] !== true) hidden.add(id);
  }

  // Lift redaction for explicitly-known instances.
  const known = state.knownByViewer[viewer] ?? [];
  for (const id of known) hidden.delete(id);

  // Rewrite hidden instances' cardIds.
  const instances: Record<InstanceId, CardInstance> = {};
  for (const [id, inst] of Object.entries(state.instances)) {
    if (hidden.has(id)) {
      instances[id] = { ...inst, cardId: UNKNOWN_CARD.id };
    } else {
      instances[id] = inst;
    }
  }

  const cardLibrary: Record<CardId, Card> = {
    ...(state.cardLibrary as Record<CardId, Card>),
    [UNKNOWN_CARD.id]: UNKNOWN_CARD,
  };

  return {
    ...state,
    instances,
    cardLibrary,
  };
}

/**
 * Multiset of cards the viewer believes are still in their (deck + life).
 * Computed as decklist contents minus public/exposed cards. Real
 * identities are used here since the viewer legitimately knows their own
 * decklist.
 */
export function knownDeckResidual(state: GameState, viewer: PlayerId): Card[] {
  const zones = state.players[viewer];
  const exposed = new Set<InstanceId>();
  for (const id of zones.hand) exposed.add(id);
  for (const id of zones.trash) exposed.add(id);
  if (zones.stage !== null) exposed.add(zones.stage.instanceId);
  for (const inst of zones.field) exposed.add(inst.instanceId);
  exposed.add(zones.leader.instanceId);

  const residual: Card[] = [];
  for (const id of zones.deck) {
    if (exposed.has(id)) continue;
    const inst = state.instances[id];
    if (inst === undefined) continue;
    const card = state.cardLibrary[inst.cardId] as Card | undefined;
    if (card !== undefined) residual.push(card);
  }
  for (const id of zones.life) {
    if (exposed.has(id)) continue;
    const inst = state.instances[id];
    if (inst === undefined) continue;
    const card = state.cardLibrary[inst.cardId] as Card | undefined;
    if (card !== undefined) residual.push(card);
  }
  return residual;
}

/**
 * P(next draw from top of viewer's deck matches predicate). Uniform over
 * deck portion — life cards excluded (they only flip on damage, never
 * drawn). Used by AI tiers for lookahead.
 */
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
    if (inst === undefined) continue;
    const card = state.cardLibrary[inst.cardId] as Card | undefined;
    if (card !== undefined && predicate(card)) matches += 1;
  }
  return matches / zones.deck.length;
}
