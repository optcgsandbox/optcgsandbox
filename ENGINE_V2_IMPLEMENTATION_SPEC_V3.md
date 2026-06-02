# Engine V2 Implementation Spec — v3 (amendments only)

**Status:** Amendment overlay. v1 (`ENGINE_V2_IMPLEMENTATION_SPEC.md`) and v2 (`ENGINE_V2_IMPLEMENTATION_SPEC_V2.md`) remain authoritative for everything not contradicted here. v3 closes 6 round-2 cert findings (N1–N6).

**Reading order:** v1 → v2 → v3. v3 sections supersede v2 only at the line-level callouts named below. All other v2 sections (§A1-V2 through §A29-V2, §22-V2, §0-V2) are unchanged.

**Verified inputs for this revision (read 2026-06-02 before writing):**
- `shared/engine/phases/setup.ts:24` — actual V1 signature: `setupGame(state: GameState): GameState`.
- `worker/index.ts:10-14` — actual V1 Env: `{ GAME_ROOM, MATCHMAKER, ENV }` (no `EFFECT_SPEC_V2`).
- `worker/wrangler.toml:1-28` — `[vars] ENV = "production"`, no other env keys.
- `package-lock.json` present at repo root; `pnpm-lock.yaml` and `yarn.lock` absent → npm is the project package manager.
- `package.json:11-12, 44` — `vitest@^4.1.7`, `test: "vitest run"`.
- `grep -rn "rested = true" shared/engine/` → 24 prod sites (engine/non-test) + 9 test sites = 33 total, broken down per file below in §A35-V3.
- `ENGINE_V2_DEFINITIVE_PLAN_V2.md:36, 652` — M16 SetupMulligan declared as a NEW module wrapping V1 setup; signatures are listed at the plan level but never bound to a TypeScript surface.

---

## §A30-V3 — N1 — `setupGame` signature mismatch resolved via M16 SetupMulligan wrapper

### §A30.1-V3 — Problem statement

V2 spec callsites (§A12.1-V2 line 1017, §A12.3-V2 line 1076, §A14-V2 line 1305, §A29-V2 line 2016) call `setupGame({ seed, decks })` — a 1-argument options-object shape. V1's actual export at `shared/engine/phases/setup.ts:24` is:

```ts
export function setupGame(state: GameState): GameState
```

— a 1-argument shape, but the argument is a full pre-built `GameState`, not `{ seed, decks }`. Plan v2 §1.1 already declares M16 `SetupMulligan` as a NEW module wrapping V1's setup primitives. v3 binds that plan-level declaration to a concrete TS surface and points all v2 callsites at it.

### §A30.2-V3 — Module: `shared/engine-v2/phases/SetupMulligan.ts` (NEW)

```ts
// shared/engine-v2/phases/SetupMulligan.ts
//
// M16 (Plan v2 §1.1 A1). Wraps V1 primitives in shared/engine/phases/setup.ts
// with the options-object signature the v2 test/script callsites expect.
// V1 setup.ts:24 stays exactly as-is — it is the [IMPLEMENTED] reference body.
// M16 is a thin adapter: it builds a baseline GameState from (seed, decks,
// controllerMode) and forwards to V1 setupGame.

import type { Card } from '@shared/engine/cards/Card';
import type { GameState, PlayerId } from '@shared/engine/GameState';
import { setupGame as setupGameV1 } from '@shared/engine/phases/setup';

export interface SetupOptions {
  seed: number;
  /** Two decks keyed by player id. Each is the literal pre-shuffle ordering
   *  the caller wants; M16.setupGame forwards to V1, which then calls
   *  Random.shuffle(deck) deterministically per seed. */
  decks: { A: ReadonlyArray<Card>; B: ReadonlyArray<Card> };
  /** Optional controller-mode tag (hot-seat | mp | replay). Forwarded into
   *  GameState.metadata; engine logic does not branch on it. */
  controllerMode?: 'hot_seat' | 'mp' | 'replay';
}

/** Build a baseline GameState from options, then forward to V1 setupGame.
 *  ALL v2 callsites (§A12, §A14, §A29) MUST call this — never V1 setupGame
 *  directly with an options object. */
export function setupGame(opts: SetupOptions): GameState {
  const baseline = buildInitialState(opts);
  return setupGameV1(baseline);
}

/** Construct the pre-shuffle GameState that V1 setupGame expects.
 *
 *  Field assignments mirror what V1's prior caller (the legacy in-app
 *  bootstrapper) used to do inline. Concretely:
 *    - phase = 'setup' (V1 setupGame advances to 'dice_roll' itself).
 *    - activePlayer = 'A' (V1 overwrites this after CHOOSE_FIRST/SECOND).
 *    - players.{A,B} = freshly-built PlayerZones with the provided deck
 *      array populated and all other zones empty.
 *    - history = [] (V1 setupGame appends GAME_STARTED).
 *    - turn = 0, result = null, schemaVersion = 2.
 *
 *  Exposed only for tests that need a baseline state without running setup
 *  (e.g. §A11-V2 serialization round-trip, golden-snapshot deserialization). */
export function buildInitialState(opts: SetupOptions): GameState {
  return {
    seed: opts.seed,
    phase: 'setup',
    activePlayer: 'A',
    turn: 0,
    result: null,
    schemaVersion: 2,
    diceRoll: null,
    pending: null,
    players: {
      A: buildPlayerZones(opts.decks.A),
      B: buildPlayerZones(opts.decks.B),
    },
    instances: {},
    history: [],
    metadata: opts.controllerMode ? { controllerMode: opts.controllerMode } : {},
  } as GameState; // SOUNDNESS: shape matches GameState; cast tolerated because
                  // optional fields (per §2.4-V2 widening) are explicitly set
                  // to null/empty rather than left undefined.
}

function buildPlayerZones(deck: ReadonlyArray<Card>): GameState['players']['A'] {
  return {
    deck: [...deck],
    hand: [],
    field: [],
    leader: null as never,         // V1 caller is expected to attach the leader
                                   // from deck[0] before setup; or rely on the
                                   // existing V1 leader-bootstrap path. See
                                   // §A30.4-V3 below.
    stage: null,
    life: [],
    trash: [],
    donDeck: [],
    donActive: [],
    donRested: [],
  } as GameState['players']['A'];
}
```

