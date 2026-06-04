/**
 * Per-card semantic test — EB01-041 Crocus (vanilla character).
 * Printed text: "-". Stats 6c/8000p/1000cv, black, Former Roger Pirates.
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

describe('EB01-041 — Crocus (vanilla character)', () => {
  const allCards = loadCards();
  const card = allCards.find((c) => c.id === 'EB01-041');
  if (card === undefined) throw new Error('EB01-041 not in cards.json');

  it('is a character', () => {
    expect(card.kind).toBe('character');
  });

  it('printed stats: 6c / 8000p / 1000cv', () => {
    const c = card as { cost: number; power: number; counterValue: number };
    expect(c.cost).toBe(6);
    expect(c.power).toBe(8000);
    expect(c.counterValue).toBe(1000);
  });

  it('black color + Former Roger Pirates trait', () => {
    expect(card.colors).toContain('black');
    expect(card.traits).toContain('Former Roger Pirates');
  });

  it('vanilla spec', () => {
    expect(card.effectSpecV2!.clauses ?? []).toHaveLength(0);
    expect(card.effectSpecV2!.continuous ?? []).toHaveLength(0);
    expect(card.effectSpecV2!.replacements ?? []).toHaveLength(0);
  });
});
