/**
 * F-8D — generic target picker + AI reactive + combat layout proof.
 *
 * Evidence screenshots land in test-results/f8d-evidence/*.png.
 * Otama (OP01-006) is referenced ONLY as test data — production logic is
 * fully metadata-driven (see target-picker-f8d.test.ts for the synthetic
 * engine proof).
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

/** Seed a synthetic character instance into the given zone for `pid`. */
async function seedChar(
  page: Page,
  pid: 'A' | 'B',
  zone: 'field' | 'hand',
  def: { id: string; power?: number; cost?: number; counterValue?: number; keywords?: string[] },
): Promise<string> {
  return page.evaluate(({ pid: p, zone: z, def: d }) => {
    const w = window as unknown as {
      __store?: { getState: () => { state: HarnessState }; setState: (x: { state: Record<string, unknown> }) => void };
    };
    const s = w.__store!.getState().state;
    s.cardLibrary[d.id] = {
      id: d.id, name: d.id, kind: 'character', colors: ['red'],
      cost: d.cost ?? 3, power: d.power ?? 4000, counterValue: d.counterValue ?? 1000,
      traits: [], keywords: d.keywords ?? [], effectTags: [],
    };
    const iid = `f8d_${d.id}_${z}`;
    const inst = {
      instanceId: iid, cardId: d.id, controller: p, rested: false,
      summoningSick: false, attachedDon: [], attachedDonRested: [],
      perTurn: { hasAttacked: false, effectsUsed: [] },
    };
    s.instances[iid] = inst;
    if (z === 'field') s.players[p].field = [...s.players[p].field, inst];
    else s.players[p].hand = [...s.players[p].hand, iid];
    w.__store!.setState({ state: { ...s } });
    return iid;
  }, { pid, zone, def });
}

async function seedCorpusInHand(page: Page, cardId: string): Promise<string> {
  return page.evaluate(async (cid) => {
    const w = window as unknown as {
      __store?: { getState: () => { state: HarnessState }; setState: (x: { state: Record<string, unknown> }) => void };
    };
    const s = w.__store!.getState().state;
    if (!s.cardLibrary[cid]) throw new Error(`${cid} not in library (bundled corpus expected)`);
    const iid = `f8d_corpus_${cid}`;
    s.instances[iid] = {
      instanceId: iid, cardId: cid, controller: 'A', rested: false,
      summoningSick: false, attachedDon: [], attachedDonRested: [],
      perTurn: { hasAttacked: false, effectsUsed: [] },
    };
    s.players.A.hand = [...s.players.A.hand, iid];
    w.__store!.setState({ state: { ...s } });
    return iid;
  }, cardId);
}

async function topUpDon(page: Page, pid: 'A' | 'B', target: number): Promise<void> {
  await page.evaluate(({ pid: p, target: t }) => {
    const w = window as unknown as {
      __store?: { getState: () => { state: HarnessState }; setState: (x: { state: Record<string, unknown> }) => void };
    };
    const s = w.__store!.getState().state;
    const z = s.players[p];
    while (z.donCostArea.length < t && z.donDeck.length > 0) {
      const id = z.donDeck.shift();
      if (id !== undefined) z.donCostArea.push(id);
    }
    w.__store!.setState({ state: { ...s } });
  }, { pid, target });
}

async function dispatch(page: Page, action: object): Promise<void> {
  await page.evaluate((a) => {
    const w = window as unknown as { __store?: { getState: () => { dispatch: (x: unknown) => void } } };
    w.__store!.getState().dispatch(a);
  }, action);
}

