// beatFor — F-7q presentation-queue helper.
//
// Pure function: GameEvent → Beat | null. Returns null for engine events
// that don't warrant a cinematic beat (DRAW, DON attach, internal
// CLAUSE_FIRED, etc — these are minor and go to RecentActionPill only).
//
// Owner direction (F-7q): "I do NOT want extra spam." Only events that
// represent meaningful game-state changes get a beat.

import type { GameEvent, InstanceId, PlayerId, GameState } from '@shared/engine-v2/state/types';
import type { Card } from '@shared/engine-v2/cards/Card';

export type BeatKind =
  | 'TURN_BANNER'           // "Your Turn" / "Opponent's Turn" before refresh
  | 'CARD_PLAYED'           // character / event / stage played
  | 'ATTACK_DECLARED'
  | 'BLOCKED'
  | 'COUNTERED'             // counter played, with boost
  | 'BOUNCED'               // source → target return to hand
  | 'KOD'
  | 'LIFE_LOST'
  | 'TRIGGER_ACTIVATED'
  | 'EFFECT_ACTIVATED'      // F-7t — CLAUSE_FIRED for activate_main (visible)
  | 'NO_VALID_TARGET'       // F-7t stricter — engine reported empty target list
  | 'SEARCHER_RESULT'       // F-7x — searcher_peek resolved (matched or not)
  | 'COMBAT_RESULT'         // F-7s — DAMAGE_RESOLVED summary with power math
  | 'GAME_OVER';

export interface Beat {
  readonly kind: BeatKind;
  readonly historyIndex: number;
  /** primary card (source / actor / revealed life card) */
  readonly primaryInstanceId?: InstanceId;
  /** secondary card (target / blocker / counter card) */
  readonly secondaryInstanceId?: InstanceId;
  /** who is the actor — used for "You Played" vs "Opponent Played" */
  readonly actor?: PlayerId;
  /** label override (e.g. "Attack Blocked", "+1000 Counter") */
  readonly subText?: string;
  /** numeric annotation (counter boost, life count, etc) */
  readonly amount?: number;
  /** F-7s combat fields — populated only for COMBAT_RESULT */
  readonly attackerPower?: number;
  readonly targetPower?: number;
  readonly counterBoost?: number;
  /** Card name of the most recent power-modifier source (if any) — used by
   *  the UI to render "Buggy power became 0 from Distorted Future". */
  readonly powerModSourceName?: string;
  /** Sign of the modifier — 'debuff' (negative) or 'buff' (positive). */
  readonly powerModDirection?: 'debuff' | 'buff';
  /** F-7x — SEARCHER_RESULT fields. */
  readonly matched?: boolean;
  readonly lookedAtCount?: number;
  readonly bottomedCount?: number;
  readonly placement?: 'top' | 'bottom' | 'trash' | 'shuffle';
}

interface BeatCtx {
  readonly viewer: PlayerId;
  readonly instances: GameState['instances'];
  readonly cardLibrary: GameState['cardLibrary'];
}

/** F-7r — strict redaction policy. The HUMAN viewer is always `viewer`
 *  here (local play = 'A'). Opponent hidden info MUST stay hidden until
 *  the engine flips it via a reveal action (trigger activation, etc).
 *
 *  Specifically: when opp loses a life, the engine moves the life card
 *  face-up into their hand (CR §7-4). The viewer sees the engine state
 *  but the PRESENTATION must not name the card unless a reveal action
 *  fires (TRIGGER_RESOLVED with activate=true is the only one in v0).
 *  Without this gate the presentation beat would show the opponent's
 *  card identity to the viewer — a hidden-info leak. */
function isOwnEvent(eventController: unknown, viewer: PlayerId): boolean {
  return eventController === viewer;
}

/**
 * Pure map: engine GameEvent → optional cinematic Beat. The queue uses
 * this to decide which history entries deserve a center-screen reveal.
 * historyIndex must be set by the caller (it's the absolute position in
 * state.history so de-duplication works across renders).
 */
