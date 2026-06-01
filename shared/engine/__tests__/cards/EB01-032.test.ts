// EB01-032 Army Wolves — VANILLA.
import { describe, expect, it } from 'vitest';
import cardsData from '../../../data/cards.json';
import type { Card } from '../../cards/Card';

const ALL = cardsData as unknown as Card[];
const C = ALL.find(c => c.id === 'EB01-032')!;

describe('EB01-032 — Army Wolves (vanilla)', () => {
  it('5-cost 7000-power purple Animal/Impel Down', () => {
    expect((C as { cost: number }).cost).toBe(5);
    expect((C as { power: number }).power).toBe(7000);
    expect(C.colors).toContain('purple');
    expect(C.traits).toEqual(['Animal', 'Impel Down']);
  });
  it('empty effect spec', () => {
    const s = C.effectSpecV2!;
    expect(s.clauses ?? []).toHaveLength(0);
    expect(s.continuous ?? []).toHaveLength(0);
    expect(s.replacements ?? []).toHaveLength(0);
  });
});
