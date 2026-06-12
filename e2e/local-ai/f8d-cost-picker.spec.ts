/**
 * F-8D — player-choice cost payments + printed effect text + offer-card
 * inspect. Owner-specified Gordon proof uses the REAL OP01-011 corpus entry
 * (read from shared/data/cards.json at test time — production code stays
 * 100% metadata-generic): "[On Play] You may place 1 card from your hand at
 * the bottom of your deck: Draw 1 card."
 *
 * Required flow: Use Effect → hand picker opens → must select exactly 1 →
 * selected card visibly bottoms → draw happens after. No silent resolution.
 * No auto-pick. No skipped payment. Evidence → test-results/f8d-evidence.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TWO_MIN = 120_000;
const EVIDENCE = 'test-results/f8d-evidence';

test.use({
  launchOptions: { args: ['--disable-web-security'] },
});

interface HarnessPlayer {
  hand: string[];
  field: Array<Record<string, unknown>>;
  leader: { instanceId: string };
  deck: string[];
  trash: string[];
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

const GORDON = (() => {
  const corpus = JSON.parse(
    readFileSync(join(__dirname, '../../shared/data/cards.json'), 'utf8'),
  ) as Array<{ id: string }>;
  const card = corpus.find((c) => c.id === 'OP01-011');
  if (!card) throw new Error('OP01-011 missing from corpus');
  return card;
})();

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

async function dispatch(page: Page, action: object): Promise<void> {
  await page.evaluate((a) => {
    const w = window as unknown as { __store?: { getState: () => { dispatch: (x: unknown) => void } } };
    w.__store!.getState().dispatch(a);
  }, action);
}

async function getA(page: Page): Promise<{ hand: string[]; deck: string[]; trash: string[] }> {
  return page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { state: HarnessState } } };
    const a = w.__store!.getState().state.players.A;
    return { hand: [...a.hand], deck: [...a.deck], trash: [...a.trash] };
  });
}

/** Seed the REAL Gordon + 3 vanilla hand cards + DON. Returns Gordon's iid. */
let seedSeq = 0;
async function seedGordon(page: Page): Promise<string> {
  seedSeq += 1;
  return page.evaluate(({ gordon, seq }) => {
    const w = window as unknown as {
      __store?: { getState: () => { state: HarnessState }; setState: (x: { state: Record<string, unknown> }) => void };
    };
    const s = w.__store!.getState().state;
    s.cardLibrary['OP01-011'] = gordon;
    s.cardLibrary['F8DCP_VAN'] = {
      id: 'F8DCP_VAN', name: 'F8DCP Vanilla', kind: 'character', colors: ['red'],
      cost: 2, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
    };
    const g = `f8dcp_gordon_${seq}`;
    s.instances[g] = {
      instanceId: g, cardId: 'OP01-011', controller: 'A', rested: false,
      summoningSick: false, attachedDon: [], attachedDonRested: [],
      perTurn: { hasAttacked: false, effectsUsed: [] },
    };
    s.players.A.hand = [...s.players.A.hand, g];
    for (let i = 0; i < 3; i += 1) {
      const iid = `f8dcp_van_${seq}_${i}`;
      s.instances[iid] = {
        instanceId: iid, cardId: 'F8DCP_VAN', controller: 'A', rested: false,
        summoningSick: false, attachedDon: [], attachedDonRested: [],
        perTurn: { hasAttacked: false, effectsUsed: [] },
      };
      if (i < 2) s.players.A.hand = [...s.players.A.hand, iid];
      else s.players.A.deck = [iid, ...s.players.A.deck];
    }
    const z = s.players.A;
    while (z.donCostArea.length < 6 && z.donDeck.length > 0) {
      const id = z.donDeck.shift();
      if (id !== undefined) z.donCostArea.push(id);
    }
    w.__store!.setState({ state: { ...s } });
    return g;
  }, { gordon: GORDON, seq: seedSeq });
}

