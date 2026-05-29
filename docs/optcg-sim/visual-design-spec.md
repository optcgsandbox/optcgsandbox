# OPTCG Sim — Visual Design Spec (UX Architect Final)

**Status:** Authoritative visual truth for the four items called out in `docs/optcg-sim/design-reference.md` §12.2 L11, L12, L13, L14, L21. Frontend Developer implements from this file; do not deviate without owner sign-off.

**Frame:** mobile-first, portrait, 430px max-width letterbox. Inner working width 398px (430 − 32 padding). Cream-paper aesthetic per design-reference §3 — **no felt-green, no DON pills.**

**Brand pillars (per owner brief):**
- Bright, adventurous One Piece anime energy on a cream-paper ground
- Subtle nautical / treasure-map accents (NEVER literal pirate clipart)
- Core palette: cream + ink-black + brass + seal-red; teal/sky as accents
- Every glyph readable at thumb-distance on a 430×844 phone

**Token alias used throughout this spec** (already in `src/index.css`):

| Alias | Token | Hex |
|---|---|---|
| cream | `--color-paper-cream` | `#F2E8D2` |
| fog | `--color-paper-fog` | `#E2DCC9` |
| ink | `--color-ink-black` | `#15140F` |
| iron | `--color-ink-iron` | `#3A372E` |
| teal | `--color-hull-teal` | `#0F4549` |
| deep | `--color-hull-deep` | `#082A2D` |
| red | `--color-seal-red` | `#A8261F` |
| brass | `--color-brass-canary` | `#D4A017` |
| sun | `--color-sun-brass` | `#E8B43D` |
| fog-marine | `--color-marine-fog` | `#B8C7C9` |

No new color tokens are required for these four deliverables. Two new **semantic** tokens are introduced so the cards don't hardcode hex (see §5).

---

## 1. DON Card Visual Design Spec

Closes design-reference.md §12.2 **L11**. Replaces the rejected `+1000` chip rendering in `CostAreaBand.tsx:36-46`.

### 1.1 Source-of-truth recap (Bandai DON, rule_manual.pdf p4)

- **Front:** off-white card with explosive black radial speed-lines bursting from upper-mid. Giant black `ド!!` katakana strokes dominate the top two-thirds (slight forward lean, drop-shadow style brush). A thin "DON!! CARD" microtype label sits at the bottom of the art. A solid black band caps the bottom holding "Your Turn  +1000" in white sans.
- **Back:** off-white ground with a TEAL compass-rose (same compass anatomy as the navy character-card back, but recolored teal `#0F4549`). The X-circle "ONE PIECE / CARD GAME" wordmark sits below the compass in teal.

### 1.2 Our brand-matched DON front — token-level spec

We deliberately do NOT clone the Bandai card 1:1 (IP). We build the same SILHOUETTE — a black "ど!!" mark over white-cream with brass `+1000` at the bottom — using our token palette so it sits inside the cream-paper playmat without clashing.

**Base size:** 30 × 42 px (matches existing `DON_CARD_W/H` in `CostAreaBand.tsx`). Scales proportionally.

```
 30px wide × 42px tall (base scale)
 ┌──────────────────────────────┐  ← stroke 0.75px, ink, radius 3px
 │·  ·  ·   speed lines   ·  · │   (12 radial dashes from center,
 │ ·    \\\  |  ///    ·       │    ink @ 18% opacity, length 6px)
 │       \\ | //               │
 │   ┌──────────────────┐      │
 │   │   ┌─┐┌─┐         │      │  ← ど!! mark
 │   │   │ ││ │ !!      │      │    Lilita One 14px,
 │   │   └─┘└─┘         │      │    ink, slight 4° forward
 │   └──────────────────┘      │    lean, drop-shadow
 │      brass underline 1px    │    (0 1px 0 cream)
 │ ╔════════════════════════╗  │
 │ ║ +1000   (brass stamp)  ║  │  ← bottom band, ink fill
 │ ╚════════════════════════╝  │    +1000 in Lilita One 9px
 └──────────────────────────────┘    brass, tracking +0.04em
   shadow: 0 2px 4px ink/35%
```

### 1.3 Front — element table

| Element | Geometry | Fill | Stroke | Type | Notes |
|---|---|---|---|---|---|
| Card body | 30×42, radius 3px | cream `#F2E8D2` | ink 0.75px | — | Slight paper grain via existing `.paper-grain` |
| Speed-line burst | 12 radial dashes from (50%, 38%), length 6px, width 0.5px | ink @ 18% | — | — | Decorative only; `aria-hidden` |
| ど!! mark | Centered at (50%, 42%), height ~14px | ink | — | Lilita One 14px / 600 / leading 1, letter-spacing −0.02em, transform `rotate(-4deg)` | Drop shadow `0 1px 0 cream` so it reads on the busy speed-line field |
| Underline accent | 8px wide × 0.75px tall, beneath ど!!, brass | brass | — | — | Subtle nautical "stamp" cue |
| Bottom band | Full width × 12px tall, anchored bottom | ink | — | — | Radius 0 0 3px 3px |
| `+1000` stamp | Centered in bottom band | — | — | Lilita One 9px / 600 / tabular, brass | letter-spacing +0.04em |
| Outer drop shadow | `0 2px 4px rgba(15,20,15,0.35)` | — | — | — | Only when active |
| Rested treatment | `transform: rotate(90deg)`; `transform-origin: 0 100%` so the card pivots around its bottom-left, anchoring slot position (per MOOgiwara `card.ts:117-128`) | — | — | — | Opacity drops to 0.72 |

