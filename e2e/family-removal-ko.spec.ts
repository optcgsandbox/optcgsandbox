// family-removal-ko — Stage A representative anchor for the removal_ko
// mechanic family. Verifies OP01-026 Gum-Gum Fire-Fist Pistol Red
// Hawk's KO clause:
//   `[On Play] K.O. up to 1 of your opponent's Characters with 4000
//    power or less.`
// is reflected in BOTH engine state (target removed from B.field,
// pushed to B.trash) and the visible UI (B field button gone, control
// char button still present).
//
// Engine path:
//   - PLAY_CARD reducer for events pays DON, hand → A.trash, fires
//     on_play. Source: shared/engine-v2/reducers/mainPhase.ts:125-160.
//   - removal_ko action: splices target from field, pushes to opp
//     trash, fires on_ko/triggers. Source:
//     shared/engine-v2/registry/handlers/actions.ts:140-205.
//   - target resolver `opp_character` with filter:{powerMax:4000}
//     deterministically picks first eligible (no UI prompt). Source:
//     shared/engine-v2/registry/handlers/targets.ts:87-92.
//
// Note: OP01-026 also has a +4000 power_buff `your_leader_or_character`
// `this_battle` clause that fires on play. Outside a battle context,
// `powerModifierThisBattle` is written but the leader/char selected
// (deterministic resolver) is just A's leader. Out of scope here —
// power_buff this_battle is exercised in family-power-boost.
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

// Seed B character with given power and tag. Lower-cost (3) so filter
// hits power, not cost.
async function seedOppFieldChar(page: Page, power: number, tag: string, cost: number): Promise<string> {
  return page.evaluate(({ power, tag, cost }) => {
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
    const synthId = `__seed_rko_b_${tag}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    const iid = `seedRKOb_${tag}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    lib[synthId] = {
      id: synthId, name: `RKO B ${tag}`, kind: 'character',
      cost, power, counterValue: 1000,
      colors: ['red','green','blue','purple','black','yellow'],
      traits: [], keywords: [],
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
  }, { power, tag, cost });
}

// Card definition copied verbatim from shared/data/cards.json so the
// engine resolves on_play through the live registry. cardLibrary is
// only populated with cards in the active decks; non-deck cards must
// be injected before seeding the instance.
const OP01_026_DEF = {
  id: 'OP01-026',
  name: 'Gum-Gum Fire-Fist Pistol Red Hawk',
  kind: 'event',
  colors: ['red'],
  cost: 2,
  power: null,
  counterValue: null,
  traits: ['Supernovas', 'Straw Hat Crew'],
  keywords: [],
  effectTags: ['counter_event', 'power_buff', 'removal_ko'],
  effectText: "[Counter] Up to 1 of your Leader or Character cards gains +4000 power during this battle. Then, K.O. up to 1 of your opponent's Characters with 4000 power or less.",
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
        action: { kind: 'removal_ko' },
        target: { kind: 'opp_character', filter: { powerMax: 4000 } },
        verified: 'human-reviewed',
      },
    ],
    continuous: [],
    replacements: [],
    schemaVersion: 2,
    verified: 'human-reviewed',
  },
};

// Force OP01-026 into A's hand. Injects card def into cardLibrary
// first if missing (default red deck does not include this event).
async function seedOp01_026InHand(page: Page, def: unknown): Promise<string> {
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
    if (!lib['OP01-026']) lib['OP01-026'] = def;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { hand: string[] } };
    const iid = `seedRedHawk_${Math.floor(Math.random() * 1e9).toString(36)}`;
    inst[iid] = {
      instanceId: iid, cardId: 'OP01-026', controller: 'A',
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

// Move N DON from A.donDeck → A.donCostArea so cost=2 events become
// playable on turn 1 (default DON is 1).
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
  // Allow EventCardOverlay slide-to-trash animation + Framer exit to settle.
  await page.waitForTimeout(1_200);
}

