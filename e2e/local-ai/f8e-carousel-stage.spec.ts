/**
 * F-8E — inspect carousel + stage functionality + mobile header.
 * Owner addendum 2026-06-12. Synthetic cards only (no production hardcoding).
 * Evidence → test-results/f8d-evidence/.
 */

import { test, expect, type Page } from '@playwright/test';

const TWO_MIN = 120_000;
const EVIDENCE = 'test-results/f8d-evidence';

test.use({ launchOptions: { args: ['--disable-web-security'] } });

interface HarnessState {
  phase: string;
  players: Record<string, {
    hand: string[]; deck: string[]; trash: string[];
    donCostArea: string[]; donDeck: string[];
    stage: { instanceId: string } | null;
  }>;
  instances: Record<string, unknown>;
  cardLibrary: Record<string, unknown>;
}

async function bootstrap(page: Page): Promise<void> {
  await page.goto('/?test=1');
  await page.waitForFunction(() => Boolean((window as unknown as { __store?: unknown }).__store), undefined, { timeout: 15_000 });
  for (let i = 0; i < 10; i += 1) {
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
  try { await goFirst.waitFor({ state: 'visible', timeout: 4_000 }); await goFirst.click(); } catch { /* auto */ }
  const keep = page.getByRole('button', { name: /^keep$/i }).first();
  try { await keep.waitFor({ state: 'visible', timeout: 8_000 }); await keep.click(); } catch { /* fast */ }
  await page.waitForFunction(() => {
    const w = window as unknown as { __store?: { getState: () => { state: { phase: string; activePlayer: string } } } };
    const s = w.__store?.getState().state;
    return s?.phase === 'main' && s?.activePlayer === 'A';
  }, undefined, { timeout: 30_000 });
}

test.describe('F-8E — inspect carousel', () => {
  test('hand: arrows + counter + ArrowRight navigate; board single card: NO arrows', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    await bootstrap(page);

    // Open the first hand card via the fan.
    await page.locator('[data-hand-fan]:not([data-hidden]) button').first().click();
    const modal = page.locator('[role="dialog"][aria-labelledby="card-detail-name"]');
    await expect(modal).toBeVisible();
    const handCount = await page.evaluate(() => {
      const w = window as unknown as { __store?: { getState: () => { state: HarnessState } } };
      return w.__store!.getState().state.players.A.hand.length;
    });
    await expect(page.locator('[data-carousel-counter]')).toHaveText(`1 / ${handCount}`);
    await page.locator('[data-carousel-next]').click();
    await expect(page.locator('[data-carousel-counter]')).toHaveText(`2 / ${handCount}`);
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('[data-carousel-counter]')).toHaveText(`3 / ${handCount}`);
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('[data-carousel-counter]')).toHaveText(`2 / ${handCount}`);
    await page.screenshot({ path: `${EVIDENCE}/carousel-hand.png` });
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();

    // Board single context: tap YOUR leader → no arrows.
    await page.evaluate(() => {
      const w = window as unknown as { __store?: { getState: () => { state: { players: Record<string, { leader: { instanceId: string } }> }; setInspectedCardId: (id: string) => void; setCardDetailOpen: (o: boolean) => void; setInspectGroup: (g: null) => void } } };
      const st = w.__store!.getState();
      st.setInspectGroup(null);
      st.setInspectedCardId(st.state.players.A.leader.instanceId);
      st.setCardDetailOpen(true);
    });
    await expect(modal).toBeVisible();
    await expect(page.locator('[data-carousel-next]')).toHaveCount(0);
    await page.keyboard.press('Escape');
  });

  test('mulligan: View carousel across the opening hand', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    await page.goto('/?test=1');
    await page.waitForFunction(() => Boolean((window as unknown as { __store?: unknown }).__store), undefined, { timeout: 15_000 });
    for (let i = 0; i < 10; i += 1) {
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
    const goFirst = page.getByRole('button', { name: /go first/i }).first();
    try { await goFirst.waitFor({ state: 'visible', timeout: 5_000 }); await goFirst.click(); } catch { /* auto */ }
    const card = page.locator('[data-mulligan-card]').first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();
    await expect(page.locator('[data-testid="card-inspect-overlay"]')).toBeVisible();
    await expect(page.locator('[data-carousel-counter]')).toHaveText('1 / 5');
    await page.locator('[data-carousel-next]').click();
    await expect(page.locator('[data-carousel-counter]')).toHaveText('2 / 5');
    await page.screenshot({ path: `${EVIDENCE}/carousel-mulligan.png` });
  });

  test('trash: carousel across the trash pile', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    await bootstrap(page);
    // Seed 3 trash cards from the deck top (zone move only).
    await page.evaluate(() => {
      const w = window as unknown as { __store?: { getState: () => { state: HarnessState }; setState: (x: { state: Record<string, unknown> }) => void } };
      const s = w.__store!.getState().state;
      for (let i = 0; i < 3; i += 1) {
        const id = s.players.A.deck.shift();
        if (id !== undefined) s.players.A.trash.push(id);
      }
      w.__store!.setState({ state: { ...s } });
    });
    // Open the trash viewer via YOUR trash slot.
    await page.locator('[data-zone="trash:A"]').click();
    const list = page.locator('[role="dialog"] [role="list"]');
    await expect(list).toBeVisible();
    // Tap the first card in the trash list (listitem wrapper handles it).
    await list.locator('[role="listitem"]').first().click();
    const modal = page.locator('[role="dialog"][aria-labelledby="card-detail-name"]');
    await expect(modal).toBeVisible();
    await expect(page.locator('[data-carousel-counter]')).toContainText('/ 3');
    await page.locator('[data-carousel-next]').click();
    await expect(page.locator('[data-carousel-counter]')).toContainText('2 / 3');
    await page.screenshot({ path: `${EVIDENCE}/carousel-trash.png` });
  });
});