### 1.4 Front — armed (selected) state

When `armedDonId === this.instanceId`:
- Add pulsing ring: `box-shadow: 0 0 0 2px sun, 0 0 8px sun-alpha-50` looping 1s ease-in-out
- Scale 1 ↔ 1.08 on the same loop
- Lift -2px Y
- `aria-pressed=true`

When rested:
- 90° rotation as above
- Pointer-events: none, opacity 0.72, no shadow
- `aria-label="Rested DON, +1000 power, spent this turn"`

### 1.5 DON Deck back — token-level spec

Base size: 36 × 50 px (matches `--zone-don-deck-w: 36px` in `index.css`). One slot, sits in bottom-left corner of each half.

```
 36px wide × 50px tall
 ┌────────────────────────────────┐  ← cream body, ink hairline,
 │  ·  ·  ·  ·  ·  ·  ·  ·  ·  · │     radius 3px, brass inset 1px
 │   ╲   _______   ╱             │
 │      ╱       ╲                │  ← compass rose: 3 concentric
 │     │   ●─────│─────►          │     teal rings + tick marks +
 │      ╲_______╱                │     single radar needle pointing
 │   ╱             ╲             │     NE (45°)
 │  ·  ·  ·  ·  ·  ·  ·  ·  ·  · │
 │                                │
 │   ⊗ ONE PIECE                  │  ← X-circle + wordmark in teal,
 │     CREW SIM                   │     Lilita One 5px caps,
 │                                │     letter-spacing +0.08em
 │  count chip: ┌──┐              │  ← optional bottom-right chip
 │              │10│              │     when count > 0 (see 1.6)
 │              └──┘              │
 └────────────────────────────────┘
   shadow: 0 1px 3px ink/30%
```

### 1.6 Back — element table

| Element | Geometry | Fill | Stroke | Type | Notes |
|---|---|---|---|---|---|
| Card body | 36×50, radius 3px | cream | ink 0.5px | — | Inset 1px brass ring at 35% opacity |
| Map crosshatch | Faint diagonal crosshatch behind compass | teal @ 6% | — | — | Decorative; treasure-map texture cue |
| Compass rings | 3 concentric circles centered (50%, 38%), radii 6/9/12px | none | teal 0.75px | — | Outer ring has 24 evenly-spaced 1px tick marks |
| Compass needle | Diamond/spear, points NE (45°) | teal | — | — | 12px long, 2px wide at fattest |
| Crosshair lines | Vertical + horizontal through center, full card width, 0.5px | teal @ 40% | — | — | Stops 2px from edges |
| Wordmark | "⊗ CREW SIM" or "CREW BUILDER SIM" centered (50%, 75%) | teal | — | Lilita One 5px caps, letter-spacing +0.08em | We use our app name, NOT "ONE PIECE CARD GAME" (trademark) |
| Count chip | 12×8 px chip, anchored bottom-right inset 2px | brass | ink 0.5px | Lilita One 6px tabular ink | Shows remaining DON deck count |
| Drop shadow | `0 1px 3px rgba(15,20,15,0.30)` | — | — | — | Always on |

### 1.7 Why this design

- **Cream body, not teal body** — keeps the DON deck slot from competing with the bottom-band ink panel on the playmat. Cream + brass + teal accent reads "ours" while echoing the Bandai DON back's compass anatomy.
- **Brass `+1000` stamp** — `--color-brass-canary` is already the contact-zone glow and active-phase color. Reusing it on the DON front threads brand consistency across the whole UI.
- **ど!! mark in ink, not teal** — black-on-cream is the highest-contrast pair in our palette; the mark must read instantly even at 30×42px.
- **No "ONE PIECE CARD GAME" text** — replaced with our own brand wordmark to keep the sim trademark-clean (per MOOgiwara legal posture, see `optcgsandbox_moogiwara_reference.md`).

### 1.8 Dark theme deltas

Dark theme flips the field surface to deep, but the DON card body STAYS cream (brand recognition + contrast preserved). Adjust only:
- Drop shadow deepens to `0 2px 6px rgba(0,0,0,0.55)`
- Outer 1px ink stroke becomes 0.5px brass for separation from the dark field

---

## 2. Card Detail Modal Layout

Closes design-reference.md §12.2 **L14**. New component: `CardDetailModal.tsx`.

### 2.1 Frame and overlay

