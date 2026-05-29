# Accessibility Audit — Phase A engine refactor + Phase B UI redesign

- Commit: `937eb34`
- Standard: WCAG 2.2 AA
- Scope: Phase A/B files only; pre-existing issues not reported.
- Methodology: code inspection + WCAG luminance math against tokens in `src/index.css`.

---

## Serious

- **Faint micro-labels fail WCAG 1.4.3 Contrast Minimum (4.5:1)** — three new labels at `text-[0.55rem]` (~8.8px, well below the 18pt large-text threshold) use translucent ink-iron over paper-cream, yielding contrast below AA:
  - `src/components/zones/CostAreaStrip.tsx:134` — `Cost` label uses `text-ink-iron/70` on `paper-cream` (#F2E8D2). Computed ratio ≈ **3.39:1**. Fails 4.5:1.
  - `src/components/zones/DonRested.tsx:67` — `Rested` label uses `text-ink-iron/60`. Computed ratio ≈ **2.35:1**. Fails 4.5:1 and even AA Large 3:1.
  - `src/components/zones/LifeStack.tsx:55` — `Life` label uses `text-ink-iron/70`. ≈ **3.39:1**. Fails.
  - `src/components/zones/LifeStack.tsx:94` — `Life` label uses `text-ink-iron/80`. Marginal; still under AA 4.5:1 for normal-size text.
  - Fix: drop the alpha (use solid `text-ink-iron` ≈ 9.77:1) or bump to `text-ink-black`. These are the only on-canvas identifiers of those zones — they are informational text, not decoration.

- **PhaseRibbon "Opp" chip contrast is unverifiable / likely fails** — `src/components/PhaseRibbon.tsx:72` renders `text-paper-cream` on `bg-marine-fog/30` over the cream playmat. Marine-fog (#B8C7C9) at 30% over paper-cream blends to roughly #DBDDD0; paper-cream text (#F2E8D2) on that blend is ≈ 1.2:1 — failing 1.4.3 by a wide margin. The "You" chip variant (`bg-sun-brass text-ink-black`) is fine at 9.68:1. Fix: give the inactive variant an opaque dark background (e.g. `bg-marine-fog text-ink-black`) so the turn indicator remains legible at a glance.

## Moderate

- **`aria-live` regions on overlays will be re-announced as DOM siblings move** — `src/components/LifeRevealOverlay.tsx:74` and `src/components/EventCardOverlay.tsx:75` mount with `aria-live="polite"` and a static `aria-label`. The label is set on the live region itself, so screen readers announce only when the region appears/disappears — but because the `<motion.div>` mounts already containing the label and immediately animates, NVDA and VoiceOver may miss the announcement (live-region content must change AFTER the region exists in the AT tree). Fix options: (a) drop the live-region role entirely and instead mount a sibling `<div role="status" className="sr-only">{message}</div>` after a microtask, or (b) leave the region mounted permanently and update text content on event. Current code likely produces silent announcements in practice for VoiceOver/Safari.

- **`AnimatePresence exit` removes the modal before AT can re-route focus** — `src/components/TriggerPrompt.tsx:160` dispatches `RESOLVE_TRIGGER` and lets the dialog unmount via `AnimatePresence`. There is no `useEffect` cleanup that restores focus to the element that opened the trigger window (the leader / life stack region). Result: after Activate/Decline, focus falls to `<body>`, which is WCAG 2.4.3 Focus Order failure for keyboard users (focus is lost mid-flow). Fix: capture `document.activeElement` when `open` becomes true and call `prevFocus.focus()` in the open-effect cleanup.

## Minor

- **DON coin armed/disarmed label is the only state cue for sighted-but-AT users in low contrast** — `src/components/zones/CostAreaStrip.tsx:77` swaps `aria-label` between "Active DON, tap to arm" and "Armed DON — tap a character to attach". `aria-pressed={armed}` is correct. Not a violation, but consider also adding `aria-describedby` pointing to a single help-text node so the instruction isn't re-read on every coin focus during keyboard traversal of the strip.

- **`describeForA11y` in `src/components/CardArt.tsx:71` does not surface `validDrop` or `highlighted` state** — when a card is a valid drop target or selection-highlighted, sighted users see a brass ring; AT users hear only the base name/cost/power. Phase B introduced the validDrop ring (line 214). Fix: append `', valid drop target'` when `validDrop` and `', selected'` when `highlighted`.

## Verified — no violation

- TriggerPrompt: `role="dialog"`, `aria-modal="true"`, `aria-labelledby` wired to `#trigger-prompt-heading`, initial focus on Activate, Tab/Shift+Tab trap between the two buttons. Escape dismissal is absent but the spec explicitly accepts "Escape OR explicit Decline" and Decline exists — passes.
- Tap targets: Activate/Decline `min-h-[44px] min-w-[110px]` (≥ 44pt). DON coins 28×28 CSS pixels — passes WCAG 2.2 AA 2.5.8 Target Size (Minimum, 24px). Does not meet AAA 44px but AAA is not in scope.
- Color contrast on hot paths: paper-cream on seal-red 5.82:1; paper-cream on hull-teal 8.77:1; ink-black on sun-brass 9.68:1; ink-black on brass-canary 7.76:1; ink-black on paper-fog 13.45:1. All pass AA.
- CardArt rest rotation announces "rested" via `describeForA11y` (CardArt.tsx:80).
- LifeStack count exposed via `aria-label` "Your life: N" / "Opponent life: N" at LifeStack.tsx:46 and :65.
- CostAreaStrip exposes "active DON, N rested" at line 130; DonRested exposes "rested DON, N used this turn" at line 63.
- Reduced motion: `useReducedMotion()` is checked in every new animation site (TriggerPrompt, LifeRevealOverlay, EventCardOverlay, CostAreaStrip, DonRested, LifeStack, PhaseRibbon). Spring transitions degrade to instant (`duration: 0.01`) and stagger delays go to 0. Compliant with 2.3.3.
- Decorative SVGs (`CardBack` anchor glyph, DON crossed-blade glyph, DonRested coin glyph) all carry `aria-hidden="true"`.
- DonBadge "+N attached DON" is reflected in `describeForA11y` (CardArt.tsx:77-79) so AT does not miss it even though the badge itself is `aria-hidden`.

---

## Remediation priority

1. Solid-color the three micro-labels (Cost / Rested / Life) — one-line Tailwind change each.
2. Replace `bg-marine-fog/30` on PhaseRibbon's Opp chip with an opaque variant.
3. Restore focus on TriggerPrompt close (small `useEffect` over `prevFocus`).
4. Convert overlay live regions to the sr-only sibling pattern, or skip live-region role and accept silent overlays (they are visual confirmations of engine state that the player just produced).
