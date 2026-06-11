// family-discard — Stage A representative anchor for the
// discard / opponent-discard mechanic family. Verifies OP01-114
// X.Drake's on_play clause:
//   `[On Play] DON!! -1: Your opponent trashes 1 card from their hand.`
//
// Engine path (V0 deterministic — NO UI prompt):
//   - donCostReturnToDeck cost: shift N from donCostArea → donDeck.
//     Source: shared/engine-v2/registry/handlers/costs2.ts:335-351.
//   - opp_discard_from_hand → discard_opp_hand action: discards from
//     HEAD of opp.hand deterministically (V0 stub at lines 339-359).
//     Source: shared/engine-v2/registry/handlers/actions.ts:339-359 +
//     actions3.ts:80-81 (alias).
//   - Comment at actions.ts:340-341 explicitly notes "V0: discards from
//     the head of opp's hand deterministically; full player-choice
//     routing arrives with PendingDiscard wiring in Phase 3."
//
// X.Drake notes:
//   - cost=5 → need 5 DON in cost area for the card.
//   - effect cost donCostReturnToDeck=1 → need 1 MORE DON in cost area
//     AFTER paying card cost. So total ≥ 6 in cost area pre-play.
//   - X.Drake is PURPLE; A's leader is RED. Color identity is only
//     enforced in getLegalActions (`legality.ts:178`); the PLAY_CARD
//     reducer does not gate by color so dispatch path plays cleanly.
//     Same pattern as family-bounce (OP01-086 blue vs red leader).
//   - effectSpecV2.verified="flagged" with auditNote — not exercised
//     here; we test the engine behavior as encoded.
//
// Per directive 2026-06-06: harness-only. No engine / UI / card-data /
// scenarioFactory changes. Test runs <2 min.

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

// OP01-114 X.Drake — copied from shared/data/cards.json. Purple → not
// in A's default red deck → cardLibrary needs injection.
const OP01_114_DEF = {
  id: 'OP01-114',
  name: 'X.Drake',
  kind: 'character',
  colors: ['purple'],
  cost: 5,
  power: 5000,
  counterValue: 2000,
  traits: ['Navy', 'Drake Pirates', 'Animal Kingdom Pirates'],
  keywords: ['on_play'],
  effectTags: ['disruption', 'ramp'],
  effectText: '[On Play] DON!! −1 (You may return the specified number of DON!! cards from your field to your DON!! deck.): Your opponent trashes 1 card from their hand.',
  effectSpecV2: {
    clauses: [
      {
        trigger: 'on_play',
        cost: { donCostReturnToDeck: 1 },
        action: { kind: 'opp_discard_from_hand', magnitude: 1 },
        verified: 'flagged',
      },
    ],
    continuous: [],
    replacements: [],
    schemaVersion: 2,
    verified: 'flagged',
  },
};

async function seedXDrakeInHand(page: Page, def: unknown): Promise<string> {
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
    if (!lib['OP01-114']) lib['OP01-114'] = def;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { hand: string[] } };
    const iid = `seedXDrake_${Math.floor(Math.random() * 1e9).toString(36)}`;
    inst[iid] = {
      instanceId: iid, cardId: 'OP01-114', controller: 'A',
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

async function topUpADon(page: Page, n: number): Promise<void> {
  await page.evaluate((n) => {
    const w = window as unknown as {
      __store?: {
        getState: () => { state: unknown };
        setState: (p: { state: unknown } | { legalActions: unknown }) => void;
      };
      __getLegalActions?: (s: unknown, p: string) => unknown;
    };
    if (!w.__store) throw new Error('window.__store not exposed');
    const s = w.__store.getState().state as Record<string, unknown>;
    const players = s.players as { A: { donDeck: string[]; donCostArea: string[] } };
    for (let i = 0; i < n; i += 1) {
      const id = players.A.donDeck.shift();
      if (id !== undefined) players.A.donCostArea.push(id);
    }
    w.__store.setState({ state: { ...s } });
    if (w.__getLegalActions) {
      const next = w.__store.getState().state as { activePlayer: string };
      w.__store.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
  }, n);
}

async function playFromHand(page: Page, iid: string): Promise<void> {
  await page.evaluate((id) => {
    const w = window as unknown as {
      __store?: { getState: () => { dispatch: (a: unknown) => void } };
    };
    if (!w.__store) throw new Error('window.__store not exposed');
    w.__store.getState().dispatch({ type: 'PLAY_CARD', instanceId: id, replaceTargetId: null });
  }, iid);
  await page.waitForTimeout(900);
}

interface ZoneSnap {
  aHandIds: string[];
  aFieldIds: string[];
  aTrashIds: string[];
  bHandIds: string[];
  bTrashIds: string[];
  phase: string;
  activePlayer: string;
  pendingKind: string | null;
}

async function readZones(page: Page): Promise<ZoneSnap> {
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
              B: { hand: string[]; trash: string[] };
            };
          };
        };
      };
    };
    if (!w.__store) {
      return { aHandIds: [], aFieldIds: [], aTrashIds: [], bHandIds: [], bTrashIds: [], phase: '', activePlayer: '', pendingKind: null };
    }
    const s = w.__store.getState().state;
    return {
      aHandIds: [...s.players.A.hand],
      aFieldIds: s.players.A.field.map((i) => i.instanceId),
      aTrashIds: [...s.players.A.trash],
      bHandIds: [...s.players.B.hand],
      bTrashIds: [...s.players.B.trash],
      phase: s.phase,
      activePlayer: s.activePlayer,
      pendingKind: s.pending?.kind ?? null,
    };
  });
}

