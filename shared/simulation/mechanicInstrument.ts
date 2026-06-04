/**
 * Engine V2 — mechanic-frequency instrumentation (simulation-layer only).
 *
 * Counts per-handler-kind invocations across:
 *   - action handlers   (actionHandlers.get(kind)(...))
 *   - cost handlers     (costHandlers.get(key).pay(...))
 *   - target resolvers  (targetResolvers.get(kind)(...))
 *   - magnitude formulas — ACTION-LEVEL APPROXIMATION ONLY.
 *
 * MECHANISM (strict-scope, no engine-v2 modifications):
 *   At install time we replace the PUBLIC `get(kind)` method on each
 *   exported registry instance with a wrapper that delegates to the
 *   original (saved via Function.prototype.bind) and returns a counting
 *   wrapper around the resolved handler. We never touch the private
 *   `map`, never edit the Registry class, never add new methods, and
 *   never change types. Installation is install/uninstall symmetric:
 *   `installMechanicInstrumentation()` saves originals and
 *   `uninstallMechanicInstrumentation()` restores them by deleting the
 *   own-property override, allowing class prototype lookup to resume.
 *
 * Magnitude coverage is documented as "action-level only" because
 * `resolveMagnitude` is an immutable const export — it cannot be wrapped
 * without engine modification. We approximate by introspecting
 * `action.magnitude?.kind` on every action handler invocation (the
 * dominant magnitude carrier in V2 — see registry/handlers/actions.ts
 * power_buff family).
 *
 * Determinism: counter increments occur at handler-invocation time. Two
 * runs with identical `seedBase` perform the same handler calls in the
 * same order, so the counter snapshot is byte-identical when serialized
 * with sorted keys (see `serializeReport`).
 */

import {
  actionHandlers,
  costHandlers,
  targetResolvers,
  type ActionHandler,
  type CostHandler,
  type TargetResolver,
  type Registry,
} from '../engine-v2/registry/types.js';

// ────────────────────────────────────────────────────────────────────
// Counter shape
// ────────────────────────────────────────────────────────────────────

export interface MechanicCounters {
  readonly action: Record<string, number>;
  readonly cost: Record<string, number>;
  readonly target: Record<string, number>;
  readonly magnitude: Record<string, number>;
}

const counters: {
  action: Record<string, number>;
  cost: Record<string, number>;
  target: Record<string, number>;
  magnitude: Record<string, number>;
} = {
  action: {},
  cost: {},
  target: {},
  magnitude: {},
};

let installed = false;

// ────────────────────────────────────────────────────────────────────
// Wrap helpers — per-primitive
// ────────────────────────────────────────────────────────────────────

function incActionAndMagnitude(kind: string, action: unknown): void {
  counters.action[kind] = (counters.action[kind] ?? 0) + 1;

  // Magnitude approximation: introspect `action.magnitude` only.
  //   - object with .kind → that kind
  //   - number            → 'literal'
  //   - undefined         → uncounted (action carries no magnitude field)
  if (action !== null && typeof action === 'object' && 'magnitude' in action) {
    const mag = (action as { magnitude?: unknown }).magnitude;
    if (typeof mag === 'number') {
      counters.magnitude['literal'] = (counters.magnitude['literal'] ?? 0) + 1;
    } else if (mag !== null && typeof mag === 'object' && 'kind' in mag) {
      const mKind = (mag as { kind: unknown }).kind;
      if (typeof mKind === 'string') {
        counters.magnitude[mKind] = (counters.magnitude[mKind] ?? 0) + 1;
      }
    }
  }
}

function wrapActionHandler(kind: string, handler: ActionHandler): ActionHandler {
  return (state, ctx, action, targets) => {
    incActionAndMagnitude(kind, action);
    return handler(state, ctx, action, targets);
  };
}

function wrapTargetResolver(kind: string, handler: TargetResolver): TargetResolver {
  return (state, ctx, target) => {
    counters.target[kind] = (counters.target[kind] ?? 0) + 1;
    return handler(state, ctx, target);
  };
}

