/**
 * F8A-F5 — vitest gate config.
 *
 * Before this file existed, vitest fell back to vite.config.ts and its
 * DEFAULT include glob, which swept the Playwright `e2e/**\/*.spec.ts`
 * files — ~73 file-level import failures of pure noise per run, burying
 * the real engine reds. Playwright specs run ONLY via `npm run test:e2e`
 * (playwright.config.ts).
 *
 * Scope of the default gate (`npm test`):
 *   - shared/engine-v2  — the LIVE engine (source of truth)
 *   - shared/server, shared/simulation, shared/sim, src — supporting layers
 *   - shared/engine (V1) is EXCLUDED: dead engine since the V2 cutover
 *     (TRACK_STATE.md), with 13 known reds from spec-schema drift (e.g.
 *     filter key `minCost` — V1 reads only `costMin`). They are the
 *     Phase 4 port-to-V2 queue, NOT deleted — run them explicitly via
 *     `npm run test:v1-legacy`. Rationale: docs/F8_ENGINE_CORRECTNESS_TRIAGE.md
 *     Finding 5.
 *
 * testTimeout: the simulation determinism tests legitimately take 6-17s
 * under load (full seeded game runs, byte-identical JSON comparison —
 * assertions untouched); the 5s vitest default produced load-dependent
 * flakes.
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
    include: [
      'shared/engine-v2/**/*.test.ts',
      'shared/server/**/*.test.ts',
      'shared/simulation/**/*.test.ts',
      'shared/sim/**/*.test.ts',
      'src/**/*.test.{ts,tsx}',
    ],
    exclude: [
      '**/node_modules/**',
      'e2e/**',
      'shared/engine/**', // V1 legacy — see header + npm run test:v1-legacy
    ],
    testTimeout: 30_000,
  },
});