export function beatFor(event: GameEvent, historyIndex: number, ctx: BeatCtx): Beat | null {
  // TURN_STARTED is a SYNTHETIC event the store splices in at the turn
  // boundary (game.ts) — it isn't part of the engine's GameEvent union, so
  // it's matched here by string before the typed switch. Owner 2026-06-12:
  // flash "Your Turn / Opponent's Turn" before the refresh phase.
  const synthetic = event as { type?: string; activePlayer?: unknown };
  if (synthetic.type === 'TURN_STARTED') {
    const actor =
      synthetic.activePlayer === 'A' || synthetic.activePlayer === 'B'
        ? synthetic.activePlayer
        : undefined;
    return { kind: 'TURN_BANNER', historyIndex, actor };
  }
  switch (event.type) {
    case 'CHARACTER_PLAYED':
    case 'EVENT_ACTIVATED':
    case 'STAGE_PLAYED': {
      return {
        kind: 'CARD_PLAYED',
        historyIndex,
        primaryInstanceId: typeof event.instanceId === 'string' ? event.instanceId : undefined,
        actor: event.controller === 'A' || event.controller === 'B' ? event.controller : undefined,
      };
    }
    case 'ATTACK_DECLARED': {
      return {
        kind: 'ATTACK_DECLARED',
        historyIndex,
        primaryInstanceId: typeof event.attackerInstanceId === 'string' ? event.attackerInstanceId : undefined,
        secondaryInstanceId: typeof event.targetInstanceId === 'string' ? event.targetInstanceId : undefined,
        actor: event.controller === 'A' || event.controller === 'B' ? event.controller : undefined,
      };
    }
    case 'BLOCKER_DECLARED': {
      return {
        kind: 'BLOCKED',
        historyIndex,
        primaryInstanceId: typeof event.blockerInstanceId === 'string' ? event.blockerInstanceId : undefined,
        actor: event.controller === 'A' || event.controller === 'B' ? event.controller : undefined,
      };
    }
    case 'COUNTER_PLAYED': {
      return {
        kind: 'COUNTERED',
        historyIndex,
        primaryInstanceId: typeof event.instanceId === 'string' ? event.instanceId : undefined,
        actor: event.controller === 'A' || event.controller === 'B' ? event.controller : undefined,
        amount: typeof event.boost === 'number' ? event.boost : undefined,
      };
    }
    case 'CARD_BOUNCED': {
      return {
        kind: 'BOUNCED',
        historyIndex,
        primaryInstanceId: typeof event.sourceInstanceId === 'string' ? event.sourceInstanceId : undefined,
        secondaryInstanceId: typeof event.instanceId === 'string' ? event.instanceId : undefined,
        actor: event.controller === 'A' || event.controller === 'B' ? event.controller : undefined,
      };
    }
    case 'CHARACTER_KOD': {
      return {
        kind: 'KOD',
        historyIndex,
        primaryInstanceId: typeof event.instanceId === 'string' ? event.instanceId : undefined,
        actor: event.controller === 'A' || event.controller === 'B' ? event.controller : undefined,
      };
    }
    case 'LIFE_CARD_TO_HAND': {
      // F-7r hidden-info gate: when the OPPONENT loses life and the
      // engine has not flipped the card face-up to the viewer (i.e., no
      // trigger activation follows), the viewer must NOT see the card
      // identity. Strip primaryInstanceId for opp-side life loss so the
      // beat renders "Opponent Lost 1 Life" with no card.
      const own = isOwnEvent(event.controller, ctx.viewer);
      const primaryInstanceId =
        own && typeof event.instanceId === 'string' ? event.instanceId : undefined;
      return {
        kind: 'LIFE_LOST',
        historyIndex,
        primaryInstanceId,
        actor: event.controller === 'A' || event.controller === 'B' ? event.controller : undefined,
      };
    }
    case 'TRIGGER_RESOLVED': {
      // Only beat when actually activated (declining is silent).
      if (event.activated !== true) return null;
      return {
        kind: 'TRIGGER_ACTIVATED',
        historyIndex,
        primaryInstanceId: typeof event.instanceId === 'string' ? event.instanceId : undefined,
      };
    }
    case 'CONCEDED': {
      return {
        kind: 'GAME_OVER',
        historyIndex,
        actor: event.player === 'A' || event.player === 'B' ? event.player : undefined,
        subText: 'Conceded',
      };
    }
    // F-7t — surface activate_main clauses as a beat. Owner direction:
    // "ACTIVATE_MAIN effects do not apply" — F-7t spec proved they DO
    // apply (POWER_MODIFIED amount:+2000 emits for Hyogoro). Root cause
    // was invisible execution: no cinematic beat fired for the result.
    // Only un-suppress for activate_main + on_play triggers; other
    // triggers (continuous refold, when_attacking aura, etc.) stay
    // suppressed to avoid spam.
    case 'SEARCHER_PICKED': {
      // F-7x — visible search result. searcher_peek effects (e.g. Bonney
      // "Look at top 4, reveal up to 1 ... add to hand") REVEAL the
      // picked card per OPTCG rules, so both viewers see the identity.
      const matched = event.matched === true;
      const picked = typeof event.pickedInstanceId === 'string' ? event.pickedInstanceId : undefined;
      const looked = typeof event.lookedAtCount === 'number' ? event.lookedAtCount : 0;
      const bottomed = typeof event.bottomedCount === 'number' ? event.bottomedCount : 0;
      const placement = (event.placement === 'top' || event.placement === 'bottom' || event.placement === 'trash' || event.placement === 'shuffle')
        ? event.placement : 'bottom';
      return {
        kind: 'SEARCHER_RESULT',
        historyIndex,
        primaryInstanceId: matched ? picked : (typeof event.sourceInstanceId === 'string' ? event.sourceInstanceId : undefined),
        actor: event.controller === 'A' || event.controller === 'B' ? event.controller : undefined,
        matched,
        lookedAtCount: looked,
        bottomedCount: bottomed,
        placement,
        // subText carries the source iid so renderText can name the
        // searching card alongside the picked card.
        subText: typeof event.sourceInstanceId === 'string' ? event.sourceInstanceId : undefined,
      };
    }
    case 'NO_VALID_TARGET': {
      const actionKind = typeof event.actionKind === 'string' ? event.actionKind : '';
      // Filter — only surface for user-visible removal/move action kinds.
      // Silent no-ops on minor actions (power_buff, give_don) would
      // create noise without informing the player.
      const visible = new Set([
        'removal_bounce',
        'removal_ko',
        'play_for_free',
      ]);
      if (!visible.has(actionKind)) return null;
      return {
        kind: 'NO_VALID_TARGET',
        historyIndex,
        primaryInstanceId: typeof event.sourceInstanceId === 'string' ? event.sourceInstanceId : undefined,
        subText: actionKind,
      };
    }
    case 'CLAUSE_FIRED': {
      const trig = event.trigger;
      // F-7w — surface ON PLAY too (was only activate_main). Owner
      // video review: player can't tell whether [On Play] triggered.
      if (trig !== 'activate_main' && trig !== 'on_play') return null;
      const actionKind = typeof event.actionKind === 'string' ? event.actionKind : '';
      return {
        kind: 'EFFECT_ACTIVATED',
        historyIndex,
        primaryInstanceId: typeof event.sourceInstanceId === 'string' ? event.sourceInstanceId : undefined,
        actor: event.controller === 'A' || event.controller === 'B' ? event.controller : undefined,
        // subText carries actionKind + trigger so renderText can build
        // "On Play · Look at 4 cards" from the source card's effectText.
        subText: `${trig}|${actionKind}`,
      };
    }
    // F-7s — combat result beat. Owner direction: "Combat: 0 vs 5000 —
    // attack failed" is unacceptable without a WHY. We surface the
    // numbers AND attribute power changes by scanning recent history
    // for POWER_MODIFIED events between the last ATTACK_DECLARED and
    // this DAMAGE_RESOLVED.
    case 'DAMAGE_RESOLVED': {
      // F-7w — Populate primary (attacker) + secondary (target) so the
      // beat renders REAL card visuals, not just text. Scan history
      // backward for the matching ATTACK_DECLARED (single combat scope).
      const ap = typeof event.attackerPower === 'number' ? event.attackerPower : undefined;
      const tp = typeof event.targetPower === 'number' ? event.targetPower : undefined;
      const cb = typeof event.counterBoost === 'number' ? event.counterBoost : undefined;
      return {
        kind: 'COMBAT_RESULT',
        historyIndex,
        attackerPower: ap,
        targetPower: tp,
        counterBoost: cb,
      };
    }
    // Suppress: all other types (TURN_STARTED, CARD_DRAWN, DON_ATTACHED,
    // CLAUSE_FIRED, REPLACEMENT_FIRED, DAMAGE_RESOLVED, KO_REPLACED,
    // DAMAGE_REPLACED, BOUNCE_REPLACED, CARD_DISCARDED, CARD_TRASHED_BY_RULE,
    // DICE_ROLLED, FIRST_PLAYER_CHOSEN, LIFE_CARDS_DEALT, MULLIGAN_USED,
    // HAND_KEPT, CHOICE_RESOLVED, PEEK_RESOLVED, TARGET_PICKED, TARGET_RESTED,
    // STAGE_TRASHED_BY_RULE). These either go to RecentActionPill or are
    // suppressed entirely.
    default:
      return null;
  }
}

