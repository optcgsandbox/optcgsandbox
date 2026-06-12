// aiReactive — F-8D minimal generic AI blocker/counter policy.
//
// Replaces the old unconditional force-skip (the AI never blocked or
// countered — see GAMEPLAY_BUGLOG BUG-031 ticket). DELIBERATELY BASIC v1:
// deterministic, reads only legal actions + effective power + life counts.
// Zero card-specific logic; difficulty tiers are a follow-up.
//
// Block policy (when the AI defends):
//   - if any legal blocker SURVIVES the attack (blocker power > attacker
//     power), block with the highest-power surviving blocker;
//   - else if the attack targets the AI leader AND the AI is at ≤2 life,
//     chump-block with the lowest-power blocker (trade a body for a life);
//   - else skip.
//
// Counter policy (when the AI defends):
//   - only protects the LEADER (character trades are accepted in v1);
//   - computes the minimal extra boost needed to survive
//     (defender survives when target power > attacker power per CR §7-1-4);
//   - protects when (life ≤ 3) or the deficit is small (≤ 2000);
//   - plays the SMALLEST single counter that closes the gap; if none does
//     and life ≤ 1, plays the largest counter and re-evaluates next loop;
//   - otherwise skips (Done).
//
// LOCAL store only — the deterministic simulation and the online server
// never call this module.

import type { Action } from '@shared/engine-v2/protocol/actions';
import type { GameState, PlayerId } from '@shared/engine-v2/state/types';
import { effectivePowerForDisplay } from '@shared/engine-v2/state/derived/power';

type BlockerAction = Extract<Action, { type: 'DECLARE_BLOCKER' }>;
type CounterAction = Extract<Action, { type: 'PLAY_COUNTER' }>;

function counterValueOf(state: GameState, instanceId: string): number {
  const inst = state.instances[instanceId];
  const card = inst ? state.cardLibrary[inst.cardId] : undefined;
  if (!card) return 0;
  const cv = (card as { counterValue?: number | null }).counterValue;
  if (typeof cv === 'number' && cv > 0) return cv;
  const boost = (card as { counterEventBoost?: number | null }).counterEventBoost;
  return typeof boost === 'number' && boost > 0 ? boost : 0;
}

export function decideAiReactive(
  state: GameState,
  defender: PlayerId,
  legal: ReadonlyArray<Action>,
): Action {
  const pending = state.pending;
  if (pending === null || pending.kind !== 'attack') {
    return state.phase === 'block_window' ? { type: 'SKIP_BLOCKER' } : { type: 'SKIP_COUNTER' };
  }
  const pa = pending.pendingAttack;
  const attackerInst = state.instances[pa.attackerInstanceId];
  const targetInst = state.instances[pa.targetInstanceId];
  const attackerPower = attackerInst ? effectivePowerForDisplay(state, attackerInst) : 0;
  const targetPower = targetInst ? effectivePowerForDisplay(state, targetInst) : 0;
  const defenderLife = state.players[defender].life.length;
  const targetIsLeader =
    targetInst !== undefined &&
    state.players[defender].leader.instanceId === targetInst.instanceId;

  if (state.phase === 'block_window') {
    const blockers = legal.filter((a): a is BlockerAction => a.type === 'DECLARE_BLOCKER');
    if (blockers.length === 0) return { type: 'SKIP_BLOCKER' };
    const withPower = blockers
      .map((a) => ({
        a,
        power: state.instances[a.blockerInstanceId]
          ? effectivePowerForDisplay(state, state.instances[a.blockerInstanceId]!)
          : 0,
      }))
      .sort((x, y) => y.power - x.power);
    const surviving = withPower.filter((b) => b.power > attackerPower);
    if (surviving.length > 0) return surviving[0]!.a; // best surviving blocker
    if (targetIsLeader && defenderLife <= 2) {
      return withPower[withPower.length - 1]!.a; // chump-block at low life
    }
    return { type: 'SKIP_BLOCKER' };
  }

  // counter_window
  const counters = legal.filter((a): a is CounterAction => a.type === 'PLAY_COUNTER');
  if (counters.length === 0) return { type: 'SKIP_COUNTER' };
  const effectiveTarget = targetPower + pa.counterBoost;
  // Defender survives when target power EXCEEDS attacker power (attack
  // succeeds on ties, CR §7-1-4 / attackFlow.ts:462).
  const deficit = attackerPower - effectiveTarget;
  if (deficit < 0) return { type: 'SKIP_COUNTER' }; // already surviving
  if (!targetIsLeader) return { type: 'SKIP_COUNTER' }; // v1: leader-only protection
  const need = deficit + 1000; // smallest 1000-step boost that strictly exceeds
  const shouldProtect = defenderLife <= 3 || deficit <= 2000;
  if (!shouldProtect) return { type: 'SKIP_COUNTER' };
  const withValue = counters
    .map((a) => ({ a, v: counterValueOf(state, a.instanceId) }))
    .filter((c) => c.v > 0)
    .sort((x, y) => x.v - y.v);
  if (withValue.length === 0) return { type: 'SKIP_COUNTER' };
  const closing = withValue.find((c) => c.v >= need);
  if (closing !== undefined) return closing.a; // smallest single closer
  if (defenderLife <= 1) return withValue[withValue.length - 1]!.a; // desperate stack
  return { type: 'SKIP_COUNTER' };
}
