# OPTCG Design Reference — Playmat & UI Truth

**Source:** Official Bandai One Piece Card Game playsheet (`/Users/minamakar/Downloads/playsheet.pdf`).
**Status:** Authoritative. UI must match this layout. Engine must expose all zones below.

---

## 1. Official Single-Player Playmat (Bandai)

Layout when viewed by ONE player facing their own half:

```
┌────────┬─────────────────────────────────────────────────────┐
│        │                                                     │
│        │              CHARACTER AREA                          │
│ LIFE   │  Up to 5 Character cards.                            │
│        │  Characters cannot attack on the turn played.        │
│ (5     │                                                     │
│ cards  ├──────────────────────────────────────────────────────┤
│ stacked│                                                      │
│        │  PHASE      │  LEADER  │  STAGE  │  DECK             │
│ vert.  │  Refresh    │  CARD    │  CARD   │  (face-down)      │
│ on far │  Draw       │          │         │                   │
│ left)  │  DON!!      │          │         │                   │
│        │  Main       │          │         │                   │
│        │  End        │          │         │                   │
│        ├──────────────────────────────────────────────────────┤
├────────┤                                                      │
│ DON!!  │             COST AREA              │   TRASH         │
│ DECK   │   (Active + Rested DON cards live here)              │
└────────┴─────────────────────────────────────────────────────┘
```

### Zone-by-zone (exact playmat positions)

| Zone | Position on playmat | Visual notes |
|---|---|---|
| **LIFE** | Far-LEFT vertical column, full height. 5 card-sized slots stacked top-to-bottom. | Face-down. Card-shaped. |
| **CHARACTER AREA** | Top band. Wide horizontal. 5 slots in a row. | Adjacent to opponent's character area — attacks cross this border. |
| **Phase indicator** | Left of center mid-band. Vertical column of phase chips. | Refresh → Draw → DON!! → Main → End. |
| **LEADER CARD** | Center mid-band. Single card slot. | This is the player's identity / first attacker. |
| **STAGE CARD** | Right of leader, mid-band. Single card slot. | Stage-type cards only (locations). |
| **DECK** | Far-right mid-band. Single card slot. | Face-down deck. |
| **DON!! DECK** | Bottom-LEFT corner. Single card-sized slot. | Face-down DON deck (10 cards total). |
| **COST AREA** | Bottom-center band, WIDE. | All active + rested DON during the turn live here. |
| **TRASH** | Bottom-right corner. Single card-sized slot. | Face-up discard pile. |

### Rules called out by the playmat itself
- "You can play up to 5 Character cards."
- "Characters cannot attack on the turn they were played." (= summoning sickness)
- Turn-phase order: Refresh → Draw → DON!! → Main → End.

---

## 2. Two-Player On-Screen Layout (derived)

For an on-screen sim, mirror the official playmat vertically so the contact zone (Character Area boundary) is in the middle:

```
─────────────────────────────────────────────────────────────────
OPPONENT  Trash   ⟵ Cost Area ⟵ DON!! Deck      LIFE (vert, left)
          Deck ⟶ Stage ⟶ Leader ⟶ Phase indicator
          ──── CHARACTER AREA (5 slots, attacks face downward) ────
─────────────────────────────────────────────────────────────────
          ──── CHARACTER AREA (5 slots, attacks face upward) ─────
YOU       Phase indicator ⟵ Leader ⟵ Stage ⟵ Deck
          DON!! Deck ⟶ Cost Area ⟶ Trash       LIFE (vert, left)
─────────────────────────────────────────────────────────────────
```

LIFE columns run the full height of each player's half on the far left edge — NOT next to the leader.

---

## 3. Current Implementation Divergences (as of 2026-05-29)

Audited against `src/components/PlayfieldStage.tsx` + zone components at commit `f34d225`.

### 3.1 Major layout problems

| # | Spec position | Current build |
|---|---|---|
| L1 | LIFE = **vertical column on far LEFT edge** of player's half, full height, 5 card-shaped slots stacked top-to-bottom | LifeStack is rendered next to the Leader in a 4-band sub-grid — not a left-edge column |
| L2 | CHARACTER AREA = **TOP** of player's half (where attacks cross the contact zone with the opponent) | Characters render in a row BELOW the leader, not above |
| L3 | LEADER + STAGE + DECK = **middle row** (Leader center, Stage right of leader, Deck far right) | No Stage slot, no Deck slot rendered; Leader is in a mixed leader-row |
| L4 | DON!! DECK = **bottom-LEFT corner**, single card slot | Rendered as a small chip inline with the leader row; not corner-anchored |
| L5 | COST AREA = **bottom-center wide band**, holds active + rested DON cards visibly together | Active DON not rendered as cards; only "rested DON strip" (`DonRested.tsx`) exists |
| L6 | TRASH = **bottom-right corner**, single card slot, face-up | Not rendered at all |
| L7 | Phase indicator = **left of center, vertical chip column** (Refresh → Draw → DON!! → Main → End) | Rendered as a horizontal "Main YOU" pill at top of screen — no phase column |
| L8 | Tournament-felt playmat texture | Cream paper texture used for entire field — no felt look |
| L9 | "40 0" stat overlaps END TURN button (visible in screenshot) | Floating button positioning math vs leader stat overlay collides |

### 3.2 Missing zones (to add)

- Stage Area card slot (1 slot, between leader and deck mid-row).
- Trash card slot (bottom-right corner, face-up stack, ordered).
- DON!! Deck card-back slot (bottom-left corner).
- Cost Area band (bottom-center, render active DON + rested DON together as visible card-backs).
- Phase indicator column on left side.
- Deck card-back slot (mid-right, between Stage and right edge per playmat).

### 3.3 Card-back assets needed

- Red Leader card-back (for opponent leader if face-down; usually face-up however).
- **Navy** Character/Event/Stage card-back (deck + life + opp hand).
- **Teal/Green** DON card-back (DON deck + active DON in cost area).

### 3.4 Two-player on-screen layout (mirror per §2)

```
─────────────────────────────────────────────────────────────────
 OPP ▲                                              [LIFE col]
                                          [Trash][Cost Area][DON Deck]
                                          [Deck][Stage][Leader][Phase]
                                          [Character Area, 5 slots]
═════════════════════════════════════════════════════════════════  ← contact zone
                                          [Character Area, 5 slots]
                                          [Phase][Leader][Stage][Deck]
                                          [DON Deck][Cost Area][Trash]
 YOU ▼                                              [LIFE col]
─────────────────────────────────────────────────────────────────
                                                            [HAND]
```

The LIFE column hugs the **far left** for each player. The DON deck + Cost area + Trash sit on the player's near edge.

### 3.5 Player POV — phone aspect ratio (430px wide max)

For a single-player solo / vs-AI POV on a phone, the LIFE column is still at far-left but spanning the bottom half (your half); the opponent half is shrunk overhead. Hand sits below the player's half. The playmat occupies the entire vertical span minus hand-strip.