```
 ┌─────────── 430 × 844 viewport ───────────┐
 │░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│ ← backdrop:
 │░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│   rgba(15,20,15,0.62)
 │░░░░░░░░░░░ safe-area-top ░░░░░░░░░░░░░░░░│   + backdrop-blur 4px
 │░░░░  ┌──────────────────────────────┐░░░░│
 │░░░░  │ ╳ close                      │░░░░│ ← modal panel:
 │░░░░  │                              │░░░░│   386 × 720 max
 │░░░░  │   ╔════════════════════╗     │░░░░│   centered horizontally
 │░░░░  │   ║                    ║     │░░░░│   sticks to top with
 │░░░░  │   ║                    ║     │░░░░│   24px gap below
 │░░░░  │   ║   FULL CARD ART    ║     │░░░░│   safe-area-top
 │░░░░  │   ║   (220 × 308 px,   ║     │░░░░│
 │░░░░  │   ║   actual card ratio║     │░░░░│
 │░░░░  │   ║   5:7)             ║     │░░░░│
 │░░░░  │   ║                    ║     │░░░░│
 │░░░░  │   ╚════════════════════╝     │░░░░│
 │░░░░  │                              │░░░░│
 │░░░░  │  ┌─────────┐   ┌─────────┐   │░░░░│ ← meta strip:
 │░░░░  │  │ ⊙ cost  │   │ ⚔ power │   │░░░░│   cost + power
 │░░░░  │  │   3     │   │  5000   │   │░░░░│   pills (per kind)
 │░░░░  │  └─────────┘   └─────────┘   │░░░░│
 │░░░░  │                              │░░░░│
 │░░░░  │  Monkey D. Luffy             │░░░░│ ← name (Lilita 18px)
 │░░░░  │  CHARACTER · Straw Hat Crew  │░░░░│   kind · traits row
 │░░░░  │                              │░░░░│
 │░░░░  │  ┌──────────────────────┐    │░░░░│
 │░░░░  │  │ [Activate:Main]      │    │░░░░│ ← scrollable effect
 │░░░░  │  │ [Once Per Turn]      │    │░░░░│   text box,
 │░░░░  │  │ Give this Leader     │    │░░░░│   max-height 160px,
 │░░░░  │  │ up to 1 rested DON.. │    │░░░░│   inset shadow
 │░░░░  │  │                      │    │░░░░│
 │░░░░  │  └──────────────────────┘    │░░░░│
 │░░░░  │                              │░░░░│
 │░░░░  │  ┌──────────────┐ ┌────────┐ │░░░░│ ← actions row:
 │░░░░  │  │ PLAY · 4 ⊙   │ │ CANCEL │ │░░░░│   primary + secondary
 │░░░░  │  └──────────────┘ └────────┘ │░░░░│
 │░░░░  │                              │░░░░│
 │░░░░  └──────────────────────────────┘░░░░│
 │░░░░░░░░░░░ safe-area-bottom ░░░░░░░░░░░░░│
 └───────────────────────────────────────────┘
```

### 2.2 Backdrop

| Property | Value |
|---|---|
| Background | `rgba(15, 20, 15, 0.62)` (ink @ 62%) |
| Backdrop filter | `blur(4px) saturate(0.85)` |
| Tap | Dismisses modal (returns to inspected state in fan) |
| Animation | Fade in 180ms ease-out; fade out 140ms ease-in |

### 2.3 Modal panel

| Property | Value |
|---|---|
| Width | `min(386px, calc(100vw - 32px))` |
| Max-height | `calc(100dvh - safe-area-top - safe-area-bottom - 48px)` |
| Background | cream (`#F2E8D2`) |
| Border | 1px ink at 35% |
| Border-radius | 14px |
| Shadow | `0 12px 32px rgba(15,20,15,0.45), 0 0 0 1px var(--color-brass-canary) inset` (subtle brass inset hairline — nautical seal cue) |
| Padding | 16px horizontal, 14px top, 16px bottom |
| Animation in | scale 0.92 → 1, opacity 0 → 1, 220ms cubic-bezier(0.2, 0.9, 0.3, 1) |
| Animation out | scale 1 → 0.96, opacity 1 → 0, 160ms ease-in |
| `role` | `dialog` |
| `aria-modal` | `true` |
| `aria-labelledby` | id of name element |
| Focus management | Initial focus = primary action button; tab-trap inside; ESC closes |

### 2.4 Element stack (top to bottom)

| Slot | Height | Notes |
|---|---|---|
| Close button row | 32px | `╳` icon button, top-right inset 4px, 32×32 tap target, ink @ 65%, `aria-label="Close card details"` |
| Card art | 308px | 220×308 (5:7 ratio), centered horizontally, drop shadow `0 4px 12px rgba(15,20,15,0.35)`, radius 8px |
| Spacer | 12px | — |
| Meta strip | 36px | Cost pill (left) + Power pill (right), gap 12px, centered |
| Spacer | 10px | — |
| Name | line-height 22px | Lilita One 18px ink, centered |
| Sub | line-height 14px | Nunito 11px iron, letter-spacing +0.04em uppercase, centered, format: `KIND · trait1 / trait2` |
| Spacer | 12px | — |
| Effect box | max 160px scroll | See 2.5 |
| Spacer | 14px | — |
| Action row | 44px tap-target | See 2.6 |

### 2.5 Effect box

