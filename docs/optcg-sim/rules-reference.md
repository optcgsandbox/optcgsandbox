# OPTCG Rules Reference — Engine Truth

**Sources:**
- `/Users/minamakar/Downloads/rule_manual.pdf` — Official Rule Manual v1.11 (pages 1–15)
- `/Users/minamakar/Downloads/rule_comprehensive.pdf` — Comprehensive Rules v1.2.0 (updated 2026-01-16), 28 pages
- `/Users/minamakar/Downloads/tournament_rules_manual.pdf` — Tournament Rules (procedural)
- `/Users/minamakar/Downloads/playsheet.pdf` — Official playmat

**Authority hierarchy (per CR §1-3-1):** Card text > Comprehensive Rules > Rule Manual.
**Citation style:** `[CR §X-Y]` for Comprehensive Rules, `[RM pX]` for Rule Manual.

---

## 1. Game Overview [CR §1]

- 2-player head-to-head only [CR §1-1-1].
- A player **loses** when either:
  1. their Leader takes damage at 0 Life cards remaining [CR §1-2-1-1-1], OR
  2. they have 0 cards in deck [CR §1-2-1-1-2].
- Defeat is processed at the next rule-processing checkpoint [CR §1-2-2].
- A player may **concede** at any time [CR §1-2-3]. Concession cannot be forced by any card effect and cannot be replaced by any replacement effect [CR §1-2-4].
- Some card effects directly state win/lose; those resolve at effect resolution [CR §1-2-5].

---

## 2. Fundamental Principles [CR §1-3]

- **1-3-1.** Card text > CR > RM.
- **1-3-2.** Impossible actions are not carried out; multi-action effects do as many as possible.
- **1-3-2-1.** State changes that already match desired state = no-op.
- **1-3-2-2.** "Do 0 or negative times" = not carried out; not the opposite action.
- **1-3-3.** Prohibitive effects beat forcing effects.
- **1-3-4 / 1-3-10.** Simultaneous mandatory player actions → turn player acts first.
- **1-3-5.** Player-chosen numbers are non-negative integers. "Up to N" with no min allows 0.
- **1-3-6.** Numbers can't be fractional. Negative non-power numbers clamp to 0 except where added/subtracted.
- **1-3-6-1.** Power CAN be negative. Negative power doesn't auto-trash unless effect says so.
- **1-3-6-2.** Cost can temporarily go negative during calculation; outside that, clamps to 0.
- **1-3-7.** Card text resolves top to bottom.
- **1-3-8.** If an effect rests AND sets active simultaneously → rest wins.
- **1-3-9.** "Cost" = play cost. "Activation cost" = effect activation cost.

---

## 3. Card Information [CR §2, RM p1–4]

### 3.1 Categories [CR §2-2]
Five: Leader, Character, Event, Stage, DON!!.
- "Leader" / "Character" / "Stage" in card text refer to cards **in those zones**. "Leader card" / "Character card" / "Stage card" refer to those cards regardless of zone [CR §2-2-3 to 2-2-6].

### 3.2 Color [CR §2-3]
Six colors: red, green, blue, purple, black, yellow [CR §2-3-3]. Multicolor = has all listed colors simultaneously [CR §2-3-5].

### 3.3 Type [CR §2-4]
Trait tag (multiple allowed, separated by `/`). `{Type}` braces in text reference types.

### 3.4 Attribute [CR §2-5]
Slash, Strike, Ranged, Special, Wisdom, **`?`** (six total) [CR §2-5-2]. Only Leader & Character have attributes.

### 3.5 Power [CR §2-6]
Only Leader & Character have Power. Effects may set above/below printed.

### 3.6 Cost [CR §2-7]
Only Character / Event / Stage have a printed cost. Play sequence (Char/Stage):
1. Reveal the card.
2. Select active DON ≥ cost; rest them.
3. Play the revealed card.

For Events: same but trash the event after Main effect resolves [CR §2-7-3].

### 3.7 Counter [CR §2-10]
Only Character cards have printed Counter. Yellow chip value (+N) added to defender's power during Counter Step.

