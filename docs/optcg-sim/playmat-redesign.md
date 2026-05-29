# OPTCG Sim — Playmat Redesign (UX Architect Authoritative Spec)

**Status:** Authoritative ground truth for the full two-player playmat. Supersedes piecewise edits made 2026-05-29. Replaces nothing in `rules-reference.md` (engine truth) and EXTENDS `design-reference.md` (zone truth) + `visual-design-spec.md` (DON card, modal, fan math, placeholder anatomy) with the missing pieces: leader card anatomy, character/event/stage anatomy, two-player layout truth derived from the owner reference image, edge-padding budget at exact dvh values, end-turn phase contract, and a per-zone implementation hand-off table.

**Frame:** mobile-first portrait, 430 × 100dvh letterbox. Inner working width 398px (430 − 32 padding L/R). Inner working height 100dvh minus top safe-area minus bottom safe-area.

**Sources consulted:**
- `docs/optcg-sim/rules-reference.md` — Comprehensive Rules summary with [CR §X-Y] citations
- `docs/optcg-sim/design-reference.md` §§1–12 — zone truth, divergence list, MOOgiwara reference
- `docs/optcg-sim/visual-design-spec.md` §§1–4 — DON card, modal panel, fan math, placeholder anatomy
- `/Users/minamakar/Downloads/playsheet.pdf` — official Bandai single-player playmat
- `/Users/minamakar/Downloads/rule_manual.pdf` pp.1–4 — leader / character / event / stage / DON anatomies
- Owner reference image of full two-player playmat (table-view) — geometry ground truth for §1 below
- Current code: `src/components/PlayfieldStage.tsx`, `src/components/HandFan.tsx`, `src/components/CardArt.tsx`, `src/components/CardDetailModal.tsx`, `src/components/zones/*`, `src/index.css`, `src/App.tsx`

**Hard NOs (re-stated; do not propose any of these):**
- No felt-green playmat surface. Cream paper only.
- No DON pills / chips / tokens. DON are real cards rendered with `+1000` art.
- No two-step lift-then-tap-again to open card detail. Single tap = modal.
- No card-ID text labels ("red-5-2") rendered as card art.
- No sliver-bar / battery-cell rendering of the life stack. Real card backs, physically stacked.
- No content past the 430px letterbox or under the notch. Verify 390×844 + 430×844.
- No wordmark "ONE PIECE CARD GAME" anywhere — trademark. Use "CREW SIM".
- No bumped dimensions that overflow the letterbox or shift the layout footprint.
- No tap-on-life-stack reveal — life is secret per CR §3-10-2 except via `LifeRevealOverlay` + `TriggerPrompt`.

---

## §1. Layout Ground Truth (Owner Reference Image)

The owner's reference image shows two single-player Bandai playmats placed mouth-to-mouth on a wooden table: bottom player upright, top player rotated 180° so the top player's CHARACTER AREA banner reads upside-down from the bottom player's POV. This is the physical-table convention. The on-screen mobile playmat MUST follow this convention so a player who has handled the cardboard mat immediately reads the screen.

### 1.1 Zones present in the reference image, bottom (upright) player

Reading from bottom-edge upward, then left-to-right inside each band:

| Z# | Zone | Visual on reference image | Engine state field |
|----|------|---------------------------|--------------------|
| Z1 | LIFE column | Far-LEFT vertical column. 5 face-down card slots stacked. "LIFE" white wordmark at the top of the column on the cardboard mat (we omit the mat wordmark — the column IS the label) | `players[X].life: string[]` |
| Z2 | DON DECK slot | Bottom-LEFT corner, single card-back slot. The "DON!! DECK" white wordmark sits centered on the slot in the cardboard mat. We render the slot with the TEAL compass back and the small brass count chip; no wordmark text on the slot itself | `players[X].donDeck: string[]` |
| Z3 | COST AREA band | Wide bottom-center band, between DON DECK (left) and TRASH (right). Hosts all active + rested DON face-up. "COST AREA" wordmark centered when empty | `players[X].donCostArea: string[]` + `donRested: string[]` |
| Z4 | TRASH slot | Bottom-RIGHT corner, single card-sized slot. "TRASH" white wordmark centered | `players[X].trash: string[]` (top index = last) |
| Z5 | PHASE column | Mid-band, just LEFT of the leader. Vertical column of 5 phase chips: Refresh → Draw → DON!! → Main → End | `state.phase` |
| Z6 | LEADER slot | Mid-band, single card slot, centered horizontally between Phase column and Stage slot. The reference image shows a face-up Monkey D. Luffy with the printed life pill "5000" + STRIKE attribute marker top-right, "LEADER" black band + name across the bottom, and "5" red life-square bottom-left | `players[X].leader: CardInstance` |
| Z7 | STAGE slot | Mid-band, single card slot, immediately RIGHT of leader | `players[X].stage: CardInstance \| null` |
| Z8 | DECK slot | Mid-band, FAR-RIGHT single card slot (face-down navy back). Note: in the reference image the deck slot in the mid-band is the rightmost zone of that row | `players[X].deck: string[]` |
| Z9 | CHARACTER AREA | Top band of the bottom player's half, wide horizontal. Up to 5 character slots, played face-up | `players[X].field: CardInstance[]` (max 5) |
| Z10 | HAND | NOT printed on the cardboard mat. Renders on-screen below the playmat as a fan that overlays the screen's bottom strip | `players[X].hand: string[]` |

### 1.2 Two-player composition

The top player's identical playmat is rotated 180°. After rotation, the top player's far-LEFT LIFE column ends up on the bottom player's TOP-RIGHT corner. Their CHARACTER AREA band lands directly above the bottom player's CHARACTER AREA, with their LEADER row above that, and their FAR row (DON DECK / COST / TRASH) at the very top of the screen.

This means on our 430×100dvh phone canvas:

```
TOP edge
   ── safe-area-top ──
   APP CHROME (mode toggles + title + theme toggle)
   ─────────────────────────────────────────────
   OPP FAR ROW          [DON Deck] [Cost Area] [Trash]
   OPP LEADER ROW       [Phase ↑] [Deck] [Stage] [Leader] [LIFE col on right]
   OPP CHARACTER ROW    [5 slots, facing DOWN]
   ═══════════ CONTACT ZONE (brass hairline glow) ═══════════
   YOU CHARACTER ROW    [5 slots, facing UP]
   YOU LEADER ROW       [LIFE col on left] [Phase] [Leader] [Stage] [Deck]
   YOU FAR ROW          [DON Deck] [Cost Area] [Trash]
   ─────────────────────────────────────────────
   HAND FAN (overlays bottom strip)
   END-TURN button (bottom-right corner inside hand strip)
   ── safe-area-bottom ──
BOTTOM edge
```

The opp's LIFE column visually lands on the top-RIGHT because their entire half is rotated 180°. Inside their rotated half their LIFE column is on the far-LEFT — exactly mirroring the table-view reference image.

### 1.3 Exact vertical budget at 430×844 (iPhone 13/14/15 sim baseline)

100dvh = 844px on a typical iPhone (no Dynamic Island compensation). Budget MUST sum to 100dvh; no rows may push the layout off-screen.

| Band | dvh | px at 844dvh | Contains |
|---|---|---|---|
| Safe-area top + status bar | env(safe-area-inset-top) | ~47 | iOS notch / Dynamic Island |
| App chrome | 6dvh | 50.6 | Mode toggles + app title + theme toggle |
| OPP far row | 8dvh | 67.5 | DON Deck (36×50) + Cost Area band + Trash (52×72) |
| OPP leader row | 12dvh | 101.3 | Phase column + Leader (60×84) + Stage (52×72) + Deck (52×72); LIFE column overlays the left of their CHARACTER row |
| OPP character row | 11dvh | 92.8 | 5 character slots at 52×72 |
| Contact zone | 1dvh | 8.4 | Brass-canary hairline + glow |
| YOU character row | 11dvh | 92.8 | 5 character slots at 52×72 |
| YOU leader row | 12dvh | 101.3 | Phase column + Leader (60×84) + Stage (52×72) + Deck (52×72); LIFE column overlays the left |
| YOU far row | 8dvh | 67.5 | DON Deck + Cost Area + Trash |
| Hand fan strip | 24dvh | 202.6 | Fan-of-cards overlay (cards 64×88) + End-Turn button |
| Safe-area bottom | env(safe-area-inset-bottom) | ~34 | iOS home indicator |
| **Sum (excluding safe area)** | **93dvh** | **784.8** | 7dvh ≈ 59px reserved for safe-area inset compression |

**At 844dvh with typical 47+34=81px safe area:** layout consumes 844 − 81 = 763px. Allocation above consumes 784.8px — overshoots by ~22px. Mitigations (applied automatically):
- Reduce OPP far row to 7dvh + YOU far row to 7dvh (saves 16.8px), or
- Reduce hand-fan strip to 22dvh (saves 16.8px). 22dvh is the floor per design-reference §3.4.

On 390×844 the inner width is 358px (390 − 32 padding); zone widths must accept this floor. See §2 widths.

### 1.4 LIFE column placement clarification

Two interpretations were live before this spec:

- **Interpretation A (design-reference §2):** LIFE column is its own grid column on the far-LEFT of the playmat, full-height of the player's half. Field zones live in a second column to its right. This is the literal Bandai cardboard layout.
- **Interpretation B (current code in `PlayfieldStage.tsx` lines 354–396):** LIFE column is a 32px-wide left column, with all 3 rows (CHARACTER / LEADER / FAR) in the right column. The opp half is rotated 180° as one unit.

**This spec ratifies Interpretation B.** It matches the current `PlayfieldStage.tsx` row structure and produces the correct visual after 180° rotation. The LIFE column hugs the inside-left of the player's half, in front of the leader row vertically, with its 5 face-down cards stacked. No change to `PlayfieldStage.tsx` row order required.

---

## §2. Zone-by-Zone Visual Spec

Every zone has: ASCII mockup at exact dimensions, token table (size/color/font/border/shadow), empty vs occupied state, active vs rested state where applicable, and aria-label pattern.

Card dimensions referenced throughout (already in `src/components/CardArt.tsx`):

| Size key | W × H | Used for |
|----------|-------|----------|
| `hand` | 64 × 88 | Hand fan cards |
| `field` | 52 × 72 | Character slots, Stage, Deck, Trash top card |
| `leader` | 60 × 84 | Leader card (scaled 1.15× via `--zone-leader-scale`) |
| `modal` | 220 × 308 | CardDetailModal scaled card view |
| `mini` | 28 × 40 | Small previews (unused on playmat) |
| `lifeStack` | 24 × 34 | Life cards in the LIFE column |

### 2.1 Z1 — LIFE column

**Geometry:** 32px-wide vertical column hugging the inside-left of each player's half. Spans the visible height of the LEADER + CHARACTER rows (≈23dvh ≈ 194px). Cards stacked top-to-bottom with 4px overlap; max 5 visible cards. Top card has highest z-index.

```
 width 32px
 ┌────┐  ← LIFE column inside-left of player's half
 │┌──┐│   card 24×34, navy back
 │└──┘│   peek 4px between cards
 │┌──┐│   max 5 stacked
 │└──┘│   brass count chip top-right of stack
 │┌──┐│   no "LIFE" text label (column position = label)
 │└──┘│
 │┌──┐│
 │└──┘│
 │┌──┐│
 │└──┘│
 └────┘
```

**Tokens:**

| Element | Value |
|---------|-------|
| Column width | 32px (already `--zone-life-col-w` per `index.css` lines 46, 57) |
| Card W × H | 24 × 34 (lifeStack in `CardArt.tsx:32`) |
| Stack overlap | 4px (each card sits 4px below the one in front; total stack ≈ 50px for 5 cards) |
| Card back | NavyCardBack (hull-deep ground + brass-canary compass + "CREW SIM" wordmark in 0.5rem Lilita One) per `NavyCardBack.tsx` |
| Count chip | bottom-right of stack, 0.7rem Lilita One ink-black on brass-canary, ring-1 ink-black/30, padding 1.5×0.5px |
| Empty state | Dashed border 1px marine-fog/40, 24×34 ghost slot at column top, with "Life" 0.55rem Nunito uppercase ink-iron below it |
| Aria | `role="region" aria-label="Your life: ${count}"` (or "Opponent life:") |

**Active vs rested:** N/A — life cards are not active/rested.

**Interaction:** **No tap handler.** Life is SECRET per CR §3-10-2. Reveal is engine-driven only via `LifeRevealOverlay` (top card flips with `layoutId` shared-element transition to hand).

**Status:** Currently shipped in `LifeStack.tsx` — no changes required.

### 2.2 Z9 — CHARACTER AREA

**Geometry:** Full-width horizontal band, 5 equal slots. Inner row width 398 − (life column 32 + gap 8) = 358px. 5 slots × 52 + 4 × gap = 260 + 32 = 292px → fits with 33px slack at each end for the "wide horizontal banner" feel.

```
 ┌────────────────────── 358px wide ──────────────────────┐
 │  ┌────┐  ┌────┐  ┌────┐  ┌────┐  ┌────┐               │  ← 5 character slots
 │  │ 52 │  │ 52 │  │ 52 │  │ 52 │  │ 52 │  72 tall      │     each 52×72
 │  │ ×72│  │ ×72│  │ ×72│  │ ×72│  │ ×72│               │
 │  └────┘  └────┘  └────┘  └────┘  └────┘               │
 └────────────────────────────────────────────────────────┘
   gap 8px (Tailwind gap-2) between slots
```

**Tokens:**

| Element | Value |
|---------|-------|
| Band height | 11dvh ≈ 93px (allows 72px card + 21px breathing) |
| Slot W × H | 52 × 72 (field size in `CardArt.tsx:28`) |
| Slot gap | 8px (Tailwind `gap-2`); use Tailwind grid `grid-cols-5` per `PlayfieldStage.tsx:163` |
| Empty slot | Dashed 1px marine-fog/40, radius 4px, transparent fill |
| Slot hit-box | Full 52×72 (≥44px both axes; meets WCAG touch target) |
| Active card visual | See §3.2 (Character anatomy) |
| Rested card | `transform: rotate(90deg)`, opacity 0.82, transform-origin center (NOT bottom-left — characters rotate in place) |
| Aria (band) | `role="region" aria-label="Character area, 5 slots"` |
| Aria (slot) | implicit via `<ZoneSlot kind="character" playerId={x} index={i}>` |

**Empty state:** 5 ghost dashed slots. No "CHARACTER AREA" wordmark on cream playmat (the row position is the label; the wordmark on the Bandai cardboard mat would compete with our cream tone). For accessibility the band still carries `aria-label="Character area, 5 slots"`.

**Active vs rested:** All field cards have an active (upright) and a rested (rotated 90° in place) state. Visual treatment is on the card art (§3.2) not the slot.

**Highlight states:**
- `donDropTarget` (friendly card, DON armed): pulsing `box-shadow: 0 0 0 2px var(--color-sun-brass)` 1s ease-in-out loop
- `pendingTarget` (opp card, attacker selected, legal target): pulsing `box-shadow: 0 0 0 2px var(--color-seal-red)` with dashed treatment
- `selectedAttacker` (friendly card chosen as attacker): `outline: 2px solid brass; outline-offset: 2px`, `transform: translateY(-8px) scale(1.05)`

These are already wired in `CardArt.tsx:546–588`. No changes.

### 2.3 Z6 — LEADER slot

**Geometry:** Single 60×84 card slot, scaled 1.15× to ~69×96, centered in the leader row between the Phase column (left) and the Stage slot (right).

```
 ┌────── 69 ──────┐
 │                │
 │  ┌──────────┐  │
 │  │  LEADER  │  │  ← scaled 1.15× from 60×84 base
 │  │   CARD   │  │     (var(--zone-leader-scale))
 │  │   art    │  │
 │  └──────────┘  │
 │                │  ← floating life pill on top edge
 │     ●5         │     brass-canary or seal-red ring,
 │                │     0.95rem Lilita One ink-black
 └────────────────┘
```

**Tokens:**

| Element | Value |
|---------|-------|
| Slot W × H base | 60 × 84 (leader size in `CardArt.tsx:30`) |
| Scale factor | 1.15× via inline `transform: scale(var(--zone-leader-scale, 1.15))` (already wired in `PlayfieldStage.tsx:203`) |
| Card visual | See §3.1 (Leader anatomy) — gets a 4px brass frame to read as "more important" than characters |
| Life pill | Floats `-top-3 left-1/2 -translate-x-1/2 z-10`, bg cream + ring-2 seal-red, px-2 py-0.5 rounded-full, 0.95rem Lilita One ink-black tabular |
| Aria | `aria-label="${leaderCard.name} (leader)"` |

**Empty state:** N/A — leader is always present (one-shot at game start, locked per CR §3-6-3).

**Active vs rested:** Leader CAN be rested (attack from leader rests it per CR §7-1-1-1). Visual: same in-place 90° rotation as characters, opacity 0.82.

**Highlight states:** Same as character (selectedAttacker / donDropTarget / pendingTarget).

### 2.4 Z7 — STAGE slot

**Geometry:** Single 52×72 card slot immediately right of the leader. Max 1 stage per CR §3-8-5.

```
 ┌── 52 ──┐
 │        │
 │ STAGE  │  ← face-up stage card or
 │   art  │     ghost dashed slot
 │        │
 │   72   │
 └────────┘
```

**Tokens:**

| Element | Value |
|---------|-------|
| Slot W × H | 52 × 72 (field size) |
| Card visual | See §3.4 (Stage anatomy) — body tint slightly desaturated `filter: saturate(0.92)` so stages read as lower-energy than characters |
| Empty state | Dashed 1px marine-fog/40, radius 4px, with centered "STAGE" 0.5rem Nunito uppercase ink-iron/55 |
| Aria (empty) | `role="region" aria-label="Stage area, empty"` |
| Aria (occupied) | `aria-label="Stage: ${card.name}"` |

**Active vs rested:** Stage CAN be rested (some `[Activate:Main]` stage effects rest the stage). Visual: rotated 90° in place, opacity 0.82.

**Status:** Currently rendered by `StageSlot.tsx`. Empty state text label needs adding (currently empty); see hand-off §10.

### 2.5 Z8 — DECK slot

**Geometry:** Single 52×72 face-down card slot, far-right of the leader row.

