// family-when-attacking — Stage A representative anchor for the
// when_attacking mechanic family. Verifies OP01-102 Jack's clause:
//   `[When Attacking] DON!! -1 (return 1 DON from cost area to deck):
//    Your opponent trashes 1 card from their hand.`
//
// Engine sources:
//   - declareAttackReducer fires when_attacking clauses BEFORE the
//     block_window opens. Source:
//     shared/engine-v2/reducers/attackFlow.ts:230-253 (when_attacking
//     EffectDispatcher invocation pre-block).
//   - donCostReturnToDeck cost handler. Source:
//     shared/engine-v2/registry/handlers/costs2.ts:335-351.
//   - opp_discard_from_hand → discard_opp_hand V0 deterministic
//     head-of-hand. Source:
//     shared/engine-v2/registry/handlers/actions.ts:339-359 +
//     shared/engine-v2/registry/handlers/actions3.ts:80-81.
//   - First-turn no-attack rule (CR §6-5-6-1): no attacks on T1 for
//     first player, T2 for second player. Source:
//     shared/engine-v2/rules/legality.ts:215-221. Test forces turn=3
//     to bypass.
//   - block_window/counter_window auto-skip when reactive is AI
//     (B = AI_OPPONENT in vs-easy). Source: src/store/game.ts:498-510.
//
// Anchor card data (OP01-102 Jack): character, purple, cost 3, power
// 4000. Single clause: trigger:when_attacking, cost:donCostReturnToDeck:1,
// action:opp_discard_from_hand magnitude:1. No condition, no opt.
//
// Color identity: Jack purple vs A red leader — bypassed via dispatch
// path (legality-only gate). Same pattern as family-bounce / discard.
//
// Combat math: Jack 4000 vs B leader 5000 ⇒ attack FAILS by power. B
// life unchanged. when_attacking effect (discard) still fires per
// reducer ordering (effect fires before block_window mounts and before
// damage resolution).
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
  // Normalize dice RNG variance — see helpers/player.ts::normalizeToATurn1Main.
  await drv.normalizeToATurn1Main();
  return { drv, pageErrors, invariantErrors };
}

const OP01_102_DEF = {
  id: 'OP01-102',
  name: 'Jack',
  kind: 'character',
  colors: ['purple'],
  cost: 3,
  power: 4000,
  counterValue: 1000,
  traits: ['Animal Kingdom Pirates'],
  keywords: ['when_attacking'],
  effectTags: ['disruption'],
  effectText: '[When Attacking] DON!! -1: Your opponent trashes 1 card from their hand.',
  effectSpecV2: {
    clauses: [
      {
        trigger: 'when_attacking',
        cost: { donCostReturnToDeck: 1 },
        action: { kind: 'opp_discard_from_hand', magnitude: 1 },
        verified: 'human-reviewed',
      },
    ],
    continuous: [],
    replacements: [],
    schemaVersion: 2,
    verified: 'human-reviewed',
  },
};

async function seedJackOnField(page: Page, def: unknown): Promise<string> {
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
    if (!lib['OP01-102']) lib['OP01-102'] = def;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { field: unknown[] } };
    const iid = `seedJack_${Math.floor(Math.random() * 1e9).toString(36)}`;
    inst[iid] = {
      instanceId: iid, cardId: 'OP01-102', controller: 'A',
      rested: false, summoningSick: false,
      attachedDon: [], attachedDonRested: [],
      perTurn: { hasAttacked: false, effectsUsed: [] },
    };
    players.A.field = [...players.A.field, inst[iid]];
    w.__store.setState({ state: { ...s } });
    if (w.__getLegalActions) {
      const next = w.__store.getState().state as { activePlayer: string };
      w.__store.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
    return iid;
  }, def);
}

// Force state into T3, A main, with at least N DON in A.donCostArea.
// Bypasses CR §6-5-6-1 first-turn no-attack rule and the natural T1→T2→T3
// cycle that would otherwise pull in the AI driver.
async function forceT3AMain(page: Page, ensureDonCost: number): Promise<void> {
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
    (s as Record<string, unknown>).turn = 3;
    (s as Record<string, unknown>).phase = 'main';
    (s as Record<string, unknown>).activePlayer = 'A';
    (s as Record<string, unknown>).firstPlayer = 'A';
    (s as Record<string, unknown>).pending = null;
    const players = s.players as { A: { donDeck: string[]; donCostArea: string[] } };
    const newDeck = [...players.A.donDeck];
    const newCost = [...players.A.donCostArea];
    while (newCost.length < n && newDeck.length > 0) {
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
  }, ensureDonCost);
  await page.waitForTimeout(150);
}

