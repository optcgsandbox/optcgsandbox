// family-continuous-passive — Stage A representative anchor for the
// continuous / passive effects family. Verifies ST01-013 Roronoa Zoro's
// continuous self_power_buff clause:
//   `[DON!! x1] This Character gains +1000 power.`
// (Encoded as continuous: condition `if_attached_don_min:1`, action
// `self_power_buff magnitude:1000`.)
//
// Three states exercised (false → true → false reversion):
//   FALSE: 0 DON attached ⇒ refold leaves powerModifierContinuous
//          undefined ⇒ effective power = 5000.
//   TRUE:  1 DON attached via real ATTACH_DON dispatch ⇒ refold sets
//          powerModifierContinuous = 1000 ⇒ effective power = 5000 +
//          1*1000 (DON inherent) + 1000 (continuous) = 7000.
//   REVERT: manual detach (move DON from inst.attachedDon back to
//          A.donRested) + trigger refold via no-op ATTACH_DON dispatch
//          ⇒ powerModifierContinuous cleared ⇒ effective = 5000.
//
// Engine sources:
//   - ContinuousManager.refold resets continuous fields then re-applies
//     by walking liveSources (leader + field + stage). Source:
//     shared/engine-v2/effects/ContinuousManager.ts:25-91.
//   - applyAction calls refold after every reducer return. Source:
//     shared/engine-v2/reducers/applyAction.ts:72.
//   - ATTACH_DON reducer: no-ops on empty donCostArea but refold still
//     runs via applyAction (use this for refold trigger after manual
//     detach). Source: shared/engine-v2/reducers/mainPhase.ts:54-95.
//   - effectivePower formula. Source:
//     shared/engine-v2/state/derived/power.ts:31-52.
//   - CardArt DOM aria-label uses effectivePowerForDisplay (post STEP1
//     fix). Source: src/components/CardArt.tsx:209, :438.
//
// Anchor pre-check rationale: no fully-clean toggleable legality-
// affecting keyword grant exists (corpus query for non-redundant
// printed keywords returned 0). ST01-013 chosen as cleanest single-
// clause toggleable continuous via DON count. Distinct from OP01-001
// Zoro aura (aura_power_buff vs self_power_buff).
//
// Per directive 2026-06-06: harness-only. No engine / UI / card-data
// (file) / scenarioFactory changes. Test runs <2 min.

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

const ST01_013_DEF = {
  id: 'ST01-013',
  name: 'Roronoa Zoro',
  kind: 'character',
  colors: ['red'],
  cost: 3,
  power: 5000,
  counterValue: null,
  traits: ['Supernovas', 'Straw Hat Crew'],
  keywords: [],
  effectTags: ['power_buff'],
  effectText: '[DON!! x1] This Character gains +1000 power.',
  templateParams: { power_buff: 1000 },
  effectSpecV2: {
    schemaVersion: 2,
    verified: 'flagged',
    clauses: [],
    continuous: [
      {
        condition: { type: 'if_attached_don_min', n: 1 },
        action: { kind: 'self_power_buff', magnitude: 1000 },
      },
    ],
    replacements: [],
  },
};

