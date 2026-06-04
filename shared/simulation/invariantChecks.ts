/**
 * Post-move invariant checks for the simulation layer.
 *
 * Pure observation over engine-v2 GameState. Each function returns a list
 * of violation strings (empty = pass). The runner aggregates results and
 * classifies failures via failureReporter.
 *
 * These are deliberately stricter than engine-v2's internal `assertInvariants`
 * — they capture structural assumptions the fuzzer wants to surface.
 */

import { DON_DECK_SIZE } from '../engine-v2/state/types.js';
import type { GameState, PlayerId } from '../engine-v2/state/types.js';

export interface InvariantViolation {
  readonly rule: string;
  readonly detail: string;
}

const PLAYERS: ReadonlyArray<PlayerId> = ['A', 'B'];

function pushIf(out: InvariantViolation[], cond: boolean, rule: string, detail: string): void {
  if (cond) out.push({ rule, detail });
}

/** Every instanceId referenced anywhere must exist in state.instances. */
function checkUndefinedTargets(state: GameState, out: InvariantViolation[]): void {
  for (const pid of PLAYERS) {
    const pl = state.players[pid];
    const zones: Array<[string, ReadonlyArray<string>]> = [
      [`players.${pid}.hand`, pl.hand],
      [`players.${pid}.deck`, pl.deck],
      [`players.${pid}.trash`, pl.trash],
      [`players.${pid}.life`, pl.life],
      [`players.${pid}.donDeck`, pl.donDeck],
      [`players.${pid}.donCostArea`, pl.donCostArea],
      [`players.${pid}.donRested`, pl.donRested],
      [`players.${pid}.exile`, pl.exile],
    ];
    for (const [zoneName, ids] of zones) {
      for (const id of ids) {
        pushIf(out, state.instances[id] === undefined, 'undefined_target', `${zoneName} references missing instance ${id}`);
      }
    }
    // field + stage carry the inst directly — verify the inst's id maps back
    for (const inst of pl.field) {
      pushIf(out, state.instances[inst.instanceId] === undefined, 'undefined_target', `players.${pid}.field has inst ${inst.instanceId} not in state.instances`);
    }
    if (pl.stage !== null) {
      pushIf(out, state.instances[pl.stage.instanceId] === undefined, 'undefined_target', `players.${pid}.stage inst ${pl.stage.instanceId} not in state.instances`);
    }
    pushIf(out, state.instances[pl.leader.instanceId] === undefined, 'undefined_target', `players.${pid}.leader inst ${pl.leader.instanceId} not in state.instances`);
  }
}

/** Each instanceId appears in exactly one zone (no double-placement, no orphans). */
function checkZoneExclusivity(state: GameState, out: InvariantViolation[]): void {
  const seen = new Map<string, string>(); // instanceId → zoneName
  function note(id: string, zone: string): void {
    if (seen.has(id)) {
      out.push({ rule: 'zone_exclusivity', detail: `instance ${id} in both ${seen.get(id)} and ${zone}` });
    } else {
      seen.set(id, zone);
    }
  }
  for (const pid of PLAYERS) {
    const pl = state.players[pid];
    note(pl.leader.instanceId, `players.${pid}.leader`);
    for (const id of pl.hand) note(id, `players.${pid}.hand`);
    for (const id of pl.deck) note(id, `players.${pid}.deck`);
    for (const id of pl.trash) note(id, `players.${pid}.trash`);
    for (const id of pl.life) note(id, `players.${pid}.life`);
    for (const id of pl.donDeck) note(id, `players.${pid}.donDeck`);
    for (const id of pl.donCostArea) note(id, `players.${pid}.donCostArea`);
    for (const id of pl.donRested) note(id, `players.${pid}.donRested`);
    for (const id of pl.exile) note(id, `players.${pid}.exile`);
    for (const inst of pl.field) note(inst.instanceId, `players.${pid}.field`);
    if (pl.stage !== null) note(pl.stage.instanceId, `players.${pid}.stage`);
  }
  // attached DON must NOT also appear in a global zone — they live ONLY in their host's attached arrays
  for (const inst of Object.values(state.instances)) {
    for (const donId of inst.attachedDon) {
      if (seen.has(donId)) {
        out.push({ rule: 'zone_exclusivity', detail: `DON ${donId} attached to ${inst.instanceId} AND in ${seen.get(donId)}` });
      } else {
        seen.set(donId, `attached:${inst.instanceId}`);
      }
    }
    for (const donId of inst.attachedDonRested) {
      if (seen.has(donId)) {
        out.push({ rule: 'zone_exclusivity', detail: `DON ${donId} attached-rested to ${inst.instanceId} AND in ${seen.get(donId)}` });
      } else {
        seen.set(donId, `attached-rested:${inst.instanceId}`);
      }
    }
  }
}