test.describe('F-8D — generic target picker', () => {
  test('OTAMA PROOF (OP01-006): picker opens, BOTH opp chars offered, player picks the SECOND, −2000 applies to IT only', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    await bootstrap(page);
    const o1 = await seedChar(page, 'B', 'field', { id: 'F8D_OPP1', power: 4000 });
    const o2 = await seedChar(page, 'B', 'field', { id: 'F8D_OPP2', power: 4000 });
    const otama = await seedCorpusInHand(page, 'OP01-006');
    await topUpDon(page, 'A', 2);

    await dispatch(page, { type: 'PLAY_CARD', instanceId: otama, replaceTargetId: null });

    const prompt = page.locator('[data-pending-kind="attack_target_pick"]');
    await expect(prompt, 'target picker opens — effect no longer silent').toBeVisible();
    await expect(page.locator(`[data-target-card="${o1}"]`)).toBeVisible();
    await expect(page.locator(`[data-target-card="${o2}"]`)).toBeVisible();
    await page.screenshot({ path: `${EVIDENCE}/otama-picker-open.png` });

    await page.locator(`[data-target-card="${o2}"]`).click();
    await expect(page.locator(`[data-target-card="${o2}"]`)).toHaveAttribute('data-target-selected', 'true');
    await page.locator('[data-target-confirm]').click();
    await expect(prompt).toBeHidden();

    const powers = await page.evaluate(({ a, b }) => {
      const w = window as unknown as {
        __store?: { getState: () => { state: HarnessState } };
        __effectivePower?: unknown;
      };
      const s = w.__store!.getState().state;
      const read = (iid: string): number => {
        const i = s.instances[iid] as { powerModifierOneShot?: number } | undefined;
        return 4000 + (i?.powerModifierOneShot ?? 0);
      };
      return { first: read(a), second: read(b), pending: (s.pending as { kind?: string } | null)?.kind ?? null };
    }, { a: o1, b: o2 });
    expect(powers.second, 'picked char debuffed to 2000').toBe(2000);
    expect(powers.first, 'other char untouched').toBe(4000);
    expect(powers.pending).toBeNull();
    await page.screenshot({ path: `${EVIDENCE}/otama-after-confirm.png` });
  });

  test('CHOOSE NONE + give_power family + View inspect size', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    await bootstrap(page);
    // Synthetic give_power (+2000 to up to 1 of YOUR characters) — proves the
    // picker generalizes across families via metadata alone.
    const mine = await seedChar(page, 'A', 'field', { id: 'F8D_MINE', power: 3000 });
    await page.evaluate(() => {
      const w = window as unknown as {
        __store?: { getState: () => { state: HarnessState }; setState: (x: { state: Record<string, unknown> }) => void };
      };
      const s = w.__store!.getState().state;
      s.cardLibrary['F8D_BUFF_EV'] = {
        id: 'F8D_BUFF_EV', name: 'F8D Buff Event', kind: 'event', colors: ['red'],
        cost: 1, power: null, counterValue: null, traits: [], keywords: [], effectTags: [],
        effectSpecV2: {
          schemaVersion: 2,
          clauses: [{
            trigger: 'on_play',
            action: { kind: 'power_buff', magnitude: 2000, duration: 'this_turn' },
            target: { kind: 'your_character' },
            verified: 'human-reviewed',
          }],
          continuous: [], replacements: [],
        },
      };
      const iid = 'f8d_buffev';
      s.instances[iid] = {
        instanceId: iid, cardId: 'F8D_BUFF_EV', controller: 'A', rested: false,
        summoningSick: false, attachedDon: [], attachedDonRested: [],
        perTurn: { hasAttacked: false, effectsUsed: [] },
      };
      s.players.A.hand = [...s.players.A.hand, iid];
      w.__store!.setState({ state: { ...s } });
    });
    await topUpDon(page, 'A', 2);
    await dispatch(page, { type: 'PLAY_CARD', instanceId: 'f8d_buffev', replaceTargetId: null });

    const prompt = page.locator('[data-pending-kind="attack_target_pick"]');
    await expect(prompt).toBeVisible();
    // View → shared inspect overlay at the canonical size.
    await page.locator(`[data-target-view="${mine}"]`).click();
    const inspect = page.locator('[data-testid="card-inspect-card"] [data-flip-back]').first();
    await expect(inspect).toBeVisible();
    await page.waitForTimeout(400);
    const box = await inspect.boundingBox();
    expect(Math.round(box!.width), 'View opens the canonical 330px inspect').toBe(330);
    await page.screenshot({ path: `${EVIDENCE}/picker-view-inspect.png` });
    await page.locator('[data-testid="card-inspect-overlay"]').click();

    // Choose none → effect resolves with nothing applied.
    await page.locator('[data-target-choose-none]').click();
    await expect(prompt).toBeHidden();
    const mod = await page.evaluate((iid) => {
      const w = window as unknown as { __store?: { getState: () => { state: HarnessState } } };
      const i = w.__store!.getState().state.instances[iid] as { powerModifierOneShot?: number };
      return i?.powerModifierOneShot ?? 0;
    }, mine);
    expect(mod, 'choose none → no buff applied').toBe(0);
  });

  test('NO VALID TARGET: effect emits clear state, no picker, no stall', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    await bootstrap(page);
    // Opp board empty → debuff event has zero candidates.
    const otama = await seedCorpusInHand(page, 'OP01-006');
    await topUpDon(page, 'A', 2);
    await dispatch(page, { type: 'PLAY_CARD', instanceId: otama, replaceTargetId: null });
    const res = await page.evaluate(() => {
      const w = window as unknown as { __store?: { getState: () => { state: HarnessState } } };
      const s = w.__store!.getState().state;
      return {
        pending: (s.pending as { kind?: string } | null)?.kind ?? null,
        nvt: s.history.filter((e) => e.type === 'NO_VALID_TARGET').length,
        phase: s.phase,
      };
    });
    expect(res.pending).toBeNull();
    expect(res.nvt, 'NO_VALID_TARGET emitted').toBeGreaterThan(0);
    expect(res.phase).toBe('main');
  });
});

