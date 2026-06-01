// EB02-001 Karoo — VANILLA.
import { describe, expect, it } from 'vitest';
import cardsData from '../../../data/cards.json';
import type { Card } from '../../cards/Card';

const ALL = cardsData as unknown as Card[];
const C = ALL.find(c => c.id === 'EB02-001')!;

describe('EB02-001 — Karoo (vanilla)', () => {
  it('5-cost 7000-power red Animal/Alabasta', () => {
    expect((C as { cost: number }).cost).toBe(5);
    expect((C as { power: number }).power).toBe(7000);
    expect(C.colors).toContain('red');
    expect(C.traits).toEqual(['Animal', 'Alabasta']);
  });
  it('empty effect spec (ground-truth vanilla)', () => {
    const s = C.effectSpecV2!;
    expect(s.clauses ?? []).toHaveLength(0);
    expect(s.continuous ?? []).toHaveLength(0);
    expect(s.replacements ?? []).toHaveLength(0);
  });
});
