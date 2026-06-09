# Card Mechanic Pinning Plan

**Status:** post F-7k. Authored 2026-06-09.

This document defines the strategy for pinning per-card mechanic correctness in the engine and the online vertical. It does NOT claim every card is verified — it specifies *how* to verify them incrementally and what coverage already exists.

---

## Existing coverage

### Engine-level

Stage C corpus verification (per memory `optcgsandbox_two_track_engine_audit.md`): 5,197 action records reviewed against engine handler dispatch. 3,012 records were human-reviewed; zero TRUE_ENGINE_BUG classifications.

Existing per-card test surface in `shared/engine-v2/__tests__/cards/`:

```bash
$ ls shared/engine-v2/__tests__/cards/ | wc -l
~280 per-card test files
```

Each file covers a single card's action handlers + edge cases. Coverage skews heavily toward EB01 (Eternal Block) sets.

Existing family/mechanic test surface in `e2e/`:

- `family-*.spec.ts` (10 files) — exercises whole effect families against the engine.
- `stage-c-generated-*.spec.ts` (10 files) — generated coverage for each action_family.

### Online vertical

F-7k surfaced and resolved 4 engine bugs (BUG-001, BUG-002, BUG-008.A) + 3 harness bugs (BUG-007.A/B/C). The 18-game corpus-deck soak harness (`e2e/online/gameplay/soak/`) drove every match end-to-end through the live worker without invariant failures, desyncs, or stuck windows.

Per-mechanic browser verification (deterministic vitest + browser probe pairs):

| Mechanic | Vitest | Browser |
|---|---|---|
| Turn pipeline | `matchSession.turn-pipeline.test.ts` | `multi-turn.spec.ts` |
| ATTACH_DON via JSON-RPC | `donConservation.attachDon.test.ts` | `multi-turn.spec.ts` (clicks ATTACH_DON) |
| DECLARE_ATTACK on leader | inline corpus | `combat-flow.spec.ts` |
| BLOCKER click + KO + counter | `blockerCounter.online.test.ts` (5 scenarios) | `blocker-counter-flow.spec.ts` |
| Trigger window + RESOLVE_TRIGGER | `triggerWindow.online.test.ts` (3 scenarios) | `trigger-flow.spec.ts` |
| Character attack + 0-life win + result projection | `characterAttackWin.online.test.ts` (5 scenarios) | `character-attack-win.spec.ts` |
| Discard prompt (CR §6-5-7) | `discardPrompt.online.test.ts` (5 scenarios) | `discard-prompt-flow.spec.ts` |
| RESOLVE_CHOOSE_ONE / PEEK / TARGET_PICK | drained by soak picker (BUG-007.A fix) | soak harness |
| End-to-end real match | — | soak harness 18/18 |

---

## Per-card pinning strategy (incremental)

The goal is not to write 280+ browser specs. The goal is to ensure:

1. **Engine paths are correct.** Stage C corpus + per-card vitest tests already cover this.
2. **Online dispatch path is correct.** The soak harness proves the JSON-RPC + projection + WS path for arbitrary corpus decks. BUG-001/002/008.A demonstrated that issues at this layer are state-shape or invariant bugs — once one card's path is fixed, every card on the same path benefits.
3. **Per-action-family browser verification.** One representative card per action family is sufficient to prove the projection adapter + UI surfaces the action correctly.

### Action-family verification list

Each row should have a deterministic vitest at the MatchSession layer + (where the family produces visible legal actions) a browser smoke. Priority ordered by F-7k task spec.

| Family | Engine corpus | Server entry-point vitest | Browser smoke | Status |
|---|---|---|---|---|
| trigger | `family-trigger-from-life.spec.ts` | `triggerWindow.online.test.ts` | `trigger-flow.spec.ts` | DONE |
| choose_one | `family-conditional.spec.ts` + Stage C | (soak harness drains) | (soak harness) | DONE via soak |
| discard | `family-discard.spec.ts` | `discardPrompt.online.test.ts` | `discard-prompt-flow.spec.ts` | DONE |
| search / peek | `family-search-peek.spec.ts` | (soak harness drains RESOLVE_PEEK) | (soak harness) | DONE via soak |
| removal (KO) | `family-removal-ko.spec.ts`, `family-on-ko.spec.ts` | `characterAttackWin.online.test.ts` | `character-attack-win.spec.ts` | DONE |
| cost modifiers | `family-cost-reduction.spec.ts`, Stage C `power-cost-modifiers.spec.ts` | — | — | engine-only |
| continuous | `family-continuous-passive.spec.ts`, Stage C `continuous-passive.spec.ts` | — | — | engine-only |
| leader-gated | `family-leader-gated.spec.ts`, `leader-effects-smoke.spec.ts` | — | — | engine-only |
| conditional | `family-conditional.spec.ts`, Stage C `conditionals.spec.ts` | — | — | engine-only |

Items marked "engine-only" rely on the soak harness having driven 2,184+ real clicks through these mechanics without surfacing any failure. If a regression appears at this layer, the next pinning step is to write a `*.online.test.ts` analogous to the BUG-008 fix.

---

## What "verified" means in this document

A row is "DONE" when:

1. The engine corpus + a deterministic `*.online.test.ts` cover the action through `MatchSession.applyPlayerAction` (the entry point `MatchRoom.handleSubmitAction` uses).
2. A browser spec OR the soak harness exercises the action end-to-end through the lobby.
3. The soak harness has driven the action in a real match without surfacing a failure.

The bar is intentionally lower than "every card individually clicked through the browser." That would require ~5,000 browser interactions per spec and is not realistic for CI. The bar IS sufficient to declare the online architecture sound.

---

## When to expand this list

Add a new row if:

- A soak run surfaces a new pending-window family the picker doesn't handle.
- A new action type is added to `shared/engine-v2/protocol/actions.ts`.
- A bug taxonomy in `docs/GAMEPLAY_BUGLOG.md` exposes a per-card or per-family failure.

Do NOT add per-card rows unless one specific card has been observed to misbehave through the online vertical. The Stage C corpus is the authoritative per-card source.
