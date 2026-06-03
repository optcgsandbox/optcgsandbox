/**
 * Engine V2 — registry-coverage gate (Plan §2.4, A8 boot validation).
 *
 * Walks every effectSpecV2 / replacement / continuous in cards.json and
 * asserts the primitive kind has a registered handler. Catches silent
 * dispatch failures the moment a new primitive lands in the corpus.
 */

// @ts-expect-error Node built-ins resolve at runtime via vitest
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { resolve } from 'node:path';
// @ts-expect-error Node built-ins resolve at runtime via vitest
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Card } from '../cards/Card.js';
import {
  actionHandlers,
  conditionHandlers,
  costHandlers,
  continuousHandlers,
  replacementHandlers,
  targetResolvers,
  triggerEmitters,
} from '../registry/types.js';
import { registerAllHandlers } from '../registry/handlers/index.js';
import { registerAllReducers } from '../reducers/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

beforeAll(() => {
  registerAllReducers();
  registerAllHandlers();
});

function loadCards(): Card[] {
  const raw = readFileSync(resolve(__dirname, '../../data/cards.json'), 'utf-8');
  return JSON.parse(raw) as Card[];
}

interface UsedKinds {
  triggers: Set<string>;
  conditions: Set<string>;
  actions: Set<string>;
  targets: Set<string>;
  costs: Set<string>;
  continuous: Set<string>;
  replacements: Set<string>;
}

function makeUsed(): UsedKinds {
  return {
    triggers: new Set(),
    conditions: new Set(),
    actions: new Set(),
    targets: new Set(),
    costs: new Set(),
    continuous: new Set(),
    replacements: new Set(),
  };
}

function visitCondition(cond: unknown, used: UsedKinds): void {
  if (typeof cond !== 'object' || cond === null) return;
  const c = cond as { type?: string; conditions?: unknown[]; condition?: unknown };
  if (typeof c.type !== 'string') return;
  // Combinators (and/or/not) don't need a registered handler — handled
  // inline by EffectDispatcher.evaluateCondition.
  if (c.type === 'and' || c.type === 'or') {
    for (const sub of c.conditions ?? []) visitCondition(sub, used);
    return;
  }
  if (c.type === 'not') {
    visitCondition(c.condition, used);
    return;
  }
  used.conditions.add(c.type);
}

function visitAction(action: unknown, used: UsedKinds): void {
  if (typeof action !== 'object' || action === null) return;
  const a = action as {
    kind?: string;
    actions?: unknown[];
    thenAction?: unknown;
    options?: unknown[];
  };
  if (typeof a.kind === 'string') used.actions.add(a.kind);
  for (const sub of a.actions ?? []) visitAction(sub, used);
  if (a.thenAction !== undefined) visitAction(a.thenAction, used);
  for (const opt of a.options ?? []) {
    if (typeof opt === 'object' && opt !== null) {
      const o = opt as { action?: unknown };
      if (o.action !== undefined) visitAction(o.action, used);
    }
  }
}

function visitTarget(target: unknown, used: UsedKinds): void {
  if (typeof target !== 'object' || target === null) return;
  const t = target as { kind?: string };
  if (typeof t.kind === 'string') used.targets.add(t.kind);
}

function visitCost(cost: unknown, used: UsedKinds): void {
  if (typeof cost !== 'object' || cost === null) return;
  for (const key of Object.keys(cost)) used.costs.add(key);
}

describe('engine-v2 registry coverage', () => {
  const cards = loadCards();
  const used = makeUsed();

  for (const card of cards) {
    const spec = card.effectSpecV2;
    if (spec === undefined) continue;

    for (const clause of spec.clauses ?? []) {
      if (typeof clause.trigger === 'string') used.triggers.add(clause.trigger);
      visitCondition(clause.condition, used);
      visitAction(clause.action, used);
      visitTarget(clause.target, used);
      visitCost(clause.cost, used);
    }
    for (const cont of spec.continuous ?? []) {
      visitCondition(cont.condition, used);
      const a = (cont.action ?? {}) as { kind?: string };
      if (typeof a.kind === 'string') used.continuous.add(a.kind);
    }
    for (const rep of spec.replacements ?? []) {
      if (typeof rep.trigger === 'string') used.replacements.add(rep.trigger);
      visitCondition(rep.condition, used);
      visitAction(rep.action, used);
      visitTarget((rep as { target?: unknown }).target, used);
      visitCost(rep.cost, used);
    }
  }

  it('every action.kind in corpus is registered', () => {
    const missing = [...used.actions].filter((k) => !actionHandlers.has(k));
    expect(missing).toEqual([]);
  });

  it('every condition.type in corpus is registered', () => {
    const missing = [...used.conditions].filter((k) => !conditionHandlers.has(k));
    expect(missing).toEqual([]);
  });

  it('every target.kind in corpus is registered', () => {
    const missing = [...used.targets].filter((k) => !targetResolvers.has(k));
    expect(missing).toEqual([]);
  });

  it('every cost shape key in corpus is registered', () => {
    const missing = [...used.costs].filter((k) => !costHandlers.has(k));
    expect(missing).toEqual([]);
  });

  it('every continuous action.kind in corpus is registered', () => {
    const missing = [...used.continuous].filter((k) => !continuousHandlers.has(k));
    expect(missing).toEqual([]);
  });

  it('every replacement trigger in corpus is registered', () => {
    const missing = [...used.replacements].filter((k) => !replacementHandlers.has(k));
    expect(missing).toEqual([]);
  });

  it('every clause trigger in corpus is registered', () => {
    const missing = [...used.triggers].filter((k) => !triggerEmitters.has(k));
    expect(missing).toEqual([]);
  });
});
