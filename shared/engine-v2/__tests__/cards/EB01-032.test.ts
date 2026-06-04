/**
 * Per-card semantic test — EB01-032 Army Wolves (vanilla character).
 * Printed text: "-". Stats 5c/7000p/1000cv, purple, Animal + Impel Down.
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

describe('EB01-032 — Army Wolves (vanilla character)', () => {
  const allCards = loadCards();
  const card = allCards.find((c) => c.id === 'EB01-032');
  if (card === undefined) throw new Error('EB01-032 not in cards.json');

  it('is a character', () => {
    expect(card.kind).toBe('character');
  });

  it('printed stats: 5c / 7000p / 1000cv', () => {
    const c = card as { cost: number; power: number; counterValue: number };
    expect(c.cost).toBe(5);
    expect(c.power).toBe(7000);
    expect(c.counterValue).toBe(1000);
  });

  it('purple color + Animal + Impel Down traits', () => {
    expect(card.colors).toContain('purple');
    expect(card.traits).toContain('Animal');
    expect(card.traits).toContain('Impel Down');
  });

  it('vanilla spec', () => {
    expect(card.effectSpecV2!.clauses ?? []).toHaveLength(0);
    expect(card.effectSpecV2!.continuous ?? []).toHaveLength(0);
    expect(card.effectSpecV2!.replacements ?? []).toHaveLength(0);
  });
});
