/**
 * Per-card semantic test — EB01-005 Doma (vanilla character).
 *
 * No printed effect. Test asserts spec is vanilla shape (no clauses,
 * continuous, or replacements) and stats match the card frame.
 */

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { Card } from '../../cards/Card.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

function loadCards(): Card[] {
  const raw = readFileSync(resolve(__dirname, '../../../data/cards.json'), 'utf-8');
  return JSON.parse(raw) as Card[];
}

describe('EB01-005 — Doma (vanilla character)', () => {
  const allCards = loadCards();
  const card = allCards.find((c) => c.id === 'EB01-005');
  if (card === undefined) throw new Error('EB01-005 not in cards.json');

  it('is a character', () => {
    expect(card.kind).toBe('character');
  });

  it('has cost 1 / power 3000 / counter 1000', () => {
    const c = card as { cost: number; power: number; counterValue: number };
    expect(c.cost).toBe(1);
    expect(c.power).toBe(3000);
    expect(c.counterValue).toBe(1000);
  });

  it('is red and has the Whitebeard Pirates Allies trait', () => {
    expect(card.colors).toContain('red');
    expect(card.traits).toContain('Whitebeard Pirates Allies');
  });

  it('has no clauses, no continuous, no replacements (vanilla)', () => {
    const spec = card.effectSpecV2;
    expect(spec).toBeDefined();
    expect(spec!.clauses ?? []).toHaveLength(0);
    expect(spec!.continuous ?? []).toHaveLength(0);
    expect(spec!.replacements ?? []).toHaveLength(0);
  });

  it('has no keywords (no Rush / Blocker / Banish / Double Attack)', () => {
    expect((card as { keywords: string[] }).keywords).toEqual([]);
  });
});