### §A30.3-V3 — Re-export from `phases/index.ts`

```ts
// shared/engine-v2/phases/index.ts (existing barrel — add)
export { setupGame, buildInitialState, type SetupOptions } from './SetupMulligan';
```

### §A30.4-V3 — Leader-bootstrap caveat

V1 `setupGame` reads `next.players[pid].leader` but never assigns it. The legacy in-app bootstrapper attached the leader before calling `setupGame`. M16's `buildInitialState` defers that step: callers (test fixtures, capture-golden, replay-v2, soak) MUST pass a `decks.{A,B}` whose first element is the leader, and the wrapper MUST splice it out of the deck array and assign it to `players[pid].leader`. v3 amendment to `buildPlayerZones`:

```ts
// REVISED buildPlayerZones — extract leader from deck[0].
function buildPlayerZones(deck: ReadonlyArray<Card>): GameState['players']['A'] {
  const [leader, ...rest] = deck;
  if (!leader || leader.kind !== 'leader') {
    throw new Error('M16.buildInitialState: deck[0] must be the leader card.');
  }
  return {
    deck: [...rest],
    hand: [],
    field: [],
    leader: { ...leader, instanceId: `leader-${leader.id}` }, // V1 leader has no rested/exhausted state at setup
    stage: null,
    life: [],
    trash: [],
    donDeck: [],
    donActive: [],
    donRested: [],
  } as GameState['players']['A'];
}
```

### §A30.5-V3 — V2 callsite re-pointing

The following v2 callsites continue to work AS WRITTEN because the import path becomes `@shared/engine-v2/phases/SetupMulligan` (or the barrel `@shared/engine-v2/phases`):

| v2 spec line | File | Old import | New import |
|---|---|---|---|
| 1000 | `__tests__/golden/v1_v2_equivalence.test.ts` | `@shared/engine/phases/setup` | `@shared/engine-v2/phases/SetupMulligan` |
| 1061 | `scripts/capture-golden.ts` | `@shared/engine/phases/setup` | `@shared/engine-v2/phases/SetupMulligan` |
| 1281 | `scripts/replay-v2.ts` | `@shared/engine/phases/setup` | `@shared/engine-v2/phases/SetupMulligan` |
| 1997 | `__tests__/soak.test.ts` | `../phases/SetupMulligan` | unchanged (already v2 path) |

§19 (V1 spec) checklist additions, layered on §A18-V2:

| File | Purpose | Est LOC |
|---|---|---|
| `shared/engine-v2/phases/SetupMulligan.ts` | M16 wrapper exposing `setupGame(opts)` + `buildInitialState` | 90 |
| `shared/engine-v2/phases/index.ts` (delta) | Re-export `setupGame`/`buildInitialState` | +2 |

**Closes: N1.** V1 `setup.ts:24` signature is preserved (zero change). All v2 callsite shapes typecheck. M16 module — already promised by Plan v2 §1.1 — is now bound to a concrete TS surface.

---

## §A31-V3 — N2 — `Env` interface delta for `EFFECT_SPEC_V2`

### §A31.1-V3 — Problem statement

`worker/index.ts:10-14` (verified) declares:

