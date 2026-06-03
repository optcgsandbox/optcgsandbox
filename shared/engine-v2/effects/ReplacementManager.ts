/**
 * Engine V2 — Replacement engine.
 *
 * "Would-be" effects (`would_be_ko`, `would_be_removed`, `would_take_damage`,
 * `on_life_flip`) get a chance to substitute the resolution. First match
 * wins; LIFO order across three pools:
 *
 *   1. Battle-scoped armed replacements (PendingAttack.armedReplacements)
 *   2. Turn-scoped armed replacements (player.armedReplacementsThisTurn)
 *   3. Card-intrinsic replacements on the source's own card
 *
 * OPT key: `repl:${trigger}:${idx}` — marked AFTER successful action.
 *
 * Cross-references:
 * - Implementation spec §10
 * - Plan v1 §4.2 + §2.5 (LIFO ordering)
 */

import type { Card } from '../cards/Card.js';
import {
  actionHandlers,
  type HandlerCtx,
  targetResolvers,
} from '../registry/types.js';
import type { ReplacementEffectV2 } from '../spec/types.js';
import {
  isOptUsed,
  makeOptKey,
  markOptUsed,
} from '../state/derived/opt.js';
import {
  type ArmedReplacement,
  type GameState,
  type InstanceId,
  type PlayerId,
} from '../state/types.js';
import { CostPayer } from './CostPayer.js';
import { evaluateCondition } from './EffectDispatcher.js';

export type ReplacementTrigger = ReplacementEffectV2['trigger'];

export interface ReplacementResult {
  readonly replaced: boolean;
  readonly state: GameState;
}

interface ArmedEntry {
  readonly replacement: ReplacementEffectV2;
  readonly sourceInstanceId: InstanceId;
  readonly controller: PlayerId;
}

function buildArmedList(
  state: GameState,
  ctx: HandlerCtx,
): ArmedEntry[] {
  // Battle-scoped — LIFO
  const battleArmed: ArmedReplacement[] =
    state.pending?.kind === 'attack'
      ? (state.pending.pendingAttack.armedReplacements ?? [])
      : [];
  // Turn-scoped — LIFO (only the source's controller has access; per CR §6-5-5)
  const turnArmed: ArmedReplacement[] =
    state.players[ctx.controller].armedReplacementsThisTurn ?? [];
  // Card-intrinsic
  const inst = state.instances[ctx.sourceInstanceId];
  const card = inst !== undefined
    ? (state.cardLibrary[inst.cardId] as Card | undefined)
    : undefined;
  const cardOwned: ArmedReplacement[] = (card?.effectSpecV2?.replacements ?? []).map(
    (rep) => ({
      replacement: rep,
      sourceInstanceId: ctx.sourceInstanceId,
      controller: ctx.controller,
    }),
  );

  // LIFO concat: reverse each pool before merging; battle pool drains first.
  const ordered: ArmedReplacement[] = [
    ...battleArmed.slice().reverse(),
    ...turnArmed.slice().reverse(),
    ...cardOwned,
  ];
  return ordered.map((a) => ({
    replacement: a.replacement as ReplacementEffectV2,
    sourceInstanceId: a.sourceInstanceId,
    controller: a.controller,
  }));
}

export const ReplacementManager = {
  tryReplace(
    state: GameState,
    ctx: HandlerCtx,
    trigger: ReplacementTrigger,
  ): ReplacementResult {
    const armed = buildArmedList(state, ctx);

    for (let i = 0; i < armed.length; i++) {
      const entry = armed[i]!;
      const rep = entry.replacement;
      if (rep.trigger !== trigger) continue;
      if (
        rep.whenSource !== undefined &&
        ctx.source !== undefined &&
        rep.whenSource !== ctx.source
      ) {
        continue;
      }

      const repCtx: HandlerCtx = {
        sourceInstanceId: entry.sourceInstanceId,
        controller: entry.controller,
      };

      // Condition
      if (!evaluateCondition(state, repCtx, rep.condition)) continue;

      // OPT gate (per Plan v1 §4.6)
      const optKey = makeOptKey('repl', trigger, i);
      const sourceInst = state.instances[entry.sourceInstanceId];
      if (rep.opt === true && sourceInst !== undefined && isOptUsed(sourceInst, optKey)) {
        continue;
      }

      // Cost
      let working = state;
      if (rep.cost !== undefined) {
        const payable = CostPayer.canPay(working, repCtx, rep.cost);
        if (!payable) {
          // Per CR §8-1-3-4-2:
          //   - conditional === true (or undefined): fall through; try next
          //     armed entry. If none fire, the original event proceeds.
          //   - conditional === false: the replacement CONSUMES the would-be
          //     trigger as a no-op. Original event does NOT proceed.
          if (rep.conditional === false) {
            return { replaced: true, state };
          }
          continue;
        }
        const paid = CostPayer.pay(working, repCtx, rep.cost);
        if (paid === null) continue;
        working = paid;
      }

      // Target + action
      let targets: ReadonlyArray<InstanceId> = [];
      if ('target' in rep && rep['target'] !== undefined) {
        const target = rep['target'] as { kind: string };
        const resolver = targetResolvers.get(target.kind);
        targets = resolver(working, repCtx, target as never);
      }
      const handler = actionHandlers.get(rep.action.kind);
      working = handler(working, repCtx, rep.action, targets);

      // OPT mark (post-success)
      if (rep.opt === true) {
        const freshSource = working.instances[entry.sourceInstanceId];
        if (freshSource !== undefined) markOptUsed(freshSource, optKey);
      }

      // History
      (working.history as Array<unknown>).push({
        type: 'REPLACEMENT_FIRED',
        sourceInstanceId: entry.sourceInstanceId,
        controller: entry.controller,
        trigger,
        replacementIndex: i,
      });

      return { replaced: true, state: working };
    }

    return { replaced: false, state };
  },
} as const;
