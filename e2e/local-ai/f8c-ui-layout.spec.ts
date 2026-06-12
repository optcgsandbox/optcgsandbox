/**
 * F-8C — unified card interaction + combat/prompt layout assertions.
 *
 * Drives the real local app via `window.__store` (same harness pattern as
 * effect-card-proof.spec.ts), manufactures the relevant windows/beats
 * deterministically via setState, and asserts the layout contract:
 *
 *   1. CounterPrompt never scrolls the page; CTAs visible in-viewport
 *   2. BlockerPrompt same
 *   3. SearcherPeekPrompt View == CardDetailModal inspect dimensions
 *   4. Combat beat: attacker LEFT / target RIGHT, no overlap, in-viewport
 *   5. Played-card reveal beat == inspect presentation size
 *   6. COST AREA wordmark centered identically on both halves
 */

import { test, expect, type Page } from '@playwright/test';

const TWO_MIN = 120_000;

// Loose view of the live engine state for harness-side seeding/mutation.
// (Compile-time only — page.evaluate callbacks may reference outer types.)
interface HarnessPlayer {
  hand: string[];
  field: Array<Record<string, unknown>>;
  leader: { instanceId: string };
  donDeck: string[];
  donCostArea: string[];
  donRested: string[];
}
interface HarnessState {
  phase: string;
  activePlayer: string;
  pending: unknown;
  history: Array<Record<string, unknown>>;
  cardLibrary: Record<string, unknown>;
  instances: Record<string, unknown>;
  players: Record<string, HarnessPlayer>;
}

test.use({
  launchOptions: { args: ['--disable-web-security'] },
});

async function bootstrap(page: Page): Promise<void> {
  await page.goto('/?test=1');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(
    () => Boolean((window as unknown as { __store?: unknown }).__store),
    undefined,
    { timeout: 15_000 },
  );
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __store?: { getState: () => { state: { phase: string } } } };
      return w.__store?.getState().state.phase === 'dice_roll';
    },
    undefined,
    { timeout: 15_000 },
  );
  for (let i = 0; i < 8; i += 1) {
    const phase = await page.evaluate(() => {
      const w = window as unknown as { __store?: { getState: () => { state: { phase: string } } } };
      return w.__store?.getState().state.phase ?? '';
    });
    if (!phase.includes('dice_roll')) break;
    const btn = page.getByRole('button', { name: /^roll your die$/i }).first();
    if (await btn.isVisible().catch(() => false)) {
      if (!(await btn.isDisabled().catch(() => true))) await btn.click();
    }
    await page.waitForTimeout(2200);
  }
  const goFirst = page.getByRole('button', { name: /^go first$/i }).first();
  try {
    await goFirst.waitFor({ state: 'visible', timeout: 4_000 });
    await goFirst.click();
  } catch { /* AI auto-fires */ }
  const keep = page.getByRole('button', { name: /^keep$/i }).first();
  try {
    await keep.waitFor({ state: 'visible', timeout: 8_000 });
    await keep.click();
  } catch { /* fast path */ }
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __store?: { getState: () => { state: { phase: string; activePlayer: string } } } };
      const s = w.__store?.getState().state;
      return s?.phase === 'main' && s?.activePlayer === 'A';
    },
    undefined,
    { timeout: 30_000 },
  );
}

/** Seed `count` synthetic counter-bearing cards into A's hand; returns iids. */
async function seedHandCounters(page: Page, count: number): Promise<string[]> {
  return page.evaluate((n) => {
    const w = window as unknown as {
      __store?: {
        getState: () => { state: HarnessState };
        setState: (p: { state: Record<string, unknown> }) => void;
      };
    };
    const s = w.__store!.getState().state;
    const iids: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const cid = `F8C_CTR_${i}`;
      s.cardLibrary[cid] = {
        id: cid, name: `F8C Counter ${i}`, kind: 'character', colors: ['red'],
        cost: 2, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
      };
      const iid = `f8c_ctr_${i}`;
      s.instances[iid] = {
        instanceId: iid, cardId: cid, controller: 'A', rested: false,
        summoningSick: false, attachedDon: [], attachedDonRested: [],
        perTurn: { hasAttacked: false, effectsUsed: [] },
      };
      s.players.A.hand = [...s.players.A.hand, iid];
      iids.push(iid);
    }
    w.__store!.setState({ state: { ...s } });
    return iids;
  }, count);
}

