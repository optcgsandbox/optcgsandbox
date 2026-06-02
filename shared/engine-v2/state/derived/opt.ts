/**
 * Engine V2 — OPT (once-per-turn) key helpers.
 *
 * Unified namespace for OPT keys across clause / replacement / continuous
 * surfaces. Key shapes:
 *   `opt:${trigger}:${idx}`     — clause-level OPT
 *   `repl:${trigger}:${i}`      — replacement-level OPT
 *   `kw:${keyword}:${stamp}`    — keyword-level OPT (reserved)
 *
 * Per-instance OPT bookkeeping lives on `inst.perTurn.effectsUsed` (string[]).
 * Cleared at endTurn for the active player only.
 *
 * Cross-references:
 * - Implementation spec §5.10
 * - Plan v1 §4.6 (unified OPT namespace) + Bug class C9 / C33
 */

import type { CardInstance } from '../types.js';

export type OptKeyKind = 'opt' | 'repl' | 'kw';

export function makeOptKey(kind: OptKeyKind, trigger: string, idx: number | string): string {
  return `${kind}:${trigger}:${idx}`;
}

export function isOptUsed(inst: CardInstance, key: string): boolean {
  return inst.perTurn.effectsUsed.includes(key);
}

/**
 * Marks an OPT slot as used. Idempotent.
 * MUST be called AFTER condition + cost + action success (not before).
 * Calling before condition/cost check is the V1 bug class C9.
 */
export function markOptUsed(inst: CardInstance, key: string): void {
  if (!inst.perTurn.effectsUsed.includes(key)) {
    inst.perTurn.effectsUsed.push(key);
  }
}
