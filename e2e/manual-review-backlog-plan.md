# Manual-Review Backlog Plan

Triage for known structural CARD_DATA / encoding gaps surfaced during
Stage B. Stage C generated-corpus verification is **paused** until this
backlog is processed so we get a trustworthy signal rather than noisy
repeated failures from the same root causes.

All claims in this document are grounded in current repo source. File
references are clickable.

---

## Summary

| Group | Items | Likely root | Priority |
|---|---:|---|---|
| 1. Counter-event NEEDS_MANUAL_REVIEW | 32 cards across 5 sub-shapes | spec encoding split across `counterEventBoost` + on_play `power_buff` | High (gates Stage C noise reduction) |
| 2. OP01-029 Radical Beam | 1 | magnitude split: `counterEventBoost` 4000 = clause[0] 2000 + clause[1] 2000 (conditional) | High |
| 3. OP01-016 Nami search exclusion | 1 | spec missing `nameExcludes:"Nami"` per printed text | Medium |
| 4. OP07-050 `if_own_chars_min_filter` | 1 (corpus pattern) | engine handler ignores `traitsAny`/`kind` filter keys | High (broad impact) |
| 5. OP03-004 Curiel rush gate | 1 | `card.keywords:['rush']` printed but printed text gates rush on DON | Medium |
| 6. OP05-109 Pagaya | 1 | `trigger:'trigger'` overload + mill_self materialization gap | Low (audit) |
| 7. OP13-106 Conney | 1 | `trigger:'trigger'` overload + give_keyword shape | Low (audit) |
| 8. CardArt cost display | UI follow-up | static `card.cost` not effective cost | Medium (parity with power) |

---

## Group 1 — Counter-event NEEDS_MANUAL_REVIEW (32 cards)

Source: `e2e/counter-event-double-count-corpus-audit.spec.ts` output
after the 59-card SAFE patch landed. Live re-classification (engine
handler at `shared/engine-v2/registry/handlers/conditions2.ts:210-224`,
`shared/engine-v2/reducers/attackFlow.ts:317-411`) gives five sub-shapes:

### 1A. Cost-gated (13 cards)

Clause has an explicit `cost` (`donCostReturnToDeck`, `discardHand`,
`donCost`, `returnSelfChar`); when the cost cannot be paid the clause
skips and only `counterEventBoost` applies. This is the OP01-118
Stage A baseline pattern. **No fix needed** as a class — the clause
shape is intentional ("DON!! −N: …" or "discard X: …" wording).

| Card | Cost shape | Boost | Notes |
|---|---|---:|---|
| OP01-118 Ulti-Mortar | donCostReturnToDeck | 2000 | Stage A baseline |
| OP02-068 Gum-Gum Rain | discardHand | 3000 | |
| OP03-055 Gum-Gum Giant Gavel | discardHand | 4000 | target your_leader |
| OP03-072 Gum-Gum Jet Gatling | discardHand | 3000 | |
| OP03-097 Six King Pistol | discardHand | 3000 | |
| OP04-016 Bad Manners Kick Course | discardHand | 3000 | |
| OP04-074 Colors Trap | donCostReturnToDeck | 1000 | |
| OP05-037 Because the Side of Justice… | discardHand | 3000 | |
| OP06-115 You're the One Who Should… | discardHand | 3000 | |
| OP07-056 Slave Arrow | returnSelfChar (filter min cost 2) | 4000 | needs own char ≥cost 2 |
| OP07-076 Slow-Slow Beam Sword | donCostReturnToDeck | 2000 | |
| ST04-016 Blast Breath | donCost | 4000 | |
| OP09-078 Gum-Gum Giant | donCostReturnToDeck + discardHand + leader trait | 4000 | also leader-gated |

**Action:** **Leave as-is.** Each cost gate IS the printed-text mechanic ("DON!! -N", "discard a card", etc.). When cost paid, clause adds extra to defender (matches printed "DON!! -N then +N power"). Stage A OP01-118 spec exercised this pattern cleanly.

