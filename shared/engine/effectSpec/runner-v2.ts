// EffectSpec v2 runtime interpreter. Per docs/optcg-sim/card-effect-
// 100pct-spec.md §Phase A.3.
//
// STATUS: Sub-phase A.3.1 — condition evaluator only. Other helpers
// (target resolver, action handlers, continuous, replacements) land in
// subsequent commits A.3.2 → A.3.10.

import type { CardInstance, GameState, PlayerId } from '../GameState';
import type { Card } from '../cards/Card';
import type { EffectActionV2, EffectConditionV2, EffectTargetV2, TargetFilter } from './types-v2';

const OTHER: Record<PlayerId, PlayerId> = { A: 'B', B: 'A' };

/** Evaluate an EffectConditionV2 against the current state, from
 *  `controller`'s perspective. Returns true when the condition holds and
 *  the clause should fire.
 *
 *  Composite conditions (and/or/not) recurse. Short-circuits on and/or so
 *  side-effect-free predicates don't run more than they have to.
 *
 *  Unknown condition types return `false` defensively (extension-safe).
 */
export function evaluateConditionV2(
  state: GameState,
  controller: PlayerId,
  cond: EffectConditionV2 | undefined,
  sourceInstanceId?: string,
): boolean {
  if (!cond) return true;
  const me = state.players[controller];
  const opp = state.players[OTHER[controller]];

  switch (cond.type) {
    case 'always':
      return true;

    // ── Leader identity ────────────────────────────────────────────
    case 'if_leader_is': {
      const card = state.cardLibrary[me.leader.cardId];
      return card?.name === cond.name;
    }
    case 'if_leader_has_trait': {
      const card = state.cardLibrary[me.leader.cardId];
      return Array.isArray(card?.traits) && card.traits.includes(cond.trait);
    }
    case 'if_leader_has_type': {
      // OPTCG "type" = trait string (Bandai calls trait + type interchangeably
      // in printed text e.g. {Straw Hat Crew}). We treat it as trait-includes.
      const card = state.cardLibrary[me.leader.cardId];
      return Array.isArray(card?.traits) &&
        card.traits.some((t) => t.includes(cond.typeString));
    }
    case 'if_leader_multicolored': {
      const card = state.cardLibrary[me.leader.cardId];
      return Array.isArray(card?.colors) && card.colors.length >= 2;
    }
    case 'if_leader_power_max': {
      const card = state.cardLibrary[me.leader.cardId];
      const base = typeof card?.power === 'number' ? card.power : 0;
      const mod = me.leader.powerModifier ?? 0;
      const buff = me.leader.attachedDon.length * 1000;
      return Math.max(0, base + mod + buff) <= cond.n;
    }

    // ── Resource counts ────────────────────────────────────────────
    case 'if_don_min':
      return me.donCostArea.length >= cond.n;
    case 'if_don_max':
      return me.donCostArea.length <= cond.n;
    case 'if_opp_don_min':
      return opp.donCostArea.length >= cond.n;
    case 'if_opp_don_max':
      return opp.donCostArea.length <= cond.n;
    case 'if_own_don_le_opp':
      return me.donCostArea.length <= opp.donCostArea.length;

    case 'if_own_life_max':
      return me.life.length <= cond.n;
    case 'if_own_life_min':
      return me.life.length >= cond.n;
    case 'if_opp_life_max':
      return opp.life.length <= cond.n;
    case 'if_opp_life_min':
      return opp.life.length >= cond.n;

    case 'if_hand_max':
      return me.hand.length <= cond.n;
    case 'if_hand_min':
      return me.hand.length >= cond.n;
    case 'if_opp_hand_min':
      return opp.hand.length >= cond.n;
    case 'if_opp_hand_max':
      return opp.hand.length <= cond.n;

    case 'if_trash_min':
      return me.trash.length >= cond.n;
    case 'if_trash_max':
      return me.trash.length <= cond.n;

    // ── Field state ─────────────────────────────────────────────────
    case 'if_own_chars_min': {
      const charCount = me.field.filter(
        (inst) => state.cardLibrary[inst.cardId]?.kind === 'character',
      ).length;
      return charCount >= cond.n;
    }
    case 'if_own_chars_min_cost': {
      const match = me.field.filter((inst) => {
        const card = state.cardLibrary[inst.cardId];
        return card?.kind === 'character' &&
          typeof card.cost === 'number' && card.cost >= cond.minCost;
      });
      return match.length >= cond.n;
    }
    case 'if_opp_chars_min': {
      const charCount = opp.field.filter(
        (inst) => state.cardLibrary[inst.cardId]?.kind === 'character',
      ).length;
      return charCount >= cond.n;
    }
    case 'if_opp_chars_min_cost': {
      const match = opp.field.filter((inst) => {
        const card = state.cardLibrary[inst.cardId];
        return card?.kind === 'character' &&
          typeof card.cost === 'number' && card.cost >= cond.minCost;
      });
      return match.length >= cond.n;
    }
    case 'if_opp_chars_max_cost': {
      const match = opp.field.filter((inst) => {
        const card = state.cardLibrary[inst.cardId];
        return card?.kind === 'character' &&
          typeof card.cost === 'number' && card.cost <= cond.maxCost;
      });
      return match.length >= cond.n;
    }
    case 'if_attached_don_min': {
      if (!sourceInstanceId) return false;
      const inst = state.instances[sourceInstanceId];
      if (!inst) return false;
      return inst.attachedDon.length >= cond.n;
    }
    case 'is_opp_turn':
      return state.activePlayer !== controller;
    case 'is_own_turn':
      return state.activePlayer === controller;
    case 'if_only_chars_with_trait': {
      const chars = me.field.filter((inst) => state.cardLibrary[inst.cardId]?.kind === 'character');
      if (chars.length === 0) return false;
      return chars.every((inst) => {
        const card = state.cardLibrary[inst.cardId];
        return Array.isArray(card?.traits) && card.traits.includes(cond.trait);
      });
    }
    case 'if_own_chars_max_with_min_power': {
      const count = me.field.filter((inst) => {
        const card = state.cardLibrary[inst.cardId];
        if (card?.kind !== 'character') return false;
        const power = (card as { power?: number }).power ?? 0;
        return power >= cond.minPower;
      }).length;
      return count <= cond.n;
    }
    case 'if_opp_chars_min_power': {
      const count = opp.field.filter((inst) => {
        const card = state.cardLibrary[inst.cardId];
        if (card?.kind !== 'character') return false;
        const power = (card as { power?: number }).power ?? 0;
        return power >= cond.minPower;
      }).length;
      return count >= cond.n;
    }
    case 'if_own_chars_min_with_trait': {
      const count = me.field.filter((inst) => {
        const card = state.cardLibrary[inst.cardId];
        if (card?.kind !== 'character') return false;
        return Array.isArray(card?.traits) && card.traits.includes(cond.trait);
      }).length;
      return count >= cond.n;
    }
    case 'if_owned_other_with_name':
      return me.field.some((inst) =>
        state.cardLibrary[inst.cardId]?.name === cond.name,
      );
    case 'if_no_other_with_name':
      return !me.field.some((inst) =>
        state.cardLibrary[inst.cardId]?.name === cond.name,
      );
    case 'if_played_this_turn': {
      // True when the source card was played this turn — engine tracks via
      // `summoningSick` flag on instances. Cleared at end of own turn.
      if (!sourceInstanceId) return false;
      const inst = state.instances[sourceInstanceId];
      return !!inst?.summoningSick;
    }
    case 'if_have_given_don_min': {
      // "Given DON" means DON attached to opp's characters by your effects.
      // Engine doesn't model the "your-effect" provenance yet; approximate
      // as opp's total attachedDon across field + leader + stage.
      const acc = (sum: number, inst: { attachedDon: string[] }) =>
        sum + inst.attachedDon.length;
      const total =
        (opp.leader.attachedDon.length) +
        opp.field.reduce(acc, 0) +
        (opp.stage ? opp.stage.attachedDon.length : 0);
      return total >= cond.n;
    }
    case 'if_field_total_cost_min': {
      const total = me.field.reduce((sum, inst) => {
        const card = state.cardLibrary[inst.cardId];
        return sum + (typeof card?.cost === 'number' ? card.cost : 0);
      }, 0);
      return total >= cond.n;
    }
    case 'if_attacker_has_attribute': {
      // Read the in-flight pendingAttack's attacker. Returns false when no
      // attack is in progress.
      if (!state.pendingAttack) return false;
      const attackerInst = state.instances[state.pendingAttack.attackerInstanceId];
      if (!attackerInst) return false;
      const card = state.cardLibrary[attackerInst.cardId];
      return card?.attribute === cond.attribute;
    }

    // ── Composite ───────────────────────────────────────────────────
    case 'and':
      return cond.conditions.every((c) => evaluateConditionV2(state, controller, c, sourceInstanceId));
    case 'or':
      return cond.conditions.some((c) => evaluateConditionV2(state, controller, c, sourceInstanceId));
    case 'not':
      return !evaluateConditionV2(state, controller, cond.condition, sourceInstanceId);

    default:
      // Future condition types fall through to false defensively.
      return false;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Target resolver — Sub-phase A.3.2
// ─────────────────────────────────────────────────────────────────────

/** Compute the effective power of an instance (base + DON × 1000 + mod).
 *  Used by power-axis filters. */
function effectivePower(state: GameState, inst: CardInstance): number {
  const card = state.cardLibrary[inst.cardId];
  let base = 0;
  if (card?.kind === 'leader' || card?.kind === 'character') {
    base = (card as { power: number }).power ?? 0;
  }
  const mod = inst.powerModifier ?? 0;
  return Math.max(0, base + inst.attachedDon.length * 1000 + mod);
}

/** Compute the effective cost of an instance (base cost + costModifier).
 *  Used by cost-axis filters. */
function effectiveCost(card: Card | undefined, inst: CardInstance): number | null {
  if (!card || card.cost === null || card.cost === undefined) return null;
  return Math.max(0, card.cost + (inst.costModifier ?? 0));
}

/** Test whether an instance passes every axis of a TargetFilter. Each
 *  axis is independent — omitted axes match everything. */
function matchesFilter(state: GameState, inst: CardInstance, filter: TargetFilter | undefined): boolean {
  if (!filter) return true;
  const card = state.cardLibrary[inst.cardId];
  if (!card) return false;

  if (typeof filter.costMax === 'number') {
    const c = effectiveCost(card, inst);
    if (c === null || c > filter.costMax) return false;
  }
  if (typeof filter.costMin === 'number') {
    const c = effectiveCost(card, inst);
    if (c === null || c < filter.costMin) return false;
  }
  if (typeof filter.powerMax === 'number') {
    if (effectivePower(state, inst) > filter.powerMax) return false;
  }
  if (typeof filter.powerMin === 'number') {
    if (effectivePower(state, inst) < filter.powerMin) return false;
  }
  if (filter.trait) {
    if (!Array.isArray(card.traits) || !card.traits.includes(filter.trait)) return false;
  }
  if (filter.typeIncludes) {
    if (!Array.isArray(card.traits) || !card.traits.some((t) => t.includes(filter.typeIncludes!))) return false;
  }
  if (filter.colors && filter.colors.length > 0) {
    if (!Array.isArray(card.colors) || !card.colors.some((c) => filter.colors!.includes(c))) return false;
  }
  if (filter.nameIs) {
    if (card.name !== filter.nameIs) return false;
  }
  if (filter.nameExcludes) {
    if (card.name === filter.nameExcludes) return false;
  }
  if (filter.kind) {
    if (card.kind !== filter.kind) return false;
  }
  if (typeof filter.rested === 'boolean') {
    if (inst.rested !== filter.rested) return false;
  }
  if (filter.attribute) {
    if ((card as { attribute?: string }).attribute !== filter.attribute) return false;
  }
  if (filter.hasTrigger === true) {
    const text = (card as { effectText?: string | null }).effectText ?? '';
    if (!text.includes('[Trigger]')) return false;
  }
  if (filter.noBaseEffect === true) {
    // Vanilla / no base effect: card has no effectSpecV2 content OR explicit ground-truth marker.
    const spec = (card as { effectSpecV2?: { clauses?: unknown[]; continuous?: unknown[]; replacements?: unknown[]; verified?: string } }).effectSpecV2;
    const hasContent = spec && ((spec.clauses?.length ?? 0) > 0 || (spec.continuous?.length ?? 0) > 0 || (spec.replacements?.length ?? 0) > 0);
    if (hasContent) return false;
  }
  return true;
}

/** Resolve an EffectTargetV2 descriptor against state. Returns an array
 *  of instance ids. Single-target kinds return at most 1; mass-target
 *  kinds (all_your_characters, all_opp_characters) return many.
 *
 *  V0 picks deterministically (first match in scan order). The runtime
 *  will eventually accept a controller-provided pick when ambiguous —
 *  this resolver gives the default candidate set. */
export function resolveTargetV2(
  state: GameState,
  controller: PlayerId,
  sourceInstanceId: string,
  target: EffectTargetV2 | undefined,
): string[] {
  if (!target) return [];
  const me = state.players[controller];
  const opp = state.players[OTHER[controller]];

  switch (target.kind) {
    case 'self':
      return state.instances[sourceInstanceId] ? [sourceInstanceId] : [];

    case 'your_leader':
      return [me.leader.instanceId];

    case 'opp_leader':
      return [opp.leader.instanceId];

    case 'your_character': {
      const hits = me.field.filter((inst) => matchesFilter(state, inst, target.filter));
      return hits.length > 0 ? [hits[0].instanceId] : [];
    }

    case 'your_leader_or_character': {
      // Picks the leader by default (cheap default — UI can override later).
      if (matchesFilter(state, me.leader, target.filter)) return [me.leader.instanceId];
      const hits = me.field.filter((inst) => matchesFilter(state, inst, target.filter));
      return hits.length > 0 ? [hits[0].instanceId] : [];
    }

    case 'opp_character': {
      const hits = opp.field.filter((inst) => matchesFilter(state, inst, target.filter));
      return hits.length > 0 ? [hits[0].instanceId] : [];
    }

    case 'opp_leader_or_character': {
      if (matchesFilter(state, opp.leader, target.filter)) return [opp.leader.instanceId];
      const hits = opp.field.filter((inst) => matchesFilter(state, inst, target.filter));
      return hits.length > 0 ? [hits[0].instanceId] : [];
    }

    case 'opp_hand_card': {
      const hits = opp.hand
        .map((id) => state.instances[id])
        .filter((inst): inst is CardInstance => !!inst && matchesFilter(state, inst, target.filter));
      return hits.length > 0 ? [hits[0].instanceId] : [];
    }

    case 'own_trash_card': {
      const hits = me.trash
        .map((id) => state.instances[id])
        .filter((inst): inst is CardInstance => !!inst && matchesFilter(state, inst, target.filter));
      // Trash picks default to MOST RECENT match (top of trash).
      return hits.length > 0 ? [hits[hits.length - 1].instanceId] : [];
    }

    case 'top_of_deck':
      return me.deck.length > 0 ? [me.deck[0]] : [];

    case 'top_of_opp_deck':
      return opp.deck.length > 0 ? [opp.deck[0]] : [];

    case 'all_your_characters':
      return me.field
        .filter((inst) => matchesFilter(state, inst, target.filter))
        .map((inst) => inst.instanceId);

    case 'all_opp_characters':
      return opp.field
        .filter((inst) => matchesFilter(state, inst, target.filter))
        .map((inst) => inst.instanceId);

    case 'own_life_top':
      return me.life.length > 0 ? [me.life[0]] : [];

    case 'opp_life_top':
      return opp.life.length > 0 ? [opp.life[0]] : [];

    default:
      return [];
  }
}

// ─────────────────────────────────────────────────────────────────────
// Action group 1 — card movement & draw — Sub-phase A.3.3
// ─────────────────────────────────────────────────────────────────────

export interface ActionContext {
  sourceInstanceId: string;
  controller: PlayerId;
}

/** Compute a magnitude from an action's field. Numeric literals pass
 *  through; formula objects evaluate against state. V0 supports the
 *  common formula kinds; unknown formulas default to 1. */
function resolveMagnitude(
  state: GameState,
  controller: PlayerId,
  m: number | { kind: string; [k: string]: unknown } | undefined,
  fallback: number,
): number {
  if (typeof m === 'number') return m;
  if (!m) return fallback;
  const opp = state.players[OTHER[controller]];
  const me = state.players[controller];
  if (m.kind === 'match_opp_don') return opp.donCostArea.length;
  if (m.kind === 'read_state') {
    return readCountSource(state, controller, m.source as string, fallback);
  }
  if (m.kind === 'per_count') {
    const total = readCountSource(state, controller, m.countSource as string, 0);
    const divisor = (m.divisor as number) || 1;
    const perUnit = (m.perUnit as number) || 0;
    return Math.floor(total / divisor) * perUnit;
  }
  return fallback;
}

function readCountSource(
  state: GameState,
  controller: PlayerId,
  source: string,
  fallback: number,
): number {
  const me = state.players[controller];
  const opp = state.players[OTHER[controller]];
  switch (source) {
    case 'own_trash_count': return me.trash.length;
    case 'opp_trash_count': return opp.trash.length;
    case 'own_hand_count': return me.hand.length;
    case 'opp_hand_count': return opp.hand.length;
    case 'own_life_count': return me.life.length;
    case 'opp_life_count': return opp.life.length;
    case 'own_don_count': return me.donCostArea.length;
    case 'opp_don_count': return opp.donCostArea.length;
    case 'own_rested_don_count': return me.donRested.length;
    case 'own_trash_event_count':
      return me.trash.reduce((n, id) => {
        const inst = state.instances[id];
        const card = inst ? state.cardLibrary[inst.cardId] : undefined;
        return n + (card?.kind === 'event' ? 1 : 0);
      }, 0);
    default: return fallback;
  }
}

/** Apply one EffectActionV2 to state. Targets are pre-resolved via
 *  resolveTargetV2. Mutates `state` in place per the project convention
 *  (callers are responsible for cloning). Returns the same state ref for
 *  chaining.
 *
 *  Sub-phase A.3.3 ships action GROUP 1 only (card movement + draw +
 *  life-zone manipulation + zone search). Other action groups (power /
 *  cost / lock / DON / replacement / negation) land in A.3.4, A.3.5.
 *  Unknown action kinds in group 1 are no-ops; cross-group kinds fall
 *  through to a "not yet handled" return without throwing.
 */
export function applyActionV2(
  state: GameState,
  ctx: ActionContext,
  action: EffectActionV2,
  targets: string[],
): GameState {
  const me = state.players[ctx.controller];
  const opp = state.players[OTHER[ctx.controller]];

  switch (action.kind) {
    case 'draw': {
      const n = resolveMagnitude(state, ctx.controller, action.magnitude, 1);
      for (let i = 0; i < n && me.deck.length > 0; i++) {
        me.hand.push(me.deck.shift()!);
      }
      return state;
    }
    case 'mill_self': {
      const n = action.magnitude ?? 1;
      for (let i = 0; i < n && me.deck.length > 0; i++) {
        me.trash.push(me.deck.shift()!);
      }
      return state;
    }
    case 'mill_opp': {
      const n = action.magnitude ?? 1;
      for (let i = 0; i < n && opp.deck.length > 0; i++) {
        opp.trash.push(opp.deck.shift()!);
      }
      return state;
    }
    case 'lifegain': {
      const n = action.magnitude ?? 1;
      for (let i = 0; i < n && me.deck.length > 0; i++) {
        me.life.unshift(me.deck.shift()!);
      }
      return state;
    }
    case 'life_to_hand': {
      const n = action.magnitude ?? 1;
      for (let i = 0; i < n && me.life.length > 0; i++) {
        me.hand.push(me.life.shift()!);
      }
      return state;
    }
    case 'add_to_own_life_top': {
      // V0 ignores faceUp flag (engine doesn't track per-life face state).
      if (action.from === 'top_of_deck' && me.deck.length > 0) {
        me.life.unshift(me.deck.shift()!);
      } else if (action.from === 'hand' && targets.length > 0) {
        const id = targets[0];
        const idx = me.hand.indexOf(id);
        if (idx !== -1) { me.hand.splice(idx, 1); me.life.unshift(id); }
      } else if (action.from === 'own_trash' && targets.length > 0) {
        const id = targets[0];
        const idx = me.trash.indexOf(id);
        if (idx !== -1) { me.trash.splice(idx, 1); me.life.unshift(id); }
      }
      return state;
    }
    case 'add_to_opp_life_top': {
      // Source: the resolved target (an opp character) gets placed into opp's
      // life zone. Caller passes opp_character target descriptor; the character
      // moves from field to top (default) or bottom of opp life.
      if (targets.length > 0) {
        const tid = targets[0];
        // Find target on opp field/stage, remove + push to opp life zone.
        const idx = opp.field.findIndex((i) => i.instanceId === tid);
        if (idx !== -1) {
          const removed = opp.field.splice(idx, 1)[0];
          while (removed.attachedDon.length > 0) opp.donRested.push(removed.attachedDon.shift()!);
          if (action.position === 'bottom') opp.life.push(removed.instanceId);
          else opp.life.unshift(removed.instanceId);
          return state;
        }
      }
      // Legacy V0 path: pull from top of opp deck (older spec usage).
      if (opp.deck.length > 0) {
        if (action.position === 'bottom') opp.life.push(opp.deck.shift()!);
        else opp.life.unshift(opp.deck.shift()!);
      }
      return state;
    }
    case 'add_to_opp_hand_from_opp_life': {
      if (opp.life.length > 0) opp.hand.push(opp.life.shift()!);
      return state;
    }
    case 'trash_face_up_life': {
      // V0: face-up tracking absent → no-op. Acknowledged limitation.
      return state;
    }
    case 'turn_all_own_life_face_down': {
      // V0: face-up tracking absent → no-op.
      return state;
    }
    case 'peek_and_reorder_own_life':
    case 'peek_and_reorder_opp_life':
    case 'peek_and_reorder_own_deck': {
      // V0: no UI for reorder; no-op.
      return state;
    }
    case 'searcher_peek': {
      // V0: take first matching card from deck → hand (filter applied).
      // EB01-009 etc. set playInsteadOfHand:true to put it on the field instead.
      for (let i = 0; i < me.deck.length; i++) {
        const inst = state.instances[me.deck[i]];
        const card = inst ? state.cardLibrary[inst.cardId] : undefined;
        if (inst && card && matchesFilter(state, inst, action.filter)) {
          me.deck.splice(i, 1);
          if (action.playInsteadOfHand && card.kind === 'character') {
            inst.summoningSick = true;
            me.field.push(inst);
          } else {
            me.hand.push(inst.instanceId);
          }
          return state;
        }
      }
      // No match → no-op.
      return state;
    }
    case 'reveal_opp_hand': {
      const known = state.knownByViewer?.[ctx.controller];
      if (!known) return state;
      for (const id of opp.hand) if (!known.includes(id)) known.push(id);
      return state;
    }
    case 'peek_opp_deck': {
      const known = state.knownByViewer?.[ctx.controller];
      if (!known) return state;
      const n = action.count;
      for (let i = 0; i < n && i < opp.deck.length; i++) {
        if (!known.includes(opp.deck[i])) known.push(opp.deck[i]);
      }
      return state;
    }
    case 'take_from_opp_hand': {
      if (opp.hand.length === 0) return state;
      const taken = targets.length > 0 && opp.hand.includes(targets[0])
        ? targets[0]
        : opp.hand[0];
      const idx = opp.hand.indexOf(taken);
      opp.hand.splice(idx, 1);
      me.hand.push(taken);
      return state;
    }
    case 'search_deck': {
      // V0: same as searcher_peek but with filter applied.
      for (let i = 0; i < me.deck.length; i++) {
        const inst = state.instances[me.deck[i]];
        const card = inst ? state.cardLibrary[inst.cardId] : undefined;
        if (inst && card && matchesFilter(state, inst, action.filter)) {
          me.deck.splice(i, 1);
          me.hand.push(inst.instanceId);
          return state;
        }
      }
      return state;
    }
    case 'bottom_of_deck_from_trash': {
      const n = typeof action.magnitude === 'number' ? action.magnitude : 1;
      // V0: oldest-N from trash to bottom of deck.
      for (let i = 0; i < n && me.trash.length > 0; i++) {
        me.deck.push(me.trash.shift()!);
      }
      return state;
    }
    case 'bottom_of_deck_from_hand': {
      const n = action.magnitude;
      for (let i = 0; i < n && me.hand.length > 0; i++) {
        me.deck.push(me.hand.shift()!);
      }
      return state;
    }
    case 'bottom_of_deck_to_opp_deck': {
      for (const tid of targets) {
        const idx = opp.field.findIndex((i) => i.instanceId === tid);
        if (idx !== -1) {
          const removed = opp.field.splice(idx, 1)[0];
          while (removed.attachedDon.length > 0) opp.donRested.push(removed.attachedDon.shift()!);
          opp.deck.push(removed.instanceId);
        }
      }
      return state;
    }
    case 'recursion': {
      // V0: pick the first match from trash by filter, return to hand.
      const f = action.filter;
      for (let i = me.trash.length - 1; i >= 0; i--) {
        const inst = state.instances[me.trash[i]];
        if (inst && matchesFilter(state, inst, f)) {
          me.trash.splice(i, 1);
          me.hand.push(inst.instanceId);
          return state;
        }
      }
      return state;
    }
    case 'move_to_top': {
      // Move target from hand/trash to top of deck.
      if (targets.length === 0) return state;
      const id = targets[0];
      const hIdx = me.hand.indexOf(id);
      if (hIdx !== -1) { me.hand.splice(hIdx, 1); me.deck.unshift(id); return state; }
      const tIdx = me.trash.indexOf(id);
      if (tIdx !== -1) { me.trash.splice(tIdx, 1); me.deck.unshift(id); return state; }
      return state;
    }
    case 'exile': {
      if (targets.length === 0) return state;
      const id = targets[0];
      for (const pid of ['A', 'B'] as PlayerId[]) {
        const pl = state.players[pid];
        const fIdx = pl.field.findIndex((i) => i.instanceId === id);
        if (fIdx !== -1) {
          const removed = pl.field.splice(fIdx, 1)[0];
          while (removed.attachedDon.length > 0) pl.donRested.push(removed.attachedDon.shift()!);
          pl.exile.push(removed.instanceId);
          return state;
        }
        if (pl.stage && pl.stage.instanceId === id) {
          while (pl.stage.attachedDon.length > 0) pl.donRested.push(pl.stage.attachedDon.shift()!);
          pl.exile.push(pl.stage.instanceId);
          pl.stage = null;
          return state;
        }
        const tIdx = pl.trash.indexOf(id);
        if (tIdx !== -1) { pl.trash.splice(tIdx, 1); pl.exile.push(id); return state; }
        const hIdx = pl.hand.indexOf(id);
        if (hIdx !== -1) { pl.hand.splice(hIdx, 1); pl.exile.push(id); return state; }
      }
      return state;
    }
    // ── Action group 2 — Sub-phase A.3.4 ──────────────────────────
    case 'power_buff': {
      const delta = resolveMagnitude(state, ctx.controller, action.magnitude, 1000);
      for (const tid of targets) {
        const inst = state.instances[tid];
        if (!inst) continue;
        inst.powerModifier = (inst.powerModifier ?? 0) + delta;
        // Mirror on per-zone struct so legality reads see the delta.
        for (const pid of ['A', 'B'] as PlayerId[]) {
          const pl = state.players[pid];
          if (pl.leader.instanceId === tid) pl.leader.powerModifier = inst.powerModifier;
          for (const f of pl.field) if (f.instanceId === tid) f.powerModifier = inst.powerModifier;
          if (pl.stage && pl.stage.instanceId === tid) pl.stage.powerModifier = inst.powerModifier;
        }
      }
      return state;
    }
    case 'set_power_zero': {
      for (const tid of targets) {
        const inst = state.instances[tid];
        if (!inst) continue;
        const card = state.cardLibrary[inst.cardId];
        if (!card) continue;
        const base = card.kind === 'character' || card.kind === 'leader' ? (card as { power: number }).power : 0;
        const curr = base + inst.attachedDon.length * 1000 + (inst.powerModifier ?? 0);
        if (curr <= 0) continue;
        inst.powerModifier = (inst.powerModifier ?? 0) - curr;
        for (const pid of ['A', 'B'] as PlayerId[]) {
          const pl = state.players[pid];
          if (pl.leader.instanceId === tid) pl.leader.powerModifier = inst.powerModifier;
          for (const f of pl.field) if (f.instanceId === tid) f.powerModifier = inst.powerModifier;
          if (pl.stage && pl.stage.instanceId === tid) pl.stage.powerModifier = inst.powerModifier;
        }
      }
      return state;
    }
    case 'set_base_power': {
      const newBase = action.magnitude;
      for (const tid of targets) {
        const inst = state.instances[tid];
        if (!inst) continue;
        inst.basePowerOverride = newBase;
        for (const pid of ['A', 'B'] as PlayerId[]) {
          const pl = state.players[pid];
          if (pl.leader.instanceId === tid) pl.leader.basePowerOverride = newBase;
          for (const f of pl.field) if (f.instanceId === tid) f.basePowerOverride = newBase;
          if (pl.stage && pl.stage.instanceId === tid) pl.stage.basePowerOverride = newBase;
        }
      }
      return state;
    }
    case 'set_base_power_copy_from': {
      // Read source power; set targets' base to that.
      const sourceInst = action.source === 'opp_leader'
        ? opp.leader
        : (action.source === 'opp_character' ? opp.field[0] : undefined);
      if (!sourceInst) return state;
      const sourceCard = state.cardLibrary[sourceInst.cardId];
      const sourceBase = sourceCard && (sourceCard.kind === 'leader' || sourceCard.kind === 'character')
        ? (sourceCard as { power: number }).power
        : 0;
      for (const tid of targets) {
        const inst = state.instances[tid];
        if (!inst) continue;
        inst.basePowerOverride = sourceBase;
      }
      return state;
    }
    case 'cost_reduction': {
      // Player-level one-shot reduction. Scope filter is V0-ignored.
      me.nextPlayCostModifier = (me.nextPlayCostModifier ?? 0) - action.magnitude;
      return state;
    }
    case 'removal_cost_reduce': {
      for (const tid of targets) {
        const inst = state.instances[tid];
        if (!inst) continue;
        inst.costModifier = (inst.costModifier ?? 0) - action.magnitude;
        for (const pid of ['A', 'B'] as PlayerId[]) {
          const pl = state.players[pid];
          if (pl.leader.instanceId === tid) pl.leader.costModifier = inst.costModifier;
          for (const f of pl.field) if (f.instanceId === tid) f.costModifier = inst.costModifier;
          if (pl.stage && pl.stage.instanceId === tid) pl.stage.costModifier = inst.costModifier;
        }
      }
      return state;
    }
    case 'rest_target': {
      for (const tid of targets) {
        const inst = state.instances[tid];
        if (!inst) continue;
        inst.rested = true;
        for (const pid of ['A', 'B'] as PlayerId[]) {
          const pl = state.players[pid];
          if (pl.leader.instanceId === tid) pl.leader.rested = true;
          for (const f of pl.field) if (f.instanceId === tid) f.rested = true;
          if (pl.stage && pl.stage.instanceId === tid) pl.stage.rested = true;
        }
      }
      return state;
    }
    case 'set_active': {
      for (const tid of targets) {
        const inst = state.instances[tid];
        if (!inst) continue;
        inst.rested = false;
        for (const pid of ['A', 'B'] as PlayerId[]) {
          const pl = state.players[pid];
          if (pl.leader.instanceId === tid) pl.leader.rested = false;
          for (const f of pl.field) if (f.instanceId === tid) f.rested = false;
          if (pl.stage && pl.stage.instanceId === tid) pl.stage.rested = false;
        }
      }
      return state;
    }
    case 'rest_opp_don': {
      const n = action.magnitude;
      for (let i = 0; i < n && opp.donCostArea.length > 0; i++) {
        opp.donRested.push(opp.donCostArea.shift()!);
      }
      return state;
    }
    case 'attack_lock_until_phase': {
      for (const tid of targets) {
        const inst = state.instances[tid];
        if (!inst) continue;
        inst.attackLocked = true;
        for (const pid of ['A', 'B'] as PlayerId[]) {
          const pl = state.players[pid];
          if (pl.leader.instanceId === tid) pl.leader.attackLocked = true;
          for (const f of pl.field) if (f.instanceId === tid) f.attackLocked = true;
          if (pl.stage && pl.stage.instanceId === tid) pl.stage.attackLocked = true;
        }
      }
      return state;
    }
    case 'rest_lock_until_phase': {
      for (const tid of targets) {
        const inst = state.instances[tid];
        if (!inst) continue;
        inst.restLocked = true;
        for (const pid of ['A', 'B'] as PlayerId[]) {
          const pl = state.players[pid];
          if (pl.leader.instanceId === tid) pl.leader.restLocked = true;
          for (const f of pl.field) if (f.instanceId === tid) f.restLocked = true;
          if (pl.stage && pl.stage.instanceId === tid) pl.stage.restLocked = true;
        }
      }
      return state;
    }
    case 'restrict_opp_attack': {
      if (!opp.restrictions) opp.restrictions = {};
      opp.restrictions.oppAttackUnlessDiscard = action.unless?.discardN ?? 0;
      return state;
    }
    case 'restrict_play_self_this_turn': {
      if (!me.restrictions) me.restrictions = {};
      me.restrictions.cantPlayKind = action.kind_filter;
      return state;
    }
    case 'restrict_effect_type': {
      if (!me.restrictions) me.restrictions = {};
      me.restrictions.cantUseEffectType = action.effectKind;
      return state;
    }
    // ── Action group 3 — Sub-phase A.3.5 ──────────────────────────
    case 'removal_ko': {
      for (const tid of targets) {
        for (const pid of ['A', 'B'] as PlayerId[]) {
          const pl = state.players[pid];
          const idx = pl.field.findIndex((i) => i.instanceId === tid);
          if (idx !== -1) {
            const removed = pl.field.splice(idx, 1)[0];
            while (removed.attachedDon.length > 0) pl.donRested.push(removed.attachedDon.shift()!);
            pl.trash.push(removed.instanceId);
            break;
          }
        }
      }
      return state;
    }
    case 'removal_bounce': {
      for (const tid of targets) {
        for (const pid of ['A', 'B'] as PlayerId[]) {
          const pl = state.players[pid];
          const idx = pl.field.findIndex((i) => i.instanceId === tid);
          if (idx !== -1) {
            const removed = pl.field.splice(idx, 1)[0];
            while (removed.attachedDon.length > 0) pl.donRested.push(removed.attachedDon.shift()!);
            pl.hand.push(removed.instanceId);
            // Reset summoning-sick + perTurn so it plays cleanly later.
            state.instances[removed.instanceId].summoningSick = false;
            state.instances[removed.instanceId].rested = false;
            break;
          }
        }
      }
      return state;
    }
    case 'ramp': {
      const n = action.magnitude;
      for (let i = 0; i < n && me.donDeck.length > 0; i++) {
        if (action.rested) me.donRested.push(me.donDeck.shift()!);
        else me.donCostArea.push(me.donDeck.shift()!);
      }
      return state;
    }
    case 'give_don_to_target': {
      const n = action.magnitude;
      const source = action.rested ? me.donRested : me.donCostArea;
      for (let i = 0; i < n && source.length > 0; i++) {
        for (const tid of targets) {
          const inst = state.instances[tid];
          if (!inst) continue;
          inst.attachedDon.push(source.shift()!);
          break;
        }
      }
      return state;
    }
    case 'give_don_to_opp_target': {
      const n = action.magnitude;
      // Cross-side DON grant — pulls from controller's active DON (own
      // resource cost) and attaches to opp's target.
      for (let i = 0; i < n && me.donCostArea.length > 0; i++) {
        for (const tid of targets) {
          const inst = state.instances[tid];
          if (!inst) continue;
          inst.attachedDon.push(me.donCostArea.shift()!);
          break;
        }
      }
      return state;
    }
    case 'return_opp_don_to_deck': {
      const n = resolveMagnitude(state, ctx.controller, action.magnitude, 1);
      for (let i = 0; i < n && opp.donCostArea.length > 0; i++) {
        opp.donDeck.push(opp.donCostArea.shift()!);
      }
      return state;
    }
    case 'negate_target_effects': {
      for (const tid of targets) {
        const inst = state.instances[tid];
        if (!inst) continue;
        inst.effectsNegated = true;
        for (const pid of ['A', 'B'] as PlayerId[]) {
          const pl = state.players[pid];
          if (pl.leader.instanceId === tid) pl.leader.effectsNegated = true;
          for (const f of pl.field) if (f.instanceId === tid) f.effectsNegated = true;
          if (pl.stage && pl.stage.instanceId === tid) pl.stage.effectsNegated = true;
        }
      }
      return state;
    }
    case 'grant_immunity': {
      for (const tid of targets) {
        const inst = state.instances[tid];
        if (!inst) continue;
        inst.immunity = { against: action.against };
        for (const pid of ['A', 'B'] as PlayerId[]) {
          const pl = state.players[pid];
          if (pl.leader.instanceId === tid) pl.leader.immunity = inst.immunity;
          for (const f of pl.field) if (f.instanceId === tid) f.immunity = inst.immunity;
          if (pl.stage && pl.stage.instanceId === tid) pl.stage.immunity = inst.immunity;
        }
      }
      return state;
    }
    case 'give_keyword': {
      for (const tid of targets) {
        const inst = state.instances[tid];
        if (!inst) continue;
        if (!inst.grantedKeywords) inst.grantedKeywords = [];
        if (!inst.grantedKeywords.includes(action.keyword)) inst.grantedKeywords.push(action.keyword);
        for (const pid of ['A', 'B'] as PlayerId[]) {
          const pl = state.players[pid];
          const mirror = (i: { instanceId: string; grantedKeywords?: string[] }) => {
            if (i.instanceId === tid) {
              if (!i.grantedKeywords) i.grantedKeywords = [];
              if (!i.grantedKeywords.includes(action.keyword)) i.grantedKeywords.push(action.keyword);
            }
          };
          mirror(pl.leader);
          for (const f of pl.field) mirror(f);
          if (pl.stage) mirror(pl.stage);
        }
      }
      return state;
    }
    case 'play_for_free': {
      // V0: pick first matching card from the named zone, push to field
      // summoning-sick. Honors `count`, `uniqueByName`, `rested`. Source
      // 'hand_or_trash' scans hand first then trash.
      const sources: ('hand' | 'trash')[] =
        action.from === 'hand_or_trash' ? ['hand', 'trash']
        : action.from === 'trash' ? ['trash']
        : ['hand'];
      const count = action.count ?? 1;
      const seen = new Set<string>();
      const matches: { id: string; from: 'hand' | 'trash' }[] = [];
      outer: for (const src of sources) {
        const sourceList = src === 'hand' ? me.hand : me.trash;
        for (const id of sourceList) {
          const inst = state.instances[id];
          const card = inst ? state.cardLibrary[inst.cardId] : undefined;
          if (!inst || !card || card.kind !== 'character') continue;
          if (!matchesFilter(state, inst, action.filter)) continue;
          if (action.uniqueByName && seen.has(card.name)) continue;
          matches.push({ id, from: src });
          seen.add(card.name);
          if (matches.length >= count) break outer;
        }
      }
      for (const m of matches) {
        const sourceList = m.from === 'hand' ? me.hand : me.trash;
        const sIdx = sourceList.indexOf(m.id);
        if (sIdx !== -1) sourceList.splice(sIdx, 1);
        const inst = state.instances[m.id];
        if (inst) {
          inst.summoningSick = true;
          inst.rested = !!action.rested;
          me.field.push(inst);
        }
      }
      return state;
    }
    case 'discard_from_hand': {
      const n = action.magnitude;
      // Mandatory discard — engine picks first card; UI selector arrives later.
      for (let i = 0; i < n && me.hand.length > 0; i++) {
        me.trash.push(me.hand.shift()!);
      }
      return state;
    }
    case 'trash_own_life_until': {
      const target = action.n;
      while (me.life.length > target) {
        me.trash.push(me.life.shift()!);
      }
      return state;
    }
    case 'attack_redirect_to_target': {
      if (!state.pendingAttack || targets.length === 0) return state;
      state.pendingAttack.defenderInstanceId = targets[0];
      return state;
    }
    case 'set_active_don': {
      const n = action.magnitude;
      for (let i = 0; i < n && me.donRested.length > 0; i++) {
        me.donCostArea.push(me.donRested.shift()!);
      }
      return state;
    }
    case 'transfer_attached_don': {
      // Pick a source instance to pull DON from. fromKind:'your_leader' pulls
      // from leader's attachedDon; 'your_character' pulls from first own field
      // member with attachedDon; 'self' pulls from this card's attached DON.
      let sourceInst: { attachedDon: string[] } | undefined;
      if (action.fromKind === 'your_leader') sourceInst = me.leader;
      else if (action.fromKind === 'self') sourceInst = state.instances[ctx.sourceInstanceId];
      else sourceInst = me.field.find((i) => i.attachedDon.length > 0);
      if (!sourceInst || sourceInst.attachedDon.length === 0) return state;
      const n = action.magnitude;
      for (let i = 0; i < n && sourceInst.attachedDon.length > 0; i++) {
        for (const tid of targets) {
          const inst = state.instances[tid];
          if (!inst) continue;
          inst.attachedDon.push(sourceInst.attachedDon.shift()!);
          break;
        }
      }
      return state;
    }
    case 'chained_actions': {
      for (const sub of action.actions) {
        // Re-resolve targets per sub-action since they may differ.
        const subTargets = resolveTargetV2(state, ctx.controller, ctx.sourceInstanceId, (sub as { target?: EffectTargetV2 }).target);
        applyActionV2(state, ctx, sub, subTargets.length > 0 ? subTargets : targets);
      }
      return state;
    }
    case 'reveal_top_then_if_cost_min': {
      if (me.deck.length === 0) return state;
      const topId = me.deck[0];
      const topInst = state.instances[topId];
      const topCard = topInst ? state.cardLibrary[topInst.cardId] : undefined;
      const topCost = topCard && typeof topCard.cost === 'number' ? topCard.cost : 0;
      // Reveal: move top card to known-by-controller; we approximate by reading it.
      if (topCost >= action.minCost) {
        // Resolve inner action's targets at this point — caller's resolved
        // targets were for the OUTER action; inner can re-use them.
        applyActionV2(state, ctx, action.thenAction, targets);
      }
      // Card goes to bottom of deck regardless.
      me.deck.shift();
      me.deck.push(topId);
      return state;
    }
    case 'set_base_power_copy_from_target': {
      // First target is the source to copy FROM; remaining targets receive
      // the override. For one-source-one-dest (EB01-061: self copies opp char),
      // the target descriptor should resolve to BOTH self and chosen opp char.
      // Convention: when only one target is resolved (the opp char), the source
      // instance is the destination — copy onto self.
      if (targets.length === 0) return state;
      const srcInst = state.instances[targets[0]];
      const srcCard = srcInst ? state.cardLibrary[srcInst.cardId] : undefined;
      const srcBase = srcCard && (srcCard.kind === 'leader' || srcCard.kind === 'character')
        ? (srcCard as { power: number }).power : 0;
      const dest = state.instances[ctx.sourceInstanceId];
      if (dest) {
        dest.basePowerOverride = srcBase;
        for (const pid of ['A', 'B'] as PlayerId[]) {
          const pl = state.players[pid];
          if (pl.leader.instanceId === ctx.sourceInstanceId) pl.leader.basePowerOverride = srcBase;
          for (const f of pl.field) if (f.instanceId === ctx.sourceInstanceId) f.basePowerOverride = srcBase;
          if (pl.stage && pl.stage.instanceId === ctx.sourceInstanceId) pl.stage.basePowerOverride = srcBase;
        }
      }
      return state;
    }
    case 'activate_event_from_hand': {
      // V0 marker — full activation flow needs a separate engine path
      // (events trash + dispatch their on_play). Stub for now; full wire
      // lands when we route events through fireEffects in A.3.10.
      return state;
    }
    case 'damage_immunity_attribute': {
      // V0 marker — set a flag on the source instance for engine to read
      // when computing battle outcomes.
      const inst = state.instances[ctx.sourceInstanceId];
      if (inst) {
        (inst as unknown as { damageImmunityAttribute?: string }).damageImmunityAttribute = action.attribute;
      }
      return state;
    }
    case 'choose_one': {
      // V0 deterministic: pick first option. Real UI/AI selector arrives
      // in A.3.9 wiring. The chosen option's targets are computed inline.
      const opt = action.options[0];
      if (!opt) return state;
      // Skip the trigger filter — composite branches assume same trigger
      // context as the parent clause.
      if (!evaluateConditionV2(state, ctx.controller, opt.condition, ctx.sourceInstanceId)) return state;
      const optTargets = resolveTargetV2(state, ctx.controller, ctx.sourceInstanceId, opt.target as any);
      return applyActionV2(state, ctx, opt.action, optTargets);
    }
    case 'self_trash_at_end_of_turn': {
      const inst = state.instances[ctx.sourceInstanceId];
      if (inst) inst.endOfTurnTrash = true;
      return state;
    }
    case 'reveal_top_and_conditional_play': {
      // EB02-025 etc. — peek top of deck, if it matches the filter (and kind=character),
      // play it; otherwise return to deck. V0 picks top card only.
      if (me.deck.length === 0) return state;
      const topId = me.deck[0];
      const topInst = state.instances[topId];
      const topCard = topInst ? state.cardLibrary[topInst.cardId] : undefined;
      if (topInst && topCard && topCard.kind === 'character' && matchesFilter(state, topInst, action.filter)) {
        me.deck.shift();
        topInst.summoningSick = true;
        topInst.rested = !!action.rested;
        me.field.push(topInst);
      }
      return state;
    }
    case 'choose_cost_reveal_opp_match':
      // V0 stub — full handler arrives in A.3.6 with UI integration.
      return state;
    default:
      // Action kinds handled by later sub-phases fall through.
      return state;
  }
}
