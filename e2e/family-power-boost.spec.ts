// family-power-boost — Stage A representative anchor for the
// power_boost mechanic family. Verifies that OP01-001 Roronoa Zoro's
// continuous aura
//   `[DON!! x1] [Your Turn] all of your Characters gain +1000 power`
// is reflected by BOTH the engine state (effectivePower formula) AND
// the visible UI (CardArt aria-label / PowerStamp).
//
// Scope:
//   1. Engine truth: reconstructs effectivePowerForDisplay's formula by
//      reading raw inst + cardLibrary from the store, so no engine code
//      needs to be exposed or modified.
//      Formula source: shared/engine-v2/state/derived/power.ts:31-50.
//   2. UI truth: reads aria-label `power N` off the CardArt button,
//      which is wired to `effectivePowerForDisplay` after the STEP 1
//      CardArt fix (src/components/CardArt.tsx:215, 651-661, 811).
//   3. Scope filter: confirms B-side character is NOT buffed by A's
//      leader aura.
//
// Stage A acceptance per e2e/card-effect-verification-plan.md §4-5:
// 1 anchor card per family; PASS classifies the anchor as VERIFIED.
//
// Per directive 2026-06-06: harness-only. No engine, UI, card-data, or
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

// Seed one A-side character on the field with the given base power.
// Returns the new instance id. Mirrors the helper used in
// ui-interaction-correctness.spec.ts:58.
async function seedOwnFieldChar(page: Page, power: number): Promise<string> {
  return page.evaluate((power) => {
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
    const players = s.players as { A: { field: unknown[] } };
    const synthId = `__seed_pb_${Math.floor(Math.random() * 1e9).toString(36)}`;
    const iid = `seedPB_${Math.floor(Math.random() * 1e9).toString(36)}`;
    lib[synthId] = {
      id: synthId, name: 'PB Char A', kind: 'character',
      cost: 1, power, counterValue: 1000,
      colors: ['red','green','blue','purple','black','yellow'],
      traits: [], keywords: [],
      effectText: '',
    };
    inst[iid] = {
      instanceId: iid, cardId: synthId, controller: 'A',
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
  }, power);
}

async function seedOppFieldChar(page: Page, power: number): Promise<string> {
  return page.evaluate((power) => {
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
    const synthId = `__seed_pb_opp_${Math.floor(Math.random() * 1e9).toString(36)}`;
    const iid = `seedPBopp_${Math.floor(Math.random() * 1e9).toString(36)}`;
    lib[synthId] = {
      id: synthId, name: 'PB Char B', kind: 'character',
      cost: 1, power, counterValue: 1000,
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
  }, power);
}

// Attach N DON from A's cost area to A's leader via real ATTACH_DON
// action dispatch. Routes through applyAction so ContinuousManager
// .refold runs and re-applies the Zoro aura.
async function attachDonToLeader(page: Page, n: number): Promise<void> {
  await page.evaluate((n) => {
    const w = window as unknown as {
      __store?: {
        getState: () => {
          state: { players: { A: { leader: { instanceId: string } } } };
          dispatch: (a: unknown) => void;
        };
      };
    };
    if (!w.__store) throw new Error('window.__store not exposed');
    const leaderInstId = w.__store.getState().state.players.A.leader.instanceId;
    for (let i = 0; i < n; i += 1) {
      w.__store.getState().dispatch({ type: 'ATTACH_DON', targetInstanceId: leaderInstId });
    }
  }, n);
  await page.waitForTimeout(200);
}

// Engine-truth power: reconstructs effectivePowerForDisplay's formula
// from the live store. Source: shared/engine-v2/state/derived/power.ts:31-52.
async function readEnginePower(page: Page, iid: string): Promise<number | null> {
  return page.evaluate((id) => {
    const w = window as unknown as {
      __store?: { getState: () => { state: Record<string, unknown> } };
    };
    if (!w.__store) return null;
    const s = w.__store.getState().state;
    const instances = s.instances as Record<string, unknown> | undefined;
    const lib = s.cardLibrary as Record<string, unknown> | undefined;
    if (!instances || !lib) return null;
    const inst = instances[id] as Record<string, unknown> | undefined;
    if (!inst) return null;
    const cardId = inst.cardId as string;
    const card = lib[cardId] as Record<string, unknown> | undefined;
    if (!card) return null;
    const kind = card.kind as string;
    const printed = (kind === 'character' || kind === 'leader')
      ? ((card.power as number) ?? 0)
      : 0;
    const base = (inst.basePowerOverrideOneShot as number | null | undefined)
      ?? (inst.basePowerOverrideContinuous as number | null | undefined)
      ?? printed;
    const ad = inst.attachedDon as unknown[] ?? [];
    const adr = inst.attachedDonRested as unknown[] ?? [];
    const donCount = (ad.length + adr.length);
    const raw = base
      + donCount * 1000
      + ((inst.powerModifierOneShot as number | undefined) ?? 0)
      + ((inst.powerModifierContinuous as number | undefined) ?? 0)
      + ((inst.powerModifierThisBattle as number | undefined) ?? 0);
    return Math.max(0, raw);
  }, iid);
}

// UI-truth power: reads aria-label `power N` from the CardArt button.
async function readDomPower(page: Page, iid: string): Promise<number | null> {
  return page.evaluate((id) => {
    const btn = document.querySelector(`button[data-instance-id="${id}"]`);
    if (!btn) return null;
    const label = btn.getAttribute('aria-label') ?? '';
    const m = label.match(/power\s+(-?\d+)/i);
    return m ? parseInt(m[1]!, 10) : null;
  }, iid);
}

// Read store shape that confirms test invariants: phase/active/pending null.
async function readStability(page: Page): Promise<{
  phase: string;
  activePlayer: string;
  pendingKind: string | null;
  leaderId: string | null;
}> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __store?: {
        getState: () => {
          state: {
            phase: string;
            activePlayer: string;
            pending: { kind?: string } | null;
            players: { A: { leader: { cardId: string } } };
          };
        };
      };
    };
    if (!w.__store) {
      return { phase: '', activePlayer: '', pendingKind: null, leaderId: null };
    }
    const s = w.__store.getState().state;
    return {
      phase: s.phase,
      activePlayer: s.activePlayer,
      pendingKind: s.pending?.kind ?? null,
      leaderId: s.players.A.leader.cardId ?? null,
    };
  });
}

