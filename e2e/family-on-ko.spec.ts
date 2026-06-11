// family-on-ko — Stage A representative anchor for the on_ko mechanic
// family. Verifies OP01-038 Kanjuro's on_ko clause:
//   `[On K.O.] Your opponent chooses 1 card from your hand; trash that
//    card.`
//
// Engine path:
//   - koCharacter splices the KO target from field, pushes to trash,
//     records CHARACTER_KOD, then dispatches on_ko clauses BEFORE
//     resetInstanceTransientState. Source:
//     shared/engine-v2/reducers/attackFlow.ts:76-122.
//   - discard_from_hand action (V0 deterministic): controller's hand
//     head → controller's trash. Source:
//     shared/engine-v2/registry/handlers/actions3.ts:445-453.
//   - Legal attack targets include opp leader + opp REST'ed characters.
//     Source: shared/engine-v2/rules/legality.ts:233-237.
//   - First-turn no-attack rule (CR §6-5-6-1) at
//     shared/engine-v2/rules/legality.ts:215-221. Test mutates state to
//     turn=3 to bypass.
//
// Card-data audit note: printed text says "opp chooses". Encoded as
// `discard_from_hand` which is controller's head-of-hand deterministic
// (V0). The V0 path is the engine contract; full opp-pick UI is not
// wired. Documented here, not classified as PRODUCT_BUG for this Stage
// A test — we verify the encoded contract.
//
// Anchor card data (OP01-038 Kanjuro): character, green, cost 2, power
// 3000. Two clauses: when_attacking (DON-gated, removal_ko) and on_ko
// (discard_from_hand, no cond/cost/opt). Only on_ko is exercised here.
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

const OP01_038_DEF = {
  id: 'OP01-038',
  name: 'Kanjuro',
  kind: 'character',
  colors: ['green'],
  cost: 2,
  power: 3000,
  counterValue: 1000,
  traits: ['Land of Wano'],
  keywords: ['when_attacking', 'on_ko'],
  effectTags: ['removal_ko', 'discard_from_hand'],
  effectText: '[On K.O.] Your opponent chooses 1 card from your hand; trash that card.',
  effectSpecV2: {
    clauses: [
      // when_attacking clause not exercised here — A's leader is the
      // attacker, Kanjuro defends and gets KO'd.
      {
        trigger: 'when_attacking',
        condition: { type: 'if_attached_don_min', n: 1 },
        action: { kind: 'removal_ko' },
        target: { kind: 'opp_character', filter: { costMax: 2, rested: true } },
        verified: 'human-reviewed',
      },
      {
        trigger: 'on_ko',
        action: { kind: 'discard_from_hand', magnitude: 1 },
        verified: 'flagged',
      },
    ],
    continuous: [],
    replacements: [],
    schemaVersion: 2,
    verified: 'human-reviewed',
  },
};

// Seed Kanjuro on B.field as a REST'ed character so A leader can
// declare attack against it (only rested opp chars are legal attack
// targets per legality.ts:233-237). Returns iid.
async function seedKanjuroOnBField(page: Page, def: unknown): Promise<string> {
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
    if (!lib['OP01-038']) lib['OP01-038'] = def;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { B: { field: unknown[] } };
    const iid = `seedKanjuro_${Math.floor(Math.random() * 1e9).toString(36)}`;
    inst[iid] = {
      instanceId: iid, cardId: 'OP01-038', controller: 'B',
      rested: true, summoningSick: false,
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
  }, def);
}

// Force T3, A main, phase=main, firstPlayer=A so A can declare attacks.
async function forceT3AMain(page: Page): Promise<void> {
  await page.evaluate(() => {
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
    w.__store.setState({ state: { ...s, players: { ...(s.players as Record<string, unknown>) } } });
    if (w.__getLegalActions) {
      const next = w.__store.getState().state as { activePlayer: string };
      w.__store.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
  });
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
  await page.waitForTimeout(400);
}

interface Snap {
  phase: string;
  activePlayer: string;
  pendingKind: string | null;
  bFieldIds: string[];
  bHand: string[];
  bTrash: string[];
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
              B: {
                hand: string[];
                trash: string[];
                life: string[];
                field: { instanceId: string }[];
              };
            };
            history: ReadonlyArray<{ type?: string }>;
          };
        };
      };
    };
    if (!w.__store) {
      return { phase: '', activePlayer: '', pendingKind: null, bFieldIds: [], bHand: [], bTrash: [], bLife: -1, historyTypes: [] };
    }
    const s = w.__store.getState().state;
    return {
      phase: s.phase,
      activePlayer: s.activePlayer,
      pendingKind: s.pending?.kind ?? null,
      bFieldIds: s.players.B.field.map((i) => i.instanceId),
      bHand: [...s.players.B.hand],
      bTrash: [...s.players.B.trash],
      bLife: s.players.B.life.length,
      historyTypes: s.history.map((h) => h.type ?? '?'),
    };
  });
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

