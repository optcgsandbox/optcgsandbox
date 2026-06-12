/**
 * F-8D addendum — optionality (Use Effect / Skip), opponent hand fan,
 * header compression, combat refinement. Evidence screenshots land in
 * test-results/f8d-evidence/*.png. All seeded cards are synthetic.
 */

import { test, expect, type Page } from '@playwright/test';

const TWO_MIN = 120_000;
const EVIDENCE = 'test-results/f8d-evidence';

test.use({
  launchOptions: { args: ['--disable-web-security'] },
});

interface HarnessPlayer {
  hand: string[];
  field: Array<Record<string, unknown>>;
  leader: { instanceId: string };
  life: string[];
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

/** Seed a synthetic OPTIONAL-COSTED event ("You may trash 1: draw 1") in A's
 *  hand + fodder so cost/draw are satisfiable. */
let seedSeq = 0;
async function seedOptionalCosted(page: Page): Promise<string> {
  seedSeq += 1;
  return page.evaluate((seq) => {
    const w = window as unknown as {
      __store?: { getState: () => { state: HarnessState }; setState: (x: { state: Record<string, unknown> }) => void };
    };
    const s = w.__store!.getState().state;
    s.cardLibrary['F8DA_OPT'] = {
      id: 'F8DA_OPT', name: 'F8DA Optional', kind: 'event', colors: ['red'],
      cost: 1, power: null, counterValue: null, traits: [], keywords: [], effectTags: [],
      effectSpecV2: {
        schemaVersion: 2,
        clauses: [
          { trigger: 'on_play', cost: { discardHand: 1 }, action: { kind: 'draw', magnitude: 1 }, verified: 'human-reviewed' },
        ],
        continuous: [], replacements: [],
      },
    };
    s.cardLibrary['F8DA_VAN'] = {
      id: 'F8DA_VAN', name: 'F8DA Vanilla', kind: 'character', colors: ['red'],
      cost: 2, power: 3000, counterValue: 1000, traits: [], keywords: [], effectTags: [],
    };
    const ev = `f8da_opt_${seq}`;
    s.instances[ev] = {
      instanceId: ev, cardId: 'F8DA_OPT', controller: 'A', rested: false,
      summoningSick: false, attachedDon: [], attachedDonRested: [],
      perTurn: { hasAttacked: false, effectsUsed: [] },
    };
    s.players.A.hand = [...s.players.A.hand, ev];
    for (let i = 0; i < 2; i += 1) {
      const iid = `f8da_van_${seq}_${i}`;
      s.instances[iid] = {
        instanceId: iid, cardId: 'F8DA_VAN', controller: 'A', rested: false,
        summoningSick: false, attachedDon: [], attachedDonRested: [],
        perTurn: { hasAttacked: false, effectsUsed: [] },
      };
      if (i === 0) s.players.A.hand = [...s.players.A.hand, iid];
      else s.players.A.deck = [iid, ...s.players.A.deck];
    }
    // ensure 1 DON for the play cost
    const z = s.players.A;
    while (z.donCostArea.length < 1 && z.donDeck.length > 0) {
      const id = z.donDeck.shift();
      if (id !== undefined) z.donCostArea.push(id);
    }
    w.__store!.setState({ state: { ...s } });
    return ev;
  }, seedSeq);
}

test.describe('F-8D addendum — optionality UI', () => {
  test('SKIP pays nothing; USE EFFECT pays once and resolves', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    await bootstrap(page);
    const ev1 = await seedOptionalCosted(page);

    await dispatch(page, { type: 'PLAY_CARD', instanceId: ev1, replaceTargetId: null });
    const offer = page.locator('[data-pending-kind="effect_offer"]');
    await expect(offer, '"Use effect?" prompt opens before any cost is paid').toBeVisible();
    await page.screenshot({ path: `${EVIDENCE}/effect-offer-open.png` });

    const trashBeforeSkip = await page.evaluate(() => {
      const w = window as unknown as { __store?: { getState: () => { state: HarnessState } } };
      // trash includes the played event itself
      return w.__store!.getState().state.players.A.trash.length;
    });
    await page.locator('[data-effect-offer-skip]').click();
    await expect(offer).toBeHidden();
    const afterSkip = await page.evaluate(() => {
      const w = window as unknown as { __store?: { getState: () => { state: HarnessState } } };
      const s = w.__store!.getState().state;
      return {
        trash: s.players.A.trash.length,
        declined: s.history.filter((e) => e.type === 'EFFECT_DECLINED').length,
      };
    });
    expect(afterSkip.trash, 'skip paid NOTHING (trash unchanged)').toBe(trashBeforeSkip);
    expect(afterSkip.declined).toBe(1);

    // Round 2 — accept.
    const ev2 = await seedOptionalCosted(page);
    const handBefore = await page.evaluate(() => {
      const w = window as unknown as { __store?: { getState: () => { state: HarnessState } } };
      return w.__store!.getState().state.players.A.hand.length;
    });
    await dispatch(page, { type: 'PLAY_CARD', instanceId: ev2, replaceTargetId: null });
    await expect(offer).toBeVisible();
    await page.locator('[data-effect-offer-accept]').click();
    await expect(offer).toBeHidden();
    // F-8D cost picker — discardHand is a PLAYER-CHOICE payment: accepting
    // the offer opens the payment picker (no silent auto-pick). Pick 1.
    const costPicker = page.locator('[data-pending-kind="attack_target_pick"][data-cost-pick]');
    await expect(costPicker, 'payment picker opens on Use Effect').toBeVisible();
    await costPicker.locator('[data-target-card]').first().click();
    await page.locator('[data-target-confirm]').click();
    await expect(costPicker).toBeHidden();
    const afterUse = await page.evaluate(() => {
      const w = window as unknown as { __store?: { getState: () => { state: HarnessState } } };
      const s = w.__store!.getState().state;
      return { hand: s.players.A.hand.length, trash: s.players.A.trash.length };
    });
    // hand: −1 played event, −1 cost, +1 draw = −1 net vs before-play.
    expect(afterUse.hand, 'use-effect: cost paid + draw resolved').toBe(handBefore - 1);
    expect(afterUse.trash, 'cost card + event in trash').toBe(afterSkip.trash + 2);
  });
});

