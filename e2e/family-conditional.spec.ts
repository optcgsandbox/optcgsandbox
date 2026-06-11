// family-conditional — Stage A representative anchor for the non-leader
// conditional effects family. Verifies P-053 Nami's gated clause:
//   `[On Play] If you have 3 or less cards in your hand, return up to
//    1 of your opponent's Characters with a cost of 3 or less to the
//    owner's hand.`
//
// Two subcases in one test:
//   FALSE: A.hand size post-Nami-play > 3 ⇒ if_hand_max:3 returns
//          false ⇒ gated clause SKIPS. B.field target NOT bounced.
//   TRUE:  A.hand trimmed so post-Nami-play size = 3 ⇒ condition true
//          ⇒ gated clause FIRES. B.field target bounced to B.hand.
//
// Engine sources:
//   - ifHandMax handler: `s.players[ctx.controller].hand.length <= n`.
//     Source: shared/engine-v2/registry/handlers/conditions.ts:115-116.
//   - Character play removes Nami from A.hand BEFORE firing on_play.
//     Source: shared/engine-v2/reducers/mainPhase.ts:188-220.
//   - removal_bounce: field→owner.hand. Source:
//     shared/engine-v2/registry/handlers/actions.ts:211-247.
//   - opp_character resolver V0 first eligible. Source:
//     shared/engine-v2/registry/handlers/targets.ts:87-92.
//
// Color identity bypass (P-053 Nami blue vs A red leader): dispatch
// path bypasses the legality-only gate at `legality.ts:178`. Same
// pattern as family-bounce / discard / counter-event / cost-reduction
// / leader-gated.
//
// Anchor pre-check: 14 clean non-leader conditional cards corpus-wide;
// no OP01 candidates. P-053 chosen as cheapest viable (cost 1 → no DON
// topup), single-condition, single-clause, deterministic action.
//
// Per directive 2026-06-06: harness-only. No engine / UI / card-data
// (file) / scenarioFactory changes. Trimming A.hand is a test-only
// runtime state mutation. Test runs <2 min.

import { test, expect, type Page } from '@playwright/test';
import { PlayerDriver } from './helpers/player';

const TWO_MIN = 2 * 60_000;

test.use({
  launchOptions: {
    args: ['--disable-renderer-backgrounding', '--no-sandbox'],
  },
});

interface Bootstrap {
  drv: PlayerDriver;
  pageErrors: string[];
  invariantErrors: string[];
}

async function bootstrap(page: Page): Promise<Bootstrap> {
  const pageErrors: string[] = [];
  const invariantErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    const t = msg.text();
    if (t.includes('InvariantError') || t.includes('invariant')) invariantErrors.push(t);
  });
  const drv = new PlayerDriver(page);
  await drv.open();
  await drv.waitForPhase('dice_roll');
  await drv.rollDice();
  try { await drv.waitForPhase('first_player_choice', 15_000); await drv.chooseGoFirst(); } catch {}
  try { await drv.waitForPhase('mulligan', 8_000); await drv.keepMulliganHand(); } catch {}
  await expect.poll(
    async () => {
      const s = await drv.getState();
      return { phase: s.phase, activePlayer: s.activePlayer };
    },
    { timeout: 60_000, message: 'A did not reach main' },
  ).toMatchObject({ phase: 'main', activePlayer: 'A' });
  return { drv, pageErrors, invariantErrors };
}

const P_053_DEF = {
  id: 'P-053',
  name: 'Nami',
  kind: 'character',
  colors: ['blue'],
  cost: 1,
  power: 1000,
  counterValue: 2000,
  traits: ['Straw Hat Crew'],
  keywords: ['on_play'],
  effectTags: ['removal_bounce'],
  effectText: '[On Play] If you have 3 or less cards in your hand, return up to 1 of your opponent\'s Characters with a cost of 3 or less to the owner\'s hand.',
  effectSpecV2: {
    schemaVersion: 2,
    verified: 'human-reviewed',
    clauses: [
      {
        trigger: 'on_play',
        condition: { type: 'if_hand_max', n: 3 },
        action: { kind: 'removal_bounce' },
        target: { kind: 'opp_character', filter: { costMax: 3 } },
        verified: 'human-reviewed',
      },
    ],
    continuous: [],
    replacements: [],
  },
};

