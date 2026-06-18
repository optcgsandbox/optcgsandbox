/**
 * Engine V2 — effectSpecV2 schema.
 *
 * Forward-declared so cards/Card.ts can reference EffectSpecV2.
 * The discriminated unions for triggers / conditions / actions / targets / costs
 * are populated in subsequent modules; this file declares only the shells.
 *
 * Cross-references:
 * - Implementation spec §3 (full discriminated unions land here in Phase 3)
 * - Plan v1 §3 (187 primitive handlers)
 */

// Placeholder unions — Phase 3 populates these with all 187 primitives.
// For now they accept any object so cards.json parsing doesn't fail.

export type EffectTriggerV2Kind = string; // narrowed in Phase 3
export type EffectConditionV2Kind = string;
export type EffectActionV2Kind = string;
export type EffectTargetV2Kind = string;
export type EffectCostKey = string;

// ────────────────────────────────────────────────────────────────────
// BindingRef — clause-local cross-step binding reference
// ────────────────────────────────────────────────────────────────────
//
// Used as a parameter value inside filter/condition/action shapes when
// the value should be resolved at runtime from a ClauseScratch entry
// written by an earlier step in the SAME clause. The resolver reads
// ctx.scratch[name][field] and applies the optional comparison op
// (default 'eq'). Absent binding returns undefined → safe no-op per
// the cross-step propagation invariants.

export interface BindingRef {
  readonly kind: 'binding';
  readonly name: string;
  readonly field:
    | 'instanceId'
    | 'cardId'
    | 'name'
    | 'traits'
    | 'colors'
    | 'cost'
    | 'basePower'
    | 'kind'
    | 'attribute';
  readonly op?: 'eq' | 'ne';
}

// Type guard for runtime detection inside resolvers.
export function isBindingRef(value: unknown): value is BindingRef {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { kind?: unknown };
  return v.kind === 'binding';
}

export interface EffectTriggerV2 {
  readonly kind: EffectTriggerV2Kind;
}

export interface EffectConditionV2 {
  readonly type: EffectConditionV2Kind;
  readonly [key: string]: unknown;
}

export interface EffectActionV2 {
  readonly kind: EffectActionV2Kind;
  // Optional clause-local binding name; if set, the action writes its
  // primary resolved instance into ctx.scratch[bind] for later steps to
  // read via BindingRef.
  readonly bind?: string;
  readonly [key: string]: unknown;
}

export interface EffectTargetV2 {
  readonly kind: EffectTargetV2Kind;
  // Optional clause-local binding name; if set, the target resolver
  // writes its first resolved instance (target_0) into ctx.scratch[bind].
  readonly bind?: string;
  readonly [key: string]: unknown;
}

export interface EffectCostV2 {
  // Optional clause-local binding name; if set, cost handlers that
  // resolve a chosen card (discard, trash-self, return-self, place-at-
  // deck-bottom-from-hand-by-filter) write the chosen card into
  // ctx.scratch[bind] for later effect steps in the same clause.
  readonly bind?: string;
  readonly [key: string]: unknown;
}

export interface EffectClauseV2 {
  readonly trigger: EffectTriggerV2Kind;
  readonly condition?: EffectConditionV2;
  readonly cost?: EffectCostV2;
  readonly action: EffectActionV2;
  readonly target?: EffectTargetV2;
  readonly opt?: boolean;
  // Play-mode gate for cards whose printed text has separate [Main] and
  // [Counter] sections (both otherwise fire on the `on_play` trigger).
  // `undefined` = fires in any mode (the default for ~all cards). 'main' =
  // only when played as a normal/main event; 'counter' = only when played
  // during the counter window. Generic; set per-clause in card data.
  readonly mode?: 'main' | 'counter';
  readonly verified: 'auto' | 'human-reviewed' | 'ground-truth' | 'flagged';
}

export interface ContinuousEffectV2 {
  readonly condition?: EffectConditionV2;
  readonly action: EffectActionV2; // continuous action handlers register separately
  readonly target?: EffectTargetV2;
}

export interface ReplacementEffectV2 {
  readonly trigger: 'would_be_ko' | 'would_be_removed' | 'would_take_damage' | 'on_life_flip';
  readonly whenSource?: 'battle' | 'effect';
  readonly condition?: EffectConditionV2;
  readonly cost?: EffectCostV2;
  readonly action: EffectActionV2;
  readonly conditional?: boolean;
  readonly opt?: boolean;
}

export interface EffectSpecV2 {
  readonly schemaVersion: 2;
  readonly verified: 'auto' | 'human-reviewed' | 'ground-truth' | 'flagged';
  readonly clauses: ReadonlyArray<EffectClauseV2>;
  readonly continuous: ReadonlyArray<ContinuousEffectV2>;
  readonly replacements: ReadonlyArray<ReplacementEffectV2>;
  readonly engineVersion?: 1 | 2;
  readonly rules?: {
    readonly nameAliases?: ReadonlyArray<string>;
  };
}
