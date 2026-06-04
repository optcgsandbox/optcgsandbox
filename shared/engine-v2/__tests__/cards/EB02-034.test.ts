/**
 * Per-card semantic test — EB02-034 Komei (vanilla character).
 * "-". 4c/6000p/1000cv purple Navy+Foxy Pirates.
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

describe('EB02-034 — Komei (vanilla)', () => {
  const c = loadCards().find((x) => x.id === 'EB02-034');
  if (c === undefined) throw new Error('EB02-034 not found');
  const card = c as { cost: number; power: number; counterValue: number };

  it('character 4c/6000p/1000cv purple Navy+Foxy Pirates', () => {
    expect(c.kind).toBe('character');
    expect(card.cost).toBe(4);
    expect(card.power).toBe(6000);
    expect(card.counterValue).toBe(1000);
    expect(c.colors).toContain('purple');
    expect(c.traits).toContain('Navy');
    expect(c.traits).toContain('Foxy Pirates');
  });

  it('vanilla spec', () => {
    expect(c.effectSpecV2!.clauses ?? []).toHaveLength(0);
    expect(c.effectSpecV2!.continuous ?? []).toHaveLength(0);
    expect(c.effectSpecV2!.replacements ?? []).toHaveLength(0);
  });
});