test.describe('F-8D — AI reactive proof', () => {
  test('AI BLOCKS: surviving blocker intercepts the human attack', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    await bootstrap(page);
    // B gets a 6000-power blocker; A's 5000 leader attacks B's leader.
    const blocker = await seedChar(page, 'B', 'field', { id: 'F8D_BLOCKER', power: 6000, keywords: ['blocker'] });
    const ids = await page.evaluate(() => {
      const w = window as unknown as { __store?: { getState: () => { state: HarnessState } } };
      const s = w.__store!.getState().state;
      return { aLeader: s.players.A.leader.instanceId, bLeader: s.players.B.leader.instanceId };
    });
    await dispatch(page, { type: 'DECLARE_ATTACK', attackerInstanceId: ids.aLeader, targetInstanceId: ids.bLeader });
    await page.waitForTimeout(500);
    const after = await page.evaluate((blk) => {
      const w = window as unknown as { __store?: { getState: () => { state: HarnessState } } };
      const s = w.__store!.getState().state;
      const blkInst = s.instances[blk] as { rested?: boolean };
      const pa = (s.pending as { kind?: string; pendingAttack?: { targetInstanceId?: string } } | null);
      return {
        blockerRested: blkInst?.rested === true,
        redirected: pa?.pendingAttack?.targetInstanceId === blk,
        pendingKind: pa?.kind ?? null,
        phase: s.phase,
      };
    }, blocker);
    expect(after.blockerRested, 'AI declared the blocker (rested)').toBe(true);
    await page.screenshot({ path: `${EVIDENCE}/ai-blocked.png` });
  });

  test('AI COUNTERS: low-life AI spends a counter to survive a lethal-leader hit', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    await bootstrap(page);
    // B at 2 life, no blockers; B holds a +2000 counter char; A leader gets
    // +2000 (7000) vs B leader 5000 → deficit 2000, need 3000?? need=2000+1000.
    await seedChar(page, 'B', 'hand', { id: 'F8D_CTR3000', power: 2000, counterValue: 3000 });
    await page.evaluate(() => {
      const w = window as unknown as {
        __store?: { getState: () => { state: HarnessState }; setState: (x: { state: Record<string, unknown> }) => void };
      };
      const s = w.__store!.getState().state;
      s.players.B.life = s.players.B.life.slice(0, 2); // low life
      const aLeader = s.instances[s.players.A.leader.instanceId] as { powerModifierOneShot?: number };
      aLeader.powerModifierOneShot = (aLeader.powerModifierOneShot ?? 0) + 2000; // 7000 attacker
      w.__store!.setState({ state: { ...s } });
    });
    const ids = await page.evaluate(() => {
      const w = window as unknown as { __store?: { getState: () => { state: HarnessState } } };
      const s = w.__store!.getState().state;
      return { aLeader: s.players.A.leader.instanceId, bLeader: s.players.B.leader.instanceId };
    });
    await dispatch(page, { type: 'DECLARE_ATTACK', attackerInstanceId: ids.aLeader, targetInstanceId: ids.bLeader });
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => {
      const w = window as unknown as { __store?: { getState: () => { state: HarnessState } } };
      const s = w.__store!.getState().state;
      return {
        counterPlayed: s.history.filter((e) => e.type === 'COUNTER_PLAYED').length,
        lifeAfter: s.players.B.life.length,
      };
    });
    expect(after.counterPlayed, 'AI played a counter (COUNTER_PLAYED in history)').toBeGreaterThan(0);
    expect(after.lifeAfter, 'AI survived — no life lost').toBe(2);
    await page.screenshot({ path: `${EVIDENCE}/ai-countered.png` });
  });
});

