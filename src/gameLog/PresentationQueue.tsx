// PresentationQueue — F-7q gameplay presentation orchestrator.
//
// Owner direction (F-7q, 2026-06-09): "Gameplay must FEEL understandable.
// Opponent action → show card → announce move → show effect → THEN state
// resolves." Translates engine history events into a serialized stream of
// center-screen cinematic beats. One beat at a time.
//
// Mounts at z-[60], above the playfield (z-30) and the existing reactive
// prompts (z-50). When a beat is active, it covers the playmat with a
// modal-size card reveal. The playfield underneath has ALREADY updated
// to the new state — the beat's job is to communicate WHAT happened
// before the eye catches up.
//
// Double-tap anywhere fast-forwards the remaining non-interactive beats
// (interactive prompts are NOT fast-forwarded).
//
// History-index based de-dup: each beat carries its absolute history
// index so React re-renders don't re-queue the same event.

import { memo, useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useGameStore } from '../store/game';
import { CardArt, CARD_DIMS } from '../components/CardArt';
import { inspectScaleFor } from '../components/cardSizing';
import { useOverlayBox } from '../hooks/useOverlayBox';
import { beatFor, actorLabel, cardNameFor, attributeCombatSource, scanCombatChain, scanEffectResults, type Beat } from './beatFor';

// Per-beat durations (F-7q Readability — owner direction: cards must be
// READ, not glimpsed. 1.5-2.0s for card reveals, 1.2-1.5s for attack,
// 1.8-2.2s for effects/bounce, 1.5-2.0s for KO/life reveal).
const DUR: Record<Beat['kind'], number> = {
  CARD_PLAYED: 1700,
  ATTACK_DECLARED: 1300,
  BLOCKED: 1300,
  COUNTERED: 1300,
  BOUNCED: 2000,
  KOD: 1700,
  LIFE_LOST: 1800,
  TRIGGER_ACTIVATED: 2000,
  EFFECT_ACTIVATED: 1500,
  NO_VALID_TARGET: 1300,
  SEARCHER_RESULT: 1800,
  COMBAT_RESULT: 1700,
  GAME_OVER: 2500,
};

const FAST_FWD_DUR = 120; // beats during fast-forward play this quickly