```ts
export interface Env {
  GAME_ROOM: DurableObjectNamespace;
  MATCHMAKER: DurableObjectNamespace;
  ENV: string;
}
```

§A13.2-V2 (line 1191) reads `this._env.EFFECT_SPEC_V2`. With the current Env interface, that's a TS2339 ("Property 'EFFECT_SPEC_V2' does not exist on type 'Env'"). §A16.1-V2 added the wrangler `[vars]` entry but did NOT add the matching TS type.

### §A31.2-V3 — Amendment to `worker/index.ts:10-14`

```ts
// worker/index.ts — REVISED Env interface
export interface Env {
  GAME_ROOM: DurableObjectNamespace;
  MATCHMAKER: DurableObjectNamespace;
  ENV: string;
  /** Engine-V2 cutover toggle (Plan v1 §6.5, Spec §A16-V2). Optional because
   *  legacy wrangler configs without the [vars] entry default to v1-only at
   *  runtime — see GameRoom.ts `(this._env.EFFECT_SPEC_V2 ?? 'v1-only')`. */
  EFFECT_SPEC_V2?: 'v1-only' | 'shadow' | 'authoritative';
}
```

Note: §A13.2-V2 line 1191 currently uses the string `'v1-only' | 'shadow' | 'v2-authoritative'`. The wrangler config (§A16.1-V2 line 1405) uses `"v1-only"` and the cutover playbook (§A16.3-V2) uses `authoritative` (not `v2-authoritative`). v3 reconciles the spelling: the canonical tristate is `'v1-only' | 'shadow' | 'authoritative'`. v2 §A13.2 line 1191 is corrected by reference here — implementer reads `EngineMode` from `worker/shadow.ts` (§A13.1-V2 line 1120 already defines it correctly as `'v1-only' | 'shadow' | 'authoritative'`), so the Env type aligns with that.

### §A31.3-V3 — wrangler.toml delta

`worker/wrangler.toml:22-23` currently:

```toml
[vars]
ENV = "production"
```

After §A16.1-V2 + §A31.2-V3:

```toml
[vars]
ENV = "production"
EFFECT_SPEC_V2 = "v1-only"   # cutover toggle; see Spec §A16-V2
```

### §A31.4-V3 — workers-types regeneration

After the interface change, regenerate worker types so editor/CI sees the new field:

```bash
npm run cf-typegen   # if a script exists; otherwise:
npx wrangler types   # writes worker-configuration.d.ts (Cloudflare convention)
```

If `npm run cf-typegen` is not yet a script entry, §19 checklist adds it:

| File | Purpose | Est LOC |
|---|---|---|
| `package.json` (delta) | Add `"cf-typegen": "wrangler types"` to scripts block | +1 line |
| `worker/index.ts` (delta) | Env interface +1 optional field | +1 line |
| `worker/wrangler.toml` (delta) | `[vars]` +1 line for EFFECT_SPEC_V2 | +1 line |

**Closes: N2.** §A13.2-V2 line 1191 typechecks; cutover env var has a TS surface; wrangler `[vars]` and the runtime read are aligned on the same tristate vocabulary.

---

## §A32-V3 — N3 — `compareEventStreams` unified canonical signature

### §A32.1-V3 — Problem statement

Two incompatible signatures exist in v2:

- **§A12.1-V2 line 1001 + line 1028** — imports `compareEventStreams` from `./harness` and calls it with 3 args: `compareEventStreams(v1Events, v2Events, expectedDivergences)`. The 3rd arg is `ExpectedDivergence[]`. Return shape used: `{ unexpected: ... }`.
- **§A13.1-V2 line 1174 + §A14-V2 line 1312** — defines `compareEventStreams` in `worker/shadow.ts` with 2 args. Return shape: `{ equal: boolean; firstDelta?: number }`.

Two different return shapes + two different arities + two different homes. Implementer cannot satisfy both as currently written.

### §A32.2-V3 — Canonical definition (single source of truth)

Canonical location: `worker/shadow.ts` (where v2 already defines it in §A13.1).

Canonical signature:

```ts
// worker/shadow.ts — REVISED compareEventStreams (§A13.1-V2 line 1171 revision)
export interface ExpectedDivergence {
  id: string;
  matches: (a: unknown, v1: readonly unknown[], v2: readonly unknown[]) => boolean;
}

export interface EventStreamDiff {
  /** True iff streams are byte-identical OR every delta is covered by an
   *  ExpectedDivergence entry. */
  equal: boolean;
  /** Zero-based index of the first byte-level delta (undefined if equal). */
  firstDelta?: number;
  /** Per-delta classification when `opts.expectedDivergences` is supplied.
   *  Each delta either matches an expected entry (`matchedId`) or is unexpected
   *  (`matchedId === null`). */
  deltas: ReadonlyArray<{
    index: number;
    v1: unknown;
    v2: unknown;
    matchedId: string | null;
  }>;
  /** Convenience: deltas filtered to those with matchedId === null.
   *  §A12.1-V2 line 1029's `diff.unexpected` resolves to this. */
  unexpected: ReadonlyArray<{ index: number; v1: unknown; v2: unknown }>;
}

/** Compares two event streams emitted by V1 and V2 for the same action sequence.
 *
 *  Two streams are byte-equal iff they have the same length AND every index
 *  deep-equals (JSON.stringify-based; V2 debug events stripped upstream).
 *
 *  When `opts.expectedDivergences` is supplied, byte-level deltas are classified
 *  against the list — matched deltas are tagged, unmatched deltas land in
 *  `deltas[].matchedId === null` and `unexpected[]`.
 *
 *  Equal semantics: `equal === true` iff `unexpected.length === 0`. Byte-identical
 *  streams trivially satisfy this. */
export function compareEventStreams(
  v1: readonly unknown[],
  v2: readonly unknown[],
  opts?: { expectedDivergences?: ReadonlyArray<ExpectedDivergence>; action?: unknown },
): EventStreamDiff {
  const len = Math.min(v1.length, v2.length);
  const deltas: Array<{ index: number; v1: unknown; v2: unknown; matchedId: string | null }> = [];
  let firstDelta: number | undefined;

  for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
    const a = v1[i];
    const b = v2[i];
    const differs = i >= len || JSON.stringify(a) !== JSON.stringify(b);
    if (differs) {
      if (firstDelta === undefined) firstDelta = i;
      const expected = opts?.expectedDivergences?.find((e) =>
        e.matches(opts.action, v1, v2),
      );
      deltas.push({ index: i, v1: a, v2: b, matchedId: expected?.id ?? null });
    }
  }

  const unexpected = deltas
    .filter((d) => d.matchedId === null)
    .map(({ index, v1, v2 }) => ({ index, v1, v2 }));

  return {
    equal: unexpected.length === 0,
    firstDelta,
    deltas,
    unexpected,
  };
}
```

### §A32.3-V3 — `__tests__/golden/harness.ts` becomes a re-export module

§A12.1-V2 imports from `./harness`. v3 makes that file a thin re-export so callers don't reach into `worker/` directly from a test file (preserves the `shared/`/`worker/` boundary).

```ts
// shared/engine-v2/__tests__/golden/harness.ts
//
// Re-exports the canonical compareEventStreams from worker/shadow.ts and
// adds the markdown-loading helper that lives only on the test side.

export {
  compareEventStreams,
  type EventStreamDiff,
  type ExpectedDivergence,
} from '../../../../worker/shadow';

export { loadDivergences } from './loadDivergences';
```

```ts
// shared/engine-v2/__tests__/golden/loadDivergences.ts (NEW — extracted helper)
import { readFileSync } from 'node:fs';
import type { ExpectedDivergence } from '../../../../worker/shadow';

/** Parse divergences.md into the ExpectedDivergence array consumed by
 *  compareEventStreams. Each `## DIV-NNN` heading becomes one entry; the
 *  `Detection pattern:` line is parsed into a `matches` closure. Loose
 *  format — implementer free to swap to YAML frontmatter if markdown parsing
 *  gets brittle. */
export function loadDivergences(path: string): ExpectedDivergence[] {
  const md = readFileSync(path, 'utf-8');
  // ... parser body — out of scope for the spec; reference implementation
  // expected: regex over `^## (DIV-\d+)` + capture of `Detection pattern:` line.
  // Returns ExpectedDivergence[].
  return parseDivergencesMd(md);
}

