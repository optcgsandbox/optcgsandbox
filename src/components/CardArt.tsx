// CardArt — visual-design-spec.md §4 (placeholder anatomy).
//
// Renders a Bandai-style placeholder card frame when no commissioned art
// exists: cost square top-left, power stamp top-right, faint compass crest
// in the mid art slot, name strip below, kind/traits bar near bottom,
// optional counter chip bottom-left, set·number microtype bottom-right.
// Background = soft per-color gradient at ~30% saturation so cream/ink/
// brass elements stay legible. Replaces the prior raw "card-id" text render
// (design-reference.md §12.2 L21).
//
// Sizes (owner instruction):
//   hand    64 × 88
//   field   52 × 72   (5 slots × 52 = 260px, fits inside 398px playmat)
//   leader  60 × 84
//   modal  220 × 308  (used by CardDetailModal)
//   mini    28 × 40
//   lifeStack 24 × 34

import { memo, useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { Card, CardColor, LeaderCard } from '@shared/engine-v2/cards/Card';
import type { CardInstance } from '@shared/engine-v2/state/types';
import { effectivePowerForDisplay } from '@shared/engine-v2/state/derived/power';
import { useGameStore } from '../store/game';

export type CardArtSize = 'hand' | 'field' | 'leader' | 'modal' | 'mini' | 'lifeStack';

export const CARD_DIMS: Record<CardArtSize, { w: number; h: number }> = {
  hand: { w: 64, h: 88 },
  field: { w: 52, h: 72 },
  leader: { w: 52, h: 72 },
  modal: { w: 220, h: 308 },
  mini: { w: 28, h: 40 },
  lifeStack: { w: 24, h: 34 },
};

/** Per-size typography + chip dimensions used by the placeholder frame. */
interface FrameMetrics {
  costChip: { size: number; inset: number; font: number; radius: number };
  powerStamp: { w: number; h: number; inset: number; font: number };
  crest: number;
  nameStrip: { h: number; font: number; pad: number };
  kindStrip: { h: number; font: number; pad: number };
  counterChip: { w: number; h: number; inset: number; font: number };
  microtype: { font: number; inset: number };
  bodyRadius: number;
  bodyStroke: number;
}

function metricsFor(size: CardArtSize): FrameMetrics {
  switch (size) {
    case 'hand':
      return {
        costChip: { size: 14, inset: 4, font: 9, radius: 2 },
        powerStamp: { w: 20, h: 12, inset: 4, font: 9 },
        crest: 32,
        nameStrip: { h: 14, font: 7, pad: 4 },
        kindStrip: { h: 10, font: 6, pad: 4 },
        counterChip: { w: 16, h: 10, inset: 2, font: 7 },
        microtype: { font: 5, inset: 3 },
        bodyRadius: 4,
        bodyStroke: 0.75,
      };
    case 'field':
      return {
        costChip: { size: 12, inset: 3, font: 8, radius: 2 },
        powerStamp: { w: 18, h: 11, inset: 3, font: 8 },
        crest: 26,
        nameStrip: { h: 12, font: 6.5, pad: 3 },
        kindStrip: { h: 9, font: 5.5, pad: 3 },
        counterChip: { w: 14, h: 9, inset: 2, font: 6 },
        microtype: { font: 4.5, inset: 2 },
        bodyRadius: 4,
        bodyStroke: 0.75,
      };
    case 'leader':
      return {
        costChip: { size: 14, inset: 4, font: 9, radius: 2 },
        powerStamp: { w: 22, h: 13, inset: 4, font: 9 },
        crest: 30,
        nameStrip: { h: 13, font: 7, pad: 4 },
        kindStrip: { h: 10, font: 6, pad: 4 },
        counterChip: { w: 16, h: 10, inset: 2, font: 7 },
        microtype: { font: 5, inset: 3 },
        bodyRadius: 5,
        bodyStroke: 0.75,
      };
    case 'modal':
      return {
        costChip: { size: 36, inset: 10, font: 22, radius: 4 },
        powerStamp: { w: 56, h: 32, inset: 10, font: 22 },
        crest: 132,
        nameStrip: { h: 28, font: 18, pad: 8 },
        kindStrip: { h: 22, font: 11, pad: 8 },
        counterChip: { w: 44, h: 28, inset: 6, font: 14 },
        microtype: { font: 10, inset: 8 },
        bodyRadius: 8,
        bodyStroke: 1,
      };
    case 'mini':
      return {
        costChip: { size: 8, inset: 2, font: 5, radius: 1 },
        powerStamp: { w: 12, h: 7, inset: 2, font: 5 },
        crest: 12,
        nameStrip: { h: 7, font: 4, pad: 1 },
        kindStrip: { h: 5, font: 4, pad: 1 },
        counterChip: { w: 0, h: 0, inset: 0, font: 0 },
        microtype: { font: 4, inset: 1 },
        bodyRadius: 2,
        bodyStroke: 0.5,
      };
    case 'lifeStack':
    default:
      return {
        costChip: { size: 0, inset: 0, font: 0, radius: 0 },
        powerStamp: { w: 0, h: 0, inset: 0, font: 0 },
        crest: 12,
        nameStrip: { h: 0, font: 0, pad: 0 },
        kindStrip: { h: 0, font: 0, pad: 0 },
        counterChip: { w: 0, h: 0, inset: 0, font: 0 },
        microtype: { font: 0, inset: 0 },
        bodyRadius: 2,
        bodyStroke: 0.5,
      };
  }
}

interface TintPair {
  top: string;
  bot: string;
  stroke: string;
}

const TINT_BY_COLOR: Record<CardColor, TintPair> = {
  red: {
    top: 'var(--card-tint-red-top)',
    bot: 'var(--card-tint-red-bot)',
    stroke: 'var(--color-seal-red)',
  },
  green: {
    top: 'var(--card-tint-green-top)',
    bot: 'var(--card-tint-green-bot)',
    stroke: 'var(--color-hull-teal)',
  },
  blue: {
    top: 'var(--card-tint-blue-top)',
    bot: 'var(--card-tint-blue-bot)',
    stroke: 'var(--color-hull-teal)',
  },
  purple: {
    top: 'var(--card-tint-purple-top)',
    bot: 'var(--card-tint-purple-bot)',
    stroke: 'var(--color-ink-iron)',
  },
  black: {
    top: 'var(--card-tint-black-top)',
    bot: 'var(--card-tint-black-bot)',
    stroke: 'var(--color-ink-black)',
  },
  yellow: {
    top: 'var(--card-tint-yellow-top)',
    bot: 'var(--card-tint-yellow-bot)',
    stroke: 'var(--color-brass-canary)',
  },
};

function tintForCard(card: Card): TintPair {
  const primary = card.colors[0];
  if (primary && TINT_BY_COLOR[primary]) return TINT_BY_COLOR[primary];
  // Default neutral tint when colors is empty (vanilla / DON / unknown).
  return {
    top: 'var(--color-paper-fog)',
    bot: 'var(--color-marine-fog)',
    stroke: 'var(--color-ink-iron)',
  };
}

/**
 * Pure derivation for the leader's life pill count.
 * Source of truth = `zones.life.length` passed in via `liveLifeCount`.
 */
export function deriveLifeCount(args: {
  isLeader: boolean;
  liveLifeCount: number | undefined;
}): number | undefined {
  return args.isLeader ? args.liveLifeCount : undefined;
}

interface CardArtProps {
  inst?: CardInstance;
  card?: Card;
  size: CardArtSize;
  faceDown?: boolean;
  onTap?: () => void;
  highlighted?: boolean;
  validDrop?: boolean;
  liveLifeCount?: number;
  /** When true, render the brass selected-attacker glow ring (design-reference §7). */
  selectedAttacker?: boolean;
  /** When true, pulse a seal-red dashed ring (legal attack target). */
  pendingTarget?: boolean;
  /** When true, pulse a brass-canary ring (DON-armed drop zone). */
  donDropTarget?: boolean;
}

function describeForA11y(
  card: Card | undefined,
  inst: CardInstance | undefined,
  displayPower: number | undefined,
): string {
  if (!card) return 'Card';
  const parts: string[] = [card.name];
  if (card.kind) parts.push(card.kind);
  if (card.cost !== null && card.cost !== undefined) parts.push(`cost ${card.cost}`);
  const powerVal = displayPower ?? card.power;
  if (powerVal !== null && powerVal !== undefined) parts.push(`power ${powerVal}`);
  if (typeof card.counterValue === 'number' && card.counterValue > 0) {
    parts.push(`counter ${card.counterValue}`);
  }
  if (inst?.attachedDon && inst.attachedDon.length > 0) {
    parts.push(`+${inst.attachedDon.length * 1000} attached DON`);
  }
  if (inst?.rested) parts.push('rested');
  return parts.join(', ');
}

/** Format power like 5000 → "5K" (hand/field/leader/mini); full digits at modal size. */
function formatPower(power: number | null | undefined, size: CardArtSize): string {
  if (power === null || power === undefined) return '';
  if (size === 'modal') return String(power);
  if (power >= 1000) {
    const k = power / 1000;
    return Number.isInteger(k) ? `${k}K` : `${k.toFixed(1)}K`;
  }
  return String(power);
}

/** Compress long names at hand/mini size: "Monkey D. Luffy" → "M. Luffy". */
function compressName(name: string, size: CardArtSize): string {
  if (size !== 'hand' && size !== 'mini') return name;
  if (name.length <= 12) return name;
  // First-name initial + last name.
  const parts = name.split(/\s+/);
  if (parts.length >= 2) {
    const first = parts[0];
    const last = parts[parts.length - 1];
    return `${first.charAt(0)}. ${last}`;
  }
  return name.slice(0, 11) + '…';
}

/** Faint compass-rose crest in the art slot — "where commissioned art goes". */
function CrestPlaceholder({ size }: { size: number }) {
  return (
    <svg
      viewBox="0 0 36 36"
      width={size}
      height={size}
      aria-hidden="true"
      className="pointer-events-none"
    >
      <g
        fill="none"
        stroke="var(--color-paper-cream)"
        strokeOpacity={0.38}
        strokeWidth={0.75}
      >
        <circle cx={18} cy={18} r={14} />
        <circle cx={18} cy={18} r={9} />
        <circle cx={18} cy={18} r={5} />
        <line x1={4} y1={18} x2={32} y2={18} />
        <line x1={18} y1={4} x2={18} y2={32} />
        <polygon points="18,8 21,18 18,28 15,18" fill="var(--color-paper-cream)" fillOpacity={0.18} />
      </g>
    </svg>
  );
}

interface PlaceholderArtProps {
  card: Card;
  size: CardArtSize;
  /** Runtime effective power for display. Falls back to `card.power` when undefined. */
  displayPower?: number;
}

/** Bandai-anatomy placeholder card frame — visual-design-spec.md §4. */
function PlaceholderArt({ card, size, displayPower }: PlaceholderArtProps) {
  const m = metricsFor(size);
  const tint = tintForCard(card);
  const isLeader = card.kind === 'leader';
  const isStage = card.kind === 'stage';
  const showCost = !isLeader && card.cost !== null && card.cost !== undefined;
  const showPower =
    (card.kind === 'character' || card.kind === 'leader') &&
    card.power !== null &&
    card.power !== undefined;
  const showCounter =
    card.kind === 'character' &&
    typeof card.counterValue === 'number' &&
    card.counterValue > 0;
  // Per §3.1 leaders +15% saturation; per §3.4 stages -8% saturation so
  // they read as lower-energy than characters. Hand-off C2 + spec §3.4.
  const saturationFilter = isLeader
    ? 'saturate(1.15)'
    : isStage
      ? 'saturate(0.92)'
      : undefined;
  // C3 + C6 — printed life square (seal-red, bottom-LEFT of leader body).
  // Uses `card.life` from CardBase (leaders carry printed life). At modal
  // size we render a larger badge; at non-modal leader sizes we render a
  // small 10×10 pill so the printed-life cue is still visible inside the
  // body without colliding with the floating live LifePill on the top edge.
  const printedLife = isLeader ? (card as LeaderCard).life ?? undefined : undefined;
  const showPrintedLife = isLeader && typeof printedLife === 'number';
  // Modal: 28×28 rounded square; leader/hand sizes: scaled-down badge.
  const printedLifeDims = (() => {
    if (!showPrintedLife) return null;
    if (size === 'modal') return { w: 28, h: 28, inset: 10, font: 16, radius: 4 };
    if (size === 'leader') return { w: 10, h: 10, inset: 3, font: 6.5, radius: 2 };
    if (size === 'hand') return { w: 10, h: 10, inset: 3, font: 6.5, radius: 2 };
    if (size === 'field') return { w: 9, h: 9, inset: 2, font: 6, radius: 2 };
    return null;
  })();
  const kindLabel = card.kind?.toUpperCase() ?? '';
  const subText = (() => {
    if (size === 'hand' || size === 'mini') return kindLabel;
    if (card.traits && card.traits.length > 0) {
      const trait = card.traits.slice(0, 2).join(' / ');
      return `${kindLabel} · ${trait}`;
    }
    return kindLabel;
  })();
  const displayName = compressName(card.name || '—', size);
  const cardNumber = (() => {
    // card.id format: e.g. "OP01-001", "ST01-001", or our test ids like "red-5-2".
    if (!card.id) return '';
    if (card.id.includes('-')) {
      const idx = card.id.lastIndexOf('-');
      const setCode = card.id.slice(0, idx);
      const num = card.id.slice(idx + 1);
      return `${setCode.toUpperCase()}·${num}`;
    }
    return card.id.toUpperCase();
  })();

  // Leader brass-canary inset frame removed 2026-05-29 per owner direction
  // ("let's remove it if it is"). Leader now reads same as other field cards.
  const leaderFrameShadow: string | undefined = undefined;

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{
        borderRadius: m.bodyRadius,
        border: `${m.bodyStroke}px solid ${tint.stroke}`,
        background: `linear-gradient(180deg, ${tint.top} 0%, ${tint.bot} 100%)`,
        filter: saturationFilter,
        boxShadow: leaderFrameShadow,
      }}
      aria-hidden="true"
    >
      {/* Crest placeholder (center art slot). */}
      <div
        className="absolute left-1/2 top-[36%] -translate-x-1/2 -translate-y-1/2"
        aria-hidden="true"
      >
        <CrestPlaceholder size={m.crest} />
      </div>

      {/* C3 + C6 — printed life square. Distinct from the floating LifePill
          overlay: this badge shows the PRINTED starting life from `card.life`,
          while the floating pill shows the LIVE life count from
          `liveLifeCount`. At MODAL size the square sits bottom-LEFT inside
          the body (per §3.1 table — leaders carry the life square at the
          bottom-LEFT). At hand/leader/field sizes the bottom strip area is
          already busy with the kind/microtype strips, so the badge moves to
          the TOP-LEFT corner (where leaders never carry a cost chip — leaders
          have `cost: null`). Both placements preserve the printed-life cue
          without collision. */}
      {showPrintedLife && printedLifeDims && (
        <div
          className="absolute flex items-center justify-center bg-seal-red"
          style={{
            // Modal: bottom-LEFT (matches §3.1 anatomy). Other sizes: top-LEFT
            // (avoids name/kind strip overlap; leaders have no cost chip).
            ...(size === 'modal'
              ? { bottom: printedLifeDims.inset, left: printedLifeDims.inset }
              : { top: printedLifeDims.inset, left: printedLifeDims.inset }),
            width: printedLifeDims.w,
            height: printedLifeDims.h,
            borderRadius: printedLifeDims.radius,
            border: '0.5px solid var(--color-ink-black)',
            zIndex: 2,
          }}
        >
          <span
            className="font-display tabular text-paper-cream"
            style={{
              fontSize: printedLifeDims.font,
              lineHeight: 1,
              fontWeight: 600,
            }}
          >
            {printedLife}
          </span>
        </div>
      )}

      {/* Cost chip (top-left) — characters / events / stages. */}
      {showCost && (
        <div
          className="absolute flex items-center justify-center bg-paper-cream"
          style={{
            top: m.costChip.inset,
            left: m.costChip.inset,
            width: m.costChip.size,
            height: m.costChip.size,
            borderRadius: m.costChip.radius,
            border: '1px solid var(--color-ink-black)',
          }}
        >
          <span
            className="font-display tabular text-ink-black"
            style={{ fontSize: m.costChip.font, lineHeight: 1, fontWeight: 600 }}
          >
            {card.cost}
          </span>
        </div>
      )}

      {/* Power stamp (top-right) — characters / leaders. */}
      {showPower && (
        <div
          className="absolute flex items-center justify-center bg-seal-red"
          style={{
            top: m.powerStamp.inset,
            right: m.powerStamp.inset,
            width: m.powerStamp.w,
            height: m.powerStamp.h,
            borderRadius: 2,
          }}
        >
          <span
            className="font-display tabular text-paper-cream"
            style={{ fontSize: m.powerStamp.font, lineHeight: 1, fontWeight: 600 }}
          >
            {formatPower(displayPower ?? card.power, size)}
          </span>
        </div>
      )}

      {/* Name strip (cream band, ~60–72% Y). */}
      {m.nameStrip.h > 0 && (
        <div
          className="absolute left-0 right-0 flex items-center justify-center bg-paper-cream"
          style={{
            bottom: m.kindStrip.h + (m.microtype.font + 4),
            height: m.nameStrip.h,
            paddingLeft: m.nameStrip.pad,
            paddingRight: m.nameStrip.pad,
          }}
        >
          <span
            className="font-display text-ink-black truncate"
            style={{ fontSize: m.nameStrip.font, lineHeight: 1, fontWeight: 600 }}
          >
            {displayName}
          </span>
        </div>
      )}

      {/* Kind/traits strip (ink band, below name). */}
      {m.kindStrip.h > 0 && (
        <div
          className="absolute left-0 right-0 flex items-center justify-center bg-ink-black"
          style={{
            bottom: m.microtype.font + 4,
            height: m.kindStrip.h,
            paddingLeft: m.kindStrip.pad,
            paddingRight: m.kindStrip.pad,
          }}
        >
          <span
            className="font-body uppercase text-paper-cream truncate"
            style={{
              fontSize: m.kindStrip.font,
              lineHeight: 1,
              letterSpacing: '0.06em',
              fontWeight: 700,
            }}
          >
            {subText}
          </span>
        </div>
      )}

      {/* Counter chip (bottom-left) — characters with counterValue > 0. */}
      {showCounter && m.counterChip.w > 0 && (
        <div
          className="absolute flex items-center justify-center bg-brass-canary"
          style={{
            bottom: m.counterChip.inset,
            left: m.counterChip.inset,
            width: m.counterChip.w,
            height: m.counterChip.h,
            borderRadius: 2,
            border: '0.5px solid var(--color-ink-black)',
          }}
        >
          <span
            className="font-display tabular text-ink-black"
            style={{ fontSize: m.counterChip.font, lineHeight: 1, fontWeight: 600 }}
          >
            +{(card.counterValue ?? 0) / 1000}K
          </span>
        </div>
      )}

      {/* Set·number microtype (bottom-right). */}
      {m.microtype.font > 0 && cardNumber && (
        <span
          className="absolute font-body text-ink-black/55"
          style={{
            bottom: m.microtype.inset,
            right: m.microtype.inset,
            fontSize: m.microtype.font,
            lineHeight: 1,
          }}
        >
          {cardNumber}
        </span>
      )}
    </div>
  );
}

