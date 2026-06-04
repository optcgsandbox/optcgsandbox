/**
 * Per-card metadata for the adversarial weighting system.
 *
 * Pre-computed once at batch start. Walks each card's effectSpecV2 to
 * surface features that drive adversarial bias: clause count, conditional
 * gates, BindingRef usage, sequence composition, play_for_free / recursion
 * actions, zone-transition variety.
 *
 * Pure read over cards.json — no engine state touched.
 */

import type { Card } from '../engine-v2/cards/Card.js';

export interface CardMeta {
  readonly cardId: string;
  readonly kind: string;
  readonly clauseCount: number;
  readonly continuousCount: number;
  readonly replacementCount: number;
  readonly hasConditional: boolean;
  readonly hasBinding: boolean;
  readonly hasSequence: boolean;
  readonly hasPlayForFree: boolean;
  readonly hasRecursion: boolean;
  readonly hasSearcher: boolean;
  readonly hasCostBind: boolean;
  readonly distinctActionKinds: ReadonlyArray<string>;
  readonly uniqueZones: number; // hand/field/trash/deck/life touched by spec
  /** Aggregate "complexity score" used by adversarial.ts for default weight. */
  readonly complexity: number;
}

function containsBinding(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  if (Array.isArray(value)) return value.some((v) => containsBinding(v));
  const v = value as { kind?: unknown };
  if (v.kind === 'binding') return true;
  for (const k of Object.keys(value as Record<string, unknown>)) {
    if (containsBinding((value as Record<string, unknown>)[k])) return true;
  }
  return false;
}

function collectActionKinds(action: unknown, out: Set<string>): void {
  if (typeof action !== 'object' || action === null) return;
  const a = action as { kind?: unknown; actions?: unknown };
  if (typeof a.kind === 'string') out.add(a.kind);
  if (Array.isArray(a.actions)) {
    for (const sub of a.actions) collectActionKinds(sub, out);
  }
}

function collectZones(spec: unknown, out: Set<string>): void {
  if (typeof spec !== 'object' || spec === null) return;
  const ZONES = ['hand', 'field', 'trash', 'deck', 'life', 'stage'];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      for (const z of ZONES) if (v.toLowerCase().includes(z)) out.add(z);
      return;
    }
    if (Array.isArray(v)) { for (const x of v) walk(x); return; }
    if (typeof v === 'object' && v !== null) {
      for (const k of Object.keys(v as Record<string, unknown>)) walk((v as Record<string, unknown>)[k]);
    }
  };
  walk(spec);
}

export function computeCardMeta(allCards: ReadonlyArray<Card>): Map<string, CardMeta> {
  const out = new Map<string, CardMeta>();
  for (const c of allCards) {
    const spec = (c as { effectSpecV2?: { clauses?: ReadonlyArray<unknown>; continuous?: ReadonlyArray<unknown>; replacements?: ReadonlyArray<unknown> } }).effectSpecV2;
    const clauses = spec?.clauses ?? [];
    const continuous = spec?.continuous ?? [];
    const replacements = spec?.replacements ?? [];

    const actionKinds = new Set<string>();
    let hasConditional = false;
    let hasCostBind = false;
    for (const cl of clauses) {
      const cv = cl as { condition?: unknown; action?: unknown; cost?: unknown };
      if (cv.condition !== undefined) hasConditional = true;
      collectActionKinds(cv.action, actionKinds);
      if (cv.cost !== undefined && typeof (cv.cost as { bind?: unknown }).bind === 'string') hasCostBind = true;
    }
    for (const ce of continuous) {
      const cv = ce as { condition?: unknown; action?: unknown };
      if (cv.condition !== undefined) hasConditional = true;
      collectActionKinds(cv.action, actionKinds);
    }
    for (const re of replacements) collectActionKinds((re as { action?: unknown }).action, actionKinds);

    const hasBinding = containsBinding(spec);
    const hasSequence = actionKinds.has('sequence') || actionKinds.has('chained_actions');
    const hasPlayForFree = actionKinds.has('play_for_free');
    const hasRecursion =
      actionKinds.has('recursion') ||
      actionKinds.has('add_from_trash_to_hand') ||
      actionKinds.has('return_to_hand_from_field') ||
      actionKinds.has('removal_bounce');
    const hasSearcher = actionKinds.has('searcher_peek') || actionKinds.has('search_deck');

    const zones = new Set<string>();
    collectZones(spec, zones);
    const uniqueZones = zones.size;

    // Complexity: weighted combo of features. Used as default adversarial
    // amplifier for moves involving this card.
    const complexity =
      clauses.length * 2 +
      continuous.length * 1 +
      replacements.length * 2 +
      (hasConditional ? 2 : 0) +
      (hasBinding ? 4 : 0) +
      (hasSequence ? 3 : 0) +
      (hasPlayForFree ? 3 : 0) +
      (hasRecursion ? 2 : 0) +
      (hasSearcher ? 2 : 0) +
      (hasCostBind ? 3 : 0) +
      uniqueZones;

    out.set(c.id, {
      cardId: c.id,
      kind: (c as { kind: string }).kind,
      clauseCount: clauses.length,
      continuousCount: continuous.length,
      replacementCount: replacements.length,
      hasConditional,
      hasBinding,
      hasSequence,
      hasPlayForFree,
      hasRecursion,
      hasSearcher,
      hasCostBind,
      distinctActionKinds: [...actionKinds],
      uniqueZones,
      complexity,
    });
  }
  return out;
}

/** Top-N most complex cards (used by focus-card injection). */
export function topByComplexity(meta: Map<string, CardMeta>, n: number): ReadonlyArray<string> {
  return [...meta.values()]
    .filter((m) => m.kind !== 'leader')
    .sort((a, b) => b.complexity - a.complexity)
    .slice(0, n)
    .map((m) => m.cardId);
}