async function seedZoroOnField(page: Page, def: unknown): Promise<string> {
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
    if (!lib['ST01-013']) lib['ST01-013'] = def;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { field: unknown[] } };
    const iid = `seedST01Zoro_${Math.floor(Math.random() * 1e9).toString(36)}`;
    inst[iid] = {
      instanceId: iid, cardId: 'ST01-013', controller: 'A',
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

// Manually detach DON from inst back to A.donRested. Test-only state
// mutation — there is no engine ACTION to detach DON mid-turn.
async function detachAllDonFromInst(page: Page, iid: string): Promise<void> {
  await page.evaluate((id) => {
    const w = window as unknown as {
      __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void };
      __getLegalActions?: (s: unknown, p: string) => unknown;
    };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const instances = s.instances as Record<string, { attachedDon: string[]; attachedDonRested?: string[] }>;
    const inst = instances[id];
    if (!inst) return;
    const players = s.players as { A: { donRested: string[] } };
    const newRested = [...players.A.donRested];
    for (const donId of inst.attachedDon) newRested.push(donId);
    for (const donId of inst.attachedDonRested ?? []) newRested.push(donId);
    inst.attachedDon = [];
    inst.attachedDonRested = [];
    players.A.donRested = newRested;
    w.__store!.setState({ state: { ...s, players: { ...(s.players as Record<string, unknown>), A: { ...players.A } } } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
  }, iid);
  await page.waitForTimeout(150);
}

interface InstSnap {
  attachedDonCount: number;
  powerModifierContinuous: number;
  effectivePower: number;
}

async function readInst(page: Page, iid: string): Promise<InstSnap> {
  return page.evaluate((id) => {
    const w = window as unknown as {
      __store?: {
        getState: () => {
          state: {
            instances: Record<string, {
              cardId: string;
              attachedDon: string[];
              attachedDonRested?: string[];
              powerModifierOneShot?: number;
              powerModifierContinuous?: number;
              powerModifierThisBattle?: number;
              basePowerOverrideOneShot?: number | null;
              basePowerOverrideContinuous?: number | null;
            }>;
            cardLibrary: Record<string, { power?: number; kind?: string }>;
          };
        };
      };
    };
    if (!w.__store) return { attachedDonCount: -1, powerModifierContinuous: -1, effectivePower: -1 };
    const s = w.__store.getState().state;
    const inst = s.instances[id];
    if (!inst) return { attachedDonCount: -1, powerModifierContinuous: -1, effectivePower: -1 };
    const card = s.cardLibrary[inst.cardId];
    const printed = (card?.kind === 'character' || card?.kind === 'leader') ? (card?.power ?? 0) : 0;
    const base = (inst.basePowerOverrideOneShot ?? inst.basePowerOverrideContinuous) ?? printed;
    const donCount = (inst.attachedDon?.length ?? 0) + (inst.attachedDonRested?.length ?? 0);
    const mod = (inst.powerModifierOneShot ?? 0) + (inst.powerModifierContinuous ?? 0) + (inst.powerModifierThisBattle ?? 0);
    return {
      attachedDonCount: donCount,
      powerModifierContinuous: inst.powerModifierContinuous ?? 0,
      effectivePower: Math.max(0, base + donCount * 1000 + mod),
    };
  }, iid);
}

async function readDomPower(page: Page, iid: string): Promise<number | null> {
  return page.evaluate((id) => {
    const btn = document.querySelector(`button[data-instance-id="${id}"]`);
    if (!btn) return null;
    const m = (btn.getAttribute('aria-label') ?? '').match(/power\s+(-?\d+)/i);
    return m ? parseInt(m[1]!, 10) : null;
  }, iid);
}

async function readPhase(page: Page): Promise<{ phase: string; activePlayer: string; pendingKind: string | null }> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __store?: { getState: () => { state: { phase: string; activePlayer: string; pending: { kind?: string } | null } } };
    };
    if (!w.__store) return { phase: '', activePlayer: '', pendingKind: null };
    const s = w.__store.getState().state;
    return { phase: s.phase, activePlayer: s.activePlayer, pendingKind: s.pending?.kind ?? null };
  });
}

