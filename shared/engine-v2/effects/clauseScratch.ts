/**
 * Engine V2 — clause-local scratch context for cross-step binding.
 *
 * One ClauseScratch is created per clause-firing by EffectDispatcher
 * at clause entry. Earlier steps (cost / target / action) may write
 * named BindingSnapshot entries; later steps in the SAME clause may
 * read those entries via BindingRef values.
 *
 * Invariants:
 *   - Snapshot is frozen at write time from cardLibrary + instance state
 *   - Reads return snapshot fields only (no live re-resolution)
 *   - Missing binding → safe no-op (read returns undefined)
 *   - Each clause-firing gets its own ClauseScratch (no sharing)
 *   - Never enters ContinuousManager.refold, triggerEmitters, or history
 *   - Suspended clauses move scratch into state.pending.<kind>.scratch
 *
 * Cross-references:
 *   - state/types.ts (BindingSnapshot, ClauseScratch declarations)
 *   - spec/types.ts (BindingRef, isBindingRef)
 *   - EffectDispatcher.ts (instantiation point)
 *   - choiceResolve.ts (restoration on RESOLVE_*)
 */

import type { Card } from '../cards/Card.js';
import type { BindingRef } from '../spec/types.js';
import type {
  BindingSnapshot,
  CardId,
  CardInstance,
  ClauseScratch,
  GameState,
  InstanceId,
} from '../state/types.js';

// ────────────────────────────────────────────────────────────────────
// Snapshot construction
// ────────────────────────────────────────────────────────────────────

/**
 * Build a frozen BindingSnapshot from a card reference. Accepts either
 * an InstanceId (preferred — fills in instanceId field) or a CardId
 * (anonymous card with instanceId=null, used for cost-step writes of
 * cards that aren't yet on the field).
 *
 * Returns undefined if neither resolves to a known card. Callers MUST
 * check for undefined and treat it as "no binding written" — the
 * dispatcher does not call writeBinding when buildSnapshot returns
 * undefined.
 */
export function buildSnapshot(
  state: GameState,
  ref: InstanceId | { cardId: CardId },
): BindingSnapshot | undefined {
  let instanceId: InstanceId | null = null;
  let cardId: CardId;
  if (typeof ref === 'string') {
    const inst = state.instances[ref];
    if (inst === undefined) return undefined;
    instanceId = ref;
    cardId = inst.cardId;
  } else {
    cardId = ref.cardId;
  }
  const card = state.cardLibrary[cardId] as Card | undefined;
  if (card === undefined) return undefined;

  const traits = Array.isArray((card as { traits?: unknown }).traits)
    ? ((card as { traits: ReadonlyArray<string> }).traits)
    : [];
  const colors = Array.isArray((card as { colors?: unknown }).colors)
    ? ((card as { colors: ReadonlyArray<string> }).colors)
    : [];
  const name = typeof (card as { name?: unknown }).name === 'string'
    ? (card as { name: string }).name
    : '';
  const cost = typeof (card as { cost?: unknown }).cost === 'number'
    ? (card as { cost: number }).cost
    : 0;
  const basePower = typeof (card as { power?: unknown }).power === 'number'
    ? (card as { power: number }).power
    : 0;
  const kind = (card as { kind?: unknown }).kind as
    | 'leader'
    | 'character'
    | 'event'
    | 'stage';
  const attribute = typeof (card as { attribute?: unknown }).attribute === 'string'
    ? (card as { attribute: string }).attribute
    : null;

  return Object.freeze({
    instanceId,
    cardId,
    name,
    traits: Object.freeze([...traits]) as ReadonlyArray<string>,
    colors: Object.freeze([...colors]) as ReadonlyArray<string>,
    cost,
    basePower,
    kind,
    attribute,
  });
}

// ────────────────────────────────────────────────────────────────────
// Write
// ────────────────────────────────────────────────────────────────────

/**
 * Write a binding into scratch. No-op if scratch is undefined, or if
 * the binding name was already written (bindings are write-once per
 * clause to preserve determinism + replay).
 *
 * Source can be an InstanceId (on-field / in-zone instance) or a
 * { cardId } object (anonymous card reference, e.g. a card chosen
 * during cost payment that isn't itself an instance on the field).
 */
export function writeBinding(
  state: GameState,
  scratch: ClauseScratch | undefined,
  name: string,
  source: InstanceId | { cardId: CardId } | undefined,
): void {
  if (scratch === undefined) return;
  if (source === undefined) return;
  if (name === '' || name in scratch) return;
  const snap = buildSnapshot(state, source);
  if (snap === undefined) return;
  scratch[name] = snap;
}

// ────────────────────────────────────────────────────────────────────
// Read
// ────────────────────────────────────────────────────────────────────

/**
 * Read a binding field. Returns undefined if scratch is missing, the
 * binding name was never written, or the requested field is absent
 * from the snapshot. Callers must treat undefined as "predicate not
 * applicable" → safe no-op per cross-step propagation invariants.
 */