async function legalActionsFor(page: Page, player: 'A' | 'B'): Promise<unknown[]> {
  return page.evaluate((p) => {
    const w = window as unknown as {
      __store?: { getState: () => { state: unknown } };
      __getLegalActions?: (s: unknown, p: string) => unknown[];
    };
    if (!w.__store || !w.__getLegalActions) return [];
    const s = w.__store.getState().state;
    return w.__getLegalActions(s, p);
  }, player);
}

async function dispatchAs(page: Page, action: object): Promise<void> {
  await page.evaluate((a) => {
    const w = window as unknown as {
      __store?: { getState: () => { dispatch: (a: unknown) => void } };
    };
    if (!w.__store) throw new Error('window.__store not exposed');
    w.__store.getState().dispatch(a);
  }, action);
  await page.waitForTimeout(300);
}

interface Snap {
  phase: string;
  activePlayer: string;
  pendingKind: string | null;
  jackRested: boolean | null;
  jackHasAttacked: boolean | null;
  aDonCost: number;
  aDonRested: number;
  aDonDeck: number;
  bHand: string[];
  bTrash: string[];
  bLife: number;
  historyTypes: string[];
}

async function readSnap(page: Page, jackIid: string): Promise<Snap> {
  return page.evaluate((jid) => {
    const w = window as unknown as {
      __store?: {
        getState: () => {
          state: {
            phase: string;
            activePlayer: string;
            pending: { kind?: string } | null;
            players: {
              A: { donCostArea: string[]; donRested: string[]; donDeck: string[] };
              B: { hand: string[]; trash: string[]; life: string[] };
            };
            instances: Record<string, { rested?: boolean; perTurn?: { hasAttacked?: boolean } }>;
            history: ReadonlyArray<{ type?: string }>;
          };
        };
      };
    };
    if (!w.__store) {
      return { phase: '', activePlayer: '', pendingKind: null, jackRested: null, jackHasAttacked: null, aDonCost: 0, aDonRested: 0, aDonDeck: 0, bHand: [], bTrash: [], bLife: -1, historyTypes: [] };
    }
    const s = w.__store.getState().state;
    const jack = s.instances[jid];
    return {
      phase: s.phase,
      activePlayer: s.activePlayer,
      pendingKind: s.pending?.kind ?? null,
      jackRested: jack ? (jack.rested ?? false) : null,
      jackHasAttacked: jack?.perTurn ? (jack.perTurn.hasAttacked ?? false) : null,
      aDonCost: s.players.A.donCostArea.length,
      aDonRested: s.players.A.donRested.length,
      aDonDeck: s.players.A.donDeck.length,
      bHand: [...s.players.B.hand],
      bTrash: [...s.players.B.trash],
      bLife: s.players.B.life.length,
      historyTypes: s.history.map((h) => h.type ?? '?'),
    };
  }, jackIid);
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

// Field button aria-label includes 'rested' suffix when rested.
async function isInstRestedInDom(page: Page, iid: string): Promise<boolean | null> {
  return page.evaluate((id) => {
    const btn = document.querySelector(`button[data-instance-id="${id}"]`);
    if (!btn) return null;
    const label = btn.getAttribute('aria-label') ?? '';
    return /\brested\b/i.test(label);
  }, iid);
}

test.describe('family-when-attacking (Stage A)', () => {
  test('OP01-102 Jack when_attacking: pay 1 DON return → opp head-of-hand discard; attack fails by power', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { drv, pageErrors, invariantErrors } = await bootstrap(page);
    void drv;

    // Force T3 so DECLARE_ATTACK is legal for A.
    await forceT3AMain(page, 3);

    // Seed Jack on field active and not summoning-sick.
    const jackIid = await seedJackOnField(page, OP01_102_DEF);

    // ── BEFORE attack ───────────────────────────────────────────────
    const before = await readSnap(page, jackIid);
    expect(before.phase, 'phase=main').toBe('main');
    expect(before.activePlayer, 'A turn').toBe('A');
    expect(before.pendingKind, 'no pending').toBeNull();
    expect(before.jackRested, 'Jack active').toBe(false);
    expect(before.jackHasAttacked, 'Jack has not attacked').toBe(false);
    expect(before.aDonCost, 'A donCostArea ≥1 (for cost)').toBeGreaterThanOrEqual(1);
    expect(before.bHand.length, 'B hand ≥1 (for discard)').toBeGreaterThanOrEqual(1);

    const aLeader = await page.evaluate(() => {
      const w = window as unknown as { __store?: { getState: () => { state: { players: { A: { leader: { instanceId: string } } }; instances: Record<string, unknown> } } } };
      return w.__store!.getState().state.players.A.leader.instanceId;
    });
    void aLeader;

    const bLeaderIid = await page.evaluate(() => {
      const w = window as unknown as { __store?: { getState: () => { state: { players: { B: { leader: { instanceId: string } } } } } } };
      return w.__store!.getState().state.players.B.leader.instanceId;
    });

    // Verify DECLARE_ATTACK from Jack → B leader is legal.
    const aLegal = await legalActionsFor(page, 'A') as { type: string; attackerInstanceId?: string; targetInstanceId?: string }[];
    const jackAttack = aLegal.find(
      (a) => a.type === 'DECLARE_ATTACK' && a.attackerInstanceId === jackIid && a.targetInstanceId === bLeaderIid,
    );
    expect(jackAttack, 'DECLARE_ATTACK (Jack → B leader) is legal').toBeTruthy();

    const bHandBefore = before.bHand.length;
    const bExpectedDiscard = before.bHand[0]!;
    const bSurvivor = before.bHand.length > 1 ? before.bHand[1]! : null;
    const bTrashBefore = before.bTrash.length;
    const bLifeBefore = before.bLife;
    const aDonCostBefore = before.aDonCost;
    const aDonDeckBefore = before.aDonDeck;

    // ── Dispatch DECLARE_ATTACK Jack → B leader ─────────────────────
    await dispatchAs(page, {
      type: 'DECLARE_ATTACK',
      attackerInstanceId: jackIid,
      targetInstanceId: bLeaderIid,
    });

    // game.ts:498-510 auto-skips block_window + counter_window when
    // reactive (B) is AI; damage resolution runs synchronously after.
    // Allow a moment for the loop to settle.
    await page.waitForTimeout(400);

    // ── AFTER attack resolves ───────────────────────────────────────
    const after = await readSnap(page, jackIid);

    // Engine: when_attacking effect fired.
    // - cost paid: A.donCostArea -1, A.donDeck +1
    expect(after.aDonCost, 'A donCostArea -1 (cost paid)').toBe(aDonCostBefore - 1);
    expect(after.aDonDeck, 'A donDeck +1 (returned)').toBe(aDonDeckBefore + 1);
    // - opp_discard_from_hand: B head-of-hand → B.trash
    expect(after.bHand.length, 'B hand -1').toBe(bHandBefore - 1);
    expect(after.bTrash.length, 'B trash +1').toBe(bTrashBefore + 1);
    expect(after.bHand, 'discarded card no longer in B hand').not.toContain(bExpectedDiscard);
    expect(after.bTrash, 'discarded card in B trash').toContain(bExpectedDiscard);
    if (bSurvivor !== null) {
      expect(after.bHand, 'unrelated B hand card still in hand').toContain(bSurvivor);
    }

    // Engine: combat result. Jack 4000 vs B leader 5000 ⇒ fails.
    expect(after.bLife, 'B leader life UNCHANGED (attack failed)').toBe(bLifeBefore);

    // Engine: Jack rested + perTurn.hasAttacked
    expect(after.jackRested, 'Jack rested after attack').toBe(true);
    expect(after.jackHasAttacked, 'Jack perTurn.hasAttacked').toBe(true);

    // Engine: history contains CARD_DISCARDED (when_attacking effect proof).
    expect(
      after.historyTypes,
      'history records CARD_DISCARDED from when_attacking opp_discard_from_hand',
    ).toContain('CARD_DISCARDED');
    // Engine: history records DAMAGE_RESOLVED (combat resolved).
    expect(after.historyTypes, 'history records DAMAGE_RESOLVED').toContain('DAMAGE_RESOLVED');

    // Engine: pending cleared, phase restored to main.
    expect(after.pendingKind, 'no pending after combat').toBeNull();
    expect(after.phase, 'phase restored to main').toBe('main');
    expect(after.activePlayer, 'still A turn').toBe('A');

    // ── UI ───────────────────────────────────────────────────────────
    expect(await isOnYourField(page, jackIid), 'Jack still on field after attack').toBe(true);
    // DOM aria-label reflects rested state for Jack.
    const jackDomRested = await isInstRestedInDom(page, jackIid);
    expect(jackDomRested, 'Jack rested visible in DOM aria-label').toBe(true);

    // ── Stability ────────────────────────────────────────────────────
    expect(pageErrors, 'no pageerrors').toEqual([]);
    expect(invariantErrors, 'no InvariantErrors').toEqual([]);
  });
});