export const PresentationQueue = memo(function PresentationQueue() {
  const history = useGameStore((s) => s.state.history);
  const viewer = useGameStore((s) => s.viewAs);
  const instances = useGameStore((s) => s.state.instances);
  const cardLibrary = useGameStore((s) => s.state.cardLibrary);
  const pending = useGameStore((s) => s.state.pending);
  const reduced = useReducedMotion() ?? false;

  // F-7v — yield to interactive human pending prompts. When the engine
  // opens a choose / peek / discard / trigger window controlled by the
  // viewer, the queue must END the current beat early and DRAIN queued
  // beats so the prompt comes up immediately (owner direction: prompts
  // were getting hidden behind 1-3s cinematic beats during play chains).
  const yieldsToPrompt = useMemo(() => {
    if (pending === null) return false;
    if (pending.kind === 'choose_one') return pending.pendingChoose.controller === viewer;
    if (pending.kind === 'peek') return pending.pendingPeek.controller === viewer;
    if (pending.kind === 'discard') return pending.pendingDiscard.controller === viewer;
    if (pending.kind === 'trigger') return pending.pendingTrigger.controller === viewer;
    // F-8B — the searcher/peek choice window is human-only by construction.
    if (pending.kind === 'searcher_peek') return pending.pendingSearcherPeek.controller === viewer;
    // F-8D — same for the generic target picker + effect offer.
    if (pending.kind === 'attack_target_pick') return pending.pendingTargetPick.controller === viewer;
    if (pending.kind === 'effect_offer') return pending.pendingEffectOffer.controller === viewer;
    return false;
  }, [pending, viewer]);

  const ctx = useMemo(() => ({ viewer, instances, cardLibrary }), [viewer, instances, cardLibrary]);

  // Persistent across renders: which history index have we already
  // turned into beats? Initialised to history.length on first mount so we
  // don't replay setup events; from there forward, every NEW event is
  // candidate for a beat.
  const processedRef = useRef<number>(-1);
  // Overlay-fit (owner 2026-06-12): measure the beat overlay's REAL logical
  // box (shell-aware, resize-reactive) instead of reading the window —
  // inside the shrink-fit shell the window overstates available space.
  const beatRef = useRef<HTMLDivElement | null>(null);
  const beatBox = useOverlayBox(beatRef);
  const [queue, setQueue] = useState<Beat[]>([]);
  const [active, setActive] = useState<Beat | null>(null);
  const [fastFwd, setFastFwd] = useState<boolean>(false);
  // Track last-tap for double-tap detection.
  const lastTapRef = useRef<number>(0);

  // Initialise processed cursor on mount so setup events don't pop a beat.
  useEffect(() => {
    if (processedRef.current < 0) {
      processedRef.current = history.length;
    }
  }, [history.length]);

  // Watch history for new events. For each new entry, create a beat (or
  // null) and enqueue.
  useEffect(() => {
    if (processedRef.current < 0) return;
    if (history.length === processedRef.current) return;
    const newBeats: Beat[] = [];
    for (let i = processedRef.current; i < history.length; i += 1) {
      const event = history[i];
      if (!event) continue;
      const beat = beatFor(event, i, ctx);
      if (beat !== null) newBeats.push(beat);
    }
    processedRef.current = history.length;
    if (newBeats.length > 0) {
      setQueue((q) => [...q, ...newBeats]);
    }
  }, [history, ctx]);

  // When queue advances and nothing is active, start playing.
  useEffect(() => {
    if (active !== null) return;
    if (queue.length === 0) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    setActive(next!);
  }, [active, queue]);

  // Auto-advance the active beat after its duration. Fast-forward halves it.
  // F-7v: when human pending is open, collapse duration to 120ms so the
  // prompt surfaces fast.
  useEffect(() => {
    if (active === null) return;
    const baseDur = DUR[active.kind] ?? 800;
    const dur = yieldsToPrompt ? 120 : fastFwd || reduced ? FAST_FWD_DUR : baseDur;
    const t = window.setTimeout(() => {
      setActive(null);
    }, dur);
    return () => window.clearTimeout(t);
  }, [active, fastFwd, reduced, yieldsToPrompt]);

  // F-7v: drain queued beats when human pending is open so the prompt
  // isn't blocked by 3-4 chained cinematic beats.
  useEffect(() => {
    if (yieldsToPrompt && queue.length > 0) {
      setQueue([]);
    }
  }, [yieldsToPrompt, queue.length]);

  // Reset fast-forward when queue drains so the NEXT chain plays at
  // normal cadence.
  useEffect(() => {
    if (active === null && queue.length === 0 && fastFwd) {
      setFastFwd(false);
    }
  }, [active, queue.length, fastFwd]);

  // Double-tap anywhere → fast-forward remaining cinematic beats.
  const handleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < 350) {
      setFastFwd(true);
    }
    lastTapRef.current = now;
  }, []);

  if (active === null) return null;

  // F-7w — for COMBAT_RESULT, find the attacker/target instance IDs by
  // scanning history for the matching ATTACK_DECLARED so the beat can
  // render REAL card visuals (owner direction: "use card visuals, not
  // just text in middle of blurred board"). beatFor doesn't have
  // history access; we resolve here.
  let beatToRender: Beat = active;
  if (active.kind === 'COMBAT_RESULT' && !beatToRender.primaryInstanceId) {
    for (let i = active.historyIndex - 1; i >= 0; i -= 1) {
      const ev = history[i];
      if (!ev) continue;
      if (ev.type === 'ATTACK_DECLARED') {
        const att = ev.attackerInstanceId;
        const tgt = ev.targetInstanceId;
        beatToRender = {
          ...active,
          primaryInstanceId: typeof att === 'string' ? att : undefined,
          secondaryInstanceId: typeof tgt === 'string' ? tgt : undefined,
          actor: ev.controller === 'A' || ev.controller === 'B' ? ev.controller : undefined,
        };
        break;
      }
      if (ev.type === 'DAMAGE_RESOLVED') break;
    }
  }

  const text = renderText(beatToRender, ctx, history);
  const showSecondary =
    beatToRender.kind === 'ATTACK_DECLARED' ||
    beatToRender.kind === 'BOUNCED' ||
    beatToRender.kind === 'COMBAT_RESULT';

  return (
    <AnimatePresence>
      <motion.div
        ref={beatRef}
        key={`beat-${active.historyIndex}-${active.kind}`}
        role="status"
        aria-live="polite"
        aria-label={text.title}
        data-testid="presentation-beat"
        data-beat-kind={active.kind}
        data-beat-index={active.historyIndex}
        onClick={handleTap}
        className="fixed inset-0 z-[60] flex flex-col items-center justify-center
                   gap-3 px-4
                   bg-ink-black/75 backdrop-blur-sm"
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={reduced ? undefined : { opacity: 0 }}
        transition={{ duration: reduced ? 0.01 : 0.14 }}
      >
        <span
          className={[
            'font-display leading-none text-center drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]',
            severityForKind(active.kind) === 'major' ? 'text-paper-cream text-[1.5rem]' : 'text-sun-brass text-[1.25rem]',
          ].join(' ')}
          data-testid="presentation-beat-title"
        >
          {text.title}
        </span>
        {(() => {
          // ── F-8D — combat presentation rebuild ──────────────────────────
          // HEAD-TO-HEAD duel layout: attacker LEFT, defender RIGHT, both
          // upright + readable, tops leaning toward each other (±5° tilt),
          // inside a fixed clamped container — never overlapping, never
          // overflowing, never scrolling. Single-card beats keep the INSPECT
          // presentation (a played card reads as large as a clicked one).
          // This `fixed` overlay is CONTAINED by the transformed 430px app
          // shell (ancestor transform), so sizing derives from the SHELL
          // width — min(window, 430) — not the raw window. (Original
          // geometry restored per owner 2026-06-12.)
          // Logical box from useOverlayBox (first frame falls back to the
          // window before the ref mounts — same conservative numbers).
          const vh = beatBox.h > 0 ? beatBox.h : window.innerHeight;
          const GLYPH_LANE = 52; // center ⚔ column + gaps
          const shellW = beatBox.w > 0 ? beatBox.w : Math.min(window.innerWidth, 430);
          const containerW = shellW - 16;
          // The ±5° head-to-head tilt grows each card's axis-aligned
          // footprint: effective W = w·cos5° + h·sin5°, effective
          // H = w·sin5° + h·cos5°. Clamp on the ROTATED footprint so the
          // two cards can never overlap nor overflow.
          const TILT_W = CARD_DIMS.modal.w * 0.9962 + CARD_DIMS.modal.h * 0.0872; // ≈246
          const TILT_H = CARD_DIMS.modal.w * 0.0872 + CARD_DIMS.modal.h * 0.9962; // ≈326
          const duelScale = Math.min(
            0.95,
            (containerW - GLYPH_LANE - 16) / (2 * TILT_W),
            (vh - 280) / TILT_H,
          );
          const singleScale = inspectScaleFor(shellW, vh);

          /** Base → modifiers → final breakdown for one combatant. Derived
           *  generically from the live instance (same buckets the engine's
           *  effectivePower sums) — no card-specific logic. */
          const mathFor = (
            iid: string | undefined,
            finalShown: number | undefined,
            extraBoost: number,
          ): { base: number; don: number; mods: number; boost: number; final: number } | null => {
            if (iid === undefined || finalShown === undefined) return null;
            const i = instances[iid];
            const c = i ? cardLibrary[i.cardId] : undefined;
            const base = typeof (c as { power?: number | null } | undefined)?.power === 'number'
              ? ((c as { power: number }).power)
              : 0;
            const mods = (i?.powerModifierThisBattle ?? 0) + (i?.powerModifierOneShot ?? 0) + (i?.powerModifierContinuous ?? 0);
            const don = finalShown - base - mods - extraBoost; // remainder = gated DON term
            return { base, don, mods, boost: extraBoost, final: finalShown + extraBoost };
          };
          const fmtMath = (m: ReturnType<typeof mathFor>): string | null => {
            if (m === null) return null;
            const parts: string[] = [`${m.base}`];
            if (m.don !== 0) parts.push(`${m.don > 0 ? '+' : ''}${m.don} DON`);
            if (m.mods !== 0) parts.push(`${m.mods > 0 ? '+' : ''}${m.mods}`);
            if (m.boost !== 0) parts.push(`+${m.boost} counter`);
            return parts.length > 1 ? `${parts.join(' ')} = ${m.final}` : `${m.final}`;
          };

          const renderCard = (
            iid: string | undefined,
            testId: string,
            powerTestId: string,
            tilt: number,
            delay: number,
            scaleToUse: number,
            mathLine: string | null,
            bigPower: string | null,
          ) => {
            const i = iid ? instances[iid] : undefined;
            const c = i ? cardLibrary[i.cardId] : undefined;
            if (!c) return null;
            return (
              <div className="flex flex-col items-center gap-1 min-w-0">
                <motion.div
                  key={testId}
                  initial={reduced ? false : { scale: 0.85, opacity: 0, rotate: 0 }}
                  animate={{ scale: 1, opacity: 1, rotate: tilt }}
                  transition={{ type: 'spring', stiffness: 380, damping: 26, delay }}
                  style={{
                    width: CARD_DIMS.modal.w * scaleToUse,
                    height: CARD_DIMS.modal.h * scaleToUse,
                    position: 'relative',
                    filter: 'drop-shadow(0 6px 16px rgba(0,0,0,0.45))',
                  }}
                  data-testid={testId}
                >
                  <div style={{ position: 'absolute', inset: 0, transformOrigin: 'top left', transform: `scale(${scaleToUse})`, width: CARD_DIMS.modal.w, height: CARD_DIMS.modal.h }}>
                    <CardArt inst={i} card={c} size="modal" />
                  </div>
                </motion.div>
                {bigPower !== null && (
                  <span
                    data-testid={powerTestId}
                    className="font-display text-[1.2rem] leading-none text-paper-cream tabular drop-shadow-[0_2px_4px_rgba(0,0,0,0.7)]"
                  >
                    {bigPower}
                  </span>
                )}
                {mathLine !== null && mathLine !== bigPower && (
                  <span
                    data-testid={`${testId}-math`}
                    className="font-body text-[0.6875rem] leading-none text-paper-cream/85 tabular text-center drop-shadow-[0_2px_4px_rgba(0,0,0,0.7)]"
                  >
                    {mathLine}
                  </span>
                )}
              </div>
            );
          };

          if (!showSecondary) {
            return (
              <div className="flex flex-col items-center">
                {renderCard(beatToRender.primaryInstanceId, 'presentation-beat-primary', 'presentation-beat-attacker-power', 0, 0, singleScale, null, null)}
              </div>
            );
          }

          const isCombat = beatToRender.kind === 'COMBAT_RESULT';
          const attMath = isCombat ? mathFor(beatToRender.primaryInstanceId, beatToRender.attackerPower, 0) : null;
          const tgtMath = isCombat
            ? mathFor(beatToRender.secondaryInstanceId, beatToRender.targetPower, beatToRender.counterBoost ?? 0)
            : null;
          return (
            <div
              data-testid="combat-duel-container"
              className="grid grid-cols-[1fr_auto_1fr] items-center justify-items-center gap-2"
              style={{ width: containerW, maxWidth: '100%' }}
            >
              {renderCard(
                beatToRender.primaryInstanceId,
                'presentation-beat-primary',
                'presentation-beat-attacker-power',
                5, // top leans toward the defender (head-to-head)
                0,
                duelScale,
                fmtMath(attMath),
                isCombat && beatToRender.attackerPower !== undefined ? `${beatToRender.attackerPower}` : null,
              )}
              <span
                className="font-display text-[1.8rem] leading-none text-sun-brass drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]"
                aria-hidden="true"
              >
                {beatToRender.kind === 'ATTACK_DECLARED' || isCombat ? '⚔' : '→'}
              </span>
              {renderCard(
                beatToRender.secondaryInstanceId,
                'presentation-beat-secondary',
                'presentation-beat-target-power',
                -5, // top leans toward the attacker
                0.05,
                duelScale,
                fmtMath(tgtMath),
                isCombat && beatToRender.targetPower !== undefined
                  ? `${beatToRender.targetPower + (beatToRender.counterBoost ?? 0)}`
                  : null,
              )}
            </div>
          );
        })()}
        {text.sub && (
          <span
            className="font-body text-[0.9375rem] text-paper-cream text-center max-w-[320px]
                       drop-shadow-[0_2px_4px_rgba(0,0,0,0.7)]"
            data-testid="presentation-beat-sub"
          >
            {text.sub}
          </span>
        )}
        {fastFwd && (
          <span className="absolute top-3 right-3 text-[0.625rem] font-body font-extrabold uppercase tracking-wider text-ink-iron">
            ⏩ Fast forward
          </span>
        )}
      </motion.div>
    </AnimatePresence>
  );
});