```
 ┌── 52 ──┐
 │ ▓▓▓▓▓▓ │  ← navy compass back (`NavyCardBack`)
 │ ▓ ⊙  ▓ │     brass-canary compass + "CREW SIM"
 │ ▓CREW▓ │
 │ ▓SIM▓  │     bottom-right count chip
 │ ▓  ▓ 50│     cream-on-paper, 0.7rem Lilita One ink
 └────────┘
```

**Tokens:**

| Element | Value |
|---------|-------|
| Slot W × H | 52 × 72 |
| Card back | `NavyCardBack` (hull-deep ground + brass-canary compass + "CREW SIM" 0.5rem Lilita One letter-spacing 0.08em) — already in `NavyCardBack.tsx` |
| Count chip | bottom-0.5 right-0.5, bg cream/95 px-1 py-px rounded-sm, 0.7rem Lilita One tabular ink-black, shadow 0 1px 2px ink-black/35 |
| Aria | `aria-label="${owner} deck — ${count} cards remaining"` |

**Empty state:** When deck count = 0, render the dashed ghost outline + "DECK 0" microtype. (CR §1-2-1-1-2: empty deck triggers loss; this state should never be visible long.)

**Status:** Currently shipped in `DeckSlot.tsx` — no changes required.

### 2.6 Z2 — DON DECK slot

**Geometry:** Single 36×50 card slot in the bottom-LEFT of each half's far row. Smaller than other slots — DON deck slot on the Bandai cardboard mat is visually narrower than the deck slot.

Owner direction in `visual-design-spec.md` §1.5 says DON deck back is **cream body with teal compass** (not navy). The current `DonDeckSlot.tsx` already implements this. CONFIRMED — keep cream body with teal compass to differentiate visually from the navy main deck back.

```
 ┌── 36 ──┐
 │ ░░░░░░ │  ← cream body, ink hairline,
 │ ░ ⊙  ░ │     brass inset ring 0.5px
 │ ░CREW░ │
 │ ░SIM░  │     teal compass + "CREW SIM" wordmark
 │ ░░░░  ▣│     brass count chip bottom-right
 │   50   │     (10 → 0 as turns elapse)
 └────────┘
```

**Tokens:**

| Element | Value |
|---------|-------|
| Slot W × H | 36 × 50 (per `--zone-don-deck-w: 36px` in `index.css:50`; current `DonDeckSlot.tsx` uses `field` size 52×72 — this is a discrepancy, see hand-off §10 D1) |
| Body | cream + paper-grain + 0.5px ink-black border + 1px brass-canary inset hairline at 35% opacity |
| Compass | SVG: 3 concentric teal rings (r=6/9/12), 24 tick marks, NE-pointing needle diamond, crosshair lines |
| Wordmark | "CREW SIM" 0.5rem Lilita One, letter-spacing 0.08em, teal fill |
| Count chip | bottom-0.5 right-0.5, bg brass-canary, 0.55rem Lilita One tabular ink-black, border 0.5px ink-black, radius 2px |
| Aria | `aria-label="${owner} DON deck — ${count} cards remaining"` |

**Empty state:** count = 0; chip hidden; body remains rendered as the "where DON come from" slot indicator. No verbal label.

**Status:** Currently shipped in `DonDeckSlot.tsx`. Slot dimensions should match `--zone-don-deck-w` (36×50) instead of `field` (52×72) — see hand-off §10 D1.

### 2.7 Z3 — COST AREA band

**Geometry:** Horizontal band ≈230px wide × ~28px tall, sits in the far row between DON Deck (left) and Trash (right). Hosts all active + rested DON face-up.

```
 ┌─────────────────── 230px wide ────────────────────┐
 │ COST  ▣ ▣ ▣ ▣ ▣ ▣ ─                              │  ← 6 active DON
 │       │ │ │ │ │ │                                   │     stacked left-aligned
 │       30×42 cards, 14px stride                       │     14px stride per card
 │                                                     │
 │ when rested: card rotates 90° around its             │
 │ bottom-left origin so the slot footprint stays put   │
 └─────────────────────────────────────────────────────┘
   bg paper-fog/40, ring 1px ink-iron/15, radius 6px
```

**Tokens:**

| Element | Value |
|---------|-------|
| Band height | 28px (current `--zone-cost-strip-h`) — leaves 8dvh band space for visual breathing |
| Band background | bg `paper-fog/40` + ring-1 `ink-iron/15` rounded-md |
| Band label (left) | "COST" 0.5rem Nunito font-extrabold uppercase tracking-wider, ink-iron/75 |
| DON card W × H | 30 × 42 (DON_CARD_W/H in `CostAreaBand.tsx:32–33`) |
| DON stride | 14px per card (compressed-stack pattern; 10 DON × 14 + 30 = 156px footprint, fits inside 230px band) |
| DON visual | See §3.5 (DON front: cream body, ど!! mark, brass +1000 bottom band) |
| Active DON | upright, full opacity, drop shadow 0 2px 4px ink-black/35 |
| Rested DON | 90° rotation around transform-origin 0% 100% (bottom-left), opacity 0.72, no shadow |
| Empty state | "No DON" 0.55rem Nunito uppercase tracking-wider ink-iron/55 centered in band |
| Aria (band) | `aria-label="${owner} cost area — ${active} active DON, ${rested} rested DON"` |

**Active vs rested:** Both visible together in this zone per CR §3-9 + §4.8. Active DON are tappable (to arm + attach); rested DON are pointer-events: none.

**Armed state:** When `armedDonId === instanceId`, the DON card pulses `box-shadow: 0 0 0 2px sun-brass, 0 0 8px sun-brass/50` with a scale 1↔1.08 1s ease-in-out loop. Already wired in `CostAreaBand.tsx:148–158`.

**Status:** Currently shipped in `CostAreaBand.tsx`. DON card-front anatomy already matches `visual-design-spec.md` §1.

### 2.8 Z4 — TRASH slot

**Geometry:** Single 52×72 slot in the bottom-RIGHT corner of each half's far row.

```
 ┌── 52 ──┐
 │  top   │
 │  card  │  ← face-up top of trash
 │  of    │     (last index)
 │ trash  │
 │   72   │     when empty: dashed slot
 └────────┘     + "TRASH" 0.5rem Nunito ink-iron/55
```

**Tokens:**

| Element | Value |
|---------|-------|
| Slot W × H | 52 × 72 (field size) |
| Top card | CardArt size="field" rendering of `trash[trash.length - 1]` (top index = last per `rules-reference.md` §4.4) |
| Count chip | top-right corner, 0.6rem Lilita One ink on brass chip when count > 1 |
| Empty state | Dashed 1px marine-fog/40 + "TRASH" 0.5rem Nunito uppercase tracking-wider ink-iron/55 centered |
| Aria | `aria-label="${owner} trash — ${count} cards"` |

**Interaction:** Tapping the top card opens CardDetailModal with `card.name` + traits + effect text and a `CLOSE` action only (trash is open per CR §3-5 but cards are not re-playable from trash by default).

**Status:** Currently shipped in `TrashSlot.tsx`. Verify top-card render and aria.

### 2.9 Z5 — PHASE column

**Geometry:** Vertical column 52px wide × full leader-row height, sits LEFT of the leader.

```
 ┌────── 52 ──────┐
 │ ┌────────────┐ │
 │ │  REFRESH   │ │  ← chip 1, fading marine-fog/30
 │ └────────────┘ │
 │ ┌────────────┐ │
 │ │    DRAW    │ │  ← chip 2
 │ └────────────┘ │
 │ ┌────────────┐ │
 │ │   DON!!    │ │  ← chip 3
 │ └────────────┘ │
 │ ┌────────────┐ │
 │ │    MAIN    │ │  ← chip 4 — ACTIVE
 │ └────────────┘ │     bg sun-brass + text ink-black
 │ ┌────────────┐ │     shadow 0 1px 3px black/30
 │ │    END     │ │  ← chip 5
 │ └────────────┘ │
 └────────────────┘
```

**Tokens:**

| Element | Value |
|---------|-------|
| Column width | 52px |
| Chip W × H | 48 × 14, gap 4px between chips |
| Chip font | 0.55rem Nunito font-extrabold uppercase tracking-wider leading-tight |
| Active chip | bg sun-brass + text ink-black + shadow 0 1px 3px black/30; `aria-current="step"` |
| Inactive chip | bg marine-fog/30 + text ink-iron |
| Battle sub-phases | When phase is one of `attack_declaration`/`block_window`/`counter_window`/`damage_resolution`/`trigger_window`, the chip mapped is **`Main`** (battle is a sub-state of Main per CR §6-5-6) — the AttackResolutionOverlay + TriggerPrompt indicate the sub-phase explicitly |
| Aria (column) | `role="list" aria-label="${owner} phase progress"` |
| Aria (chip) | `role="listitem"` + `aria-current="step"` if active |

**Status:** Currently shipped in `PhaseColumn.tsx`. Logic is correct.

### 2.10 Z10 — HAND fan

**Geometry:** Bottom overlay strip 24dvh tall (202.6px at 844dvh). Cards 64×88 pivot from bottom-center along an arc.

