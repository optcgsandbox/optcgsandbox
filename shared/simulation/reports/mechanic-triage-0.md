# Mechanic triage — seedBase=0

- Frequency source: `/Users/minamakar/Developer/optcgsandbox/shared/simulation/reports/mechanic-frequency-0.json`
- Corpus source: `/Users/minamakar/Developer/optcgsandbox/shared/data/cards.json` (2489 cards)
- Sim batch: 1000 games / 21859 ticks / adversarial=true
- Magnitude coverage: `action-level only`

## CLASSIFICATION CRITERIA

- `orphan_primitive` — corpus contains **0** references to this kind.
- `deck_pool_starvation` — corpus has **1–2** cards referencing this kind (sample too thin to be reliably drafted in 1000 games × 2 decks).
- `conditional_or_rare_path` — corpus has **3+** cards referencing this kind (at least one card statistically should have been drafted; unfired implies the surrounding trigger / condition / target gate was not satisfied during sim).

The 3-way split uses corpus reference count only. NO inference is performed beyond `(corpus_refs, sim_frequency)`. NO optimization or "fix" recommendations are emitted.

## Per-layer zero-fire classification

### action

- Registered kinds: **82**
- Observed (fired in sim): **59**
- Zero-fire: **23**

#### orphan_primitive (6)

| Kind | Classification | Corpus refs | Sample cards |
|------|----------------|------------:|--------------|
| `deal_damage_opp` | orphan_primitive | 0 | — |
| `end_of_turn_trash` | orphan_primitive | 0 | — |
| `give_next_play_cost_modifier` | orphan_primitive | 0 | — |
| `return_to_hand_from_field` | orphan_primitive | 0 | — |
| `shuffle_deck` | orphan_primitive | 0 | — |
| `trash_opp_field` | orphan_primitive | 0 | — |

#### deck_pool_starvation (10)

| Kind | Classification | Corpus refs | Sample cards |
|------|----------------|------------:|--------------|
| `bottom_of_deck_self` | deck_pool_starvation | 2 | `OP02-064`, `OP09-051` |
| `damage_immunity_attribute` | deck_pool_starvation | 2 | `OP03-008`, `OP08-114` |
| `noop` | deck_pool_starvation | 2 | `EB01-008`, `EB02-030` |
| `play_self_from_life` | deck_pool_starvation | 1 | `OP01-009` |
| `restrict_opp_attack` | deck_pool_starvation | 1 | `OP08-043` |
| `reveal_top_then_if_cost_min` | deck_pool_starvation | 1 | `EB01-029` |
| `schedule_at_end_of_own_turn` | deck_pool_starvation | 1 | `EB02-015` |
| `search_deck` | deck_pool_starvation | 1 | `OP01-098` |
| `set_base_power_copy_from_target` | deck_pool_starvation | 1 | `EB01-061` |
| `take_damage_self` | deck_pool_starvation | 1 | `OP14-115` |

#### conditional_or_rare_path (7)

| Kind | Classification | Corpus refs | Sample cards |
|------|----------------|------------:|--------------|
| `bottom_of_deck_from_trash` | conditional_or_rare_path | 5 | `OP07-091`, `OP11-001`, `OP12-042`, `P-055`, `P-082` |
| `give_cost_buff` | conditional_or_rare_path | 5 | `EB02-041`, `ST14-004`, `ST14-008`, `ST14-011`, `ST14-016` |
| `opp_bottom_of_deck_from_hand` | conditional_or_rare_path | 4 | `OP06-044`, `OP08-046`, `OP15-048`, `P-048` |
| `rest_opp_don` | conditional_or_rare_path | 6 | `OP04-021`, `OP06-062`, `OP06-112`, `P-060`, `PRB02-005` |
| `restrict_effect_type` | conditional_or_rare_path | 9 | `EB04-016`, `OP02-004`, `OP02-023`, `OP09-022`, `OP10-030` |
| `set_base_power` | conditional_or_rare_path | 3 | `EB04-004`, `P-092`, `ST26-005` |
| `set_base_power_copy_from` | conditional_or_rare_path | 4 | `EB04-052`, `OP04-069`, `OP06-009`, `OP14-009` |

### cost

- Registered kinds: **27**
- Observed (fired in sim): **18**
- Zero-fire: **9**

#### orphan_primitive (5)

| Kind | Classification | Corpus refs | Sample cards |
|------|----------------|------------:|--------------|
| `restSource` | orphan_primitive | 0 | — |
| `returnAttachedDon` | orphan_primitive | 0 | — |
| `returnOwnDon` | orphan_primitive | 0 | — |
| `trashFromHand` | orphan_primitive | 0 | — |
| `trashFromTrash` | orphan_primitive | 0 | — |

#### deck_pool_starvation (2)

| Kind | Classification | Corpus refs | Sample cards |
|------|----------------|------------:|--------------|
| `bottomOfDeckFromTrashFilter` | deck_pool_starvation | 1 | `EB01-043` |
| `returnOwnCharFilter` | deck_pool_starvation | 1 | `EB01-021` |

#### conditional_or_rare_path (2)

| Kind | Classification | Corpus refs | Sample cards |
|------|----------------|------------:|--------------|
| `restLeader` | conditional_or_rare_path | 4 | `OP04-081`, `OP04-082`, `OP04-088`, `OP04-091` |
| `restOwnCharFilter` | conditional_or_rare_path | 13 | `OP01-055`, `OP03-021`, `OP03-036`, `OP03-037`, `OP05-026` |

### target

- Registered kinds: **18**
- Observed (fired in sim): **13**
- Zero-fire: **5**

#### orphan_primitive (3)

| Kind | Classification | Corpus refs | Sample cards |
|------|----------------|------------:|--------------|
| `opp_hand_card` | orphan_primitive | 0 | — |
| `top_of_deck` | orphan_primitive | 0 | — |
| `top_of_opp_deck` | orphan_primitive | 0 | — |

#### deck_pool_starvation (1)

| Kind | Classification | Corpus refs | Sample cards |
|------|----------------|------------:|--------------|
| `any_character` | deck_pool_starvation | 2 | `EB01-026`, `EB02-024` |

#### conditional_or_rare_path (1)

| Kind | Classification | Corpus refs | Sample cards |
|------|----------------|------------:|--------------|
| `all_characters` | conditional_or_rare_path | 5 | `OP01-094`, `OP05-040`, `OP05-058`, `OP08-119`, `ST08-005` |

### magnitude

- Registered kinds: (no engine registry — corpus + sim union)
- Observed (fired in sim): **3**
- Zero-fire: **0**

_No zero-fire kinds in this layer._

## Cross-cut notes

### `match_opp_don` (magnitude formula)

- Sim invocations (seedBase=0, 1000 games): **0**
- Status: **unobserved in sampled adversarial runs** — NOT classified as unused.
- Notes: magnitude coverage is `action-level only`; counts only reach this report when the formula is consumed by an action handler reachable via `action.magnitude`.

### `power_buff` ↔ `give_power` structural coupling

- Sim count `power_buff`: **423**
- Sim count `give_power`: **423**
- Delta (gp − pb): **0**
- Cards referencing `power_buff`: **422**
- Cards referencing `give_power`: **0**
- Cards referencing BOTH: **0**
- Notes: frequency delta + corpus-reference overlap are reported as raw counts. NO causality is inferred.
