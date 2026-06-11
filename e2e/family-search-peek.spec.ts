// family-search-peek — Stage A representative anchor for the
// search / peek mechanic family. Verifies OP01-016 Nami's on_play
// clause:
//   `[On Play] Look at 5 cards from the top of your deck; reveal up to
//    1 {Straw Hat Crew} type card other than [Nami] and add it to your
//    hand. Then, place the rest at the bottom of your deck in any
//    order.`
//
// Engine path (V0 deterministic — NO UI prompt):
//   - searcher_peek action: peek top `lookCount`; first `addCount`
//     matching `filter` → hand; leftovers routed per
//     `leftoverPlacement` (default 'bottom'). Source:
//     shared/engine-v2/registry/handlers/actions3.ts:826-918.
//   - V0 comment at :826-832 confirms deterministic behavior — no
//     peek_pick pending mounts.
//
// Note on card-data audit flag: cards.json marks the spec as `flagged`
// because the printed text excludes [Nami] but the spec lacks
// `nameExcludes:"Nami"`. That mismatch is a CARD_DATA_BUG but only
// surfaces when the peek contains another Nami. Our scenario seeds
// non-Nami Straw Hat Crew + ineligible fillers, so the audit flag is
// not exercised here.
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

// OP01-016 Nami — copied verbatim from shared/data/cards.json. Red so
// it likely is already in cardLibrary; injection guarded for safety.
const OP01_016_DEF = {
  id: 'OP01-016',
  name: 'Nami',
  kind: 'character',
  colors: ['red'],
  cost: 1,
  power: 2000,
  counterValue: 1000,
  traits: ['Straw Hat Crew'],
  keywords: ['on_play'],
  effectTags: ['searcher'],
  effectText: '[On Play] Look at 5 cards from the top of your deck; reveal up to 1 {Straw Hat Crew} type card other than [Nami] and add it to your hand. Then, place the rest at the bottom of your deck in any order.',
  effectSpecV2: {
    clauses: [
      {
        trigger: 'on_play',
        action: {
          kind: 'searcher_peek',
          lookCount: 5,
          addCount: 1,
          filter: { trait: 'Straw Hat Crew' },
          leftoverPlacement: 'bottom',
        },
        verified: 'auto',
      },
    ],
    continuous: [],
    replacements: [],
    schemaVersion: 2,
    verified: 'flagged',
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
    if (!lib['OP01-016']) lib['OP01-016'] = def;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { hand: string[] } };
    const iid = `seedNami_${Math.floor(Math.random() * 1e9).toString(36)}`;
    inst[iid] = {
      instanceId: iid, cardId: 'OP01-016', controller: 'A',
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

// Stack the top 5 slots of A.deck with deterministic synth cards.
// Returns the seeded instance ids in [pos0, pos1, pos2, pos3, pos4]
// order. pos1 is the Straw Hat Crew (eligible) target; others are
// ineligible "Land of Wano" trait cards.
async function stackADeckTop(page: Page): Promise<{
  ineligible0: string;
  eligible1: string;
  ineligible2: string;
  ineligible3: string;
  ineligible4: string;
}> {
  return page.evaluate(() => {
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
    const players = s.players as { A: { deck: string[] } };

    function mkCard(name: string, trait: string): { id: string; iid: string } {
      const id = `__seed_sp_${name}_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `seedSP_${name}_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[id] = {
        id, name, kind: 'character',
        cost: 1, power: 1000, counterValue: 1000,
        colors: ['red'],
        traits: [trait],
        keywords: [],
        effectText: '',
      };
      inst[iid] = {
        instanceId: iid, cardId: id, controller: 'A',
        rested: false, summoningSick: false,
        attachedDon: [], attachedDonRested: [],
        perTurn: { hasAttacked: false, effectsUsed: [] },
      };
      return { id, iid };
    }

    const c0 = mkCard('SP Ineligible 0', 'Land of Wano');
    const c1 = mkCard('SP Eligible 1', 'Straw Hat Crew');
    const c2 = mkCard('SP Ineligible 2', 'Land of Wano');
    const c3 = mkCard('SP Ineligible 3', 'Land of Wano');
    const c4 = mkCard('SP Ineligible 4', 'Land of Wano');

    // Insert at positions 0..4 (front of deck = top of deck).
    players.A.deck.unshift(c4.iid);
    players.A.deck.unshift(c3.iid);
    players.A.deck.unshift(c2.iid);
    players.A.deck.unshift(c1.iid);
    players.A.deck.unshift(c0.iid);

    w.__store.setState({ state: { ...s } });
    if (w.__getLegalActions) {
      const next = w.__store.getState().state as { activePlayer: string };
      w.__store.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
    return {
      ineligible0: c0.iid,
      eligible1: c1.iid,
      ineligible2: c2.iid,
      ineligible3: c3.iid,
      ineligible4: c4.iid,
    };
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
  await page.waitForTimeout(900);
}

interface ZoneSnap {
  aHandIds: string[];
  aDeckIds: string[];
  aFieldIds: string[];
  aTrashIds: string[];
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
              A: {
                hand: string[];
                deck: string[];
                trash: string[];
                field: { instanceId: string }[];
              };
            };
          };
        };
      };
    };
    if (!w.__store) {
      return { aHandIds: [], aDeckIds: [], aFieldIds: [], aTrashIds: [], phase: '', activePlayer: '', pendingKind: null };
    }
    const s = w.__store.getState().state;
    return {
      aHandIds: [...s.players.A.hand],
      aDeckIds: [...s.players.A.deck],
      aFieldIds: s.players.A.field.map((i) => i.instanceId),
      aTrashIds: [...s.players.A.trash],
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

async function readDeckUiCount(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('[aria-label]'));
    for (const el of els) {
      const m = (el.getAttribute('aria-label') ?? '').match(/Your deck\s*—\s*(\d+)\s*cards\s*remaining/i);
      if (m) return parseInt(m[1]!, 10);
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

test.describe('family-search-peek (Stage A)', () => {
  test('OP01-016 Nami on_play: deterministic peek-5 → first Straw Hat Crew → hand; leftovers → deck bottom', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { drv, pageErrors, invariantErrors } = await bootstrap(page);
    void drv;

    // ── Precondition ─────────────────────────────────────────────────
    const pre = await readZones(page);
    expect(pre.phase, 'phase=main').toBe('main');
    expect(pre.activePlayer, 'A turn').toBe('A');
    expect(pre.pendingKind, 'no pending').toBeNull();

    // ── Seed ─────────────────────────────────────────────────────────
    const namiIid = await seedNamiInHand(page, OP01_016_DEF);
    const seeds = await stackADeckTop(page);

    // ── BEFORE ──────────────────────────────────────────────────────
    const before = await readZones(page);
    expect(before.aHandIds, 'Nami in A hand before').toContain(namiIid);
    // Top 5 deck slots match what we seeded.
    expect(before.aDeckIds.slice(0, 5), 'A deck top-5 = seeded order').toEqual([
      seeds.ineligible0,
      seeds.eligible1,
      seeds.ineligible2,
      seeds.ineligible3,
      seeds.ineligible4,
    ]);
    const handBefore = before.aHandIds.length;
    const deckBefore = before.aDeckIds.length;
    const fieldBefore = before.aFieldIds.length;
    const handUiBefore = await readHandUiCount(page);
    const deckUiBefore = await readDeckUiCount(page);

    // ── Play Nami ───────────────────────────────────────────────────
    await playFromHand(page, namiIid);

    // ── AFTER ────────────────────────────────────────────────────────
    const after = await readZones(page);

    // Engine: Nami on field.
    expect(after.aFieldIds, 'Nami on A field').toContain(namiIid);
    expect(after.aFieldIds.length, 'A field +1').toBe(fieldBefore + 1);
    expect(after.aHandIds, 'Nami not in A hand').not.toContain(namiIid);

    // Engine: eligible card moved from deck → hand.
    expect(after.aHandIds, 'eligible Straw Hat Crew card now in hand').toContain(seeds.eligible1);

    // Engine: top 5 slots no longer contain the seeded ids; they should
    // have shifted out of the top window. Ineligibles routed to deck
    // bottom in original peek order.
    expect(after.aDeckIds.slice(0, 5), 'A deck top 5 no longer contains seeded ineligibles').not.toContain(seeds.ineligible0);
    expect(after.aDeckIds.slice(0, 5), 'A deck top 5 no longer contains seeded ineligibles').not.toContain(seeds.eligible1);
    // Leftovers (4 ineligibles) appended to deck bottom in order
    // ineligible0, ineligible2, ineligible3, ineligible4.
    const tail = after.aDeckIds.slice(-4);
    expect(tail, 'leftovers placed at deck bottom in peek order').toEqual([
      seeds.ineligible0,
      seeds.ineligible2,
      seeds.ineligible3,
      seeds.ineligible4,
    ]);

    // Engine: counts. Hand net = -Nami (out) +1 (picked) = unchanged.
    // Deck net = -1 (only picked card removed permanently).
    expect(after.aHandIds.length, 'A hand count unchanged (Nami out, eligible in)').toBe(handBefore);
    expect(after.aDeckIds.length, 'A deck count -1').toBe(deckBefore - 1);

    // Engine: pending null, phase main, A turn.
    expect(after.pendingKind, 'no stuck pending').toBeNull();
    expect(after.phase, 'phase still main').toBe('main');
    expect(after.activePlayer, 'still A turn').toBe('A');

    // ── UI ───────────────────────────────────────────────────────────
    // Nami visible on your field.
    await expect.poll(
      async () => isOnYourField(page, namiIid),
      { timeout: 5_000, message: 'Nami visible on your field after play' },
    ).toBe(true);

    // Hand UI unchanged (net 0); Deck UI -1.
    const handUiAfter = await readHandUiCount(page);
    const deckUiAfter = await readDeckUiCount(page);
    if (handUiBefore !== null && handUiAfter !== null) {
      expect(handUiAfter, 'hand UI count unchanged').toBe(handUiBefore);
    }
    if (deckUiBefore !== null && deckUiAfter !== null) {
      expect(deckUiAfter, 'deck UI count -1').toBe(deckUiBefore - 1);
    }

    // ── Stability ────────────────────────────────────────────────────
    expect(pageErrors, 'no pageerrors').toEqual([]);
    expect(invariantErrors, 'no InvariantErrors').toEqual([]);
  });
});
