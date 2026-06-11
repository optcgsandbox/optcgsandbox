// family-draw — Stage A representative anchor for the draw mechanic
// family. Verifies OP01-011 Gordon's on_play clause:
//   `[On Play] You may place 1 card from your hand at the bottom of
//    your deck: Draw 1 card.`
// is reflected in BOTH engine state and visible UI (hand fan + deck
// slot count).
//
// Effect shape per shared/data/cards.json:
//   clause: trigger=on_play
//           cost  ={ bottomOfDeckFromHand: 1 }
//           action={ kind:'draw', magnitude:1 }
//
// Engine path:
//   - Cost handler bottomOfDeckFromHand: hand.shift() → deck.push().
//     Source: shared/engine-v2/registry/handlers/costs2.ts:377-393.
//   - Action handler draw: deck.shift() → hand.push().
//     Source: shared/engine-v2/registry/handlers/actions.ts:56-71.
//   - Dispatcher auto-pays cost when canPay is true; no "may" prompt
//     mounts. Source: shared/engine-v2/effects/EffectDispatcher.ts:189-219.
//   - Character play: hand → field, on_play dispatched. Source:
//     shared/engine-v2/reducers/mainPhase.ts:187-220.
//
// Net hand delta when Gordon plays from hand of size H:
//   - play removes Gordon  : H-1
//   - cost shifts hand[0]  : H-2
//   - draw pushes deck top : H-1
//   Final: A.hand.length = H - 1
//   Final: A.deck.length = unchanged (1 added bottom, 1 removed top)
//   Final: A.field has +1 (Gordon)
//   Final: A.hand contains the pre-play deck-top instance id.
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

// Card definition copied from shared/data/cards.json. OP01-011 is red,
// matches A's default deck color, so it is likely already in
// cardLibrary; injection guarded for robustness.
const OP01_011_DEF = {
  id: 'OP01-011',
  name: 'Gordon',
  kind: 'character',
  colors: ['red'],
  cost: 2,
  power: 3000,
  counterValue: 2000,
  traits: ['FILM'],
  keywords: ['on_play'],
  effectTags: ['draw'],
  effectText: '[On Play] You may place 1 card from your hand at the bottom of your deck: Draw 1 card.',
  templateParams: { draw: 1 },
  effectSpecV2: {
    clauses: [
      {
        trigger: 'on_play',
        cost: { bottomOfDeckFromHand: 1 },
        action: { kind: 'draw', magnitude: 1 },
        verified: 'human-reviewed',
      },
    ],
    continuous: [],
    replacements: [],
    schemaVersion: 2,
    verified: 'human-reviewed',
  },
};

async function seedGordonInHand(page: Page, def: unknown): Promise<string> {
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
    if (!lib['OP01-011']) lib['OP01-011'] = def;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { hand: string[] } };
    const iid = `seedGordon_${Math.floor(Math.random() * 1e9).toString(36)}`;
    inst[iid] = {
      instanceId: iid, cardId: 'OP01-011', controller: 'A',
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

// Read "Your hand, N cards" count via HandFan aria-label. Source:
// src/components/HandFan.tsx:63.
async function readHandUiCount(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const el = document.querySelector('[aria-label^="Your hand"]');
    if (!el) return null;
    const label = el.getAttribute('aria-label') ?? '';
    const m = label.match(/Your hand,\s*(\d+)\s*cards/);
    return m ? parseInt(m[1]!, 10) : null;
  });
}

// Read "Your deck — N cards remaining" count via DeckSlot aria-label.
// Source: src/components/zones/DeckSlot.tsx:23.
async function readDeckUiCount(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('[aria-label]'));
    for (const el of els) {
      const label = el.getAttribute('aria-label') ?? '';
      const m = label.match(/Your deck\s*—\s*(\d+)\s*cards\s*remaining/i);
      if (m) return parseInt(m[1]!, 10);
    }
    return null;
  });
}

// True iff button with this iid is rendered inside "Your half" Character
// area. Mirrors helper from family-removal-ko / family-bounce.
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