/**
 * F-7s — Walk history BACKWARDS from a DAMAGE_RESOLVED index to find the
 * most recent POWER_MODIFIED that targets either the attacker or the
 * target of the just-resolved attack. Returns the source card name +
 * direction ('debuff' for negative amount, 'buff' for positive). This
 * lets the COMBAT_RESULT beat say "Buggy power became 0 from Distorted
 * Future" instead of bare "0 vs 5000 — attack failed".
 */
export function attributeCombatSource(
  history: ReadonlyArray<GameEvent>,
  damageIdx: number,
  ctx: BeatCtx,
): { sourceName: string; direction: 'debuff' | 'buff' } | null {
  // Find the ATTACK_DECLARED that precedes this DAMAGE_RESOLVED so we
  // know which instances participated.
  let attackerIid: string | null = null;
  let targetIid: string | null = null;
  for (let i = damageIdx - 1; i >= 0; i -= 1) {
    const ev = history[i];
    if (!ev) continue;
    if (ev.type === 'ATTACK_DECLARED') {
      const a = ev.attackerInstanceId;
      const t = ev.targetInstanceId;
      attackerIid = typeof a === 'string' ? a : null;
      targetIid = typeof t === 'string' ? t : null;
      break;
    }
    // Bounds — stop at a different combat resolution to avoid mis-attribution.
    if (ev.type === 'DAMAGE_RESOLVED') break;
  }
  if (attackerIid === null && targetIid === null) return null;
  // Now walk backward from damageIdx for any POWER_MODIFIED on those
  // instances. Return the FIRST (most recent) hit.
  for (let i = damageIdx - 1; i >= 0; i -= 1) {
    const ev = history[i];
    if (!ev) continue;
    if (ev.type !== 'POWER_MODIFIED') continue;
    const tgt = ev.targetInstanceId;
    if (tgt !== attackerIid && tgt !== targetIid) continue;
    const src = ev.sourceInstanceId;
    const amount = typeof ev.amount === 'number' ? ev.amount : 0;
    if (typeof src !== 'string' || amount === 0) continue;
    const inst = ctx.instances[src];
    if (!inst) continue;
    const card = ctx.cardLibrary[inst.cardId] as Card | undefined;
    if (!card) continue;
    return {
      sourceName: card.name,
      direction: amount < 0 ? 'debuff' : 'buff',
    };
  }
  return null;
}

