/**
 * Engine V2 — leader game-rule override applier.
 *
 * Port of V1 shared/engine/effectSpec/gameRules-v2.ts. Called once at game
 * setup per player; mutates state's gameRules markers + state.players
 * shape (donDeckSize trim, atStartOfGamePlay stage placement).
 *
 * Markers are READ by:
 *   - if_leader_is condition handler (nameAliases)
 *   - deck-out check (deckOutGracePlayer)
 *   - deck construction validation (bannedEventCostMin) — pre-game, not
 *     runtime engine code
 *
 * Cross-references:
 * - V1 reference: shared/engine/effectSpec/gameRules-v2.ts
 * - Spec impl §10
 */

import type { Card } from '../cards/Card.js';
import type {
  CardId,
  GameRulesOverrides,
  GameState,
  PlayerId,
} from '../state/types.js';

export interface GameRuleOverrideInput {
  readonly donDeckSize?: number;
  readonly nameAliases?: ReadonlyArray<string>;
  readonly deckOutGrace?: 'until_end_of_turn';
  readonly deckRestrictions?: { readonly bannedEventCostMin?: number };
  readonly atStartOfGamePlay?: { readonly filter?: { readonly trait?: string; readonly kind?: string } };
}

/**
 * Apply leader's game-rule override at setup. Mutates state in place.
 * Idempotent — safe to call multiple times (re-applies same markers).
 */
type MutableGameRules = {
  -readonly [K in keyof GameRulesOverrides]: GameRulesOverrides[K];
};

export function applyGameRuleOverride(
  state: GameState,
  controller: PlayerId,
  override: GameRuleOverrideInput,
): GameState {
  const pl = state.players[controller];
  // Build a fresh GameRulesOverrides cumulating prior values.
  const rules: MutableGameRules = { ...(state.gameRules as GameRulesOverrides) };

  // donDeckSize: trim if existing exceeds; cannot extend without minting
  // new instances (setup concern — caller responsibility).
  if (typeof override.donDeckSize === 'number') {
    rules.donDeckSize = override.donDeckSize;
    if (pl.donDeck.length > override.donDeckSize) {
      pl.donDeck = pl.donDeck.slice(0, override.donDeckSize);
    }
  }

  // nameAliases: leader counts as additional names for if_leader_is.
  if (override.nameAliases !== undefined && override.nameAliases.length > 0) {
    const leaderCard = state.cardLibrary[pl.leader.cardId] as Card | undefined;
    if (leaderCard !== undefined) {
      const cur = rules.nameAliases ?? {};
      const merged: Record<CardId, ReadonlyArray<string>> = { ...cur };
      const existing = merged[leaderCard.id] ?? [];
      merged[leaderCard.id] = [...existing, ...override.nameAliases];
      rules.nameAliases = merged;
    }
  }

  // deckOutGrace: mark this controller as having end-of-turn grace.
  if (override.deckOutGrace === 'until_end_of_turn') {
    rules.deckOutGracePlayer = controller;
  }

  // deckRestrictions: stored as marker — deck-building validator reads it.
  if (override.deckRestrictions?.bannedEventCostMin !== undefined) {
    rules.bannedEventCostMin = override.deckRestrictions.bannedEventCostMin;
  }

  // atStartOfGamePlay: find a matching card in deck → move to stage.
  if (override.atStartOfGamePlay !== undefined) {
    const filter = override.atStartOfGamePlay.filter;
    for (let i = 0; i < pl.deck.length; i++) {
      const id = pl.deck[i];
      if (id === undefined) continue;
      const inst = state.instances[id];
      const card = inst !== undefined ? (state.cardLibrary[inst.cardId] as Card | undefined) : undefined;
      if (inst === undefined || card === undefined) continue;
      if (card.kind !== 'stage') continue;
      if (filter?.trait !== undefined && !card.traits.includes(filter.trait)) continue;
      // Remove from deck; trash existing stage if any.
      pl.deck.splice(i, 1);
      if (pl.stage !== null) {
        const prev = pl.stage;
        while (prev.attachedDon.length > 0) {
          const donId = prev.attachedDon.shift();
          if (donId !== undefined) pl.donRested.push(donId);
        }
        while (prev.attachedDonRested.length > 0) {
          const donId = prev.attachedDonRested.shift();
          if (donId !== undefined) pl.donRested.push(donId);
        }
        pl.trash.push(prev.instanceId);
      }
      pl.stage = inst;
      // Record marker for the placement.
      const seed = rules.atStartOfGamePlay ?? [];
      rules.atStartOfGamePlay = [...seed, { cardId: card.id, player: controller }];
      break;
    }
  }

  // Commit the new rules object (state.gameRules is `readonly` on its keys
  // but the object itself is replaceable).
  (state as { gameRules: GameRulesOverrides }).gameRules = rules;
  return state;
}