### 3.8 Trigger [CR §2-11]
Effect activated INSTEAD of adding life card to hand on damage [CR §2-11-1]. `[Trigger]` is part of card text.

### 3.9 Card-Type field summary

| Field | Leader | Character | Event | Stage | DON!! |
|---|---|---|---|---|---|
| Cost | — | ✔ | ✔ | ✔ | — |
| Power | ✔ | ✔ | — | — | — |
| Counter | — | ✔ | — (✔ as Event-counter effect) | — | — |
| Trigger | — | ✔ | ✔ | — | — |
| Life | ✔ | — | — | — | — |
| Attribute | ✔ | ✔ | — | — | — |
| Effect text | ✔ | ✔ | ✔ | ✔ | — |

### 3.10 Card backs
- Leader → red OP-compass back.
- Character / Event / Stage → navy OP-compass back.
- DON!! → teal/green OP-compass back.

---

## 4. Areas / Zones [CR §3, RM p5]

```
   #1 Character Area (up to 5)
   #2 Leader Area (1)
   #3 Stage Area (1)
   #4 Deck (secret)
   #5 Trash (open, ordered)
   #6 Cost Area (open, DON live here)
   #7 DON!! Deck (open, both players can view & reorder)
   #8 Life (secret, face-down stack)
      Hand (secret to opponent)
```

- **The Field** = Leader + Character + Stage + Cost areas [CR §3-1-2].
- Card counts in every area are **open info** [CR §3-1-4].
- **Open areas** (cards visible): Trash, Leader, Character, Stage, Cost, DON!! Deck. **Secret areas**: Deck, Life, Hand [CR §3-1-5].
- When a card leaves Character or Stage Area to another area, it is **treated as a new card**; previously-applied effects don't carry over [CR §3-1-6].
- DON!! moving across areas clears all prior effects on it [CR §3-1-6-1].
- Multiple cards placed simultaneously: owner picks order [CR §3-1-7].

### 4.1 Deck [CR §3-2]
Secret. Face-down stack. Neither player may inspect or reorder.

### 4.2 DON!! Deck [CR §3-3]
**Open**. Both players may view contents and reorder. Face-down for game purposes but visible to both [CR §3-3-2].

### 4.3 Hand [CR §3-4]
Secret to opponent. Owner may inspect/reorder.

### 4.4 Trash [CR §3-5]
Open, face-up, stacked, ordered. Owner may reorder own trash. New cards typically placed on top.

### 4.5 Leader Area [CR §3-6]
Open. Leader card is locked in the Leader Area — cannot be moved by effects or rules [CR §3-6-3].

### 4.6 Character Area [CR §3-7]
Open, face-up, up to 5 [CR §3-7-6]. Played active by default [CR §3-7-5]. Summoning-sickness rule [CR §3-7-4]: cards can't attack on the turn played unless effect (e.g., Rush). If full (5), to play a 6th: reveal new → trash 1 existing → play new [CR §3-7-6-1]. Trashing-for-slot-6 is **rule processing not an effect** — no replacement effects apply [CR §3-7-6-1-1].

### 4.7 Stage Area [CR §3-8]
Open, max 1 [CR §3-8-5]. Replacing trashes the existing Stage [CR §3-8-5-1]. Played active by default.

### 4.8 Cost Area [CR §3-9]
Open. Player freely chooses which DON to rest when paying. DON placed active by default [CR §3-9-3].

### 4.9 Life Area [CR §3-10]
Secret. Stacked face-down. Cards leave from the TOP unless effect says otherwise [CR §3-10-2]. Effects may place cards face-up exceptionally — treated as open while face-up [CR §3-10-2-1]. Effects looking at life must restore prior face-up/down state after [CR §3-10-3].

---

## 5. Basic Terminology [CR §4]

### 5.1 Player vs Owner [CR §4-2]
Player = current possessor. Owner = original. At game end, cards return to owners.

### 5.2 Turn Player [CR §4-3]
The player whose turn is in progress. Non-turn player = opponent.

### 5.3 Active vs Rested [CR §4-4]
Cards in Leader, Character, Stage, Cost areas exist as Active (vertical) or Rested (horizontal). **Given DON cards (attached) are NEITHER active nor rested** [CR §4-4-2].