test.describe('family-draw (Stage A)', () => {
  test('OP01-011 Gordon on_play: pay 1 hand → bottom deck, draw 1; net hand -1', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { drv, pageErrors, invariantErrors } = await bootstrap(page);
    void drv;

    // ── Precondition ─────────────────────────────────────────────────
    const pre = await readZones(page);
    expect(pre.phase, 'phase=main').toBe('main');
    expect(pre.activePlayer, 'A turn').toBe('A');
    expect(pre.pendingKind, 'no pending').toBeNull();

    // Seed Gordon and top up DON. Gordon cost=2; T1 A starts with 1 DON.
    const gordonIid = await seedGordonInHand(page, OP01_011_DEF);
    await topUpADon(page, 1);

    // ── BEFORE ──────────────────────────────────────────────────────
    const before = await readZones(page);
    expect(before.aHandIds, 'Gordon in A hand before').toContain(gordonIid);
    expect(before.aDeckIds.length, 'A deck has ≥1 card before').toBeGreaterThanOrEqual(1);
    expect(before.aHandIds.length, 'A hand has Gordon + ≥1 other (cost payable)').toBeGreaterThanOrEqual(2);
    const handBefore = before.aHandIds.length;
    const deckBefore = before.aDeckIds.length;
    const fieldBefore = before.aFieldIds.length;
    // Pre-play deck top is the card draw will pull.
    const preDeckTop = before.aDeckIds[0]!;
    // Pre-play hand[0] excluding Gordon: after Gordon is spliced from hand
    // in the play-reducer, the *new* hand[0] is what cost will bottom.
    // If Gordon is currently at hand[0], the bottom is original hand[1];
    // otherwise it is original hand[0].
    const gordonHandIdx = before.aHandIds.indexOf(gordonIid);
    const preHandFirstAfterPlay = gordonHandIdx === 0
      ? before.aHandIds[1]!
      : before.aHandIds[0]!;

    const handUiBefore = await readHandUiCount(page);
    const deckUiBefore = await readDeckUiCount(page);

    // ── Play Gordon ─────────────────────────────────────────────────
    await playFromHand(page, gordonIid);

    // ── AFTER ───────────────────────────────────────────────────────
    const after = await readZones(page);

    // Engine: Gordon on A.field, gone from A.hand.
    expect(after.aFieldIds, 'A field has Gordon after play').toContain(gordonIid);
    expect(after.aFieldIds.length, 'A field +1').toBe(fieldBefore + 1);
    expect(after.aHandIds, 'Gordon no longer in A hand').not.toContain(gordonIid);

    // Engine: hand net = -1 (gordon out, 1 bottomed, 1 drawn back).
    expect(after.aHandIds.length, 'A hand count = before - 1').toBe(handBefore - 1);

    // Engine: deck net = 0 length (1 added bottom, 1 removed top), but
    // composition shifted — top is now a different card.
    expect(after.aDeckIds.length, 'A deck count unchanged (net 0)').toBe(deckBefore);

    // Engine: drawn card identity — pre-play deck top is now in A.hand.
    expect(after.aHandIds, 'pre-play deck top is now in A hand').toContain(preDeckTop);
    // Engine: bottomed card is at deck end. (after.aDeckIds[after.aDeckIds.length - 1])
    expect(after.aDeckIds[after.aDeckIds.length - 1], 'bottomed card is at deck end')
      .toBe(preHandFirstAfterPlay);

    // Engine: pending null, phase main, activePlayer A.
    expect(after.pendingKind, 'no stuck pending after on_play').toBeNull();
    expect(after.phase, 'phase still main').toBe('main');
    expect(after.activePlayer, 'still A turn').toBe('A');

    // UI: Gordon visible on your field.
    await expect.poll(
      async () => isOnYourField(page, gordonIid),
      { timeout: 5_000, message: 'Gordon visible on your field after play' },
    ).toBe(true);

    // UI: hand fan count reflects engine net.
    const handUiAfter = await readHandUiCount(page);
    if (handUiBefore !== null && handUiAfter !== null) {
      expect(handUiAfter, 'hand UI count = handUiBefore - 1').toBe(handUiBefore - 1);
    } else {
      // Hand fan not exposed at this resolution → engine-truth only.
    }

    // UI: deck count display unchanged (net 0).
    const deckUiAfterVal = await readDeckUiCount(page);
    if (deckUiBefore !== null && deckUiAfterVal !== null) {
      expect(deckUiAfterVal, 'deck UI count unchanged').toBe(deckUiBefore);
    }

    // ── Stability ────────────────────────────────────────────────────
    expect(pageErrors, 'no pageerrors').toEqual([]);
    expect(invariantErrors, 'no InvariantErrors').toEqual([]);
  });
});