test.describe('F-8D — Gordon proof (real OP01-011, printed text, cost picker)', () => {
  test('Use Effect → hand picker → exactly 1 → chosen card bottoms → draw after; printed text; inspectable offer card', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    await bootstrap(page);
    const gordon = await seedGordon(page);
    const before = await getA(page);

    await dispatch(page, { type: 'PLAY_CARD', instanceId: gordon, replaceTargetId: null });

    // ── 1. Offer opens; copy is the PRINTED card text, never internal keys.
    const offer = page.locator('[data-pending-kind="effect_offer"]');
    await expect(offer).toBeVisible();
    const printedLine = offer.locator('[data-effect-offer-text="printed"]');
    await expect(printedLine).toBeVisible();
    await expect(printedLine).toContainText('place 1 card from your hand at the bottom of your deck');
    const offerText = (await offer.textContent()) ?? '';
    expect(offerText.includes('bottomOfDeckFromHand'), 'no internal keys in prompt copy').toBe(false);
    await page.screenshot({ path: `${EVIDENCE}/gordon-1-offer-printed-text.png` });

    // ── 2. The offer card is inspectable (shared CardInspectOverlay).
    await page.locator('[data-effect-offer-view]').click();
    const inspect = page.locator('[data-testid="card-inspect-overlay"]');
    await expect(inspect).toBeVisible();
    await page.screenshot({ path: `${EVIDENCE}/gordon-2-offer-card-inspect.png` });
    await page.keyboard.press('Escape');
    await expect(inspect).toBeHidden();

    // ── 3. Use Effect → the COST PICKER opens; nothing paid yet.
    await page.locator('[data-effect-offer-accept]').click();
    const picker = page.locator('[data-pending-kind="attack_target_pick"][data-cost-pick]');
    await expect(picker, 'hand picker opens for the payment').toBeVisible();
    await expect(picker.getByRole('heading', { name: /pay the cost/i })).toBeVisible();
    const midPick = await getA(page);
    expect(midPick.hand.length, 'NOTHING auto-paid while the picker is open')
      .toBe(before.hand.length - 1); // only Gordon left the hand (played)
    expect(midPick.deck.length, 'deck untouched before the pick').toBe(before.deck.length);

    // ── 4. Exact count: cannot confirm empty; no choose-none offered.
    const confirmBtn = page.locator('[data-target-confirm]');
    await expect(confirmBtn, 'cannot confirm an empty payment').toBeDisabled();
    await expect(page.locator('[data-target-choose-none]')).toHaveCount(0);
    await page.screenshot({ path: `${EVIDENCE}/gordon-3-cost-picker-open.png` });

    // ── 5. Pick a SPECIFIC card (not the hand head) and confirm.
    const chosen = midPick.hand[midPick.hand.length - 1]!;
    await picker.locator(`[data-target-card="${chosen}"]`).click();
    await expect(confirmBtn).toBeEnabled();
    await page.screenshot({ path: `${EVIDENCE}/gordon-4-cost-picker-selected.png` });
    await confirmBtn.click();
    await expect(picker).toBeHidden();

    // ── 6. EXACTLY the chosen card is at the deck BOTTOM; draw resolved.
    const after = await getA(page);
    expect(after.hand.includes(chosen), 'chosen card left the hand').toBe(false);
    expect(after.deck[after.deck.length - 1], 'chosen card is at the deck BOTTOM').toBe(chosen);
    // deck: −1 draw +1 payment = unchanged; hand: −1 Gordon −1 payment +1 draw = −1.
    expect(after.deck.length).toBe(before.deck.length);
    expect(after.hand.length).toBe(before.hand.length - 1);
    const drawnFromTop = before.deck[0]!;
    expect(after.hand.includes(drawnFromTop), 'draw 1 resolved AFTER payment').toBe(true);
    await page.screenshot({ path: `${EVIDENCE}/gordon-5-resolved.png` });
  });

  test('Skip pays nothing — hand and deck untouched (cost picker never opens)', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    await bootstrap(page);
    const gordon = await seedGordon(page);
    const before = await getA(page);
    await dispatch(page, { type: 'PLAY_CARD', instanceId: gordon, replaceTargetId: null });
    const offer = page.locator('[data-pending-kind="effect_offer"]');
    await expect(offer).toBeVisible();
    await page.locator('[data-effect-offer-skip]').click();
    await expect(offer).toBeHidden();
    await expect(page.locator('[data-pending-kind="attack_target_pick"]')).toHaveCount(0);
    const after = await getA(page);
    expect(after.hand.length, 'only Gordon left the hand').toBe(before.hand.length - 1);
    expect(after.deck.length, 'no payment, no draw').toBe(before.deck.length);
  });
});

test.describe('F-8D — inspect-everywhere (decision prompts)', () => {
  test('mulligan cards open the shared inspect overlay', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    await page.goto('/?test=1');
    await page.waitForFunction(
      () => Boolean((window as unknown as { __store?: unknown }).__store),
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
    const mulliganCard = page.locator('[data-mulligan-card]').first();
    await expect(mulliganCard).toBeVisible({ timeout: 10_000 });
    await mulliganCard.click();
    const inspect = page.locator('[data-testid="card-inspect-overlay"]');
    await expect(inspect, 'opening-hand card inspects at full size').toBeVisible();
    await page.screenshot({ path: `${EVIDENCE}/inspect-mulligan.png` });
  });
});