async function readHandUiCount(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const el = document.querySelector('[aria-label^="Your hand"]');
    if (!el) return null;
    const m = (el.getAttribute('aria-label') ?? '').match(/Your hand,\s*(\d+)\s*cards/);
    return m ? parseInt(m[1]!, 10) : null;
  });
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

test.describe('family-discard (Stage A)', () => {
  test('OP01-114 X.Drake on_play: deterministic head-of-opp-hand → opp trash; A field +1', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { drv, pageErrors, invariantErrors } = await bootstrap(page);
    void drv;

    // ── Precondition ─────────────────────────────────────────────────
    const pre = await readZones(page);
    expect(pre.phase, 'phase=main').toBe('main');
    expect(pre.activePlayer, 'A turn').toBe('A');
    expect(pre.pendingKind, 'no pending').toBeNull();
    expect(pre.bHandIds.length, 'B hand has ≥2 known cards').toBeGreaterThanOrEqual(2);

    // Capture exact B hand instance ids before any seeding.
    const bHandBefore = [...pre.bHandIds];
    const bExpectedDiscard = bHandBefore[0]!; // V0 deterministic — head of hand.
    const bSurvivor = bHandBefore[1]!;

    // ── Seed X.Drake & DON ───────────────────────────────────────────
    const xDrakeIid = await seedXDrakeInHand(page, OP01_114_DEF);
    // X.Drake card cost = 5; effect cost donCostReturnToDeck = 1; T1
    // starts with 1 DON in cost area → top up 5 (total = 6).
    await topUpADon(page, 5);

    // ── BEFORE ──────────────────────────────────────────────────────
    const before = await readZones(page);
    expect(before.aHandIds, 'X.Drake in A hand before').toContain(xDrakeIid);
    expect(before.bHandIds.length, 'B hand count unchanged by seeding').toBe(bHandBefore.length);
    const aHandBeforeLen = before.aHandIds.length;
    const aFieldBeforeLen = before.aFieldIds.length;
    const bHandBeforeLen = before.bHandIds.length;
    const bTrashBeforeLen = before.bTrashIds.length;
    const handUiBefore = await readHandUiCount(page);

    // ── Play X.Drake ─────────────────────────────────────────────────
    await playFromHand(page, xDrakeIid);

    // ── AFTER ───────────────────────────────────────────────────────
    const after = await readZones(page);

    // Engine: X.Drake on A field.
    expect(after.aFieldIds, 'X.Drake on A field after play').toContain(xDrakeIid);
    expect(after.aFieldIds.length, 'A field +1').toBe(aFieldBeforeLen + 1);
    expect(after.aHandIds, 'X.Drake not in A hand').not.toContain(xDrakeIid);
    expect(after.aHandIds.length, 'A hand -1 (X.Drake out, no draw)').toBe(aHandBeforeLen - 1);

    // Engine: B hand -1, B trash +1.
    expect(after.bHandIds.length, 'B hand count -1').toBe(bHandBeforeLen - 1);
    expect(after.bTrashIds.length, 'B trash count +1').toBe(bTrashBeforeLen + 1);

    // Engine: discarded id = pre-play B.hand[0]; survivor still in hand.
    expect(after.bHandIds, 'discarded card no longer in B hand').not.toContain(bExpectedDiscard);
    expect(after.bTrashIds, 'discarded card in B trash').toContain(bExpectedDiscard);
    expect(after.bHandIds, 'unrelated B hand[1] still in hand').toContain(bSurvivor);

    // Engine: pending null, phase main, A turn.
    expect(after.pendingKind, 'no stuck pending after on_play').toBeNull();
    expect(after.phase, 'phase still main').toBe('main');
    expect(after.activePlayer, 'still A turn').toBe('A');

    // ── UI ───────────────────────────────────────────────────────────
    // X.Drake visible on your field.
    await expect.poll(
      async () => isOnYourField(page, xDrakeIid),
      { timeout: 5_000, message: 'X.Drake visible on your field after play' },
    ).toBe(true);

    // A hand UI count -1.
    const handUiAfter = await readHandUiCount(page);
    if (handUiBefore !== null && handUiAfter !== null) {
      expect(handUiAfter, 'A hand UI count -1').toBe(handUiBefore - 1);
    }

    // Opp hand / opp trash UI counts: face-down opp-hand DOM in this
    // build doesn't expose a numeric aria-label via the patterns
    // covered earlier (see family-bounce result). Engine-truth covered
    // those deltas above; UI side classified NOT_EXPOSED.

    // ── Stability ────────────────────────────────────────────────────
    expect(pageErrors, 'no pageerrors').toEqual([]);
    expect(invariantErrors, 'no InvariantErrors').toEqual([]);
  });
});
