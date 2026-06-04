# Playability — seedBase=0

- Games: 1000
- Adversarial: true

## Distributions

| Metric | n | min | P25 | P50 | P75 | max | mean |
|---|---:|---:|---:|---:|---:|---:|---:|
| turn | 1000 | 1 | 1 | 3 | 5 | 16 | 3.249 |
| ticks | 1000 | 1 | 3 | 13 | 33 | 180 | 21.859 |
| ticksPerTurn | 1000 | 1 | 3 | 5.5 | 7.2 | 11.25 | 5.38 |
| uniqueActionTypesPerGame | 1000 | 1 | 2 | 9 | 13 | 15 | 8.05 |

## Terminal categories

- completed: **1000**
- failed: **0**
- timeout: **0**

## Winner side

- A: **522**
- B: **478**
- none: **0**

## Win reason

- `concede`: 999
- `life_zero`: 1

## Top-level action-type frequency

| Rank | Type | Count |
|---:|------|------:|
| 1 | `PLAY_COUNTER` | 2566 |
| 2 | `END_TURN` | 2249 |
| 3 | `DECLARE_ATTACK` | 2248 |
| 4 | `PLAY_CARD` | 2192 |
| 5 | `ATTACH_DON` | 2069 |
| 6 | `SKIP_BLOCKER` | 1821 |
| 7 | `ROLL_DICE` | 1812 |
| 8 | `SKIP_COUNTER` | 1800 |
| 9 | `ACTIVATE_MAIN` | 1763 |
| 10 | `CONCEDE` | 999 |
| 11 | `KEEP_HAND` | 847 |
| 12 | `MULLIGAN` | 505 |
| 13 | `CHOOSE_FIRST` | 353 |
| 14 | `CHOOSE_SECOND` | 350 |
| 15 | `DECLARE_BLOCKER` | 159 |
| 16 | `PLAY_STAGE` | 91 |
| 17 | `RESOLVE_CHOOSE_ONE` | 34 |
| 18 | `RESOLVE_DISCARD` | 1 |