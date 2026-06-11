// family-counter-event — Stage A representative anchor for the
// counter-event / counter-window mechanic family. Verifies OP01-118
// Ulti-Mortar's bare counter behavior:
//   `[Counter] DON!! -2: +2000 power, draw 1.`
// In the minimal-DON scenario (A has only 1 DON to pay card cost) the
// inner `donCostReturnToDeck:2` clause costs cannot be paid, so BOTH
// on_play clauses skip — only the raw `counterEventBoost +2000` field
// fires. This isolates the pure counter-window pipeline from
// secondary effects (power_buff + draw) and from the double-encoding
// audit question (counterEventBoost vs on_play power_buff).
//
// Engine sources:
//   - playCounterReducer event path: pay DON cost, hand→trash, apply
//     counterEventBoost, fire on_play.
//     `shared/engine-v2/reducers/attackFlow.ts:317-411`.
//   - counter legality gate (events need `boost > 0` AND cost payable):
//     `shared/engine-v2/rules/legality.ts:267-285`.
//   - clause-level cost canPay skip:
//     `shared/engine-v2/effects/EffectDispatcher.ts:189-219`.
//   - donCostReturnToDeck canPay needs donCostArea ≥ N:
//     `shared/engine-v2/registry/handlers/costs2.ts:335-351`.
//   - Damage resolution `attackerPower >= targetPower` where
//     targetPower = baseTargetPower + counterBoost:
//     `shared/engine-v2/reducers/attackFlow.ts:437-509`.
//
// Anchor card data (OP01-118 Ulti-Mortar):
//   event, purple, cost 1, counterEventBoost 2000, two on_play clauses
//   each gated by `donCostReturnToDeck:2`.
//
// Color identity: Ulti-Mortar is purple; A's leader is red. PLAY_COUNTER
// reducer at attackFlow.ts:317 does not gate by color identity (the
// `sharesColorWithLeader` check lives in main-phase getLegalActions only).
// Same dispatch-path bypass pattern as family-bounce / family-discard.
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

// OP01-118 Ulti-Mortar — copied verbatim from shared/data/cards.json.
// Purple → not in A's red default deck → inject into cardLibrary.
const OP01_118_DEF = {
  id: 'OP01-118',
  name: 'Ulti-Mortar',
  kind: 'event',
  colors: ['purple'],
  cost: 1,
  power: null,
  counterValue: null,
  traits: ['Animal Kingdom Pirates'],
  keywords: [],
  effectTags: ['counter_event', 'power_buff', 'draw'],
  effectText: '[Counter] DON!! -2: +2000 power, draw 1.',
  counterEventBoost: 2000,
  templateParams: { draw: 1, power_buff: 2000 },
  effectSpecV2: {
    clauses: [
      {
        trigger: 'on_play',
        cost: { donCostReturnToDeck: 2 },
        action: { kind: 'power_buff', magnitude: 2000, duration: 'this_battle' },
        target: { kind: 'your_leader_or_character' },
        verified: 'human-reviewed',
      },
      {
        trigger: 'on_play',
        cost: { donCostReturnToDeck: 2 },
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

async function seedUltiMortarInHand(page: Page, def: unknown): Promise<string> {
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
    if (!lib['OP01-118']) lib['OP01-118'] = def;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { hand: string[] } };
    const iid = `seedUltiMortar_${Math.floor(Math.random() * 1e9).toString(36)}`;
    inst[iid] = {
      instanceId: iid, cardId: 'OP01-118', controller: 'A',
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

// Seed a non-counter event-card placeholder into A.hand so we can
// verify the legality gate filters it out (no counterEventBoost, no
// counterValue → not in PLAY_COUNTER list).
async function seedNonCounterInHand(page: Page): Promise<string> {
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
    const players = s.players as { A: { hand: string[] } };
    const synthId = `__seed_noncounter_${Math.floor(Math.random() * 1e9).toString(36)}`;
    const iid = `seedNonCounter_${Math.floor(Math.random() * 1e9).toString(36)}`;
    lib[synthId] = {
      id: synthId, name: 'NonCounter Test', kind: 'character',
      cost: 1, power: 1000, counterValue: null, // null counterValue → not offered as counter
      colors: ['red'],
      traits: [],
      keywords: [],
      effectText: '',
    };
    inst[iid] = {
      instanceId: iid, cardId: synthId, controller: 'A',
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
  });
}

// Engineer counter_window directly with B leader → A leader pending
// attack, counterBoost=0. Bypasses END_TURN → AI cycle + block_window.
async function enterCounterWindow(page: Page): Promise<{ bAttackerIid: string; aLeaderIid: string }> {
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
    const players = s.players as {
      A: { leader: { instanceId: string } };
      B: { leader: { instanceId: string } };
    };
    const bAttackerIid = players.B.leader.instanceId;
    const aLeaderIid = players.A.leader.instanceId;
    (s as Record<string, unknown>).phase = 'counter_window';
    (s as Record<string, unknown>).activePlayer = 'B';
    (s as Record<string, unknown>).pending = {
      kind: 'attack',
      pendingAttack: {
        attackerInstanceId: bAttackerIid,
        targetInstanceId: aLeaderIid,
        counterBoost: 0,
      },
    };
    w.__store.setState({ state: { ...s, players: { ...players, A: { ...players.A }, B: { ...players.B } } } });
    if (w.__getLegalActions) {
      const next = w.__store.getState().state as { activePlayer: string };
      w.__store.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
    return { bAttackerIid, aLeaderIid };
  });
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
  await page.waitForTimeout(200);
}

interface Snap {
  phase: string;
  activePlayer: string;
  pendingKind: string | null;
  pendingAttackTarget: string | null;
  counterBoost: number;
  aHand: string[];
  aTrash: string[];
  aDeck: string[];
  aDonCost: number;
  aDonRested: number;
  aLife: number;
  aLeaderPowerMod: number;
}

async function readSnap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __store?: {
        getState: () => {
          state: {
            phase: string;
            activePlayer: string;
            pending: { kind?: string; pendingAttack?: { targetInstanceId?: string; counterBoost?: number } } | null;
            players: {
              A: {
                hand: string[];
                trash: string[];
                deck: string[];
                donCostArea: string[];
                donRested: string[];
                life: string[];
                leader: { instanceId: string; powerModifierThisBattle?: number };
              };
            };
          };
        };
      };
    };
    if (!w.__store) {
      return { phase: '', activePlayer: '', pendingKind: null, pendingAttackTarget: null, counterBoost: 0, aHand: [], aTrash: [], aDeck: [], aDonCost: 0, aDonRested: 0, aLife: -1, aLeaderPowerMod: 0 };
    }
    const s = w.__store.getState().state;
    return {
      phase: s.phase,
      activePlayer: s.activePlayer,
      pendingKind: s.pending?.kind ?? null,
      pendingAttackTarget: s.pending?.pendingAttack?.targetInstanceId ?? null,
      counterBoost: s.pending?.pendingAttack?.counterBoost ?? 0,
      aHand: [...s.players.A.hand],
      aTrash: [...s.players.A.trash],
      aDeck: [...s.players.A.deck],
      aDonCost: s.players.A.donCostArea.length,
      aDonRested: s.players.A.donRested.length,
      aLife: s.players.A.life.length,
      aLeaderPowerMod: s.players.A.leader.powerModifierThisBattle ?? 0,
    };
  });
}