test.describe('family-continuous-passive (Stage A)', () => {
  test('ST01-013 Zoro continuous self_power_buff: gated by if_attached_don_min:1; engine + DOM toggle false→true→false', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { drv, pageErrors, invariantErrors } = await bootstrap(page);
    void drv;

    // ── Seed ST01-013 Zoro on A.field, no DON attached ─────────────
    const zoroIid = await seedZoroOnField(page, ST01_013_DEF);

    // ── STATE 1: FALSE (no DON attached, refold not yet triggered) ─
    // The seed setState bypasses applyAction so refold hasn't run.
    // effectivePowerForDisplay still reads inst fields directly; with
    // powerModifierContinuous undefined, effective = base (5000).
    {
      const inst = await readInst(page, zoroIid);
      expect(inst.attachedDonCount, 'no DON attached initially').toBe(0);
      expect(inst.powerModifierContinuous, 'powerModifierContinuous=0 (FALSE state)').toBe(0);
      expect(inst.effectivePower, 'engine effective = 5000 (FALSE)').toBe(5000);

      const dom = await readDomPower(page, zoroIid);
      expect(dom, 'DOM power = 5000 (FALSE)').toBe(5000);

      const phase = await readPhase(page);
      expect(phase.phase, 'phase main').toBe('main');
      expect(phase.activePlayer, 'A turn').toBe('A');
      expect(phase.pendingKind, 'no pending').toBeNull();
    }

    // ── STATE 2: TRUE — attach 1 DON via real ATTACH_DON dispatch ──
    // Dispatch routes through applyAction which calls
    // ContinuousManager.refold AFTER the reducer. Refold walks A.leader
    // + A.field; A.leader (OP01-001) has aura `if_attached_don_min:1
    // AND is_own_turn` — A.leader still has 0 DON ⇒ leader aura false
    // ⇒ no extra +1000 from leader. ST01-013 self clause condition
    // `if_attached_don_min:1` ⇒ true ⇒ powerModifierContinuous += 1000.
    await dispatchAs(page, { type: 'ATTACH_DON', targetInstanceId: zoroIid });

    {
      const inst = await readInst(page, zoroIid);
      expect(inst.attachedDonCount, '1 DON attached').toBe(1);
      expect(inst.powerModifierContinuous, 'powerModifierContinuous = 1000 (TRUE)').toBe(1000);
      // Effective = 5000 base + 1*1000 DON inherent + 1000 continuous = 7000.
      expect(inst.effectivePower, 'engine effective = 7000 (TRUE)').toBe(7000);

      const dom = await readDomPower(page, zoroIid);
      expect(dom, 'DOM power = 7000 (TRUE)').toBe(7000);

      const phase = await readPhase(page);
      expect(phase.phase, 'phase still main').toBe('main');
      expect(phase.activePlayer, 'still A turn').toBe('A');
      expect(phase.pendingKind, 'no pending').toBeNull();
    }

    // ── STATE 3: FALSE via reversion ─────────────────────────────────
    // Manually detach DON (no engine action exists for mid-turn detach)
    // and trigger refold via a no-op dispatch.
    await detachAllDonFromInst(page, zoroIid);
    // A.donCostArea is now empty (was 1 → attached to Zoro). Dispatch
    // ATTACH_DON {targetInstanceId: zoroIid} — the reducer no-ops at
    // mainPhase.ts:61 because donCostArea is empty, but applyAction.ts:72
    // still runs ContinuousManager.refold afterwards.
    await dispatchAs(page, { type: 'ATTACH_DON', targetInstanceId: zoroIid });

    {
      const inst = await readInst(page, zoroIid);
      expect(inst.attachedDonCount, '0 DON attached after reversion').toBe(0);
      expect(inst.powerModifierContinuous, 'powerModifierContinuous cleared (FALSE again)').toBe(0);
      expect(inst.effectivePower, 'engine effective = 5000 (FALSE again)').toBe(5000);

      const dom = await readDomPower(page, zoroIid);
      expect(dom, 'DOM power = 5000 (FALSE again)').toBe(5000);

      const phase = await readPhase(page);
      expect(phase.phase, 'phase still main').toBe('main');
      expect(phase.activePlayer, 'still A turn').toBe('A');
      expect(phase.pendingKind, 'no pending').toBeNull();
    }

    // ── Stability ────────────────────────────────────────────────────
    expect(pageErrors, 'no pageerrors').toEqual([]);
    expect(invariantErrors, 'no InvariantErrors').toEqual([]);
  });
});
