/**
 * SimMutation applier.
 *
 * Pure function: takes a GameState + a list of SimMutations and returns
 * the new GameState with every mutation applied in order. Does NOT call
 * back into the sim layer or the engine's reducers — applies state
 * changes directly to fields defined by docs/OP_SIM_ENGINE_SPEC_V1.md
 * and the engine's CardInstance / PlayerZones types.
 *
 * UNSUPPORTED mutations are SKIPPED (no state change, no throw). The
 * caller may inspect them for logging.
 *
 * This module is the bridge between the sim layer (pure, structured
 * SimMutation output) and the engine (mutable GameState). It does NOT
 * decide WHEN events happen — the host engine controls timing.
 */

import type {
  CardInstance,
  EffectDuration,
  GameState,
  InstanceId,
  PlayerId,
} from '../engine-v2/state/types.js';
import { OTHER_PLAYER } from '../engine-v2/state/types.js';
import type { Action, Duration, SimMutation } from './types.js';

// ────────────────────────────────────────────────────────────────────
// Duration translation (sim → engine)
// ────────────────────────────────────────────────────────────────────

const DURATION_MAP: Record<Duration, EffectDuration> = {
  THIS_BATTLE: 'this_battle',
  END_OF_TURN: 'this_turn',
  START_OF_NEXT_TURN: 'opp_next_turn',
  PERMANENT: 'permanent',
};

/**
 * Convert a sim Duration to the engine's EffectDuration enum.
 * Returns 'this_turn' as a safe default for missing durations.
 */
function toEngineDuration(d: Duration | undefined): EffectDuration {
  if (d === undefined) return 'this_turn';
  return DURATION_MAP[d];
}

/**
 * Convert a sim Duration to an expires-in-turns integer for one-shot
 * scopes. Maps:
 *   - END_OF_TURN / THIS_BATTLE → 0 (cleared at next refresh)
 *   - START_OF_NEXT_TURN → 1 (survives opp's turn, cleared at our refresh)
 *   - PERMANENT → -1 sentinel (never expires; applier writes the value
 *                 into a continuous field instead)
 */
function durationToExpiry(d: Duration | undefined): number {
  if (d === undefined) return 0;
  if (d === 'THIS_BATTLE') return 0;
  if (d === 'END_OF_TURN') return 0;
  if (d === 'START_OF_NEXT_TURN') return 1;
  return -1;
}

// ────────────────────────────────────────────────────────────────────
// Per-action applier (one switch case per action)
// ────────────────────────────────────────────────────────────────────

function isPlayerId(t: InstanceId | PlayerId): t is PlayerId {
  return t === 'A' || t === 'B';
}

