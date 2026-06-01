// EB01-041 Crocus — VANILLA.
import { describe, expect, it } from 'vitest';
import cardsData from '../../../data/cards.json';
import type { Card } from '../../cards/Card';

const ALL = cardsData as unknown as Card[];
const C = ALL.find(c => c.id === 'EB01-041')!;

describe('EB01-041 — Crocus (vanilla)', () => {
  it('6-cost 8000-power black Former Roger Pirates', () => {
    expect((C as { cost: number }).cost).toBe(6);
    expect((C as { power: number }).power).toBe(8000);
    expect(C.colors).toContain('black');
    expect(C.traits).toEqual(['Former Roger Pirates']);
  });
  it('empty effect spec', () => {
    const s = C.effectSpecV2!;
    expect(s.clauses ?? []).toHaveLength(0);
    expect(s.continuous ?? []).toHaveLength(0);
    expect(s.replacements ?? []).toHaveLength(0);
  });
});