test.describe('family-power-boost (Stage A)', () => {
  test('OP01-001 Zoro continuous aura: +1000 to all own characters when DON attached', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { drv, pageErrors, invariantErrors } = await bootstrap(page);
    void drv;

    // ── Confirm anchor card precondition ─────────────────────────────
    const pre = await readStability(page);
    expect(pre.leaderId, 'A leader is OP01-001 Roronoa Zoro').toBe('OP01-001');
    expect(pre.phase, 'phase is main').toBe('main');
    expect(pre.activePlayer, 'active player is A').toBe('A');
    expect(pre.pendingKind, 'no pending prompt at start of test').toBeNull();

    // ── Seed both sides with a base-1000 character ──────────────────
    const aIid = await seedOwnFieldChar(page, 1000);
    const bIid = await seedOppFieldChar(page, 1000);

    // ── BEFORE aura activation (Zoro condition: if_attached_don_min 1) ──
    // Zoro's leader instance starts with 0 attached DON, so the aura
    // clause should NOT yet apply.
    const aBeforeEngine = await readEnginePower(page, aIid);
    const bBeforeEngine = await readEnginePower(page, bIid);
    const aBeforeDom = await readDomPower(page, aIid);
    const bBeforeDom = await readDomPower(page, bIid);

    expect(aBeforeEngine, 'A engine power before aura = 1000').toBe(1000);
    expect(bBeforeEngine, 'B engine power before aura = 1000').toBe(1000);
    expect(aBeforeDom, 'A DOM displayed power before aura = 1000').toBe(1000);
    expect(bBeforeDom, 'B DOM displayed power before aura = 1000').toBe(1000);

    // ── Attach 1 DON to Zoro via real ATTACH_DON action ─────────────
    await attachDonToLeader(page, 1);

    // ── AFTER aura activation ───────────────────────────────────────
    const aAfterEngine = await readEnginePower(page, aIid);
    const bAfterEngine = await readEnginePower(page, bIid);
    const aAfterDom = await readDomPower(page, aIid);
    const bAfterDom = await readDomPower(page, bIid);

    // Engine truth: A char gets the +1000 aura, B char does not.
    expect(aAfterEngine, 'A engine power after aura = 2000 (+1000 from Zoro)').toBe(2000);
    expect(bAfterEngine, 'B engine power after aura = 1000 (unchanged)').toBe(1000);

    // UI truth: DOM aria-label matches engine recompute.
    expect(aAfterDom, 'A DOM displayed power after aura = 2000').toBe(2000);
    expect(bAfterDom, 'B DOM displayed power after aura = 1000').toBe(1000);

    // Engine/UI parity: explicit cross-check.
    expect(aAfterDom, 'A DOM power matches engine').toBe(aAfterEngine);
    expect(bAfterDom, 'B DOM power matches engine').toBe(bAfterEngine);

    // ── Stability ───────────────────────────────────────────────────
    const post = await readStability(page);
    expect(post.phase, 'phase still valid after attach').toBe('main');
    expect(post.activePlayer, 'still A turn').toBe('A');
    expect(post.pendingKind, 'no stuck pending after attach').toBeNull();
    expect(pageErrors, 'no pageerrors').toEqual([]);
    expect(invariantErrors, 'no InvariantErrors').toEqual([]);
  });
});
