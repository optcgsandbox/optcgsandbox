/**
 * Per-card semantic test — EB02-029 Grandpa Ryu (vanilla character).
 * "-". 3c/5000p/1000cv blue Animal+East Blue.
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

describe('EB02-029 — Grandpa Ryu (vanilla)', () => {
  const c = loadCards().find((x) => x.id === 'EB02-029');
  if (c === undefined) throw new Error('EB02-029 not found');
  const card = c as { cost: number; power: number; counterValue: number };

  it('character 3c/5000p/1000cv blue Animal+East Blue', () => {
    expect(c.kind).toBe('character');
    expect(card.cost).toBe(3);
    expect(card.power).toBe(5000);
    expect(card.counterValue).toBe(1000);
    expect(c.colors).toContain('blue');
    expect(c.traits).toContain('Animal');
    expect(c.traits).toContain('East Blue');
  });

  it('vanilla spec', () => {
    expect(c.effectSpecV2!.clauses ?? []).toHaveLength(0);
    expect(c.effectSpecV2!.continuous ?? []).toHaveLength(0);
    expect(c.effectSpecV2!.replacements ?? []).toHaveLength(0);
  });
});
