/**
 * Engine V2 — DEPRECATED. Continuous-handler aliases that previously lived
 * here are now real implementations in continuous.ts (handles filter +
 * delta/basePower fields per cards.json shape). This file is kept as a
 * no-op shim so existing imports don't break; remove after no other module
 * imports `registerContinuousHandlers2`.
 */

export function registerContinuousHandlers2(): void {
  // intentionally empty — all continuous handlers register in continuous.ts
}
