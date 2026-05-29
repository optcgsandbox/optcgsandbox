# OPTCG Design Reference — Playmat, Aesthetic & Interaction Truth

**Sources:**
- `/Users/minamakar/Downloads/playsheet.pdf` — Official Bandai playmat
- `/Users/minamakar/Downloads/rule_manual.pdf` — Card-anatomy diagrams (p1–4) including the DON `+1000` card
- `/tmp/MOOgiwara/` — open-source OPTCG sim (Phaser, AGPL-3.0); read-only reference for layout + interaction patterns, NOT for code copy
- Owner design feedback (sessions 2026-05-29)

**Status:** Authoritative UI truth. The playfield, card art, hand, interaction model and visual aesthetic MUST conform to this doc.

**Hard NOs (owner-set, do not violate):**
- No green felt playmat. Cream paper is the brand surface.
- No "DON pill / token / chip" — DON are real cards (with `+1000` art).
- No flat hand row that overflows 430px width — hand is a mobile-tuned fan arc.
- No card-ID text labels ("red-5-2") as card art.
- Nothing overflows the 430px letterbox; respect safe-area-inset.

---

## 1. Official Bandai Single-Player Playmat

See playsheet.pdf p1. One player's half:

```
┌────────┬──────────────────────────────────────────────────────┐
│        │                                                      │
│        │              CHARACTER AREA                            │
│ LIFE   │  Up to 5 Character cards.                              │
│        │  Characters cannot attack on the turn played.          │
│ (5     │                                                       │
│ cards  ├───────────────────────────────────────────────────────┤
│ stacked│  PHASE     │  LEADER  │  STAGE  │  DECK                │
│ vert.  │  Refresh   │  CARD    │  CARD   │  (face-down)         │
│ on far │  Draw      │          │         │                       │
│ left)  │  DON!!     │          │         │                       │
│        │  Main      │          │         │                       │
│        │  End       │          │         │                       │
│        ├───────────────────────────────────────────────────────┤
├────────┤                                                       │
│ DON!!  │             COST AREA              │   TRASH           │
│ DECK   │   (Active + Rested DON cards live here)                │
└────────┴──────────────────────────────────────────────────────┘
```

### Zone-by-zone exact positions

| Zone | Position | Visual |
|---|---|---|
| **LIFE** | Far-LEFT vertical column, full height. 5 card-sized slots stacked top-to-bottom | Face-down cards (navy OP-compass back) |
| **CHARACTER AREA** | Top band, wide horizontal. 5 slots | Face-up, attacks cross border with opp |
| **Phase indicator** | Left of center mid-band, vertical column | Refresh → Draw → DON!! → Main → End chips |
| **LEADER CARD** | Center mid-band, single slot | Face-up, red OP-compass back if ever face-down (rare) |
| **STAGE CARD** | Right of leader, mid-band, single slot | Face-up |
| **DECK** | Far-right mid-band, single slot | Navy OP-compass back face-down |
| **DON!! DECK** | Bottom-LEFT corner, single slot | Teal/green OP-compass back face-down |
| **COST AREA** | Bottom-center, WIDE band | Active DON upright + rested DON 90°-rotated, both visible together |
| **TRASH** | Bottom-right corner, single slot | Face-up top card or "TRASH" label when empty |

---

## 2. Two-Player On-Screen Layout (Mirrored, Phone Portrait)

Target frame: **430px × 100dvh**, letterboxed (App.tsx). Inner content area = 430 − 32 = **398px** working width (16px inner padding both sides).

```
─────────────────────────────────────────────────────────────────  TOP (opp's far edge)
 OPP    [LIFE col, far-LEFT]    [Trash] [Cost Area band] [DON Deck]
                                [Deck]  [Stage] [Leader] [Phase col]
                                ─── CHARACTER AREA (5 slots, attacks ↓) ───
═════════════════════════════════════════════════════════════════  CONTACT ZONE
                                ─── CHARACTER AREA (5 slots, attacks ↑) ───
 YOU    [LIFE col, far-LEFT]    [Phase col] [Leader] [Stage] [Deck]
                                [DON Deck] [Cost Area band] [Trash]
─────────────────────────────────────────────────────────────────  BOTTOM (your near edge)
                                            HAND FAN (overlays bottom 24dvh)
```