/** Generic cream-with-teal-compass card back for face-down cards. */
function CardBack() {
  return (
    <div
      className="absolute inset-0 overflow-hidden rounded-[3px] bg-paper-cream"
      style={{ border: '0.5px solid var(--color-ink-black)' }}
      aria-hidden="true"
    >
      <div
        className="absolute inset-0.5 rounded-[2px]"
        style={{ boxShadow: 'inset 0 0 0 1px rgba(212,160,23,0.35)' }}
      />
      <svg viewBox="0 0 36 50" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <g fill="none" stroke="var(--color-hull-teal)" strokeWidth={0.75}>
          <circle cx={18} cy={25} r={6} />
          <circle cx={18} cy={25} r={9} />
          <circle cx={18} cy={25} r={12} />
        </g>
        <g fill="var(--color-hull-teal)">
          <polygon points="18,25 22.5,20.5 27.5,15.5 23,20 18,25" />
          <polygon points="18,25 13.5,29.5 8.5,34.5 13,30 18,25" opacity={0.55} />
        </g>
      </svg>
    </div>
  );
}

/** Floating life pill above leader's top edge. */
function LifePill({ count }: { count: number }) {
  return (
    <div
      className="absolute -top-3 left-1/2 -translate-x-1/2 z-10
                 bg-paper-cream ring-2 ring-seal-red rounded-full
                 px-2 py-0.5 shadow-card"
      aria-label={`Life ${count}`}
    >
      <span className="font-display text-[0.95rem] leading-none text-ink-black tabular">
        {count}
      </span>
    </div>
  );
}