**Risk:** Low — but recommend targeted tests for OP07-056 (`returnSelfChar` filter), OP09-078 (multi-cost AND leader gate), ST04-016 (`donCost`) to confirm cost-payment paths fire on_play `power_buff` correctly when paid.

### 1B. Condition-gated, single clause (8 cards)

Clause is a single on_play `power_buff` with a non-leader OR leader
condition; no cost. Pattern: "[Counter] If <X>, gain +N power" — the
clause IS the conditional bonus on top of `counterEventBoost`.

| Card | Cond type | Boost | Clause mag |
|---|---|---:|---:|
| EB01-028 Gum-Gum Champion Rifle | if_leader_has_trait | 2000 | 2000 |
| EB03-011 But If We Ever See… | if_leader_is | 4000 | 4000 |
| OP07-115 I Re-Quasar Helllp!! | if_own_life_max | 3000 | 3000 |
| OP08-115 The Earth Will Not Lose! | if_leader_has_trait | 3000 | 3000 |
| OP10-117 ROOM | if_own_life_max | 3000 | 3000 |
| OP11-115 You're Just Not My Type! | if_leader_is | 4000 | 4000 |
| P-059 The World's Continuation | if_leader_is | 2000 | 2000 |
| ST14-014 Gum-Gum Giant Rifle | if_own_chars_min_cost | 3000 | 3000 |

Pattern: `clause.mag === boost`. **Suspect duplicate encoding** — if both fire (condition true), defender effective boost = `boost + clause.mag = 2×printed`. Same root as the 59 SAFE patch, but the conditional gate means the SAFE rule "unconditional, no cost, no opt, magnitude=boost" excluded these.

**Action:** **Needs targeted duplicate-count audit per card.** For each, set the condition TRUE, play as counter, capture `counterBoost` + `leader.powerModifierThisBattle`. If DOUBLE_COUNT: each card needs an individual call on either (a) remove the clause (card-data edit) keeping `counterEventBoost` as the single source — but then the gate is lost OR (b) drop `counterEventBoost` to 0 keeping the gated clause as the only boost. Choice depends on whether the bonus is unconditional (always +boost) or gated (+boost only when condition true).

**Risk:** Medium — affects 8 cards. Owner approval required per card before card-data edits.

### 1C. Magnitude-mismatch / split-tier (9 cards)

Multiple clauses where boost = sum of clause magnitudes; clause magnitudes individually != boost.

| Card | Boost | Clause mags | Pattern |
|---|---:|---|---|
| OP01-029 Radical Beam!! | 4000 | 2000 + 2000(if_own_life_max) | base +2000, bonus +2000 if life≤N |
| OP04-095 Barrier!! | 4000 | 2000 + 2000(if_trash_min) | base +2000, bonus +2000 if trash≥N |
| OP05-114 El Thor | 4000 | 2000 + 2000(if_opp_life_max) | base +2000, bonus +2000 if opp life≤N |
| OP06-038 Trichil | 4000 | 2000 (only one clause) | clause mag < boost; PRINTED says +2000 |
| OP07-035 Karmic Punishment | 3000 | 2000 + 1000(if_own_chars_min) | base +2000, bonus +1000 |
| OP07-095 Iron Body | 6000 | 4000 + 2000(if_trash_min) | base +4000, bonus +2000 |
| OP11-019 Glorp Web!! | 2000 | 1000(if_opp_chars_min_power) | conditional only — clause mag < boost |
| OP11-020 X Calibur | 2000 | 1000(if_opp_chars_min_power) | conditional only |
| OP11-059 Gum-Gum King Cobra | 4000 | 2000 + 2000(if_hand_max) | base +2000, bonus +2000 |
| OP12-098 Hair Removal Fist | 4000 | 2000 (one clause, unconditional) | clause mag < boost |