test.describe('F-8D addendum — opponent hand fan', () => {
  test('SAME HandFan system, face-down, exact count, no identity leak, no chip', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    await bootstrap(page);
    const fan = page.locator('[data-hand-fan][data-hidden]');
    await expect(fan).toBeVisible();
    const count0 = await page.evaluate(() => {
      const w = window as unknown as { __store?: { getState: () => { state: HarnessState } } };
      return w.__store!.getState().state.players.B.hand.length;
    });
    await expect(fan).toHaveAttribute('data-hand-count', String(count0));

    // Simulated opp DRAW → fan count +1 (same state path as search /
    // life-to-hand / bounce-to-hand).
    await page.evaluate(() => {
      const w = window as unknown as {
        __store?: { getState: () => { state: HarnessState }; setState: (x: { state: Record<string, unknown> }) => void };
      };
      const s = w.__store!.getState().state;
      const top = s.players.B.deck.shift();
      if (top !== undefined) s.players.B.hand = [...s.players.B.hand, top];
      w.__store!.setState({ state: { ...s } });
    });
    await expect(fan).toHaveAttribute('data-hand-count', String(count0 + 1));

    // Simulated opp PLAY → fan count −1.
    await page.evaluate(() => {
      const w = window as unknown as {
        __store?: { getState: () => { state: HarnessState }; setState: (x: { state: Record<string, unknown> }) => void };
      };
      const s = w.__store!.getState().state;
      const first = s.players.B.hand[0];
      if (first !== undefined) {
        s.players.B.hand = s.players.B.hand.slice(1);
        s.players.B.trash = [...s.players.B.trash, first];
      }
      w.__store!.setState({ state: { ...s } });
    });
    await expect(fan).toHaveAttribute('data-hand-count', String(count0));

    // No identity leak + no count CHIP (owner: fan only).
    const leak = await page.evaluate(() => {
      const fanEl = document.querySelector('[data-hand-fan][data-hidden]');
      if (!fanEl) return 'fan missing';
      if (fanEl.querySelector('[data-card-id]')) return 'data-card-id leaked';
      if (fanEl.querySelector('[data-instance-id]')) return 'data-instance-id leaked';
      const w = window as unknown as { __store?: { getState: () => { state: HarnessState } } };
      const s = w.__store!.getState().state;
      const names = s.players.B.hand
        .map((iid) => {
          const inst = s.instances[iid] as { cardId?: string } | undefined;
          const card = inst?.cardId ? (s.cardLibrary[inst.cardId] as { name?: string } | undefined) : undefined;
          return card?.name ?? '';
        })
        .filter((n) => n.length > 0);
      const text = fanEl.textContent ?? '';
      for (const n of names) {
        if (text.includes(n)) return `name leaked: ${n}`;
      }
      // Owner rule (reaffirmed 2026-06-12): NO count badge/chip on the fan.
      if (/\d/.test(text)) return 'count chip text present';
      if (fanEl.querySelector('[data-opp-hand-badge]')) return 'badge present';
      return 'clean';
    });
    expect(leak).toBe('clean');
    // Same card count rendered as backs as the real hand size.
    const backs = await fan.locator('[data-flip-back]').count();
    expect(backs).toBe(count0);
    await page.screenshot({ path: `${EVIDENCE}/opp-hand-fan.png` });
  });
});

