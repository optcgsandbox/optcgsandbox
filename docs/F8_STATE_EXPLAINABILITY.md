# F-8 Step E — State Mutation Explainability Audit

**Method:** Cross-reference every mutation type with the 13 cinematic beat kinds (`src/gameLog/beatFor.ts:13-26`), the 9 reactive prompts (`src/components/*Prompt.tsx`), and the engine handlers/reducers documented in Steps A/B/C. WHAT/WHY/WHO answerable from player POV?

**Authoritative inputs:** `docs/F8_EFFECT_FAMILY_MATRIX.md`, `docs/F8_CORPUS_COMPATIBILITY.md`, `docs/F8_GAMEPLAY_FLOW_AUDIT.md`.

## Audit table

| # | Mutation | WHAT | WHY | WHO | Current feedback | Missing explanation | Severity | Generic fix family |
|---|---|---|---|---|---|---|---|---|
| 1 | deck → hand (turn-start draw) | ✅ | ✅ implicit | ✅ implicit | Card animates from deck to hand | None — phase-driven | LOW | none |
| 2 | deck → hand (effect-triggered draw) | ✅ | ❌ | ❌ | Hand grows; no beat | No DRAW beat; player doesn't know which clause caused it | HIGH | Pattern B — new DRAW beat with `cause` |
| 3 | life → hand (damage step) | ✅ | ✅ | ✅ | LIFE_LOST beat fires after COMBAT_RESULT | None | GREEN | none |
| 4 | life → hand (effect: `life_to_hand`, 33 clauses) | ✅ | ❌ | ❌ | Life count drops; card lands in hand silently | No LIFE_TO_HAND beat for effect-driven case | HIGH | Pattern B — new beat kind |
| 5 | hand → field (play) | ✅ | ✅ | ✅ | CARD_PLAYED beat (1700ms) | None | GREEN | none |
| 6 | field → hand (bounce) | ✅ | ✅ | ⚠️ partial | BOUNCED beat (2000ms) | Bounce SOURCE (which clause caused it) not always named | MEDIUM | Pattern B — beatFor enrichment (causal scan) |
| 7 | field → trash (KO from combat) | ✅ | ✅ | ✅ | KOD + COMBAT_RESULT | None | GREEN | none |
| 8 | field → trash (KO from effect) | ✅ | ❌ | ❌ | KOD beat fires but no source attribution | Player doesn't know which clause KO'd their character | HIGH | Pattern B — KOD subText attribution |
| 9 | hand → trash (effect-discard, mill, opp-discard) | ✅ | ❌ | ❌ | Hand count drops; no beat | No TRASH_FROM_HAND / DISCARD_BY_OPP beat | HIGH | Pattern B — new beat kinds |
| 10 | deck → trash (mill_self, 53 clauses) | ✅ | ❌ | ❌ | Deck count drops; no beat | No MILL beat | MEDIUM | Pattern B — new beat kind |
| 11 | character rested | ✅ visual rotation | ❌ | ❌ | Card rotates 90° | No REST_TARGET beat; player doesn't know which clause rested it | HIGH | Pattern B — new beat kind (rest_target) |
| 12 | character unrested (set_active, 86 clauses) | ✅ visual | ❌ | ❌ | Card rotates back | No UNREST_TARGET beat | HIGH | Pattern B — new beat kind |
| 13 | power +N (during combat) | ✅ | ✅ | ✅ | COMBAT_RESULT shows `powerModSourceName` + direction | None when source is during combat (counter / on_attack) | GREEN | none |
| 14 | power +N (outside combat) | ✅ HUD number | ❌ | ❌ | Power number changes silently on field | No POWER_MODIFIED standalone beat (412 power_buff clauses, of which ~250 GREEN and ~162 PARTIAL) | HIGH | Pattern B — new beat kind |
| 15 | power −N (same as #14) | same as #14 | HIGH | Pattern B |
| 16 | DON attached (phase) | ✅ | ✅ | ✅ | DON animates from pool to leader/character | None | GREEN | none |
| 17 | DON attached (effect: `give_don_to_target`, 85 clauses) | ✅ visual | ❌ | ❌ | DON appears on a Character with no beat | No DON_ATTACHED beat for effect | HIGH | Pattern B — new beat kind |
| 18 | card searched (searcher_peek, 183 clauses) — human | ❌ | ❌ | ❌ | Engine auto-resolves; card may appear in hand or play | NO chooser, no reveal, no beat for human (Step A: BROKEN) | CRITICAL | Pattern A — PendingSearcherPeek + Prompt |
| 19 | card searched (searcher_peek) — opp | ✅ | ✅ | ✅ | SEARCHER_RESULT beat fires (`beatFor.ts:189`); reveals matched card per OPTCG rules | None | GREEN | none |
| 20 | card chosen (choose_one, 28 clauses) | ✅ | ✅ | ✅ | ChoosePrompt mounts; EFFECT_ACTIVATED beat surfaces choice | None | GREEN | none |
| 21 | card reordered (peek_and_reorder, 39 clauses) | ❌ | ❌ | ❌ | NOTHING — V0 stub only updates `knownByViewer` | Engine doesn't apply reorder; no UI | CRITICAL | Pattern A — engine completion + ReorderPrompt |
| 22 | play-for-free (193 clauses) | ✅ | ⚠️ partial | ⚠️ partial | CARD_PLAYED fires for the played card | "From which zone?" "Triggered by what?" sometimes implicit | MEDIUM | Pattern B — beatFor.CARD_PLAYED subText "(played free from Y by Z)" |
| 23 | target selected (action-clause "up to 1") | ❌ | ❌ | ❌ | Engine auto-picks; no UI mount | NO target picker for action clauses (~638) | CRITICAL | Pattern A — PendingTargetPick (action-clause variant) + TargetPickPrompt |
| 24 | target selected (attack_target_pick) | ✅ | ✅ | ✅ | Existing PendingTargetPick + UI mount | None | GREEN | none |
| 25 | blocker declared | ✅ | ✅ | ✅ | BlockerPrompt + BLOCKED beat | None | GREEN | none |
| 26 | counter used | ✅ | ✅ | ✅ | CounterPrompt + COUNTERED beat + COMBAT_RESULT counter sub-text | None | GREEN | none |
| 27 | trigger activated | ✅ | ✅ | ✅ | TriggerPrompt + TRIGGER_ACTIVATED beat | None | GREEN | none |
| 28 | attack failed (target survived) | ✅ | ✅ | ⚠️ partial | COMBAT_RESULT shows attacker/target power; F-7w dual-card visuals | Why power was modified BEFORE combat is silent (rolls into #14) | MEDIUM | Resolved by fixing #14 |
| 29 | attack landed (target KOd or life lost) | ✅ | ✅ | ✅ | COMBAT_RESULT + KOD or LIFE_LOST | None | GREEN | none |
| 30 | stage replaced | ❌ | ❌ | ❌ | Stage swaps with no beat | No STAGE_REPLACED beat | MEDIUM | Pattern B — new beat kind |
| 31 | card disappeared (catch-all) | ❌ | ❌ | ❌ | Any uncategorized zone-move (e.g. opp deck → opp hand from a top-of-deck effect) | Catch-all bucket; resolved by fixing the family that caused it | MEDIUM | depends on cause |

## Aggregated counts

- **CRITICAL** (3): searcher human, reorder, action-clause target pick
- **HIGH** (8): effect-draw, life_to_hand effect, KO from effect, hand→trash effect, rest/unrest, power non-combat, DON effect-attach
- **MEDIUM** (4): bounce attribution, mill, play-free attribution, stage replace
- **GREEN** (16): phase-driven mutations + the 6 prompts that already exist + combat path

## Root pattern (all CRITICAL/HIGH share it)

> Engine emits a history event with correct state mutation. `beatFor.ts` returns `null` (silent) for that event kind OR no prompt mounts for the corresponding pending kind. Player sees the state change without explanation.

**Two patterns fix everything:**

- **Pattern A** (engine pending split + generic prompt): #18 searcher, #21 reorder, #23 action-target — CRITICAL trio. Each: `Pending<X>` interface + `RESOLVE_<X>` action + `<X>Prompt.tsx` reading generic engine state.
- **Pattern B** (beatFor enrichment / new beat kinds): #2 draw, #4 life_to_hand, #8 effect-KO attribution, #9 discard, #10 mill, #11/12 rest/unrest, #14/15 non-combat power, #17 DON effect-attach, #30 stage replace.

Pattern B is mechanically simple (add to `BeatKind` union + add a `case` in `beatFor()` + tune duration in `PresentationQueue.tsx:30-44`). Volume: 9 new beat kinds.

Pattern A is heavier — engine state types + protocol action + reducer + handler split + new React component. Volume: 3 generic prompts.

## Per-axis answers

- **WHAT** is the easiest to answer — state usually visible (card moved, number changed). Only #18 (searcher silent) and #21 (reorder stub) hide WHAT.
- **WHY** fails in 12 cases — beat or prompt missing.
- **WHO** fails in the same 12 cases — `beatFor` doesn't trace cause unless explicitly added (combat path has `attributeCombatSource` + `scanCombatChain`; non-combat doesn't).

## Constraint

No card-specific logic anywhere in proposed fixes. Every fix operates on:
- effect family (`action.kind`)
- pending kind (`pending.kind`)
- engine history event type (`event.type`)
- controller identity (`ctx.controller === A`)

Zero references to specific cardIds or card names.