/**
 * F-7v — scan history backward from DAMAGE_RESOLVED for any
 * BLOCKER_DECLARED + COUNTER_PLAYED that happened in the same combat
 * window (since the most recent ATTACK_DECLARED). Returns the names so
 * COMBAT_RESULT can include them in the sub-text.
 */
export interface CombatChain {
  readonly blockerName: string | null;
  readonly countersTotal: number;
  readonly counterNames: ReadonlyArray<string>;
  /** F-7y — owner direction: every attack must show the full readable
   *  chain even when a step is skipped. These flags surface "No Blocker"
   *  / "No Counter" in COMBAT_RESULT sub-text when the player passed
   *  without acting. */
  readonly noBlocker: boolean;
  readonly noCounter: boolean;
}

export function scanCombatChain(
  history: ReadonlyArray<GameEvent>,
  damageIdx: number,
  ctx: BeatCtx,
): CombatChain {
  let blockerName: string | null = null;
  let countersTotal = 0;
  const counterNames: string[] = [];
  for (let i = damageIdx - 1; i >= 0; i -= 1) {
    const ev = history[i];
    if (!ev) continue;
    if (ev.type === 'ATTACK_DECLARED') break;
    if (ev.type === 'DAMAGE_RESOLVED') break;
    if (ev.type === 'BLOCKER_DECLARED') {
      const iid = ev.blockerInstanceId;
      if (typeof iid === 'string') {
        const inst = ctx.instances[iid];
        const card = inst ? ctx.cardLibrary[inst.cardId] as Card | undefined : undefined;
        if (card?.name) blockerName = card.name;
      }
    } else if (ev.type === 'COUNTER_PLAYED') {
      const iid = ev.instanceId;
      if (typeof iid === 'string') {
        const inst = ctx.instances[iid];
        const card = inst ? ctx.cardLibrary[inst.cardId] as Card | undefined : undefined;
        if (card?.name) counterNames.unshift(card.name);
        const boost = typeof ev.boost === 'number' ? ev.boost : 0;
        countersTotal += boost;
      }
    }
  }
  // F-7y — owner direction: chain must be visible even when steps skipped.
  // If no blocker played, the chain shows "no blocker"; same for counter.
  const noBlocker = blockerName === null;
  const noCounter = counterNames.length === 0;
  return { blockerName, countersTotal, counterNames, noBlocker, noCounter };
}

