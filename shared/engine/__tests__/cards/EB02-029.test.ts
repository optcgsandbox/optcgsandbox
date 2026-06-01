// EB02-029 Grandpa Ryu — VANILLA.
import { describe, expect, it } from 'vitest';
import cardsData from '../../../data/cards.json';
import type { Card } from '../../cards/Card';

const ALL = cardsData as unknown as Card[];
const C = ALL.find(c => c.id === 'EB02-029')!;

describe('EB02-029 — Grandpa Ryu (vanilla)', () => {
  it('3-cost 5000-power blue Animal/East Blue', () => {
    expect((C as { cost: number }).cost).toBe(3);
    expect((C as { power: number }).power).toBe(5000);
    expect(C.colors).toContain('blue');
    expect(C.traits).toEqual(['Animal', 'East Blue']);
  });
  it('empty effect spec (ground-truth vanilla)', () => {
    const s = C.effectSpecV2!;
    expect(s.clauses ?? []).toHaveLength(0);
    expect(s.continuous ?? []).toHaveLength(0);
    expect(s.replacements ?? []).toHaveLength(0);
  });
});