Two-tier shape: `counterEventBoost` represents MAX possible boost; clause[0] is the unconditional base; clause[1] is the conditional bonus that adds the rest.

If both `counterEventBoost` AND the clauses fire: effective = boost + clause.mag. Always over-applies vs printed text.

**Action:** **Per-card audit required.** Two viable patch shapes:
- **Drop counterEventBoost to the unconditional tier** (e.g. OP01-029: boost 4000 → 2000), let clauses add bonus. Symmetric with the 59 SAFE patch logic.
- **OR drop clauses and keep boost** matching the max printed value, losing the conditional gate.

The former preserves printed text semantics; the latter is mechanical but loses conditional behavior.

**Risk:** High — affects 9 cards with split-tier printed text. Owner approval required per card.

### 1D. Leader-gated + cost combo (1 card)

| Card | Pattern |
|---|---|
| OP14-078 Bullet String | `if_leader_has_type` + `donCost` + 2 power_buff clauses on defender |

Edge case combining 1B + 1A patterns plus duplicate-clause-count.

**Action:** Treat as 1B once cost-gate behavior is verified.

### 1E. Other (0 cards)

No remaining cards outside groups 1A-1D.

---

## Group 2 — OP01-029 Radical Beam!! (deep-dive)

Already classified in 1C. Printed text per current `cards.json`
`effectText`: "[Counter] Up to 1 of your Leader or Character cards
gains +2000 power during this battle. Then, if you have 2 or less
Life cards, that card gains an additional +2000 power."

Encoded shape:
- `counterEventBoost`: 4000
- clause[0]: `power_buff +2000 this_battle your_leader_or_character`
- clause[1]: `power_buff +2000 this_battle your_leader_or_character` gated by `if_own_life_max:2`

If life > 2 (Stage B audit showed): effective = 4000 (boost) + 2000 (clause[0]) = 6000. Printed expects +2000.
If life ≤ 2: effective = 4000 (boost) + 2000 (clause[0]) + 2000 (clause[1]) = 8000. Printed expects +4000.

**Likely intent**:
- `counterEventBoost` should drop to **2000** (= unconditional base).
- Clauses preserved as-is.
- Effective: life>2 ⇒ 2000+2000 = 4000? — still over-applies by 2000.

Cleaner option:
- `counterEventBoost` = 0 (so no automatic add).
- clause[0] unconditional +2000.
- clause[1] conditional +2000.
- Effective: life>2 ⇒ +2000; life≤2 ⇒ +4000. Matches printed.

**Action:** **Pause for owner decision.** Patch shape requires confirming whether `counterEventBoost` field is intended to ALWAYS apply (independent of clauses) or whether it's meant as a "max possible" hint. Engine treats it as always-applied (`attackFlow.ts:364-365`); the patch direction follows from that.

**Recommended targeted test:** Already partially covered by `e2e/family-counter-event-double-count-audit.spec.ts` OP01-029 case. Repeat with life=2 to capture the bonus tier.

---

## Group 3 — OP01-016 Nami search nameExcludes

Source review: `cards.json` OP01-016 `effectSpecV2.clauses[0]`:
- action `searcher_peek` with filter `{trait:'Straw Hat Crew'}` only.
- `auditNote`: "searcher filter missing nameExcludes:Nami; text says \"other than [Nami]\"."

Engine handler `searcher_peek` at
`shared/engine-v2/registry/handlers/actions3.ts:826-918` already
supports `nameExcludes` (line 861: `if (matches && typeof filter['nameExcludes'] === 'string' && card.name === filter['nameExcludes']) matches = false;`).

So engine supports the filter; card data is missing it. Adding
`filter.nameExcludes: 'Nami'` would close the gap.

**Action:** **Defer card-data edit until targeted test confirms behavior.**

