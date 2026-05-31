# AI Design — OPTCG Sandbox

V0 single-player AI. Three difficulty tiers — Easy / Medium / Hard — that
share the same `AiDriver` surface (`shared/engine/ai/AiDriver.ts`) but differ
in strategy and information use.

Authored 2026-05-30. Replaces the earlier "hot-seat" two-human-on-one-device
mode (online multiplayer covers that case).

---

## 1. Knowledge model — what the AI sees

Cards in OPTCG have three states from the AI's perspective:

| Zone                           | Identities visible to AI? | Count visible? |
|--------------------------------|---------------------------|----------------|
| Own decklist (composition)     | YES (the 50 cards)        | YES            |
| Own hand                       | YES (right now)           | YES            |
| Own field / leader / stage     | YES                       | YES            |
| Own trash                      | YES                       | YES            |
| Opp field / leader / stage     | YES                       | YES            |
| Opp trash                      | YES                       | YES            |
| Both DON areas                 | YES (DON is identical)    | YES            |
| Own deck ORDER (next draw)     | NO                        | YES            |
| Own life cards (face-down)     | NO                        | YES            |
| Opp hand                       | NO                        | YES            |
| Opp deck composition           | NO                        | YES            |
| Opp life cards                 | NO                        | YES            |

The AI cannot peek at hidden zones — it can only reason about them
probabilistically.

**Key derived quantity:** *deck residual.* Given my decklist (50 cards) minus
what I've seen leave (cards in my hand + field + stage + trash + cards revealed
to me by effects), the difference is the cards still in (deck + life). The AI
can compute `P(next draw is card X) = copies_of_X_in_residual ÷ residual_size`.

---

## 2. View-restriction contract

`shared/engine/view/viewForPlayer.ts` exposes:

- `viewForPlayer(state, viewer): GameState` — returns a redacted GameState
  with hidden-zone card identities replaced by `UNKNOWN_CARD`. Counts and
  instance IDs are preserved so legal-action enumeration and UI counters
  still work.

- `knownDeckResidual(state, viewer): Card[]` — returns the multiset of cards
  the viewer believes are still in their deck + life, based on their own
  decklist minus what they've seen exposed on their side.

- `drawProbability(state, viewer, predicate): number` — convenience over
  `knownDeckResidual` returning `P(next draw matches predicate)`.

Engine code (`applyAction`, `getLegalActions`) operates on real state and
never sees the redacted view. The AI tiers use the redacted view for
**action choice** and use a separate `evaluateForPlayer` predicate that
reads only zones the viewer is allowed to inspect for **lookahead scoring**.

This way a 1-ply lookahead can run `applyAction` on real state (the simulator
must know real cards to advance physics faithfully) but the heuristic
evaluation refuses to read hidden info — so the AI cannot cheat at the
decision boundary.

---

## 3. Three mindsets

### 3.1 Easy — "casual"

- File: `shared/engine/ai/EasyAi.ts`.
- Random legal action with a suicide-attack filter (attacker power < target
  power = attack discarded as obvious loss).
- No probability reasoning. No threat assessment. No lookahead.
- Plays whatever fires.

### 3.2 Medium — "greedy tactician"

- File: `shared/engine/ai/MediumAi.ts`.
- Priority-bucket greedy: `LETHAL > REMOVE_THREAT > TRADE_UP > CURVE_PLAY
  > GIVE_DON > ATTACK_LEADER > OTHER > SKIP_REACTIVE > END_TURN`.
- Uses present-state heuristics (power, cost, attached DON, life count) — no
  lookahead, no probability.
- Mindset: "best move RIGHT NOW from what's on the board."

### 3.3 Hard — "probabilistic planner"

- File: `shared/engine/ai/HardAi.ts` (new in V0).
- 1-ply lookahead: simulates each candidate action via `applyAction` and
  scores the resulting state with `evaluateForPlayer`.
- Heuristic value function (all weights tuned by playtesting; see code for
  current numbers):
  - life advantage (`own.life − opp.life`) — primary
  - board power sum (own field powers − opp field powers)
  - hand size (proxy for resources)
  - DON economy (active DON, attached DON)
  - threat presence (opp field power, weighted)
  - lethal-on-board bonus (own committed power ≥ opp leader power × remaining swings)
- Uses `knownDeckResidual` for at least one decision: whether to commit DON
  on this turn or hold for a turn where the deck residual makes a key combo
  card likely.
- Cannot inspect opp's hand, opp's deck composition, life identities, or
  own deck order.
- Mindset: trades short-term tempo for expected value over 1-2 turns.

---

## 4. Wiring

- `AiDriver.tier` union is `'easy' | 'medium' | 'hard' | 'expert'`. Expert is
  reserved for a future minimax / MCTS tier and is not implemented in V0.
- `src/store/game.ts` `GameMode` union is `'vs-easy' | 'vs-medium' | 'vs-hard'`.
  Selecting a mode dispatches the matching AI driver in `runAiTurn`.
- Mode picker labels (App.tsx): "vs Easy" / "vs Medium" / "vs Hard".

---

## 5. Non-goals for V0

- Expert tier (minimax, MCTS, learned policy).
- Multi-sample stochastic rollouts (V0 Hard uses deterministic simulation +
  static eval; sampling is a Hard-V2 extension once heuristic baseline is
  measured).
- Opponent modelling beyond "they have N cards drawn from a 50-card deck."
- Bluffing on block/counter windows.
- Worker-hosted AI (`chooseAction` is async-typed so the move is cheap if
  we ever need it; today it runs on the main thread).