/** F-7v — Power modifier badge. Floats on the LEFT edge of the card,
 *  vertically centered, so it visually belongs to the card without
 *  colliding with the DON badge (top-right), the power stamp (top-right
 *  inside the card), the counter chip (bottom-left inside the card), or
 *  the printed-life square (top-left for leaders). Brass-canary for
 *  positive buffs, seal-red for debuffs.
 *
 *  Uses `data-flip-back` so the opp half's 180° rotation un-flips the
 *  badge text — same convention as the trash-count fix in F-7r.
 */
function PowerModBadge({ amount }: { amount: number }) {
  const positive = amount > 0;
  const display = positive ? `+${amount}` : `${amount}`;
  return (
    <motion.div
      data-testid="power-mod-badge"
      data-flip-back
      data-power-mod={amount}
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      transition={{ type: 'spring', stiffness: 500, damping: 24 }}
      className={[
        'absolute -left-1.5 top-1/2 -translate-y-1/2 z-20',
        'rounded-md px-1 py-0.5 font-display tabular text-[0.6875rem] leading-none',
        'shadow-[0_2px_4px_rgba(15,20,15,0.45)]',
        'ring-1 ring-ink-black/60',
        positive ? 'bg-brass-canary text-ink-black' : 'bg-seal-red text-paper-cream',
      ].join(' ')}
      aria-label={`Power modifier ${display}`}
      title={`Power ${positive ? 'boost' : 'debuff'} ${display}`}
    >
      {display}
    </motion.div>
  );
}