Recommended targeted test (`e2e/audit-nami-exclusion.spec.ts`):
- Seed A.deck top-5 with mix where slot 1 = another Nami SHC character (e.g. OP02-036 or OP04-011), slot 2 = a different SHC card (e.g. synthetic).
- Play OP01-016 Nami.
- If first picked is another Nami → CARD_DATA_BUG confirmed (engine respects spec filter; spec is wrong).
- If first picked is the second SHC card → engine has some other gate that supersedes (unlikely).

After confirming CARD_DATA_BUG, single-line patch in cards.json on
OP01-016 clause[0].action.filter adding `nameExcludes:'Nami'`.

**Priority:** Medium. Card is visible in default A deck; gameplay is affected if Nami collisions occur.

---

## Group 4 — OP07-050 `if_own_chars_min_filter` (engine gap)

Engine handler `ifOwnCharsMinFilter` at
`shared/engine-v2/registry/handlers/conditions2.ts:210-224`:

```ts
if (typeof filter !== 'object' || filter === null) return false;
const f = filter as { trait?: string; minCost?: number; maxCost?: number };
const hits = s.players[ctx.controller].field.filter((i) => {
  const card = cardOf(s, i);
  if (card === undefined) return false;
  if (f.trait !== undefined && !card.traits.includes(f.trait)) return false;
  if (f.minCost !== undefined && charCost(card) < f.minCost) return false;
  if (f.maxCost !== undefined && charCost(card) > f.maxCost) return false;
  return true;
}).length;
return hits >= n;
```

Handler reads ONLY `trait`/`minCost`/`maxCost`. OP07-050 spec uses
`traitsAny` (array) + `kind`. Both are silently ignored ⇒ all own
chars pass the filter ⇒ condition reduces to `if_own_chars_min:n`.

Corpus query confirmed: **0 cards** use the handler-supported singular
`trait` form for `if_own_chars_min_filter`. **All instances of this
condition use `traitsAny`/`kind`** — the engine handler is unused.

**Decision:**
- **Option A (preferred): Engine fix.** Extend handler to support `traitsAny` (`Array<string>`) — char passes if its traits include ANY listed value — and `kind` (`'character'` etc.). Mirrors target-filter shape elsewhere in the corpus. Minimal change in `conditions2.ts:210-224`.
- **Option B:** Normalize card-data — every card using this condition rewrites filter to singular `trait`. Loses the `traitsAny` semantic.

Option A keeps printed text intent. Option B requires per-card review.

**Recommended targeted test before fix** (`e2e/audit-own-chars-filter.spec.ts`):
- Seed A.field with 2 chars: 1 Amazon Lily trait + 1 unrelated trait.
- Play OP07-050 Sandersonia.
- Current behavior: condition fires (engine ignores filter, counts both as eligible).
- Expected post-fix: only Amazon Lily counts; need 2 ⇒ condition false ⇒ skip.

**Risk:** Medium — engine handler change affects all cards using this condition. Audit query for affected cards before patching.

---

## Group 5 — OP03-004 Curiel rush gate

`cards.json` OP03-004:
- `keywords: ['rush']` (printed keyword set).
- `effectText`: "This Character cannot attack a Leader on the turn in which it is played.<br>[DON!! x1] This Character gains [Rush]."
- continuous: `grant_keyword_to_self:rush` gated by `if_attached_don_min:1`.

Engine legality `legality.ts:228` checks `hasKeyword(state, inst, 'rush')` which reads `card.keywords.includes('rush')` first (always true for Curiel). So rush is always available regardless of DON.

Printed text: rush is DON-gated. Engine: rush is always-on.

**Decision:**
- **Option A:** Remove `'rush'` from `card.keywords` in cards.json for OP03-004. Rely on continuous grant.
- **Option B:** Leave as-is (legality currently allows rush always, matching pre-DON-attach play — printed text restriction "cannot attack Leader" is also missing from spec, so the whole printed-text intent is gone anyway).

Option A is minimal but doesn't restore the "cannot attack Leader" restriction (separate gap).

