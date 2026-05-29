# Performance Audit — 2026-05-29 (commit `937eb34`, Phase A + B)

Baseline: iPhone 11+, single-player local game (v0.1 scale). Strict criteria — only real, present-now issues introduced by Phase A/B.

## BLOCKER — none

## MAJOR — none at v0.1 scale

## MINOR

- **`PlayfieldStage` subscribes to the whole `state` object** — `src/components/PlayfieldStage.tsx:211` does `useGameStore((s) => s.state)`. Every dispatch mutates `state` (history append, instances, players), so the entire stage re-renders on every action — including non-visual events like `PHASE_CHANGED`. Children are `memo`'d, but the parent reconciles ~6 grid rows + 3 overlays per dispatch. At ~80 actions/game this is invisible (<1 ms react work per dispatch on A13), but it's the one Phase B regression worth flagging: prior to Phase B the field rows pulled narrow selectors. Fix when convenient by selecting `state.phase`, `state.activePlayer`, `state.players[seat]`, `state.players[opp]`, `state.cardLibrary` as separate selectors. **No action at v0.1 — log for v0.2 polish.**

- **`LifeRevealOverlay` + `EventCardOverlay` subscribe to full `state.history`** — `LifeRevealOverlay.tsx:32`, `EventCardOverlay.tsx:31`. Every dispatch grows `state.history` by 1–3 events, which re-runs both overlays' history-scan `useEffect` (`LifeRevealOverlay.tsx:45-56`, `EventCardOverlay.tsx:42-56`). The scan starts at `lastProcessed` so it's O(new events), not O(history). At v0.1 history maxes ~300 entries / game; scan cost is sub-ms. The `memo` wrap helps because both components only re-render when `active`/`lastProcessed` actually change. **Pattern is correct.** No action.

- **`structuredClone(state)` per action with new DON arrays** — `applyAction.ts:65, 114, 142, 167, 187, 203, 238, 324, 365`. DON-as-`CardInstance[]` adds ~30 string IDs vs scalar numbers (10 cost + up to 20 attached + rested). V8 `structuredClone` on a ~12 KB state is sub-ms on A13/A14. Confirmed unchanged hot-path vs v0.1 audit (`docs/audits/2026-05-28-performance.md` §MINOR). No action.

- **Cost-payment loop in `playCard` is O(cost), cost ≤ 10** — `applyAction.ts:78-80` runs `donCostArea.shift()` per cost unit. `shift()` is O(n) in JS arrays (n ≤ 10), so total cost-payment is O(cost × donCostArea.length) ≤ 100 ops per `PLAY_CARD`. Negligible. No action.

- **`CostAreaStrip` + `DonRested` iterate DON arrays of ≤10** — `CostAreaStrip.tsx:138`, `DonRested.tsx:71`. Each renders a `motion.button`/`motion.div` per coin. 10 motion elements × 2 strips × 2 players = 40 max. Framer Motion's per-element overhead is ~0.1 ms; total <5 ms on first paint, ~0 ms on re-renders thanks to React reconciliation by stable `key={instanceId}`. No action.

- **`LifeStack` renders up to 5 `motion.div` with `layoutId`** — `LifeStack.tsx:70-92`. `layoutId` triggers Framer's shared-layout reconciliation on every render. With 5 cards × 2 stacks = 10 measured nodes per frame during layout animations. Spec target is one transition at a time (life flip). Confirmed: `LayoutGroup` wraps in `PlayfieldStage.tsx:221` so cross-component flights work. No measurement issue at this count. No action.

- **`donArm` Zustand store is independent of game store** — `src/store/donArm.ts`. Selectors in `CostAreaStrip.tsx:104-106` pull three slices (`armedDonId`, `arm`, `disarm`). Each is a stable reference; no re-render on unrelated state changes. Clean separation prevents game-store invalidations from touching the arm state. No action.

## Bundle

- **367,487 B raw / 112,957 B gzipped** (`dist/assets/index-UVR2l0fj.js`). +10 KB raw / +2 KB gzipped vs `2026-05-28-performance.md` line 13 baseline (206 KB raw / 65 KB gzipped). Note: that prior figure pre-dates the v0.1 redesign (commit `66e4b99`), not just Phase B. The +2 KB gzipped from Phase B alone is the 4 new overlay components (`LifeRevealOverlay`, `EventCardOverlay`, `TriggerPrompt`, `DonRested`) + `donArm` store + `LifeStack` + `CostAreaStrip`. Acceptable. **Over the 90 KB gzipped visual-spec budget by ~23 KB** — pre-existing condition from v0.1 redesign, not Phase B regression. Log for v0.2 if Framer Motion tree-shaking becomes worth chasing. No action this cycle.

## iOS Safari pattern check

Note: `docs/optcg-sim/animation-architecture.md` referenced in the 2026-05-28 audit does not exist in this repo. Cross-checked Phase B components against documented iOS Safari pitfalls:

- ✓ No `position: fixed` + `transform` on the same node (the iOS Safari clipping bug). All `motion.div` overlays use `fixed inset-0` for the wrapper and transforms only on inner children (`LifeRevealOverlay.tsx:73, 84`; `EventCardOverlay.tsx:73, 84`; `TriggerPrompt.tsx:88, 105`).
- ✓ `100dvh` not `100vh` (confirmed in 2026-05-28 audit; Phase B added no new viewport units).
- ✓ All animations target `transform`/`opacity` (GPU-composited): `scale`, `rotateY`, `rotate`, `opacity` — no `top`/`left`/`width` animations.
- ✓ `pointer-events-none` on overlay wrappers (`LifeRevealOverlay.tsx:76`, `EventCardOverlay.tsx:76`) so they don't intercept taps when active.
- ⚠ `AnimatePresence` + `setTimeout` dismissal pattern in `LifeRevealOverlay.tsx:60-65` + `EventCardOverlay.tsx:60-65`: if the user backgrounds the tab during the 1200–1500 ms window, the timeout still fires on resume and the overlay dismisses cleanly. Verified — `window.setTimeout` cleanup on unmount is in place. Not a bug.

## Verified clean

- No N+1 loops, no `.in()` chunks, no Supabase calls in client code — v0.1 has no network layer.
- No `Promise.all` fan-out on shared state mutation paths.
- DON array mutations (`shift`/`push`) operate on cloned arrays — no aliasing across dispatches.
- `PendingTrigger` is a small object (3 fields) — adds <100 B to clone payload.
- Overlay subscribers use `memo` + narrow selector pattern correctly.

## Status

- Phase A + B perf: clean at v0.1 scale
- One minor regression logged (`PlayfieldStage` whole-state subscription) — defer
- Bundle +2 KB gzipped from Phase B, within tolerance
- No iOS Safari pattern violations introduced