test.describe('F-8D addendum — header compression', () => {
  test('compact header (≤40px content), hamburger holds difficulty/reset/theme, gameplay stays out', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    await bootstrap(page);
    const header = page.locator('[data-testid="app-header"]');
    await expect(header).toBeVisible();
    const box = await header.boundingBox();
    expect(box!.height, 'header is compact (was ~52px two-row toolbar)').toBeLessThanOrEqual(40);

    const menuBtn = page.locator('[data-testid="header-menu-button"]');
    await menuBtn.click();
    const menu = page.locator('[data-testid="header-menu"]');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('button', { name: /easy/i })).toBeVisible();
    await expect(menu.getByRole('button', { name: /reset game/i })).toBeVisible();
    await expect(menu.getByRole('button', { name: /theme/i })).toBeVisible();
    // Gameplay controls are NOT in the menu.
    await expect(menu.getByRole('button', { name: /end turn/i })).toHaveCount(0);
    await page.screenshot({ path: `${EVIDENCE}/header-hamburger.png` });
    await menuBtn.click();
    await expect(menu).toBeHidden();
  });
});

test.describe('F-8D addendum — combat refinement', () => {
  // The project default viewport is 430×932 (phone shell); the size
  // refinement is asserted at an explicit desktop viewport.
  test.use({ viewport: { width: 1280, height: 720 } });
  test('duel cards fill the 430px app shell (≥150px) with no overlap / no overflow', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    await bootstrap(page);
    await page.evaluate(() => {
      const w = window as unknown as {
        __store?: { getState: () => { state: HarnessState }; setState: (x: { state: Record<string, unknown> }) => void };
      };
      const s = w.__store!.getState().state;
      const att = s.players.A.leader.instanceId;
      const tgt = s.players.B.leader.instanceId;
      s.history = [
        ...s.history,
        { type: 'ATTACK_DECLARED', attackerInstanceId: att, targetInstanceId: tgt, controller: 'A' },
        { type: 'DAMAGE_RESOLVED', attackerPower: 7000, targetPower: 5000, counterBoost: 1000 },
      ];
      w.__store!.setState({ state: { ...s } });
    });
    const beat = page.locator('[data-testid="presentation-beat"][data-beat-kind="COMBAT_RESULT"]');
    await expect(beat).toBeVisible();
    // Poll until the entrance spring settles. Original board geometry: the
    // duel renders inside the 430px app shell — assert raw CSS px.
    await expect
      .poll(async () => (await page.locator('[data-testid="presentation-beat-primary"]').boundingBox())?.width ?? 0, {
        timeout: 3000,
        message: 'premium duel size (≥150px wide cards in the 430px shell)',
      })
      .toBeGreaterThanOrEqual(150);
    const a = await page.locator('[data-testid="presentation-beat-primary"]').boundingBox();
    const t = await page.locator('[data-testid="presentation-beat-secondary"]').boundingBox();
    expect(a!.x + a!.width).toBeLessThanOrEqual(t!.x + 1); // no overlap
    const vw = await page.evaluate(() => window.innerWidth);
    expect(t!.x + t!.width).toBeLessThanOrEqual(vw + 1); // no overflow
    await page.screenshot({ path: `${EVIDENCE}/combat-duel-refined.png` });
  });
});