function applyOne(state: GameState, m: SimMutation): void {
  if (m.kind === 'UNSUPPORTED') return;

  const action: Action = m.kind;
  const target = m.target;
  const amount = m.amount ?? 0;
  const count = m.count ?? 1;
  const duration = m.duration;

  switch (action) {
    // ── POWER / COUNTER ──────────────────────────────────────────
    case 'ADD_POWER': {
      if (isPlayerId(target)) return;
      const inst = state.instances[target];
      if (inst === undefined) return;
      if (duration === 'PERMANENT') {
        inst.powerModifierContinuous = (inst.powerModifierContinuous ?? 0) + amount;
      } else {
        inst.powerModifierOneShot = (inst.powerModifierOneShot ?? 0) + amount;
        inst.powerModifierExpiresInTurns = durationToExpiry(duration);
      }
      return;
    }
    case 'SET_POWER': {
      if (isPlayerId(target)) return;
      const inst = state.instances[target];
      if (inst === undefined) return;
      if (duration === 'PERMANENT') {
        inst.basePowerOverrideContinuous = amount;
      } else {
        inst.basePowerOverrideOneShot = amount;
        inst.basePowerOverrideExpiresInTurns = durationToExpiry(duration);
      }
      return;
    }
    case 'ADD_COUNTER': {
      if (isPlayerId(target)) return;
      const inst = state.instances[target];
      if (inst === undefined) return;
      inst.counterBonus = (inst.counterBonus ?? 0) + amount;
      return;
    }

    // ── CARD MOVEMENT ────────────────────────────────────────────
    case 'DRAW': {
      const side = isPlayerId(target) ? target : state.instances[target]?.controller;
      if (side === undefined) return;
      const z = state.players[side];
      for (let i = 0; i < count; i++) {
        const id = z.deck.shift();
        if (id === undefined) break;
        z.hand.push(id);
      }
      return;
    }
    case 'TRASH':
    case 'SEND_TO_TRASH':
    case 'TRASH_FROM_FIELD': {
      if (isPlayerId(target)) return;
      const inst = state.instances[target];
      if (inst === undefined) return;
      const side = inst.controller;
      const z = state.players[side];
      // Remove from field if present
      const fi = z.field.findIndex((x) => x.instanceId === target);
      if (fi >= 0) z.field.splice(fi, 1);
      // Remove from hand if present
      const hi = z.hand.indexOf(target);
      if (hi >= 0) z.hand.splice(hi, 1);
      // Add to trash
      if (!z.trash.includes(target)) z.trash.push(target);
      return;
    }
    case 'TRASH_FROM_HAND':
    case 'DISCARD': {
      if (isPlayerId(target)) {
        // Discard N from target side's hand head (deterministic V0;
        // player choice routes via the engine's PendingDiscard).
        const z = state.players[target];
        for (let i = 0; i < count; i++) {
          const id = z.hand.shift();
          if (id === undefined) break;
          z.trash.push(id);
        }
        return;
      }
      const inst = state.instances[target];
      if (inst === undefined) return;
      const z = state.players[inst.controller];
      const hi = z.hand.indexOf(target);
      if (hi >= 0) {
        z.hand.splice(hi, 1);
        z.trash.push(target);
      }
      return;
    }
    case 'PLAY': {
      if (isPlayerId(target)) return;
      const inst = state.instances[target];
      if (inst === undefined) return;
      const z = state.players[inst.controller];
      const hi = z.hand.indexOf(target);
      if (hi >= 0) z.hand.splice(hi, 1);
      const ti = z.trash.indexOf(target);
      if (ti >= 0) z.trash.splice(ti, 1);
      if (!z.field.some((x) => x.instanceId === target)) z.field.push(inst);
      inst.summoningSick = true;
      return;
    }
    case 'ADD_TO_HAND': {
      if (isPlayerId(target)) return;
      const inst = state.instances[target];
      if (inst === undefined) return;
      const z = state.players[inst.controller];
      // Remove from deck / trash / life if present
      const di = z.deck.indexOf(target);
      if (di >= 0) z.deck.splice(di, 1);
      const ti = z.trash.indexOf(target);
      if (ti >= 0) z.trash.splice(ti, 1);
      const li = z.life.indexOf(target);
      if (li >= 0) z.life.splice(li, 1);
      if (!z.hand.includes(target)) z.hand.push(target);
      return;
    }
    case 'RETURN_TO_HAND': {
      if (isPlayerId(target)) return;
      const inst = state.instances[target];
      if (inst === undefined) return;
      const z = state.players[inst.controller];
      const fi = z.field.findIndex((x) => x.instanceId === target);
      if (fi >= 0) z.field.splice(fi, 1);
      if (!z.hand.includes(target)) z.hand.push(target);
      return;
    }
    case 'RETURN_TO_DECK_TOP': {
      if (isPlayerId(target)) return;
      const inst = state.instances[target];
      if (inst === undefined) return;
      const z = state.players[inst.controller];
      const fi = z.field.findIndex((x) => x.instanceId === target);
      if (fi >= 0) z.field.splice(fi, 1);
      const hi = z.hand.indexOf(target);
      if (hi >= 0) z.hand.splice(hi, 1);
      z.deck.unshift(target);
      return;
    }
    case 'RETURN_TO_DECK_BOTTOM': {
      if (isPlayerId(target)) return;
      const inst = state.instances[target];
      if (inst === undefined) return;
      const z = state.players[inst.controller];
      const fi = z.field.findIndex((x) => x.instanceId === target);
      if (fi >= 0) z.field.splice(fi, 1);
      const hi = z.hand.indexOf(target);
      if (hi >= 0) z.hand.splice(hi, 1);
      z.deck.push(target);
      return;
    }

    // ── BOARD STATE ──────────────────────────────────────────────
    case 'REST': {
      if (isPlayerId(target)) return;
      const inst = state.instances[target];
      if (inst === undefined) return;
      inst.rested = true;
      return;
    }
    case 'ACTIVATE': {
      if (isPlayerId(target)) return;
      const inst = state.instances[target];
      if (inst === undefined) return;
      inst.rested = false;
      return;
    }
    case 'KO': {
      if (isPlayerId(target)) return;
      const inst = state.instances[target];
      if (inst === undefined) return;
      const z = state.players[inst.controller];
      const fi = z.field.findIndex((x) => x.instanceId === target);
      if (fi >= 0) z.field.splice(fi, 1);
      if (!z.trash.includes(target)) z.trash.push(target);
      return;
    }
    case 'ATTACH_DON': {
      if (isPlayerId(target)) return;
      const inst = state.instances[target];
      if (inst === undefined) return;
      const z = state.players[inst.controller];
      const donId = z.donCostArea.shift();
      if (donId === undefined) return;
      inst.attachedDon.push(donId);
      return;
    }
    case 'DETACH_DON': {
      if (isPlayerId(target)) return;
      const inst = state.instances[target];
      if (inst === undefined) return;
      const z = state.players[inst.controller];
      const donId = inst.attachedDon.shift();
      if (donId === undefined) return;
      z.donCostArea.push(donId);
      return;
    }

    // ── SEARCH / REVEAL / DECK MANIPULATION ──────────────────────
    case 'SEARCH_DECK':
    case 'REVEAL_CARDS':
    case 'LOOK_AT_TOP':
    case 'REORDER_CARDS': {
      // V0: these set knownByViewer for the controller. Player-choice
      // routing (which card to add to hand, which order to set) is the
      // host engine's responsibility — it routes via Pending* and
      // resolves back to the sim with concrete instance IDs.
      const side: PlayerId = isPlayerId(target) ? target : state.instances[target]?.controller ?? 'A';
      const z = state.players[side];
      const exposeN = Math.min(count, z.deck.length);
      const known = state.knownByViewer[side] ?? [];
      for (let i = 0; i < exposeN; i++) {
        const id = z.deck[i];
        if (id !== undefined && !known.includes(id)) known.push(id);
      }
      state.knownByViewer[side] = known;
      return;
    }
    case 'SHUFFLE_DECK': {
      // Deterministic V0 shuffle disabled — host engine should call its
      // own seeded shuffle. Sim emits the intent only.
      return;
    }

    // ── LIFE ─────────────────────────────────────────────────────
    case 'ADD_LIFE': {
      const side: PlayerId = isPlayerId(target) ? target : state.instances[target]?.controller ?? 'A';
      const z = state.players[side];
      // Add cards from deck top to life (CR §3-10). Count cards.
      for (let i = 0; i < count; i++) {
        const id = z.deck.shift();
        if (id === undefined) break;
        z.life.push(id);
      }
      return;
    }
    case 'TAKE_LIFE': {
      // "Take" = move top of life to hand (CR §6-1-4 when receiving damage).
      const side: PlayerId = isPlayerId(target) ? target : state.instances[target]?.controller ?? 'A';
      const z = state.players[side];
      for (let i = 0; i < count; i++) {
        const id = z.life.shift();
        if (id === undefined) break;
        z.hand.push(id);
      }
      return;
    }
    case 'TRASH_LIFE': {
      const side: PlayerId = isPlayerId(target) ? target : state.instances[target]?.controller ?? 'A';
      const z = state.players[side];
      for (let i = 0; i < count; i++) {
        const id = z.life.shift();
        if (id === undefined) break;
        z.trash.push(id);
      }
      return;
    }

    // ── STATUS EFFECTS ───────────────────────────────────────────
    case 'GAIN_RUSH':
    case 'GAIN_BLOCKER':
    case 'GAIN_DOUBLE_ATTACK':
    case 'GAIN_BANISH': {
      if (isPlayerId(target)) return;
      const inst = state.instances[target];
      if (inst === undefined) return;
      const keyword = action === 'GAIN_RUSH'
        ? 'rush'
        : action === 'GAIN_BLOCKER'
          ? 'blocker'
          : action === 'GAIN_DOUBLE_ATTACK'
            ? 'double_attack'
            : 'banish';
      if (duration === 'PERMANENT') {
        const arr = inst.grantedKeywordsContinuous ?? [];
        if (!arr.includes(keyword)) arr.push(keyword);
        inst.grantedKeywordsContinuous = arr;
      } else {
        const arr = inst.grantedKeywordsOneShot ?? [];
        arr.push({ keyword, until: toEngineDuration(duration) });
        inst.grantedKeywordsOneShot = arr;
      }
      return;
    }
    case 'GAIN_COUNTER_EFFECT': {
      // Counter-effect status: not a generic keyword in the engine
      // schema. Mark on the instance as a granted continuous keyword
      // so downstream code can read it via the standard channel.
      if (isPlayerId(target)) return;
      const inst = state.instances[target];
      if (inst === undefined) return;
      const arr = inst.grantedKeywordsContinuous ?? [];
      if (!arr.includes('counter_effect')) arr.push('counter_effect');
      inst.grantedKeywordsContinuous = arr;
      return;
    }

    default: {
      // Exhaustive — TS will flag missing Action values.
      const _exhaustive: never = action;
      void _exhaustive;
      return;
    }
  }
}

// ────────────────────────────────────────────────────────────────────
// Public entry point
// ────────────────────────────────────────────────────────────────────

/**
 * Apply every mutation to the state. Mutations are applied in order;
 * earlier mutations are visible to later ones (e.g., REST then check
 * IS_RESTED would see the rested state).
 *
 * This function MUTATES the state argument in place. If the caller
 * wants immutability, they must clone the state before calling.
 * Cloning here would be wasteful for hot paths.
 *
 * Returns the same state reference for chaining ergonomics.
 */
export function applyMutations(state: GameState, mutations: ReadonlyArray<SimMutation>): GameState {
  for (const m of mutations) {
    applyOne(state, m);
  }
  return state;
}

// Re-exports for downstream tooling
export { DURATION_MAP, durationToExpiry, toEngineDuration };

// Internal helper for the integration layer.
export function controllerOfTarget(state: GameState, target: InstanceId | PlayerId): PlayerId {
  if (isPlayerId(target)) return target;
  const inst: CardInstance | undefined = state.instances[target];
  return inst?.controller ?? 'A';
}

// Keep OTHER_PLAYER reachable for the integration layer.
void OTHER_PLAYER;