async function readAttackOverlayVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    return Boolean(document.querySelector('[aria-label="Attack resolution"]'));
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

async function readHandUiCount(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const el = document.querySelector('[aria-label^="Your hand"]');
    if (!el) return null;
    const m = (el.getAttribute('aria-label') ?? '').match(/Your hand,\s*(\d+)\s*cards/);
    return m ? parseInt(m[1]!, 10) : null;
  });
}

test.describe('family-counter-event (Stage A)', () => {
  test('OP01-118 Ulti-Mortar: counter event +2000 counterBoost (inner DON clauses skipped); attack fails, life unchanged', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { drv, pageErrors, invariantErrors } = await bootstrap(page);
    void drv;

    // ── Seed scene ───────────────────────────────────────────────────
    const ultiMortarIid = await seedUltiMortarInHand(page, OP01_118_DEF);
    const nonCounterIid = await seedNonCounterInHand(page);

    // Engineer counter_window: B leader (5000) attacks A leader (5000).
    const { bAttackerIid, aLeaderIid } = await enterCounterWindow(page);

    // ── BEFORE counter ──────────────────────────────────────────────
    const before = await readSnap(page);
    expect(before.phase, 'phase=counter_window').toBe('counter_window');
    expect(before.activePlayer, 'B is attacker').toBe('B');
    expect(before.pendingKind, 'attack pending').toBe('attack');
    expect(before.pendingAttackTarget, 'attack targets A leader').toBe(aLeaderIid);
    expect(before.counterBoost, 'counterBoost starts at 0').toBe(0);
    expect(before.aHand, 'Ulti-Mortar in A hand').toContain(ultiMortarIid);
    expect(before.aHand, 'non-counter card in A hand').toContain(nonCounterIid);
    expect(before.aDonCost, 'A has exactly 1 active DON (T1 default; cost = 1)').toBe(1);
    const handBefore = before.aHand.length;
    const trashBefore = before.aTrash.length;
    const deckBefore = before.aDeck.length;
    const donCostBefore = before.aDonCost;
    const donRestedBefore = before.aDonRested;
    const lifeBefore = before.aLife;
    expect(bAttackerIid, 'B attacker captured').toBeTruthy();
    const lifeUiBefore = await readYourLifeUi(page);
    const donUiBefore = await readDonUiCounts(page);
    const handUiBefore = await readHandUiCount(page);

    // Legality enumeration for A (reactive).
    const aLegal = await legalActionsFor(page, 'A') as { type: string; instanceId?: string }[];
    const counterIds = aLegal
      .filter((a) => a.type === 'PLAY_COUNTER')
      .map((a) => a.instanceId);
    expect(counterIds, 'Ulti-Mortar offered as PLAY_COUNTER').toContain(ultiMortarIid);
    expect(counterIds, 'non-counter card NOT offered as PLAY_COUNTER').not.toContain(nonCounterIid);
    expect(aLegal.some((a) => a.type === 'SKIP_COUNTER'), 'SKIP_COUNTER offered').toBe(true);

    // UI: AttackResolutionOverlay visible during counter_window.
    await expect.poll(
      async () => readAttackOverlayVisible(page),
      { timeout: 5_000, message: 'AttackResolutionOverlay mounts in counter_window' },
    ).toBe(true);

    // ── Dispatch PLAY_COUNTER for Ulti-Mortar ───────────────────────
    await dispatchAs(page, { type: 'PLAY_COUNTER', instanceId: ultiMortarIid });

    // ── AFTER counter used (still in counter_window pre-skip) ──────
    const mid = await readSnap(page);

    // Engine: Ulti-Mortar gone from hand → A.trash.
    expect(mid.aHand, 'Ulti-Mortar not in A hand').not.toContain(ultiMortarIid);
    expect(mid.aTrash, 'Ulti-Mortar in A trash').toContain(ultiMortarIid);
    expect(mid.aTrash.length, 'A trash +1').toBe(trashBefore + 1);
    // Hand net: -1 (Ulti-Mortar removed; no draw because inner clause skipped).
    expect(mid.aHand.length, 'A hand -1; no draw side-effect').toBe(handBefore - 1);
    // Deck unchanged (no draw, no ramp).
    expect(mid.aDeck.length, 'A deck unchanged (no draw / ramp)').toBe(deckBefore);

    // Engine: DON cost paid (card cost = 1 only).
    expect(mid.aDonCost, 'donCostArea -1 (card cost paid)').toBe(donCostBefore - 1);
    expect(mid.aDonRested, 'donRested +1').toBe(donRestedBefore + 1);

    // Engine: counterBoost += 2000 (from counterEventBoost field only;
    // inner power_buff clause's donCostReturnToDeck:2 canPay fails
    // because A.donCostArea is now 0 after card cost).
    expect(mid.counterBoost, 'counterBoost += 2000').toBe(2000);

    // Engine: A leader powerModifierThisBattle unchanged (inner
    // power_buff clause skipped → 0).
    expect(mid.aLeaderPowerMod, 'A leader powerModifierThisBattle = 0 (inner clause skipped)').toBe(0);

    // Engine: pending still attack (not resolved until SKIP_COUNTER).
    expect(mid.pendingKind, 'pending still attack pre-resolve').toBe('attack');
    expect(mid.phase, 'phase still counter_window').toBe('counter_window');

    // ── Skip remaining counter → damage resolution ──────────────────
    await dispatchAs(page, { type: 'SKIP_COUNTER' });

    // ── AFTER damage resolves ───────────────────────────────────────
    const after = await readSnap(page);

    // Combat math: attackerPower 5000 vs targetPower (5000 + 2000) = 7000.
    // 5000 >= 7000 → false → attack fails → A leader life unchanged.
    expect(after.aLife, 'A leader life UNCHANGED (counter saved leader)').toBe(lifeBefore);
    expect(after.pendingKind, 'pending cleared').toBeNull();
    expect(after.phase, 'phase restored to main').toBe('main');

    // ── UI ───────────────────────────────────────────────────────────
    // Overlay gone after pending clears.
    await expect.poll(
      async () => readAttackOverlayVisible(page),
      { timeout: 5_000, message: 'overlay dismissed after damage resolves' },
    ).toBe(false);

    // Life UI unchanged.
    const lifeUiAfter = await readYourLifeUi(page);
    if (lifeUiBefore !== null && lifeUiAfter !== null) {
      expect(lifeUiAfter, 'A life UI unchanged').toBe(lifeUiBefore);
    }

    // DON UI matches engine.
    const donUiAfter = await readDonUiCounts(page);
    if (donUiBefore !== null && donUiAfter !== null) {
      expect(donUiAfter.active, 'UI active DON matches engine').toBe(after.aDonCost);
      expect(donUiAfter.rested, 'UI rested DON matches engine').toBe(after.aDonRested);
    }

    // Hand UI -1.
    const handUiAfter = await readHandUiCount(page);
    if (handUiBefore !== null && handUiAfter !== null) {
      expect(handUiAfter, 'A hand UI -1').toBe(handUiBefore - 1);
    }

    // ── Stability ────────────────────────────────────────────────────
    expect(pageErrors, 'no pageerrors').toEqual([]);
    expect(invariantErrors, 'no InvariantErrors').toEqual([]);
  });
});