interface ZoneSnap {
  bFieldIds: string[];
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
                field: { instanceId: string }[];
                trash: string[];
              };
            };
          };
        };
      };
    };
    if (!w.__store) {
      return { bFieldIds: [], bTrashIds: [], aTrashIds: [], aHandIds: [], phase: '', activePlayer: '', pendingKind: null };
    }
    const s = w.__store.getState().state;
    return {
      bFieldIds: s.players.B.field.map((i) => i.instanceId),
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
// the opponent's field (Character area). Required because trash zones
// also render CardArt with `inst=` and therefore carry the same
// data-instance-id; a global query would still find the KO'd char as
// long as it's the top of trash (slot preview).
//
// Field region selector source: src/components/PlayfieldStage.tsx:155
// (role=region aria-label="Character area, 5 slots") under
// :387 "Opponent half".
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

test.describe('family-removal-ko (Stage A)', () => {
  test('OP01-026 Red Hawk on_play: KO one opp char with power ≤ 4000; control char survives', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { drv, pageErrors, invariantErrors } = await bootstrap(page);
    void drv;

    // ── Precondition ─────────────────────────────────────────────────
    const pre = await readZones(page);
    expect(pre.phase, 'phase=main').toBe('main');
    expect(pre.activePlayer, 'A turn').toBe('A');
    expect(pre.pendingKind, 'no pending').toBeNull();

    // ── Seed scene ───────────────────────────────────────────────────
    // B target: power 3000, cost 3. Passes filter (powerMax 4000).
    const bTargetIid = await seedOppFieldChar(page, 3000, 'target', 3);
    // B control: power 5000, cost 3. Fails powerMax filter → unaffected.
    const bControlIid = await seedOppFieldChar(page, 5000, 'control', 3);
    const redHawkIid = await seedOp01_026InHand(page, OP01_026_DEF);
    // OP01-026 cost=2; T1 A has 1 DON → top up by 1.
    await topUpADon(page, 1);

    // ── BEFORE ──────────────────────────────────────────────────────
    const before = await readZones(page);
    expect(before.bFieldIds, 'B field has both seeded chars').toEqual(expect.arrayContaining([bTargetIid, bControlIid]));
    expect(before.bFieldIds.length, 'B field count = 2 before').toBe(2);
    const bTrashBefore = before.bTrashIds.length;
    const aTrashBefore = before.aTrashIds.length;
    expect(before.aHandIds, 'OP01-026 is in A hand').toContain(redHawkIid);

    // UI: both B characters visible on opponent's field.
    expect(await isOnOpponentField(page, bTargetIid), 'B target on field before').toBe(true);
    expect(await isOnOpponentField(page, bControlIid), 'B control on field before').toBe(true);

    // ── Play OP01-026 ───────────────────────────────────────────────
    await playFromHand(page, redHawkIid);

    // ── AFTER ───────────────────────────────────────────────────────
    const after = await readZones(page);

    // Engine: B target removed from field, in B's trash.
    expect(after.bFieldIds, 'B field no longer contains target').not.toContain(bTargetIid);
    expect(after.bFieldIds, 'B field still contains control').toContain(bControlIid);
    expect(after.bFieldIds.length, 'B field count = 1 after').toBe(1);
    expect(after.bTrashIds, 'B trash contains KO\'d target').toContain(bTargetIid);
    expect(after.bTrashIds.length, 'B trash count +1').toBe(bTrashBefore + 1);

    // Engine: OP01-026 left A hand and went to A trash (event resolution).
    expect(after.aHandIds, 'OP01-026 no longer in A hand').not.toContain(redHawkIid);
    expect(after.aTrashIds, 'OP01-026 in A trash after event resolves').toContain(redHawkIid);
    expect(after.aTrashIds.length, 'A trash count +1').toBe(aTrashBefore + 1);

    // UI: target gone from field; control still on field. Note: KO'd
    // target still has a CardArt rendered inside opp trash slot preview
    // (TrashSlot keeps inst= so it inherits data-instance-id). Scope
    // the assertion to field only.
    await expect.poll(
      async () => isOnOpponentField(page, bTargetIid),
      { timeout: 5_000, message: 'B target removed from field after KO' },
    ).toBe(false);
    expect(await isOnOpponentField(page, bControlIid), 'B control still on field').toBe(true);

    // ── Stability ────────────────────────────────────────────────────
    expect(after.pendingKind, 'no stuck pending after on_play resolves').toBeNull();
    expect(after.phase, 'phase still main').toBe('main');
    expect(after.activePlayer, 'still A turn').toBe('A');
    expect(pageErrors, 'no pageerrors').toEqual([]);
    expect(invariantErrors, 'no InvariantErrors').toEqual([]);
  });
});