test.describe('family-on-ko (Stage A)', () => {
  test('OP01-038 Kanjuro on_ko: KO\'d by battle → controller discards head-of-hand', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { drv, pageErrors, invariantErrors } = await bootstrap(page);
    void drv;

    // Force T3 (bypass first-turn no-attack rule).
    await forceT3AMain(page);

    // Seed Kanjuro on B.field (rested so it's a legal attack target).
    const kanjuroIid = await seedKanjuroOnBField(page, OP01_038_DEF);

    // Grab A leader + B leader iids.
    const { aLeaderIid, bLeaderIid } = await page.evaluate(() => {
      const w = window as unknown as { __store?: { getState: () => { state: { players: { A: { leader: { instanceId: string } }; B: { leader: { instanceId: string } } } } } } };
      return {
        aLeaderIid: w.__store!.getState().state.players.A.leader.instanceId,
        bLeaderIid: w.__store!.getState().state.players.B.leader.instanceId,
      };
    });
    void bLeaderIid;

    // ── BEFORE ──────────────────────────────────────────────────────
    const before = await readSnap(page);
    expect(before.phase, 'phase=main').toBe('main');
    expect(before.activePlayer, 'A turn').toBe('A');
    expect(before.pendingKind, 'no pending').toBeNull();
    expect(before.bFieldIds, 'Kanjuro on B field before').toContain(kanjuroIid);
    expect(before.bHand.length, 'B hand has ≥1 (for discard)').toBeGreaterThanOrEqual(1);
    const bHandBefore = before.bHand.length;
    const bTrashBefore = before.bTrash.length;
    const bLifeBefore = before.bLife;
    const bExpectedDiscard = before.bHand[0]!;
    const bSurvivor = before.bHand.length > 1 ? before.bHand[1]! : null;

    // UI: Kanjuro visible on opponent's field.
    expect(await isOnOpponentField(page, kanjuroIid), 'Kanjuro visible on opp field').toBe(true);

    // Verify DECLARE_ATTACK A leader → Kanjuro is legal.
    const aLegal = await legalActionsFor(page, 'A') as { type: string; attackerInstanceId?: string; targetInstanceId?: string }[];
    const attackKanjuro = aLegal.find(
      (a) => a.type === 'DECLARE_ATTACK' && a.attackerInstanceId === aLeaderIid && a.targetInstanceId === kanjuroIid,
    );
    expect(attackKanjuro, 'DECLARE_ATTACK A leader → Kanjuro is legal').toBeTruthy();

    // ── Dispatch DECLARE_ATTACK A leader (5000) → Kanjuro (3000) ───
    await dispatchAs(page, {
      type: 'DECLARE_ATTACK',
      attackerInstanceId: aLeaderIid,
      targetInstanceId: kanjuroIid,
    });

    // game.ts:498-510 auto-skips block_window + counter_window for AI
    // reactive (B). Damage resolution runs synchronously after.
    await page.waitForTimeout(400);

    // ── AFTER ───────────────────────────────────────────────────────
    const after = await readSnap(page);

    // Engine: combat KO. Kanjuro removed from B.field, in B.trash.
    expect(after.bFieldIds, 'Kanjuro not on B field after KO').not.toContain(kanjuroIid);
    expect(after.bTrash, 'Kanjuro in B trash').toContain(kanjuroIid);

    // Engine: on_ko effect fired — Kanjuro's controller (B) discards
    // head of B.hand. B.trash also gains the discarded card.
    expect(after.bHand, 'discarded B hand[0] no longer in hand').not.toContain(bExpectedDiscard);
    expect(after.bTrash, 'discarded B hand[0] in B trash').toContain(bExpectedDiscard);
    if (bSurvivor !== null) {
      expect(after.bHand, 'unrelated B hand[1] still in hand').toContain(bSurvivor);
    }
    // Net B.hand delta = -1 (one card discarded).
    expect(after.bHand.length, 'B hand -1').toBe(bHandBefore - 1);
    // Net B.trash delta = +2 (Kanjuro + discarded card).
    expect(after.bTrash.length, 'B trash +2 (Kanjuro KO + on_ko discard)').toBe(bTrashBefore + 2);

    // Engine: combat success → B leader took 1 life damage (attacker
    // A leader 5000 vs target Kanjuro 3000 ⇒ Kanjuro KO; the leader's
    // life damage applies only when the leader is the target. Since
    // Kanjuro was the target, the leader was NOT damaged.
    expect(after.bLife, 'B leader life unchanged (Kanjuro was the target)').toBe(bLifeBefore);

    // Engine: history evidence.
    expect(after.historyTypes, 'history contains CHARACTER_KOD').toContain('CHARACTER_KOD');
    expect(after.historyTypes, 'history contains DAMAGE_RESOLVED').toContain('DAMAGE_RESOLVED');

    // Engine: pending cleared, phase restored.
    expect(after.pendingKind, 'no pending after combat').toBeNull();
    expect(after.phase, 'phase restored to main').toBe('main');
    expect(after.activePlayer, 'still A turn').toBe('A');

    // ── UI ───────────────────────────────────────────────────────────
    // Kanjuro removed from opponent's field UI (allow exit anim to settle).
    await expect.poll(
      async () => isOnOpponentField(page, kanjuroIid),
      { timeout: 5_000, message: 'Kanjuro removed from opp field UI' },
    ).toBe(false);

    // ── Stability ────────────────────────────────────────────────────
    expect(pageErrors, 'no pageerrors').toEqual([]);
    expect(invariantErrors, 'no InvariantErrors').toEqual([]);
  });
});
