// EB01-005 Doma (character) — VANILLA. No printed effect.
// We verify the spec is empty (no clauses / continuous / replacements) and
// the printed stats line up with what the engine sees.
import { describe, expect, it } from 'vitest';
import cardsData from '../../../data/cards.json';
import type { Card } from '../../cards/Card';

const ALL_CARDS = cardsData as unknown as Card[];
const EB01_005 = ALL_CARDS.find(c => c.id === 'EB01-005')!;

describe('EB01-005 — Doma (vanilla character)', () => {
  it('is a character', () => {
    expect(EB01_005.kind).toBe('character');
  });

  it('has cost 1 / power 3000 / counter 1000', () => {
    expect((EB01_005 as { cost: number }).cost).toBe(1);
    expect((EB01_005 as { power: number }).power).toBe(3000);
    expect((EB01_005 as { counterValue: number }).counterValue).toBe(1000);
  });

  it('is red and has the Whitebeard Pirates Allies trait', () => {
    expect(EB01_005.colors).toContain('red');
    expect(EB01_005.traits).toContain('Whitebeard Pirates Allies');
  });

  it('has no clauses, no continuous effects, and no replacements (vanilla)', () => {
    const spec = EB01_005.effectSpecV2;
    expect(spec).toBeDefined();
    expect(spec!.clauses ?? []).toHaveLength(0);
    expect(spec!.continuous ?? []).toHaveLength(0);
    expect(spec!.replacements ?? []).toHaveLength(0);
  });

  it('has no keywords (no Rush / Blocker / Banish / Double Attack)', () => {
    expect((EB01_005 as { keywords: string[] }).keywords).toEqual([]);
  });
});
