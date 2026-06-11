/**
 * F8A-F5 — V1 legacy engine suite (NOT part of the commit gate).
 *
 * Run: `npm run test:v1-legacy`
 *
 * shared/engine is the pre-cutover V1 engine; the live sim runs engine-v2
 * (TRACK_STATE.md Track 1). These tests are kept as the Phase 4
 * port-to-V2 reference (each V1 per-card test becomes a V2 semantic test,
 * validating parity) and MUST NOT be deleted per the no-shortcuts rule.
 *
 * KNOWN RED (13 tests across 6 files as of 2026-06-11): EB01-001, EB01-019,
 * EB01-020, EB01-021, EB01-028, EB01-053, EB02-039 — spec-schema drift
 * (cards.json evolved for V2: `minCost` filter alias, counter-event boost
 * normalization, condition shapes). The LIVE engine handles all of these
 * correctly (see engine-v2 per-card + F8A suites). Reds here mean
 * "port me", not "engine bug". docs/F8_ENGINE_CORRECTNESS_TRIAGE.md
 * Finding 5 has the full classification.
 */

import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  test: {
    include: ['shared/engine/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
    testTimeout: 30_000,
  },
});