async function seedNamiInHand(page: Page, def: unknown): Promise<string> {
  return page.evaluate((def) => {
    const w = window as unknown as {
      __store?: {
        getState: () => { state: unknown };
        setState: (p: { state: unknown } | { legalActions: unknown }) => void;
      };
      __getLegalActions?: (s: unknown, p: string) => unknown;
    };
    if (!w.__store) throw new Error('window.__store not exposed');
    const s = w.__store.getState().state as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    if (!lib['P-053']) lib['P-053'] = def;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { hand: string[] } };
    const iid = `seedNamiP053_${Math.floor(Math.random() * 1e9).toString(36)}`;
    inst[iid] = {
      instanceId: iid, cardId: 'P-053', controller: 'A',
      rested: false, summoningSick: false,
      attachedDon: [], attachedDonRested: [],
      perTurn: { hasAttacked: false, effectsUsed: [] },
    };
    players.A.hand = [...players.A.hand, iid];
    w.__store.setState({ state: { ...s } });
    if (w.__getLegalActions) {
      const next = w.__store.getState().state as { activePlayer: string };
      w.__store.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
    return iid;
  }, def);
}

async function seedOppFieldChar(page: Page, cost: number, tag: string): Promise<string> {
  return page.evaluate(({ cost, tag }) => {
    const w = window as unknown as {
      __store?: {
        getState: () => { state: unknown };
        setState: (p: { state: unknown } | { legalActions: unknown }) => void;
      };
      __getLegalActions?: (s: unknown, p: string) => unknown;
    };
    if (!w.__store) throw new Error('window.__store not exposed');
    const s = w.__store.getState().state as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { B: { field: unknown[] } };
    const synthId = `__seed_cond_b_${tag}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    const iid = `seedCondb_${tag}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    lib[synthId] = {
      id: synthId, name: `Cond B ${tag}`, kind: 'character',
      cost, power: 3000, counterValue: 1000,
      colors: ['red'],
      traits: [],
      keywords: [],
      effectText: '',
    };
    inst[iid] = {
      instanceId: iid, cardId: synthId, controller: 'B',
      rested: false, summoningSick: false,
      attachedDon: [], attachedDonRested: [],
      perTurn: { hasAttacked: false, effectsUsed: [] },
    };
    players.B.field = [...players.B.field, inst[iid]];
    w.__store.setState({ state: { ...s } });
    if (w.__getLegalActions) {
      const next = w.__store.getState().state as { activePlayer: string };
      w.__store.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
    return iid;
  }, { cost, tag });
}

// Trim A.hand to (keepIids + extra trailing cards) so total hand
// length = totalKeep. Removes the rest of A.hand (those instances stay
// in instances map but are no longer in A.hand zone).
async function trimAHand(page: Page, keepIids: string[], totalKeep: number): Promise<void> {
  await page.evaluate(({ keepIids, totalKeep }) => {
    const w = window as unknown as {
      __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void };
      __getLegalActions?: (s: unknown, p: string) => unknown;
    };
    if (!w.__store) throw new Error('window.__store not exposed');
    const s = w.__store!.getState().state as Record<string, unknown>;
    const players = s.players as { A: { hand: string[] } };
    const current = [...players.A.hand];
    const newHand: string[] = [];
    // Keep specified ids first (preserve order they appear in current).
    for (const id of current) {
      if (keepIids.includes(id)) newHand.push(id);
    }
    // Then add other ids to reach totalKeep.
    for (const id of current) {
      if (newHand.length >= totalKeep) break;
      if (!newHand.includes(id)) newHand.push(id);
    }
    players.A.hand = newHand;
    w.__store!.setState({ state: { ...s, players: { ...(s.players as Record<string, unknown>), A: { ...players.A } } } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
  }, { keepIids, totalKeep });
  await page.waitForTimeout(150);
}

async function topUpADon(page: Page, target: number): Promise<void> {
  await page.evaluate((target) => {
    const w = window as unknown as {
      __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void };
      __getLegalActions?: (s: unknown, p: string) => unknown;
    };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const players = s.players as { A: { donDeck: string[]; donCostArea: string[] } };
    const newDeck = [...players.A.donDeck];
    const newCost = [...players.A.donCostArea];
    while (newCost.length < target && newDeck.length > 0) {
      const id = newDeck.shift();
      if (id !== undefined) newCost.push(id);
    }
    players.A.donDeck = newDeck;
    players.A.donCostArea = newCost;
    w.__store!.setState({ state: { ...s, players: { ...(s.players as Record<string, unknown>), A: { ...players.A } } } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
  }, target);
  await page.waitForTimeout(150);
}

async function clearBField(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void };
      __getLegalActions?: (s: unknown, p: string) => unknown;
    };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const players = s.players as { B: { field: unknown[] } };
    players.B.field = [];
    w.__store!.setState({ state: { ...s, players: { ...(s.players as Record<string, unknown>), B: { ...players.B } } } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
  });
}

async function playFromHand(page: Page, iid: string): Promise<void> {
  await page.evaluate((id) => {
    const w = window as unknown as {
      __store?: { getState: () => { dispatch: (a: unknown) => void } };
    };
    if (!w.__store) throw new Error('window.__store not exposed');
    w.__store.getState().dispatch({ type: 'PLAY_CARD', instanceId: id, replaceTargetId: null });
  }, iid);
  await page.waitForTimeout(700);
}

async function isOnYourField(page: Page, iid: string): Promise<boolean> {
  return page.evaluate((id) => {
    const btns = Array.from(document.querySelectorAll(`button[data-instance-id="${id}"]`));
    for (const b of btns) {
      let el: Element | null = b.parentElement;
      let inField = false;
      let inYourHalf = false;
      let depth = 0;
      while (el && depth < 20) {
        const label = el.getAttribute('aria-label') ?? '';
        if (label.startsWith('Character area')) inField = true;
        if (label === 'Your half') inYourHalf = true;
        el = el.parentElement;
        depth += 1;
      }
      if (inField && inYourHalf) return true;
    }
    return false;
  }, iid);
}

async function isOnOpponentField(page: Page, iid: string): Promise<boolean> {
  return page.evaluate((id) => {
    const btns = Array.from(document.querySelectorAll(`button[data-instance-id="${id}"]`));
    for (const b of btns) {
      let el: Element | null = b.parentElement;
      let inField = false;
      let inOppHalf = false;
      let depth = 0;
      while (el && depth < 20) {
        const label = el.getAttribute('aria-label') ?? '';
        if (label.startsWith('Character area')) inField = true;
        if (label === 'Opponent half') inOppHalf = true;
        el = el.parentElement;
        depth += 1;
      }
      if (inField && inOppHalf) return true;
    }
    return false;
  }, iid);
}

interface Snap {
  phase: string;
  activePlayer: string;
  pendingKind: string | null;
  aHandIds: string[];
  aFieldIds: string[];
  aTrashIds: string[];
  bFieldIds: string[];
  bHandIds: string[];
  bTrashIds: string[];
}

async function readSnap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __store?: {
        getState: () => {
          state: {
            phase: string;
            activePlayer: string;
            pending: { kind?: string } | null;
            players: {
              A: { hand: string[]; trash: string[]; field: { instanceId: string }[] };
              B: { hand: string[]; trash: string[]; field: { instanceId: string }[] };
            };
          };
        };
      };
    };
    if (!w.__store) return { phase: '', activePlayer: '', pendingKind: null, aHandIds: [], aFieldIds: [], aTrashIds: [], bFieldIds: [], bHandIds: [], bTrashIds: [] };
    const s = w.__store.getState().state;
    return {
      phase: s.phase,
      activePlayer: s.activePlayer,
      pendingKind: s.pending?.kind ?? null,
      aHandIds: [...s.players.A.hand],
      aFieldIds: s.players.A.field.map((i) => i.instanceId),
      aTrashIds: [...s.players.A.trash],
      bFieldIds: s.players.B.field.map((i) => i.instanceId),
      bHandIds: [...s.players.B.hand],
      bTrashIds: [...s.players.B.trash],
    };
  });
}

