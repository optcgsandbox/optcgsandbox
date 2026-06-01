// EB01-055 Charlotte Compote — VANILLA.
import { describe, expect, it } from 'vitest';
import cardsData from '../../../data/cards.json';
import type { Card } from '../../cards/Card';

const ALL = cardsData as unknown as Card[];
const C = ALL.find(c => c.id === 'EB01-055')!;

describe('EB01-055 — Charlotte Compote (vanilla)', () => {
  it('7-cost 9000-power yellow Big Mom Pirates', () => {
    expect((C as { cost: number }).cost).toBe(7);
    expect((C as { power: number }).power).toBe(9000);
    expect(C.colors).toContain('yellow');
    expect(C.traits).toEqual(['Big Mom Pirates']);
  });
  it('empty effect spec', () => {
    const s = C.effectSpecV2!;
    expect(s.clauses ?? []).toHaveLength(0);
    expect(s.continuous ?? []).toHaveLength(0);
    expect(s.replacements ?? []).toHaveLength(0);
  });
});
