/**
 * Env-gated batch driver — invokes `runFrequencyBatch` against the
 * configured game count and writes the report JSON to disk.
 *
 * Skipped by default so the normal test suite is unaffected. Enable via:
 *
 *   MECH_FREQ_GAMES=1000 MECH_FREQ_SEED=0 \
 *     npx vitest run shared/simulation/__tests__/mechanic-frequency-batch.test.ts
 *
 * This is necessary because `tsx` is not installed in this environment,
 * so the CLI entry `cli-mechanic-frequency.ts` cannot be invoked
 * directly. Vitest provides a TS loader for free. The CLI itself
 * remains the documented path for environments that have `tsx`.
 */

import { describe, expect, it } from 'vitest';

import { runFrequencyBatch } from '../cli-mechanic-frequency.js';
import { runDistribution } from '../cli-mechanic-distribution.js';
import { runTriage } from '../cli-mechanic-triage.js';

const enabled = process.env['MECH_FREQ_GAMES'] !== undefined;
const games = parseInt(process.env['MECH_FREQ_GAMES'] ?? '0', 10);
const seedBase = parseInt(process.env['MECH_FREQ_SEED'] ?? '0', 10);
const adversarial = process.env['MECH_FREQ_ADV'] !== 'false';

describe.runIf(enabled)('mechanic-frequency batch (env-gated)', () => {
  it(
    `runs ${games} games at seedBase=${seedBase}, writes JSON + distribution markdown`,
    () => {
      const startedAt = Date.now();
      const freqOut = runFrequencyBatch({ games, seedBase, adversarial });
      const freqElapsed = ((Date.now() - startedAt) / 1000).toFixed(2);

      // eslint-disable-next-line no-console
      console.log(
        `[mechanic-frequency] ${freqOut.totalGames} games / ${freqOut.totalTicks} ticks in ${freqElapsed}s → ${freqOut.reportPath}`,
      );

      expect(freqOut.totalGames).toBe(games);
      expect(freqOut.totalTicks).toBeGreaterThan(0);
      expect(freqOut.json.length).toBeGreaterThan(0);
      expect(freqOut.reportPath).toMatch(/mechanic-frequency-\d+\.json$/);

      // Chain item 4: produce the distribution markdown immediately after.
      const distOut = runDistribution({ seedBase, input: null, write: true });
      // eslint-disable-next-line no-console
      console.log(`[mechanic-distribution] markdown → ${distOut.reportPath}`);
      // eslint-disable-next-line no-console
      console.log('');
      // eslint-disable-next-line no-console
      console.log(distOut.stdoutText);

      expect(distOut.reportPath).toMatch(/mechanic-distribution-\d+\.md$/);
      expect(distOut.analyses).toHaveLength(4);
      // action + target layers should always have observed kinds in a
      // 1000-game run (sanity guard against silent regressions in the
      // public-method wrap mechanism).
      const action = distOut.analyses.find((a) => a.layer === 'action')!;
      const target = distOut.analyses.find((a) => a.layer === 'target')!;
      expect(action.total).toBeGreaterThan(0);
      expect(target.total).toBeGreaterThan(0);

      // Chain item 5: corpus-driven triage of zero-fire kinds.
      const triageOut = runTriage({ seedBase, input: null, cards: null, write: true });
      // eslint-disable-next-line no-console
      console.log(`[mechanic-triage] markdown → ${triageOut.reportPath}`);
      // eslint-disable-next-line no-console
      console.log('');
      // eslint-disable-next-line no-console
      console.log(triageOut.stdoutText);
      expect(triageOut.reportPath).toMatch(/mechanic-triage-\d+\.md$/);
      expect(triageOut.layers).toHaveLength(4);
    },
    /* timeout */ 10 * 60 * 1000,
  );
});
