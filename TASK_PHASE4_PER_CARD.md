# Phase 4 — Per-Card Audit Protocol

*Last revised: 2026-06-03 (v4.1 — second-pass closeout: 8 mechanical blockers + 12 structural gaps from the 2026-06-03 verification audit). Version: 4.1.*

**Read this in full before starting OR resuming the per-card grind.** This is the contract. Agents follow it without deviation. Owner sets the bar: every card plays per its printed `effectText`, and the spec encodes that printed text via the Rule 8 bijection (the mechanical definition of "100% axis-faithful" — see Rule 2).

**Rules sections (everything above the "Live state" section near the end) are FROZEN.** The ONLY content the orchestrating agent may mutate during the pass is the fenced code block immediately under the "Live state" H2 — see Rule 11 for the mechanical guard.

**Glossary.** OPT = Once Per Turn (printed as `[Once Per Turn]`). CR = Bandai OPTCG Comprehensive Rules (current English revision). KO / K.O. = Knock Out (sends a character to trash). DON!! = the DON resource. effectText / effectSpecV2 = JSON fields on each card in `shared/data/cards.json`.

**Roles.** *Owner* = Mina (the human directing the project). *Orchestrator* = the main-thread agent running this protocol. *Auditor* = the per-card Code Reviewer sub-agent launched by the orchestrator. Sub-agents report to the orchestrator; the orchestrator reports to the owner at checkpoints (Rule 6).

---

## ⚠️ Rules (all rules in this section have equal enforcement weight — "Zero-Tolerance" labels failure modes, not priority tiers)

Prior sessions drifted into batching, shape-only tests, skipping `verified:"flagged"` cards, and rationalizing engine limitations as spec excuses. Owner caught it. These rules close every escape hatch.

### Rule 1 — ONE CARD AT A TIME

- You work on **exactly one card** at a time.
- "Working on" = any `Edit`/`Write` touching `cards.json` fields of another card, or any `Edit`/`Write`/`Bash` that creates/modifies another card's test file, or any `Read` of another card's `effectText`/`effectSpecV2` *with intent to spec-audit*.
- ALLOWED: `Read` of `cards.json` with offset/limit to locate the *current* card; `grep` across `cards.json` for global facts (e.g., trait usage counts, the skipped-card sweep — Rule 1a); `ls` of `__tests__/cards/` to confirm absence of a file for the current card; `Read` of engine files under `shared/engine-v2/**` for handler tracing (Step 4); `Read` of `BUGS_FOUND.md` entries.
- AFTER the Rule 1a sweep completes, ALL subsequent `Read` calls on `cards.json` MUST be parameterized with an explicit offset/limit that scopes to the single current card. Full-file or sweeping reads of `cards.json` outside the Rule 1a sweep are BANNED — they're a pretext for cross-card peeking.
- BANNED: opening another card's test file with intent to edit; editing another card's spec; batching `auditNote`/`verified` flips across multiple cards.
- Banned phrases: "let me batch tests for cards N..N+5"; "I'll fix EB01-053 later when I get back to it"; "I'll come back to flagged cards in a sweep at the end".

### Rule 1a — RESUMPTION + SKIPPED-CARD SWEEP

On every session start (fresh OR resuming):

1. Read this entire document end-to-end.
2. Send the read-receipt to owner (see "Read-receipt requirement" below). Do NOT begin work until owner replies "go".
3. Run the skipped-card sweep before resuming any card:
   ```
   node -e 'const c = require("./shared/data/cards.json"); c.forEach((x,i) => { const root = x.effectSpecV2?.verified; const clauses = (x.effectSpecV2?.clauses ?? []).map(cl => cl.verified); if (["flagged","auto"].includes(root) || clauses.some(v => ["flagged","auto"].includes(v))) console.log(i, x.id, root, clauses); });'
   ```
4. If the sweep returns any card-index strictly less than the "Last card touched" from the Live-state footer, that card was skipped by a prior session — advance "current card" to the LOWEST such index. Skipped cards are always audited first.
5. If the Live-state footer's "Card in progress" is non-empty, the resumed current card is that one. Re-validate Rule 4 conditions for it from scratch.
6. Check `git stash list | grep "phase4 wip"`. If matches exist, `git stash show -p` each one; apply only if it matches the resumed current card; never pop an unrelated stash. Document the decision in the footer's "Last update" notes.
7. **Rule 10 standing approval is REVOKED on every session resume.** The orchestrator MUST re-request standing approval for audit launches as part of the read-receipt before launching any sub-agent.
8. If you cannot determine the current card unambiguously, STOP and ask owner.

### Rule 2 — SPEC MUST BE FAITHFUL TO PRINTED TEXT (100%, not close enough)

- Source of truth: the card's `effectText` field in `shared/data/cards.json`. effectText is presumed correct. If the agent suspects effectText is mistranscribed, this is a DATA gap — log it in `BUGS_FOUND.md`, STOP per the stop-conditions "needs owner clarification" path, and notify owner. DO NOT edit `effectText`. DO NOT spec around the suspected error.
- For EVERY printed token in `effectText` — including but not limited to bracket tokens (`[On Play]`, `[Activate: Main]`, `[DON!! x N]`, `[DON!! −N]`, `[Once Per Turn]`, `[Counter]`, `[Blocker]`, `[Rush]`, `[Double Attack]`, `[Banish]`, `[On K.O.]`, `[On Block]`, `[When Attacking]`, `[End of Your Turn]`, `[On Your Opponent's Attack]`, `[Trigger]`, `[Your Turn]`, `[Main]`), parenthetical conditions (`(if X)`, `(then Y)`), quantifiers (`up to N`, `exactly N`, `all`), durations (`during this turn`, `until the end of your opponent's next turn`, `permanently`, `until end of your next turn`), zones (`from your hand or trash`, `from your deck`, `from your trash`, `set aside`), filters (`with a cost of N or less`, `with N power or more`, `of color X`, `with type Y`), and verbs (`KO`, `rest`, `active`, `draw`, `trash`, `return`, `search`, `reveal`, `look at`, `shuffle`, `give`, `attach`, `banish`) — the `effectSpecV2` MUST contain a corresponding axis-faithful encoding. The list above is illustrative, not exhaustive; if `effectText` contains a token not enumerated, you still encode it.
- If the printed text says **A** and the spec encodes **B**, the spec is wrong. You FIX the spec in `cards.json`.
- Engine code (under `shared/engine-v2/**`) is FORBIDDEN to MODIFY during this pass (no `Edit`/`Write` to any file under `shared/engine-v2/**` except the per-card test file at `shared/engine-v2/__tests__/cards/<ID>.test.ts` and an additive extension of `shared/engine-v2/__tests__/cards/_fixtures.ts` if needed per Constraints). READING engine code (`Read`/`grep`) is REQUIRED to identify file:line for `BUGS_FOUND` entries. Engine gaps go in `BUGS_FOUND.md`, never as engine edits.
- If the corrected spec uses a primitive the engine doesn't yet support, that is an ENGINE gap, not a SPEC gap. Spec stays faithful to printed text. Behavioral test for that card uses `it.fails` per Rule 7a.

