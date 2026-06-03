/**
 * Engine V2 — boot-time registry validation gate.
 *
 * Crawls cards.json and asserts every primitive (trigger/condition/action/
 * target/cost/continuous-action/replacement-trigger) referenced by ANY card
 * has a registered handler. Throws on first missing handler.
 *
 * MUST be called once at engine bootstrap. Failing here is preferable to
 * silent no-op at dispatch time.
 *
 * Cross-references:
 * - Implementation spec §7
 * - Plan v1 §2.4 + Bug class C30 / C31 / C32 / C36
 */

import type { Card } from '../cards/Card.js';
import type {
  EffectActionV2,
  EffectClauseV2,
  EffectConditionV2,
  EffectCostV2,
  EffectTargetV2,
  ReplacementEffectV2,
} from '../spec/types.js';
import {
  actionHandlers,
  conditionHandlers,
  continuousHandlers,
  costHandlers,
  RegistryValidationError,
  replacementHandlers,
  targetResolvers,
  triggerEmitters,
} from './types.js';

const COMBINATORS = new Set(['and', 'or', 'not']);

function walkCondition(c: EffectConditionV2 | undefined, missing: Set<string>): void {
  if (!c) return;
  if (COMBINATORS.has(c.type)) {
    const subs = (c['conditions'] as ReadonlyArray<EffectConditionV2> | undefined) ?? [];
    for (const sub of subs) walkCondition(sub, missing);
    walkCondition(c['condition'] as EffectConditionV2 | undefined, missing);
    return;
  }
  if (!conditionHandlers.has(c.type)) missing.add(`condition:${c.type}`);
}

function walkAction(a: EffectActionV2 | undefined, missing: Set<string>): void {
  if (!a) return;
  if (!actionHandlers.has(a.kind)) missing.add(`action:${a.kind}`);
  // Recurse into composite actions
  const inner = a['actions'] as ReadonlyArray<EffectActionV2> | undefined;
  if (inner) for (const sub of inner) walkAction(sub, missing);
  const options = a['options'] as ReadonlyArray<EffectClauseV2> | undefined;
  if (options) {
    for (const opt of options) {
      walkAction(opt.action, missing);
      walkCondition(opt.condition, missing);
      walkTarget(opt.target, missing);
      walkCost(opt.cost, missing);
    }
  }
  const thenAction = a['thenAction'] as EffectActionV2 | undefined;
  if (thenAction) walkAction(thenAction, missing);
  const scheduled = a['action'] as EffectActionV2 | undefined;
  if (scheduled && typeof scheduled === 'object' && 'kind' in scheduled) {
    walkAction(scheduled, missing);
  }
}

function walkTarget(t: EffectTargetV2 | undefined, missing: Set<string>): void {
  if (!t) return;
  if (!targetResolvers.has(t.kind)) missing.add(`target:${t.kind}`);
}

function walkCost(c: EffectCostV2 | undefined, missing: Set<string>): void {
  if (!c) return;
  for (const key of Object.keys(c)) {
    // `bind` is a meta-key on the cost shape (ClauseScratch binding name),
    // not a cost-handler kind.
    if (key === 'bind') continue;
    if (!costHandlers.has(key)) missing.add(`cost:${key}`);
  }
}

// ────────────────────────────────────────────────────────────────────
// Binding-write/read order validation
// ────────────────────────────────────────────────────────────────────
//
// For each clause, ensure every BindingRef.name read by a later step
// was written by an earlier step in the SAME clause. Step order is:
//   target → cost → action (condition does not have access to scratch
//   written within the same clause — it runs before any writer).
//
// Writers: target.bind, cost.bind, action.bind (string field).
// Readers: any { kind: 'binding', name, field } value nested inside
// target / cost / action shapes.

function bindingsWrittenBy(shape: { readonly bind?: unknown } | undefined): string | undefined {
  if (shape === undefined) return undefined;
  const b = shape.bind;
  return typeof b === 'string' && b !== '' ? b : undefined;
}

function collectBindingReads(value: unknown, into: Set<string>): void {
  if (typeof value !== 'object' || value === null) return;
  const v = value as { kind?: unknown; name?: unknown };
  if (v.kind === 'binding' && typeof v.name === 'string') {
    into.add(v.name);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectBindingReads(item, into);
    return;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    collectBindingReads((value as Record<string, unknown>)[key], into);
  }
}

function validateClauseBindings(cl: EffectClauseV2, missing: Set<string>): void {
  const written = new Set<string>();
  // Step 1: target (writes target.bind, no reads of same-clause bindings).
  const targetBind = bindingsWrittenBy(cl.target);
  if (targetBind !== undefined) written.add(targetBind);
  // Step 2: cost (reads may reference target.bind; writes cost.bind).
  if (cl.cost !== undefined) {
    const costReads = new Set<string>();
    collectBindingReads(cl.cost, costReads);
    for (const name of costReads) {
      if (!written.has(name)) missing.add(`binding-read-before-write:${name}`);
    }
    const costBind = bindingsWrittenBy(cl.cost);
    if (costBind !== undefined) written.add(costBind);
  }
  // Step 3: action (reads may reference target.bind or cost.bind; writes action.bind).
  if (cl.action !== undefined) {
    const actionReads = new Set<string>();
    collectBindingReads(cl.action, actionReads);
    for (const name of actionReads) {
      if (!written.has(name)) missing.add(`binding-read-before-write:${name}`);
    }
  }
}

function walkReplacement(r: ReplacementEffectV2, missing: Set<string>): void {
  if (!replacementHandlers.has(r.trigger)) missing.add(`replacement:${r.trigger}`);
  walkCondition(r.condition, missing);
  walkAction(r.action, missing);
  walkCost(r.cost, missing);
}

/**
 * Walk every clause / continuous / replacement on every card and assert each
 * referenced primitive is registered. Throws `RegistryValidationError` on
 * first missing primitive, listing all missing kinds.
 */
export function validateCardsAgainstRegistry(cards: ReadonlyArray<Card>): void {
  const missing = new Set<string>();
  for (const card of cards) {
    const spec = card.effectSpecV2;
    if (!spec) continue;
    // cards.json: any of clauses / continuous / replacements MAY be absent
    // on cards with no effect of that kind. Coerce defensively.
    const clauses = Array.isArray(spec.clauses) ? spec.clauses : [];
    const continuous = Array.isArray(spec.continuous) ? spec.continuous : [];
    const replacements = Array.isArray(spec.replacements) ? spec.replacements : [];

    for (const cl of clauses) {
      if (!triggerEmitters.has(cl.trigger)) missing.add(`trigger:${cl.trigger}`);
      walkCondition(cl.condition, missing);
      walkAction(cl.action, missing);
      walkTarget(cl.target, missing);
      walkCost(cl.cost, missing);
      validateClauseBindings(cl, missing);
    }
    for (const cont of continuous) {
      walkCondition(cont.condition, missing);
      if (cont.action !== undefined && !continuousHandlers.has(cont.action.kind)) {
        missing.add(`continuous:${cont.action.kind}`);
      }
      walkTarget(cont.target, missing);
    }
    for (const r of replacements) {
      walkReplacement(r, missing);
    }
  }
  if (missing.size > 0) {
    const sorted = [...missing].sort();
    throw new RegistryValidationError(sorted.join(', '), 'cards-corpus');
  }
}
