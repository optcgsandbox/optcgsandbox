// family-bounce — Stage A representative anchor for the
// bounce / return-to-hand mechanic family. Verifies OP01-086 Overheat's
// bounce clause:
//   `return up to 1 active Character with a cost of 3 or less to the
//    owner's hand.`
// is reflected in BOTH engine state (target removed from B.field,
// pushed to B.hand, NOT trash) and the visible UI (B field button gone,
// control char button still present).
//
// Engine path:
//   - removal_bounce action: splices target from field, pushes to
//     owner's hand. Source:
//     shared/engine-v2/registry/handlers/actions.ts:209-247.
//   - Filter {costMax:3, rested:false} via opp_character resolver.
//     Source: shared/engine-v2/registry/handlers/targets.ts:87-92.
//   - Event play path identical to OP01-026 (event → A.trash + on_play).
//     Source: shared/engine-v2/reducers/mainPhase.ts:125-160.
//   - Color identity is only enforced in getLegalActions (legality.ts:178);
//     PLAY_CARD reducer (mainPhase.ts) does not gate by color, so the
//     dispatch path plays OP01-086 (blue) against a red leader. Fine
//     for mechanic-only verification.
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

async function seedOppFieldChar(
  page: Page,
  power: number,
  tag: string,
  cost: number,
  rested: boolean,
): Promise<string> {
  return page.evaluate(({ power, tag, cost, rested }) => {
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
    const synthId = `__seed_bnc_b_${tag}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    const iid = `seedBNCb_${tag}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    lib[synthId] = {
      id: synthId, name: `BNC B ${tag}`, kind: 'character',
      cost, power, counterValue: 1000,
      colors: ['red','green','blue','purple','black','yellow'],
      traits: [], keywords: [],
      effectText: '',
    };
    inst[iid] = {
      instanceId: iid, cardId: synthId, controller: 'B',
      rested, summoningSick: false,
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
  }, { power, tag, cost, rested });
}

// Card definition copied from shared/data/cards.json. cardLibrary is
// populated only with cards in the active decks; OP01-086 (blue) isn't
// in A's red default deck.
const OP01_086_DEF = {
  id: 'OP01-086',
  name: 'Overheat',
  kind: 'event',
  colors: ['blue'],
  cost: 2,
  power: null,
  counterValue: null,
  traits: ['The Seven Warlords of the Sea', 'Donquixote Pirates'],
  keywords: [],
  effectTags: ['power_buff', 'removal_bounce', 'counter_event'],
  effectText: "[Counter] Up to 1 of your Leader or Character cards gains +4000 power during this battle. Then, return up to 1 active Character with a cost of 3 or less to the owner's hand.",
  counterEventBoost: 4000,
  templateParams: { power_buff: 4000 },
  effectSpecV2: {
    clauses: [
      {
        trigger: 'on_play',
        action: { kind: 'power_buff', magnitude: 4000, duration: 'this_battle' },
        target: { kind: 'your_leader_or_character' },
        verified: 'human-reviewed',
      },
      {
        trigger: 'on_play',
        action: { kind: 'removal_bounce' },
        target: { kind: 'opp_character', filter: { costMax: 3, rested: false } },
        verified: 'human-reviewed',
      },
    ],
    continuous: [],
    replacements: [],
    schemaVersion: 2,
    verified: 'human-reviewed',
  },
};

async function seedOp01_086InHand(page: Page, def: unknown): Promise<string> {
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
    if (!lib['OP01-086']) lib['OP01-086'] = def;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { hand: string[] } };
    const iid = `seedOverheat_${Math.floor(Math.random() * 1e9).toString(36)}`;
    inst[iid] = {
      instanceId: iid, cardId: 'OP01-086', controller: 'A',
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
  await page.waitForTimeout(1_200);
}

interface ZoneSnap {
  bFieldIds: string[];
  bHandIds: string[];
  bTrashIds: string[];
  aTrashIds: string[];
  aHandIds: string[];
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
              A: { hand: string[]; trash: string[] };
              B: {
                hand: string[];
                trash: string[];
                field: { instanceId: string }[];
              };
            };
          };
        };
      };
    };
    if (!w.__store) {
      return {
        bFieldIds: [], bHandIds: [], bTrashIds: [],
        aTrashIds: [], aHandIds: [],
        phase: '', activePlayer: '', pendingKind: null,
      };
    }
    const s = w.__store.getState().state;
    return {
      bFieldIds: s.players.B.field.map((i) => i.instanceId),
      bHandIds: [...s.players.B.hand],
      bTrashIds: [...s.players.B.trash],
      aTrashIds: [...s.players.A.trash],
      aHandIds: [...s.players.A.hand],
      phase: s.phase,
      activePlayer: s.activePlayer,
      pendingKind: s.pending?.kind ?? null,
    };
  });
}

// True iff a button with this instance id is currently rendered INSIDE
// opp's field (Character area). Source: src/components/PlayfieldStage.tsx:155
// + :387.
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

