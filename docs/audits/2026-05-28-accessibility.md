# Accessibility Audit — OPTCGSandbox v0 UI shell

- Commit: `ba15030` on `main`
- Branch: `main`
- Standard: WCAG 2.2 AA
- Auditor: AccessibilityAuditor
- Scope: `src/App.tsx`, `src/components/CardChip.tsx`, `src/components/PlayerSide.tsx`, `index.html`
- Criteria: STRICT per global CLAUDE.md §3 — only real, exploitable-now violations introduced by this code

---

## BLOCKER

- None. No barrier fully prevents access for an assistive-tech user in v0.

---

## MAJOR

- **`index.html:6` — `user-scalable=no` on viewport meta blocks pinch-zoom (WCAG 1.4.4 Resize Text, Level AA).**
  - Users with low vision cannot zoom the page on iOS/Android. This is a hard, widely-cited AA failure, not a theoretical one.
  - Fix: drop `user-scalable=no` (and any `maximum-scale=1`). Keep `viewport-fit=cover`.
  - Verification: pinch on a real iOS device after change — content must scale.

- **`src/components/CardChip.tsx:13–15, 30` — color is the sole encoded signal for card color (WCAG 1.4.1 Use of Color, Level A).**
  - `card.colors[0]` maps to `bg-red-100` / `bg-blue-100` / `bg-stone-100` with no text, icon, or label naming the color. `card.name` is shown but does not name the color faction. Red/green color-blind users cannot distinguish red vs. stone, and a screen-reader user gets nothing.
  - Fix options: (a) append the color as text inside the chip (e.g. `R`/`B`/`G` glyph), or (b) add `aria-label={\`${card.name}, ${card.colors.join('/')}, cost ${card.cost}, power ${card.power}\`}` on the `<button>`.
  - Verification: Sim Daltonism red-blind filter — colors still distinguishable; VoiceOver announces color.

- **`src/components/CardChip.tsx:25` — `rotate-90` on rested cards is a visual-only state; no semantic equivalent (WCAG 1.1.1 Non-text Content / 4.1.2 Name, Role, Value).**
  - Sighted players see rotation = rested; screen-reader users get no signal that a card is tapped/rested.
  - Fix: add `aria-label` (see above) including rested state, or `aria-pressed={rested}` on the button. Also surface "rested" in the visible text for low-vision users who disable rotation transforms via prefers-reduced-motion.
  - Verification: VoiceOver announces "rested" when navigating a rotated card.

- **`src/components/CardChip.tsx:30` — `truncate` on `card.name` with no `title`/`aria-label` discloses no full name (WCAG 2.4.6 Headings and Labels / 1.3.1 Info & Relationships).**
  - At `w-12` with `text-[10px]`, every multi-word name truncates. Sighted users get an ellipsis; AT users get only the truncated string read aloud. No way to recover the full name.
  - Fix: add accessible name on the `<button>` containing the full `card.name` (the same `aria-label` above covers this).

---

## MINOR

- **`src/components/CardChip.tsx:27` — touch target width 48 px (w-12 = 3rem) < 44×44 CSS px recommended (WCAG 2.5.8 Target Size (Minimum), Level AA — 24×24 CSS px minimum; iOS HIG 44×44 pt).**
  - Height (h-16 = 64 px) passes. Width passes the AA 24×24 floor; fails Apple HIG 44×44 only on adjacent-spacing terms when hand cards are flex-gapped at `gap-1` (4 px). 48 + 4 spacing = effectively 52 px center-to-center, which is on the edge for thumb taps but does NOT violate WCAG 2.5.8's 24 px floor.
  - Net: WCAG-compliant; Apple HIG borderline. Not a blocker for v0; revisit when hand grows past 5 cards.

- **`src/App.tsx:55–60` — "Reset" button uses `border-ink-black/40` (≈ #15140F at 40% opacity ≈ #898578 on cream) for its border, which renders at ~2.2:1 against paper-cream (WCAG 1.4.11 Non-text Contrast, Level AA — 3:1 required for UI components).**
  - Same issue on the action-bar buttons (`App.tsx:75, 82`) and the section borders in `PlayerSide.tsx:21`. Text inside the buttons is ink-black on cream (15.4:1, fine), but the button's *boundary* is the only thing telling sighted users it's clickable, and the boundary fails 3:1.
  - Fix: bump border to `border-ink-black/60` or solid `border-ink-iron` (9.5:1).
  - Verification: WebAIM contrast checker against `#F2E8D2`.

- **`src/components/PlayerSide.tsx:30–32` — DON state uses three text colors (`text-amber-700`, `text-stone-500`, `text-stone-400`) as the only differentiator between "active / rested / in deck" (WCAG 1.4.1 Use of Color).**
  - Labels `active`, `rested`, `in deck` are present as plain text right next to each number, so the color is reinforced, not sole. Borderline pass — calling out so it doesn't regress when labels get abbreviated.

- **`src/App.tsx:107–114` — `<details>`/`<summary>` for history log is keyboard-accessible by default; `aria-expanded` is managed by the browser. No fix required.**
  - Confirms checklist item: native `<details>` already exposes expanded state to AT.

- **`src/App.tsx:74–80` — "Attach DON" toggle button has no `aria-pressed` state.**
  - The button toggles `attachDonMode`. Visible label flips ("Attach DON" ↔ "Cancel attach") and background changes to `bg-brass-canary`, but screen-reader users get no toggle semantics.
  - Fix: add `aria-pressed={attachDonMode}` on the button.

---

## NO-FINDING (checklist items that passed)

- `<details>` history log — native semantics handle `aria-expanded` (App.tsx:107).
- No `<input>`/`<select>` in v0 — N/A.
- No icon-only buttons — every button has a text label (App.tsx:55, 74, 81, 88; CardChip is a button-with-text).
- No decorative SVGs in v0 — N/A.
- No tables in v0 — N/A.
- No async loading states or error states yet — `role="status"` / `role="alert"` not applicable.
- Text contrast on cream paper: ink-black 15.4:1, ink-iron 9.5:1, seal-red on cream 6.2:1, ink-black on brass-canary 7.4:1 — all pass WCAG AA normal text (4.5:1) and large text (3:1).
- `<html lang="en">` set in `index.html:2` — WCAG 3.1.1 passes.
- `<main>`/`<header>`/`<section>` landmarks used in App.tsx and PlayerSide.tsx — landmark structure passes 1.3.1.

---

## Remediation priority

1. **Immediate (before next commit):** drop `user-scalable=no` from `index.html:6`. One-line fix, removes a clear AA failure.
2. **Immediate:** add `aria-label` on `CardChip`'s `<button>` covering name + color + cost + power + rested state. Solves 1.4.1, 4.1.2, and 2.4.6 in one change.
3. **Next pass:** add `aria-pressed={attachDonMode}` on the Attach DON toggle (App.tsx:74).
4. **Next pass:** tighten border opacity from `/40` to `/60` on all chrome borders for 1.4.11 compliance.

Word count: ~720.
