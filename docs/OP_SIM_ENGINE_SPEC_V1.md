# OP Sim Engine Specification (v1)

## PURPOSE

This specification defines all engine primitives used by OP Sim.

Cards MUST be implemented using these primitives only.

Cards MUST NOT introduce new actions, triggers, selectors, durations, conditions, or mechanics.

If a card cannot be represented exactly using this specification, it must be marked:

```json
{
  "status": "UNSUPPORTED",
  "reason": "Explanation"
}
```

---

## TRIGGERS

```json
[
  "ON_PLAY",
  "ON_ATTACK",
  "ON_BLOCK",
  "ON_KO",
  "ON_REST",
  "ON_ACTIVATE_MAIN",
  "ON_OPPONENT_ATTACK",
  "ON_TURN_START",
  "ON_TURN_END",
  "ON_DON_ATTACH",
  "ON_CHARACTER_PLAYED",
  "ON_CHARACTER_KO",
  "ON_TRIGGER",
  "ON_COUNTER",
  "ON_BATTLE_START",
  "ON_BATTLE_END",
  "ON_LIFE_LOST",
  "ON_CARD_ADDED_TO_HAND",
  "ON_CARD_TRASHED",
  "ON_CHARACTER_RESTED",
  "ON_CHARACTER_ACTIVATED"
]
```

---

## CONDITIONS

```json
[
  "HAS_DON",
  "HAS_CHARACTER",
  "HAS_TRAIT",
  "HAS_COLOR",
  "HAS_COST_AT_LEAST",
  "HAS_COST_AT_MOST",
  "HAS_POWER_AT_LEAST",
  "HAS_POWER_AT_MOST",
  "LEADER_IS",
  "COUNT_CHARACTERS",
  "COUNT_RESTED_CHARACTERS",
  "COUNT_ACTIVE_CHARACTERS",
  "COUNT_TRAIT",
  "COUNT_COLOR",
  "LIFE_AT_OR_BELOW",
  "LIFE_AT_OR_ABOVE",
  "HAND_SIZE_AT_LEAST",
  "HAND_SIZE_AT_MOST",
  "TRASH_SIZE_AT_LEAST",
  "TURN_PLAYER",
  "EXISTS_TARGET",
  "NO_TARGET_EXISTS",
  "IS_RESTED",
  "IS_ACTIVE",
  "HAS_ATTRIBUTE"
]
```

---

## SELECTORS

```json
[
  "SELF_LEADER",
  "OPPONENT_LEADER",

  "SELF_CHARACTER",
  "OPPONENT_CHARACTER",

  "SELF_HAND",
  "OPPONENT_HAND",

  "SELF_DECK",
  "OPPONENT_DECK",

  "SELF_TRASH",
  "OPPONENT_TRASH",

  "SELF_LIFE",
  "OPPONENT_LIFE",

  "THIS_CARD",
  "ATTACKING_CHARACTER",
  "ATTACKING_LEADER",

  "TARGET_CHARACTER",
  "TARGET_LEADER",

  "ALL_SELF_CHARACTERS",
  "ALL_OPPONENT_CHARACTERS"
]
```

---

## SELECTOR FILTERS

```json
[
  "trait",
  "color",
  "cost",
  "cost_gte",
  "cost_lte",
  "power",
  "power_gte",
  "power_lte",
  "attribute",
  "type",
  "is_rested",
  "is_active",
  "has_counter",
  "without_counter",
  "owner"
]
```

Example:

```json
{
  "selector": "OPPONENT_CHARACTER",
  "filters": {
    "cost_lte": 4,
    "is_rested": true
  }
}
```

---

## ACTIONS

### POWER / COUNTER

```json
[
  "ADD_POWER",
  "SET_POWER",
  "ADD_COUNTER"
]
```

### CARD MOVEMENT

```json
[
  "DRAW",
  "TRASH",
  "PLAY",
  "ADD_TO_HAND",
  "RETURN_TO_HAND",
  "RETURN_TO_DECK_TOP",
  "RETURN_TO_DECK_BOTTOM"
]
```

### BOARD STATE

```json
[
  "REST",
  "ACTIVATE",
  "KO",
  "ATTACH_DON",
  "DETACH_DON"
]
```

### SEARCH / REVEAL

```json
[
  "SEARCH_DECK",
  "REVEAL_CARDS",
  "LOOK_AT_TOP",
  "REORDER_CARDS",
  "SHUFFLE_DECK"
]
```

### LIFE

```json
[
  "ADD_LIFE",
  "TAKE_LIFE",
  "TRASH_LIFE"
]
```

### STATUS EFFECTS

```json
[
  "GAIN_RUSH",
  "GAIN_BLOCKER",
  "GAIN_DOUBLE_ATTACK",
  "GAIN_BANISH",
  "GAIN_COUNTER_EFFECT"
]
```

### RESOURCE ACTIONS

```json
[
  "DISCARD",
  "TRASH_FROM_HAND",
  "TRASH_FROM_FIELD",
  "SEND_TO_TRASH"
]
```

---

## DURATIONS

```json
[
  "THIS_BATTLE",
  "END_OF_TURN",
  "START_OF_NEXT_TURN",
  "PERMANENT"
]
```

---

## EFFECT STRUCTURE

Every card effect must use the following structure:

```json
{
  "trigger": "ON_ATTACK",

  "requires_don": 1,

  "conditions": [
    {
      "type": "HAS_CHARACTER",
      "owner": "SELF",
      "trait": "Land of Wano",
      "cost_gte": 5
    }
  ],

  "effects": [
    {
      "action": "ADD_POWER",
      "target": "SELF_LEADER",
      "amount": 1000,
      "duration": "START_OF_NEXT_TURN"
    }
  ]
}
```

---

## CARD IMPLEMENTATION RULES

1. Use only official card text.
2. Ignore tags, confidence scores, pricing, market data, and generated metadata.
3. Never invent effects.
4. Never simplify effects.
5. Never create new engine primitives.
6. Preserve all restrictions exactly.
7. Preserve all timing exactly.
8. Preserve all durations exactly.
9. Preserve all targeting requirements exactly.
10. Preserve optional vs mandatory effects exactly.

---

## VALIDATION CHECKLIST

Before completing a card implementation:

- Every sentence of card text is represented.
- No extra behavior has been added.
- No restriction has been removed.
- Every trigger exists.
- Every selector exists.
- Every action exists.
- Every condition exists.
- Every duration exists.

If any requirement fails:

```json
{
  "status": "UNSUPPORTED",
  "reason": "Exact explanation"
}
```

---

## OUTPUT REQUIREMENT

Return JSON only.

No markdown.

No explanations.

No notes.

No comments.

No assumptions.

No confidence scores.

Only valid card implementation JSON or UNSUPPORTED.