/** Attached DON badge top-right (brass "+N" chip). */
function DonBadge({ count }: { count: number }) {
  return (
    <motion.div
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      transition={{ type: 'spring', stiffness: 500, damping: 25 }}
      className="absolute -top-1 -right-1 bg-brass-canary text-ink-black
                 text-[0.6rem] font-body font-bold rounded-full
                 w-4 h-4 flex items-center justify-center tabular z-10"
      aria-hidden="true"
    >
      +{count}
    </motion.div>
  );
}

/**
 * Public R2 base for the Crew Builder card-image bucket. Mirrors
 * `scripts/card-sync/index.mjs:77 IMAGE_BASE_URL` on the Crew Builder
 * side — every primary print is uploaded as `{cardId}.png` (e.g.
 * `OP09-042.png`). Same bucket also serves `lib/features/collection/
 * presentation/collection_screen.dart:537` (set thumbs).
 */
const R2_IMAGE_BASE = 'https://pub-bed2e18730014af1aeb9e1e85e692e3c.r2.dev';

/**
 * Map a card id → its public R2 URL. Returns null for non-OPTCG ids
 * (e.g. internal `DON` and unit-test ids like `red-5-2` per the
 * `cardNumber` derivation at line 329 of this file) so we don't 404.
 *
 * Pattern: uppercase set prefix + dash + digits, e.g. `OP09-042`,
 * `EB01-001`, `ST01-001`, `P-001`, `PRB01-001`. Matches every set in
 * the corpus (TRACK_STATE.md "Cards.json structure" enumerates them).
 */
