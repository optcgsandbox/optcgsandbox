/**
 * Per-card semantic test — EB01-055 Charlotte Compote (vanilla character).
 * Printed text: "-". Stats 7c/9000p/1000cv, yellow, Big Mom Pirates.
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

describe('EB01-055 — Charlotte Compote (vanilla)', () => {
  const c = loadCards().find((x) => x.id === 'EB01-055');
  if (c === undefined) throw new Error('EB01-055 not found');
  const card = c as { cost: number; power: number; counterValue: number; colors: string[]; traits: string[] };

  it('is a character with 7c/9000p/1000cv yellow Big Mom Pirates', () => {
    expect(c.kind).toBe('character');
    expect(card.cost).toBe(7);
    expect(card.power).toBe(9000);
    expect(card.counterValue).toBe(1000);
    expect(card.colors).toContain('yellow');
    expect(card.traits).toContain('Big Mom Pirates');
  });

  it('vanilla spec', () => {
    expect(c.effectSpecV2!.clauses ?? []).toHaveLength(0);
    expect(c.effectSpecV2!.continuous ?? []).toHaveLength(0);
    expect(c.effectSpecV2!.replacements ?? []).toHaveLength(0);
  });
});
