/**
 * Engine V2 — versioned snapshot + bytewise-stable JSON.
 *
 * Stability matters because:
 *   - Replays compare byte-for-byte across runs.
 *   - DO hibernation re-hydrates the same JSON.
 *   - AI lookahead caches serialized states as map keys.
 *
 * Stability strategy: sort object keys recursively before stringify. JSON
 * insertion-order preservation is engine-defined; sorting makes it
 * deterministic regardless of how the reducers built the state.
 *
 * Cross-references:
 * - Implementation spec §14
 * - Plan v1 §4.10 + Plan v2 §6.7
 */

import {
  CURRENT_SCHEMA_VERSION,
  type GameState,
  type SchemaVersion,
} from './types.js';

export class SerializationError extends Error {
  constructor(detail: string) {
    super(`SerializationError: ${detail}`);
    this.name = 'SerializationError';
  }
}

/**
 * Sort object keys recursively, then stringify. Arrays preserve order.
 * Numbers, strings, booleans, null pass through. `undefined` is stripped
 * (matches JSON.stringify's behavior).
 */
function stableStringifyValue(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(stableStringifyValue);
  const out: Record<string, unknown> = {};
  const keys = Object.keys(v).sort();
  for (const k of keys) {
    const inner = (v as Record<string, unknown>)[k];
    if (inner === undefined) continue;
    out[k] = stableStringifyValue(inner);
  }
  return out;
}

export function stableStringify(state: GameState): string {
  return JSON.stringify(stableStringifyValue(state));
}

export function serialize(state: GameState): string {
  if (state.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new SerializationError(
      `cannot serialize state at schemaVersion ${state.schemaVersion}; current is ${CURRENT_SCHEMA_VERSION}.`,
    );
  }
  return stableStringify(state);
}

export function deserialize(blob: string): GameState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(blob);
  } catch (e) {
    throw new SerializationError(`invalid JSON: ${(e as Error).message}`);
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new SerializationError('top-level value is not an object.');
  }
  const obj = parsed as { schemaVersion?: unknown };
  if (typeof obj.schemaVersion !== 'number') {
    throw new SerializationError('missing or non-numeric schemaVersion.');
  }
  if (obj.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new SerializationError(
      `stored schemaVersion ${obj.schemaVersion} > current ${CURRENT_SCHEMA_VERSION}; downgrade not supported.`,
    );
  }
  if (obj.schemaVersion < CURRENT_SCHEMA_VERSION) {
    // Migrations are wired in when the schema bumps; until then the only
    // legal version is CURRENT, so older versions are explicit failures.
    throw new SerializationError(
      `stored schemaVersion ${obj.schemaVersion} < current ${CURRENT_SCHEMA_VERSION}; ` +
        `no migration registered.`,
    );
  }
  return parsed as GameState;
}

export { CURRENT_SCHEMA_VERSION };
export type { SchemaVersion };
