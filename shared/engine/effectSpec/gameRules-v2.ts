// Game-rule overrides — Phase A.3.8.
//
// Per-leader rule changes that apply for the entire game. Examples:
//   - "Under the rules of this game, your DON!! deck consists of 6 cards"
//     (OP15-058)
//   - "Under the rules of this game, you cannot include Events with a cost
//     of 2 or more in your deck" (OP13-079)
//   - "Under the rules of this game, you do not lose when your deck has 0
//     cards. You lose at the end of the turn in which your deck becomes 0
//     cards." (OP15-022)
//   - "Under the rules of this game, also treat this card's name as
//     [Trafalgar Law] and [Donquixote Rosinante]." (EB04-038)
//
// V0 approach: `applyGameRuleOverrideV2(state, controller, override)` runs
// once at game setup. Trims/extends DON deck, writes markers to
// `state.gameRules`. Engine reads markers in subsequent phase logic (V0:
// markers are set but the engine doesn't yet read them everywhere — that
// wiring lands in A.3.10).

import type { GameState, PlayerId } from '../GameState';
import type { GameRuleOverrideV2 } from './types-v2';

/** Apply a leader's game-rule override at setup. Mutates state in place;
 *  returns the same ref. Idempotent — safe to call multiple times. */
export function applyGameRuleOverrideV2(
  state: GameState,
  controller: PlayerId,
  override: GameRuleOverrideV2,
): GameState {
  if (!state.gameRules) state.gameRules = {};
  const me = state.players[controller];

  // donDeckSize: trim or extend the DON deck to match the override.
  if (typeof override.donDeckSize === 'number') {
    const target = override.donDeckSize;
    if (me.donDeck.length > target) {
      me.donDeck = me.donDeck.slice(0, target);
    } else {
      // Cannot extend without minting new instances — that's a setup-time
      // concern. V0: log a no-op and keep existing length.
    }
  }

  // nameAliases: register additional names the leader counts as for
  // if_leader_is matching. evaluateConditionV2 can read this to broaden
  // its check. (Wire-in lands in A.3.10.)
  if (override.nameAliases && override.nameAliases.length > 0) {
    if (!state.gameRules.nameAliases) state.gameRules.nameAliases = { A: [], B: [] };
    state.gameRules.nameAliases[controller] = [
      ...(state.gameRules.nameAliases[controller] ?? []),
      ...override.nameAliases,
    ];
  }

  // deckOutGrace: mark the controller as having the grace rule.
  // Engine checks this before declaring deck-out as a loss.
  if (override.deckOutGrace === 'until_end_of_turn') {
    state.gameRules.deckOutGracePlayer = controller;
  }

  // deckRestrictions: deck construction is a pre-game concern; record the
  // restriction as a state marker so a validator could read it.
  if (override.deckRestrictions?.bannedEventCostMin !== undefined) {
    if (!state.gameRules.bannedEventCostMin) {
      state.gameRules.bannedEventCostMin = { A: 0, B: 0 } as Record<PlayerId, number>;
    }
    state.gameRules.bannedEventCostMin[controller] = override.deckRestrictions.bannedEventCostMin;
  }

  // atStartOfGamePlay: find a card in the controller's deck matching the
  // filter and play it as a Stage (V0 assumes Stage; future filter could
  // narrow). The played card moves from deck → stage area.
  if (override.atStartOfGamePlay) {
    const filter = override.atStartOfGamePlay.filter;
    for (let i = 0; i < me.deck.length; i++) {
      const inst = state.instances[me.deck[i]];
      const card = inst ? state.cardLibrary[inst.cardId] : undefined;
      if (!inst || !card) continue;
      // Naive match: kind === 'stage' AND trait if specified.
      if (card.kind !== 'stage') continue;
      if (filter?.trait && !card.traits.includes(filter.trait)) continue;
      me.deck.splice(i, 1);
      // Trash existing stage if any.
      if (me.stage) {
        const prev = me.stage;
        while (prev.attachedDon.length > 0) me.donRested.push(prev.attachedDon.shift()!);
        me.trash.push(prev.instanceId);
      }
      me.stage = inst;
      break;
    }
  }

  return state;
}
