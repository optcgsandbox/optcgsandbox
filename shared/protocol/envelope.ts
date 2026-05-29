// WebSocket envelope schemas. Per docs/optcg-sim/backend-architecture.md §3.
// Client → server: ClientMessage. Server → client: ServerMessage.

import { z } from 'zod';
import { ActionSchema } from './actions';

const PlayerIdSchema = z.enum(['A', 'B']);

export const ClientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ACTION'), seq: z.number().int().nonnegative(), action: ActionSchema }),
  z.object({ type: z.literal('HEARTBEAT'), t: z.number() }),
  z.object({ type: z.literal('REQUEST_SNAPSHOT') }),
  z.object({ type: z.literal('JOIN'), token: z.string() }),
]);

export const ServerMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('JOINED'),
    you: PlayerIdSchema,
    seed: z.number(),
  }),
  z.object({ type: z.literal('SNAPSHOT'), seq: z.number(), stateJson: z.string() }),
  z.object({ type: z.literal('DELTA'), seq: z.number(), eventsJson: z.string() }),
  z.object({ type: z.literal('ERROR'), reason: z.string(), retryable: z.boolean() }),
  z.object({ type: z.literal('GAME_OVER'), winner: z.enum(['A', 'B', 'draw']) }),
  z.object({ type: z.literal('OPPONENT_DISCONNECTED'), graceSecs: z.number() }),
]);

export type ClientMessageT = z.infer<typeof ClientMessage>;
export type ServerMessageT = z.infer<typeof ServerMessage>;
