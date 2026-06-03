/**
 * Engine V2 — registry contract.
 *
 * Every primitive (trigger / condition / action / target / cost / continuous /
 * replacement) registers a typed handler. Boot-time `validateCardsAgainstRegistry`
 * asserts every cards.json primitive has a registered handler — fails LOUDLY
 * with `RegistryValidationError` rather than silently no-op'ing.
 *
 * Cross-references:
 * - Implementation spec §4
 * - Plan v1 §2 (registry pattern) + Bug class C26 / C30 / C31 / C32 / C36
 */

import type {
  CardInstance,
  ClauseScratch,
  GameState,
  InstanceId,
  PendingDecision,
  PlayerId,
} from '../state/types.js';
import type {
  ContinuousEffectV2,
  EffectActionV2,
  EffectConditionV2,
  EffectCostV2,
  EffectTargetV2,
  EffectTriggerV2,
  ReplacementEffectV2,
} from '../spec/types.js';

// ────────────────────────────────────────────────────────────────────
// Shared handler context types
// ────────────────────────────────────────────────────────────────────

export interface HandlerCtx {
  readonly sourceInstanceId: InstanceId;
  readonly controller: PlayerId;
  readonly source?: 'battle' | 'effect';
  readonly scratch?: ClauseScratch;
}

// ────────────────────────────────────────────────────────────────────
// Per-primitive handler signatures
// ────────────────────────────────────────────────────────────────────

export type ConditionHandler = (
  state: GameState,
  ctx: HandlerCtx,
  condition: EffectConditionV2,
) => boolean;

export type ActionHandler = (
  state: GameState,
  ctx: HandlerCtx,
  action: EffectActionV2,
  targets: ReadonlyArray<InstanceId>,
) => GameState;

export interface ContinuousHandler {
  /**
   * Field names this handler writes. ContinuousManager resets these BEFORE
   * each refold; idempotent re-application follows.
   */
  readonly resets: ReadonlyArray<keyof CardInstance>;
  /**
   * Fold this continuous effect onto state. Called once per source per refold tick.
   * Receives the full ContinuousEffectV2 so the handler can use `eff.target`.
   */
  readonly fold: (state: GameState, source: CardInstance, eff: ContinuousEffectV2) => GameState;
}

export type TargetResolver = (
  state: GameState,
  ctx: HandlerCtx,
  target: EffectTargetV2,
) => ReadonlyArray<InstanceId>;

export interface CostHandler {
  readonly canPay: (state: GameState, ctx: HandlerCtx, cost: EffectCostV2) => boolean;
  readonly pay: (state: GameState, ctx: HandlerCtx, cost: EffectCostV2) => GameState | null;
}

export type ReplacementHandler = (
  state: GameState,
  ctx: HandlerCtx,
  replacement: ReplacementEffectV2,
) => { replaced: boolean; state: GameState };

export type TriggerEmitter = (
  state: GameState,
  trigger: EffectTriggerV2,
  controller: PlayerId,
) => GameState;

export type PendingResolver = (state: GameState, decision: PendingDecision) => GameState;

// ────────────────────────────────────────────────────────────────────
// Registry
// ────────────────────────────────────────────────────────────────────

export class RegistryValidationError extends Error {
  constructor(missingKey: string, primitiveType: string) {
    super(
      `RegistryValidationError: no handler registered for ${primitiveType} kind="${missingKey}". ` +
      `Either register a handler or remove this primitive from cards.json.`,
    );
    this.name = 'RegistryValidationError';
  }
}

export class DuplicateRegistrationError extends Error {
  constructor(key: string, primitiveType: string) {
    super(
      `DuplicateRegistrationError: ${primitiveType} kind="${key}" registered twice. ` +
      `Each (primitiveType, kind) pair must be unique.`,
    );
    this.name = 'DuplicateRegistrationError';
  }
}

/**
 * Generic registry with commutativity contract:
 *   - register(kind, handler) — throws DuplicateRegistrationError on second call
 *   - get(kind) — throws RegistryValidationError if unregistered
 *   - has(kind) — true if registered
 *   - snapshot() — read-only view of registered kinds for boot-time validation
 */
export class Registry<T> {
  private readonly map = new Map<string, T>();
  private readonly primitiveType: string;

  constructor(primitiveType: string) {
    this.primitiveType = primitiveType;
  }

  register(kind: string, handler: T): void {
    if (this.map.has(kind)) {
      throw new DuplicateRegistrationError(kind, this.primitiveType);
    }
    this.map.set(kind, handler);
  }

  get(kind: string): T {
    const h = this.map.get(kind);
    if (h === undefined) {
      throw new RegistryValidationError(kind, this.primitiveType);
    }
    return h;
  }

  has(kind: string): boolean {
    return this.map.has(kind);
  }

  snapshot(): ReadonlyArray<string> {
    return [...this.map.keys()].sort();
  }
}

// ────────────────────────────────────────────────────────────────────
// Global registries (one per primitive type)
// ────────────────────────────────────────────────────────────────────

export const triggerEmitters = new Registry<TriggerEmitter>('trigger');
export const conditionHandlers = new Registry<ConditionHandler>('condition');
export const actionHandlers = new Registry<ActionHandler>('action');
export const continuousHandlers = new Registry<ContinuousHandler>('continuous');
export const targetResolvers = new Registry<TargetResolver>('target');
export const costHandlers = new Registry<CostHandler>('cost');
export const replacementHandlers = new Registry<ReplacementHandler>('replacement');
export const pendingResolvers = new Registry<PendingResolver>('pending');