/**
 * F-7y — scan FORWARD from an EFFECT_ACTIVATED beat for downstream
 * result events sharing the source's sourceInstanceId. Returns a
 * short result-line so EFFECT_ACTIVATED sub-text can read "Sanji
 * activated · +2000 power · added Yamato to hand" instead of just the
 * effect-text snippet alone.
 *
 * Stops at the next CHARACTER_PLAYED / EVENT_ACTIVATED / STAGE_PLAYED
 * boundary so results from a later effect don't bleed in.
 */
export function scanEffectResults(
  history: ReadonlyArray<GameEvent>,
  startIdx: number,
  sourceIid: string | undefined,
  ctx: BeatCtx,
): string[] {
  if (!sourceIid) return [];
  const lines: string[] = [];
  const MAX_LOOKAHEAD = 8;
  for (let i = startIdx + 1; i < Math.min(history.length, startIdx + 1 + MAX_LOOKAHEAD); i += 1) {
    const ev = history[i];
    if (!ev) continue;
    // Stop at the next play / activation that resets the source context.
    if (ev.type === 'CHARACTER_PLAYED' || ev.type === 'EVENT_ACTIVATED' || ev.type === 'STAGE_PLAYED') {
      break;
    }
    if (ev.type === 'CLAUSE_FIRED') continue; // already handled by EFFECT_ACTIVATED itself.
    const evSrc = ev.sourceInstanceId;
    if (typeof evSrc === 'string' && evSrc !== sourceIid) continue;
    // Result event types we summarize.
    if (ev.type === 'POWER_MODIFIED') {
      const amount = typeof ev.amount === 'number' ? ev.amount : 0;
      if (amount === 0) continue;
      const tgt = typeof ev.targetInstanceId === 'string' ? ev.targetInstanceId : undefined;
      const tgtName = tgt ? cardNameByIid(ctx, tgt) : null;
      const sign = amount > 0 ? `+${amount}` : `${amount}`;
      lines.push(tgtName ? `${sign} power on ${tgtName}` : `${sign} power`);
    } else if (ev.type === 'CARD_BOUNCED') {
      const tgt = typeof ev.instanceId === 'string' ? ev.instanceId : undefined;
      const tgtName = tgt ? cardNameByIid(ctx, tgt) : null;
      lines.push(tgtName ? `${tgtName} returned to hand` : 'card returned to hand');
    } else if (ev.type === 'CHARACTER_KOD') {
      const tgt = typeof ev.instanceId === 'string' ? ev.instanceId : undefined;
      const tgtName = tgt ? cardNameByIid(ctx, tgt) : null;
      lines.push(tgtName ? `${tgtName} KO'd` : "character KO'd");
    } else if (ev.type === 'SEARCHER_PICKED') {
      const picked = typeof ev.pickedInstanceId === 'string' ? ev.pickedInstanceId : undefined;
      const pickedName = picked ? cardNameByIid(ctx, picked) : null;
      lines.push(pickedName ? `added ${pickedName} to hand` : 'searched the deck');
    } else if (ev.type === 'TARGET_RESTED') {
      const tgt = typeof ev.instanceId === 'string' ? ev.instanceId : undefined;
      const tgtName = tgt ? cardNameByIid(ctx, tgt) : null;
      lines.push(tgtName ? `rested ${tgtName}` : 'rested target');
    } else if (ev.type === 'NO_VALID_TARGET') {
      const ak = typeof ev.actionKind === 'string' ? ev.actionKind : 'effect';
      lines.push(`no valid target for ${ak.replace(/_/g, ' ')}`);
    }
    if (lines.length >= 3) break;
  }
  return lines;
}

function cardNameByIid(ctx: BeatCtx, iid: string): string | null {
  const inst = ctx.instances[iid];
  if (!inst) return null;
  const card = ctx.cardLibrary[inst.cardId] as Card | undefined;
  return card?.name ?? null;
}

/**
 * Beat label helpers — viewer-aware ("You Played" vs "Opponent Played").
 */
export function actorLabel(beat: Beat, viewer: PlayerId): string {
  if (beat.actor === undefined) return '';
  return beat.actor === viewer ? 'You' : 'Opponent';
}

export function cardNameFor(beat: Beat, ctx: BeatCtx, which: 'primary' | 'secondary' = 'primary'): string | null {
  const iid = which === 'primary' ? beat.primaryInstanceId : beat.secondaryInstanceId;
  if (!iid) return null;
  const inst = ctx.instances[iid];
  if (!inst) return null;
  const card = ctx.cardLibrary[inst.cardId] as Card | undefined;
  return card?.name ?? null;
}
