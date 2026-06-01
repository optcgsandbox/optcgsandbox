// EB02-034 Komei — VANILLA.
import { describe, expect, it } from 'vitest';
import cardsData from '../../../data/cards.json';
import type { Card } from '../../cards/Card';

const ALL = cardsData as unknown as Card[];
const C = ALL.find(c => c.id === 'EB02-034')!;

describe('EB02-034 — Komei (vanilla)', () => {
  it('4-cost 6000-power purple Navy/Foxy Pirates', () => {
    expect((C as { cost: number }).cost).toBe(4);
    expect((C as { power: number }).power).toBe(6000);
    expect(C.colors).toContain('purple');
    expect(C.traits).toEqual(['Navy', 'Foxy Pirates']);
  });
  it('empty effect spec (ground-truth vanilla)', () => {
    const s = C.effectSpecV2!;
    expect(s.clauses ?? []).toHaveLength(0);
    expect(s.continuous ?? []).toHaveLength(0);
    expect(s.replacements ?? []).toHaveLength(0);
  });
});
