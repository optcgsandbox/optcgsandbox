/**
 * Per-card semantic test — EB01-025 Fourtricks (vanilla character).
 *
 * Printed text (cards.json): "-" (no printed effect)
 * Stats: 3 cost / 5000 power / 1000 counter / SMILE + Animal Kingdom Pirates / blue
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

describe('EB01-025 — Fourtricks (vanilla character)', () => {
  const allCards = loadCards();
  const card = allCards.find((c) => c.id === 'EB01-025');
  if (card === undefined) throw new Error('EB01-025 not in cards.json');

  it('is a character', () => {
    expect(card.kind).toBe('character');
  });

  it('printed stats: cost 3 / power 5000 / counter 1000', () => {
    const c = card as { cost: number; power: number; counterValue: number };
    expect(c.cost).toBe(3);
    expect(c.power).toBe(5000);
    expect(c.counterValue).toBe(1000);
  });

  it('blue color + SMILE + Animal Kingdom Pirates traits', () => {
    expect(card.colors).toContain('blue');
    expect(card.traits).toContain('SMILE');
    expect(card.traits).toContain('Animal Kingdom Pirates');
  });

  it('vanilla spec (no clauses, continuous, replacements, keywords)', () => {
    expect(card.effectSpecV2!.clauses ?? []).toHaveLength(0);
    expect(card.effectSpecV2!.continuous ?? []).toHaveLength(0);
    expect(card.effectSpecV2!.replacements ?? []).toHaveLength(0);
    expect((card as { keywords: string[] }).keywords).toEqual([]);
  });
});
