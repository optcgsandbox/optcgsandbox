// family-don-manipulation — Stage A representative anchor for the
// DON manipulation / ramp mechanic family. Verifies OP01-106 Basil
// Hawkins' on_play clause:
//   `[On Play] Add up to 1 DON!! card from your DON!! deck and rest it.`
//
// Engine path (V0 deterministic — NO UI prompt):
//   - Character cost payment (cost=4) moves DON donCostArea → donRested.
//     Source: shared/engine-v2/reducers/mainPhase.ts:181-185.
//   - Ramp action: shifts N from donDeck → donRested when
//     action.rested:true. Source:
//     shared/engine-v2/registry/handlers/actions.ts:284-302.
//
// DON pool invariant: DON_DECK_SIZE = 10 per player. Engine source:
// shared/engine-v2/state/types.ts:384. Total DON across donDeck +
// donCostArea + donRested + attached must stay = 10 throughout.
//
// Color identity: Basil Hawkins is purple; A's default leader is red.
// `sharesColorWithLeader` is only enforced in getLegalActions
// (`legality.ts:178`); the PLAY_CARD reducer is not gated by color,
// so the dispatch path plays cleanly. Same pattern as family-bounce
// and family-discard.
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

// OP01-106 Basil Hawkins — verbatim from shared/data/cards.json. Purple
// → not in A's red default deck → inject card def into cardLibrary.
const OP01_106_DEF = {
  id: 'OP01-106',
  name: 'Basil Hawkins',
  kind: 'character',
  colors: ['purple'],
  cost: 4,
  power: 2000,
  counterValue: 1000,
  traits: ['Animal Kingdom Pirates', 'Hawkins Pirates'],
  keywords: ['on_play'],
  effectTags: ['ramp'],
  effectText: '[On Play] Add up to 1 DON!! card from your DON!! deck and rest it.',
  effectSpecV2: {
    clauses: [
      {
        trigger: 'on_play',
        action: { kind: 'ramp', magnitude: 1, rested: true },
        verified: 'auto',
      },
    ],
    continuous: [],
    replacements: [],
    schemaVersion: 2,
    verified: 'human-reviewed',
  },
};

async function seedHawkinsInHand(page: Page, def: unknown): Promise<string> {
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
    if (!lib['OP01-106']) lib['OP01-106'] = def;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { hand: string[] } };
    const iid = `seedHawkins_${Math.floor(Math.random() * 1e9).toString(36)}`;
    inst[iid] = {
      instanceId: iid, cardId: 'OP01-106', controller: 'A',
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
    // Build new arrays so Zustand selectors (e.g. CostAreaBand on
    // `state.players[X].donCostArea`) see new references and re-render.
    // The other zone helpers in this suite touch instance maps + field
    // arrays via spread, which already produces new refs there; the DON
    // arrays previously got mutated in place and the UI stayed stale.
    const newDeck = [...players.A.donDeck];
    const newCost = [...players.A.donCostArea];
    for (let i = 0; i < n; i += 1) {
      const id = newDeck.shift();
      if (id !== undefined) newCost.push(id);
    }
    players.A.donDeck = newDeck;
    players.A.donCostArea = newCost;
    w.__store.setState({ state: { ...s, players: { ...(s.players as Record<string, unknown>), A: { ...players.A } } } });
    if (w.__getLegalActions) {
      const next = w.__store.getState().state as { activePlayer: string };
      w.__store.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
  }, n);
  await page.waitForTimeout(150);
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

interface DonSnap {
  donDeck: number;
  donCostArea: number;
  donRested: number;
  attachedDonTotal: number;
  aHand: string[];
  aField: string[];
  phase: string;
  activePlayer: string;
  pendingKind: string | null;
}

async function readDon(page: Page): Promise<DonSnap> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __store?: {
        getState: () => {
          state: {
            phase: string;
            activePlayer: string;
            pending: { kind?: string } | null;
            players: {
              A: {
                hand: string[];
                donDeck: string[];
                donCostArea: string[];
                donRested: string[];
                field: { instanceId: string; attachedDon: string[]; attachedDonRested?: string[] }[];
                leader: { attachedDon: string[]; attachedDonRested?: string[] };
                stage: { attachedDon: string[]; attachedDonRested?: string[] } | null;
              };
            };
          };
        };
      };
    };
    if (!w.__store) {
      return { donDeck: 0, donCostArea: 0, donRested: 0, attachedDonTotal: 0, aHand: [], aField: [], phase: '', activePlayer: '', pendingKind: null };
    }
    const s = w.__store.getState().state;
    const a = s.players.A;
    let attached = a.leader.attachedDon.length + (a.leader.attachedDonRested?.length ?? 0);
    if (a.stage !== null) {
      attached += a.stage.attachedDon.length + (a.stage.attachedDonRested?.length ?? 0);
    }
    for (const inst of a.field) {
      attached += inst.attachedDon.length + (inst.attachedDonRested?.length ?? 0);
    }
    return {
      donDeck: a.donDeck.length,
      donCostArea: a.donCostArea.length,
      donRested: a.donRested.length,
      attachedDonTotal: attached,
      aHand: [...a.hand],
      aField: a.field.map((i) => i.instanceId),
      phase: s.phase,
      activePlayer: s.activePlayer,
      pendingKind: s.pending?.kind ?? null,
    };
  });
}