function wrapCostHandler(kind: string, handler: CostHandler): CostHandler {
  // Count only successful invocations of `.pay`, not the `.canPay`
  // legality probes. CostPayer.canPay walks the same cost map and calls
  // `.get(key).canPay`; double-counting would inflate every paid cost
  // by ~2x.
  return {
    canPay: handler.canPay,
    pay: (state, ctx, cost) => {
      counters.cost[kind] = (counters.cost[kind] ?? 0) + 1;
      return handler.pay(state, ctx, cost);
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// Generic public-method wrap (install / uninstall symmetric)
// ────────────────────────────────────────────────────────────────────

function installOn<T>(
  registry: Registry<T>,
  wrap: (kind: string, handler: T) => T,
): void {
  const originalGet = registry.get.bind(registry);
  const wrapped = (kind: string): T => {
    const original = originalGet(kind);
    return wrap(kind, original);
  };
  // Shadow the class prototype's `.get` with an own-property on this
  // instance. Public-method wrap only — no private field access, no
  // prototype mutation, no global side effect.
  (registry as unknown as { get: (kind: string) => T }).get = wrapped;
}

function uninstallOn<T>(registry: Registry<T>): void {
  // Remove the own-property override so calls fall through to the
  // class prototype `.get` again. Exact restore.
  const obj = registry as unknown as { get?: (kind: string) => T };
  if (Object.prototype.hasOwnProperty.call(obj, 'get')) {
    delete obj.get;
  }
}

// ────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────

export function installMechanicInstrumentation(): MechanicCounters {
  if (installed) {
    throw new Error(
      'mechanicInstrument: already installed — call uninstallMechanicInstrumentation() first',
    );
  }
  resetCounters();
  installOn(actionHandlers, wrapActionHandler);
  installOn(targetResolvers, wrapTargetResolver);
  installOn(costHandlers, wrapCostHandler);
  installed = true;
  return counters;
}

export function uninstallMechanicInstrumentation(): void {
  if (!installed) return;
  uninstallOn(actionHandlers);
  uninstallOn(targetResolvers);
  uninstallOn(costHandlers);
  installed = false;
}

export function isInstrumentationInstalled(): boolean {
  return installed;
}

export function resetCounters(): void {
  counters.action = {};
  counters.cost = {};
  counters.target = {};
  counters.magnitude = {};
}

export function getCounters(): MechanicCounters {
  return counters;
}

// ────────────────────────────────────────────────────────────────────
// Deterministic report shape + serialization
// ────────────────────────────────────────────────────────────────────

function sortedObject(obj: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of Object.keys(obj).sort()) out[k] = obj[k]!;
  return out;
}

export interface MechanicFrequencyReport {
  readonly totalGames: number;
  readonly totalTicks: number;
  readonly seedBase: number;
  readonly adversarial: boolean;
  readonly magnitudeCoverage: 'action-level only';
  readonly action: Record<string, number>;
  readonly cost: Record<string, number>;
  readonly target: Record<string, number>;
  readonly magnitude: Record<string, number>;
}

export function buildReport(args: {
  totalGames: number;
  totalTicks: number;
  seedBase: number;
  adversarial: boolean;
}): MechanicFrequencyReport {
  return {
    totalGames: args.totalGames,
    totalTicks: args.totalTicks,
    seedBase: args.seedBase,
    adversarial: args.adversarial,
    magnitudeCoverage: 'action-level only',
    action: sortedObject(counters.action),
    cost: sortedObject(counters.cost),
    target: sortedObject(counters.target),
    magnitude: sortedObject(counters.magnitude),
  };
}

/**
 * Stringify a report with deterministic key order + sorted inner keys.
 * Two runs with identical seedBase produce byte-identical output.
 */
export function serializeReport(report: MechanicFrequencyReport): string {
  const topOrder: ReadonlyArray<keyof MechanicFrequencyReport> = [
    'totalGames',
    'totalTicks',
    'seedBase',
    'adversarial',
    'magnitudeCoverage',
    'action',
    'cost',
    'target',
    'magnitude',
  ];
  const ordered: Record<string, unknown> = {};
  for (const key of topOrder) ordered[key] = report[key];
  return `${JSON.stringify(ordered, null, 2)}\n`;
}