### 5.4 Draw [CR §4-5]
Top card → hand, no reveal. "Draw X" repeats X times. "Draw up to X" is optional and can stop early.

### 5.5 Damage Processing [CR §4-6]
- "1 damage" = move top life card → controller's hand [CR §4-6-2-1].
- "X damage" = repeat the 1-damage process X times [CR §4-6-2-2].
- During damage processing, if life card has [Trigger], controller MAY suspend damage processing and activate Trigger instead of adding to hand [CR §4-6-3, §8-6-2-1].
- If a life card cannot be added to hand (due to replacement effect, etc.), Trigger does not activate [CR §4-6-3-1].

### 5.6 Play a Card [CR §4-7]
Playing = paying cost AND activating/placing from hand. "Cannot be played" = either can't pay cost OR can't be placed.

### 5.7 "Up to X" [CR §4-8]
Choose 0..X at activation time, before resolution. (Exception: "Draw up to X" uses CR §4-5-4.)

### 5.8 "Base" [CR §4-9]
Refers to the printed value (or a base-set value). Multiple effects setting base → highest wins [CR §4-9-2-1].

### 5.9 If / Then [CR §4-10]
If-clause fails → following text doesn't resolve. Then-clause fails → preceding text still resolved.

### 5.10 "Set Power to 0" [CR §4-12]
Reduces target's power by (current power amount) for the specified duration. If already negative → no effect.

---

## 6. Decks & Setup [CR §5, RM p6–7]

### 6.1 Deck construction [CR §5-1]
- 1 Leader card.
- Main deck: exactly 50 cards (Character / Event / Stage). Each card's color must be in the Leader's color set [CR §5-1-2-2]. **Max 4 copies of any card number** [CR §5-1-2-3].
- DON!! Deck: exactly 10 DON cards.
- Some cards' deck-construction effects are treated as permanent effects and may override these rules [CR §5-1-2-4].

### 6.2 Setup procedure [CR §5-2-1, RM p7]
1. Each player presents their deck (must meet construction rules).
2. Shuffle deck → place face-down in Deck slot.
3. Place Leader face-up in Leader Area.
4. Decide first/second via RPS or similar [CR §5-2-1-4]; chooser declares.
5. **At-start-of-game effects** resolve now (chooser's first) [CR §5-2-1-5-1]. Deck-modifying ones shuffle after.
6. Each player draws 5 cards.
7. Mulligan window — first player decides first; each player may once redraw their entire hand [CR §5-2-1-6, §5-2-1-6-1].
8. Each player places Leader.life cards from top of deck face-down into Life Area, **such that the top of the deck ends up at the BOTTOM of the life pile** [CR §5-2-1-7]. So the FIRST card placed in life is at the TOP of the life pile (and is the first to be revealed when damage is taken).
9. First player begins.

---

## 7. Turn Structure [CR §6, RM p9–13]

Order per turn: Refresh → Draw → DON!! → Main → End [CR §6-1-1].

### 7.1 Refresh Phase [CR §6-2]
1. Effects ending "until start of your next turn" expire [CR §6-2-1].
2. "At the start of your/opp turn" effects activate [CR §6-2-2].
3. Return all given DON from Leader/Char areas → cost area, **rest them** [CR §6-2-3].
4. Set all rested cards in Leader/Char/Stage/Cost areas → active [CR §6-2-4]. (Net effect: prior given DON are now back in cost area and active.)

### 7.2 Draw Phase [CR §6-3]
Draw 1. **First player does NOT draw on turn 1** [CR §6-3-1, RM p9].

### 7.3 DON!! Phase [CR §6-4]
Place 2 DON from DON Deck → Cost Area face-up [CR §6-4-1]. **First player turn 1 places only 1.** If DON Deck has only 1, place 1 [CR §6-4-2]. If 0, place none [CR §6-4-3].

### 7.4 Main Phase [CR §6-5]
"At the start of Main Phase" effects activate [CR §6-5-1]. Then turn player may freely perform, any order, any number of times:
- **A) Play a Card** [§6-5-3]: Char / Stage / Event[Main] from hand.
- **B) Activate Card Effects** [§6-5-4]: [Main] or [Activate:Main] effects on cards in play.
- **C) Give DON!!** [§6-5-5]: move 1 active DON from cost area under a Leader/Char (must remain visible). Leader/Char gains +1000 power during your turn per attached DON [CR §6-5-5-2]. Multiple gives per turn permitted [CR §6-5-5-3]. **When a DON-attached card moves to another area, all attached DON return to cost area RESTED** [CR §6-5-5-4].
- **D) Battle** [§6-5-6]: see §8. Cannot battle on turn 1 [CR §6-5-6-1].