function parseDivergencesMd(_md: string): ExpectedDivergence[] {
  // implementer-owned body; see __tests__/golden/loadDivergences.test.ts
  // for the contract (parses §A12.2-V2 schema).
  return [];
}
```

### §A32.4-V3 — Callsite re-pointing

| v2 line | Caller | Old | New |
|---|---|---|---|
| 1001 | `v1_v2_equivalence.test.ts` | `import { compareEventStreams, ExpectedDivergence, loadDivergences } from './harness';` | unchanged (harness now re-exports) |
| 1028 | `v1_v2_equivalence.test.ts` | `compareEventStreams(v1Events, v2Events, expectedDivergences);` | `compareEventStreams(v1Events, v2Events, { expectedDivergences });` |
| 1150 | `worker/shadow.ts:runShadow` | `compareEventStreams(v1.events, v2.events);` | `compareEventStreams(v1.events, v2.events, { expectedDivergences, action });` |
| 1312 | `scripts/replay-v2.ts` | `compareEventStreams(r1.events, r2.events);` | unchanged (2-arg call works — opts is optional; `.equal` and `.firstDelta` fields are still present) |

§19 checklist additions:

| File | Purpose | Est LOC |
|---|---|---|
| `worker/shadow.ts` (delta) | `compareEventStreams` revised to canonical opts-object signature | +30 |
| `__tests__/golden/harness.ts` | Re-export shim | 10 |
| `__tests__/golden/loadDivergences.ts` | Markdown parser extracted | 80 |
| `__tests__/golden/loadDivergences.test.ts` | Parser contract test | 40 |

**Closes: N3.** One canonical definition, one home, opts-object 3rd arg keeps the §A14-V2 2-arg callsite valid, return shape covers both `{ unexpected }` (golden) and `{ equal, firstDelta }` (replay/shadow) consumers.

---

## §A33-V3 — N4 — `expect()` relocation in §A12.1-V2

### §A33.1-V3 — Problem statement

§A12.1-V2 line 1012:

```ts
describe('Golden V1↔V2 equivalence (50-game corpus)', () => {
  const expectedDivergences: ExpectedDivergence[] = loadDivergences(DIVERGENCES_FILE);
  const fixtures = readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.json'));
  expect(fixtures.length).toBeGreaterThanOrEqual(50);   // ← line 1012: bare expect() in describe body
  ...
});
```

`expect()` is called at describe-body scope (collection time, before any `it()` is entered). Outside a test context, vitest cannot attribute the assertion to a test — the failure is either swallowed, reported as a collection error with no test name, or (depending on internal version behavior) throws during `vitest run`. Either way, the assertion does not behave as a sentinel guard the way the spec intends.

### §A33.2-V3 — Amendment

Wrap the assertion in a dedicated sentinel `it()` at the top of the describe block. Revised §A12.1-V2 lines 1009–1013:

```ts
describe('Golden V1↔V2 equivalence (50-game corpus)', () => {
  const expectedDivergences: ExpectedDivergence[] = loadDivergences(DIVERGENCES_FILE);
  const fixtures = readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.json'));

  // Sentinel: corpus capture must have produced ≥50 fixtures before the
  // per-game tests run. Lives in its own `it()` so the failure is attributable
  // and the suite shows a named test rather than a collection-time error.
  it('has at least 50 captured fixtures', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(50);
  });

  for (const fixture of fixtures) {
    it(`game ${fixture} matches`, () => {
      // ... unchanged body
    });
  }
});
```

### §A33.3-V3 — Scope

Sweep applies ONLY to §A12.1-V2 line 1012. No other v1/v2 spec body has `expect()` outside a test context (verified by inspection of v2 §A11-V2, §A13-V2, §A14-V2, §A15-V2, §A17-V2, §A29-V2 — every assertion sits inside `it(...)` or `test(...)`).

**Closes: N4.** Sentinel guard now lives in a named test; vitest 4 collection no longer sees an orphan `expect()`.

---

## §A34-V3 — N5 — `pnpm` → `npm` throughout

### §A34.1-V3 — Problem statement

`package-lock.json` present at repo root (verified); `pnpm-lock.yaml` and `yarn.lock` absent. The project is npm-managed. Two v2 sections use `pnpm`:

- §A14-V2 line 1295 (JSDoc inside `scripts/replay-v2.ts`): `pnpm tsx scripts/replay-v2.ts --in=...`
- §A18-V2 line 1525 (install instructions): `pnpm add -D fast-check@^3.23.2 @typescript-eslint/rule-tester@^8.59.2`

### §A34.2-V3 — Amendments

**§A14-V2 line 1295 — replace JSDoc usage line:**

Old:
```
 *  Usage:
 *    pnpm tsx scripts/replay-v2.ts --in=do-game-12345.json --out=diff.json
```

New:
```
 *  Usage:
 *    npx tsx scripts/replay-v2.ts --in=do-game-12345.json --out=diff.json