test.describe('F-8E — stage cards', () => {
  test('play stage → tap on board opens inspect → ACTIVATE EFFECT resolves generically', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    await bootstrap(page);
    // Seed a synthetic stage with [Activate: Main] draw 1 + deck fodder.
    const stageIid = await page.evaluate(() => {
      const w = window as unknown as { __store?: { getState: () => { state: HarnessState }; setState: (x: { state: Record<string, unknown> }) => void } };
      const s = w.__store!.getState().state;
      s.cardLibrary['F8E_STAGE'] = {
        id: 'F8E_STAGE', name: 'F8E Harbor', kind: 'stage', colors: ['red'],
        cost: 1, power: null, counterValue: null, traits: [], keywords: ['activate_main'], effectTags: [],
        effectText: '[Activate: Main] Draw 1 card.',
        effectSpecV2: {
          schemaVersion: 2,
          clauses: [{ trigger: 'activate_main', action: { kind: 'draw', magnitude: 1 }, verified: 'human-reviewed' }],
          continuous: [], replacements: [],
        },
      };
      const iid = 'f8e_stage_1';
      s.instances[iid] = {
        instanceId: iid, cardId: 'F8E_STAGE', controller: 'A', rested: false,
        summoningSick: false, attachedDon: [], attachedDonRested: [],
        perTurn: { hasAttacked: false, effectsUsed: [] },
      };
      s.players.A.hand = [...s.players.A.hand, iid];
      const z = s.players.A;
      while (z.donCostArea.length < 2 && z.donDeck.length > 0) {
        const d = z.donDeck.shift();
        if (d !== undefined) z.donCostArea.push(d);
      }
      w.__store!.setState({ state: { ...s } });
      return iid;
    });
    await page.evaluate((iid) => {
      const w = window as unknown as { __store?: { getState: () => { dispatch: (a: unknown) => void } } };
      w.__store!.getState().dispatch({ type: 'PLAY_STAGE', instanceId: iid });
    }, stageIid);
    await expect.poll(async () => page.evaluate(() => {
      const w = window as unknown as { __store?: { getState: () => { state: HarnessState } } };
      return w.__store!.getState().state.players.A.stage?.instanceId ?? null;
    })).toBe(stageIid);

    // Tap the stage card on the board → CardDetailModal opens.
    await page.locator('[data-zone="stage:A"] button').first().click();
    const modal = page.locator('[role="dialog"][aria-labelledby="card-detail-name"]');
    await expect(modal, 'stage card opens inspect (was dead)').toBeVisible();
    // No carousel on a single stage card.
    await expect(page.locator('[data-carousel-next]')).toHaveCount(0);
    await page.screenshot({ path: `${EVIDENCE}/stage-inspect.png` });

    // Legal Activate Main surfaces + resolves (draw 1).
    const handBefore = await page.evaluate(() => {
      const w = window as unknown as { __store?: { getState: () => { state: HarnessState } } };
      return w.__store!.getState().state.players.A.hand.length;
    });
    const activate = page.getByRole('button', { name: /activate effect/i });
    await expect(activate, 'ACTIVATE EFFECT appears for legal stage ability').toBeVisible();
    await activate.click();
    await expect.poll(async () => page.evaluate(() => {
      const w = window as unknown as { __store?: { getState: () => { state: HarnessState } } };
      return w.__store!.getState().state.players.A.hand.length;
    }), { message: 'stage activate_main drew 1' }).toBe(handBefore + 1);
  });
});

test.describe('F-8E — mobile header', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('logo on top, short T·phase line, no truncation, clear of hamburger', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    await bootstrap(page);
    const header = page.locator('[data-testid="app-header"]');
    const h1 = header.locator('h1');
    await expect(h1).toBeVisible();
    const status = header.locator('p[role="status"]');
    // innerText respects CSS — the desktop-only span is display:none here.
    const text = await status.evaluate((el) => (el as HTMLElement).innerText);
    expect(text.trim(), 'short VISIBLE line only (turn + phase)').toMatch(/^T\d+ · \w+$/);
    // Status line never overlaps the hamburger button.
    const sBox = await status.boundingBox();
    const menuBox = await page.locator('[data-testid="header-menu-button"]').boundingBox();
    expect(sBox!.x + sBox!.width).toBeLessThanOrEqual(menuBox!.x);
    // Not visually truncated: rendered width fits its content box.
    const fits = await status.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
    expect(fits, 'no hidden/cut-off header text').toBe(true);
    await page.screenshot({ path: `${EVIDENCE}/mobile-header.png` });
  });
});