End of Main = move to End Phase.

### 7.5 End Phase [CR §6-6]
Strict order:
1. Active player's `[End of Your Turn]` effects activate & resolve, in any order they choose [CR §6-6-1-1-3].
2. Opponent's `[End of Your Opponent's Turn]` effects activate & resolve [CR §6-6-1-1-2, §6-6-1-1-4].
3. Continuous effects scheduled "at the end of this/your turn" → turn player processes own first, then non-turn player [CR §6-6-1-2].
4. "During this turn" effects expire: turn player's first, then non-turn player's [CR §6-6-1-3].
5. Turn ends; non-turn player becomes new turn player [CR §6-6-1-4].

---

## 8. Battle [CR §7]

### 8.1 Attack Step [CR §7-1-1]
1. Turn player declares attack: rest an active Leader or active Character [CR §7-1-1-1].
2. Choose target: opponent's Leader OR one of opp's **rested** Characters [CR §7-1-1-2]. Active characters cannot be targeted.
3. `[When Attacking]`, "when you attack", `[On Your Opponent's Attack]`, "when attacked" effects activate now [CR §7-1-1-3].
4. **Abort condition:** if at end of Attack Step, attacker or target has left their area → skip to End of Battle [CR §7-1-1-4].

### 8.2 Block Step [CR §7-1-2]
- Defender may activate Blocker on ONE of their characters (Blocker can fire only once per battle) [CR §7-1-2-1].
- Activating Blocker = rest the blocker; blocker **takes the place** of the attack target [CR §10-1-4-1].
- `[On Block]` / "when you block" effects activate [CR §7-1-2-2].
- **Abort condition:** if attacker or target leaves area → End of Battle [CR §7-1-2-3].

### 8.3 Counter Step [CR §7-1-3]
- Defender's "when attacked" effects activate [CR §7-1-3-1].
- Defender may perform, any order, any number of times [CR §7-1-3-2]:
  - **Activate `[Counter]` on a Character** → trash that Character from your field; defender's leader or one of their characters gains +(printed Counter value) for this battle [CR §7-1-3-2-1]. **Note: comes from your FIELD characters, not hand.**

    Wait — re-read 7-1-3-2-1: "trash a Character card with [(Symbol) Counter] from their HAND". Comprehensive Rules say HAND, not field. Confirmed: Character cards used as counters come from the HAND. The +Counter value boost activates by trashing them from hand.
  - **Activate `[Counter]` Event** → pay cost, trash event from hand to activate the Counter effect [CR §7-1-3-2-2].
- **Abort condition:** if attacker or target leaves area → End of Battle [CR §7-1-3-3].

### 8.4 Damage Step [CR §7-1-4]
- Compare attacker.totalPower vs target.totalPower (printed + attached DON × 1000 + counter-step boosts).
- **Attacker ≥ target → attacker wins** [CR §7-1-4-1]:
  - If target was Leader: opp Leader takes 1 damage. If opp Leader had 0 life at the moment damage is determined → attacker wins game [CR §7-1-4-1-1, §7-1-4-1-1-1]. If opp had ≥1 life: top life → opp's hand; opp may activate Trigger instead [CR §7-1-4-1-1-2]. With [Double Attack]: repeat the life-add procedure 2 times [CR §7-1-4-1-1-3].
  - If target was Character: target is K.O.'d [CR §7-1-4-1-2].
- **Attacker < target → attacker loses, nothing happens** [CR §7-1-4-2]. Attacker is already rested but no damage dealt.

### 8.5 End of the Battle [CR §7-1-5]
- "At the end of (this) battle" / "if this … battles" effects activate [CR §7-1-5-2].
- "During this battle" continuous effects expire [CR §7-1-5-3, §7-1-5-4].
- Return to Main Phase.

---

## 9. Effects [CR §8]

### 9.1 Effect categories [CR §8-1-3]
1. **Auto effects** — automatically fire on a specified game event (`[On Play]`, `[When Attacking]`, `[On Block]`, `[On K.O.]`, `[End of Your Turn]`, `[End of Your Opponent's Turn]`, "when …", "on …") [CR §8-1-3-1-1].
2. **Activate effects** — declared by turn player during Main Phase (`[Activate:Main]`, `[Main]`).
3. **Permanent effects** — constantly affect gameplay (e.g., `[Your Turn]` continuous boosts).
4. **Replacement effects** — denoted by "instead", replace the indicated processing [CR §8-1-3-4].

- 8-1-3-1-3: Auto effects don't activate if the source card has moved areas before they would activate.
- 8-1-3-3-5: Permanent-effect cascade → turn player resolves own first, non-turn second, repeat to stable.
- 8-1-3-4-1: Replacement is optional; if you decline, replacement doesn't apply.
- 8-1-3-4-2: Multiple replacements for same situation → card-generated-replacement first, then turn-player chosen order, then non-turn player.
- 8-1-3-4-3: Same replacement can't repeatedly apply to the same situation.
- 8-1-3-4-5: If "instead" effect can't be carried out, replacement can't be applied.

### 9.2 Valid / Invalid effects [CR §8-2]
- 8-2-1-1: Invalid effect can't occur, choices not made, activation cost not payable.
- 8-2-3: Already-resolved effects cannot be retroactively invalidated.

### 9.3 Activation cost [CR §8-3]
Text before `:` is the activation cost [CR §8-3-1]. Symbols:
- `①` / `②` / `③`: rest N active DON [CR §8-3-1-5].
- `DON!!−X`: return X DON from Leader/Char/Cost back to DON deck [CR §8-3-1-6].
- "may"/"can" makes the activation cost optional [CR §8-3-1-4].
- 8-3-1-3-1: Partial-pay fallback — pay as much as possible, post-`:` effect doesn't resolve.

### 9.4 Conditions [CR §8-3-2]
`[DON!!xX]`, `[Your Turn]`, `[Opponent's Turn]` are conditions:
- All multi-conditions = AND [§8-3-2-1].
- `[DON!!xX]` condition is met when given DON ≥ X [§8-3-2-3]. Activation timing AND condition must both be satisfied at activation time.

### 9.5 Activation procedure [CR §8-4-1]
1. Verify conditions.
2. Specify effect (reveal hand card if applicable).
3. Determine + pay activation cost.
4. Activate.
5. Resolve.

- 8-4-2: Activating an Event = trash the event first, then carry out effect.
- 8-4-4-1: "Choose N" = pick as many as possible, up to N. "Up to N" allows 0.
- 8-4-4-2: Secret-area unrevealed cards: player can decline picking them even if eligible.
- 8-4-5: Auto effects on area-movement only activate if destination is an OPEN area (e.g., `[On KO]` requires destination = Trash, which is open).

### 9.6 Order of resolution [CR §8-6]
- Simultaneous firings → turn player resolves own first, then non-turn [§8-6-1].
- If resolving fires new effects, those resolve next [§8-6-1-1].
- Damage-processing-triggered firings happen AFTER damage processing completes [§8-6-2], EXCEPT [Trigger] can suspend damage processing to fire [§8-6-2-1].

---

## 10. Rule Processing & Defeat [CR §9]

- "Rule processing" = auto procedures forced by rules when specific events occur [§9-1-1]. Resolved immediately even mid-action [§9-1-2].
- At rule processing, defeat checks run [§9-2-1]:
  - Leader took damage at 0 life [§9-2-1-1].
  - Deck has 0 cards [§9-2-1-2].
- If a player has fulfilled both defeat conditions simultaneously, they lose; if both players lose simultaneously → game is a draw.

---

## 11. Keyword Effects [CR §10-1]

| Keyword | Behavior | CR |
|---|---|---|
| `[Rush]` | Char may attack on turn played | §10-1-1 |
| `[Double Attack]` | When this card damages opp Leader, life-add procedure runs 2× | §10-1-2 |
| `[Banish]` | Damage to opp Leader trashes the life card without revealing; Trigger does NOT fire | §10-1-3 |
| `[Blocker]` | When one of your OTHER cards is being attacked, during Block Step you may rest this card to make it become the new target | §10-1-4 |
| `[Trigger]` | On taking damage, if a life card with [Trigger] is added, controller MAY reveal it and activate the trigger instead of adding to hand. Standard resolution trashes the trigger card after activation, unless text says otherwise | §10-1-5 |
| `[Rush: Character]` | Char may attack opp **Characters** on turn played (not Leader) | §10-1-6 |
| `[Unblockable]` | Cannot be blocked | §10-1-7 |

**Trigger nuances [§10-1-5]:**
- 10-1-5-2: Activation is optional.
- 10-1-5-3: While Trigger is being processed, the card belongs to no area; after the effect resolves, **trash the card unless otherwise specified**.

---

## 12. Keywords (non-effect) [CR §10-2]

| Keyword | Behavior | CR |
|---|---|---|
| K.O. | Character trashed via battle loss or effect | §10-2-1 |
| `[On K.O.]` / "cannot be K.O.'d" | Only applies if trashing source is a true K.O. (battle loss or effect-induced "K.O."). Rule-processing trashes (e.g., slot-6 replacement) do NOT trigger [On K.O.] | §10-2-1-3 |
| `[Activate:Main]` | Activate during Main Phase, except in battle | §10-2-2 |
| `[Main]` | Event main-phase effect (Event only) | §10-2-3 |
| `[Counter]` | Event counter-step effect (Event only) | §10-2-4 |
| `[When Attacking]` | Fires when this card declares an attack | §10-2-5 |
| `[On Play]` | Fires when this Character is played | §10-2-6 |
| `[End of Your Turn]` | Fires at your End Phase | §10-2-7 |
| `[End of Your Opponent's Turn]` | Fires at opponent's End Phase | §10-2-8 |
| `[DON!! xX]` | Condition: original < X, then given DON ≥ X | §10-2-9 |
| `DON!!−X` | Return X DON from Leader/Char/Cost back to DON deck | §10-2-10 |
| `[Your Turn]` | Condition: during your turn | §10-2-11 |
| `[Opponent's Turn]` | Condition: during opp's turn | §10-2-12 |
| `[Once Per Turn]` | Once per turn per card | §10-2-13 |
| Trash (instruction) | Select card from hand → trash | §10-2-14 |
| `[On Block]` | Fires when you activate Blocker | §10-2-15 |
| `[On Your Opponent's Attack]` | Fires after opp's `[When Attacking]` effects during their Attack Step | §10-2-16 |
| `[On K.O.]` | Fires when this card is K.O.'d; effect resolves while card is in trash | §10-2-17 |

---

## 13. Infinite Loops & Misc [CR §11]

- **11-1.** Loops: if neither player can stop, game is a draw [§11-1-1-1]. If only one player can stop, they declare iteration count [§11-1-1-2]. If both can stop, lesser count is taken [§11-1-1-3].
- **11-2.** Moving card from secret to secret area implicitly reveals it [§11-2-1].
- **11-3.** Viewing secret areas via effect: cards stay in their area while viewed; restore to original state [§11-3-3].

---

## 14. Engine model (TypeScript mapping)

### 14.1 State shape (corrected)
```ts
interface PlayerZones {
  leader: CardInstance;
  field: CardInstance[];            // up to 5 Characters
  stage: CardInstance | null;       // single slot
  deck: string[];                   // secret
  trash: string[];                  // ordered, top = last index
  hand: string[];                   // hidden from opp
  life: string[];                   // face-down; index 0 = TOP (first to flip)
  donDeck: string[];                // 10 DON instance IDs at start
  costArea: {
    active: string[];               // DON instances currently active
    rested: string[];               // DON instances currently rested
  };
}

interface CardInstance {
  instanceId: string;
  cardId: string;
  controller: PlayerId;
  rested: boolean;                  // not applicable to attached DON
  attachedDon: string[];            // visible DON instance IDs
  summoningSick: boolean;           // true on turn played (cleared on Refresh)
  perTurn: { hasAttacked: boolean; effectsUsed: Set<string> }; // [Once Per Turn]
}
```

### 14.2 Phases
```ts
type Phase =
  | 'mulligan_first' | 'mulligan_second'
  | 'refresh' | 'draw' | 'don' | 'main'
  | 'attack_declared'    // resolving [When Attacking]
  | 'block_window'       // defender's Block Step
  | 'counter_window'     // defender's Counter Step
  | 'damage_step'
  | 'trigger_window'     // life-card Trigger pending
  | 'end_phase';
```

### 14.3 Actions (discriminated union)
```ts
type Action =
  | { type: 'MULLIGAN' }
  | { type: 'KEEP_HAND' }
  | { type: 'END_TURN' }
  | { type: 'RESIGN' }
  | { type: 'PLAY_CHARACTER'; instanceId: string; replaceTargetId: string | null }
  | { type: 'PLAY_STAGE'; instanceId: string }
  | { type: 'PLAY_EVENT_MAIN'; instanceId: string; targets?: string[] }
  | { type: 'ACTIVATE_MAIN'; sourceInstanceId: string; choiceId?: string }
  | { type: 'GIVE_DON'; targetInstanceId: string }
  | { type: 'DECLARE_ATTACK'; attackerInstanceId: string; targetInstanceId: string }
  | { type: 'DECLARE_BLOCKER'; blockerInstanceId: string }
  | { type: 'SKIP_BLOCKER' }
  | { type: 'PLAY_COUNTER_CHARACTER'; instanceId: string }    // from HAND, per CR §7-1-3-2-1
  | { type: 'PLAY_COUNTER_EVENT'; instanceId: string }        // from hand; pay cost; trash
  | { type: 'SKIP_COUNTER' }
  | { type: 'RESOLVE_TRIGGER'; activate: boolean };
```

---

## 15. Divergences from current implementation

Audited 2026-05-29 against engine commit `a84f87d` + UI commit `0ea7edb`.

### 15.1 Engine — Closed (fixed by `a84f87d`)

- ✅ **D1 Stage Area** — `PlayerZones.stage: CardInstance | null` added; `PLAY_STAGE` action wired
- ✅ **D2 First-turn-no-attack for both players** — `legality.ts` now blocks both P1 turn 1 AND P2 turn 2
- ✅ **D3 Event counter cards** — `EventCard.counterEventBoost` field + `playCounter` handles Char + Event sources
- ✅ **D4 Once Per Turn per-card** — `CardInstance.perTurn.effectsUsed: string[]` replaces single boolean
- ✅ **D8 Unblockable** — `Keyword` union includes `'unblockable'`; `blockerActions` short-circuits
- ✅ **D10 Mulligan window implemented** (CR §5-2-1-6 + §5-2-1-7) — `Phase` adds `'mulligan_first'` / `'mulligan_second'`; new `MULLIGAN` + `KEEP_HAND` actions replace the prior `MULLIGAN_CONFIRM` no-op; `setupGame` defers life dealing until both decisions resolve via `dealLifeCards`; `legality.ts` gates the window to the correct decider; UI prompt at `src/components/MulliganPrompt.tsx`; both AI tiers auto-KEEP
- ✅ **D24 Dice-roll first-player choice** (CR §5-2-1-4) — `Phase` adds `'dice_roll'` / `'first_player_choice'` BEFORE `'mulligan_first'`; `GameState.diceRoll` records both d6 values + rolls counter; new `ROLL_DICE` / `CHOOSE_FIRST` / `CHOOSE_SECOND` actions; `setupGame` now opens in `dice_roll` with hands dealt and life undealt; engine helpers `rollDice` + `chooseFirstPlayer` in `phases/setup.ts` use Mulberry32 derived from `seed XOR round`; ties keep phase in `dice_roll` and re-roll on next dispatch; winner becomes `activePlayer` and chooses turn order; UI prompts at `src/components/DiceRollPrompt.tsx` + `src/components/FirstPlayerChoicePrompt.tsx`; vs-AI auto-rolls + auto-chooses Go First after a 600ms beat

Engine test count: 95/95 passing (73 prior + 22 D24).

### 15.2 Engine — OPEN

| # | Divergence | Spec | Engine | Severity |
|---|---|---|---|---|
| D5 | **DON detaches at end of YOUR turn instead of next Refresh** | CR §6-2-3 | `phases/turn.ts:80-88` detaches at end-of-own-turn. Net state same; semantic differs | LOW (cosmetic) |
| D6 | **Trashing for 6th-character slot emits `CARD_KOED`** | CR §3-7-6-1-1: rule processing, not K.O. | `applyAction.ts:93` emits `CARD_KOED` | MEDIUM (cosmetic until [On K.O.] cards ship) |

### 15.2 Keyword gaps

| # | Divergence | Spec | Engine |
|---|---|---|---|
| D7 | `[Banish]` not handled | CR §10-1-3: damage to opp Leader trashes life card without revealing; Trigger does NOT fire | engine flips life normally regardless |
| D8 | `[Unblockable]` not handled | CR §10-1-7: defender cannot activate Blocker against this attacker | `legality.ts:132` lets defender block any attacker |
| D9 | `[Rush: Character]` distinct from `[Rush]` not modeled | CR §10-1-6: Char may attack opp **Characters** only on turn played | engine has only `rush`; no character-only variant |

### 15.3 Unwired V0 stubs (acknowledged in code; deferred to effects engine)

- ~~D10 — Mulligan unwired~~ → CLOSED, see §15.1 above.
- D11 — `[Trigger]` activate path trashes life card but does NOT dispatch the trigger effect (v0 default per CR §10-1-5-3).
- D12 — `[Activate:Main]` action is a no-op stub.
- D13 — Event `[Main]` effects are not dispatched (event just goes to trash).
- D14 — Effect-stack ordering for simultaneous fires (CR §8-6) is not modeled — no [On Play], [When Attacking], [On Block], [On K.O.] dispatch.
- D15 — At-start-of-game effects (CR §5-2-1-5-1) not handled.
- D16 — `Set Power to 0` (CR §4-12) not modeled.
- D17 — `DON!! −X` cost (CR §10-2-10) not modeled.
- D18 — `[Once Per Turn]` partial-pay failure rule (CR §10-2-13-5) not enforced.
- D19 — Replacement effects (CR §8-1-3-4) not modeled.

### 15.4 Schema mismatches

| # | Spec field | Engine state |
|---|---|---|
| D20 | `Card.attribute` includes `?` (CR §2-5-2) | `Card.ts:11` union omits `?` |
| D21 | Cost Area is one zone with active + rested DON visible together (CR §3-9) | Split into `donCostArea` (active) + `donRested` (rested) on `PlayerZones`; UI must render them together |
| D22 | ~~Stage Area is a `CardInstance \| null` slot~~ — CLOSED by `a84f87d` | |
| D23 | `summoningSick` only set by `PLAY_CARD` action | If effects ever place chars on field, they'll be playable immediately — bug for V1.x effects |

### 15.5 UI layer (split into `design-reference.md §12`)

Engine emits correct legal actions per `legality.ts`. The UI does NOT dispatch them. Owner-blocking issues:

- **UI-D1.** `PlayfieldStage.tsx` doesn't wire `onTap` on Leader/Character cards → can't attach DON, can't attack (engine-diagnosis agent 2026-05-29)
- **UI-D2.** `src/store/game.ts` has no `selectedAttackerId` state → no way to do 2-tap attack
- **UI-D3.** `src/store/game.ts` has no `inspectedCardId` state → no Pokemon-style tap-to-lift
- **UI-D4.** No `CardDetailModal` component exists → owner can't read card before deciding

Full UI divergence list: see `design-reference.md §12.2` (L10–L23).

