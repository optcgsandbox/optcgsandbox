/**
 * Engine V2 — shared card-filter matcher.
 *
 * Single canonical filter implementation used by target resolvers AND
 * cost handlers. Reads every filter field actually present in cards.json:
 *   kind, kindsAny, trait, typeIncludes, color, colors, nameIs,
 *   nameExcludes, costMin/Max, powerMin/Max, basePowerMin/Max, keyword,
 *   hasTrigger.
 *
 * Pure read over state — no mutation.
 */

import type { Card } from '../../cards/Card.js';
import { instHasKeyword } from '../../state/derived/keyword.js';
import type { CardInstance, GameState } from '../../state/types.js';

export interface CardFilter {
  readonly kind?: string;
  readonly kindsAny?: ReadonlyArray<string>;
  readonly trait?: string;
  readonly traitsAny?: ReadonlyArray<string>;
  readonly typeIncludes?: string;
  readonly color?: string;
  readonly colors?: ReadonlyArray<string>;
  readonly attribute?: string;
  readonly nameIs?: string;
  readonly nameExcludes?: string;
  readonly costMin?: number;
  readonly costMax?: number;
  readonly minCost?: number; // alias
  readonly maxCost?: number; // alias
  readonly powerMin?: number;
  readonly powerMax?: number;
  readonly basePowerMin?: number;
  readonly basePowerMax?: number;
  readonly keyword?: string;
  readonly hasTrigger?: boolean;
  readonly noBaseEffect?: boolean;
  readonly rested?: boolean;
  readonly active?: boolean;
  readonly notSelf?: boolean;
  readonly attachedDonMin?: number;
  readonly costEqualsAttachedDon?: boolean;
}

function cardCost(card: Card): number {
  if (card.kind === 'character' || card.kind === 'event' || card.kind === 'stage') {
    return card.cost;
  }
  return 0;
}

function cardPower(card: Card): number {
  if (card.kind === 'character' || card.kind === 'leader') return card.power;
  return 0;
}

/**
 * Match `inst` against `filter`. Returns true if filter is undefined / empty.
 */
export function matchesCardFilter(
  state: GameState,
  inst: CardInstance,
  filter: CardFilter | undefined,
): boolean {
  if (filter === undefined) return true;
  const card = state.cardLibrary[inst.cardId] as Card | undefined;
  if (card === undefined) return false;

  if (filter.kind !== undefined && card.kind !== filter.kind) return false;
  if (filter.kindsAny !== undefined && !filter.kindsAny.includes(card.kind)) return false;
  if (filter.trait !== undefined && !card.traits.includes(filter.trait)) return false;
  if (filter.traitsAny !== undefined && !filter.traitsAny.some((t) => card.traits.includes(t))) return false;
  if (filter.typeIncludes !== undefined && !card.traits.some((t) => t.includes(filter.typeIncludes!))) return false;
  if (filter.color !== undefined && !card.colors.includes(filter.color as never)) return false;
  if (filter.colors !== undefined && !filter.colors.some((c) => card.colors.includes(c as never))) return false;
  if (filter.attribute !== undefined && card.attribute !== filter.attribute) return false;
  if (filter.nameIs !== undefined && card.name !== filter.nameIs) return false;
  if (filter.nameExcludes !== undefined && card.name === filter.nameExcludes) return false;

  const cost = cardCost(card);
  const minCost = filter.costMin ?? filter.minCost;
  const maxCost = filter.costMax ?? filter.maxCost;
  if (minCost !== undefined && cost < minCost) return false;
  if (maxCost !== undefined && cost > maxCost) return false;

  // power = base power for filter "powerMin/Max"; effective power not used
  // for cost-filter checks (per cards.json semantics — these match printed)
  const power = cardPower(card);
  if (filter.powerMin !== undefined && power < filter.powerMin) return false;
  if (filter.powerMax !== undefined && power > filter.powerMax) return false;
  if (filter.basePowerMin !== undefined && power < filter.basePowerMin) return false;
  if (filter.basePowerMax !== undefined && power > filter.basePowerMax) return false;

  if (filter.keyword !== undefined && !instHasKeyword(state, inst, filter.keyword)) return false;

  // hasTrigger: spec.clauses includes trigger:'trigger'
  if (filter.hasTrigger !== undefined) {
    const spec = card.effectSpecV2;
    const hasTrig = spec !== undefined && Array.isArray(spec.clauses) && spec.clauses.some((cl) => cl.trigger === 'trigger');
    if (filter.hasTrigger !== hasTrig) return false;
  }

  // noBaseEffect: card has no effectSpecV2 clauses (vanilla)
  if (filter.noBaseEffect === true) {
    const spec = card.effectSpecV2;
    const hasClauses = spec !== undefined && Array.isArray(spec.clauses) && spec.clauses.length > 0;
    if (hasClauses) return false;
  }

  // rested / active: instance state
  if (filter.rested === true && inst.rested !== true) return false;
  if (filter.active === true && inst.rested === true) return false;

  // attachedDonMin: count of attached DON (active + rested)
  if (filter.attachedDonMin !== undefined) {
    const attached = inst.attachedDon.length + inst.attachedDonRested.length;
    if (attached < filter.attachedDonMin) return false;
  }

  // costEqualsAttachedDon: target's printed cost == its attached DON count
  if (filter.costEqualsAttachedDon === true) {
    const attached = inst.attachedDon.length + inst.attachedDonRested.length;
    if (cardCost(card) !== attached) return false;
  }

  return true;
}

/** Extract `count` from a cost-value object, defaulting to 1. */
export function filterCostCount(value: unknown): number {
  if (typeof value === 'object' && value !== null) {
    const c = (value as { count?: unknown }).count;
    if (typeof c === 'number') return c;
  }
  return 1;
}

/** Extract `filter` from a cost-value object. */
export function filterCostFilter(value: unknown): CardFilter | undefined {
  if (typeof value === 'object' && value !== null) {
    const f = (value as { filter?: unknown }).filter;
    if (typeof f === 'object' && f !== null) return f as CardFilter;
  }
  return undefined;
}