// CostAreaBand aria-label exposes both counts in one string.
// Source: src/components/zones/CostAreaBand.tsx:221.
async function readDonUiCounts(page: Page): Promise<{ active: number; rested: number } | null> {
  return page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('[aria-label]'));
    for (const el of els) {
      const label = el.getAttribute('aria-label') ?? '';
      const m = label.match(/Your cost area\s*—\s*(\d+)\s*active DON,\s*(\d+)\s*rested DON/i);
      if (m) return { active: parseInt(m[1]!, 10), rested: parseInt(m[2]!, 10) };
    }
    return null;
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

test.describe('family-don-manipulation (Stage A)', () => {
  test('OP01-106 Basil Hawkins on_play: ramp +1 rested DON from donDeck; DON pool conserved', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { drv, pageErrors, invariantErrors } = await bootstrap(page);
    void drv;

    // ── Precondition ─────────────────────────────────────────────────
    const pre = await readDon(page);
    expect(pre.phase, 'phase=main').toBe('main');
    expect(pre.activePlayer, 'A turn').toBe('A');
    expect(pre.pendingKind, 'no pending').toBeNull();
    // T1 A starts with donDeck=9, donCostArea=1, donRested=0, attached=0
    // → total 10. Engine source: setup/initialState.ts + DON_DECK_SIZE=10.
    const preTotal = pre.donDeck + pre.donCostArea + pre.donRested + pre.attachedDonTotal;
    expect(preTotal, 'A DON pool = 10 at game start').toBe(10);

    // ── Seed Hawkins + top up DON ───────────────────────────────────
    const hawkinsIid = await seedHawkinsInHand(page, OP01_106_DEF);
    // Hawkins cost = 4. T1 cost area = 1. Top up by 3.
    await topUpADon(page, 3);

    // ── BEFORE play ─────────────────────────────────────────────────
    const before = await readDon(page);
    expect(before.aHand, 'Hawkins in A hand').toContain(hawkinsIid);
    expect(before.donDeck, 'A donDeck has ≥1 (ramp source)').toBeGreaterThanOrEqual(1);
    expect(before.donCostArea, 'A donCostArea ≥ cost 4').toBeGreaterThanOrEqual(4);
    const beforeTotal = before.donDeck + before.donCostArea + before.donRested + before.attachedDonTotal;
    expect(beforeTotal, 'DON pool = 10 before play').toBe(10);
    const aFieldBeforeLen = before.aField.length;
    const donUiBefore = await readDonUiCounts(page);

    // ── Play Hawkins ────────────────────────────────────────────────
    await playFromHand(page, hawkinsIid);

    // ── AFTER ───────────────────────────────────────────────────────
    const after = await readDon(page);

    // Engine: Hawkins on A field.
    expect(after.aField, 'Hawkins on A field').toContain(hawkinsIid);
    expect(after.aField.length, 'A field +1').toBe(aFieldBeforeLen + 1);
    expect(after.aHand, 'Hawkins not in A hand').not.toContain(hawkinsIid);

    // DON deltas:
    //   cost payment: donCostArea -4, donRested +4 (controller pays
    //     cost=4 via mainPhase.ts:181-185)
    //   ramp: donDeck -1, donRested +1 (action.rested:true via
    //     actions.ts:287-302)
    //   net:  donDeck -1, donCostArea -4, donRested +5, attached 0
    const dDonDeck = before.donDeck - after.donDeck;
    const dDonCost = before.donCostArea - after.donCostArea;
    const dDonRested = after.donRested - before.donRested;
    const dAttached = after.attachedDonTotal - before.attachedDonTotal;

    expect(dDonDeck, 'donDeck -1 (ramp consumed 1)').toBe(1);
    expect(dDonCost, 'donCostArea -4 (cost paid)').toBe(4);
    expect(dDonRested, 'donRested +5 (4 from cost + 1 from ramp)').toBe(5);
    expect(dAttached, 'attached DON unchanged').toBe(0);

    // DON conservation invariant.
    const afterTotal = after.donDeck + after.donCostArea + after.donRested + after.attachedDonTotal;
    expect(afterTotal, 'DON pool = 10 after play (conserved)').toBe(10);

    // Engine: stability.
    expect(after.pendingKind, 'no stuck pending').toBeNull();
    expect(after.phase, 'phase still main').toBe('main');
    expect(after.activePlayer, 'still A turn').toBe('A');

    // ── UI ───────────────────────────────────────────────────────────
    // Hawkins visible on your field.
    await expect.poll(
      async () => isOnYourField(page, hawkinsIid),
      { timeout: 5_000, message: 'Hawkins visible on your field after play' },
    ).toBe(true);

    // CostAreaBand aria-label exposes both active and rested counts.
    const donUiAfter = await readDonUiCounts(page);
    if (donUiBefore !== null && donUiAfter !== null) {
      expect(donUiAfter.active, 'UI active DON matches engine donCostArea').toBe(after.donCostArea);
      expect(donUiAfter.rested, 'UI rested DON matches engine donRested').toBe(after.donRested);
      // Sanity: UI delta vs engine delta.
      expect(donUiBefore.active - donUiAfter.active, 'UI active DON delta = -4').toBe(4);
      expect(donUiAfter.rested - donUiBefore.rested, 'UI rested DON delta = +5').toBe(5);
    }
    // donDeck count UI not separately exposed for A side; classified
    // NOT_EXPOSED. Engine-truth covers the -1 above.

    // ── Stability ────────────────────────────────────────────────────
    expect(pageErrors, 'no pageerrors').toEqual([]);
    expect(invariantErrors, 'no InvariantErrors').toEqual([]);
  });
});