**Recommended targeted test** (`e2e/audit-curiel-rush.spec.ts`):
- Seed Curiel summoning-sick on A.field, T3 main.
- 0 DON attached: should NOT be legal to declare attack at B leader (per printed).
- 1+ DON attached: SHOULD be legal.

Current engine offers DECLARE_ATTACK regardless ⇒ confirms CARD_DATA_BUG.

**Priority:** Low. Curiel is rare. Restriction gap is per-card, not corpus-wide.

---

## Group 6 — OP05-109 Pagaya

Stage B observations:
- printed text describes a REACTIVE ability ("when a [Trigger] activates"), not the card's own [Trigger] when flipped from life.
- spec encodes 2 clauses with `trigger:'trigger'`: `draw 2` + `mill_self 2`.
- Stage B test: draw 2 materializes correctly; mill_self 2 does NOT add to A.trash (count remained 0).

Investigation needed:
- `mill_self` action handler at `actions3.ts:71-72` delegates to `trash_top_of_deck`. Stage B test deck had ≥40 cards, so empty-deck path wasn't triggered.
- `trash_top_of_deck` handler at `actions.ts:325-336` is straightforward. `resolveCount` reads `action.magnitude` first.
- Why mill_self didn't materialize is unclear without targeted instrumentation.

**Recommended targeted test** (`e2e/audit-pagaya-mill.spec.ts`):
- Seed Pagaya at top of A.life (or directly call EffectDispatcher.dispatch with sourceInstanceId=Pagaya, trigger='trigger').
- Assert A.trash +2 from mill_self alone.

If still 0: classify ENGINE_BUG (mill_self handler delegate broken in some path) and propose minimal handler fix.

**Priority:** Low (single card). Audit-only.