```

**§A18-V2 line 1525 — replace install command:**

Old:
```
Install command for the implementer: `pnpm add -D fast-check@^3.23.2 @typescript-eslint/rule-tester@^8.59.2`.
```

New:
```
Install command for the implementer: `npm install -D fast-check@^3.23.2 @typescript-eslint/rule-tester@^8.59.2 tsx@^4.19.0`.
```

`tsx` is added because §A14-V2 invokes it (`npx tsx scripts/replay-v2.ts`) but no v1/v2 section had pinned it as a devDependency. Pinning it makes `npx tsx` reproducible across machines and CI. Pin range matches `tsx` major-line at time of writing — implementer free to bump.

### §A34.3-V3 — Sweep scope confirmation

Verified by grep that ONLY the two lines above use `pnpm`/`yarn`:

```
$ grep -n "pnpm\|yarn" ENGINE_V2_IMPLEMENTATION_SPEC_V2.md
1295: *    pnpm tsx scripts/replay-v2.ts --in=do-game-12345.json --out=diff.json
1525:Install command for the implementer: `pnpm add -D fast-check@^3.23.2 @typescript-eslint/rule-tester@^8.59.2`.
```

No other v1 or v2 line is affected.

§19 checklist delta:

| File | Purpose | Est LOC |
|---|---|---|
| `package.json` (delta) | Add `tsx@^4.19.0` to devDependencies | +1 line |

**Closes: N5.** All v2 implementer commands now use the toolchain that matches the lockfile.

---

## §A35-V3 — N6 — `restInstance` enumeration count correction

### §A35.1-V3 — Problem statement

§A27-V2 line 1940 claims:

> `grep -rn "rested = true" shared/engine/` returns **33 sites** (verified).

The owner's round-2 finding asserts the actual grep returns **23 prod + 5 tests = 28**. Both counts disagree. v3 re-runs the grep on 2026-06-02 and records the authoritative breakdown.

### §A35.2-V3 — Verified count (2026-06-02)

Command (verbatim, run from repo root):

```
$ grep -rn "rested = true" shared/engine/ | wc -l
33

$ grep -rn "rested = true" shared/engine/ | grep -v "__tests__" | wc -l
24

