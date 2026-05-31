// Trigger bus — Phase A.3.9.
//
// Singleton event bus the engine publishes to at trigger-relevant moments
// (attack declared, life flipped, refresh started, etc.). Subscribers
// (V2 effectSpec runner, future test harness) receive the event and can
// run their effects against the current state.
//
// V0 design: pure pub/sub. The bus DOES NOT mutate state — it just
// notifies. Subscribers are responsible for any state mutation. Engine
// publishes events synchronously inside applyAction / phase reducers;
// subscribers run inline before the publishing function returns.
//
// Cards do not subscribe directly — the runtime registers subscribers
// when it spins up. For V0 the bus is dormant (no subscribers) until
// A.3.10 flips the wire-up.

import type { GameState, PlayerId } from '../GameState';

export type TriggerEventKind =
  | 'on_opp_attack'             // payload: { attacker, target, defender }
  | 'on_life_changed'           // payload: { player, delta, lifeId? }
  | 'on_damage_taken'           // payload: { player, lifeId }
  | 'at_opp_refresh'            // payload: { refreshingPlayer }
  | 'on_own_don_returned'       // payload: { player, count }
  | 'on_opp_play_character'     // payload: { opp, instanceId, cardId }
  | 'at_end_of_turn_self'       // payload: { player }
  | 'at_end_of_turn';           // payload: { player }

export interface TriggerEvent {
  kind: TriggerEventKind;
  state: GameState;
  payload: Record<string, unknown>;
}

export type TriggerSubscriber = (event: TriggerEvent) => void;

class TriggerBus {
  private subs: Map<TriggerEventKind, Set<TriggerSubscriber>> = new Map();

  subscribe(kind: TriggerEventKind, sub: TriggerSubscriber): () => void {
    if (!this.subs.has(kind)) this.subs.set(kind, new Set());
    this.subs.get(kind)!.add(sub);
    return () => this.subs.get(kind)?.delete(sub);
  }

  publish(event: TriggerEvent): void {
    const list = this.subs.get(event.kind);
    if (!list) return;
    for (const sub of list) sub(event);
  }

  /** Clear all subscribers — used by tests between cases. */
  reset(): void {
    this.subs.clear();
  }

  size(kind?: TriggerEventKind): number {
    if (kind) return this.subs.get(kind)?.size ?? 0;
    let total = 0;
    for (const set of this.subs.values()) total += set.size;
    return total;
  }
}

/** Engine-wide singleton. Tests can `reset()` between cases. */
export const triggerBus = new TriggerBus();

/** Helper: publish an event with a minimal payload shape. */
export function publishTrigger(
  kind: TriggerEventKind,
  state: GameState,
  payload: Record<string, unknown> = {},
): void {
  triggerBus.publish({ kind, state, payload });
}

export type { PlayerId };
