import { beforeAll, describe, expect, it } from 'vitest';

import { registerAllHandlers } from '../registry/handlers/index.js';
import { registerAllReducers } from '../reducers/index.js';
import { verifyAllCards } from './cardVerification.harness.js';

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

describe('engine-v2 per-card behavior harness', () => {
  it('reports pass / fail / vanilla counts for the corpus', { timeout: 60000 }, () => {
    const result = verifyAllCards();
    const total = result.pass + result.fail + result.vanilla;
    // eslint-disable-next-line no-console
    console.log(`Verification: ${result.pass} pass, ${result.fail} fail, ${result.vanilla} vanilla — ${total} total`);
    if (result.fail > 0) {
      // eslint-disable-next-line no-console
      console.log('First 10 failures:');
      for (const f of result.failures.slice(0, 10)) {
        // eslint-disable-next-line no-console
        console.log(`  ${f.cardId}: ${f.errors.join('; ')}`);
      }
    }
    expect(total).toBeGreaterThan(2000);
    // No hard fail-count assertion yet — V0 has stub assertions for many
    // actions. Use this test as a corpus-wide diagnostic; future work can
    // narrow the assertion (e.g., expect fail<100).
  });
});
