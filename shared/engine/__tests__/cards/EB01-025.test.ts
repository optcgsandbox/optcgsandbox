// EB01-025 Fourtricks — VANILLA.
import { describe, expect, it } from 'vitest';
import cardsData from '../../../data/cards.json';
import type { Card } from '../../cards/Card';

const ALL = cardsData as unknown as Card[];
const EB01_025 = ALL.find(c => c.id === 'EB01-025')!;

describe('EB01-025 — Fourtricks (vanilla)', () => {
  it('cost 3 / power 5000 / counter 1000', () => {
    expect((EB01_025 as { cost: number }).cost).toBe(3);
    expect((EB01_025 as { power: number }).power).toBe(5000);
    expect((EB01_025 as { counterValue: number }).counterValue).toBe(1000);
  });
  it('blue SMILE Animal Kingdom', () => {
    expect(EB01_025.colors).toContain('blue');
    expect(EB01_025.traits).toEqual(['Animal Kingdom Pirates', 'SMILE']);
  });
  it('empty effect spec', () => {
    const s = EB01_025.effectSpecV2!;
    expect(s.clauses ?? []).toHaveLength(0);
    expect(s.continuous ?? []).toHaveLength(0);
    expect(s.replacements ?? []).toHaveLength(0);
  });
});