```
 ┌─────────────── 398px inner width ───────────────┐
 │                                                  │
 │                                                  │
 │                                                  │
 │           lifted card (if any)                   │
 │             ▲ y=-60, scale 1.15                  │
 │                                                  │
 │       ╱ card ╲                                    │
 │      ╱  card  ╲                                   │
 │     │   card   │                                  │
 │     │   card   │     ← gentle arc, ±8° edge,    │
 │      ╲  card  ╱           parabolic lift -14px   │
 │       ╲ card ╱            apex                   │
 │        cards                                     │
 │                                                  │
 │                                  ┌───────────┐   │
 │                                  │ END TURN  │   │ ← bottom-right
 │                                  └───────────┘   │
 │ ── safe-area-bottom ──                           │
 └──────────────────────────────────────────────────┘
```

**Tokens:**

| Element | Value |
|---------|-------|
| Strip height | `calc(${HAND_CARD_H + 80}px + env(safe-area-inset-bottom, 0px))` ≈ 168px + safe area (matches current `HandFan.tsx:60`) |
| Card W × H | 64 × 88 (HAND_CARD_W/H in `fanLayout.ts:29–30`) |
| Card pivot | bottom-center (`transform-origin: 50% 100%`) |
| Spread (1–4 cards) | 140px max |
| Spread (5–6 cards) | lerp(140, 240, (n−4)/6) |
| Spread (10 cards) | 240px max — outer card centers at ±120 → outer edges at ±152, fits inside 398/2 = ±199 |
| Center lift | −14px apex (parabolic, edges at 0) |
| Edge rotation | ±4° (n ≤ 4) → ±8° (n ≥ 10) |
| Resting opacity | 1.0 |
| Inspected (lifted) | y −60, rotate 0°, scale 1.15, z 40 |
| Other-card dim | opacity 0.5, filter saturate(0.7) when someone else inspected |
| z-index ladder | Resting `20 + i` / Hovered `30` / Inspected `40` / Modal backdrop `50` / Modal panel `51` |
| Aria | `aria-label="Your hand, ${n} cards"` |

**Single-tap behavior:** Per owner direction 2026-05-29, single tap opens detail modal directly (no two-step lift then tap-again). Already wired in `HandFan.tsx:42–48` — tap dispatches `setInspectedCardId(id); setCardDetailOpen(true);`. KEEP this contract.

**Inspected state visual** is preserved as a 200ms transient between fan position and modal mount — the modal animates in over the lifted card. If `prefers-reduced-motion: reduce`, the lift skips and the modal opens with opacity-only fade.

**Status:** Currently shipped in `HandFan.tsx`. Single-tap routing matches owner direction.

### 2.11 Contact zone

**Geometry:** Thin (~1dvh ≈ 8px) horizontal strip between OPP's character row and YOU's character row, at the screen vertical center.

```
 ═════════ brass-canary hairline + glow ═════════
```

**Tokens:**

| Element | Value |
|---------|-------|
| Strip height | 6px min (1dvh ≈ 8px at 844dvh) |
| Hairline | 1px tall bg brass-canary/70 with shadow `0_0_6px_rgba(232,180,61,0.35)` |
| Aria | `aria-hidden="true"` (decorative) |

**Status:** Currently shipped in `PlayfieldStage.tsx:274–284`. No changes.

---

## §3. Card Anatomy Spec

The placeholder card frame already exists in `CardArt.tsx`. This section locks the exact anatomy per card kind so the implementation matches the printed card reference (rule_manual.pdf pp.1–4).

### 3.1 LEADER card (rule_manual.pdf p1)

Bandai leader card has:
- Top-right: Power (5000) + Attribute icon (slash / strike / ranged / special / wisdom / `?`)
- Mid: Effect text (single block)
- Bottom-LEFT: Life square (number in seal-red rounded square)
- Bottom-CENTER: Color hex + Card category band ("LEADER") + Card name + Type/traits
- Bottom-RIGHT: Card number (e.g. "ST01-001") + Rarity (L) + Block Symbol

Our placeholder mirrors this anatomy with brand palette:

```
 ╔═══════════════════════╗  ← 4px brass-canary frame
 ║ ┌─┐               ┌─┐ ║      (leader importance cue)
 ║ │L│               │5K│ ║  ← life square (red, bottom-LEFT
 ║ └─┘               └─┘ ║      anchored after rendering)
 ║                       ║      + power stamp (top-RIGHT, ink+cream)
 ║         ┌──┐          ║
 ║         │⊕ │  ← crest ║      compass placeholder where commissioned
 ║         └──┘          ║      art will land
 ║                       ║
 ║ ┌─────────────────┐   ║
 ║ │ Monkey D. Luffy │   ║  ← name strip: cream + ink, Lilita One
 ║ └─────────────────┘   ║
 ║ ┌─────────────────┐   ║
 ║ │ LEADER · Strawhat│  ║  ← kind strip: ink + cream, Nunito uppercase
 ║ └─────────────────┘   ║
 ║                  ST01·│  ← microtype bottom-right
 ║                  001  │
 ╚═══════════════════════╝
```

**Locked tokens for size="leader" (60×84 base, scaled 1.15× = 69×96):**

| Element | Geometry | Visual |
|---------|----------|--------|
| Brass frame | 4px brass-canary border-radius 5px | Inset 0px from outer body — replaces the standard 0.75px stroke. Reads as "leader is special" |
| Body tint | per `card.colors[0]`, +15% saturation vs character (`filter: saturate(1.15)`) | per §4.2 of `visual-design-spec.md` |
| Crest | 30×30 compass placeholder, top-center area | cream @ 38% opacity |
| Power stamp | 22×13 top-right, inset 4px | bg ink-black, text cream Lilita One 9px tabular; format "5K" |
| Life square | 14×14 bottom-LEFT, inset 4px | bg seal-red, text cream Lilita One 9px tabular; number from `liveLifeCount` (not printed) |
| Name strip | h=13 above kind strip | bg cream, text ink Lilita One 7px |
| Kind strip | h=10 above microtype | bg ink, text cream Nunito 6px uppercase letter-spacing 0.06em, format "LEADER · ${trait1}" |
| Microtype | bottom-right, inset 3px | text ink/50, Nunito 5px, format "${set}·${num}" |
| Drop shadow | 0 1px 3px ink-black/30 (normal); 0 2px 6px ink-black/55 (dark theme) | — |
| Active vs rested | rested = 90° rotate in place, opacity 0.82 | — |
| Floating life pill | overlaid above top edge, separate from card body | bg cream, ring-2 seal-red, 0.95rem Lilita One ink, padding 2×8 rounded-full |

**Status:** Currently shipped in `CardArt.tsx` for `size="leader"`. Brass-frame border-treatment is NOT yet differentiated from character — see hand-off §10 C1.

### 3.2 CHARACTER card (rule_manual.pdf p2)

Bandai character card has:
- Top-LEFT: Cost (number in cost square)
- Top-RIGHT: Power + Attribute icon
- Mid-LEFT: Counter chip ("+1000 COUNTER" yellow chip on left edge for characters with Counter value)
- Mid: Effect text + optional Trigger effect band
- Bottom: Color + Category ("CHARACTER") + Card name + Type + Card number + Rarity + Block Symbol

Our placeholder (already in `CardArt.tsx`):

```
 ┌───────────────────────┐  ← 0.75px stroke per card color
 │ ┌─┐               ┌─┐ │
 │ │3│               │5K│ │  ← cost square (top-LEFT cream + ink border)
 │ └─┘               └─┘ │      + power stamp (top-RIGHT, ink+cream)
 │                       │
 │         ┌──┐          │
 │         │⊕ │          │  ← compass crest placeholder
 │         └──┘          │
 │                       │
 │ ┌─────────────────┐   │
 │ │     Usopp       │   │  ← name strip
 │ └─────────────────┘   │
 │ ┌─────────────────┐   │
 │ │ CHARACTER · ... │   │  ← kind strip
 │ └─────────────────┘   │
 │ ┌──┐         ST01·│
 │ │+1│         010  │  ← counter chip bottom-LEFT (brass)
 │ │ K│              │     + microtype bottom-RIGHT
 │ └──┘              │
 └───────────────────────┘
```

**Locked tokens for size="field" (52×72):**

| Element | Geometry | Visual |
|---------|----------|--------|
| Body | 52×72, radius 4px, stroke 0.75px per card color | linear-gradient top→bottom per `--card-tint-{color}-{top|bot}` tokens (`index.css:23–34`) |
| Cost square | 12×12 top-LEFT, inset 3px, radius 2px | bg cream, 1px ink border, text ink Lilita One 8px tabular |
| Power stamp | 18×11 top-RIGHT, inset 3px, radius 2px | bg ink, text cream Lilita One 8px tabular "${power/1000}K" |
| Crest | 26×26 centered at 36% Y | cream @ 38% opacity, compass SVG (`CrestPlaceholder`) |
| Name strip | h=12, bottom-anchored above kind strip | bg cream, text ink Lilita One 6.5px |
| Kind strip | h=9, bottom-anchored above microtype | bg ink, text cream Nunito 5.5px uppercase letter-spacing 0.06em |
| Counter chip | 14×9 bottom-LEFT, inset 2px, radius 2px | bg brass-canary, 0.5px ink border, text ink Lilita One 6px "+${counterValue/1000}K" — hidden when `counterValue === 0` |
| Microtype | bottom-RIGHT, inset 2px | text ink/55, Nunito 4.5px, format "${set}·${num}" |
| Drop shadow | 0 1px 3px ink-black/30 (light), 0 2px 6px ink-black/55 (dark) | — |
| Active vs rested | rested = 90° rotate around card center, opacity 0.82 | — |

