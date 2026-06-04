# Playability — seedBase=0

- Games: 1000
- Adversarial: true

## Distributions

| Metric | n | min | P25 | P50 | P75 | max | mean |
|---|---:|---:|---:|---:|---:|---:|---:|
| turn | 1000 | 1 | 13 | 17 | 21 | 46 | 16.202 |
| ticks | 1000 | 3 | 139 | 201 | 267 | 646 | 196.523 |
| ticksPerTurn | 1000 | 3 | 10 | 11.578947368421053 | 12.857142857142858 | 19.666666666666668 | 10.531 |
| uniqueActionTypesPerGame | 1000 | 2 | 12 | 13 | 13 | 16 | 11.163 |

## Terminal categories

- completed: **1000**
- failed: **0**
- timeout: **0**

## Winner side

- A: **543**
- B: **457**
- none: **0**

## Win reason

- `concede`: 163
- `deck_out`: 6
- `life_zero`: 831

## Top-level action-type frequency

| Rank | Type | Count |
|---:|------|------:|
| 1 | `DECLARE_ATTACK` | 34724 |
| 2 | `ATTACH_DON` | 34414 |
| 3 | `SKIP_COUNTER` | 32737 |
| 4 | `SKIP_BLOCKER` | 30718 |
| 5 | `PLAY_CARD` | 16173 |
| 6 | `END_TURN` | 15202 |
| 7 | `ACTIVATE_MAIN` | 12785 |
| 8 | `PLAY_COUNTER` | 12253 |
| 9 | `DECLARE_BLOCKER` | 2019 |
| 10 | `ROLL_DICE` | 2000 |
| 11 | `KEEP_HAND` | 1038 |
| 12 | `MULLIGAN` | 636 |
| 13 | `PLAY_STAGE` | 531 |
| 14 | `CHOOSE_SECOND` | 419 |
| 15 | `CHOOSE_FIRST` | 418 |
| 16 | `RESOLVE_CHOOSE_ONE` | 286 |
| 17 | `CONCEDE` | 163 |
| 18 | `RESOLVE_TRIGGER` | 4 |
| 19 | `RESOLVE_DISCARD` | 3 |