export function readBinding(
  scratch: ClauseScratch | undefined,
  name: string,
  field: BindingRef['field'],
): BindingSnapshot[BindingRef['field']] | undefined {
  if (scratch === undefined) return undefined;
  const snap = scratch[name];
  if (snap === undefined) return undefined;
  return snap[field];
}

/**
 * Resolve a possibly-binding parameter value. If the value is a
 * BindingRef, look it up in scratch; otherwise return the value as-is.
 * Used by filter/condition/action handlers that accept either a
 * literal or a BindingRef in their parameter slots.
 */
export function resolveBindingRef(
  scratch: ClauseScratch | undefined,
  value: unknown,
): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const v = value as { kind?: unknown; name?: unknown; field?: unknown };
  if (v.kind !== 'binding') return value;
  if (typeof v.name !== 'string' || typeof v.field !== 'string') return undefined;
  return readBinding(scratch, v.name, v.field as BindingRef['field']);
}

// ────────────────────────────────────────────────────────────────────
// New-scratch factory (for dispatcher and resolve reducers)
// ────────────────────────────────────────────────────────────────────

/**
 * Construct an empty ClauseScratch. Each clause-firing in
 * EffectDispatcher creates one of these; never share across clauses.
 */
export function newClauseScratch(): ClauseScratch {
  return {};
}

/**
 * Helper for resolve reducers: extract scratch off the inner pending
 * payload, defaulting to undefined if absent (backwards-compatible
 * with pendings created before the wiring was active).
 */
export function scratchFromPending(
  pending: { readonly scratch?: ClauseScratch } | undefined,
): ClauseScratch | undefined {
  if (pending === undefined) return undefined;
  return pending.scratch;
}

// Helper for instance-targeted binding writes that need to also
// surface for downstream effects checking the source's controller
// (used internally by the dispatcher for `bind` on cost/target shapes).
export function writeBindingFromInstance(
  state: GameState,
  scratch: ClauseScratch | undefined,
  name: string,
  instanceId: InstanceId | undefined,
): void {
  if (instanceId === undefined) return;
  writeBinding(state, scratch, name, instanceId);
}

// ────────────────────────────────────────────────────────────────────
// Pending-state attachment (suspension path)
// ────────────────────────────────────────────────────────────────────

/**
 * If a clause sets state.pending during action execution, the
 * dispatcher attaches the current ClauseScratch to the inner pending
 * payload so it can be restored on RESOLVE_*. No-op if pending is
 * null, scratch is empty, or scratch is already attached.
 *
 * Returns a new GameState (immutable update) when attachment occurs;
 * returns the same state reference otherwise.
 */
export function attachScratchToPending(
  state: GameState,
  scratch: ClauseScratch,
): GameState {
  if (state.pending === null) return state;
  if (Object.keys(scratch).length === 0) return state;
  const p = state.pending;
  switch (p.kind) {
    case 'trigger':
      if (p.pendingTrigger.scratch !== undefined) return state;
      return {
        ...state,
        pending: { kind: 'trigger', pendingTrigger: { ...p.pendingTrigger, scratch } },
      };
    case 'peek':
      if (p.pendingPeek.scratch !== undefined) return state;
      return {
        ...state,
        pending: { kind: 'peek', pendingPeek: { ...p.pendingPeek, scratch } },
      };
    case 'discard':
      if (p.pendingDiscard.scratch !== undefined) return state;
      return {
        ...state,
        pending: { kind: 'discard', pendingDiscard: { ...p.pendingDiscard, scratch } },
      };
    case 'choose_one':
      if (p.pendingChoose.scratch !== undefined) return state;
      return {
        ...state,
        pending: { kind: 'choose_one', pendingChoose: { ...p.pendingChoose, scratch } },
      };
    case 'attack_target_pick':
      if (p.pendingTargetPick.scratch !== undefined) return state;
      return {
        ...state,
        pending: {
          kind: 'attack_target_pick',
          pendingTargetPick: { ...p.pendingTargetPick, scratch },
        },
      };
    case 'searcher_peek':
      // F-8B — keep the scratch restorable on RESOLVE_SEARCHER_PEEK like
      // the other clause-induced suspends.
      if (p.pendingSearcherPeek.scratch !== undefined) return state;
      return {
        ...state,
        pending: {
          kind: 'searcher_peek',
          pendingSearcherPeek: { ...p.pendingSearcherPeek, scratch },
        },
      };
    case 'effect_offer':
      // F-8D addendum — the offer suspends BEFORE cost/target steps; the
      // accepted clause re-enters the pipeline with a FRESH scratch, so
      // nothing needs attaching here.
      return state;
    case 'attack':
      // Attack-phase pendings are battle-scope, not clause-resolution-scope.
      return state;
  }
}

// ────────────────────────────────────────────────────────────────────
// CardInstance import (declared but unused — placeholder for handler
// modules that import this file)
// ────────────────────────────────────────────────────────────────────
export type { CardInstance };
