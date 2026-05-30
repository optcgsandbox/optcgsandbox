// Player actions — the discriminated union the engine and network protocol both speak.
// Source: docs/optcg-sim/rules-reference.md §1.4 (turn structure) + §1.6 (attacks).

import { z } from 'zod';

export const ActionSchema = z.discriminatedUnion('type', [
  // Setup — D10, CR §5-2-1-6: mulligan window. Each player may, once, choose
  // to return their opening hand to the deck, reshuffle, and redraw 5. The
  // first player decides first.
  z.object({ type: z.literal('MULLIGAN') }),
  z.object({ type: z.literal('KEEP_HAND') }),

  // Main phase
  z.object({
    type: z.literal('PLAY_CARD'),
    instanceId: z.string(),
    /** For Characters when field has 5, must specify which to KO/replace. null otherwise. */
    replaceTargetId: z.string().nullable(),
  }),
  z.object({
    /** D1 (CR §3-8-5): Stage Area is a single-slot zone. Playing a new Stage
     *  when one exists trashes the existing Stage (CR §3-8-5-1). Split out of
     *  PLAY_CARD so the action namespace mirrors zone separation. */
    type: z.literal('PLAY_STAGE'),
    instanceId: z.string(),
  }),
  z.object({
    type: z.literal('ATTACH_DON'),
    targetInstanceId: z.string(),
  }),
  z.object({
    type: z.literal('ACTIVATE_MAIN'),
    instanceId: z.string(),
  }),

  // Attack flow
  z.object({
    type: z.literal('DECLARE_ATTACK'),
    attackerInstanceId: z.string(),
    /** Either opponent's leader or a rested character. */
    targetInstanceId: z.string(),
  }),
  z.object({
    type: z.literal('DECLARE_BLOCKER'),
    blockerInstanceId: z.string(),
  }),
  z.object({
    type: z.literal('PLAY_COUNTER'),
    instanceId: z.string(),
  }),
  z.object({
    type: z.literal('SKIP_COUNTER'),
  }),
  z.object({
    type: z.literal('SKIP_BLOCKER'),
  }),
  z.object({
    type: z.literal('RESOLVE_TRIGGER'),
    /** Optional effect target, if the trigger requires one. */
    targetInstanceId: z.string().nullable(),
    /** Player can decline optional triggers. */
    activate: z.boolean(),
  }),

  // Turn end
  z.object({ type: z.literal('END_TURN') }),

  // Out-of-band
  z.object({ type: z.literal('RESIGN') }),
]);

export type Action = z.infer<typeof ActionSchema>;
export type ActionType = Action['type'];