export default PresentationQueue;

// ─── Helpers ────────────────────────────────────────────────────────

function severityForKind(kind: Beat['kind']): 'minor' | 'major' {
  switch (kind) {
    case 'KOD':
    case 'LIFE_LOST':
    case 'TRIGGER_ACTIVATED':
    case 'BOUNCED':
    case 'COMBAT_RESULT':
    case 'SEARCHER_RESULT':
    case 'GAME_OVER':
      return 'major';
    default:
      return 'minor';
  }
}

function renderText(
  beat: Beat,
  ctx: { viewer: 'A' | 'B'; instances: ReturnType<typeof useGameStore.getState>['state']['instances']; cardLibrary: ReturnType<typeof useGameStore.getState>['state']['cardLibrary'] },
  history: ReturnType<typeof useGameStore.getState>['state']['history'],
): { title: string; sub?: string } {
  const who = actorLabel(beat, ctx.viewer);
  const primary = cardNameFor(beat, ctx, 'primary') ?? 'A card';
  const secondary = cardNameFor(beat, ctx, 'secondary');
  switch (beat.kind) {
    case 'CARD_PLAYED':
      return { title: `${who} Played`, sub: primary };
    case 'ATTACK_DECLARED':
      return { title: 'Attack', sub: `${primary} attacks ${secondary ?? 'target'}` };
    case 'BLOCKED':
      return { title: 'Attack Blocked', sub: `${primary} blocked the attack` };
    case 'COUNTERED':
      return {
        title: 'Counter Played',
        sub: typeof beat.amount === 'number' ? `+${beat.amount} from ${primary}` : primary,
      };
    case 'BOUNCED':
      return {
        title: 'Effect Activated',
        sub: secondary ? `${primary} → ${secondary} returned to hand` : `${primary} returned a card to hand`,
      };
    case 'KOD':
      return { title: "KO'd", sub: primary };
    case 'LIFE_LOST': {
      const own = beat.actor === ctx.viewer;
      // F-7r hidden-info: only the OWNER of the lost life sees the card
      // identity. For opp life loss, primaryInstanceId is stripped by
      // beatFor so `primary` is the fallback "A card" — suppress that.
      const sub = own && beat.primaryInstanceId
        ? `Revealed: ${primary} — added to hand`
        : 'Hidden card moved to hand';
      return {
        title: own ? 'You Lost 1 Life' : 'Opponent Lost 1 Life',
        sub,
      };
    }
    case 'TRIGGER_ACTIVATED':
      return { title: 'Trigger Activated', sub: primary };
    case 'NO_VALID_TARGET': {
      const kindMap: Record<string, string> = {
        removal_bounce: 'no character to return',
        removal_ko: 'no character to KO',
      };
      const raw = beat.subText ?? '';
      const why = kindMap[raw] ?? raw.replace(/_/g, ' ');
      return {
        title: 'No Valid Target',
        sub: primary ? `${primary} effect — ${why}` : `Effect — ${why}`,
      };
    }
    case 'EFFECT_ACTIVATED': {
      // F-7w — owner direction: do not show actionKind. Render the card
      // text snippet from the source card's effectText. The subText
      // carries "{trigger}|{actionKind}" so we know which bracket to
      // extract ([On Play] vs [Activate: Main]).
      const raw = beat.subText ?? '';
      const [trig, actionKind] = raw.split('|');
      const triggerLabel = trig === 'on_play' ? 'On Play' : trig === 'activate_main' ? 'Activate Main' : 'Effect';
      // Pull the source card's effectText and extract the matching
      // bracketed clause. Card data uses "[On Play]" / "[Activate: Main]"
      // markers. Extract from the start of that bracket to the next
      // bracket OR end of sentence (period or <br>).
      const sourceInst = beat.primaryInstanceId ? ctx.instances[beat.primaryInstanceId] : undefined;
      const sourceCard = sourceInst ? ctx.cardLibrary[sourceInst.cardId] as { effectText?: string } | undefined : undefined;
      const fullText = sourceCard?.effectText ?? '';
      // Map trigger → bracket marker.
      const marker = trig === 'on_play' ? '[On Play]' :
                     trig === 'activate_main' ? '[Activate: Main]' : null;
      let snippet = '';
      if (marker && fullText.includes(marker)) {
        const after = fullText.slice(fullText.indexOf(marker) + marker.length);
        const stop = Math.min(
          ...['<br>', '. ', ' [', ' Then,'].map((d) => {
            const i = after.indexOf(d);
            return i < 0 ? Number.POSITIVE_INFINITY : i;
          }),
        );
        snippet = (Number.isFinite(stop) ? after.slice(0, stop) : after).trim().replace(/^[:\s-]+/, '');
        if (snippet.length > 80) snippet = snippet.slice(0, 78).trim() + '…';
      }
      // Fallback to a short action-kind label when no card text snippet
      // is available (e.g. continuous handler-only effects).
      if (!snippet) {
        const kindMap: Record<string, string> = {
          power_buff: 'Power boost',
          removal_bounce: 'Return to hand',
          removal_ko: 'KO effect',
          draw: 'Draw',
          searcher_peek: 'Look at deck',
          choose_one: 'Choose one',
          give_don_to_target: 'DON boost',
        };
        snippet = kindMap[actionKind ?? ''] ?? (actionKind ?? 'effect').replace(/_/g, ' ');
      }
      const who = beat.actor === ctx.viewer ? 'You' : 'Opponent';
      // F-7y — scan forward for downstream results (POWER_MODIFIED,
      // CARD_BOUNCED, CHARACTER_KOD, SEARCHER_PICKED, etc) so the beat
      // reads "Sanji activated · +2000 power on Sanji" instead of just
      // the card text snippet.
      const results = scanEffectResults(history, beat.historyIndex, beat.primaryInstanceId, ctx);
      const resultLine = results.length > 0 ? ` · ${results.join(' · ')}` : '';
      return {
        title: `${triggerLabel} — ${primary}`,
        sub: `${who}: ${snippet}${resultLine}`,
      };
    }
    case 'COMBAT_RESULT': {
      const ap = beat.attackerPower;
      const tp = beat.targetPower;
      const cb = beat.counterBoost ?? 0;
      if (ap === undefined || tp === undefined) return { title: 'Combat Result' };
      const targetEff = tp + cb;
      const won = ap >= targetEff;
      // F-7w — owner direction: combat result must show attacker + target
      // card visuals (rendered by the queue's dual-card layout since
      // primary/secondary are now set) AND power numbers AND causal
      // chain. Title is the result; sub-text is a one-line attribution
      // chain. Numbers below each card are rendered in renderCardLabel
      // below by reading the resolved beat fields.
      const chain = scanCombatChain(history, beat.historyIndex, ctx);
      const attr = attributeCombatSource(history, beat.historyIndex, ctx);
      const parts: string[] = [];
      parts.push(`${ap} ⚔ ${targetEff}`);
      if (chain.blockerName) {
        parts.push(`blocked by ${chain.blockerName}`);
      } else {
        // F-7y — owner direction: explicit "no blocker" when player skipped.
        parts.push('no blocker');
      }
      if (chain.countersTotal > 0) {
        const names = chain.counterNames.join(' + ');
        parts.push(`countered ${names ? `by ${names} ` : ''}(+${chain.countersTotal})`);
      } else {
        // F-7y — explicit "no counter" when nothing played.
        parts.push('no counter');
      }
      if (attr) {
        parts.push(
          `${attr.direction === 'debuff' ? 'power reduced by' : 'power boosted by'} ${attr.sourceName}`,
        );
      }
      return { title: won ? 'Attack Landed' : 'Attack Failed', sub: parts.join(' · ') };
    }
    case 'GAME_OVER':
      return { title: 'Game Over', sub: beat.subText };
    case 'SEARCHER_RESULT': {
      // F-7x — beat.primaryInstanceId is the PICKED card when matched,
      // or the source card when not matched. beat.subText carries the
      // source instanceId so we can name "Bonney" alongside the picked
      // card. cardNameFor returns primary's name.
      const sourceIid = beat.subText;
      const sourceInst = sourceIid ? ctx.instances[sourceIid] : undefined;
      const sourceCard = sourceInst ? ctx.cardLibrary[sourceInst.cardId] : undefined;
      const sourceName = sourceCard?.name ?? 'Source';
      const looked = beat.lookedAtCount ?? 0;
      const bottomed = beat.bottomedCount ?? 0;
      const placement = beat.placement ?? 'bottom';
      if (beat.matched) {
        const pickedName = primary; // already from cardNameFor(beat, 'primary')
        return {
          title: `${sourceName} — Searched`,
          sub: `Looked at ${looked} · added ${pickedName} to hand · ${bottomed} to ${placement}`,
        };
      }
      return {
        title: `${sourceName} — Searched`,
        sub: `No valid card found · looked at ${looked} · ${bottomed} to ${placement}`,
      };
    }
    default:
      return { title: '' };
  }
}
