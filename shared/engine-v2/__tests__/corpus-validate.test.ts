/**
 * Engine V2 — corpus validation against real cards.json.
 *
 * Runs validateCardsAgainstRegistry against the live 2489-card corpus.
 * Throws RegistryValidationError listing every missing primitive.
 *
 * This test is the BOOT GATE — it tells us exactly which primitives still
 * need V0 handlers before any card can dispatch end-to-end.
 */

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Card } from '../cards/Card.js';
import { registerAllHandlers } from '../registry/handlers/index.js';
import { validateCardsAgainstRegistry } from '../registry/validate.js';
import { registerAllReducers } from '../reducers/index.js';

// @ts-expect-error import.meta.url resolves at runtime
const __filename = fileURLToPath(import.meta.url);
// @ts-expect-error
const __dirname = resolve(__filename, '..');

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

describe('engine-v2 corpus validation', () => {
  it('every primitive in cards.json has a registered handler', () => {
    const cardsPath = resolve(__dirname, '../../data/cards.json');
    const raw = readFileSync(cardsPath, 'utf-8');
    const cards = JSON.parse(raw) as Card[];
    expect(cards.length).toBeGreaterThan(2000);
    expect(() => validateCardsAgainstRegistry(cards)).not.toThrow();
  });
});