| Property | Value |
|---|---|
| Background | fog (`#E2DCC9`) |
| Border | 1px ink @ 20% |
| Border-radius | 8px |
| Padding | 10px 12px |
| Type | Nunito 13px / 1.45 leading, ink |
| Max-height | 160px, vertical scroll if overflows |
| Scrollbar | `scrollbar-width: none` (consistent with `feedback_bullets_not_essays.md` hidden-scrollbar convention) |
| Keyword pills inside | inline `<span>` per keyword: `[Activate:Main]`, `[Once Per Turn]`, `[Counter]`, `[Trigger]`, `[Blocker]`, `[When Attacking]`, `[On Play]`, etc. Each: 11px Lilita One, 2px 6px padding, ink-on-brass for `[Trigger]`, ink-on-sun for `[Counter]`, cream-on-teal for everything else, radius 3px |

### 2.6 Action row — per card kind / per phase

Buttons are 44px tall (Apple HIG minimum), 14px Lilita One, letter-spacing +0.06em uppercase. Primary is filled; secondary is outlined.

| Card kind | Phase | Primary button | Secondary |
|---|---|---|---|
| Character | Your main, affordable, char slots < 5 | `PLAY · {cost} ⊙` filled teal/cream | `CANCEL` outlined ink |
| Character | Your main, affordable, char slots == 5 | `REPLACE…` filled teal/cream (opens replace picker) | `CANCEL` |
| Character | Your main, NOT affordable | `PLAY · {cost} ⊙` disabled (50% opacity, cursor not-allowed) | `CLOSE` |
| Character | Opp's `counter_window`, `counterValue > 0` | `USE COUNTER · +{value}` filled red/cream | `DECLINE` outlined ink |
| Event | Your main, affordable | `PLAY MAIN · {cost} ⊙` filled teal/cream | `CANCEL` |
| Event | Opp's `counter_window`, has Counter clause | `PLAY COUNTER · {cost} ⊙` filled red/cream | `DECLINE` |
| Stage | Your main, affordable | `PLAY · {cost} ⊙` filled teal/cream (if stage occupied: confirm-replace banner appears) | `CANCEL` |
| Leader (tap on field) | any | (no PLAY action) | `CLOSE` |
| Any | Game over | (no actions) | `CLOSE` |

**Primary button visual:**
- Background: teal (red variant for Counter/Counter-event)
- Text: cream
- Border-radius: 22px (full pill)
- Padding: 0 18px
- Min-width: 140px
- Shadow: `0 2px 0 rgba(15,20,15,0.30)` (flat under-stamp shadow, treasure-map seal vibe)
- Active state: translate-Y +1px, shadow collapses to `0 0 0 0`

**Secondary button visual:**
- Background: transparent
- Text: ink
- Border: 1.5px ink
- Border-radius: 22px
- Padding: 0 18px
- Min-width: 96px

**Cost glyph `⊙`:** a 12px filled circle in brass with a `+1000`-style inset ring, inline before the cost number.

### 2.7 Cost / Power pills (meta strip)

| Property | Cost pill | Power pill |
|---|---|---|
| Width | 88px | 88px |
| Height | 36px |
| Background | cream with brass 1.5px ring | cream with seal-red 1.5px ring |
| Icon | `⊙` brass 14px | `⚔` red 14px (for char/leader); hidden for event/stage |
| Number | Lilita One 18px tabular, ink | Lilita One 18px tabular, ink |
| Label | "COST" 8px caps brass | "POWER" 8px caps red |

Event cards show only Cost pill (Power pill hidden). Stage cards show only Cost pill. Leader shows Power but not Cost (cost pill hidden).

### 2.8 Dark theme deltas

- Modal panel background → `--color-hull-deep` (`#082A2D`)
- Effect box → `--color-hull-teal` (`#0F4549`) with cream text
- Pills swap to deep ground with brass/red ring; numbers in cream
- Backdrop opacity stays 0.62 but the blur becomes more visible

### 2.9 Reduced motion

If `prefers-reduced-motion: reduce`, drop the scale-in animation (use opacity only) and drop the backdrop blur (use solid `rgba(0,0,0,0.7)` instead — much cheaper to paint).

---

## 3. Hand Fan Mobile-Tuned Math

Closes design-reference.md §12.2 **L12** and **L13**. Replaces `src/lib/fanLayout.ts:fanPosition` and the resting `HandFan.tsx` behavior (which currently dispatches `PLAY_CARD` on first tap).

### 3.1 Geometry constraints

All values are absolute pixels in the fan's local coordinate space. The fan container is centered horizontally inside the 398px inner width; cards are positioned around `x=0` (center).

| Constraint | Value |
|---|---|
| Phone frame inner width | **398px** (430 − 32 padding) |
| Hand card width | **64px** (was 92px — current is too wide for fan math) |
| Hand card height | **90px** (5:7 ratio rounded to 64×90) |
| Max horizontal spread (10 cards, edge-to-edge of outer card centers) | **240px** |
| Max horizontal spread (5–6 cards) | **180px** |
| Min horizontal spread (1–4 cards) | **140px** |
| Total footprint allowed (outermost left edge → outermost right edge) | **304px** (240 + card width 64), well under the 398 inner width |
| Max edge rotation | **±8°** |
| Min edge rotation (1–4 cards) | **±4°** |
| Center card lift (negative Y, since up-screen is negative) | **−14px** at the apex |
| Edges Y | **0** (anchor line) |
| Card pivot | bottom-center (`transform-origin: 50% 100%`) |