LIFE columns hug the far-left edge for BOTH players (opp's at top-left, yours at bottom-left). All other zones mirror across the contact zone in the center.

### Vertical budget (dvh)

| Section | Height | Notes |
|---|---|---|
| App chrome (mode + theme toggles) | 6dvh | top edge |
| Opponent half | 30dvh | Char Area + Leader Row + Far Row |
| Contact zone strip | 4dvh | thin brass-canary glow line |
| Your half | 30dvh | Char Area + Leader Row + Far Row |
| Hand fan strip | 24dvh | bottom overlay, includes safe-area-inset-bottom |
| End-Turn button | floats bottom-right inside hand strip | |

If the device chrome is taller (notch, dynamic island), `safe-area-inset-top` expands the chrome strip; hand strip + bottom row reduce proportionally. Hand strip floor is 22dvh.

---

## 3. Visual Aesthetic — Cream Paper, NOT Felt

The playmat surface is **cream paper with a faint nautical/adventure overlay**, matching Crew Builder's brand. No tournament felt, no green table, no wood.

### Color tokens (from `src/index.css`)

| Token | Hex | Role |
|---|---|---|
| `--color-paper-cream` | `#F2E8D2` | Primary playmat surface (light theme) |
| `--color-paper-fog` | `#E2DCC9` | Secondary surface (zone borders, raised areas) |
| `--color-ink-black` | `#15140F` | Primary text |
| `--color-ink-iron` | `#3A372E` | Secondary text |
| `--color-hull-teal` | `#0F4549` | DON card front color + dark-theme accent |
| `--color-hull-deep` | `#082A2D` | Dark-theme primary surface |
| `--color-seal-red` | `#A8261F` | Red leader / urgent action |
| `--color-brass-canary` | `#D4A017` | DON `+1000` stamp + contact-zone line |
| `--color-marine-fog` | `#B8C7C9` | Empty-zone dashed outline color |
| `--color-sky-horizon` | `#C9DCE6` | Opponent half tint (subtle distance cue) |
| `--color-sky-day` | `#E8F0F4` | App background sky gradient top |
| `--color-sun-brass` | `#E8B43D` | Armed-DON glow + active phase chip |

**To remove from `src/index.css`:**
- `--color-felt-green`, `--color-felt-green-light`, `--color-felt-green-dark` (added 2026-05-29, owner rejected)
- `.felt-playmat` class

### Dark theme
Surface flips to `--color-hull-deep` / `--color-hull-teal`. DON cards stay teal-front with brass stamp (high contrast preserved). Cream paper accents become `paper-cream` text on hull-deep ground for legibility.

### Typography
- Display: **Lilita One** (used for power numbers, phase chips, mode toggles, app title)
- Body: **Nunito** (zone labels, aria text, card detail copy)

---

## 4. DON!! Card Rendering — Real `+1000` Art, NOT Pills

Per `rule_manual.pdf` p4, DON is a real card with:
- **Teal/green back** (DON deck face-down)
- **White front** with bold black `ド!!` strokes + `Your Turn +1000` stamp

### How to render in our build

**DON Deck slot (bottom-left corner of each half):**
- Single card-sized slot
- Teal OP-compass back design
- Stack indicator: count of remaining DON in `state.players[X].donDeck.length` (NOT the array — verified bug from prior commits)

**Cost Area band (bottom-center of each half):**
- Horizontal row of real DON card-front renders
- Active DON = upright (rotation 0°). Approx 30px × 42px each at scale 1
- Rested DON = rotated 90° with shifted origin so the card's bottom-left stays anchored to its position (per MOOgiwara `card.ts:117-128`: `setOrigin(0, 1); setRotation(Math.PI / 2)`)
- Horizontal spacing: MOOgiwara uses 75px per DON. Scaled to our 398px inner width / 10 DON capacity = ~28–32px per slot for us. Use **30px spacing**.
- Active appears at 100% opacity. Rested at 70% opacity.

**DON card-front content (compact at 30×42px):**
- Teal-green background (`--color-hull-teal`)
- Brass-canary inset ring (`--color-brass-canary` at 60% opacity)
- Center stamp: `+1000` in Lilita One, brass-canary color
- Optional: faint ド!! mark behind the stamp

**Attached DON (under a Leader/Character):**
- Per CR §6-5-5-1: must remain visible.
- Per MOOgiwara `player.ts:271-301`: implement as shrink animation to scale 0 onto the target. THEN show attached count as a small `+N×1000` chip overlay on the target card.
- We do NOT need to render each attached DON as a separate visible card — the count chip on the target is canonical.

---

## 5. Hand — Mobile-Tuned Fan, Pokemon TCG Live Pattern

**Hard NO from owner:** flat row that overflows 430px is unacceptable on a phone.

**Hard NO from owner:** wide-aggressive fan with cards tilted +/-30° is unacceptable (prior implementation).

**Target:** gentle arc that fits 5–10 cards inside 398px (430 − 32 padding) without clipping.

### Fan math spec

Implemented in `src/lib/fanLayout.ts` (verify + tune to match these constraints):

| Param | Value | Reason |
|---|---|---|
| Card width in hand | 56–64px | Tap-target sized for thumb; 5 cards × 64px = 320px |
| Arc width (max spread) | 280px (10 cards) → 220px (5 cards) | Always ≤ 398 − card width buffer |
| Arc lift (center card y offset) | -18px relative to ends | Subtle curve, not exaggerated |
| Rotation per card | **±8° max** at the edges | Was ±20°+ in prior build, too aggressive |
| Overlap | ~30–40% per card | All edges visible, identifiable |
| Origin | bottom-center of each card | Cards pivot from bottom edge (anchored fan) |

`fanPosition(i, n)` returns `{ x, y, rotate }`. Update so:
- When n ≤ 4, arc compresses to 160px width with ±4° rotation (less spread when fewer cards)
- When n ≥ 10, arc max 280px, ±8° rotation, overlap increases
- Center card sits at the bottom-arc apex; ends lift up symmetrically

### Interaction state machine

`src/store/game.ts` must expose `inspectedCardId: string | null`.

| State | Visual | Tap action |
|---|---|---|
| Resting in fan | Position per `fanPosition(i, n)` | Tap → enter Inspected state |
| Inspected (lifted) | Card translates up 60px, scales 1.15, rotates 0, z-index above siblings, OTHER cards dim 50% | Tap card again → open Detail Modal. Tap outside → return to fan |
| Detail Modal | See §6 below | |

Inspected state is the Pokemon TCG Live pattern: lift the card out of the fan so the player can read it without committing.

---

## 6. Card Detail Modal — Read-Then-Decide

Triggered by tapping an already-inspected card (§5).

```
┌──────────────────────────────────────┐
│ ╳   (close, top-right)               │
│                                       │
│        ╔═══════════════╗              │
│        ║               ║              │
│        ║  FULL CARD    ║   ← scaled 0.85
│        ║   ART HERE    ║      centered
│        ║               ║              │
│        ╚═══════════════╝              │
│                                       │
│   Effect text (full, scrollable):     │
│   ┌─────────────────────────────┐   │
│   │ [Activate:Main] [Once Per   │   │
│   │ Turn] Give this Leader…     │   │
│   └─────────────────────────────┘   │
│                                       │
│   [ PLAY (4 cost) ]   [ CANCEL ]     │
└──────────────────────────────────────┘
```

### Spec

- Full-screen overlay, `role="dialog" aria-modal="true"`
- Background: `rgba(0,0,0,0.55)` dim layer
- Card art: scaled 0.85 of viewport-fit, centered upper third
- Effect text: full printed effect text, scrollable if overflows
- Action buttons (vary by card kind + game state):
  - **Character:** `PLAY` (when affordable + ≤5 chars or replace-target picker), `CANCEL`
  - **Stage:** `PLAY` (replaces existing stage with confirm if applicable), `CANCEL`
  - **Event:** `PLAY MAIN` (during main phase), `CANCEL`. During Counter Step: `PLAY COUNTER` (if event has Counter)
  - **Counter card (Char with `counterValue > 0`):** during Counter Step: `USE COUNTER`, `CANCEL`
- Tap outside card / `╳` button / `CANCEL` button / `Esc` → close, return to inspected state
- Focus management: initial focus = PRIMARY action button; ESC closes; tab-trap inside modal

### MOOgiwara reference
- Their modal pattern: `/tmp/MOOgiwara/client/src/scenes/game_board_pop_ups.ts:31-97`
- Right-click → modal (full-screen semi-transparent + scaled card)
- They use long-hover for lighter preview (desktop). On mobile we use tap-to-lift (§5) instead of hover.

---

## 7. Field Card Interaction — Attach DON & Attack

**Bug found 2026-05-29:** `PlayfieldStage.tsx` never wires `onTap` on Leader/Character CardArt. Engine emits the legal actions but UI never dispatches → owner sees "can't attach DON, can't attack" (engine diagnosis agent).

### State extension (add to `src/store/game.ts`)

```ts
interface GameStore {
  // … existing …
  armedDonId: string | null;        // already exists in src/store/donArm.ts
  selectedAttackerId: string | null; // NEW
  inspectedCardId: string | null;    // NEW (per §5)
}
```

### Tap routing on Leader / Character cards

Single tap on a face-up field card:

```
if (armedDonId && targetBelongsToActivePlayer) {
   dispatch({ type: 'ATTACH_DON', targetInstanceId: cardId });
   clearArmedDon();
} else if (selectedAttackerId && targetBelongsToOpponent && opponentTargetIsLegal) {
   dispatch({ type: 'DECLARE_ATTACK', attackerInstanceId: selectedAttackerId, targetInstanceId: cardId });
   setSelectedAttackerId(null);
} else if (cardBelongsToActivePlayer && cardCanAttackThisTurn) {
   setSelectedAttackerId(cardId);   // select as attacker
} else {
   // tap a non-actionable card → inspect (open modal with read-only view)
   setInspectedCardId(cardId);
}
```

### Visual states for field cards

| State | Visual |
|---|---|
| Normal | Default render |
| Active and can attack | Subtle brass-canary edge glow |
| Rested | Rotated 90°, dimmed to 80% |
| Selected attacker | Brass-canary glowing ring + scaled 1.05 + lifts -8px |
| Pending attack target highlight (when attacker selected) | Pulsing seal-red dashed ring on legal opponent targets |
| DON-armed state (when an active DON is armed) | Friendly Leader + Characters get a pulsing brass-canary ring (drop-zones) |

### Attack target legality (CR §7-1-1-2)
Targets are: opponent's Leader, OR opponent's **RESTED** Characters. Active opp Characters are NOT valid targets — do not highlight them.

### Attack flow UX

1. Player taps own Leader/Character → enters "attacker selected" state
2. Legal opp targets pulse seal-red
3. Player taps a pulsing target → `DECLARE_ATTACK` dispatched, attacker animates an attack-line gesture to target (per MOOgiwara `game_handler.ts:726-750`)
4. Engine moves phase to `block_window` → opp prompt for Blocker (modal or banner)
5. Then `counter_window` → opp prompt for Counter
6. Damage Step → life-flip animation if leader, KO animation if char
7. Trigger window (if applicable) → TriggerPrompt modal

To CANCEL attacker selection: tap the same attacker again, or tap empty playmat space.

---

## 8. Phase Column

Vertical chip column on left of leader-row (each half).

```
┌────────────┐
│  Refresh   │ ← faded (passed)
│  Draw      │ ← faded
│  DON!!     │ ← faded
│  Main      │ ← ACTIVE (sun-brass bg, ink-black text)
│  End       │ ← faded (upcoming)
└────────────┘
```

- Chip width: 56px, height: 18px each
- Active chip: `bg-sun-brass text-ink-black`, `aria-current="step"`
- Inactive chips: `bg-marine-fog/30 text-ink-iron`
- Battle sub-phases (`block_window`, `counter_window`, `damage_step`, `trigger_window`) are nested under Main visually — show "Main → Battle" pill instead of flipping to a different chip.

---

## 9. End-Turn Button — Phase-Reactive Text

Single button, bottom-right corner of the screen (inside hand strip area). Text + behavior changes by phase:

| Phase / state | Button text | Enabled? | Action on tap |
|---|---|---|---|
| Your `main` phase | **END TURN** | yes | dispatch `END_TURN` |
| Your `block_window` / `counter_window` (impossible — you're attacker) | — | — | — |
| Your `attack_declaration` / `damage_step` | **ATTACKING…** | no | — |
| Your `trigger_window` | **TRIGGER…** | no (use TriggerPrompt modal) | — |
| Opp's any phase | **OPPONENT'S TURN** | no | — |
| Opp's `block_window` (you're defender) | **DECLINE BLOCK** | yes | dispatch `SKIP_BLOCKER` |
| Opp's `counter_window` (you're defender) | **DECLINE COUNTER** | yes | dispatch `SKIP_COUNTER` |
| Game over | **GAME OVER** | no | — |