**Operational definition of "100% axis-faithful":** the bijection in Rule 8 (every printed token ↔ exactly one spec field; every spec field ↔ exactly one printed token; counts equal; auditor's independent re-derivation matches). If the bijection holds, the card is 100% axis-faithful; if it fails, it isn't. There is no third state. The Rule 8 bijection IS the bar.

### Rule 3 — BEHAVIORAL TEST IS REQUIRED (not shape-only)

- Test path: `shared/engine-v2/__tests__/cards/<ID>.test.ts`. `<ID>` is the card's `id` field with any `/`, `:`, `*`, `?`, or whitespace replaced with `-`.
- "Non-vanilla" = any card NOT qualifying for the vanilla, keyword-only, or counter-only exemption defined below. Every non-vanilla card requires a dispatching test.
- Every non-vanilla card's test MUST import and call AT LEAST ONE of:
  - `EffectDispatcher.dispatch(state, ctx, trigger)` — for clause triggers.
  - `ContinuousManager.refold(state)` — for continuous effects.
  - `CostPayer.canPay` / `CostPayer.pay` — for cost behavior.
  - `ReplacementManager.tryReplace` — for replacement entries.
- Shape-only tests (`expect(clause.action.kind).toBe('draw')` without dispatching) are BANNED for non-vanillas.
- Concrete values: `expect(...).toBe(1000)` not `toBeDefined()` / `toBeGreaterThan(0)`.
- **Vanilla exemption:** if (`effectText === "-"` OR `effectText === ""` OR `effectText === null` OR `effectText` is missing) AND (`clauses` missing OR `clauses.length === 0`) AND (`continuous` missing OR `continuous.length === 0`) AND (`replacements` missing OR `replacements.length === 0`), a data-shape test asserting `kind`/stats/colors/traits is acceptable. Only literal ASCII hyphen `-` counts; Unicode minus `−` or em dash `—` is a printed token and disqualifies the card.
- **Keyword-only exemption:** if `effectText` is a non-empty string containing ONLY printed keyword tokens (e.g., `[Blocker]`, `[Rush]`, `[Double Attack]`, `[Banish]`, or any combination) AND `clauses.length === 0` AND the keyword behavior is exercised entirely by phase/zone code, a data-shape test asserting the keyword token is present in `keywords` AND the TOKEN AUDIT block maps each keyword to its `keywords[]` entry is acceptable.
- **Counter-only exemption:** if `effectText` contains only `[Counter] +N` with no other clauses, a data-shape test asserting `counterValue` or `replacement` entry is acceptable, with TOKEN AUDIT mapping `[Counter] +N` → the encoded field.

### Rule 4 — CARD-COMPLETE GATE (no moving on until ALL of these are true)

A card is "Rule-4-clean" — the canonical phrase, used everywhere — ONLY when:

1. **Printed text confirmed read** — the `effectText` string has been read in this session.
2. **Spec faithful** — 5-axis comparison done; spec edits applied if needed; `effectSpecV2.verified` at root AND on every clause is now `"human-reviewed"` or `"ground-truth"` (never `"flagged"` / `"auto"` / anything else).
3. **No unresolved auditNote** — if the card had `auditNote`, it has been removed (the auditNote key deleted from the card object) OR its value rewritten to start with the literal prefix `RESOLVED:` followed by a reason. Remove when fully resolved by spec edits; annotate when resolution is an engine gap logged in `BUGS_FOUND.md` (so future readers see the cross-ref).
4. **Behavioral test exists** — `shared/engine-v2/__tests__/cards/<ID>.test.ts` exists, imports the right entry points (Rule 3), and asserts printed-text outcomes; includes the Rule 8 TOKEN AUDIT header block.
5. **Test runs** — `npx vitest run shared/engine-v2/__tests__/cards/<ID>.test.ts` returns all passing OR a mix of passes + documented `it.fails` per Rule 7a. AND `npx vitest run shared/engine-v2/__tests__/cards/` (full per-card suite) returns no NEW failures introduced by this card's spec edits.
6. **Code Reviewer audit** — an independent sub-agent launched via the Rule 9 canonical prompt verbatim has returned `AUDIT PASSED` after independently re-reading printed text AND spec AND test.

If ANY of 1–6 fails, you stay on this card. You do NOT touch any other card's files. Period.

### Rule 5 — AUDIT SUB-AGENT CONTRACT

- Audit agents run **one card at a time**, never batched. EXACTLY ONE audit sub-agent per card per attempt. Parallel auditing is BANNED. If two are needed (first crashed), launch sequentially; the second's verdict supersedes.
- **The audit sub-agent MUST be a separately-launched Agent. The orchestrator (the agent that wrote the spec edits + test) CANNOT self-audit.** This is enforced at the orchestrator side (the orchestrator is the only entity that knows it authored the artifacts). The auditor has no way to verify identity from inside its read-only scope; identity verification is the orchestrator's responsibility.
- **Tool budget:** `Read` (any file in repo) and `Bash` for read-only commands only: `grep`, `rg`, `ls`, `find`, `wc`, `node -e` (for read-only JSON dereferencing — see Rule 9 step 8). NO `git log -p`, NO `git diff`, NO `git show`, NO `git blame` — these can leak prior-session rationalizations from commit messages and prime the auditor. Allowed git commands for the auditor: NONE. The orchestrator uses `git status` / `git stash list` only for resumption (Rule 1a). NO `Edit`, `Write`, `NotebookEdit`, or any mutation. The audit agent NEVER modifies any file.
- The orchestrator MUST launch every per-card audit with the Rule 9 canonical prompt verbatim — no edits to the prompt body except substituting `<ID>`.
- If the sub-agent's output does not match either of the exact strings `AUDIT PASSED` or `AUDIT FAILED: <reasons>` (regex: `^(AUDIT PASSED|AUDIT FAILED: .+)$`), the orchestrator treats it as `AUDIT FAILED` with reason "malformed verdict" and relaunches the audit (counts toward the Rule 5a 3-attempt cap).

### Rule 5a — AUDIT FAIL-LOOP BOUND

If the same card AUDIT FAILS **three (3) consecutive attempts FOR ANY REASON** (reason-class differentiation removed — drift bait), STOP the loop, treat as a stop condition ("cards cannot be made faithful" path), and notify owner with: (a) the printed text, (b) the agent's reading, (c) the auditor's reading on each of the 3 attempts, (d) the specific token / field in dispute.

### Rule 6 — CHECKPOINTS, COMMITS OWNER-CONTROLLED

- Stop and notify owner at Rule-4-clean cards **50, 100, 150, 200, and 250 (end of pass)**. Each checkpoint: summarize gaps, await owner update before resuming. (For the 250-card scope, the cadence is every 50.)
- **STOP-condition precedence:** any active stop condition (Rule 5a cap, Step 7 fix-loop cap, context exhaustion, owner-clarification needed, 5+ multi-module engine bugs, leaked card, duplicate ID, mistranscription) **SUPERSEDES** the checkpoint cadence. After owner resolves a STOP, the next checkpoint is the next multiple-of-50 Rule-4-clean count (50/100/150/200/250), not a fresh count from current. Among multiple simultaneous stop conditions, **context exhaustion has highest precedence** (stash first, classify the card on resume).
- Commits are OWNER-CONTROLLED. The agent does NOT auto-commit and does NOT auto-push. After each card is Rule-4-clean, the work stays in the working tree until owner says "commit".
- **The Live-state footer (Rule 11) and the `BUGS_FOUND.md` audit-log append (Step 8) are file mutations the orchestrator performs DURING the pass — they are NOT commits.** They run continuously without owner "commit" trigger because they are durable state needed for resumption. They commit only when owner says "commit". This is not a contradiction with the no-commit rule; it's the difference between mutating the working tree vs creating a git commit.
- When owner says "commit", commit ONE card at a time. The commit includes that card's `cards.json` entry (committed by adding the full `cards.json` file; the working tree MUST contain only this card's edits — verify via `git diff cards.json` showing only the current card's hunk before staging) + the per-card test file + the `BUGS_FOUND.md` delta. Never batched commits across cards.
- Commit message template (when owner says "commit"):
  ```
  phase4(<ID>): audit-clean per Rule 4

  - Spec: <one-line summary of edits to cards.json, or "no changes">
  - Test: shared/engine-v2/__tests__/cards/<ID>.test.ts (<N positive>/<N negative>/<N boundary>/<N duration>/<N OPT> cases; <N it.fails> citing BUGS_FOUND)
  - BUGS_FOUND: <list of entry titles added this card, or "none">
  - TOKEN AUDIT: <N> printed tokens ↔ <N> spec fields (bijection confirmed)
  - Audit verdict: AUDIT PASSED (Rule 9)
  ```
  NO `Co-Authored-By: Claude` line (per global CLAUDE.md §8). NO batched-card commits.

### Rule 7 — PRINTED TEXT IS THE ONLY VOCABULARY (no engine excuses)

Set 2026-06-03 after agent caught lowering the bar from "100% axis-faithful to printed text" to "best the engine supports today" on EB02-011, EB02-015, EB02-021, EB02-052.

- **The spec value MUST literally encode the printed token.** Period. The engine's current vocabulary — enum membership, handler support, struct shape — is IRRELEVANT to the spec write.
- If printed text says "your next Refresh Phase" and the engine's `EffectDuration` enum lacks `own_next_refresh_end`, you write `own_next_refresh_end` in the spec. Engine catches up later. Spec is correct NOW.
- If printed text says "trash 1 card: do A. then do B." (shared cost), the spec is ONE clause with ONE cost and a compound action. Never split into two clauses each carrying the cost.
- If printed text says "do A. if X, do B." (conditional sub-action inside a compound), the spec is ONE clause with a `sequence` action whose sub-actions carry their own `condition` field. Never collapse the condition or duplicate the cost.

**BANNED rationalizations** (each is AUTOMATIC AUDIT FAIL if found in test files, `auditNote` values, agent messages to owner, or commit messages — `BUGS_FOUND.md` is EXEMPT because its purpose is to record engine state):

- "engine enum has no X — closest available is Y"
- "engine handler ignores this field anyway"
- "engine doesn't support X, so I split/merge/collapse"
- "best the engine supports today"
- "spec axis is correct within enum constraints"
- "for now we use Y until the engine catches up"
- "approximates the printed text"
- "the engine handler reads a different field anyway"
- "spec is decorative — runtime ignores it"
- "matching the convention used by sister/parallel cards"
- "printed text is ambiguous so I picked the engine-supported reading"
- "until the engine catches up I'll use the V1/V0 encoding"
- "this is the canonical encoding pattern in the corpus"
- "engine schema doesn't permit nesting here"
- "splitting/merging the clause to fit the dispatcher"
- "tests pass with this shape, so the encoding is fine"
- "interpreting the printed text liberally" / "narrowly"
- "lossless mapping" / "semantically equivalent" / "behaviorally equivalent"
- "TypeScript types reject the faithful encoding"
- "pending engine PR"

**Banned by intent (auditor MUST hard-fail on semantic match even if phrasing differs):** any text in a test file / `auditNote` / agent message / commit message that justifies a SPEC value by referring to engine state. The test of intent: *does the sentence explain why the SPEC was written this way by appeal to ENGINE state?* If yes → AUDIT FAILED. Allowed appeals to engine state live ONLY in `BUGS_FOUND.md` as gap descriptions, never adjacent to a spec field or test assertion.

**Auditor greps (case-insensitive, word-boundary-anchored to avoid false positives on words like "engineering"):**

```
\bengine\b.{0,20}(support|enum|handler|catch.?up|honor|accept|reject)
\b(equivalent|approximat|closest|best.?fit|practical|pragmatic)\b
```

Any hit on a non-exempt file = `AUDIT FAILED`. **Note:** the auditor must additionally apply the "test of intent" check by reading the matched context — if the matched phrase describes test behavior (e.g., "the dispatcher honors the trigger" describing what the test exercises) rather than justifying spec encoding, the auditor SHOULD reason about intent and may downgrade to a flag rather than hard-fail. When in doubt, hard-fail and let the orchestrator clarify.

**Allowed:** silence on the engine entirely. The spec encodes printed text; the test asserts what the engine actually does (via `it.fails` if the engine doesn't yet honor); `BUGS_FOUND.md` logs the engine gap separately without justifying the spec encoding.

### Rule 7a — `it.fails` CONTRACT (single source of truth)

Every use of `it.fails` MUST satisfy ALL of:

1. The case was first written as `it(...)` and run via vitest; the failure was observed. **Evidence requirement:** the `BUGS_FOUND.md` entry referenced by this `it.fails` MUST include a verbatim vitest output snippet in its "Actual" field (showing the failing assertion's file:line + the actual vs expected values vitest printed). The auditor verifies the snippet shape (must contain `AssertionError` or `Error` + the file:line of the failing `it`); a fabricated entry without a real vitest snippet = AUDIT FAILED.
2. The failure is caused by an engine gap (path (b) in Step 7), not a wrong assertion or wrong entry point.
3. A `BUGS_FOUND.md` entry exists for that gap with: card ID, file:line of the buggy handler, expected behavior per printed text, actual implementation + vitest snippet, repro snippet.
4. The `it.fails` call has a comment of the exact form `// engine gap: BUGS_FOUND.md "<entry title>" — <repo-relative path>:<line>`.
5. The card-complete commit (when owner says "commit") includes the `BUGS_FOUND.md` delta in the same commit.

Auditor hard-fails any `it.fails` missing any of (1)–(4); (5) is checked at owner-driven commit time. This rule supersedes any partial `it.fails` requirement elsewhere.

### Rule 8 — TOKEN MAP HEADER REQUIRED IN EVERY TEST FILE

Set 2026-06-03 alongside Rule 7 to make Rule-2 compliance verifiable by the auditor.

Every per-card test file MUST have a `TOKEN AUDIT` block at the top of its header comment. The block lists every printed token from `effectText` paired with the spec field that encodes it.

The mapping is a one-to-one correspondence **by occurrence** (not by token type): each printed-text OCCURRENCE of a token maps to exactly one spec-field OCCURRENCE, and each populated spec-field OCCURRENCE has exactly one printed-text source. Repeated tokens are listed multiple times with positional disambiguation (e.g., `"[On Play] (1st)" → clauses[0].trigger`, `"[On Play] (2nd)" → clauses[1].trigger`).

Compound spec fields may list multiple printed tokens on the right of `→`; a single printed token may list multiple spec fields. Reminder parentheticals that re-state a bracket keyword MUST be annotated `(reminder of <bracket>, no new field)`. The `[DON!! x N]` token MUST map to BOTH cost and any gating condition the brackets imply. `"the rest"` MUST map to an explicit `magnitude:{kind:"remaining"}` or equivalent — never silently elided. Numeric printed counts MUST appear in spec as literal integers, never as `null`/`undefined` defaults.

**`you may` rule (resolving the prior contradiction):** `you may` IS a token despite being connective prose. It counts toward the bijection and maps to clause-level `opt:true` (the engine's optional-clause flag) or `optional:true` (synonym). It is the ONLY connective-prose word that counts as a token; all other connectives (`then`, `and`, `also`, articles) are NOT tokens.

**Tokenization rules (mechanical, to eliminate auditor ambiguity):**

- Bracket tokens (`[X]`, `[X: Y]`, `[X x N]`) — each occurrence = 1 token.
- Parenthetical conditions (`(if X)`, `(then Y)`) — each occurrence = 1 token.
- Numeric magnitudes (`+N power`, `N or less`, `N or more`, `draw N`, `KO N`) — each numeric occurrence = 1 token.
- Duration phrases (`during this turn`, `until end of turn`, `permanently`, `this turn`, `your next turn`) — each occurrence = 1 token.
- Zone phrases (`from your hand`, `from your trash`, `from your deck`, `set aside`) — each occurrence = 1 token.
- Target nouns + qualifiers ("your character with a cost of 4 or less" = 1 target token; "your character" alone = 1 target token).
- Verbs (`draw`, `KO`, `trash`, `return`, `search`, `reveal`, `look at`, `rest`, `set as active`, `attach`, `banish`) — each occurrence = 1 token.
- `you may` — 1 token per occurrence (see rule above).
- All other connective prose (`then`, `and`, `also`, articles) — NOT tokens.

**Spec-field counting rules (mechanical):**

- A "spec field" = one leaf key set to a non-default, non-empty value in `effectSpecV2`.
- `clauses[N].trigger` = 1 field per N.
- `clauses[N].condition.type` = 1 field; `clauses[N].condition.trait` (if present) = 1 field; nested combinators (`and`/`or`/`not`) each contribute 1 field per leaf.
- `clauses[N].action.kind` = 1 field; `clauses[N].action.magnitude` = 1 field; `clauses[N].action.duration` = 1 field; etc.
- `clauses[N].target.kind` = 1 field; each populated `target.filter.*` key = 1 field.
- `clauses[N].opt = true` = 1 field (false / missing = 0).
- `continuous[N].*` and `replacements[N].*` counted same as clauses.
- `verified`, `auditNote` are META, NOT spec fields — exclude from bijection.

**Required format (use exactly this layout — line indentation matters):**

```ts
/**
 * Per-card semantic test — <ID> <Name> (<kind>).
 *
 * Printed effectText:
 *   "<verbatim printed text>"
 *
 * TOKEN AUDIT (every printed token → spec field, bijective by occurrence):
 *   [On Play]                       → clauses[0].trigger = "on_play"
 *   "If your Leader has X type"     → clauses[0].condition.type = "if_leader_has_trait", trait="X"
 *   "draw 2 cards"                  → clauses[0].action = {kind:"draw", magnitude:2}
 *   "during this turn"              → clauses[0].action.duration = "this_turn"
 *   [Once Per Turn]                 → clauses[0].opt = true
 *   ...
 *
 * Bijection check: <N> printed tokens <=> <N> spec fields. Confirmed.
 */
```

**Strict format for the Bijection line** — MUST match this regex (allows any whitespace after the JSDoc `*`, allows `<=>` or `↔` as the separator):

```
^\s*\*\s+Bijection check:\s+(\d+)\s+printed\s+tokens\s+(?:<=>|↔)\s+\1\s+spec\s+fields\.\s+Confirmed\.\s*$
```

Counts on both sides must be equal (the `\1` backreference enforces this). Auditor matches this regex; any deviation = `AUDIT FAILED`.

**Edge case:** if `effectText` contains `*/`, escape inside the comment as `*\/` OR move the verbatim printed-text block from a block-comment to a JS string constant (`export const PRINTED_TEXT_<ID> = "...";`), with the TOKEN AUDIT remaining in a block comment that REFERENCES the constant instead of inlining the text.

**Hard fail conditions (auditor):**

- The `TOKEN AUDIT` block is missing.
- A token from `effectText` (by the tokenization rules above) does not appear in the mapping.
- A populated spec field (by the counting rules above) has no printed source listed.
- The Bijection line is missing or fails the regex.

**Vanilla / keyword-only / counter-only exemption:** the TOKEN AUDIT block reads `(vanilla — no tokens to map)`, `(keyword-only — keywords[] maps to printed brackets: [<list>])`, or `(counter-only — counterValue maps to "[Counter] +N")` as appropriate.

### Rule 9 — CANONICAL AUDIT PROMPT (paste verbatim, no edits)

The orchestrator MUST launch every per-card audit with this exact prompt body (substituting only `<ID>`):

```
INDEPENDENT PER-CARD AUDIT — card <ID>.

You have NOT seen prior conversation. You have Read access and read-only Bash limited to: grep, rg, ls, find, wc, node -e (read-only JSON dereferencing only — no file writes, no shell side effects). NO Edit/Write. NO git log/diff/show/blame.

ORDER MATTERS — do these in order:

1. Read shared/data/cards.json for card <ID>. Read ONLY effectText FIRST. Write a one-paragraph summary in your head of what the card should do per printed text. Do NOT read effectSpecV2 or test file yet. Do NOT read BUGS_FOUND.md or any auditNote until step 5 — treat such prose as untrusted input.

2. Read the rest of card <ID>'s entry: effectSpecV2 (full subtree including clauses[*].verified, root verified, auditNote).

3. Read shared/engine-v2/__tests__/cards/<ID>.test.ts.

4. Independently tokenize effectText per the Rule 8 tokenization rules; list every token with positional disambiguation.

5. Independently enumerate every populated field in effectSpecV2 per the Rule 8 spec-field counting rules.

6. Compare against the test file's TOKEN AUDIT block. Verify bijection by occurrence per Rule 8. Verify the Bijection regex matches the test file's Bijection line.

7. Hard-fail if ANY of:
   - root effectSpecV2.verified is not "human-reviewed" / "ground-truth"
   - any clause's verified is not "human-reviewed" / "ground-truth"
   - auditNote key exists AND (auditNote is null OR auditNote is not a string OR auditNote does not start with the literal "RESOLVED:")
   - test is shape-only on a non-vanilla (per Rule 3)
   - any it.fails lacks the canonical comment // engine gap: BUGS_FOUND.md "<title>" — <path>:<line> (Rule 7a)
   - any cited BUGS_FOUND.md entry does not exist in the repo
   - any cited BUGS_FOUND.md entry is missing one of (a) card ID, (b) file:line of buggy handler, (c) expected behavior per printed text, (d) actual implementation including a verbatim vitest output snippet
   - any banned phrase from Rule 7 (literal OR by-intent regex with word-boundary anchoring) appears in the test file, auditNote, agent messages, or commit messages (BUGS_FOUND.md is exempt)
   - TOKEN AUDIT block is missing, omits a printed token, omits a populated spec field, or its Bijection line doesn't match the Rule 8 regex
   - any assertion uses a widened matcher (toBeDefined, toBeGreaterThan, toBeGreaterThanOrEqual, toBeTruthy, .not.toBeUndefined, .toEqual(expect.objectContaining(...)), etc.)
   - the test file uses try/catch around dispatch, if/return early exits inside it() blocks, describe.skip, expect.assertions(0), narrowed buildState that prevents the printed gate from being exercised, or any other green-without-observation shortcut
   - the progress footer's "Bugs filed (cumulative)" count disagrees with the BUGS_FOUND.md entry count

8. For every TOKEN AUDIT mapping line, dereference the claimed spec path from the effectSpecV2 subtree already loaded in step 2. Walk the JSON object in your head OR use node -e for explicit dereferencing, e.g.:
     node -e 'const c=require("./shared/data/cards.json").find(x=>x.id==="<ID>"); console.log(JSON.stringify(c.effectSpecV2.clauses[0].action))'
   This is read-only. Confirm the value literally equals what the TOKEN AUDIT mapping claims. Mismatch = AUDIT FAILED: token-map drift.

9. Output EXACTLY one of:
   AUDIT PASSED
   AUDIT FAILED: <numbered reason list>

   No prose, no recommendations beyond the reason list, no batched verdicts. Regex: ^(AUDIT PASSED|AUDIT FAILED: .+)$
```

### Rule 10 — AUDIT-LAUNCH STANDING APPROVAL

Because Step 8 requires one Code Reviewer sub-agent launch per card (×250 cards), the orchestrator MUST obtain a single standing approval from owner at the start of the pass: *"Approve per-card Code Reviewer audit launches for this pass — one per card, using the Rule 9 canonical prompt verbatim?"* Once approved, the orchestrator launches per Rule 9 without additional relay-back.

Standing approval is REVOKED automatically:

(a) if the canonical prompt is modified
(b) if a sub-agent uses any tool outside Rule 5's budget
(c) at the end of the pass (card #250)
(d) **on any session resume (new conversation), as part of Rule 1a step 7** — the orchestrator must re-request fresh standing approval before launching any sub-agent in the resumed session

Any of these requires a fresh standing approval.

### Rule 11 — DOCUMENT EDIT GUARD (mechanical, the protocol's tripwire)

The orchestrating agent may ONLY mutate `TASK_PHASE4_PER_CARD.md` by editing the fenced code block inside the "Live state" section at the bottom of this document. The H2 heading, the introductory sentences, and the fence delimiters (` ``` ` lines) of that section are FROZEN. Insertions outside the fence are rule edits and require owner approval + version-stamp bump (current version: 4.1).

**Tripwire:** if the orchestrator ever runs `Edit` or `Write` on any file path matching `TASK_PHASE4_PER_CARD.md` and the diff modifies any line OUTSIDE the fenced code block in "Live state", that is an IMMEDIATE STOP condition + notify owner. The permission hook should catch this before execution; this rule exists as a backstop. The mechanical signal of violation: a diff hunk whose context line includes the H1 title, any rule heading, any H2 OTHER THAN `## Live state`, or any line above the `## Live state` heading.

---

## Co-equal Rules (set 2026-06-02 — same enforcement weight as Rules 1–11 above; "co-equal" refers to authoring order, NOT enforcement priority)

**ALLOWED to fix during this pass:**

- Spec data in `cards.json` for the card being audited (filter fields, magnitude, duration, target.kind, condition.type, OPT flag, missing primitive declarations) — fix if printed text says X but spec encodes Y.
- The card's own per-card test file at `shared/engine-v2/__tests__/cards/<ID>.test.ts`.
- `BUGS_FOUND.md` entries (append-only — see entry template below).
- The Live-state footer fenced code block in this document (Rule 11).
- Additive extension of `shared/engine-v2/__tests__/cards/_fixtures.ts` (extension must be additive; no modification of existing helpers; no helper that pre-satisfies a printed condition; no helper that bypasses `EffectDispatcher` in a way that hides resolver/cost behavior; auditor hard-fails on violation).

**FORBIDDEN to fix during this pass:**

- Engine code under `shared/engine-v2/**` (handlers, filters, reducers, condition impls, target resolvers, cost handlers, `ContinuousManager`, `ReplacementManager`, etc.) — including `types.ts`, registry type unions, schema validators, or anything that would let an unsupported spec value pass `tsc`. If a spec value fails `tsc`, log a `BUGS_FOUND` engine gap; the test uses `it.fails`; do NOT widen the type.
- Engine gaps are LOGGED in `BUGS_FOUND.md` with file:line + expected vs actual + cross-card impact. Engine fixes happen AFTER all 250 cards in this pass are read + audited — in a separate dedicated pass.
- BUGS entries are append-only; a second card adding itself to an existing entry's cross-card impact list is allowed in that card's commit. Editing prior text of an existing BUGS entry is FORBIDDEN.

**Why:** a handler fix during the audit can silently break cards #1..N-1 because no per-card semantic coverage exists yet. By gathering the full bug list first, each engine fix is evaluated against full corpus impact.

---

## Scope

- **Audit unit:** cards #1 through #250 in sequence (sequential by array index in `shared/data/cards.json`). Card #251+ is OUT OF SCOPE for this pass.
- **Card #1 = EB01-001**, **Card #250 = OP01-005** (verified 2026-06-02).
- After all 250 are Rule-4-clean, STOP and notify owner. Owner decides whether to extend to #2489 in a separate pass with its own contract.

---

## What this is

A per-card audit pass against engine-v2. For each card:

1. Read the printed `effectText` in `shared/data/cards.json`.
2. Verify the spec (`effectSpecV2`) encodes that printed text correctly across 5 axes.
3. Verify the engine-v2 actually PLAYS the spec correctly by writing a per-card semantic test.
4. Fix anything wrong in the SPEC (engine fixes are logged for later).
5. Independent audit. Move on — but only after Rule 4's gate is satisfied.

This is **not** a V1 test port. The V1 tests at `shared/engine/__tests__/cards/` are out of scope; ignore them.

---

## Source of truth

- **Printed text:** `cards.json` `effectText` field per card. This is what the card says.
- **Spec:** `cards.json` `effectSpecV2` field — must encode the printed text faithfully (Rule 2).
- **Engine:** `shared/engine-v2/**` — must execute the spec correctly (NOT modified during this pass; gaps logged in `BUGS_FOUND.md`).
- **Test:** `shared/engine-v2/__tests__/cards/<ID>.test.ts` — must assert the printed-text outcome happens when the spec is dispatched (Rule 3).
- **Card uniqueness:** the audit assumes each `id` appears exactly once in `cards.json`. If a duplicate is encountered, STOP per the stop-conditions path, log in `BUGS_FOUND.md` as a data integrity bug, and notify owner. Do NOT pick one and proceed.
- **Future / leaked cards:** if a card's `effectText` references a keyword or zone or trigger not present anywhere else in `cards.json` (suggesting it's pre-release or speculative), STOP per stop-conditions and notify owner. Do NOT spec around novel keywords without confirmation that the card is legal / shipped.

**"human-reviewed" vs "ground-truth":**

- `human-reviewed` = a human (or this audit pass) has verified the spec against printed text; corrections applied. This is the normal terminal state for an audited card.
- `ground-truth` = the spec was created by a trusted authoring path (e.g., directly transcribed from official rulings) and is presumed correct without further audit. RESERVED — do not set `ground-truth` during this pass; only owner promotes a card to ground-truth. If a card arrives at this pass with `ground-truth`, still re-verify per Rule 4; if faithful, leave as `ground-truth`; if a fix is needed, demote to `human-reviewed` after fixing.

---

## Per-card workflow (numbered steps — do not skip)

For each card in order (per Rule 1a resumption + sweep rules):

### Step 1 — Locate

- Read the card entry in `shared/data/cards.json` (use `Read` with offset or `python3 -c '...json...'`).
- Capture: `id`, `name`, `kind`, `cost`, `power`, `counterValue`, `colors`, `traits`, `keywords`, `effectText`, `effectSpecV2`, and any `auditNote`.
- If the card has `verified:"flagged"` or `verified:"auto"` at root OR on any clause, that is your first thing to fix on this card (Step 3). You may NOT move past this card until it is `"human-reviewed"` or `"ground-truth"`.

### Step 2 — Read the printed effectText

- This is the source of truth for what the card does.
- Tokenize per the Rule 8 tokenization rules. Every printed token has a spec equivalent (Rule 2).

### Step 3 — 5-axis spec verification

(The five axes are listed below in this document and are the canonical definition for this pass. `TRACK_STATE.md` may carry a duplicate description for cross-reference, but if the two disagree, THIS document wins.)

For each printed line of `effectText`:

1. **Trigger axis** — `[On Play]` → `trigger: "on_play"`; `[Activate: Main]` → `"activate_main"`; `[When Attacking]` → `"when_attacking"`; `[End of Your Turn]` → `"at_end_of_turn_self"`; `[On Your Opponent's Attack]` → `"on_opp_attack"`; `[On K.O.]` → `"on_ko"`; etc. The CANONICAL trigger / condition / action / target enum names live in `shared/engine-v2/registry/types.ts` and `shared/engine-v2/spec/v2-types.ts`. If a token's mapping is not listed here, derive it from the canonical types file. If no enum member matches the printed token semantically, write the printed-token-named identifier in the spec (per Rule 7) and log an ENGINE gap in `BUGS_FOUND.md` for the missing enum member.
2. **Condition axis** — printed conditionals (`"If your Leader has X"`, `"If you have N or more rested DON"`) map to `condition.type`. Combine with `and`/`or`/`not` per the V2 spec types at `shared/engine-v2/spec/v2-types.ts` (condition combinator definitions; if the file does not document combinators, log a documentation gap in `BUGS_FOUND.md`).
3. **Magnitude axis** — printed numbers (+1000 power, KO ≤ cost 4, draw 2, etc.) match `magnitude` field as literal integers. Unit conversions correct.
4. **Target axis** — `"your character"` → `target.kind: "your_character"`; `"opp character"` → `"opp_character"`; `"any character"` → `"any_character"`; `"your leader or character"` → `"your_leader_or_character"`. Filter fields live on `target.filter` (NOT on `condition` — conditions are state-of-the-game predicates, filters are character-set predicates): `trait`, `costMax`, `costMin`, `kind`, `colors`, `nameIs`, `nameExcludes`, `active`, `rested`, `powerMin`, `powerMax`, `typeIncludes`. Canonical schema at `shared/engine-v2/spec/v2-types.ts`. Example: "your character with cost 4 or less" → `target.kind="your_character"`, `target.filter.costMax=4`.
5. **Duration/scope axis** — `"during this turn"` → `duration: "this_turn"`; `"until the start of your next turn"` → `duration: "opp_next_turn"`; `"permanently"` → `"permanent"`; `[Once Per Turn]` → `opt: true`.

**If the spec is wrong:** fix `cards.json` directly per Rule 2 + Rule 7. Update `verified` to `"human-reviewed"` once correct. If the corrected spec uses a primitive the engine doesn't support, log the ENGINE gap in `BUGS_FOUND.md` per the template below. DO NOT modify engine code.

### Step 4 — Read every V2 handler the card uses (line-by-line, no skim)

For each `action.kind` / `condition.type` / `target.kind` / `cost.<key>` / `continuous.action.kind` / `replacement.trigger` in the card's `effectSpecV2`: open the registered handler at `shared/engine-v2/registry/handlers/*.ts` and READ the implementation in full. Identify the handler's branch that executes for this card's exact input shape. Compare its behavior to what printed text says should happen. "Skim" = AUDIT FAILED.

- Registration exists.
- Handler implementation is correct for the printed semantic.
- Field reads (`inst.attachedDon` vs `inst.attachedDonRested` etc.) match V2's split schema per `shared/engine-v2/state/types.ts`.

**If a handler is missing or buggy:** DO NOT FIX. Log the gap in `BUGS_FOUND.md` per the template below. Continue the audit. Engine fixes happen AFTER all 250 cards are read + audited.

### Step 5 — Write the per-card semantic test

File path: `shared/engine-v2/__tests__/cards/<ID>.test.ts`. If a test file already exists from a prior session, FIRST read it end-to-end to extract any `BUGS_FOUND` cross-refs and prior `it.fails` comments; THEN overwrite. After overwrite, verify each `BUGS_FOUND` entry that referenced this test still has a corresponding `it.fails` (or remove the stale `BUGS_FOUND` entry with a one-line note: `stale: per-card test rewritten <date>, gap re-verified in card <ID>`). Blind overwrite without reconciliation is BANNED.

Use `shared/engine-v2/__tests__/cards/_fixtures.ts` `buildState` for setup. Each `it(...)` block MUST call `buildState(...)` afresh (or use `beforeEach`). State must NOT leak across cases.

Required imports (use all needed; remove only those the test demonstrably does not exercise; unused imports are FINE if linting tolerates):

```ts
import { buildState } from './_fixtures.js';
import { ContinuousManager } from '../../effects/ContinuousManager.js';
import { EffectDispatcher } from '../../effects/EffectDispatcher.js';
import { CostPayer } from '../../effects/CostPayer.js';
import { ReplacementManager } from '../../effects/ReplacementManager.js';
import { PhaseScheduler } from '../../phases/PhaseScheduler.js';
import { actionHandlers, targetResolvers, conditionHandlers } from '../../registry/types.js';
import { describe, it, expect } from 'vitest';
```

Test cases must include EVERY category the printed text exercises. The full list:

- **Positive cases** — when the printed condition holds, the effect fires AND the state mutation matches the printed outcome (specific values).
- **Negative cases** — when a printed gate fails, the effect does NOT fire.
- **Boundary cases** — at the cost cap, at the power threshold, at the life threshold.
- **Duration cases** — buffs clear at the correct moment per `duration` (run `PhaseScheduler.enterEnd` or transition to verify).
- **OPT cases** if applicable — second dispatch in same turn must not fire.
- **Continuous** — if a continuous entry exists, call `ContinuousManager.refold(state)` and assert the gated modifier.
- **Replacement** — if a replacement entry exists, exercise via `ReplacementManager.tryReplace`.

For each category, write the case ONLY if the printed text exercises it. A "[On Play] Draw 1." card requires only the positive case + (if `[Once Per Turn]` is absent) NO OPT case. Fabricating negative / boundary / OPT cases that don't reflect printed text is BANNED — it's the inverse of Rule 2.

Always prefer dispatching through the highest-level engine entry point that exercises the spec:

- `EffectDispatcher.dispatch(state, ctx, trigger)` for clause triggers — runs condition + target resolver + cost + action in order.
- `ContinuousManager.refold(state)` for continuous effects.
- `CostPayer.canPay` / `CostPayer.pay` for cost handlers — only when isolating cost behavior.
- `actionHandlers.get(kind)(state, ctx, action, targets)` only when intentionally bypassing the resolver for a `[isolated handler]` test. EXCEPTION: `[isolated handler]` tests are valid IF AND ONLY IF the test name contains `[isolated handler]` AND the test is paired with at least one dispatcher-based test for the same clause; the isolated test then asserts handler behavior in a contrived state that the dispatcher would refuse to set up. Auditor hard-fails if `[isolated handler]` tests are not paired with a dispatcher test.

### Step 6 — Run the test

Run in this order:

1. `npx vitest run shared/engine-v2/__tests__/cards/<ID>.test.ts --reporter=verbose` — this card's test must pass (or pass + documented `it.fails` per Rule 7a).
2. `npx vitest run shared/engine-v2/__tests__/cards/ --reporter=dot` — full per-card suite must not introduce new red. Pre-existing `it.fails`-marked failures remain; previously-green tests must still be green.

If step 2 reveals new red on another card caused by this card's spec edit, the edit is incorrect: revert the offending field, re-derive the encoding, retry. Do not advance.

### Step 7 — Failure handling (NO SHORTCUTS — read this every time)

When a test fails:

1. **Diagnose:** read the failing line + the handler/resolver/condition impl at `shared/engine-v2/**`. Cite file:line.

2. **Classify (in order — (0) is the default for cases where the Rule 8 bijection has NOT been validated; once the bijection holds, paths (a)/(b)/(c) take over):**

   **Verification gate before path (0):** before classifying as (0), re-derive the Rule 8 bijection from `effectText` and the current `effectSpecV2`. If the bijection holds (every printed token has its spec field, every spec field has its printed source, counts match), this is NOT path (0); the spec is already faithful — proceed to (a)/(b)/(c). If the bijection fails, this IS path (0): the spec is wrong for printed text.

   - **(0) Spec is wrong for printed text** — the Rule 8 bijection fails: a printed token has no spec encoding, OR a spec field has no printed source. FIX the spec in `cards.json` per Rule 2 + Rule 7 (axis-faithful encoding, no engine excuses). Re-run vitest. The burden is on the agent to prove the SPEC encodes printed text wrong — not to prove the test is wrong.
   - **(a) Test assertion is wrong for V2's correct behavior** — e.g., V2 split `attachedDon` into active vs `attachedDonRested`. THIS PATH REQUIRES: (i) cite the V2 schema source (`state/types.ts:LINE`) showing the field rename; (ii) cite the CR rule or printed-text clause that confirms V2's behavior matches printed semantics; (iii) write the corrected assertion with a comment of the form `// V2 schema: <file>:<line>; printed text: "<quote>"`; (iv) the audit sub-agent MUST independently verify (i) and (ii) by reading those file:line citations. If the agent cannot produce both citations, this is NOT path (a) — it is path (b).
   - **(b) V2 engine has a bug** — handler doesn't fire on_play, formula doesn't compute, condition check is inverted, etc. STOP. Log in `BUGS_FOUND.md` per the entry template (including verbatim vitest output snippet in "Actual" field per Rule 7a) with file:line, expected vs actual, repro from this card. Switch the offending `it` to `it.fails` per Rule 7a. DO NOT modify engine.
   - **(c) Wrong entry point** — handler-direct call bypassed the target resolver's filter for a case where the resolver matters. Re-write the test to use `EffectDispatcher.dispatch`. See the `[isolated handler]` exception in Step 5.

3. **Forbidden:**

   - Deleting the failing test.
   - Replacing behavioral assertion with `expect(spec.foo).toBe(bar)` spec-shape check.
   - `it.todo` / `it.skip` / `describe.skip` / `xdescribe` / commented-out blocks.
   - Lowering OR widening any assertion's specificity: e.g., `.toBe(1000)` → `.toBeDefined()` / `.toBeGreaterThan(0)` / `.toBeGreaterThanOrEqual(N)` / `.toBeTruthy()` / `.not.toBeUndefined()`; `.toEqual({a:1,b:2})` → `.toEqual(expect.objectContaining({a:1}))`; `.toHaveLength(3)` → `.toHaveLength(expect.any(Number))`. Every assertion MUST be the tightest expression of the printed-text outcome.
   - try/catch around dispatch to swallow throws.
   - if/return early-exits inside `it()` blocks.
   - `expect.assertions(0)` or removing all `expect()` calls.
   - Narrowing `buildState` so the printed gate can't be exercised.
   - Silently moving a behavioral assertion's value to a separate "spec shape" `it()` to pretend the behavioral one was already done.
   - Any other technique that causes vitest to report green without observing the printed effect.
   - "Deferred for follow-up" comments.
   - Skipping the card "because it's complex".

   The principle: *if the test ran without exercising the printed effect, that is a shortcut.* If you are unsure whether a maneuver is a shortcut, it is.

4. **After fix:** re-run vitest. If pass, proceed. If fail, loop steps 1–3. If the same failure recurs after 3 fix-attempts (test still red on attempt 4), STOP, treat as "cannot be made faithful without owner clarification" (stop conditions below), notify owner with: (a) the failing assertion, (b) the printed text it reflects, (c) the engine behavior observed, (d) the 3 attempted fixes and why each failed.

### Step 8 — Audit the test

Launch an independent Code Reviewer sub-agent (per Rule 5 tool budget) using the Rule 9 canonical prompt verbatim. Rule 9 is the single source of truth for audit hard-fail conditions; this step does not redefine them.

If `AUDIT FAILED`, apply the audit's fix list and re-audit until clean (bounded by Rule 5a's 3-attempt cap). Do not move to the next card.

Every audit verdict (PASS or FAIL with reasons) is appended to `BUGS_FOUND.md` under an "Audit log" section as a one-line entry: `<ISO timestamp> <ID> <verdict> [<reason summary if FAIL>]`. This append is durable state for resumption (Rule 1a), not a commit (Rule 6).

### Step 9 — Card-complete gate (Rule 4) before moving on

Re-verify all 6 conditions of Rule 4. Step 9 is a confirmation pass; the verified flags and auditNote state should already be set correctly by Steps 3 and 5. If any condition fails, return to the relevant step. If all pass, this card is Rule-4-clean. Update the Live-state footer fenced block with the new clean count + list. Move to the next card. Do NOT touch any file for the next card until you have re-started at Step 1 for it.

---

## Output deliverables (across the run)

- **N new/overwritten files:** `shared/engine-v2/__tests__/cards/<ID>.test.ts` (one per Rule-4-clean card; up to 250 max for this pass). A partial pass produces fewer files; this is expected and acceptable per Rule 6's checkpoints.
- **`BUGS_FOUND.md`** at `/Users/minamakar/Developer/optcgsandbox/BUGS_FOUND.md` (absolute path to avoid CWD ambiguity) — chronological log of engine + spec bugs surfaced during the audit. Each entry must use the canonical template (see below).
- **Spec edits in `cards.json`** — every Rule-4-clean card produces at minimum a verified-flag change (auto/flagged → human-reviewed); semantic edits to clauses/triggers/conditions/actions/targets/duration/opt are applied as Rule 2 + Rule 7 require. The "no semantic change needed, only verified flip" case IS still a Rule-4-clean delivery.
- **`_fixtures.ts` diff** (if extended) — shown alongside the card whose test triggered the extension; audited per the Co-equal Rules' fixture constraint.
- **`TASK_PHASE4_PER_CARD.md` Live-state footer (fenced block only)** — updated after EVERY Rule-4-clean card, in the same turn as the card's completion. Edits OUTSIDE the fenced block trigger Rule 11.
- **BUGS_FOUND.md row count** — the cumulative entry count is reported in every checkpoint summary; missing reports = checkpoint not delivered.
- **No commits** unless owner explicitly says "commit". The agent's job is to produce the work; commit is owner-controlled (Rule 6).

### BUGS_FOUND.md entry template (canonical)

Every entry MUST use this format exactly:

```md
### <YYYY-MM-DD HH:MM> — <card ID> — <one-line bug title>

- **Card:** <ID> (cards.json id only — no array-index field; indices drift as cards are added/reordered)
- **Surfaced by test:** shared/engine-v2/__tests__/cards/<ID>.test.ts:<line>
- **Bug location:** <repo-relative path>:<line>
- **Expected (per printed text):** <quote effectText, then what the engine SHOULD do>
- **Actual (per engine read + vitest output):** <what the engine DOES do, INCLUDING a verbatim vitest output snippet of the failing assertion: file path, line number, expected vs received values, AssertionError or Error trace summary>
- **Repro (minimal):** <inline code snippet or fixture state>
- **Cross-card impact:** <N other cards that use the same primitive — list IDs if known, else "TBD during sweep">
- **Test status this pass:** it.fails referencing this entry — OR — passes (data-only fix)
```

The auditor (Rule 9) hard-fails any cited `BUGS_FOUND` entry that omits any required field, including the verbatim vitest output snippet in the "Actual" field (Rule 7a evidence requirement). "Fix applied" and "after test result" are OUT OF SCOPE for this pass — they get filled in during the post-audit engine-fix pass.

---

## Constraints

- **NO SHORTCUTS.** Per global CLAUDE.md §4 "Anti-Patterns" and the inlined Step 7 "Forbidden" list. Owner will catch any.
- **NO V1 test reading** — V1 tests at `shared/engine/__tests__/cards/` are out of scope. Use `effectText` as source of truth.
- **Permission hook** — Edit/Write tool calls require relay-back to the owner BEFORE execution in the format: What / Files / Risk / May I proceed? (One paragraph max). This rule is inlined from global CLAUDE.md for durability. Per-turn batching is allowed ONLY within a single card (multiple Edit/Write calls to that one card's files in one relay-back). Cross-card batching is BANNED per Rule 1. If the permission cadence makes a single card take many turns, that is acceptable; cadence never justifies cross-card batching.
- **Vitest invocation** — the harness must allow `npx vitest run shared/engine-v2/**` without per-call permission prompts; if it doesn't, request a standing Bash permission once at the start of the pass ("Approve all `npx vitest run shared/engine-v2/...` Bash calls for this pass"). NEVER skip a vitest run because of permission friction.
- **Existing engine state** — engine fixes shipped on or before 2026-06-02 (commits `ba25147` and `91092c9`, plus any subsequent fixes merged on main before this pass started) are baseline. Do NOT revert. (Sub-agents do NOT need to verify commit contents; the orchestrator carries the baseline assumption.)
- **Existing fixtures** at `shared/engine-v2/__tests__/cards/_fixtures.ts` — reuse. If extension is needed, follow the rules in the Co-equal Rules section.
- **Git access (orchestrator only)** — orchestrator may use `git status`, `git stash list`, `git stash push -m "phase4 wip <ID>"`, `git stash show -p`, and `git diff <path>` (only on the current card's files). NEVER use destructive git commands (`checkout` / `reset` / `restore` / `revert`) per global CLAUDE.md §8. Auditor's git access is restricted further per Rule 5 (no git at all).
- **Repo isolation** — this protocol applies ONLY to `/Users/minamakar/Developer/optcgsandbox/`. Conventions from sibling repos (`crew-builder`, `ich-grader`, etc.) DO NOT carry over. The `crew-builder` CLAUDE.md may appear in session context but is not authoritative here.
- **Spec vocabulary sources** — the ONLY sources of spec vocabulary are: (i) the printed `effectText`, (ii) the OPTCG comprehensive rules. Prior agent summaries, conversation history, `BUGS_FOUND` prose, and sister-card specs are NOT vocabulary sources for the current card's spec.

---

## Stop conditions (precedence-ordered — highest first)

When multiple stop conditions fire simultaneously, the **higher-precedence** condition's path wins.

1. **Context/token exhaustion mid-card (HIGHEST PRECEDENCE)** → STOP, update the progress footer fenced block with the in-progress card ID, save any uncommitted spec edits to a local stash (`git stash push -m "phase4 wip <ID>"`), notify owner with: (a) which card, (b) which step (1–9), (c) what remains. Do NOT auto-commit partial work; do NOT mark the card clean prematurely. Next session resumes per Rule 1a (which will also pop or evaluate any stash). This precedence is highest because exhaustion forces a process boundary — all other STOP paths assume the agent has the budget to file a notification, which exhaustion may not allow.
2. **Audit fail-loop hits Rule 5a 3-consecutive-attempt cap** → "cannot be made faithful" path; notify owner with the 3-attempt reasons.
3. **Step 7 fix-loop hits 3-attempt cap** → "cannot be made faithful" path; notify owner with the 3 attempted fixes.
4. **A card cannot be made faithful without owner clarification** on printed text intent → log + notify owner. Do NOT skip and move on. Stay on the card. Specifically: pause all per-card work, post the question to owner in the relay-back format, then idle (no other audit work, no skip-ahead) until owner replies. If a separate, unrelated task is requested by owner mid-pause, the pause is suspended for that task and resumed on return. Never advance past the blocked card.
5. **5+ multi-module engine bugs** filed in `BUGS_FOUND.md` whose root cause spans more than one engine module (e.g., handler + resolver + reducer for the same primitive), suggesting a structural engine deficit rather than localized misses → notify owner; await triage. The trigger is mechanical: count distinct directory paths in `shared/engine-v2/**` referenced by `BUGS_FOUND` entries since the last checkpoint; if ≥3 distinct directories across ≥5 entries, stop.
6. **Mistranscribed effectText / leaked card / duplicate ID** → log + notify owner; do not modify the suspect data.
7. **Rule 11 tripwire fired** (orchestrator attempted to edit `TASK_PHASE4_PER_CARD.md` outside the Live-state fenced block) → IMMEDIATE STOP + notify owner.
8. **All 250 cards Rule-4-clean** → notify owner; await direction (continue to #2489 OR stop). Report the count of pending `it.fails` cases separately at this stop.

Any STOP condition supersedes the Rule 6 checkpoint cadence. After owner resolves a STOP, the next checkpoint is the next multiple-of-50 Rule-4-clean count (50/100/150/200/250), not a fresh count from current.

---

## Read-receipt requirement

At the start of every session (fresh OR resuming), the orchestrating agent's FIRST relay-back to the owner MUST be: *"Read TASK_PHASE4_PER_CARD.md (v4.1) in full; current card per Rule 1a = <ID>; Rule 10 standing approval re-request: approve per-card audit launches for this session?; ready to proceed."* No work begins until owner replies "go" AND grants Rule 10 standing approval. This receipt is the only durable signal that the contract was internalized.

---

## Why this exists

- Prior session: replaced behavioral tests with spec-shape assertions (EB01-013 and EB01-014). Caught by owner.
- Current session: drifted into batching test-writes (cards 18–23, 25–30, etc.) and writing shape-only tests around card #73 onward to keep pace. Walked past `verified:"flagged"` cards (EB02-045, EB02-053). Caught by owner.
- 2026-06-03: agent caught lowering the bar from "100% axis-faithful" to "best the engine supports today" on EB02-011, EB02-015, EB02-021, EB02-052. Rules 7, 7a, 8, 9, 10 and Gaps 1–100 audit closeout added (v4.0).
- 2026-06-03 second pass: verification audit found 20 new gaps in v4.0 (8 mechanical blockers). v4.1 closes them: Bijection regex tolerates JSDoc multi-space indent, Step 8 of Rule 9 uses object dereference not grep, auditNote null-guarded, Rule 5a is now any-reason 3-strike, Live-state mutation scope locked to fenced block (Rule 11), Rule 10 revoked on session resume, Step 7 path (0) gated by bijection-fail check, Rule 7a requires vitest output evidence in BUGS_FOUND, `you may` tokenization resolved, banned-phrase regex word-boundary-anchored, BUGS_FOUND template drops drifting array-index field, self-audit ban moved to Rule 5 (orchestrator-enforced), auditor git access narrowed to none, STOP precedence ordered, audit-log mid-pass clarified as not-a-commit.
- The audit was passing in batch summaries because the audit prompt described "matches what I told you" rather than "independently re-read every card's printed text and spec". Rule 5 + Rule 9 + Step 8 fix that.

Original failure traces are preserved in git history: `git log --all --grep "EB01-013\|EB01-014\|EB02-045\|EB02-053\|EB02-011\|EB02-015\|EB02-021\|EB02-052"` and in `BUGS_FOUND.md` entries dated before 2026-06-03. Fresh agents SHOULD read at least one prior shortcut to internalize the failure mode.

If you are reading this as a fresh agent: the rules in the rules sections (Rules 1–11 + Co-equal Rules) override any chat-context drift. They are durable. The owner WILL catch deviations.

**Fresh-agent quickstart:**

1. Read this doc end-to-end (no skim).
2. Send the read-receipt to owner (including Rule 10 standing approval re-request).
3. Await "go" + Rule 10 approval.
4. Run the skipped-card sweep (Rule 1a).
5. Open the lowest-index card with `verified ≠ "human-reviewed"/"ground-truth"` OR with `auditNote` not prefixed `RESOLVED:` OR the next card after the highest Rule-4-clean ID in the Live-state footer.
6. Execute Steps 1–9 for that card.
7. Update the Live-state footer fenced block (Rule 11).
8. Move to next card.

If at any step the doc disagrees with itself or with reality, STOP and notify owner — do not improvise.

---

## Live state

This section's H2 heading, this introductory sentence, and the fenced code block delimiters below are FROZEN. The ONLY content the orchestrating agent may mutate during the pass is the body inside the fenced code block. Editing outside the fence triggers Rule 11.

Update the block after EVERY Rule-4-clean card, in the same turn as the card's completion.

```
- Cards audited Rule-4-clean: 0 / 250 — list of clean IDs in order: []
- Card in progress (singular per Rule 1): —
- Cards needing owner clarification (Step 7 fix-loop max, Rule 5a audit-loop max, Stop conditions): []
- Bugs filed (cumulative): 0 — last entry title: —
- Last card touched: —
- Last update: —
```
