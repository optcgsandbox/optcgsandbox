/**
 * Engine V2 — second batch of continuous handlers covering corpus aliases.
 *
 * Most are aliases for the canonical handlers in continuous.ts; a few add
 * narrow-scope variants (self-only, opp-only) that target the appropriate
 * field.
 */

import {
  type ContinuousHandler,
  continuousHandlers,
} from '../types.js';

// Aliases: forward to the canonical handler at apply time.
function alias(canonical: string): ContinuousHandler {
  return {
    resets: [],
    fold(state, source, eff) {
      const c = continuousHandlers.get(canonical);
      return c.fold(state, source, eff);
    },
  };
}

export function registerContinuousHandlers2(): void {
  // Aura → existing canonical handlers
  continuousHandlers.register('aura_power_buff', alias('give_continuous_power'));
  continuousHandlers.register('aura_cost_modifier', alias('give_continuous_cost_modifier'));
  continuousHandlers.register('aura_grant_keyword', alias('give_continuous_keyword'));
  continuousHandlers.register('aura_immunity', alias('give_continuous_immunity'));
  continuousHandlers.register('aura_counter_buff', alias('counter_bonus_continuous'));
  continuousHandlers.register('aura_set_base_power', alias('base_power_override'));
  continuousHandlers.register('aura_set_base_power_copy_from_leader', alias('base_power_override'));

  // Self-targeted variants — same as aliasing because the continuous
  // handlers read eff.target = self by default. Cards using these names
  // typically omit target (so defaults to source) — alias is functionally
  // identical to the canonical handler with target=self.
  continuousHandlers.register('self_power_buff', alias('give_continuous_power'));
  continuousHandlers.register('self_cost_buff', alias('give_continuous_cost_modifier'));
  continuousHandlers.register('self_set_base_power', alias('base_power_override'));
  continuousHandlers.register('grant_keyword_to_self', alias('give_continuous_keyword'));
  continuousHandlers.register('self_immune_to_opp_effects', alias('give_continuous_immunity'));
  continuousHandlers.register('restrict_self_attack', alias('attack_lock_continuous'));

  // Opp-aura — same as aura* but target spec resolves to opp's field
  // (cards using these names already specify opp_character target).
  continuousHandlers.register('opp_aura_power_buff', alias('give_continuous_power'));
  continuousHandlers.register('opp_aura_cost_modifier', alias('give_continuous_cost_modifier'));

  // cost_modifier_in_hand: applies a cost modifier to a card while in hand.
  // Engine V2 stores cost modifiers on CardInstance; works for hand zone too.
  continuousHandlers.register('cost_modifier_in_hand', alias('give_continuous_cost_modifier'));
}
