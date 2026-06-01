// EB01-018 Mountain God — VANILLA. No printed effect.
import { describe, expect, it } from 'vitest';
import cardsData from '../../../data/cards.json';
import type { Card } from '../../cards/Card';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_018 = ALL_CARDS.find(c => c.id === 'EB01-018')!;

describe('EB01-018 — Mountain God (vanilla character)', () => {
  it('is a green character with the printed stat block', () => {
    expect(EB01_018.kind).toBe('character');
    expect(EB01_018.colors).toContain('green');
    expect((EB01_018 as { cost: number }).cost).toBe(5);
    expect((EB01_018 as { power: number }).power).toBe(7000);
    expect((EB01_018 as { counterValue: number }).counterValue).toBe(1000);
    expect(EB01_018.traits).toEqual(['Animal', 'Land of Wano']);
  });

  it('has empty effect spec (no clauses, no continuous, no replacements)', () => {
    const spec = EB01_018.effectSpecV2!;
    expect(spec.clauses ?? []).toHaveLength(0);
    expect(spec.continuous ?? []).toHaveLength(0);
    expect(spec.replacements ?? []).toHaveLength(0);
  });
});
