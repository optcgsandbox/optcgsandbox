/**
 * Per-card semantic test — EB02-030 And That's When Somebody Makes Fun
 * of Their Friend's Dream!!!! ([Counter] event with replacement).
 *
 * Printed text (cards.json):
 *   "[Counter] If any of your Characters would be K.O.'d in battle during
 *    this turn, you may trash 1 card from your hand instead."
 *
 * 5-axis: one replacement entry — trigger:'would_be_ko' whenSource:'battle'
 *   / cost discardHand:1 / action noop / conditional:true.
 *
 * Counter-event legality concern (already logged under EB01-038): this
 * card has counterEventBoost:null too, may be unplayable as counter today.
 */

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { Card, EventCard } from '../../cards/Card.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

function loadCards(): Card[] {
  const raw = readFileSync(resolve(__dirname, '../../../data/cards.json'), 'utf-8');
  return JSON.parse(raw) as Card[];
}

describe("EB02-030 — Somebody Makes Fun of Their Friend's Dream", () => {
  const c = loadCards().find((x) => x.id === 'EB02-030');
  if (c === undefined || c.kind !== 'event') throw new Error('EB02-030 invalid');
  const ev = c as EventCard;
  const reps = ev.effectSpecV2!.replacements!;

  it('shape: 1 replacement / would_be_ko / battle / cost discardHand:1 / noop / conditional', () => {
    expect(reps).toHaveLength(1);
    const r = reps[0]!;
    expect(r.trigger).toBe('would_be_ko');
    expect((r as { whenSource: string }).whenSource).toBe('battle');
    expect((r as { cost: Record<string, unknown> }).cost['discardHand']).toBe(1);
    expect(r.action.kind).toBe('noop');
    expect((r as { conditional: boolean }).conditional).toBe(true);
  });
});