**Status:** Currently shipped — `PlaceholderArt` in `CardArt.tsx:278–461` handles this kind. No changes.

### 3.3 EVENT card (rule_manual.pdf p3)

Bandai event card has cost top-LEFT, no power, no counter chip on left edge (but events CAN have `[Counter]` effects in text), effect + trigger blocks, category "EVENT" + name + traits at bottom.

Our placeholder:

```
 ┌───────────────────────┐
 │ ┌─┐                   │  ← cost top-LEFT only
 │ │1│                   │     (no power stamp, no counter chip on chip rail)
 │ └─┘                   │
 │                       │
 │         ┌──┐          │
 │         │⊕ │          │
 │         └──┘          │
 │                       │
 │ ┌─────────────────┐   │
 │ │  Guard Point    │   │  ← name strip
 │ └─────────────────┘   │
 │ ┌─────────────────┐   │
 │ │ EVENT · Animal  │   │  ← kind strip
 │ └─────────────────┘   │
 │              ST01·014 │
 └───────────────────────┘
```

**Locked tokens (size="field" 52×72):**

| Element | Difference from Character |
|---------|---------------------------|
| Power stamp | HIDDEN |
| Counter chip | HIDDEN (event's `[Counter]` effect is shown in modal effect text, not on the card chip rail) |
| Kind strip text | "EVENT · ${trait1}" |
| Body tint | same per-color gradient as character |

**Status:** `PlaceholderArt` already gates `showPower` and `showCounter` on `card.kind === 'character'` (lines 284–292). Correct.

### 3.4 STAGE card (rule_manual.pdf p3)

Bandai stage card has cost top-LEFT, no power, no counter, effect text, category "STAGE" + name + traits at bottom.

Our placeholder:

```
 ┌───────────────────────┐
 │ ┌─┐                   │  ← cost top-LEFT only
 │ │2│                   │
 │ └─┘                   │
 │                       │
 │         ┌──┐          │
 │         │⊕ │          │
 │         └──┘          │
 │                       │
 │ ┌─────────────────┐   │
 │ │ Thousand Sunny  │   │  ← name strip
 │ └─────────────────┘   │
 │ ┌─────────────────┐   │
 │ │ STAGE · Straw…  │   │  ← kind strip
 │ └─────────────────┘   │
 │              ST01·017 │
 └───────────────────────┘
   filter: saturate(0.92)   ← stage = lower-energy than character
```

**Locked tokens (size="field" 52×72):**

| Element | Difference from Character |
|---------|---------------------------|
| Power stamp | HIDDEN |
| Counter chip | HIDDEN |
| Body filter | `saturate(0.92)` applied to body (additional desaturation on top of the per-color tint) |
| Kind strip text | "STAGE · ${trait1}" |

**Status:** Currently shipped without the `saturate(0.92)` desaturation. See hand-off §10 C2.

### 3.5 DON card FRONT (rule_manual.pdf p4)

Already locked in `visual-design-spec.md` §1.2–1.4. Cream body with ど!! ink mark on faint speed-line burst, brass underline accent, brass `+1000` stamp in ink bottom band. 30×42 base, 1px ink border, radius 3px.

**Rested treatment:** `transform: rotate(90deg)` with `transform-origin: 0 100%` (bottom-left pivot per MOOgiwara `card.ts:117-128`) so the slot footprint stays anchored even after rotation. Opacity 0.72, no shadow.

**Armed state:** `box-shadow: 0 0 0 2px sun-brass, 0 0 8px sun-brass/50` pulsing 1s ease-in-out, scale 1↔1.08, y −2px.

**Status:** Currently shipped in `CostAreaBand.tsx:67–125`. No changes.

### 3.6 DON DECK card BACK (rule_manual.pdf p4)

Already locked in `visual-design-spec.md` §1.5–1.6. Cream body + 0.5px ink border + 1px brass inset hairline + teal compass-rose (3 concentric rings, 24 tick marks, NE-pointing needle, crosshair lines) + "CREW SIM" wordmark in 0.5rem Lilita One letter-spacing 0.08em teal. Bottom-right brass count chip.

**Status:** Currently shipped in `DonDeckSlot.tsx`. No changes to back design.

### 3.7 Generic navy card BACK (Character/Event/Stage)

Per `rules-reference.md` §3.10, Character/Event/Stage all share the NAVY OP-compass back. Our `NavyCardBack` renders this back.

**Tokens:**

| Element | Value |
|---------|-------|
| Body | bg hull-deep, full rounded-md fill |
| Inset frame | ring-1 brass-canary/60, inset 4px |
| Compass | 50% W × 50% H, brass-canary stroke 1.6px (concentric circle + 2 crossed diamond polygons) |
| Wordmark | "CREW SIM" 0.5rem Lilita One brass-canary, letter-spacing 0.08em, centered below compass |

Used by: `DeckSlot`, `LifeStack` cards (life cards share the deck back per CR §5-2-1-7), and any face-down character/event/stage that ever needs rendering.

**Status:** Currently shipped in `NavyCardBack.tsx`. No changes.

### 3.8 Leader card BACK (rule_manual.pdf p1)

Bandai leader back is **RED** with white compass (distinct from Character/Event/Stage navy back). Our app rarely shows the leader face-down (only at deck-construction step, and there's no deck-construction screen in V1). We do not need a separate RED leader back component for V1; if a future state needs it, copy `NavyCardBack` and swap `bg-hull-deep` → `bg-seal-red` and `text-brass-canary` → `text-paper-cream`.

**Status:** Not built. V1 doesn't need it.

---

## §4. Interaction Model

### 4.1 Tap routing summary

Owner's locked routing (2026-05-29):

| Source | State | Tap result |
|--------|-------|------------|
| Hand card | `inspectedCardId === null` | Single tap → open CardDetailModal for that card |
| Hand card | `inspectedCardId === thatId` | Tap again → already open; no-op (the modal absorbs the second tap) |
| Friendly Leader/Character/Stage | any | Single tap → open CardDetailModal; action set varies by state (see 4.2) |
| Opponent Leader/Character/Stage | any | Single tap → open CardDetailModal; action set = `ATTACK THIS` if legal + `CLOSE` |
| Active DON in Cost Area | your main + active | Single tap → toggle `armedDonId` (arm/disarm); pulsing ring shows armed state |
| Rested DON in Cost Area | any | non-interactive (`pointer-events: none`) |
| Life stack | any | **No handler.** Life is SECRET per CR §3-10-2 |
| Deck slot | any | No handler. Deck is SECRET per CR §3-2 |
| DON Deck slot | any | No handler. Engine handles draw automatically each turn |
| Trash slot top card | any | Single tap → open CardDetailModal in read-only mode (no play actions; CLOSE only) |
| Phase chip | any | No handler. Phase advances via engine + End-Turn button |
| Empty playmat space | any | Clears `inspectedCardId`, `selectedAttackerId`, `armedDonId` |

### 4.2 CardDetailModal action set by source + state

When the modal opens for a card, it shows the card art at read size + a row of floating action buttons. The button set depends on WHERE the card is and the current phase. Already implemented in `CardDetailModal.tsx:65–275`.

| Card location | Card kind | Phase | Buttons |
|---|---|---|---|
| Hand | Character | your main + affordable + field < 5 | `PLAY · {cost} ⊙` (teal primary) + `CANCEL` |
| Hand | Character | your main + affordable + field == 5 | `REPLACE…` (teal primary) + `CANCEL` |
| Hand | Character | your main + NOT affordable | `PLAY · {cost} ⊙` (teal, disabled 50%) + `CLOSE` |
| Hand | Character | opp counter window + counterValue > 0 | `USE COUNTER · +{value}` (red primary) + `DECLINE` |
| Hand | Event | your main + affordable | `PLAY MAIN · {cost} ⊙` (teal primary) + `CANCEL` |
| Hand | Event | opp counter window + has counter | `PLAY COUNTER · {cost} ⊙` (red primary) + `DECLINE` |
| Hand | Stage | your main + affordable | `PLAY · {cost} ⊙` (teal primary) + `CANCEL` |
| Hand | any | game over | `CLOSE` only |
| Friendly Leader | — | your main + armed DON | `ATTACH DON` (teal primary) + `CLOSE` |
| Friendly Leader | — | your main + can attack | `SELECT AS ATTACKER` (red primary) + `CLOSE` |
| Friendly Leader | — | your main + already selected | `CANCEL ATTACK` (secondary) + `CLOSE` |
| Friendly Character/Stage | — | your main + armed DON | `ATTACH DON` (teal primary) + `CLOSE` |
| Friendly Character | — | your main + can attack | `SELECT AS ATTACKER` (red primary) + `CLOSE` |
| Opp Leader / Character | — | your attack target | `ATTACK THIS` (red primary) + `CLOSE` |
| Opp Leader / Character | — | other | `CLOSE` only |
| Trash top card | — | any | `CLOSE` only |

**Status:** All wired in `CardDetailModal.tsx`. No spec changes.

### 4.3 Armed DON state

When user taps an active DON in the Cost Area: `armedDonId = thatId`. Visual: pulsing brass ring on the DON card + on every legal `ATTACH_DON` target on the field (computed from `legalActions`). User then taps a friendly Leader / Character / Stage which opens its CardDetailModal with `ATTACH DON` as primary; tapping it dispatches `ATTACH_DON` + clears `armedDonId`. Tapping the same DON again disarms.

**Status:** Wired in `CostAreaBand.tsx` + `PlayfieldStage.tsx` + `CardDetailModal.tsx`. No changes.

### 4.4 Selected attacker state

When user taps a friendly Leader/Character that can attack: the modal opens with `SELECT AS ATTACKER`. Tapping it sets `selectedAttackerId = thatId` and closes the modal. Then opp's legal targets pulse seal-red. User taps a pulsing target, its modal opens with `ATTACK THIS` as primary, tapping dispatches `DECLARE_ATTACK` + clears `selectedAttackerId`. Tapping the friendly attacker again opens its modal with `CANCEL ATTACK` to clear.

**Status:** Wired. No changes.

### 4.5 Attack legality (CR §7-1-1-2)

Targets are: opp Leader, OR opp's **RESTED** Characters. Active opp Characters are NOT valid attack targets. Pulsing seal-red ring MUST NOT show on active opp characters.

Already enforced in `legality.ts:118` (per design-reference.md §7).

### 4.6 Reduced motion

If `prefers-reduced-motion: reduce`:
- All pulsing rings drop their loop → static colored ring instead
- Card lift in hand (inspected state) skips spring → opacity-only fade to modal
- Modal backdrop swaps `backdrop-filter: blur` → solid `rgba(0,0,0,0.7)` overlay
- DON attach animation skips scale → instant move with opacity-only fade

Already wired in `CardArt.tsx`, `CardDetailModal.tsx`, `HandFan.tsx` via `useReducedMotion()`.

---

## §5. Modal Spec (Locked)

The CardDetailModal is the primary read-then-decide affordance. It must let the player read the FULL card art without competing chrome.

Owner direction 2026-05-29: **TRANSPARENT backdrop, NO panel chrome**. Card self-frames. Floating circular close + floating action buttons below.

```
 ┌─────────── 430 × 100dvh viewport ──────────┐
 │░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
 │░░░░░░░░░░░ safe-area-top ░░░░░░░░░░░░░░░░░│
 │░░░  ┌──────────────────────┐         ╳    │  ← floating close
 │░░░  │                      │              │     bottom-right
 │░░░  │                      │              │     bg ink/55 + cream X
 │░░░  │                      │              │     36×36, rounded-full
 │░░░  │      FULL CARD       │              │
 │░░░  │   ART, scaled 1.5×   │              │
 │░░░  │   from modal size    │              │
 │░░░  │   (220×308 → ~330×462│              │     
 │░░░  │   centered)          │              │
 │░░░  │                      │              │
 │░░░  │                      │              │
 │░░░  │                      │              │
 │░░░  └──────────────────────┘              │
 │░░░                                         │
 │░░░    ┌─────────────┐  ┌──────────┐       │  ← floating action row
 │░░░    │ PLAY · 4 ⊙  │  │  CANCEL  │       │     22px rounded pill
 │░░░    └─────────────┘  └──────────┘       │     primary teal + secondary outline
 │░░░░░░░░ safe-area-bottom ░░░░░░░░░░░░░░░░░│
 └─────────────────────────────────────────────┘
   backdrop: rgba(15,20,15,0.62) + blur(4px) saturate(0.85)
   tap on backdrop closes
```

**Tokens:**

| Element | Value |
|---------|-------|
| Backdrop | bg `rgba(15,20,15,0.62)` + `backdrop-filter: blur(4px) saturate(0.85)` |
| Backdrop animation | fade in 180ms ease-out, fade out 140ms ease-in |
| Backdrop tap | closes modal (`onBackdropClick` in `CardDetailModal.tsx:348–353`) |
| Panel | TRANSPARENT — no background, no border, no shadow, no padding (`CardDetailModal.tsx:393–394` confirmed) |
| Card art | `CardArt` at `size="modal"` (220×308), scaled 1.5× → ~330×462 centered horizontally with marginTop 48px and marginBottom 240px to reserve scaled footprint |
| Close button | 36×36 circular, bg ink/55, text cream, top-right inset 0, hover bg ink/75, focus ring 2px sun-brass |
| Action row | flex gap-2, centered horizontally below the card |
| Primary button (teal) | min-h 44px, bg hull-teal, text cream, rounded-22px, padding 0 18px, min-width 140, Lilita One 14px letter-spacing 0.06em uppercase, shadow `0 2px 0 ink/30` |
| Primary button (red — counter / attack) | same geometry, bg seal-red, text cream |
| Secondary button | bg transparent, text ink-black, 1.5px ink-black border, rounded-22px, padding 0 18px, min-width 96 |
| Disabled state | opacity 0.5, cursor not-allowed |
| Mount animation | initial `opacity: 0, scale: 0.92` → animate `opacity: 1, scale: 1` in 220ms cubic-bezier(0.2,0.9,0.3,1); reverse on exit |
| Reduced motion | scale animation skipped; opacity-only |
| Focus management | Initial focus = primary action button (else close); ESC closes; tab-trap inside panel buttons |
| Aria | `role="dialog" aria-modal="true" aria-labelledby="card-detail-name"` with sr-only h2 holding card name + kind |

**Cost glyph `⊙`:** 12px filled brass-canary circle inline before cost number in button label. Implemented via Unicode `⊙` for now; can swap to inline SVG later for sharper rendering.

**End-Turn button visibility:** Hidden while modal is open (`!cardDetailOpen` gate in `App.tsx:210`). Already wired.

**Status:** Currently shipped in `CardDetailModal.tsx`. Layout, transparent panel, close button, action buttons all match this spec. No changes.

---

## §6. Hand Fan (Locked)

Math from `visual-design-spec.md` §3.1–3.4 + current `fanLayout.ts:47–67`:

```
spread(n) = lerp(140, 240, clamp((n−4)/6, 0, 1))     // px
spacing(n) = spread(n) / max(n−1, 1)                  // px per slot
maxRotateDeg(n) = lerp(4, 8, clamp((n−4)/6, 0, 1))   // ° per edge
x(i, n) = (i − (n−1)/2) * spacing(n)
y(i, n) = −14 * (1 − normalized²)   where normalized = (i − center) / max(center, 1)
rotate(i, n) = maxRotateDeg(n) * normalized
```

**Constants:** card 64×88, pivot bottom-center, fan container width 1px (cards positioned absolutely around x=0).

**Single-tap:** opens CardDetailModal directly (no two-step lift). Owner-locked direction 2026-05-29.

**Other-card dim while modal open:** opacity 0.5 + filter saturate(0.7).

**Verification:** At n=10, outer card centers at ±120, outer edges at ±152, footprint 304px, fits inside 398px inner width with 47px slack each side.

**Status:** Currently shipped — `fanLayout.ts` formulas match this spec. `HandFan.tsx:39–48` single-tap routing matches. No changes.

---

## §7. End-Turn Button (Phase-Reactive)

Already implemented in `App.tsx:30–74`. Locked contract:

| Whose turn | Phase | Label | Enabled | Action on tap |
|---|---|---|---|---|
| Your | `main` | **END TURN** | yes | `endTurnAndAdvance()` |
| Your | `attack_declaration` / `damage_resolution` | **ATTACKING…** | no | — |
| Your | `trigger_window` | **TRIGGER…** | no (handled by TriggerPrompt) | — |
| Your | other | **OPPONENT'S TURN** | no | — |
| Opp's | `block_window` | **DECLINE BLOCK** | yes | `dispatch({ type: 'SKIP_BLOCKER' })` |
| Opp's | `counter_window` | **DECLINE COUNTER** | yes | `dispatch({ type: 'SKIP_COUNTER' })` |
| Opp's | `trigger_window` | **TRIGGER…** | no | — |
| Opp's | other | **OPPONENT'S TURN** | no | — |
| Game over | any | **GAME OVER** | no | — |

**Position:** absolute, `right: 12px`, `bottom: calc(24dvh + 16px + env(safe-area-inset-bottom, 0px))`. Floats above the hand fan strip without overlapping the leader row.

**Visual:**

| Element | Value |
|---------|-------|
| Button size | min-h 44px, padding 4px 16px, rounded-2xl (16px radius) |
| Background | bg seal-red |
| Text | cream, Nunito 0.75rem font-extrabold uppercase tracking-wider |
| Shadow | `0 4px 12px rgba(168,38,31,0.30)` |
| Disabled | opacity 0.4, cursor-not-allowed |
| Focus ring | 2px sun-brass |
| Hidden when | `cardDetailOpen === true` (so the modal's action buttons are the only primary affordance) |
| Aria | `aria-label="${label}" aria-busy="${aiThinking}"` |

**Status:** Currently shipped. No changes.

---

## §8. App Chrome + Theme Toggle

App-chrome header sits above the playfield, inside the safe-area-top, and shows: app title + mode toggles + reset button + theme toggle.

```
 ┌─────────────────────────────────────────────────────┐
 │ ╭───────────╮                                       │
 │ │OPTCG       │     [vs Easy] [vs Medium] [Hot-seat] │
 │ │  Sandbox   │     [Reset]            [☼/☾]         │  ← theme toggle far-right
 │ ╰───────────╯     T1 · main · AI…                   │
 └─────────────────────────────────────────────────────┘
   px-3 py-1.5, 6dvh tall, z-index 50
```

**Tokens:**

| Element | Value |
|---------|-------|
| Container | absolute inset-x-0 top-0, padding 3 1.5, gap 2, z-50, padding-top safe-area-inset-top |
| Title | "OPTCG" Lilita One 1rem ink-black + "Sandbox" sun-brass; no space between |
| Status line | T${turn} · ${phase}${aiThinking ? ' · AI…' : ''}, Nunito 0.6rem font-bold uppercase tracking-wider ink-iron, `role="status" aria-live="polite"` |
| Mode pill | min-h 28px, rounded-full, px-2 py-0.5, Nunito 0.6rem font-extrabold uppercase tracking-wider |
| Mode pill active | bg sun-brass, text ink-black |
| Mode pill inactive | bg paper-fog/60, text ink-iron, ring-1 marine-fog/40, hover:bg paper-fog |
| Reset button | same as inactive mode pill |
| Theme toggle | 28×28 rounded-full, bg hull-teal, text cream, focus ring 2px sun-brass; sun icon when light → flips to moon when dark |
| Aria (toggle) | `aria-label="Switch to ${target} theme"` |
| Aria (mode) | `aria-pressed="${mode === thisMode}"` |

**Status:** Currently shipped in `App.tsx:128–197`. No changes.

### 8.1 Theme system

Light theme (default): cream-paper surface, ink-black text, brass-canary accents.
Dark theme: hull-deep surface, paper-cream text, brass-canary accents kept.

Token aliases switch in `:root, [data-theme="light"]` vs `[data-theme="dark"]` blocks (already in `src/index.css:62–85`).

DON card body stays cream in BOTH themes (per `visual-design-spec.md` §1.8) for brand recognition.

Per-card-color tints stay the same hex in both themes (they sit between cream and ink semantically).

**Hidden scrollbars** convention (`scrollbar-width: none`) applies to any scrolling region — effect text scroll inside modal, etc.

---

## §9. Color + Typography Tokens (Confirmed)

### 9.1 Palette (locked — owner-set)

| Token | Hex | Role |
|-------|-----|------|
| `--color-paper-cream` | `#F2E8D2` | Primary playmat surface (light theme), card body for DON/leader/modal panel deltas |
| `--color-paper-fog` | `#E2DCC9` | Secondary surface, zone band background, effect-text box background |
| `--color-ink-black` | `#15140F` | Primary text, card body stroke, button shadow |
| `--color-ink-iron` | `#3A372E` | Secondary text, microtype |
| `--color-hull-teal` | `#0F4549` | DON card accents, primary action button, dark-theme secondary surface |
| `--color-hull-deep` | `#082A2D` | Dark-theme primary surface, navy card-back ground |
| `--color-seal-red` | `#A8261F` | Urgent / attack / red leader, primary attack button, life pill ring, character power stamp |
| `--color-brass-canary` | `#D4A017` | DON +1000 stamp, contact-zone glow, leader frame, counter chip |
| `--color-marine-fog` | `#B8C7C9` | Empty-zone dashed outline color, ghost slots |
| `--color-sky-horizon` | `#C9DCE6` | Opponent half tint (subtle distance cue), letterbox backdrop mid |
| `--color-sky-day` | `#E8F0F4` | Letterbox backdrop top |
| `--color-sun-brass` | `#E8B43D` | Armed-DON glow, active phase chip background, focus ring |

Plus 12 `--card-tint-{color}-{top|bot}` tokens for the per-color card body gradients (locked in `index.css:23–34`).

### 9.2 Typography (locked — owner-set)

| Role | Font | Where |
|------|------|-------|
| Display | **Lilita One** | Power numbers, cost numbers, phase chips, mode toggles, app title, card names, action button labels, DON `+1000` stamp |
| Body | **Nunito** | Microtype card numbers, kind/trait strips (uppercase), modal effect text body, aria text, zone labels, status line |

### 9.3 Type scale

| Use | Size | Weight | Line-height |
|-----|------|--------|-------------|
| Modal card name (h2) | 18px (1.125rem) | 600 | 22px |
| Modal kind/traits sub | 11px (0.6875rem) | 600 | 14px, letter-spacing +0.04em uppercase |
| Modal effect text | 13px (0.8125rem) | 400 | 1.45 leading |
| Modal action button | 14px (0.875rem) | 600 | 1, letter-spacing +0.06em uppercase |
| Modal cost / power number | 22px (1.375rem) | 600 | 1, tabular |
| Card name strip (hand) | 7px (0.4375rem) | 600 | 1 |
| Card name strip (field) | 6.5px (0.40625rem) | 600 | 1 |
| Card kind strip (hand) | 6px | 700 | 1, letter-spacing +0.06em uppercase |
| Power stamp (hand/field) | 8–9px | 600 | 1, tabular |
| Cost square (hand/field) | 8–9px | 600 | 1, tabular |
| Counter chip | 6–7px | 600 | 1, tabular |
| Microtype set·number | 4.5–5px | 400 | 1 |
| Phase chip | 0.55rem | 700–800 | tight, uppercase tracking-wider |
| Mode pill | 0.6rem | 700–800 | uppercase tracking-wider |
| App title | 1rem | 400 | 1 |
| Status line | 0.6rem | 700 | uppercase tracking-wider |
| End-Turn button | 0.75rem | 800 | uppercase tracking-wider |
| Life pill (floating) | 0.95rem | 600 | tabular |
| DON `+1000` stamp | 8–9px | 600 | tabular, letter-spacing +0.04em |
| Count chips (Deck/DON/Trash) | 0.55–0.7rem | 600 | tabular |

All sizes already implemented across `CardArt.tsx`, `CostAreaBand.tsx`, `App.tsx`, `PhaseColumn.tsx`. No spec changes.

### 9.4 Shadow scale

| Use | Value |
|-----|-------|
| Card normal (hand) | `0 1px 3px rgba(15,20,15,0.30)` |
| Card normal (field) | `0 2px 6px rgba(15,20,15,0.32)` |
| Card normal (modal) | `0 4px 12px rgba(15,20,15,0.35)` |
| Card dark-theme | `0 2px 6px rgba(0,0,0,0.55)` |
| DON active | `0 2px 4px rgba(15,20,15,0.35)` |
| DON rested | `0 1px 2px rgba(15,20,15,0.18)` |
| Modal backdrop blur | `blur(4px) saturate(0.85)` over `rgba(15,20,15,0.62)` |
| End-Turn button | `0 4px 12px rgba(168,38,31,0.30)` |
| Letterbox frame | `var(--shadow-frame)` = `0 0 40px rgba(15,69,73,0.18)` |
| Selected attacker ring | `outline: 2px solid brass; outline-offset: 2px` |
| Armed DON pulse | `0 0 0 2px sun-brass, 0 0 8px sun-brass/50` looping |
| Pending target pulse | `0 0 0 2px seal-red` looping with stroke widening 2px→3px |

---

## §10. Implementation Hand-off Table

Each row: which spec section, which file(s), what to change, divergence ID (existing `L##` if open, or new `C##` for card anatomy / `D##` for dimension fixes).

| ID | Spec ref | File(s) | Change | Severity |
|----|----------|---------|--------|----------|
| **L10** | §2.x base | `src/index.css` | Already cream-paper playmat (`paper-playmat` class). Verify `--color-felt-green*` tokens + `.felt-playmat` class are not present. If they are, delete | CHECK |
| **L11** | §3.5 | `src/components/zones/CostAreaBand.tsx` | DON front already matches §3.5. Verify ど!! mark, brass underline, brass +1000 stamp present | DONE per current code |
| **L12** | §6 | `src/lib/fanLayout.ts` | Math matches §6 (verified against `fanLayout.ts:47–67`) | DONE |
| **L13** | §6 + §4.1 | `src/components/HandFan.tsx` | Single-tap routing matches (`HandFan.tsx:42–48`) | DONE |
| **L14** | §5 | `src/components/CardDetailModal.tsx` | Modal exists, transparent panel, floating action row, close button match §5 | DONE |
| **L15** | §4.1, §4.2 | `src/components/PlayfieldStage.tsx` | Field-card tap router opens modal (`useFieldTapRouter` in `PlayfieldStage.tsx:85–99`) | DONE |
| **L16** | §4.4 | `src/store/game.ts` | `selectedAttackerId` state confirmed present (read via `useGameStore` in `PlayfieldStage.tsx:50`) | DONE |
| **L17** | §2.2 + §4.4 | `src/components/CardArt.tsx` | `pendingTarget` pulse ring already in `CardArt.tsx:546–588` | DONE |
| **L18** | §1.3 + §10 of design-reference | `src/components/PlayfieldStage.tsx` | Edge padding 16px L/R applied + safe-area-top/bottom applied (`PlayfieldStage.tsx:343–347`). Verify on 390×844 and 430×844 | CHECK |
| **L19** | §7 | `src/App.tsx` | End-Turn phase-reactive text wired (`computeEndTurnAffordance` in `App.tsx:30–74`) | DONE |
| **L20** | — | repo | Orphan files `PhaseRibbon.tsx`, `zones/CostAreaStrip.tsx`, `zones/DonRested.tsx` — check if still on disk; delete if yes | LOW |
| **L21** | §3.2 | `src/components/CardArt.tsx` | Placeholder anatomy already renders name + cost + power + counter + traits (not raw IDs) per `PlaceholderArt`. Verify the `compressName` path handles edge cases (no name → "—") | DONE |
| **L22** | §3.x | `src/components/CardArt.tsx` | `DonBadge` overlay on field cards with attached DON already wired (`CardArt.tsx:507–521`) | DONE |
| **L23** | §4 | `src/components/AttackResolutionOverlay.tsx`, `TriggerPrompt.tsx` | Sub-phase prompts exist (block_window / counter_window / trigger_window). Verify they fire on phase transitions and clear `inspectedCardId` to prevent stale modal underneath | CHECK |
| **C1** | §3.1 | `src/components/CardArt.tsx` | **NEW**: Leader card needs 4px brass-canary inset frame to differentiate from character. Currently shares character body stroke. Add `isLeader ? 'ring-[4px] ring-brass-canary ring-inset' : ...` to outer body className OR draw the frame as an additional inset shadow `inset 0 0 0 4px var(--color-brass-canary)` | HIGH |
| **C2** | §3.4 | `src/components/CardArt.tsx` | **NEW**: Stage card body needs `filter: saturate(0.92)` so it reads as lower-energy than character. Currently same saturation. Wire when `card.kind === 'stage'`: `saturationFilter = 'saturate(0.92)'` | MEDIUM |
| **C3** | §3.1 + §2.3 | `src/components/CardArt.tsx` | **NEW**: Leader life square (bottom-LEFT, seal-red, white life count). The `LifePill` currently floats ABOVE the card. Per Bandai anatomy the life count belongs IN the card body too. KEEP the floating life pill (it's the play-state readout from `liveLifeCount`) and additionally render the PRINTED life as a small seal-red square in the body's bottom-LEFT corner with the printed life number — gives the "this leader has 5 starting life" cue. Use `card.lifeCount` (printed) for the in-body square; use `liveLifeCount` for the floating pill | MEDIUM |
| **D1** | §2.6 | `src/components/zones/DonDeckSlot.tsx` | DON Deck slot currently uses `CARD_DIMS.field` (52×72). Spec calls for `--zone-don-deck-w: 36px` × 50px. Either: (A) keep 52×72 to match the other corner slots' visual rhythm (DECK + TRASH are also 52×72), OR (B) switch to 36×50 to match the Bandai cardboard mat where the DON DECK slot is visibly narrower. Owner decision required. RECOMMEND (A) for visual consistency with the corner-slot row | DECISION |
| **D2** | §2.4 | `src/components/zones/StageSlot.tsx` | Empty-slot state needs "STAGE" 0.5rem Nunito uppercase tracking-wider ink-iron/55 centered in the dashed ghost. Verify currently present; add if missing | LOW |
| **D3** | §2.5 | `src/components/zones/DeckSlot.tsx` | Count chip exists. Verify dashed-empty fallback when `count === 0` (game-loss state, brief but possible) | LOW |
| **D4** | §2.7 | `src/components/zones/CostAreaBand.tsx` | When `totalDon === 0`, label currently says "No DON" 0.55rem uppercase. Verify centered horizontally + accessible color contrast (ink-iron/55 on paper-fog/40 may fail WCAG AA; bump to solid ink-iron) | CHECK |
| **D5** | §2.10 | `src/components/HandFan.tsx` | At 430×844, fan strip should be 24dvh; at 390×844, the same 24dvh = 202.6px holds. Verify the bottom safe-area inset compresses gracefully (the strip's `height: calc(${HAND_CARD_H + 80}px + env(safe-area-inset-bottom, 0px))` already accounts) | CHECK |
| **D6** | §1.3 | `src/components/PlayfieldStage.tsx` | The 3-row grid currently uses `gridTemplateRows: '1fr auto 1fr'` for each half. Spec calls for explicit dvh allocation: top-row 8dvh, mid-row 12dvh, bottom-row 11dvh (or vice-versa depending on row order). Replace `1fr` with the exact dvh values from §1.3 so the layout doesn't drift when the hand strip compresses on smaller phones | MEDIUM |
| **D7** | §2.9 | `src/components/zones/PhaseColumn.tsx` | Currently 52px wide. At 390×844 inner width 358px, leader row gets: phase 52 + leader 69 + stage 52 + deck 52 + 3×gap 24 = 249px → 109px slack. Fits. No change | DONE |
| **C4** | §3.2 — character anatomy | `src/components/CardArt.tsx` | The Bandai character card has the COUNTER value on the LEFT EDGE as a yellow `[+1000 COUNTER]` ribbon. Our placeholder puts the counter chip BOTTOM-LEFT. Acceptable simplification (44×44 hit-box wouldn't fit a left-edge ribbon at 52px card width). KEEP bottom-left chip. No change | DONE |
| **C5** | §3.x — attribute icon | `src/components/CardArt.tsx` | Bandai cards show the Attribute (slash/strike/ranged/special/wisdom/`?`) as a small icon next to the power stamp. Currently HIDDEN in placeholder (too small to read at 52×72). Show in MODAL size only (220×308): render a 14×14 monogram icon next to the power pill, using a single-letter glyph (S/St/R/Sp/W/?). LOW priority — can defer | LOW |
| **C6** | §3.x — printed life on leader body | `src/components/CardArt.tsx` | At MODAL size, render the printed life count as a 28×28 seal-red rounded square in bottom-LEFT of the leader's body interior. At HAND/FIELD/LEADER sizes, the floating life pill outside the body covers this | MEDIUM |

### 10.1 Open decision items requiring owner input

| ID | Question | Default if no decision |
|----|----------|-----------------------|
| D1 | DON Deck slot size: 52×72 (match corner-slot row) or 36×50 (match Bandai cardboard mat)? | Keep 52×72 (visual consistency over literal-mat fidelity) |
| D6 | Replace `1fr` rows with exact dvh values? | Yes — Set bands to 8/12/11dvh, contact-zone 1dvh, hand-strip 22–24dvh |
| C1 | Leader's 4px brass inset frame: hard brass-canary border vs softer brass-canary/70 with gradient? | Solid brass-canary 4px ring-inset |
| C3 | Show printed life in leader body in addition to floating pill? | Yes — at modal size only |
| C5 | Render attribute icon? | Defer to V1.1 |

### 10.2 What is NOT in this spec (out of scope)

- Engine state shape changes (none required)
- New card data fields (we use existing `card.name`, `card.cost`, `card.power`, `card.counterValue`, `card.kind`, `card.traits`, `card.colors`, `card.lifeCount`, `card.id`, `card.imageUrl`)
- Animation timing token changes (use `springs(reduced)` from `animationTokens.ts` — already correct)
- AttackResolutionOverlay + LifeRevealOverlay + EventCardOverlay + TriggerPrompt visual redesign (separate spec if needed; these are already wired)
- GameOver splash redesign (currently functional; out of scope)
- Mulligan UI (deferred per `rules-reference.md` D10)
- Drag-line attack gesture (alt to 2-tap, MOOgiwara pattern, deferred per `design-reference.md` §12.3)
- Sound effects + haptics

---

## §11. Verification Checklist

Before declaring playmat redesign done, verify on iPhone 13 Mini (390×844) and iPhone 14 (430×844) simulators:

- [ ] Zero horizontal scrollbar
- [ ] Zero card clipped by safe-area-inset (top notch + bottom home indicator)
- [ ] LIFE column 32px wide, cards 24×34, max 5 stacked with 4px peek
- [ ] CHARACTER row 5 slots × 52×72 with 8px gap, both halves
- [ ] LEADER scaled 1.15× from 60×84 base, visible 4px brass frame
- [ ] STAGE empty state shows "STAGE" microtype centered in dashed slot
- [ ] DECK 52×72 with bottom-right count chip readable
- [ ] DON DECK 52×72 (or 36×50 per D1 decision) with teal compass + "CREW SIM" + brass count chip
- [ ] COST AREA hosts up to 10 DON at 14px stride, fits inside band
- [ ] TRASH 52×72 with top card or "TRASH" empty microtype
- [ ] PHASE column 52px wide, 5 chips, active chip in sun-brass
- [ ] HAND FAN: 1 / 4 / 7 / 10 cards all fit inside 398px without clipping
- [ ] CONTACT ZONE: 1px brass-canary hairline + glow visible between halves
- [ ] OPPONENT half rotated 180° as a unit — their LIFE column lands top-right
- [ ] END TURN button bottom-right, hidden when modal open, text matches phase contract
- [ ] CardDetailModal opens on single tap from hand OR field, transparent backdrop, card self-frames, action row centered below card
- [ ] DON arm pulses brass-canary on both DON card AND legal drop-zone targets
- [ ] Selected-attacker outline + pending-target seal-red pulse fire correctly
- [ ] Light + dark theme toggle both render correctly
- [ ] `prefers-reduced-motion` honored: blur skipped, pulses go static, scale skipped
- [ ] Touch targets all ≥ 44×44 (cards 52×72 ✓, action buttons min-h 44 ✓, theme toggle 28×28 ✗ — bump to 32×32 if WCAG-critical)
- [ ] Color contrast WCAG AA for body (4.5:1) and UI (3:1) — verify mode pill text-on-bg, DON ど!! ink on cream, counter-chip ink on brass

---

*End of playmat-redesign.md*