for (const vp of [
  { name: 'desktop', width: 1280, height: 720 },
  { name: 'phone', width: 390, height: 844 },
]) {
  test.describe(`F-8D — combat head-to-head + no-scroll @ ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test(`combat duel layout fits ${vp.name} (${vp.width}×${vp.height})`, async ({ page }) => {
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
      await page.waitForTimeout(450); // entrance spring settles
      const a = await page.locator('[data-testid="presentation-beat-primary"]').boundingBox();
      const t = await page.locator('[data-testid="presentation-beat-secondary"]').boundingBox();
      expect(a).not.toBeNull();
      expect(t).not.toBeNull();
      // Head-to-head: attacker strictly LEFT, no overlap, both in viewport.
      expect(a!.x + a!.width, 'no overlap').toBeLessThanOrEqual(t!.x + 1);
      expect(a!.x, 'attacker inside left edge').toBeGreaterThanOrEqual(0);
      expect(t!.x + t!.width, 'target inside right edge').toBeLessThanOrEqual(vp.width + 1);
      expect(a!.y, 'attacker inside top').toBeGreaterThanOrEqual(0);
      expect(a!.y + a!.height, 'attacker inside bottom').toBeLessThanOrEqual(vp.height + 1);
      // No page scroll.
      const sh = await page.evaluate(() => ({
        h: document.documentElement.scrollHeight,
        c: document.documentElement.clientHeight,
      }));
      expect(sh.h, 'no vertical page overflow').toBeLessThanOrEqual(sh.c + 1);
      // Power values + math line visible.
      await expect(page.locator('[data-testid="presentation-beat-attacker-power"]')).toBeVisible();
      await expect(page.locator('[data-testid="presentation-beat-target-power"]')).toBeVisible();
      await page.screenshot({ path: `${EVIDENCE}/combat-duel-${vp.name}.png` });
    });

    test(`target picker no-scroll with 5 candidates @ ${vp.name}`, async ({ page }) => {
      test.setTimeout(TWO_MIN);
      await bootstrap(page);
      // FIELD_CAP is 5 (engine invariant) — seed a full board.
      for (let i = 0; i < 5; i += 1) {
        await seedChar(page, 'B', 'field', { id: `F8D_T${i}`, power: 3000 });
      }
      const otama = await seedCorpusInHand(page, 'OP01-006');
      await topUpDon(page, 'A', 2);
      await dispatch(page, { type: 'PLAY_CARD', instanceId: otama, replaceTargetId: null });
      const prompt = page.locator('[data-pending-kind="attack_target_pick"]');
      await expect(prompt).toBeVisible();
      const sh = await page.evaluate(() => ({
        h: document.documentElement.scrollHeight,
        c: document.documentElement.clientHeight,
        ih: window.innerHeight,
      }));
      expect(sh.h, 'page never scrolls').toBeLessThanOrEqual(sh.c + 1);
      const confirm = await page.locator('[data-target-confirm]').boundingBox();
      expect(confirm!.y + confirm!.height, 'Confirm visible in viewport').toBeLessThanOrEqual(sh.ih + 1);
      await page.screenshot({ path: `${EVIDENCE}/picker-noscroll-${vp.name}.png` });
      await page.locator('[data-target-choose-none]').click();
    });
  });
}