Separately: the `trigger:'trigger'` overload (this card's reactive-to-other-triggers ability fires when this card is flipped from life) is a SEMANTIC issue. Card data likely needs a distinct trigger keyword (`on_other_trigger_activated`) — but that's a corpus-wide encoding change requiring a wider design decision.

---

## Group 7 — OP13-106 Conney

Same `trigger:'trigger'` overload as Pagaya. Encoded:
- `give_keyword:blocker target:self duration:this_turn` gated by `is_opp_turn`, `opt:true`.

When Conney is flipped from A.life:
- Conney is in A.hand post-flipTopLifeToHand.
- If RESOLVE_TRIGGER fires, give_keyword writes `inst.grantedKeywordsOneShot += blocker (this_turn)` on Conney.
- Conney is in hand → blocker grant on a hand card is behaviorally moot.

Printed text: "[Opponent's Turn] When a [Trigger] activates, this
Character gains [Blocker] during this turn." — REACTIVE to other
triggers while Conney is on the field, not when Conney is flipped.

Same family of CARD_DATA semantic gap as Pagaya.

**Action:** Defer until trigger-keyword overhaul decision (see Group 6).

**Priority:** Low.

---

## Group 8 — CardArt cost display UI parity

Current source:
- `src/components/CardArt.tsx:214` — `parts.push('cost ${card.cost}')` aria-label uses STATIC `card.cost`.
- `src/components/CardArt.tsx:292` — `showCost` boolean derives from `card.cost`.
- `src/components/CardArt.tsx:426` — `{card.cost}` visual rendering.

Engine writes runtime cost modifiers to `inst.costModifierOneShot` /
`inst.costModifierContinuous` (per the cost-reduction action at
`actions3.ts:497-510` from Stage A `family-cost-reduction.spec.ts`).
No `effectiveCostForDisplay` derivation exists analogous to the
STEP1 `effectivePowerForDisplay` fix.

**Decision needed:**
- **Option A:** Ship `effectiveCostForDisplay(state, inst)` in `shared/engine-v2/state/derived/cost.ts` and rewire `CardArt.tsx:214, 292, 426` to use it. Symmetric with the STEP1 power fix. ~1 engine file + ~3 site edits in CardArt.
- **Option B:** Defer — cost-reduction modifiers are short-lived (this_turn) and mostly used for "KO opp char with cost ≤ N" follow-up; UI doesn't need to surface dynamic cost. Mark UI effective cost NOT_EXPOSED indefinitely.

**Recommendation:** Lean Option A — completeness and parity with the power fix. Risk is low.

**Priority:** Medium.

---

## Priority order (recommended)

| # | Item | Why first |
|---:|---|---|
| 1 | Group 4 — OP07-050 / `if_own_chars_min_filter` engine handler | Corpus-wide impact: 0 cards work with the singular form; all `if_own_chars_min_filter` cards are silently miscounting. Fixing the handler is one engine edit that fixes all. |
| 2 | Group 1C — Magnitude-mismatch counter events (9 cards) | High behavioral impact (combat math); same root encoding pattern, can be batched after per-card printed-text confirmation. |
| 3 | Group 1B — Condition-gated counter events (8 cards) | Same encoding pattern as 1C; can be batched. |
| 4 | Group 2 — OP01-029 (subset of 1C — gets done as part of #2). | |
| 5 | Group 3 — Nami nameExcludes | Single-line card-data patch after targeted test. |
| 6 | Group 8 — CardArt cost display | UI parity; affects every cost-reduction visualization. |
| 7 | Group 5 — Curiel rush gate | Single card; defer until other audits land. |
| 8 | Group 6 — Pagaya mill_self | Single-card investigation. |
| 9 | Group 7 — Conney trigger overload | Bundled with broader trigger-keyword overhaul decision (out of scope here). |
| 10 | Group 1A — Cost-gated (13 cards) | No action expected; verify a sample then leave. |

---

## Recommended first targeted test

**File:** `e2e/audit-own-chars-filter.spec.ts`

**Anchor:** OP07-050 Boa Sandersonia (`if_own_chars_min_filter` with
`traitsAny:['Amazon Lily','Kuja Pirates'], kind:'character'`).

**Goal:** prove the engine handler ignores `traitsAny` / `kind`. Audit
test with three subcases:

1. A.field empty, play Sandersonia ⇒ post-play A.field=1 (just Sandersonia, no Amazon Lily trait). Condition expected FALSE per printed text (need 2 chars with the trait); engine current behavior likely reads as count≥2 only ⇒ false.
2. A.field has 1 unrelated-trait char + Sandersonia post-play ⇒ A.field=2; printed text wants ≥2 Amazon Lily/Kuja Pirates ⇒ condition FALSE; engine current ⇒ TRUE.
3. A.field has 2 Amazon Lily trait chars (post-play A.field=3 with Sandersonia, which has Kuja Pirates trait per cards.json) ⇒ printed wants TRUE; engine TRUE.

Subcase 2 is the **discriminator**: if engine fires the effect when no filter-matching chars exist, CARD_DATA / ENGINE gap is confirmed.

Test PASSES on data capture; classification per subcase is the audit
result. Recommendation derives from outcome.

**Success criteria:**
| # | Criterion |
|---|---|
| 1 | Test completes < 2 min |
| 2 | Each subcase records `B.field` / `B.hand` delta from Sandersonia's `removal_bounce` action |
| 3 | 0 pageerrors, 0 InvariantErrors, no stuck pending |
| 4 | Subcase 2 outcome reported; classification candidate proposed |

After this test runs, owner picks engine fix (Option A) or card-data
normalization (Option B), then I run regression.

---

## Stop conditions / owner gates

- **DO NOT** patch cards.json or engine until per-item owner approval.
- **DO NOT** start Stage C until at least Groups 1, 2, 3, 4 are resolved.
- Groups 5–7 (single-card audits) are deferrable to post-Stage-C.
- Group 8 (CardArt cost) can be done in parallel; doesn't gate Stage C.

End of plan.