// Read opp hand count from a visible UI display. Hand cards in opp's
// half are not rendered (face-down to viewer), but the hand pip/badge
// shows the count. Falls back to engine state if the UI display is
// absent — we still cover the engine-truth check.
async function readOppHandUiCount(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('[aria-label]'));
    for (const el of candidates) {
      const label = el.getAttribute('aria-label') ?? '';
      const m = label.match(/(?:opponent hand|opp hand|Opponent's hand|Their hand)[^\d]*(\d+)/i);
      if (m) return parseInt(m[1]!, 10);
    }
    return null;
  });
}

test.describe('family-bounce (Stage A)', () => {
  test('OP01-086 Overheat on_play: bounce one active cost≤3 opp char to hand; control char survives', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { drv, pageErrors, invariantErrors } = await bootstrap(page);
    void drv;

    // ── Precondition ─────────────────────────────────────────────────
    const pre = await readZones(page);
    expect(pre.phase, 'phase=main').toBe('main');
    expect(pre.activePlayer, 'A turn').toBe('A');
    expect(pre.pendingKind, 'no pending').toBeNull();

    // ── Seed scene ───────────────────────────────────────────────────
    // B target: cost 2, power 3000, active. Passes {costMax:3, rested:false}.
    const bTargetIid = await seedOppFieldChar(page, 3000, 'target', 2, false);
    // B control: cost 5, power 3000, active. Fails costMax filter.
    const bControlIid = await seedOppFieldChar(page, 3000, 'control', 5, false);
    const overheatIid = await seedOp01_086InHand(page, OP01_086_DEF);
    // OP01-086 cost=2; T1 A has 1 DON → top up by 1.
    await topUpADon(page, 1);

    // ── BEFORE ──────────────────────────────────────────────────────
    const before = await readZones(page);
    expect(before.bFieldIds, 'B field has both seeded chars').toEqual(expect.arrayContaining([bTargetIid, bControlIid]));
    expect(before.bFieldIds.length, 'B field count = 2 before').toBe(2);
    const bHandBefore = before.bHandIds.length;
    const bTrashBefore = before.bTrashIds.length;
    const aTrashBefore = before.aTrashIds.length;
    expect(before.aHandIds, 'OP01-086 in A hand before').toContain(overheatIid);

    // UI: both B characters visible on opp field.
    expect(await isOnOpponentField(page, bTargetIid), 'B target on field before').toBe(true);
    expect(await isOnOpponentField(page, bControlIid), 'B control on field before').toBe(true);
    const oppHandUiBefore = await readOppHandUiCount(page);

    // ── Play OP01-086 ───────────────────────────────────────────────
    await playFromHand(page, overheatIid);

    // ── AFTER ────────────────────────────────────────────────────────
    const after = await readZones(page);

    // Engine: B target removed from field, NOW IN B HAND, NOT in B trash.
    expect(after.bFieldIds, 'B field no longer contains target').not.toContain(bTargetIid);
    expect(after.bFieldIds, 'B field still contains control').toContain(bControlIid);
    expect(after.bFieldIds.length, 'B field count = 1 after').toBe(1);
    expect(after.bHandIds, 'B hand now contains bounced target').toContain(bTargetIid);
    expect(after.bHandIds.length, 'B hand count +1').toBe(bHandBefore + 1);
    expect(after.bTrashIds, 'B trash does NOT contain bounced target').not.toContain(bTargetIid);
    expect(after.bTrashIds.length, 'B trash count unchanged').toBe(bTrashBefore);

    // Engine: OP01-086 left A hand → A trash (event resolution).
    expect(after.aHandIds, 'OP01-086 no longer in A hand').not.toContain(overheatIid);
    expect(after.aTrashIds, 'OP01-086 in A trash after event resolves').toContain(overheatIid);
    expect(after.aTrashIds.length, 'A trash count +1').toBe(aTrashBefore + 1);

    // UI: target gone from opp field; control still present.
    await expect.poll(
      async () => isOnOpponentField(page, bTargetIid),
      { timeout: 5_000, message: 'B target removed from field after bounce' },
    ).toBe(false);
    expect(await isOnOpponentField(page, bControlIid), 'B control still on field').toBe(true);

    // UI: opp hand count display, if present, reflects +1.
    const oppHandUiAfter = await readOppHandUiCount(page);
    if (oppHandUiBefore !== null && oppHandUiAfter !== null) {
      expect(oppHandUiAfter, 'opp hand UI count +1 after bounce').toBe(oppHandUiBefore + 1);
    }

    // ── Stability ────────────────────────────────────────────────────
    expect(after.pendingKind, 'no stuck pending after on_play').toBeNull();
    expect(after.phase, 'phase still main').toBe('main');
    expect(after.activePlayer, 'still A turn').toBe('A');
    expect(pageErrors, 'no pageerrors').toEqual([]);
    expect(invariantErrors, 'no InvariantErrors').toEqual([]);
  });
});
