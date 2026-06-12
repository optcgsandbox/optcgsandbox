/**
 * Engine V2 — public Action discriminated union.
 *
 * Mirrors V1's `shared/protocol/actions.ts` shape (no zod here — engine-v2
 * is strict-TS only; runtime validation is the caller's responsibility).
 *
 * The discriminator is `type`. Each variant carries only the fields the
 * per-action reducer needs.
 *
 * Cross-references:
 * - V1 reference: shared/protocol/actions.ts
 * - Implementation spec §6 (dispatch contract)
 */

import type { InstanceId, PlayerId } from '../state/types.js';

// ─── Setup
export interface ActionRollDice {
  readonly type: 'ROLL_DICE';
  readonly player: PlayerId;
}
export interface ActionChooseFirst {
  readonly type: 'CHOOSE_FIRST';
}
export interface ActionChooseSecond {
  readonly type: 'CHOOSE_SECOND';
}
export interface ActionMulligan {
  readonly type: 'MULLIGAN';
}
export interface ActionKeepHand {
  readonly type: 'KEEP_HAND';
}

// ─── Main phase
export interface ActionPlayCard {
  readonly type: 'PLAY_CARD';
  readonly instanceId: InstanceId;
  /** When field is at cap (5), specify which character to replace. */
  readonly replaceTargetId: InstanceId | null;
}
export interface ActionPlayStage {
  readonly type: 'PLAY_STAGE';
  readonly instanceId: InstanceId;
}
export interface ActionAttachDon {
  readonly type: 'ATTACH_DON';
  readonly targetInstanceId: InstanceId;
}
export interface ActionActivateMain {
  readonly type: 'ACTIVATE_MAIN';
  readonly instanceId: InstanceId;
}

// ─── Attack flow
export interface ActionDeclareAttack {
  readonly type: 'DECLARE_ATTACK';
  readonly attackerInstanceId: InstanceId;
  readonly targetInstanceId: InstanceId;
}
export interface ActionDeclareBlocker {
  readonly type: 'DECLARE_BLOCKER';
  readonly blockerInstanceId: InstanceId;
}
export interface ActionPlayCounter {
  readonly type: 'PLAY_COUNTER';
  readonly instanceId: InstanceId;
}
export interface ActionSkipCounter {
  readonly type: 'SKIP_COUNTER';
}
export interface ActionSkipBlocker {
  readonly type: 'SKIP_BLOCKER';
}

// ─── Choice resolutions
export interface ActionResolveTrigger {
  readonly type: 'RESOLVE_TRIGGER';
  readonly targetInstanceId: InstanceId | null;
  readonly activate: boolean;
}
export interface ActionResolvePeek {
  readonly type: 'RESOLVE_PEEK';
  readonly pickedIds: ReadonlyArray<InstanceId>;
}
export interface ActionResolveDiscard {
  readonly type: 'RESOLVE_DISCARD';
  readonly pickedId: InstanceId | null;
}
export interface ActionResolveChooseOne {
  readonly type: 'RESOLVE_CHOOSE_ONE';
  readonly optionIndex: number;
}
export interface ActionResolveTargetPick {
  readonly type: 'RESOLVE_TARGET_PICK';
  /** F-8D: null = choose none (legal when the pending says mayChooseNone). */
  readonly pickedId: InstanceId | null;
  /** Optional multi-pick (count > 1 targets). Takes precedence over pickedId. */
  readonly pickedIds?: ReadonlyArray<InstanceId>;
}
/** F-8D addendum — answers a "You may pay <cost>:" offer. */
export interface ActionResolveEffectOffer {
  readonly type: 'RESOLVE_EFFECT_OFFER';
  readonly accept: boolean;
}
/** F-8B — resolves a `searcher_peek` pending window. */
export interface ActionResolveSearcherPeek {
  readonly type: 'RESOLVE_SEARCHER_PEEK';
  /** Picked cards (⊆ validPickInstanceIds, length ≤ pickLimit; [] = choose none). */
  readonly pickedInstanceIds: ReadonlyArray<InstanceId>;
  /** Optional explicit order for the leftover cards (must be a permutation
   *  of lookedAt − picked). Omitted → original looked-at order. */
  readonly bottomOrderInstanceIds?: ReadonlyArray<InstanceId>;
}
// ─── Phase advance
export interface ActionEndTurn {
  readonly type: 'END_TURN';
}
export interface ActionConcede {
  readonly type: 'CONCEDE';
}

export type Action =
  | ActionRollDice
  | ActionChooseFirst
  | ActionChooseSecond
  | ActionMulligan
  | ActionKeepHand
  | ActionPlayCard
  | ActionPlayStage
  | ActionAttachDon
  | ActionActivateMain
  | ActionDeclareAttack
  | ActionDeclareBlocker
  | ActionPlayCounter
  | ActionSkipCounter
  | ActionSkipBlocker
  | ActionResolveTrigger
  | ActionResolvePeek
  | ActionResolveDiscard
  | ActionResolveChooseOne
  | ActionResolveTargetPick
  | ActionResolveSearcherPeek
  | ActionResolveEffectOffer
  | ActionEndTurn
  | ActionConcede;

export type ActionType = Action['type'];
