/**
 * Engine V2 — invariant assertions.
 *
 * Run after every reducer call in dev/test mode. Catches state corruption
 * (DON leaks, field overflow, instance count drift, OPT key duplication, etc.)
 * the moment it happens, not 50 turns later in a soak run.
 *
 * Cross-references:
 * - Implementation spec §16
 * - Plan v1 §7 + Plan v2 §7.7-7.9
 */

import {
  DON_DECK_SIZE,
  FIELD_CAP,
  type CardInstance,
  type GameState,
  type PlayerId,
} from '../state/types.js';

export class InvariantError extends Error {
  constructor(name: string, detail: string) {
    super(`InvariantError [${name}]: ${detail}`);
    this.name = 'InvariantError';
  }
}

/**
 * Per CR §6-2-2: total DON across donDeck + donCostArea + donRested +
 * Σ attached must equal DON_DECK_SIZE per player.
 *
 * Closes Bug class C5 (DON leaks).
 */
export function assertDonConservation(state: GameState): void {
  for (const side of ['A', 'B'] as PlayerId[]) {
    const pl = state.players[side];
    const expected = state.gameRules.donDeckSize ?? DON_DECK_SIZE;
    let actual = pl.donDeck.length + pl.donCostArea.length + pl.donRested.length;
    const allChars: CardInstance[] = [pl.leader, ...pl.field];
    if (pl.stage !== null) allChars.push(pl.stage);
    for (const c of allChars) {
      actual += c.attachedDon.length + c.attachedDonRested.length;
    }
    if (actual !== expected) {
      throw new InvariantError(
        'DON_CONSERVATION',
        `player ${side}: ${actual} DON instances total; expected ${expected}.`,
      );
    }
  }
}

/** Per CR §3-7-6: field cap = 5 characters per side. */
export function assertFieldCap(state: GameState): void {
  for (const side of ['A', 'B'] as PlayerId[]) {
    const pl = state.players[side];
    if (pl.field.length > FIELD_CAP) {
      throw new InvariantError(
        'FIELD_CAP',
        `player ${side} field has ${pl.field.length} chars; max is ${FIELD_CAP}.`,
      );
    }
  }
}

/**
 * Each instanceId in state.instances must appear in exactly ONE zone
 * (or none, for DON not yet drawn). No duplicates, no orphans-in-field.
 */
export function assertInstanceCountStable(state: GameState): void {
  const seen = new Set<string>();
  const dup = (id: string, zone: string): void => {
    if (seen.has(id)) {
      throw new InvariantError(
        'INSTANCE_DUPLICATE',
        `instanceId "${id}" appears in multiple zones (latest: ${zone}).`,
      );
    }
    seen.add(id);
  };
  for (const side of ['A', 'B'] as PlayerId[]) {
    const pl = state.players[side];
    dup(pl.leader.instanceId, `${side}.leader`);
    for (const c of pl.field) dup(c.instanceId, `${side}.field`);
    if (pl.stage !== null) dup(pl.stage.instanceId, `${side}.stage`);
    for (const id of pl.hand) dup(id, `${side}.hand`);
    for (const id of pl.deck) dup(id, `${side}.deck`);
    for (const id of pl.trash) dup(id, `${side}.trash`);
    for (const id of pl.life) dup(id, `${side}.life`);
    for (const id of pl.donDeck) dup(id, `${side}.donDeck`);
    for (const id of pl.donCostArea) dup(id, `${side}.donCostArea`);
    for (const id of pl.donRested) dup(id, `${side}.donRested`);
    for (const id of pl.exile) dup(id, `${side}.exile`);
  }
}

/** Per Plan v2 §7.8: perTurn.effectsUsed must have no duplicates. */
export function assertPerTurnEffectsUsedUnique(state: GameState): void {
  for (const [id, inst] of Object.entries(state.instances)) {
    const arr = inst.perTurn.effectsUsed;
    if (new Set(arr).size !== arr.length) {
      throw new InvariantError(
        'PERTURN_DUP',
        `instance "${id}" has duplicate OPT keys in perTurn.effectsUsed: ${arr.join(', ')}.`,
      );
    }
  }
}

/**
 * Per Plan v2 §7.9: gameRules is Permanent-only. State at end of reducer
 * must have identical gameRules JSON to baseline (captured pre-reducer).
 * Caller supplies the baseline; if omitted, this check is a no-op.
 */
export function assertGameRulesImmutable(state: GameState, baseline?: GameState): void {
  if (baseline === undefined) return;
  const before = JSON.stringify(baseline.gameRules);
  const after = JSON.stringify(state.gameRules);
  if (before !== after) {
    throw new InvariantError(
      'GAMERULES_MUTATED',
      `gameRules changed mid-reducer.\n  before: ${before}\n  after:  ${after}`,
    );
  }
}

/**
 * Pending-phase consistency: if state.pending !== null, state.phase must match
 * the pending kind's expected suspend-phase.
 */
export function assertPendingPhaseConsistency(state: GameState): void {
  if (state.pending === null) return;
  const expectedPhases: Record<string, string> = {
    attack: 'block_window', // also valid: 'counter_window', 'damage_resolution'
    trigger: 'trigger_window',
    peek: 'peek_choice',
    discard: 'discard_choice',
    choose_one: 'choose_one',
    attack_target_pick: 'attack_target_pick',
  };
  const expected = expectedPhases[state.pending.kind];
  // attack has 3 valid phases; soft-check the rest
  if (state.pending.kind === 'attack') {
    if (
      state.phase !== 'block_window' &&
      state.phase !== 'counter_window' &&
      state.phase !== 'damage_resolution'
    ) {
      throw new InvariantError(
        'PENDING_PHASE',
        `pending.kind="attack" but phase="${state.phase}".`,
      );
    }
    return;
  }
  if (expected !== undefined && state.phase !== expected) {
    throw new InvariantError(
      'PENDING_PHASE',
      `pending.kind="${state.pending.kind}" but phase="${state.phase}" (expected "${expected}").`,
    );
  }
}

/**
 * Run all invariants. Caller passes baseline for `assertGameRulesImmutable`.
 * Order: cheap checks first; expensive (zone walks) last.
 */
export function assertInvariants(state: GameState, baseline?: GameState): void {
  assertFieldCap(state);
  assertPendingPhaseConsistency(state);
  assertPerTurnEffectsUsedUnique(state);
  assertGameRulesImmutable(state, baseline);
  assertDonConservation(state);
  assertInstanceCountStable(state);
}
