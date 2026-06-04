/** EB02-043 Jonathan: vanilla 7c/9000p/1000cv black Navy. */
// @ts-expect-error
import { readFileSync } from 'node:fs';
// @ts-expect-error
import { resolve } from 'node:path';
// @ts-expect-error
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Card } from '../../cards/Card.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

describe('EB02-043 — Jonathan (vanilla)', () => {
  const cards = JSON.parse(readFileSync(resolve(__dirname, '../../../data/cards.json'), 'utf-8')) as Card[];
  const c = cards.find((x) => x.id === 'EB02-043');
  if (c === undefined) throw new Error('EB02-043 not found');
  const card = c as { cost: number; power: number; counterValue: number };

  it('character 7c/9000p/1000cv black Navy', () => {
    expect(c.kind).toBe('character');
    expect(card.cost).toBe(7);
    expect(card.power).toBe(9000);
    expect(card.counterValue).toBe(1000);
    expect(c.colors).toContain('black');
    expect(c.traits).toContain('Navy');
  });

  it('vanilla spec', () => {
    expect(c.effectSpecV2!.clauses ?? []).toHaveLength(0);
    expect(c.effectSpecV2!.continuous ?? []).toHaveLength(0);
    expect(c.effectSpecV2!.replacements ?? []).toHaveLength(0);
  });
});
