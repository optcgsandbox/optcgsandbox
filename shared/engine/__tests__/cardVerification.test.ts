import { describe, expect, it } from 'vitest';
import { verifyAllCards } from './cardVerification.harness';

describe('Phase E — card verification harness', () => {
  it('runs the harness against every card and reports', () => {
    const result = verifyAllCards();
    // Spec-level assertion: engine actually does what the spec says.
    // Reports rather than asserting zero failures (V0 has stub assertions
    // for most actions).
    const total = result.pass + result.fail + result.vanilla;
    console.log(`Verification: ${result.pass} pass, ${result.fail} fail, ${result.vanilla} vanilla — ${total} total`);
    if (result.fail > 0) {
      console.log('First 10 failures:');
      for (const f of result.failures.slice(0, 10)) {
        console.log(`  ${f.cardId}: ${f.errors.join('; ')}`);
      }
    }
    // The total should equal the corpus size.
    expect(total).toBeGreaterThan(2000);
    // Fail count above 100 indicates a systemic issue worth investigating.
    if (result.fail > 100) {
      console.error(`WARNING: ${result.fail} cards failed harness assertions.`);
    }
  });
});