### 3.2 Per-card position formulas (plain language)

Given:
- `n` = number of cards in hand (1–10)
- `i` = card index (0 = leftmost, `n−1` = rightmost)
- `center = (n − 1) / 2` (the floating-point center index; for n=5, center=2)
- `offset = i − center` (a value in `[-center, +center]`)
- `normalized = offset / max(center, 1)` (a value in `[-1, +1]`)

Compute three values per card:

**(a) Horizontal position `x(i, n)`** — even linear spacing, total span scales with `n`:
```
spread = lerp(
  140,          // when n ≤ 4
  240,          // when n ≥ 10
  clamp((n − 4) / 6, 0, 1)
)
spacing = spread / max(n − 1, 1)
x = offset * spacing
```

For `n = 1`, `spacing` is irrelevant; force `x = 0`.

**(b) Vertical lift `y(i, n)`** — parabolic, center card sits −14px, edges at 0:
```
y = -14 * (1 − normalized * normalized)
```

(Negative because the fan container uses standard CSS Y axis where down is positive; we apply `transform: translateY(y)` so a negative value lifts the card up-screen.)

For `n = 1`, `y = -14` (single card sits at center apex).

**(c) Rotation `rotate(i, n)`** — linear edge-tilt, scales with `n`:
```
maxRotateDeg = lerp(
  4,            // when n ≤ 4
  8,            // when n ≥ 10
  clamp((n − 4) / 6, 0, 1)
)
rotate = maxRotateDeg * normalized
```

Center card always rotates 0° (because `normalized = 0` at center).

### 3.3 Worked examples (sanity table)

For a developer to verify the implementation, here are exact values at `n = 1, 4, 7, 10`:

| n=1, i=0 | x=0    | y=-14  | rotate=0° |
|---|---|---|---|

| n=4 (compress mode), spread=140, spacing=46.7, maxRot=4° |
|---|
| i=0: offset=-1.5, normalized=-1.0, x=-70.0, y=0,    rotate=-4.0° |
| i=1: offset=-0.5, normalized=-0.33, x=-23.3, y=-12.4, rotate=-1.33° |
| i=2: offset=+0.5, normalized=+0.33, x=+23.3, y=-12.4, rotate=+1.33° |
| i=3: offset=+1.5, normalized=+1.0, x=+70.0, y=0,    rotate=+4.0° |

| n=7, spread=lerp(140,240, 3/6)=190, spacing=31.67, maxRot=lerp(4,8,3/6)=6° |
|---|
| i=0: offset=-3, normalized=-1.0, x=-95.0, y=0,    rotate=-6.0° |
| i=3: offset=0,  normalized=0,    x=0,     y=-14,  rotate=0° |
| i=6: offset=+3, normalized=+1.0, x=+95.0, y=0,    rotate=+6.0° |

| n=10, spread=240, spacing=26.67, maxRot=8° |
|---|
| i=0: offset=-4.5, x=-120.0, y=0,    rotate=-8.0° |
| i=4: offset=-0.5, x=-13.3,  y=-13.4, rotate=-0.89° |
| i=5: offset=+0.5, x=+13.3,  y=-13.4, rotate=+0.89° |
| i=9: offset=+4.5, x=+120.0, y=0,    rotate=+8.0° |

**Verification:** at n=10, the outermost card center sits at x=±120. With card half-width 32, the outer edge sits at ±152. Fan footprint is 304px, comfortably inside 398px inner width — zero clipping. ✓

### 3.4 Overlap behavior

Overlap is implicit: cards are 64px wide and (at n=10) spaced 26.67px apart. Each card covers about 58% of the next, leaving a 42% sliver showing. At n=4 spacing is 46.67px — cards overlap ~27%, plenty of card visible.

This sits squarely inside the design-reference §5 target of "30–40% per card reveal" while accommodating both extremes.

### 3.5 Inspected state — single-card lift

When `inspectedCardId === instance.id`, OVERRIDE the fan position with:

| Property | Value | Notes |
|---|---|---|
| `x` | unchanged from `fanPosition` | Card stays at its fan slot horizontally |
| `y` | `-60` | Translates up 60px above the resting line |
| `rotate` | `0deg` | Returns to upright |
| `scale` | `1.15` | Grows enough to read |
| `z-index` | `40` | Sits above sibling cards (which are z-index 20–29 based on `i`) |
| Transition | spring `{ stiffness: 280, damping: 22 }` for x/y/rotate; tween 180ms ease-out for scale | Existing `springs.handFan` close enough; add scale tween |

Other cards (`inspectedCardId !== null && id !== inspectedCardId`) dim:
- `opacity: 0.5`
- `filter: saturate(0.7)`
- Stay at their fan position (do NOT shift to make room — the lifted card sits in its own slot, ABOVE the others)

`pointer-events`: dimmed cards remain tappable (tap on a different card switches `inspectedCardId` to that one). Tap on the lifted card itself = open Detail Modal (§2). Tap outside the fan = clear `inspectedCardId`.