Position: bottom-right, `right: 16px`, `bottom: calc(24dvh + 16px + env(safe-area-inset-bottom, 0px))`. Floats above the hand strip but does NOT overlap leader or other zones. Owner caught the prior overlap (commit `0ea7edb`) — keep it tight to the bottom-right.

---

## 10. Edge Padding & Safe Areas

**Rules — nothing crosses the letterbox or notch:**
- Outer letterbox: 430px max width, centered, with vertical letterbox bars on wider viewports.
- Inner playfield uses `padding: 0 16px` (left + right) so zones never touch the curved corner / safe-area-inset.
- Top: `padding-top: calc(env(safe-area-inset-top, 0px) + 6dvh)` so app chrome (mode toggles) sits below the notch/dynamic island.
- Bottom: `padding-bottom: env(safe-area-inset-bottom, 0px)`. Hand strip + End-Turn button both account for this.
- LIFE column: hugs left edge but inside the 16px padding (so leftmost card edge sits at x=16px, not x=0).
- Trash + DON Deck corners: sit inside the 16px padding too. They don't touch the actual viewport edges.

**Verification target:** load the deployed preview at 430×844 (iPhone Mini sim) and 390×844 (iPhone 13 mini). Zero scrollbars, zero clipped cards, zero overlap with safe-area.

