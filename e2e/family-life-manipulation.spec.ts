// family-life-manipulation — Stage A representative anchor for the
// life manipulation mechanic family. Verifies OP15-115 Impact Dial's
// life_to_hand clause:
//   `[Main] K.O. up to 1 of your opponent's Characters with a cost of
//    4 or less. Then, add 1 card from the top of your Life cards to
//    your hand.`
//
// Isolation: B.field is empty at A's T1 main, so the first clause's
// `opp_character` resolver returns empty targets and `removal_ko`
// no-ops. Only the `life_to_hand` clause produces observable state.
//
// Engine sources:
//   - life_to_hand action V0 deterministic: shifts top of
//     controller.life → controller.hand. If life=0, sets game result.
//     Source: shared/engine-v2/registry/handlers/actions3.ts:100-109.
//   - PLAY_CARD reducer event path: pay DON, hand→A.trash, fire on_play.
//     Source: shared/engine-v2/reducers/mainPhase.ts:125-160.
//   - opp_character resolver returns empty when opp.field is empty.
//     Source: shared/engine-v2/registry/handlers/targets.ts:87-92.
//   - removal_ko iterates targets; empty targets ⇒ no-op.
//     Source: shared/engine-v2/registry/handlers/actions.ts:140-205.
//   - LifeStack UI aria-label "Your life: N" /
//     "Opponent life: N". Source: src/components/zones/LifeStack.tsx:47.
//   - Color identity bypass (Impact Dial yellow vs A red leader):
//     dispatch path bypasses `legality.ts:178` (gate is legality-only).
//
// Anchor pre-check: only 1 OP01 card matches life family (OP01-009
// Carrot, `trigger from life` / `play_self_from_life`) — not
// representative of broader life manipulation. OP15-115 Impact Dial
// chosen as cleanest non-OP01 anchor with isolated `life_to_hand`.
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

const OP15_115_DEF = {
  id: 'OP15-115',
  name: 'Impact Dial',
  kind: 'event',
  colors: ['yellow'],
  cost: 2,
  power: null,
  counterValue: null,
  traits: ['Sky Island', 'Straw Hat Crew'],
  keywords: ['activate_main'],
  effectTags: ['removal_ko', 'life_to_hand'],
  effectText: '[Main] K.O. up to 1 of your opponent\'s Characters with a cost of 4 or less. Then, add 1 card from the top of your Life cards to your hand.',
  counterEventBoost: null,
  effectSpecV2: {
    schemaVersion: 2,
    verified: 'human-reviewed',
    clauses: [
      {
        trigger: 'on_play',
        action: { kind: 'removal_ko' },
        target: { kind: 'opp_character', filter: { costMax: 4 } },
        verified: 'auto',
      },
      {
        trigger: 'on_play',
        action: { kind: 'life_to_hand', magnitude: 1 },
        verified: 'auto',
      },
    ],
    continuous: [],
    replacements: [],
  },
};

async function seedImpactDialInHand(page: Page, def: unknown): Promise<string> {
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
    if (!lib['OP15-115']) lib['OP15-115'] = def;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { hand: string[] } };
    const iid = `seedImpactDial_${Math.floor(Math.random() * 1e9).toString(36)}`;
    inst[iid] = {
      instanceId: iid, cardId: 'OP15-115', controller: 'A',
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

interface Snap {
  phase: string;
  activePlayer: string;
  pendingKind: string | null;
  aLife: string[];
  aHand: string[];
  aTrash: string[];
  aDeck: string[];
  bField: string[];
  bLife: number;
  historyTypes: string[];
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
              A: { hand: string[]; trash: string[]; deck: string[]; life: string[] };
              B: { field: { instanceId: string }[]; life: string[] };
            };
            history: ReadonlyArray<{ type?: string }>;
          };
        };
      };
    };
    if (!w.__store) {
      return { phase: '', activePlayer: '', pendingKind: null, aLife: [], aHand: [], aTrash: [], aDeck: [], bField: [], bLife: -1, historyTypes: [] };
    }
    const s = w.__store.getState().state;
    return {
      phase: s.phase,
      activePlayer: s.activePlayer,
      pendingKind: s.pending?.kind ?? null,
      aLife: [...s.players.A.life],
      aHand: [...s.players.A.hand],
      aTrash: [...s.players.A.trash],
      aDeck: [...s.players.A.deck],
      bField: s.players.B.field.map((i) => i.instanceId),
      bLife: s.players.B.life.length,
      historyTypes: s.history.map((h) => h.type ?? '?'),
    };
  });
}

async function readYourLifeUi(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('[aria-label]'));
    for (const el of els) {
      const m = (el.getAttribute('aria-label') ?? '').match(/Your life:\s*(\d+)/i);
      if (m) return parseInt(m[1]!, 10);
    }
    return null;
  });
}