function cardIdToR2Url(cardId: string | undefined): string | null {
  if (!cardId) return null;
  if (!/^[A-Z][A-Z0-9]*-\d+$/.test(cardId)) return null;
  return `${R2_IMAGE_BASE}/${cardId}.png`;
}

export const CardArt = memo(function CardArt({
  inst,
  card,
  size,
  faceDown,
  onTap,
  highlighted,
  validDrop,
  liveLifeCount,
  selectedAttacker,
  pendingTarget,
  donDropTarget,
}: CardArtProps) {
  const dims = CARD_DIMS[size];
  const reduced = useReducedMotion() ?? false;
  const isLeader = card?.kind === 'leader';
  const lifeCount = deriveLifeCount({ isLeader, liveLifeCount });

  // Real-art fallback path. If the card has no explicit `imageUrl` we
  // derive one from its id against the Crew Builder R2 bucket. If the
  // fetch fails (404 / network), we flip to the placeholder so the slot
  // never goes blank. State is keyed implicitly to this CardArt instance
  // — a different card mounting fresh resets `imgError` to false.
  const [imgError, setImgError] = useState(false);
  // DON!! cards have id="DON" (no set/number) so they don't match the R2
  // pattern. Source the face-up DON front from the bundled Bandai art at
  // `public/backs/don-front.png` (extracted from rule_manual.pdf p.4).
  const derivedImageUrl =
    card?.imageUrl
      ?? (card?.kind === 'don' ? '/backs/don-front.png' : null)
      ?? cardIdToR2Url(card?.id);

  // Runtime effective power for display. Falls back to printed `card.power`
  // when no instance exists (hand/library/modal previews). When an instance
  // is bound, always read from the live store so aura buffs, attached DON,
  // continuous modifiers, and power overrides surface in the UI.
  const liveState = useGameStore((s) => s.state);
  const displayPower = useMemo<number | undefined>(() => {
    if (!card) return undefined;
    if (card.power === null || card.power === undefined) return undefined;
    if (!inst) return card.power;
    const freshInst = liveState.instances[inst.instanceId] ?? inst;
    return effectivePowerForDisplay(liveState, freshInst);
  }, [card, inst, liveState]);

  // F-7v — net power modifier from this_battle + one_shot + continuous.
  // Owner direction (addendum 2026-06-11): the power stamp shows the
  // EFFECTIVE power but the player has no idea WHY it changed. Surface
  // the delta on the card itself so a +2000 or -3000 is unmistakable.
  // Skip for hand / mini / lifeStack sizes (those don't show on-board
  // combat). Modal already shows full effect text inline.
  const powerModNet = useMemo<number>(() => {
    if (!inst) return 0;
    const freshInst = liveState.instances[inst.instanceId] ?? inst;
    const m1 = freshInst.powerModifierThisBattle ?? 0;
    const m2 = freshInst.powerModifierOneShot ?? 0;
    const m3 = freshInst.powerModifierContinuous ?? 0;
    return m1 + m2 + m3;
  }, [inst, liveState]);
  const showPowerMod = (size === 'field' || size === 'leader') && powerModNet !== 0;

  const a11y = describeForA11y(card, inst, displayPower);
  const interactive = !!onTap && size !== 'mini' && size !== 'lifeStack';

  // State rings (selected / valid-drop / pending / highlighted) compose as
  // box-shadow on the button rectangle. The base "card sits above mat"
  // drop shadow lives on the inner render via `filter: drop-shadow(...)`
  // instead so it follows the image's natural transparent rounded corners
  // (owner caught the rectangular shadow halo 2026-06-03).
  const shadowStack = useMemo(() => {
    const parts: string[] = [];
    if (selectedAttacker) {
      parts.unshift('0 0 0 2px var(--color-brass-canary)');
    }
    if (validDrop || donDropTarget) {
      parts.unshift('0 0 0 2px var(--color-sun-brass)');
    }
    if (pendingTarget) {
      parts.unshift('0 0 0 2px var(--color-seal-red)');
    }
    if (highlighted) {
      parts.unshift('0 0 0 2px var(--color-brass-canary)');
    }
    return parts.length > 0 ? parts.join(', ') : 'none';
  }, [selectedAttacker, validDrop, donDropTarget, pendingTarget, highlighted]);

  // Alpha-respecting drop shadow string reused by the three render
  // branches (img / CardBack / PlaceholderArt) so the shadow follows
  // the card's natural rounded corners instead of painting a rectangle.
  const cardDropShadow = 'drop-shadow(0 1px 3px rgba(15,20,15,0.30))';

  // Selected attacker lifts -8px and scales 1.05 per design-reference §7.
  const attackerHover = selectedAttacker ? { y: -8, scale: 1.05 } : {};

  return (
    // Outer static wrapper carries data-flip-back so the CSS counter-rotation
    // for the opp half is not overridden by Framer Motion's inline transforms
    // (whileHover/whileTap/animate write transform=...; that would clobber
    // the rotate(180deg) from the CSS rule and cause the card to flip back
    // upside-down on hover).
    <div data-flip-back style={{ display: 'block', width: dims.w, height: dims.h }}>
    <motion.button
      type="button"
      layoutId={inst?.instanceId}
      onClick={(e) => {
        // Stop bubble to PlayfieldStage root onPlaymatTap (clears armedDonId /
        // selectedAttackerId / inspectedCardId) — that handler is intended for
        // taps on EMPTY playmat surface only.
        // Only stop when WE handle the click (onTap defined). If CardArt is
        // rendered inside a tappable wrapper (e.g. TrashSlot's occupied-state
        // wrapper opens TrashViewer on click), CardArt has no onTap and the
        // click must bubble to that wrapper.
        if (!onTap) return;
        e.stopPropagation();
        onTap();
      }}
      // Non-interactive (no onTap): use aria-disabled + tabIndex={-1} instead
      // of the `disabled` attribute. Native `disabled` on Safari iOS blocks
      // SR/focus interaction even when `pointer-events: none` already lets
      // clicks pass through to a wrapping tappable parent (TrashSlot, etc.).
      // Pointer-events:none in `style` below still handles the mouse path.
      aria-disabled={!interactive ? true : undefined}
      tabIndex={interactive ? undefined : -1}
      // Append target-state hints so SR users get the same info as the
      // color-only ring cues (red = pending attack target, brass = DON drop
      // target, brass = selected attacker). WCAG 1.4.1 "Use of Color".
      aria-label={[
        a11y,
        pendingTarget && 'legal attack target',
        donDropTarget && 'DON drop target',
        selectedAttacker && 'selected attacker',
      ].filter(Boolean).join(', ')}
      aria-pressed={selectedAttacker}
      title={card?.name}
      data-card-id={card?.id}
      data-instance-id={inst?.instanceId}
      // Stiffer spring for the rest-rotate animation (owner direction
       // 2026-05-30: refresh phase was perceived as slow). Settles in ~500ms
       // vs ~1100ms with the previous cardTravel preset (stiffness 260).
      transition={{ type: 'spring', stiffness: 380, damping: 28 }}
      whileHover={interactive && !reduced ? { y: -2, transition: { duration: 0.15 } } : undefined}
      whileTap={interactive && !reduced ? { scale: 0.97 } : undefined}
      animate={{
        ...attackerHover,
        // Animated rest/un-rest rotation. Framer composes this with whileHover
        // (y) and whileTap (scale). Reduced-motion users skip the tween via
        // the global useReducedMotion gate. Owner direction 2026-05-30.
        rotate: inst?.rested ? 90 : 0,
        boxShadow: pendingTarget || donDropTarget
          ? [
              shadowStack,
              shadowStack.replace('0 0 0 2px', '0 0 0 3px'),
              shadowStack,
            ]
          : shadowStack,
      }}
      style={{
        width: dims.w,
        height: dims.h,
        // When non-interactive (no onTap), let clicks pass through to any
        // wrapping clickable parent (e.g. TrashSlot's wrapper opens TrashViewer).
        // Without this, the disabled button absorbs the click (browser spec:
        // disabled buttons don't fire click and DO have pointer-events: auto),
        // so the wrapper's onClick never sees the tap.
        pointerEvents: interactive ? undefined : 'none',
      }}
      className={[
        'relative overflow-visible',
        'outline-none focus-visible:ring-2 focus-visible:ring-sun-brass',
        interactive ? 'cursor-pointer' : 'cursor-default',
        // Rotation moved to motion `animate.rotate` above so the rest/un-rest
        // transition tweens smoothly instead of snapping via Tailwind class.
      ].join(' ')}
    >
      {faceDown || !card ? (
        // CardBack / PlaceholderArt are flat rectangles — wrapper clips
        // their corners via borderRadius + overflow-hidden.
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ borderRadius: size === 'modal' ? 8 : size === 'leader' ? 5 : 4, filter: cardDropShadow }}
        >
          <CardBack />
        </div>
      ) : derivedImageUrl && !imgError ? (
        // Real Bandai card scans (R2) already carry their own transparent
        // rounded corners. Clipping with overflow-hidden + borderRadius
        // would fight the natural alpha and produce squarish corners
        // (owner caught 2026-06-03). `object-contain` shows the full card;
        // any margin is transparent so it composites cleanly into the slot.
        // `filter: drop-shadow(...)` follows the image's natural alpha so
        // the card's drop shadow is rounded too (not a rectangle around
        // the button — the artifact owner caught 2026-06-03 round 2).
        <img
          src={derivedImageUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-contain"
          style={{ filter: cardDropShadow }}
          decoding={size === 'hand' || size === 'leader' ? 'sync' : 'async'}
          loading={size === 'mini' ? 'lazy' : 'eager'}
          onError={() => setImgError(true)}
        />
      ) : (
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ borderRadius: size === 'modal' ? 8 : size === 'leader' ? 5 : 4, filter: cardDropShadow }}
        >
          <PlaceholderArt card={card} size={size} displayPower={displayPower} />
        </div>
      )}
      {isLeader && typeof lifeCount === 'number' && <LifePill count={lifeCount} />}
      {inst && inst.attachedDon.length > 0 && <DonBadge count={inst.attachedDon.length} />}
      {showPowerMod && <PowerModBadge amount={powerModNet} />}
    </motion.button>
    </div>
  );
});

// Card type augmentation kept for image URL support.
declare module '@shared/engine-v2/cards/Card' {
  interface CardBase {
    imageUrl?: string;
  }
}
