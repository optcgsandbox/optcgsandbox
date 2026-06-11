/**
 * F-7n Issue 1 — pure observation helper for reproduction specs.
 *
 * No production code is touched. The helper queries the rendered DOM
 * for everything already exposed via stable testIds + data attributes
 * (per `src/online/OnlinePlayfield.tsx`):
 *   - `online-board-phase` (phase string + turn number)
 *   - `online-active-player`
 *   - `online-last-action`
 *   - `online-legal-actions-count`
 *   - `online-match-result`
 *   - `[data-testid^="online-action-"]` with `data-action-type` +
 *     `data-action-group` + `data-action-index`
 *   - `online-pending-banner` (when phase is reactive) with
 *     `data-pending-phase` + `data-needs-response`
 *
 * Fields not exposed by the OnlinePlayfield today (`pending` kind
 * beyond the banner attribute, `lastServerMessage` shape) are noted
 * as `null` so the reproduction report makes the gap explicit rather
 * than inventing data.
 */

import type { Page } from '@playwright/test';

export interface DomSnapshot {
  readonly viewer: 'A' | 'B' | string | null;
  readonly phase: string | null;
  readonly turn: number | null;
  readonly activePlayer: string | null;
  readonly result: string | null;
  readonly lastAction: string | null;
  readonly legalActionsCount: number | null;
  readonly hash: string | null;
  readonly serverSeq: number | null;
  readonly pendingBanner: null | {
    readonly phase: string | null;
    readonly needsResponse: string | null;
    readonly title: string | null;
    readonly subtitle: string | null;
  };
  readonly actions: ReadonlyArray<{
    readonly testId: string;
    readonly index: number;
    readonly type: string;
    readonly group: string;
    readonly label: string;
    readonly disabled: boolean;
  }>;
}

export async function captureSnapshot(page: Page): Promise<DomSnapshot> {
  return page.evaluate(() => {
    const text = (sel: string): string | null => {
      const el = document.querySelector(sel);
      return el?.textContent?.trim() ?? null;
    };

    const phaseSpan = document.querySelector('[data-testid="online-board-phase"]');
    const phase = phaseSpan?.textContent?.trim() ?? null;
    let turn: number | null = null;
    const phaseRow = phaseSpan?.parentElement;
    const phaseRowText = phaseRow?.textContent ?? '';
    const turnMatch = /turn\s+(\d+)/i.exec(phaseRowText);
    if (turnMatch !== null) turn = Number.parseInt(turnMatch[1]!, 10);

    let viewer: string | null = null;
    let hash: string | null = null;
    let serverSeq: number | null = null;
    {
      const rows = document.querySelectorAll('[data-testid="online-playfield-root"] > div');
      for (const r of Array.from(rows)) {
        const t = (r as HTMLElement).textContent ?? '';
        const m = /^\s*viewer\s+([AB])/.exec(t);
        if (m !== null && viewer === null) viewer = m[1]!;
        const mh = /^\s*hash\s+([0-9a-fA-F]+|—)/.exec(t);
        if (mh !== null && mh[1] !== '—' && hash === null) hash = mh[1]!;
        const ms = /^\s*serverSeq\s+(\d+)/.exec(t);
        if (ms !== null && serverSeq === null) serverSeq = Number.parseInt(ms[1]!, 10);
      }
    }

    const banner = document.querySelector('[data-testid="online-pending-banner"]');
    const pendingBanner = banner === null
      ? null
      : {
          phase: banner.getAttribute('data-pending-phase'),
          needsResponse: banner.getAttribute('data-needs-response'),
          title: banner.querySelector(':scope > div')?.textContent?.trim() ?? null,
          subtitle: banner.querySelectorAll(':scope > div')[1]?.textContent?.trim() ?? null,
        };

    const actions = Array.from(
      document.querySelectorAll('[data-testid^="online-action-"]'),
    ).map((b) => {
      const el = b as HTMLButtonElement;
      const testId = el.getAttribute('data-testid') ?? '';
      const idxStr = el.getAttribute('data-action-index') ?? testId.replace('online-action-', '');
      return {
        testId,
        index: Number.parseInt(idxStr, 10),
        type: el.getAttribute('data-action-type') ?? '?',
        group: el.getAttribute('data-action-group') ?? '?',
        label: el.textContent?.trim() ?? '',
        disabled: el.disabled,
      };
    });

    return {
      viewer,
      phase,
      turn,
      activePlayer: text('[data-testid="online-active-player"]'),
      result: text('[data-testid="online-match-result"]'),
      lastAction: text('[data-testid="online-last-action"]'),
      legalActionsCount: (() => {
        const v = text('[data-testid="online-legal-actions-count"]');
        return v === null ? null : Number.parseInt(v, 10);
      })(),
      hash,
      serverSeq,
      pendingBanner,
      actions,
    };
  });
}

export function summarizeSnapshot(label: string, snap: DomSnapshot): string {
  const groupCount = new Map<string, number>();
  for (const a of snap.actions) {
    groupCount.set(a.group, (groupCount.get(a.group) ?? 0) + 1);
  }
  const groups = Array.from(groupCount.entries())
    .map(([g, n]) => `${g}=${n}`)
    .join(', ');
  return [
    `=== ${label} ===`,
    `  viewer=${snap.viewer} phase=${snap.phase} turn=${snap.turn} active=${snap.activePlayer}`,
    `  result=${snap.result} lastAction=${snap.lastAction}`,
    `  legalActionsCount=${snap.legalActionsCount} hash=${snap.hash} serverSeq=${snap.serverSeq}`,
    `  pendingBanner=${snap.pendingBanner === null ? 'none' : JSON.stringify(snap.pendingBanner)}`,
    `  actionGroups: ${groups}`,
    `  actions:`,
    ...snap.actions.map(
      (a) =>
        `    [${String(a.index).padStart(2)}] ${a.type.padEnd(20)} group=${a.group.padEnd(22)} disabled=${a.disabled} label="${a.label}"`,
    ),
  ].join('\n');
}
