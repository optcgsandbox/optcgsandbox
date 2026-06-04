# Playability — seedBase=0

- Games: 1000
- Adversarial: true

## Distributions

| Metric | n | min | P25 | P50 | P75 | max | mean |
|---|---:|---:|---:|---:|---:|---:|---:|
| turn | 1000 | 5 | 15 | 18 | 22 | 46 | 19.179 |
| ticks | 1000 | 44 | 175 | 221 | 284 | 646 | 234.7 |
| ticksPerTurn | 1000 | 6.777777777777778 | 10.88888888888889 | 12.041666666666666 | 13.105263157894736 | 19.666666666666668 | 12.011 |
| uniqueActionTypesPerGame | 1000 | 11 | 12 | 13 | 14 | 16 | 12.952 |

## Terminal categories

- completed: **1000**
- failed: **0**
- timeout: **0**

## Winner side

- A: **532**
- B: **468**
- none: **0**

## Win reason

- `deck_out`: 6
- `life_zero`: 994

## Top-level action-type frequency

| Rank | Type | Count |
|---:|------|------:|
| 1 | `DECLARE_ATTACK` | 41487 |
| 2 | `ATTACH_DON` | 41072 |
| 3 | `SKIP_COUNTER` | 39144 |
| 4 | `SKIP_BLOCKER` | 36749 |
| 5 | `PLAY_CARD` | 19359 |
| 6 | `END_TURN` | 18179 |
| 7 | `ACTIVATE_MAIN` | 15190 |
| 8 | `PLAY_COUNTER` | 14726 |
| 9 | `ROLL_DICE` | 2396 |
| 10 | `DECLARE_BLOCKER` | 2395 |
| 11 | `KEEP_HAND` | 1240 |
| 12 | `MULLIGAN` | 760 |
| 13 | `PLAY_STAGE` | 616 |
| 14 | `CHOOSE_FIRST` | 501 |
| 15 | `CHOOSE_SECOND` | 499 |
| 16 | `RESOLVE_CHOOSE_ONE` | 376 |
| 17 | `RESOLVE_TRIGGER` | 7 |
| 18 | `RESOLVE_DISCARD` | 4 |