### 3.6 z-index ladder inside the fan

| State | z-index |
|---|---|
| Resting card | `20 + i` (so right-most card layers above the one to its left — natural "fan of cards in hand" layering) |
| Hovered (if pointer device, optional) | `30` |
| Inspected (lifted) | `40` |
| Modal backdrop (§2) | `50` |
| Modal panel (§2) | `51` |

### 3.7 Reduced motion

If `prefers-reduced-motion: reduce`:
- Cards still arrange via `fanPosition` (it's layout, not motion)
- Drop the inspected lift's spring; use a 120ms tween for translation and scale
- Drop the dim filter; reduce siblings to `opacity: 0.55` (no `saturate()`)

### 3.8 Resize / orientation

This sim is portrait-only (per `phone_only_v1_decision`). If the user rotates, the App.tsx letterbox stays portrait. No additional fan math needed.

### 3.9 Tap behavior summary (state machine)

| Current `inspectedCardId` | Tap target | Result |
|---|---|---|
| `null` | Any hand card | `setInspectedCardId(thatCardId)` — card lifts, others dim |
| `null` | Empty playmat | no-op |
| `=== thatId` | Same hand card | open `CardDetailModal` for `thatId` |
| `=== otherId` | Different hand card | `setInspectedCardId(thatId)` — switch which card is lifted |
| `=== thatId` | Empty playmat | `setInspectedCardId(null)` — card returns to fan slot |

Note: `HandFan` itself MUST NOT dispatch `PLAY_CARD` directly anymore. The modal is the only place a `PLAY_CARD` action originates from the hand.

---

## 4. Card Placeholder Design

Closes design-reference.md §12.2 **L21**. Replaces the current "raw card ID as art" rendering in `CardArt.tsx`.

This is the visual that ships when a card has no commissioned art yet — i.e. 100% of cards at launch. It should look like a One Piece card so the playfield reads correctly; it should not look like a debug stub.

### 4.1 Frame anatomy

We mirror the Bandai character-card anatomy (rule_manual.pdf p2) but with our brand palette instead of Bandai art. Anatomy:

```
 64 × 90 px (hand size) — scales to 88×124 (field), 220×308 (modal)
 ┌─────────────────────────────────┐  ← outer body, color-tinted by
 │ ╔═╗                       ╔══╗ │     card.colors[0], radius 4px,
 │ ║3║                       ║5K║ │     ink 0.75px stroke
 │ ╚═╝                       ╚══╝ │  ← cost square (top-left)
 │                                 │     + power stamp (top-right)
 │                                 │
 │         ┌─────────────┐         │
 │         │             │         │  ← art slot: faint nautical
 │         │  ⊕ CREST    │         │     crest centered, cream-on-
 │         │  (compass   │         │     tinted-bg, low contrast,
 │         │   silhouette│         │     placeholder for real art
 │         │   in cream  │         │     when commissioned
 │         │   @ 40%)    │         │
 │         └─────────────┘         │
 │                                 │
 │ ╔═════════════════════════════╗ │  ← name strip: cream band,
 │ ║   Monkey D. Luffy           ║ │     full width, holds card
 │ ╚═════════════════════════════╝ │     name in Lilita One
 │ ╔═════════════════════════════╗ │  ← kind strip: ink band,
 │ ║ CHARACTER · Straw Hat Crew  ║ │     KIND · traits in cream
 │ ╚═════════════════════════════╝ │
 │ [4] ⊕                  ST01·001 │  ← counter chip (bottom-left,
 └─────────────────────────────────┘     only if counterValue>0)
                                          + card number microtype
                                          (bottom-right)
```

### 4.2 Per-color background tint

The body background is a soft vertical gradient driven by the card's primary color. The tint sits at ~30% saturation on the cream ground so the cream / ink / brass elements stay legible.

| `card.colors[0]` | Top tint | Bottom tint | Stroke color |
|---|---|---|---|
| `red` | `#E8B8B0` | `#D89890` | seal-red |
| `green` | `#BBD4B8` | `#9BBE9A` | teal |
| `blue` | `#B0C8DC` | `#8FB0CC` | teal |
| `purple` | `#C9B8D4` | `#A990BC` | iron |
| `black` | `#9A968F` | `#6F6C66` | ink |
| `yellow` | `#E8D78F` | `#D4B65E` | brass |
| Multicolor (2+ colors) | gradient stops at each color, soft transitions | — | iron |
| Leader card | Bumps saturation +15% on its color stops (so leaders read as more saturated than characters) | — | — |

These gradient hex values are NEW. Introduce them as semantic tokens in `index.css`:

```
--card-tint-red-top    #E8B8B0
--card-tint-red-bot    #D89890
--card-tint-green-top  #BBD4B8
--card-tint-green-bot  #9BBE9A
--card-tint-blue-top   #B0C8DC
--card-tint-blue-bot   #8FB0CC
--card-tint-purple-top #C9B8D4
--card-tint-purple-bot #A990BC
--card-tint-black-top  #9A968F
--card-tint-black-bot  #6F6C66
--card-tint-yellow-top #E8D78F
--card-tint-yellow-bot #D4B65E
```

### 4.3 Element-by-element spec

| Element | Geometry | Fill | Stroke | Type | Notes |
|---|---|---|---|---|---|
| Outer body | 64×90 (hand), 88×124 (field), 220×308 (modal). Radius 4px (hand) / 5px (field) / 8px (modal) | linear-gradient top→bottom per 4.2 | 0.75px stroke per 4.2 | — | `paper-grain` overlay at 8% opacity |
| Cost square (top-left) | 14×14 inset 4px (hand) / 18×18 inset 5px (field) / 36×36 inset 10px (modal). Radius 2px | cream | 1px ink | Lilita One ink, tabular. Size 9/12/22px by frame size. Single digit unless >9 | Hidden for Leader (no cost), shown for Character/Event/Stage |
| Power stamp (top-right) | 20×12 inset 4px (hand) / 28×16 inset 5px (field) / 56×32 inset 10px (modal). Radius 2px on outer corners only (top-right hugs card edge) | ink | — | Lilita One cream, tabular. Power values shown as `5K` (5000), `1K` (1000) for hand size; full value (`5000`) for field+ | Hidden for Event and Stage (no power) |
| Power suffix | a tiny "0" → "K" abbreviation. 5000 → "5K", 1000 → "1K", 7000 → "7K". Use full digits at field-size and above. | — | — | — | Hand-size only abbreviation |
| Art slot crest | Centered, sized 36×36 (hand) / 50×50 (field) / 132×132 (modal). Renders our compass-rose mark (same as DON back, see §1.5) | none | cream @ 38%, 0.75px | — | `aria-hidden`. This is the "where commissioned art goes" placeholder |
| Name strip | Full width, height 14px (hand) / 18px (field) / 28px (modal), sits at 60–72% Y of card. Padded 4px L/R | cream | none | Lilita One ink. Size 7px (hand, truncate with ellipsis) / 11px (field) / 18px (modal). Center-aligned | Truncate with `text-overflow: ellipsis`; titles like "Monkey D. Luffy" stay legible. At hand size, fall back to first-name initial + last-name if width exceeds (e.g. "M. Luffy") |
| Kind/traits strip | Full width, height 10px (hand) / 14px (field) / 22px (modal), directly under name. Padded 4px L/R | ink | none | Nunito cream caps. Size 6px (hand, hide on hand if too narrow) / 8px (field) / 11px (modal). letter-spacing +0.06em. Format: `KIND · trait1 / trait2`. Truncate to first trait if needed | At hand size hide trait list, show just KIND ("CHARACTER", "EVENT", "STAGE", "LEADER") |
| Counter chip (bottom-left) | 16×10 (hand) / 22×14 (field) / 44×28 (modal). Inset 2px / 3px / 6px. Radius 2px | brass | 0.5px ink | Lilita One ink. Size 7/9/14px. Format: `+{counterValue/1000}K` → "+1K", "+2K" | Only shown when `card.counterValue > 0`. Hidden on leader, event, stage |
| Card number (bottom-right) | inset 3px / 4px / 8px from corners | none | none | Nunito ink @ 50%. Size 5/7/10px. Format: `{set_code}·{card_number}` e.g. "ST01·001" | Microtype anchor — proves "this is a real card", not a stub |
| Outer drop shadow | `0 1px 3px rgba(15,20,15,0.30)` (hand), `0 2px 6px rgba(15,20,15,0.32)` (field), `0 4px 12px rgba(15,20,15,0.35)` (modal) | — | — | — | Lifts card off the cream playmat |
| Rested state | `transform: rotate(90deg)` from the card's center for field cards. Opacity 0.82. | — | — | — | Field cards only; hand cards never rest |
| Selected attacker (per §7 of design-reference) | `outline: 2px solid brass; outline-offset: 2px; transform: translateY(-8px) scale(1.05)` | — | — | — | Wired by `selectedAttackerId` from store |
| DON-armed drop-zone (per §7) | pulsing `box-shadow: 0 0 0 2px sun-brass` 1s loop | — | — | — | Wired by `armedDonId` truthiness AND `target.ownerId === activePlayer` |

### 4.4 Per-kind variant tweaks

| Card kind | Layout differences |
|---|---|
| **Leader** | Hide cost square. Power stamp larger (28×16 at field). Add a 4px brass border (the leader card's "frame of importance"). Show "LIFE: N" microtype below name strip in a 10px iron stamp |
| **Character** | Default layout above |
| **Event** | Hide power stamp. Hide counter chip (events have no Counter). KIND label reads "EVENT" |
| **Stage** | Hide power stamp. KIND label reads "STAGE". Background tint is slightly desaturated (multiply 0.92) — visually "lower energy" than character |
| **DON** | NEVER uses this placeholder. Always renders per §1 |

### 4.5 What this REPLACES

The current `CardArt.tsx` renders raw card-id text as the "art" (e.g. `red-5-2`). Replace that path so:
- If `card.artUrl` is present → render `<img>` (future state, post art commission)
- Else → render this placeholder frame with the card's actual name, cost, power, counter, kind, and traits from `card_library`

The raw ID string should NEVER appear on a card face. If `card.name` is missing, fall back to the card's printed name from the engine library; if THAT is missing, show "—" not the ID.

### 4.6 Dark theme deltas

- Body stroke darkens to 1px ink for separation against the deep field
- Name strip background stays cream (legibility)
- Kind strip stays ink (already dark-theme-correct)
- Color tints stay the same hex (they sit between cream and ink semantically — they read correctly on both themes)
- Drop shadow deepens to `0 2px 6px rgba(0,0,0,0.55)`

### 4.7 Accessibility

- Whole card is a `<button>` (when interactive) with:
  - `aria-label="{kind} {name}, cost {cost}, power {power}, counter {counterValue}"`
  - `aria-pressed` if it's the selected attacker
  - `aria-disabled` if interaction not legal in current phase
- Decorative crest is `aria-hidden`
- Card number microtype is `aria-hidden` (it's a serial label, not user-facing identity)
- Color is NEVER the only signal — kind strip text + name strip text always carry the identifying info

---

## Hand-off to Frontend Developer

The deliverables above replace specific files. Execute in this order so the playfield is never broken between steps. Each item maps to the design-reference.md section that documents the engine contract.

| # | Action | Files touched | Maps to design-reference.md |
|---|---|---|---|
| 1 | **Remove felt-green tokens and class** — delete `--color-felt-green*` and `.felt-playmat` from `src/index.css` (lines 19–25 + 119–166). Replace playmat background with `cream + .paper-grain` per §3 | `src/index.css` | §3 L10 |
| 2 | **Add card tint tokens** — add 12 `--card-tint-*` tokens per §4.2 to `src/index.css` `@theme` block | `src/index.css` | §4 (new) |
| 3 | **Rebuild DON card art** — replace `DonCardArt` inside `src/components/zones/CostAreaBand.tsx` to render the front per §1.2–1.4 of this spec (cream body, ど!! mark, brass +1000 bottom band). Keep the rested-rotation logic; only the visual art changes | `src/components/zones/CostAreaBand.tsx:35-53` | §4 L11 |
| 4 | **Rebuild DON Deck back** — replace `DonDeckSlot.tsx` content with the back design per §1.5–1.6 of this spec (cream body, teal compass rose, count chip) | `src/components/zones/DonDeckSlot.tsx` | §4 (DON Deck zone) |
| 5 | **Rewrite `fanPosition`** — replace `src/lib/fanLayout.ts` math with the formulas in §3.2. Use the worked examples in §3.3 as the test fixture (write `fanLayout.test.ts` first; verify n=4, n=7, n=10 match before refactoring HandFan) | `src/lib/fanLayout.ts` | §5 L12 |
| 6 | **Add `inspectedCardId` to store** — extend `src/store/game.ts` with `inspectedCardId: string \| null` and `setInspectedCardId(id)`. Clear it whenever `phase` or `activePlayer` changes (subscribe in the store) | `src/store/game.ts` | §5 + §6 L13 |
| 7 | **Rewire `HandFan` tap behavior** — REMOVE the `PLAY_CARD` dispatch from `HandFan.tsx:30-37`. Tap calls `setInspectedCardId(...)` only. Implement the lift/dim per §3.5–3.7. Tap-outside listener at the App level clears `inspectedCardId` | `src/components/HandFan.tsx` | §5 L13 |
| 8 | **Build `CardDetailModal.tsx`** — new component per §2 of this spec. Mounts at app root, listens to `inspectedCardId` + a second-tap intent (e.g. `cardDetailOpen` boolean in store). Routes Play / Counter / Cancel via existing engine actions per §2.6 | `src/components/CardDetailModal.tsx` (new) | §6 L14 |
| 9 | **Rebuild `CardArt` placeholder** — replace the raw-ID text render with the placeholder frame per §4. Use the `size` prop (hand / field / modal) to switch dimensions and type sizes per §4.3. Read `card.name`, `card.cost`, `card.power`, `card.counterValue`, `card.kind`, `card.traits`, `card.colors[0]`, `card.set_code`, `card.card_number` from the engine library | `src/components/CardArt.tsx` | §6 L21 (and used by §7) |
| 10 | **Verify on 430×844 and 390×844** | manual | §10 |

**Out of scope for this design spec** (separate tickets):
- Field-card tap routing for attach-DON / declare-attack (design-reference §7 L15–L17) — engine + state wiring, design is already specified there
- End-Turn phase-reactive text (design-reference §9 L19) — text-only change, no visual design needed
- Attached DON `+1000 ×N` chip on target (design-reference §4 L22) — small overlay, will spec separately if owner wants more than the default `+{N}K` brass chip
- Battle sub-phase modals (block_window / counter_window prompts, L23)

**Hard NO reminders for the implementer:**
- No felt-green anywhere
- No DON pills, tokens, chips, or anchor-icon stand-ins
- No `PLAY_CARD` dispatched from `HandFan` tap (only from the Modal's PLAY action)
- No content past the 430px letterbox or under the notch — verify on 390×844 simulator
- No "ONE PIECE CARD GAME" wordmark anywhere (trademark) — use "CREW SIM" or our own mark
- No card-ID strings on a card face

---

*End of visual-design-spec.md*