test.describe('family-conditional (Stage A)', () => {
  test('P-053 Nami: if_hand_max:3 SKIPS when hand>3; FIRES when hand≤3', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { drv, pageErrors, invariantErrors } = await bootstrap(page);
    void drv;

    // ── SUBCASE A: condition FALSE (hand > 3 post-play) ─────────────
    {
      const bTargetA = await seedOppFieldChar(page, 2, 'falseA');
      const bControlA = await seedOppFieldChar(page, 2, 'ctlA');
      const namiA = await seedNamiInHand(page, P_053_DEF);

      const before = await readSnap(page);
      expect(before.phase, 'phase=main').toBe('main');
      expect(before.activePlayer, 'A turn').toBe('A');
      expect(before.pendingKind, 'no pending').toBeNull();
      // Default mulligan + seed → A.hand should be > 4 so post-play > 3.
      expect(before.aHandIds.length, 'A hand large enough that post-play > 3').toBeGreaterThan(4);
      expect(before.bFieldIds, 'B target on field before').toContain(bTargetA);
      expect(before.bFieldIds, 'B control on field before').toContain(bControlA);
      const bFieldBeforeLen = before.bFieldIds.length;
      const bHandBeforeLen = before.bHandIds.length;
      const aHandBeforeLen = before.aHandIds.length;

      // UI BEFORE: both B chars visible on opp field; Nami still in hand.
      expect(await isOnOpponentField(page, bTargetA), 'B target visible on opp field BEFORE').toBe(true);
      expect(await isOnOpponentField(page, bControlA), 'B control visible on opp field BEFORE').toBe(true);

      await playFromHand(page, namiA);

      const after = await readSnap(page);

      // Nami played: hand → field; cost paid.
      expect(after.aHandIds, 'Nami left A hand').not.toContain(namiA);
      expect(after.aFieldIds, 'Nami on A field').toContain(namiA);
      // Post-play A.hand size = pre - 1 (Nami removed); should be > 3.
      expect(after.aHandIds.length, 'post-play A hand = before - 1').toBe(aHandBeforeLen - 1);
      expect(after.aHandIds.length, 'post-play A hand > 3 (condition false)').toBeGreaterThan(3);

      // GATED clause SKIPPED — B target unchanged.
      expect(after.bFieldIds, 'B target STILL on field').toContain(bTargetA);
      expect(after.bFieldIds, 'B control STILL on field').toContain(bControlA);
      expect(after.bFieldIds.length, 'B field unchanged').toBe(bFieldBeforeLen);
      expect(after.bHandIds, 'B target NOT in B hand').not.toContain(bTargetA);
      expect(after.bHandIds.length, 'B hand unchanged').toBe(bHandBeforeLen);

      // UI AFTER (false subcase): Nami visible on A field; B target +
      // B control STILL visible on opp field (condition false ⇒ no
      // bounce ⇒ opp field unchanged).
      await expect.poll(
        async () => isOnYourField(page, namiA),
        { timeout: 5_000, message: 'Nami visible on Your field after play (FALSE)' },
      ).toBe(true);
      expect(await isOnOpponentField(page, bTargetA), 'B target STILL visible on opp field (FALSE)').toBe(true);
      expect(await isOnOpponentField(page, bControlA), 'B control STILL visible on opp field (FALSE)').toBe(true);

      expect(after.pendingKind, 'no stuck pending').toBeNull();
      expect(after.phase, 'phase main').toBe('main');
      expect(after.activePlayer, 'A turn').toBe('A');
    }

    // ── SUBCASE B: condition TRUE (trim A.hand → post-play = 3) ────
    {
      // Reset opponent field so deterministic resolver picks fresh target.
      await clearBField(page);
      // Seed target (cost 2, passes costMax:3) FIRST so it's at
      // B.field[0] (V0 resolver picks first eligible). Then control
      // (cost 5, FAILS filter even if picked first — but order also
      // ensures clarity).
      const bTargetB = await seedOppFieldChar(page, 2, 'trueB');
      const bControlB = await seedOppFieldChar(page, 5, 'ctlB');
      const namiB = await seedNamiInHand(page, P_053_DEF);
      // Replenish DON — subcase A consumed the 1 default DON.
      await topUpADon(page, 1);
      // Trim A.hand to exactly [Nami + 3 other] = 4 cards. Post-Nami-
      // play hand will be 3 ⇒ if_hand_max:3 returns true.
      await trimAHand(page, [namiB], 4);

      const before = await readSnap(page);
      expect(before.aHandIds.length, 'A hand trimmed to 4').toBe(4);
      expect(before.aHandIds, 'Nami still in A hand after trim').toContain(namiB);
      expect(before.bFieldIds, 'B target B on field').toContain(bTargetB);
      expect(before.bFieldIds, 'B control B on field').toContain(bControlB);
      expect(before.bFieldIds.length, 'B field has 2 (target + control)').toBe(2);
      const bHandBeforeLen = before.bHandIds.length;

      // UI BEFORE: both B chars visible on opp field.
      expect(await isOnOpponentField(page, bTargetB), 'B target visible on opp field BEFORE').toBe(true);
      expect(await isOnOpponentField(page, bControlB), 'B control visible on opp field BEFORE').toBe(true);

      await playFromHand(page, namiB);

      const after = await readSnap(page);

      // Nami played.
      expect(after.aHandIds, 'Nami left A hand').not.toContain(namiB);
      expect(after.aFieldIds, 'Nami on A field').toContain(namiB);
      expect(after.aHandIds.length, 'post-play A hand = 3 (condition true)').toBe(3);

      // GATED clause FIRED — B target bounced; B control survives.
      expect(after.bFieldIds, 'B target removed from field').not.toContain(bTargetB);
      expect(after.bFieldIds, 'B control STILL on field (filter costMax 3 excludes)').toContain(bControlB);
      expect(after.bFieldIds.length, 'B field -1').toBe(1);
      expect(after.bHandIds, 'B target now in B hand').toContain(bTargetB);
      expect(after.bHandIds.length, 'B hand +1').toBe(bHandBeforeLen + 1);

      // UI AFTER (true subcase): Nami visible on A field; B target
      // GONE from opp field; B control STILL visible.
      await expect.poll(
        async () => isOnYourField(page, namiB),
        { timeout: 5_000, message: 'Nami visible on Your field after play (TRUE)' },
      ).toBe(true);
      await expect.poll(
        async () => isOnOpponentField(page, bTargetB),
        { timeout: 5_000, message: 'B target removed from opp field (TRUE)' },
      ).toBe(false);
      expect(await isOnOpponentField(page, bControlB), 'B control STILL visible on opp field (TRUE)').toBe(true);

      expect(after.pendingKind, 'no stuck pending').toBeNull();
      expect(after.phase, 'phase main').toBe('main');
      expect(after.activePlayer, 'A turn').toBe('A');
    }

    // ── Stability ────────────────────────────────────────────────────
    expect(pageErrors, 'no pageerrors').toEqual([]);
    expect(invariantErrors, 'no InvariantErrors').toEqual([]);
  });
});