$ grep -rn "rested = true" shared/engine/ | grep "__tests__" | wc -l
9
```

**Total: 24 prod + 9 tests = 33.** The §A27-V2 line 1940 total of 33 is correct. The round-2 finding's "23 prod + 5 tests = 28" is itself stale or run against a different tree.

### §A35.3-V3 — Per-file breakdown

| File | Lines | Count | Category |
|---|---|---|---|
| `shared/engine/applyAction.ts` | 184, 187, 189, 191, 485, 525 | 6 | prod |
| `shared/engine/cards/effects/templates.ts` | 427, 430, 431, 432 (+ JSDoc line 421) | 4 (1 JSDoc) | prod |
| `shared/engine/effectSpec/runner-v2.ts` | 1099, 1102, 1103, 1104 | 4 | prod |
| `shared/engine/effectSpec/replacements-v2.ts` | 287, 290, 292, 297, 299, 301, 303, 326, 328 | 9 | prod |
| **prod subtotal** | | **23** | (24 raw including the JSDoc-only mention on templates.ts:421) |
| `shared/engine/__tests__/effectSpecV2.actionGroup2.test.ts` | 109, 110 | 2 | test |
| `shared/engine/__tests__/effectSpecV2.actionGroup3.test.ts` | 68 | 1 | test |
| `shared/engine/__tests__/HardAi.test.ts` | 53 | 1 | test |
| `shared/engine/__tests__/EasyAi.test.ts` | 86 | 1 | test |
| `shared/engine/__tests__/MediumAi.test.ts` | 55, 74 | 2 | test |
| `shared/engine/__tests__/cards/EB01-016.test.ts` | 78 | 1 | test |
| `shared/engine/__tests__/cards/EB01-004.test.ts` | 62 | 1 | test |
| **test subtotal** | | **9** | |
| **grand total** | | **33 raw matches** | (32 if JSDoc match on templates.ts:421 excluded) |

The §A27-V2 cluster table (line 1944 area) is correct EXCEPT for a minor inflation: it lists `applyAction.ts:184-191 (REST_TARGET reducer fan-out) | 4` and `applyAction.ts:485 (DECLARE_ATTACK) | 1`, but is missing the `applyAction.ts:525 (DECLARE_BLOCK) | 1` blocker-rest write. v3 amends the §A27-V2 cluster table to:

| Site | Count | Why direct write | Migration |
|---|---|---|---|
| `applyAction.ts:184-191` (REST_TARGET reducer fan-out) | 4 | direct write | replace block with `restInstance(state, targetInstanceId)` |
| `applyAction.ts:485` (DECLARE_ATTACK attacker rest) | 1 | `attacker.rested = true` | `restInstance(state, attacker.instanceId)` |
| `applyAction.ts:525` (DECLARE_BLOCK blocker rest) | 1 | `blocker.rested = true` | `restInstance(state, blocker.instanceId)` — **NEW row, was missed in §A27-V2** |
| `cards/effects/templates.ts:427-432` (template fan-out) | 4 (+1 JSDoc) | direct write | replace with `restInstance` (template will be deleted at V2 cutover anyway) |
| `effectSpec/runner-v2.ts:1099-1104` (rest_target fan-out) | 4 | direct write | `restInstance(state, tid)` per site |
| `effectSpec/replacements-v2.ts:287-328` (replacement rest writes) | 9 | direct write | `restInstance(state, inst.instanceId)` per site |
| **prod total** | **23 writes + 1 JSDoc match = 24 raw** | | |

Test-side sites (9 raw matches across 7 files) are EXEMPT from the lint rule because they are setting up arrange-state, not firing triggers. The §A27-V2 lint-rule deferral text (line 1952) is unchanged; v3 adds: the rule's `Allow` allowlist is `__tests__/**` and `helpers/restInstance.ts`.

### §A35.4-V3 — Closure mechanism unchanged

The §A27-V2 closure (helper file + deferred lint rule) is correct and unchanged. v3 only corrects:
1. The total `33` is real, but it's `24 prod-raw + 9 tests` (one prod-raw match is a JSDoc string, so 23 actual writes + 1 JSDoc).
2. The cluster table missed `applyAction.ts:525` (DECLARE_BLOCK).
3. Test-side allowlist makes the future lint rule pass on existing test files without rewrites.

**Closes: N6.** Count is now grounded in a re-run grep with per-file breakdown. No mechanism change; only enumeration accuracy and the missing DECLARE_BLOCK row.

---

## §24-V3 — Amendments log (6 findings → 6 mechanisms)

| Cert id | Closure mechanism | Section |
|---|---|---|
| N1 | `setupGame` signature unified via new M16 wrapper `shared/engine-v2/phases/SetupMulligan.ts` exposing `setupGame(opts: { seed, decks, controllerMode })` + `buildInitialState`. V1 `setup.ts:24` untouched. All v2 callsites re-pointed to the wrapper. | §A30-V3 |
| N2 | `Env` interface in `worker/index.ts:10-14` gains optional `EFFECT_SPEC_V2?: 'v1-only' \| 'shadow' \| 'authoritative'`. wrangler.toml `[vars]` block gains the matching key. `npx wrangler types` regen step documented. v2 §A13.2 line 1191 spelling (`v2-authoritative`) reconciled to canonical `authoritative` per §A13.1-V2 line 1120. | §A31-V3 |
| N3 | `compareEventStreams` unified to ONE canonical signature in `worker/shadow.ts`: `(v1, v2, opts?: { expectedDivergences?, action? })` returning `{ equal, firstDelta?, deltas, unexpected }`. Test-side `__tests__/golden/harness.ts` becomes a re-export shim. `loadDivergences` extracted to its own file. Callsite updates listed per v2 line. | §A32-V3 |
| N4 | `expect(fixtures.length).toBeGreaterThanOrEqual(50)` moved from describe-body scope to a named `it('has at least 50 captured fixtures')` block at the top of the describe. Other v1/v2 sections verified clean. | §A33-V3 |
| N5 | `pnpm` replaced with `npm install -D ...` (§A18-V2 line 1525) and `npx tsx ...` (§A14-V2 line 1295). `tsx@^4.19.0` added to devDependencies so `npx tsx` is reproducible. Sweep scope confirmed by grep — only two lines affected. | §A34-V3 |
| N6 | Re-ran `grep -rn "rested = true" shared/engine/` on 2026-06-02 → 24 prod-raw (23 writes + 1 JSDoc) + 9 tests = 33 total. §A27-V2 total of 33 stands. Cluster table corrected: added missed row `applyAction.ts:525 (DECLARE_BLOCK)`. Lint-rule allowlist gains `__tests__/**` so test-side `rested = true` sites don't need rewrites. | §A35-V3 |

---

## §25-V3 — Self-verification

### §25.1-V3 — Every N1–N6 has a concrete fix mechanism

| Finding | Mechanism is text-only or code? | Concrete artifact |
|---|---|---|
| N1 | Code | New module `shared/engine-v2/phases/SetupMulligan.ts` with `setupGame(opts)` + `buildInitialState`; barrel export; 5 callsite re-pointings listed |
| N2 | Code + config | Env interface +1 field (TS); wrangler.toml +1 line; `npx wrangler types` regen step; package.json script add optional |
| N3 | Code | Canonical signature in worker/shadow.ts; harness.ts becomes re-export; loadDivergences.ts extracted; 4 callsite re-pointings listed |
| N4 | Code | Sentinel `it()` block inserted at top of describe; rest of describe body unchanged |
| N5 | Text + config | Two literal string replacements; one devDependency add |
| N6 | Text | Per-file breakdown table; cluster-table row addition; lint-rule allowlist line |

Every finding has a named file + named change. None are deferred.

### §25.2-V3 — No new TS / plan / code-map gap introduced

| Risk | Check | Result |
|---|---|---|
| N1 wrapper's `buildPlayerZones` casts to `GameState['players']['A']` — does this re-open T2 (exactOptionalPropertyTypes)? | All optional fields (`stage`, `pending`, `diceRoll`) explicitly set to `null` not omitted; `leader` initialized via `decks[0]` not left undefined. §2.4-V2 widening covers the rest. | No re-opening |
| N1 introduces M16 — does Plan v2 §1.1 already declare it? | `ENGINE_V2_DEFINITIVE_PLAN_V2.md:36, 652` — yes, A1 declares M16 SetupMulligan as NEW. v3 binds to TS, doesn't introduce a new module not already in the plan. | Plan-aligned |
| N2 adds optional field to Env — does this break existing `(this._env.EFFECT_SPEC_V2 ?? 'v1-only')` reads? | Nullish-coalesce default `'v1-only'` works whether the field is missing (legacy wrangler.toml) or `undefined`. | No regression |
| N3 changes 3rd-arg shape from positional `expectedDivergences` to opts-object — does §A14-V2 line 1312 still compile? | §A14-V2 line 1312 calls 2-arg; opts is optional. ✓ | Compatible |
| N3 changes return shape — does §A14-V2 `cmp.equal` and `cmp.firstDelta` still resolve? | Both fields preserved in revised EventStreamDiff. ✓ | Compatible |
| N3 changes return shape — does §A12.1-V2 line 1029 `diff.unexpected` still resolve? | `unexpected` field preserved. ✓ | Compatible |
| N4 — does the sentinel `it()` change test-run semantics? | Named test will fail loudly if corpus <50; was previously silent at collection time. Net improvement, not regression. | Improvement |
| N5 — does `tsx@^4.19.0` conflict with any existing devDependency? | `vitest@^4.1.7` and `tsx@^4.19.0` share no peer constraints. Both ESM-compatible. | No conflict |
| N6 — does the lint-rule allowlist (`__tests__/**`) re-open C13? | No. The §A27-V2 closure is "every direct `inst.rested = true` write OUTSIDE `helpers/restInstance.ts` is forbidden." Adding `__tests__/**` to the allowlist matches the intent: tests arrange state and don't need trigger fan-out. Lint rule is unchanged in production scope. | C13 preserved |

### §25.3-V3 — v1 + v2 closures preserved

| v1/v2 closure | v3 amendment that touches the same surface | Closure status |
|---|---|---|
| T1 (CONTRACT/IMPLEMENTED reclassification) | none | Preserved |
| T2 (exactOptionalPropertyTypes widening) | §A30 buildPlayerZones uses widened fields | Preserved |
| T3 (state.pending narrowing) | none | Preserved |
| T4 (GameStateUnknown deserialize input) | none | Preserved |
| T5 (PlayerZones import) | none | Preserved |
| T6–T12 | none | Preserved |
| P1 (serialize.test.ts) | §A30.5 lists soak.test.ts citation; serialize.test path unchanged | Preserved |
| P2 (golden corpus + divergences.md) | §A32 + §A33 refine the harness wiring; corpus structure unchanged | Preserved |
| P3 (worker/shadow.ts + GameRoom wire-up) | §A31 reconciles Env spelling; §A32 refines compareEventStreams signature; runShadow body unchanged in logic | Preserved |
| P4 (replay-v2.ts) | §A30 + §A34 update import path + invocation command; logic unchanged | Preserved |
| P5–P7 | none | Preserved |
| C1 (package.json delta) | §A34 swaps install command from pnpm to npm + adds tsx; deps unchanged | Preserved |
| C2 (RESOLVE_CHOICE/RESOLVE_TARGET_PICK action routing) | none | Preserved |
| C3 (deserialize default schemaVersion=1) | none | Preserved |
| C4 (triggerBus-v2 cutover deletion) | none | Preserved |
| C5 (Phase 6.5 corpus migration) | none | Preserved |
| C6 (attachedDon split) | none | Preserved |
| C13 (restInstance helper) | §A35 corrects enumeration + adds tests-allowlist; closure mechanism (helper + future lint rule) unchanged | Preserved |
| C15 (soak adapter) | §A30.5 re-points the soak import to the new M16 path | Preserved (already on `../phases/SetupMulligan` per v2 line 1997 — v3 just makes that file exist) |
| A1 (M16 SetupMulligan declaration in Plan v2 §1.1) | §A30 binds M16 to TS surface | Plan promise FULFILLED at spec level |
| A2 (M17 ViewProjection declaration) | none | Preserved |

### §25.4-V3 — Pre-output check

- All 6 N-findings have a concrete fix mechanism with code or text amendment ✓
- No new TS, plan, or code-map gap introduced by v3 amendments ✓
- v1 + v2 closures preserved across all touched surfaces ✓
- One owner-asserted fact was wrong (N6 count of 23+5=28); v3 reports the real count (24 prod-raw + 9 tests = 33) and corrects the v2 cluster table at a smaller scope. Honest report rather than absorb a wrong premise.
- v1 and v2 spec files NOT modified — v3 is a pure overlay.

Self-cert: **PASS.** Spec is ready for round-3 review.
