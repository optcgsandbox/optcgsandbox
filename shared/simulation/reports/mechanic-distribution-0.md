# Mechanic distribution — seedBase=0

- Games: **1000**
- Ticks: **21859**
- Adversarial: **true**
- Magnitude coverage: `action-level only`
- Source: `/Users/minamakar/Developer/optcgsandbox/shared/simulation/reports/mechanic-frequency-0.json`

## Per-layer distribution

### action

- Registered kinds: **82**
- Total invocations: **2,525**
- Per-tick rate: **0.1155** calls/tick
- Observed kinds: **59** / 82
- Zero-fire kinds: **23**

| Rank | Kind | Count | Share | Per-tick |
|-----:|------|------:|------:|---------:|
| 1 | `give_power` | 423 | 16.75% | 0.0194 |
| 2 | `power_buff` | 423 | 16.75% | 0.0194 |
| 3 | `searcher_peek` | 322 | 12.75% | 0.0147 |
| 4 | `draw` | 184 | 7.29% | 0.0084 |
| 5 | `give_don_to_target` | 129 | 5.11% | 0.0059 |
| 6 | `play_for_free` | 125 | 4.95% | 0.0057 |
| 7 | `ramp` | 71 | 2.81% | 0.0032 |
| 8 | `set_active_don` | 65 | 2.57% | 0.0030 |
| 9 | `life_to_hand` | 48 | 1.90% | 0.0022 |
| 10 | `mill_self` | 45 | 1.78% | 0.0021 |

<details><summary>23 zero-fire kinds</summary>

- `bottom_of_deck_from_trash`
- `bottom_of_deck_self`
- `damage_immunity_attribute`
- `deal_damage_opp`
- `end_of_turn_trash`
- `give_cost_buff`
- `give_next_play_cost_modifier`
- `noop`
- `opp_bottom_of_deck_from_hand`
- `play_self_from_life`
- `rest_opp_don`
- `restrict_effect_type`
- `restrict_opp_attack`
- `return_to_hand_from_field`
- `reveal_top_then_if_cost_min`
- `schedule_at_end_of_own_turn`
- `search_deck`
- `set_base_power`
- `set_base_power_copy_from`
- `set_base_power_copy_from_target`
- `shuffle_deck`
- `take_damage_self`
- `trash_opp_field`

</details>

### cost

- Registered kinds: **27**
- Total invocations: **780**
- Per-tick rate: **0.0357** calls/tick
- Observed kinds: **18** / 27
- Zero-fire kinds: **9**

| Rank | Kind | Count | Share | Per-tick |
|-----:|------|------:|------:|---------:|
| 1 | `donCost` | 197 | 25.26% | 0.0090 |
| 2 | `discardHand` | 194 | 24.87% | 0.0089 |
| 3 | `restSelf` | 128 | 16.41% | 0.0059 |
| 4 | `donCostReturnToDeck` | 46 | 5.90% | 0.0021 |
| 5 | `flipLife` | 43 | 5.51% | 0.0020 |
| 6 | `revealHand` | 38 | 4.87% | 0.0017 |
| 7 | `discardHandFilter` | 37 | 4.74% | 0.0017 |
| 8 | `trashSelf` | 30 | 3.85% | 0.0014 |
| 9 | `lifeToHand` | 24 | 3.08% | 0.0011 |
| 10 | `selfPowerCost` | 10 | 1.28% | 0.0005 |

<details><summary>9 zero-fire kinds</summary>

- `bottomOfDeckFromTrashFilter`
- `restLeader`
- `restOwnCharFilter`
- `restSource`
- `returnAttachedDon`
- `returnOwnCharFilter`
- `returnOwnDon`
- `trashFromHand`
- `trashFromTrash`

</details>

### target

- Registered kinds: **18**
- Total invocations: **1,773**
- Per-tick rate: **0.0811** calls/tick
- Observed kinds: **13** / 18
- Zero-fire kinds: **5**

| Rank | Kind | Count | Share | Per-tick |
|-----:|------|------:|------:|---------:|
| 1 | `opp_character` | 623 | 35.14% | 0.0285 |
| 2 | `your_character` | 388 | 21.88% | 0.0178 |
| 3 | `your_leader` | 305 | 17.20% | 0.0140 |
| 4 | `your_leader_or_character` | 217 | 12.24% | 0.0099 |
| 5 | `self` | 98 | 5.53% | 0.0045 |
| 6 | `opp_leader_or_character` | 36 | 2.03% | 0.0016 |
| 7 | `all_opp_characters` | 30 | 1.69% | 0.0014 |
| 8 | `all_your_characters` | 25 | 1.41% | 0.0011 |
| 9 | `opp_life_top` | 24 | 1.35% | 0.0011 |
| 10 | `opp_don_or_character` | 16 | 0.90% | 0.0007 |

<details><summary>5 zero-fire kinds</summary>

- `all_characters`
- `any_character`
- `opp_hand_card`
- `top_of_deck`
- `top_of_opp_deck`

</details>

### magnitude

- Total invocations: **1,580**
- Per-tick rate: **0.0723** calls/tick

| Rank | Kind | Count | Share | Per-tick |
|-----:|------|------:|------:|---------:|
| 1 | `literal` | 1,520 | 96.20% | 0.0695 |
| 2 | `per_count` | 56 | 3.54% | 0.0026 |
| 3 | `read_state` | 4 | 0.25% | 0.0002 |

## Alias-folded action view (presentation-only)

- Raw action invocations (incl. wrapper double-counts): **2,525**
- Inner-alias contribution (subtracted in folded view): **507**
- Folded action invocations (outer-only): **2,018**

| Outer (cards.json) | Inner (engine-only) | Outer count | Inner count | Match |
|---|---|---:|---:|:-:|
| `power_buff` | `give_power` | 423 | 423 | ✓ |
| `mill_self` | `trash_top_of_deck` | 45 | 45 | ✓ |
| `mill_opp` | `mill` | 4 | 4 | ✓ |
| `set_active` | `active_target` | 29 | 29 | ✓ |
| `opp_discard_from_hand` | `discard_opp_hand` | 6 | 6 | ✓ |

_Raw JSON counts in `mechanic-frequency-<seed>.json` are unchanged. This view subtracts inner-alias counts for human reading only; the instrumentation correctly records every `actionHandlers.get(kind)` lookup._