/** Force a counter window where B attacks A's leader, with PLAY_COUNTER
 *  legal actions for the given hand iids. */
async function forceCounterWindow(page: Page, counterIids: string[]): Promise<void> {
  await page.evaluate((iids) => {
    const w = window as unknown as {
      __store?: {
        getState: () => { state: HarnessState };
        setState: (p: Record<string, unknown>) => void;
      };
    };
    const s = w.__store!.getState().state;
    s.activePlayer = 'B';
    s.phase = 'counter_window';
    s.pending = {
      kind: 'attack',
      pendingAttack: {
        attackerInstanceId: s.players.B.leader.instanceId,
        targetInstanceId: s.players.A.leader.instanceId,
        counterBoost: 0,
        armedReplacements: [],
      },
    };
    const legalActions = [
      { type: 'SKIP_COUNTER' },
      ...iids.map((iid) => ({ type: 'PLAY_COUNTER', instanceId: iid })),
    ];
    w.__store!.setState({ state: { ...s }, legalActions });
  }, counterIids);
}

/** Assert the page itself cannot scroll and `locator` is fully in-viewport. */
async function assertNoPageScrollAnd(page: Page, selectors: string[]): Promise<void> {
  const scroll = await page.evaluate(() => ({
    docScrollH: document.documentElement.scrollHeight,
    docClientH: document.documentElement.clientHeight,
    bodyScrollTop: document.body.scrollTop,
    innerH: window.innerHeight,
    innerW: window.innerWidth,
  }));
  expect(
    scroll.docScrollH,
    'document does not exceed the viewport (no page scroll during prompt)',
  ).toBeLessThanOrEqual(scroll.docClientH + 1);
  for (const sel of selectors) {
    const box = await page.locator(sel).boundingBox();
    expect(box, `${sel} rendered`).not.toBeNull();
    expect(box!.y, `${sel} top inside viewport`).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height, `${sel} bottom inside viewport`).toBeLessThanOrEqual(scroll.innerH + 1);
    expect(box!.x, `${sel} left inside viewport`).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, `${sel} right inside viewport`).toBeLessThanOrEqual(scroll.innerW + 1);
  }
}

