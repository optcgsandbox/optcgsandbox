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

export interface EffectTriggerV2 {
  readonly kind: EffectTriggerV2Kind;
}

export interface EffectConditionV2 {
  readonly type: EffectConditionV2Kind;
  readonly [key: string]: unknown;
}

export interface EffectActionV2 {
  readonly kind: EffectActionV2Kind;
  readonly [key: string]: unknown;
}

export interface EffectTargetV2 {
  readonly kind: EffectTargetV2Kind;
  readonly [key: string]: unknown;
}

export interface EffectCostV2 {
  readonly [key: string]: unknown;
}

export interface EffectClauseV2 {
  readonly trigger: EffectTriggerV2Kind;
  readonly condition?: EffectConditionV2;
  readonly cost?: EffectCostV2;
  readonly action: EffectActionV2;
  readonly target?: EffectTargetV2;
  readonly opt?: boolean;
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