/** DON conservation per player: 10 total across donDeck + donCostArea + donRested + attached. */
function checkDonConservation(state: GameState, out: InvariantViolation[]): void {
  for (const pid of PLAYERS) {
    const pl = state.players[pid];
    let attached = 0;
    for (const inst of Object.values(state.instances)) {
      if (inst.controller !== pid) continue;
      attached += inst.attachedDon.length + inst.attachedDonRested.length;
    }
    // Leader's own attached DON also counts (its controller is pid)
    const total = pl.donDeck.length + pl.donCostArea.length + pl.donRested.length + attached;
    pushIf(out, total !== DON_DECK_SIZE, 'don_conservation', `player ${pid} has ${total} DON (expected ${DON_DECK_SIZE}): donDeck=${pl.donDeck.length} cost=${pl.donCostArea.length} rested=${pl.donRested.length} attached=${attached}`);
  }
}

/** Life-card bounds. Only lower bound is enforced: OPTCG cards can add to
 *  life (e.g., "place top of deck to your life") with no documented upper
 *  cap. Negative life is the only structural violation. */
function checkLifeBounds(state: GameState, out: InvariantViolation[]): void {
  for (const pid of PLAYERS) {
    const pl = state.players[pid];
    pushIf(out, pl.life.length < 0, 'life_bounds', `player ${pid} has negative life ${pl.life.length}`);
  }
}

/** Pending shape: null or a single discriminated object with valid controller. */
function checkPendingShape(state: GameState, out: InvariantViolation[]): void {
  if (state.pending === null) return;
  const p = state.pending;
  if (typeof p !== 'object') {
    out.push({ rule: 'pending_shape', detail: `pending is not an object: ${typeof p}` });
    return;
  }
  const allowedKinds = new Set(['attack', 'trigger', 'peek', 'discard', 'choose_one', 'attack_target_pick']);
  if (!allowedKinds.has(p.kind)) {
    out.push({ rule: 'pending_shape', detail: `pending.kind invalid: ${p.kind}` });
    return;
  }
  // Each pending kind has its own inner field; controller (if present) must be A/B
  const inner = (p as { [k: string]: unknown })[`pending${p.kind.charAt(0).toUpperCase()}${p.kind.slice(1).replace(/_([a-z])/g, (_, c) => c.toUpperCase())}`];
  if (inner !== undefined && typeof inner === 'object' && inner !== null) {
    const ctrl = (inner as { controller?: unknown }).controller;
    if (ctrl !== undefined && ctrl !== 'A' && ctrl !== 'B') {
      out.push({ rule: 'pending_shape', detail: `pending.${p.kind}.controller invalid: ${String(ctrl)}` });
    }
  }
}

/** Card library is read-only across a run. (Snapshot first call.) */
let cardLibraryFingerprint: string | null = null;
function checkCardLibraryStable(state: GameState, out: InvariantViolation[]): void {
  const fp = Object.keys(state.cardLibrary).length + ':' + Object.keys(state.cardLibrary).sort().join(',').slice(0, 200);
  if (cardLibraryFingerprint === null) {
    cardLibraryFingerprint = fp;
    return;
  }
  if (fp !== cardLibraryFingerprint) {
    out.push({ rule: 'card_library_stable', detail: 'cardLibrary keys changed mid-run' });
  }
}

/** Re-initialize per-run state for the stable-library check. */
export function resetInvariantChecks(): void {
  cardLibraryFingerprint = null;
}

/** Run every invariant; return aggregated violations. */
export function runInvariantChecks(state: GameState): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  checkUndefinedTargets(state, out);
  checkZoneExclusivity(state, out);
  checkDonConservation(state, out);
  checkLifeBounds(state, out);
  checkPendingShape(state, out);
  checkCardLibraryStable(state, out);
  return out;
}