test.describe('F-8C — unified layout contract', () => {
  test('1. CounterPrompt with 8 counters: no page scroll, Skip + tiles in viewport, selection does not resize tiles', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    await bootstrap(page);
    const iids = await seedHandCounters(page, 8);
    await forceCounterWindow(page, iids);

    const prompt = page.locator('[data-pending-kind="counter_window"]');
    await expect(prompt).toBeVisible();
    await assertNoPageScrollAnd(page, ['[data-action="SKIP_COUNTER"]']);

    // Tile is fixed prompt size (110×154) and does NOT resize on selection.
    const tile = page.locator(`[data-counter-instance-id="${iids[0]}"]`);
    const before = await tile.boundingBox();
    await tile.click();
    await expect(tile).toHaveAttribute('data-selected', 'true');
    const after = await tile.boundingBox();
    expect(Math.abs(after!.width - before!.width), 'tile width stable on select').toBeLessThanOrEqual(9); // ring px only
    expect(Math.round(before!.width), 'prompt tile width = 110').toBe(110);
    // Use Selected CTA appears and stays in viewport.
    await assertNoPageScrollAnd(page, ['[data-action="CONFIRM_COUNTER"]', '[data-action="SKIP_COUNTER"]']);
  });

  test('2. BlockerPrompt with 6 blockers: no page scroll, Skip + Use visible', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    await bootstrap(page);
    // Seed 6 field blockers for A and force a block window vs A's leader.
    const iids = await page.evaluate(() => {
      const w = window as unknown as {
        __store?: { getState: () => { state: HarnessState }; setState: (p: Record<string, unknown>) => void };
      };
      const s = w.__store!.getState().state;
      const out: string[] = [];
      for (let i = 0; i < 6; i += 1) {
        const cid = `F8C_BLK_${i}`;
        s.cardLibrary[cid] = {
          id: cid, name: `F8C Blocker ${i}`, kind: 'character', colors: ['red'],
          cost: 2, power: 3000, counterValue: 1000, traits: [], keywords: ['blocker'], effectTags: [],
        };
        const iid = `f8c_blk_${i}`;
        const inst = {
          instanceId: iid, cardId: cid, controller: 'A', rested: false,
          summoningSick: false, attachedDon: [], attachedDonRested: [],
          perTurn: { hasAttacked: false, effectsUsed: [] },
        };
        s.instances[iid] = inst;
        s.players.A.field = [...s.players.A.field, inst];
        out.push(iid);
      }
      s.activePlayer = 'B';
      s.phase = 'block_window';
      s.pending = {
        kind: 'attack',
        pendingAttack: {
          attackerInstanceId: s.players.B.leader.instanceId,
          targetInstanceId: s.players.A.leader.instanceId,
          counterBoost: 0,
          armedReplacements: [],
        },
      };
      const legalActions = [
        { type: 'SKIP_BLOCKER' },
        ...out.map((iid) => ({ type: 'DECLARE_BLOCKER', blockerInstanceId: iid })),
      ];
      w.__store!.setState({ state: { ...s }, legalActions });
      return out;
    });

    const prompt = page.locator('[data-pending-kind="block_window"]');
    await expect(prompt).toBeVisible();
    await assertNoPageScrollAnd(page, ['[data-action="SKIP_BLOCKER"]']);
    const tile = page.locator(`[data-blocker-instance-id="${iids[0]}"]`);
    await tile.click();
    await expect(tile).toHaveAttribute('data-selected', 'true');
    await assertNoPageScrollAnd(page, ['[data-action="CONFIRM_BLOCKER"]', '[data-action="SKIP_BLOCKER"]']);
  });

  test('3. SearcherPeekPrompt View opens the SAME inspect size as CardDetailModal', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    await bootstrap(page);
    // Manufacture a searcher window with 4 seeded cards.
    const iids = await page.evaluate(() => {
      const w = window as unknown as {
        __store?: { getState: () => { state: HarnessState }; setState: (p: Record<string, unknown>) => void };
      };
      const s = w.__store!.getState().state;
      const out: string[] = [];
      for (let i = 0; i < 4; i += 1) {
        const cid = `F8C_SRCH_${i}`;
        s.cardLibrary[cid] = {
          id: cid, name: `F8C Search ${i}`, kind: 'character', colors: ['red'],
          cost: 5, power: 6000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
        };
        const iid = `f8c_srch_${i}`;
        s.instances[iid] = {
          instanceId: iid, cardId: cid, controller: 'A', rested: false,
          summoningSick: false, attachedDon: [], attachedDonRested: [],
          perTurn: { hasAttacked: false, effectsUsed: [] },
        };
        out.push(iid);
      }
      s.phase = 'searcher_peek_choice';
      s.pending = {
        kind: 'searcher_peek',
        pendingSearcherPeek: {
          controller: 'A',
          sourceInstanceId: out[0],
          lookedAtInstanceIds: out,
          validPickInstanceIds: out.slice(0, 2),
          pickLimit: 1,
          mayChooseNone: true,
          bottomOrderRequired: true,
          revealPickedToOpponent: true,
          filterSummary: 'Choose up to 1 cost 4+ card and add it to your hand.',
          placement: 'bottom',
          playInsteadOfHand: false,
          rested: false,
          resumePhase: 'main',
        },
      };
      w.__store!.setState({ state: { ...s } });
      return out;
    });

    const prompt = page.locator('[data-pending-kind="searcher_peek"]');
    await expect(prompt).toBeVisible();
    await assertNoPageScrollAnd(page, ['[data-searcher-confirm]', '[data-searcher-choose-none]']);

    // View → shared inspect overlay.
    await page.locator(`[data-searcher-view="${iids[0]}"]`).click();
    const inspect = page.locator('[data-testid="card-inspect-card"]');
    await expect(inspect).toBeVisible();
    // Measure the CardArt root (data-flip-back = exactly 220×308 × scale) so
    // both measurements compare the same element class, not wrapper padding.
    const inspectArt = page.locator('[data-testid="card-inspect-card"] [data-flip-back]').first();
    // Wait out the entrance spring before measuring.
    await page.waitForTimeout(400);
    const inspectBox = await inspectArt.boundingBox();
    // Close the overlay + prompt, then open the normal CardDetailModal on a
    // field card and measure the SAME presentation.
    await inspect.click();
    await page.evaluate((iid) => {
      const w = window as unknown as {
        __store?: { getState: () => { state: HarnessState; setInspectedCardId: (id: string | null) => void; setCardDetailOpen: (b: boolean) => void }; setState: (p: Record<string, unknown>) => void };
      };
      const st = w.__store!.getState();
      const s = st.state;
      s.phase = 'main';
      s.pending = null;
      s.activePlayer = 'A';
      w.__store!.setState({ state: { ...s } });
      st.setInspectedCardId(iid);
      st.setCardDetailOpen(true);
    }, iids[0]);
    const detailArt = page.locator('[data-testid="detail-card-art"] [data-flip-back]').first();
    await expect(detailArt).toBeVisible();
    await page.waitForTimeout(400);
    const detailBox = await detailArt.boundingBox();

    expect(inspectBox, 'inspect overlay measured').not.toBeNull();
    expect(detailBox, 'detail modal art measured').not.toBeNull();
    // Same standard: both are modal-art × 1.5 → 330×462 (±2px rounding).
    expect(Math.abs(inspectBox!.width - detailBox!.width), 'inspect width == detail width').toBeLessThanOrEqual(2);
    expect(Math.abs(inspectBox!.height - detailBox!.height), 'inspect height == detail height').toBeLessThanOrEqual(2);
    expect(Math.round(inspectBox!.width), 'inspect = 330 wide (modal × 1.5)').toBe(330);
  });

  test('4 + 5. Combat beat: attacker LEFT / target RIGHT, no overlap, in-viewport; played reveal = inspect size', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    await bootstrap(page);

    // 5 — played-card reveal first: append a CHARACTER_PLAYED event.
    const playedBox = await page.evaluate(() => {
      const w = window as unknown as {
        __store?: { getState: () => { state: HarnessState }; setState: (p: Record<string, unknown>) => void };
      };
      const s = w.__store!.getState().state;
      const cid = 'F8C_REVEAL';
      s.cardLibrary[cid] = {
        id: cid, name: 'F8C Reveal', kind: 'character', colors: ['red'],
        cost: 4, power: 5000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
      };
      const iid = 'f8c_reveal';
      s.instances[iid] = {
        instanceId: iid, cardId: cid, controller: 'A', rested: false,
        summoningSick: false, attachedDon: [], attachedDonRested: [],
        perTurn: { hasAttacked: false, effectsUsed: [] },
      };
      s.history = [...s.history, { type: 'CHARACTER_PLAYED', instanceId: iid, cardId: cid, controller: 'A', cost: 4 }];
      w.__store!.setState({ state: { ...s } });
      return null;
    });
    void playedBox;
    const primary = page.locator('[data-testid="presentation-beat-primary"]');
    await expect(primary).toBeVisible();
    // Wait out the entrance spring (initial scale 0.85 → 1) before measuring.
    await expect
      .poll(async () => Math.round((await primary.boundingBox())?.width ?? 0), {
        timeout: 3000,
        message: 'played reveal settles at inspect width (330)',
      })
      .toBe(330);
    // Wait for the beat to expire before the next scenario.
    await expect(primary).toBeHidden({ timeout: 5000 });

    // 4 — combat beat: append ATTACK_DECLARED + DAMAGE_RESOLVED.
    await page.evaluate(() => {
      const w = window as unknown as {
        __store?: { getState: () => { state: HarnessState }; setState: (p: Record<string, unknown>) => void };
      };
      const s = w.__store!.getState().state;
      const att = s.players.A.leader.instanceId;
      const tgt = s.players.B.leader.instanceId;
      s.history = [
        ...s.history,
        { type: 'ATTACK_DECLARED', attackerInstanceId: att, targetInstanceId: tgt, controller: 'A' },
        { type: 'DAMAGE_RESOLVED', attackerPower: 6000, targetPower: 5000, counterBoost: 0 },
      ];
      w.__store!.setState({ state: { ...s } });
    });

    const beat = page.locator('[data-testid="presentation-beat"][data-beat-kind="COMBAT_RESULT"]');
    await expect(beat).toBeVisible();
    const a = await page.locator('[data-testid="presentation-beat-primary"]').boundingBox();
    const t = await page.locator('[data-testid="presentation-beat-secondary"]').boundingBox();
    expect(a, 'attacker card rendered').not.toBeNull();
    expect(t, 'target card rendered').not.toBeNull();
    // Attacker strictly LEFT of target, no horizontal overlap.
    expect(a!.x + a!.width, 'no overlap: attacker right edge < target left edge').toBeLessThanOrEqual(t!.x + 1);
    // Both fully inside the viewport.
    const vw = await page.evaluate(() => window.innerWidth);
    expect(a!.x).toBeGreaterThanOrEqual(0);
    expect(t!.x + t!.width).toBeLessThanOrEqual(vw + 1);
    // Power math + result text visible.
    await expect(page.locator('[data-testid="presentation-beat-attacker-power"]')).toBeVisible();
    await expect(page.locator('[data-testid="presentation-beat-target-power"]')).toBeVisible();
  });

  test('6. COST AREA wordmark centered identically on both halves', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    await bootstrap(page);
    // Empty both cost areas so the wordmark renders on both halves.
    await page.evaluate(() => {
      const w = window as unknown as {
        __store?: { getState: () => { state: HarnessState }; setState: (p: Record<string, unknown>) => void };
      };
      const s = w.__store!.getState().state;
      for (const pid of ['A', 'B']) {
        s.players[pid].donDeck = [...s.players[pid].donDeck, ...s.players[pid].donCostArea, ...s.players[pid].donRested];
        s.players[pid].donCostArea = [];
        s.players[pid].donRested = [];
      }
      w.__store!.setState({ state: { ...s } });
    });

    for (const pid of ['A', 'B']) {
      const band = page.locator(`[data-zone="costArea:${pid}"]`);
      const label = page.locator(`[data-cost-area-label="${pid}"] .playmat-zone__label`);
      await expect(label).toBeVisible();
      const bandBox = await band.boundingBox();
      const labelBox = await label.boundingBox();
      const bandCx = bandBox!.x + bandBox!.width / 2;
      const labelCx = labelBox!.x + labelBox!.width / 2;
      const bandCy = bandBox!.y + bandBox!.height / 2;
      const labelCy = labelBox!.y + labelBox!.height / 2;
      expect(Math.abs(bandCx - labelCx), `costArea:${pid} label horizontally centered`).toBeLessThanOrEqual(3);
      expect(Math.abs(bandCy - labelCy), `costArea:${pid} label vertically centered`).toBeLessThanOrEqual(3);
    }
  });
});
