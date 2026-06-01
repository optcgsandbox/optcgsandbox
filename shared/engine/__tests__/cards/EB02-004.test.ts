// EB02-004 Don Accino — VANILLA.
import { describe, expect, it } from 'vitest';
import cardsData from '../../../data/cards.json';
import type { Card } from '../../cards/Card';

const ALL = cardsData as unknown as Card[];
const C = ALL.find(c => c.id === 'EB02-004')!;

describe('EB02-004 — Don Accino (vanilla)', () => {
  it('8-cost 10000-power red Accino Family', () => {
    expect((C as { cost: number }).cost).toBe(8);
    expect((C as { power: number }).power).toBe(10000);
    expect(C.colors).toContain('red');
    expect(C.traits).toEqual(['Accino Family']);
  });
  it('empty effect spec (ground-truth vanilla)', () => {
    const s = C.effectSpecV2!;
    expect(s.clauses ?? []).toHaveLength(0);
    expect(s.continuous ?? []).toHaveLength(0);
    expect(s.replacements ?? []).toHaveLength(0);
  });
});