---

## 11. Reference Patterns from MOOgiwara (file:line)

Read-only study. Concepts to adopt, code NOT to copy (AGPL-3.0 incompatible).

| Concept | MOOgiwara file:line | What we copy |
|---|---|---|
| DON as real card with `+1000` art | `client/src/handlers/game_handler.ts:162` + `client/public/cards/donCardAltArt.png` | Render real card art, not pills |
| Active vs rested rotation | `client/src/game/card.ts:117-128` (`setOrigin(0,1); setRotation(Math.PI/2)`) | Origin-shifted 90° rotation for rested DON |
| DON spacing in cost area | `client/src/game/card.ts:81-86` (75px per DON, 100px per non-DON) | Tighter spacing for DON than for face-up Chars/Events |
| DON attach animation | `client/src/game/player.ts:271-301` (shrink to scale 0 onto target) | Spring shrink animation, target gains +1000 power text |
| Attack drag-line gesture | `client/src/handlers/game_handler.ts:726-750` (red line from source to cursor) | Visual attack-line during target select |
| End Turn text by phase | `client/src/handlers/ui_handler.ts:47-85` (5 states: END TURN / ATTACKING… / OPPONENT'S TURN / BLOCKING… / COUNTERING…) | Single button, phase-reactive text |
| Card detail = modal overlay | `client/src/scenes/game_board_pop_ups.ts:31-97` (full-screen semi-transparent + scaled card) | Same pattern — tap (mobile) instead of right-click (desktop) |
| Player state enum gates UI | `client/src/game/player.ts:8-20` (LOADING / MULLIGAN / OPPONENTS_TURN / MAIN_PHASE / etc.) | Use engine `phase` as source of truth; UI gates affordances |
| Resting = attackable (inverted from typical TCG) | `client/src/game/card.ts:200-203` (`isAttackable() { return this.isResting; }`) | Already correct in our `legality.ts:118` |
| 5-slot character limit | `client/src/game/player.ts:230-234` | Already correct in our `RULES.MAX_CHARACTERS_ON_FIELD` |
| 1920×1080 hardcoded (we DON'T copy this) | MOOgiwara is desktop-only, no mobile support | We do mobile-portrait 430px — DIFFERENT design |
| Visual: parchment / aged paper / illustrated board | MOOgiwara `client/src/scenes/game_board.ts:69-70` | Cream paper is consistent — confirms the "no felt" direction |

---

## 12. Current Implementation Divergences

Audited 2026-05-29 against UI commit `0ea7edb` + engine `a84f87d`.

### 12.1 Closed (fixed by prior commits)

- ✅ **L1 LIFE column** — `LifeStack` renders as far-left column (UI commit `0ea7edb`)
- ✅ **L2 CHARACTER AREA at top of half** — fixed in `PlayfieldStage` row order
- ✅ **L3 STAGE / LEADER / DECK row** — Stage slot now renders (zone component `StageSlot.tsx` added)
- ✅ **L4 DON DECK corner** — `DonDeckSlot.tsx` renders count
- ✅ **L6 TRASH corner** — `TrashSlot.tsx` renders top card
- ✅ **L7 Phase column** — `PhaseColumn.tsx` shipped
- ✅ **L9 End-Turn overlap** — moved bottom-right (commit `0ea7edb`)

### 12.2 OPEN — MUST FIX

| # | Divergence | Severity |
|---|---|---|
| L10 | **Felt-green playmat** is wrong (owner rejected 2026-05-29). Revert to cream paper. Remove `--color-felt-green*` tokens and `.felt-playmat` class from `index.css` | BLOCKER |
| L11 | **DON cards render as "+1000" stamp chips** (`CostAreaBand.tsx:36-46`), not real DON `+1000` card art. Replace with proper card design (teal back / white front with brass `+1000` stamp + ド!! mark) | BLOCKER |
| L12 | **Hand fan is too aggressive on mobile** — prior screenshot showed cards angled hard + cut off by viewport edge. Tighten `fanPosition` math per §5 (±8° max rotation, ≤280px arc width, 5-card compress mode) | BLOCKER |
| L13 | **No tap-to-lift / inspect state** — `HandFan.tsx:30-37` dispatches `PLAY_CARD` immediately on tap. No way for owner to read card before deciding. Add `inspectedCardId` state + lift animation + second-tap → modal flow (per §5 + §6) | BLOCKER |
| L14 | **No card detail modal** — there's no component that opens a full-card-art + effect-text view with action buttons. Build `CardDetailModal.tsx` per §6 | BLOCKER |
| L15 | **Field cards (Leader, Character) have no tap handlers** — `PlayfieldStage.tsx` renders `<CardArt …>` without `onTap`. Owner can't attach DON, can't attack. Wire per §7 tap-routing logic | BLOCKER |
| L16 | **No selected-attacker state** — `src/store/game.ts` has no `selectedAttackerId`. Add per §7 | BLOCKER |
| L17 | **No attack-target highlighting** — when attacker selected, opp legal targets should pulse seal-red. Not implemented | BLOCKER |
| L18 | **Edge-overflow** — prior screenshot showed DON cost row touching top edge, hand cards cut off right. Enforce `padding: 0 16px` and verify nothing protrudes (per §10) | BLOCKER |
| L19 | **End-Turn button text doesn't change by phase** — currently static "END TURN". Implement phase-reactive text per §9 (5+ states) | HIGH |
| L20 | **Orphan files on disk** — `PhaseRibbon.tsx`, `zones/CostAreaStrip.tsx`, `zones/DonRested.tsx` are no longer imported but still exist. Delete in cleanup commit | LOW |
| L21 | **`CardArt` placeholders show card ID text ("red-5-2") instead of real art** — for unstubbed cards, render a proper placeholder card design (cost chip, power, name slot, art bg) not the raw ID | HIGH |
| L22 | **Attached DON not visualized** — when DON attached to char/leader, only the engine state changes; UI doesn't show a "+1000 ×N" power chip on the target. Add per §4 | HIGH |
| L23 | **Battle sub-phase modals not built** — when defender enters `block_window` / `counter_window`, no UI prompts them to act. Build banner or modal per §7 step 4–5 | HIGH |

### 12.3 Polish (deferred)

- Drag-line attack gesture (alt to 2-tap) — MOOgiwara pattern, optional V1.x
- Long-hover preview (desktop only) — optional
- Sound effects + haptics