async function readOpponentLifeUi(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('[aria-label]'));
    for (const el of els) {
      const m = (el.getAttribute('aria-label') ?? '').match(/Opponent life:\s*(\d+)/i);
      if (m) return parseInt(m[1]!, 10);
    }
    return null;
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

test.describe('family-life-manipulation (Stage A)', () => {
  test('OP15-115 Impact Dial on_play life_to_hand: top of A.life → A.hand; life UI decrements', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { drv, pageErrors, invariantErrors } = await bootstrap(page);
    void drv;

    // ── Seed Impact Dial + DON ──────────────────────────────────────
    const dialIid = await seedImpactDialInHand(page, OP15_115_DEF);
    // Impact Dial cost 2; T1 A has 1 DON → top up 1.
    await topUpADon(page, 1);

    // ── BEFORE ──────────────────────────────────────────────────────
    const before = await readSnap(page);
    expect(before.phase, 'phase=main').toBe('main');
    expect(before.activePlayer, 'A turn').toBe('A');
    expect(before.pendingKind, 'no pending').toBeNull();
    expect(before.bField.length, 'B field empty (removal_ko clause no-ops)').toBe(0);
    expect(before.aHand, 'Impact Dial in A hand').toContain(dialIid);
    expect(before.aLife.length, 'A life = 5 at game start').toBe(5);
    expect(before.bLife, 'B life = 5').toBe(5);
    const aLifeBefore = before.aLife.length;
    const aHandBefore = before.aHand.length;
    const aTrashBefore = before.aTrash.length;
    const aDeckBefore = before.aDeck.length;
    const lifeTopIid = before.aLife[0]!; // engine shift() removes head
    const lifeUiBefore = await readYourLifeUi(page);
    const oppLifeUiBefore = await readOpponentLifeUi(page);
    const handUiBefore = await readHandUiCount(page);

    // ── Play Impact Dial ────────────────────────────────────────────
    await playFromHand(page, dialIid);

    // ── AFTER ────────────────────────────────────────────────────────
    const after = await readSnap(page);

    // Engine: Impact Dial out of A.hand, in A.trash (event resolution).
    expect(after.aHand, 'Impact Dial not in A hand').not.toContain(dialIid);
    expect(after.aTrash, 'Impact Dial in A trash').toContain(dialIid);
    expect(after.aTrash.length, 'A trash +1 (Impact Dial)').toBe(aTrashBefore + 1);

    // Engine: life_to_hand fired. Top of A.life (lifeTopIid) → A.hand.
    expect(after.aLife.length, 'A life -1').toBe(aLifeBefore - 1);
    expect(after.aLife, 'A life no longer contains pre-play life top').not.toContain(lifeTopIid);
    expect(after.aHand, 'pre-play life top now in A hand').toContain(lifeTopIid);

    // Engine: A hand net = -1 (Impact Dial out) +1 (life card in) = 0.
    expect(after.aHand.length, 'A hand net 0 (Impact Dial out + life card in)').toBe(aHandBefore);

    // Engine: A deck unchanged (no draw, no ramp).
    expect(after.aDeck.length, 'A deck unchanged').toBe(aDeckBefore);

    // Engine: removal_ko clause no-op (B.field still empty).
    expect(after.bField.length, 'B field still empty (removal_ko no-op)').toBe(0);

    // Engine: B life unchanged.
    expect(after.bLife, 'B life unchanged').toBe(before.bLife);

    // Engine: history records EVENT_ACTIVATED for the event resolution.
    expect(after.historyTypes, 'history records EVENT_ACTIVATED').toContain('EVENT_ACTIVATED');

    // Engine: pending null, phase main, A turn.
    expect(after.pendingKind, 'no pending after event resolves').toBeNull();
    expect(after.phase, 'phase still main').toBe('main');
    expect(after.activePlayer, 'still A turn').toBe('A');

    // ── UI ───────────────────────────────────────────────────────────
    // LifeStack count -1.
    const lifeUiAfter = await readYourLifeUi(page);
    if (lifeUiBefore !== null && lifeUiAfter !== null) {
      expect(lifeUiAfter, 'Your life UI -1').toBe(lifeUiBefore - 1);
    }
    // Opponent life unchanged.
    const oppLifeUiAfter = await readOpponentLifeUi(page);
    if (oppLifeUiBefore !== null && oppLifeUiAfter !== null) {
      expect(oppLifeUiAfter, 'Opponent life UI unchanged').toBe(oppLifeUiBefore);
    }
    // Hand UI net 0 (Impact Dial out + life card in).
    const handUiAfter = await readHandUiCount(page);
    if (handUiBefore !== null && handUiAfter !== null) {
      expect(handUiAfter, 'A hand UI net 0').toBe(handUiBefore);
    }

    // ── Stability ────────────────────────────────────────────────────
    expect(pageErrors, 'no pageerrors').toEqual([]);
    expect(invariantErrors, 'no InvariantErrors').toEqual([]);
  });
});
