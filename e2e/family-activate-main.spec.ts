// family-activate-main — Stage A representative anchor for the
// activate_main mechanic family. Verifies OP01-020 Hyogoro's
// activate_main clause:
//   `[Activate: Main] You may rest this Character: Up to 1 of your
//    Leader or Character cards gains +2000 power during this turn.`
//
// Engine sources:
//   - activateMainReducer dispatches clauses with trigger 'activate_main'.
//     Source: shared/engine-v2/reducers/mainPhase.ts:289-315.
//   - Legal action enumeration: leader / field / stage with
//     `activate_main` keyword and `!rested`.
//     Source: shared/engine-v2/rules/legality.ts:287-310.
//   - restSelf cost handler: marks source.rested=true.
//     Source: shared/engine-v2/registry/handlers/costs2.ts:19-31.
//   - power_buff `this_turn` writes `powerModifierOneShot` with
//     `expiresInTurns=0`. Source:
//     shared/engine-v2/registry/handlers/actions.ts:75-103.
//   - End-of-turn tick clears `powerModifierOneShot` when
//     `expiresInTurns===0`. Source:
//     shared/engine-v2/phases/PhaseScheduler.ts:253-261.
//   - your_leader_or_character target resolver: leader FIRST, then
//     field chars. Source:
//     shared/engine-v2/registry/handlers/targets.ts (yourLeaderOrCharacter).
//   - UI ACTIVATE button mounts in CardDetailModal when legal action
//     ACTIVATE_MAIN matches the modal's instance.
//     Source: src/components/CardDetailModal.tsx:131-140.
//
// Anchor card data (OP01-020 Hyogoro): character, red, cost 2, power
// 3000, keywords:['activate_main']. Single clause: cost:{restSelf:true},
// action:{kind:'power_buff', magnitude:2000, duration:'this_turn'},
// target:{kind:'your_leader_or_character'}. NO condition, NO opt, NO
// sequence, NO binding, NO donCost.
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

const OP01_020_DEF = {
  id: 'OP01-020',
  name: 'Hyogoro',
  kind: 'character',
  colors: ['red'],
  cost: 2,
  power: 3000,
  counterValue: null,
  traits: ['Land of Wano'],
  keywords: ['activate_main'],
  effectTags: ['power_buff'],
  effectText: '[Activate: Main] You may rest this Character: Up to 1 of your Leader or Character cards gains +2000 power during this turn.',
  effectSpecV2: {
    clauses: [
      {
        trigger: 'activate_main',
        cost: { restSelf: true },
        action: { kind: 'power_buff', magnitude: 2000, duration: 'this_turn' },
        target: { kind: 'your_leader_or_character' },
        verified: 'human-reviewed',
      },
    ],
    continuous: [],
    replacements: [],
    schemaVersion: 2,
    verified: 'human-reviewed',
  },
};

async function seedHyogoroOnField(page: Page, def: unknown): Promise<string> {
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
    if (!lib['OP01-020']) lib['OP01-020'] = def;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { field: unknown[] } };
    const iid = `seedHyogoro_${Math.floor(Math.random() * 1e9).toString(36)}`;
    inst[iid] = {
      instanceId: iid, cardId: 'OP01-020', controller: 'A',
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

async function seedControlCharOnField(page: Page): Promise<string> {
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
    const players = s.players as { A: { field: unknown[] } };
    const synthId = `__seed_ctl_${Math.floor(Math.random() * 1e9).toString(36)}`;
    const iid = `seedCtl_${Math.floor(Math.random() * 1e9).toString(36)}`;
    lib[synthId] = {
      id: synthId, name: 'AM Ctrl A', kind: 'character',
      cost: 1, power: 1000, counterValue: 1000,
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
    players.A.field = [...players.A.field, inst[iid]];
    w.__store.setState({ state: { ...s } });
    if (w.__getLegalActions) {
      const next = w.__store.getState().state as { activePlayer: string };
      w.__store.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
    return iid;
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
  turn: number;
  hyogoroRested: boolean | null;
  aLeaderPowerMod: number;
  aLeaderEffective: number;
  aLeaderBase: number;
  ctlEffective: number;
  ctlPowerMod: number;
}

async function readSnap(page: Page, hyogoroIid: string, ctlIid: string): Promise<Snap> {
  return page.evaluate(({ hid, cid }) => {
    const w = window as unknown as {
      __store?: {
        getState: () => {
          state: {
            phase: string;
            activePlayer: string;
            pending: { kind?: string } | null;
            turn: number;
            instances: Record<string, {
              rested?: boolean;
              powerModifierOneShot?: number;
              powerModifierContinuous?: number;
              powerModifierThisBattle?: number;
              attachedDon: string[];
              attachedDonRested: string[];
              basePowerOverrideOneShot?: number | null;
              basePowerOverrideContinuous?: number | null;
              cardId: string;
            }>;
            cardLibrary: Record<string, { power?: number; kind?: string }>;
            players: { A: { leader: { instanceId: string } } };
          };
        };
      };
    };
    if (!w.__store) {
      return { phase: '', activePlayer: '', pendingKind: null, turn: -1, hyogoroRested: null, aLeaderPowerMod: 0, aLeaderEffective: 0, aLeaderBase: 0, ctlEffective: 0, ctlPowerMod: 0 };
    }
    const s = w.__store.getState().state;
    function eff(iid: string): { eff: number; base: number; mod: number } {
      const inst = s.instances[iid];
      if (!inst) return { eff: 0, base: 0, mod: 0 };
      const card = s.cardLibrary[inst.cardId];
      const printed = (card?.kind === 'character' || card?.kind === 'leader') ? (card?.power ?? 0) : 0;
      const base = (inst.basePowerOverrideOneShot ?? inst.basePowerOverrideContinuous) ?? printed;
      const donCount = (inst.attachedDon?.length ?? 0) + (inst.attachedDonRested?.length ?? 0);
      const mod = (inst.powerModifierOneShot ?? 0) + (inst.powerModifierContinuous ?? 0) + (inst.powerModifierThisBattle ?? 0);
      const eff = Math.max(0, base + donCount * 1000 + mod);
      return { eff, base, mod: inst.powerModifierOneShot ?? 0 };
    }
    const hy = s.instances[hid];
    const aLeader = s.players.A.leader.instanceId;
    const e = eff(aLeader);
    const ec = eff(cid);
    return {
      phase: s.phase,
      activePlayer: s.activePlayer,
      pendingKind: s.pending?.kind ?? null,
      turn: s.turn,
      hyogoroRested: hy ? (hy.rested ?? false) : null,
      aLeaderPowerMod: e.mod,
      aLeaderEffective: e.eff,
      aLeaderBase: e.base,
      ctlEffective: ec.eff,
      ctlPowerMod: ec.mod,
    };
  }, { hid: hyogoroIid, cid: ctlIid });
}

async function readDomPower(page: Page, iid: string): Promise<number | null> {
  return page.evaluate((id) => {
    const btn = document.querySelector(`button[data-instance-id="${id}"]`);
    if (!btn) return null;
    const m = (btn.getAttribute('aria-label') ?? '').match(/power\s+(-?\d+)/i);
    return m ? parseInt(m[1]!, 10) : null;
  }, iid);
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

test.describe('family-activate-main (Stage A)', () => {
  test('OP01-020 Hyogoro activate_main: rest self → +2000 to A leader this_turn; expires at end of turn', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { drv, pageErrors, invariantErrors } = await bootstrap(page);

    // ── Seed scene ───────────────────────────────────────────────────
    const hyogoroIid = await seedHyogoroOnField(page, OP01_020_DEF);
    const ctlIid = await seedControlCharOnField(page);

    // ── BEFORE activate ─────────────────────────────────────────────
    const before = await readSnap(page, hyogoroIid, ctlIid);
    expect(before.phase, 'phase=main').toBe('main');
    expect(before.activePlayer, 'A turn').toBe('A');
    expect(before.pendingKind, 'no pending').toBeNull();
    expect(before.hyogoroRested, 'Hyogoro active before').toBe(false);
    expect(before.aLeaderBase, 'A leader base = 5000').toBe(5000);
    expect(before.aLeaderEffective, 'A leader effective = base').toBe(5000);
    expect(before.aLeaderPowerMod, 'A leader powerModifierOneShot = 0').toBe(0);
    expect(before.ctlEffective, 'control char effective = 1000').toBe(1000);

    // DOM truth: A leader aria-label shows power 5000.
    const aLeaderIid = await page.evaluate(() => {
      const w = window as unknown as { __store?: { getState: () => { state: { players: { A: { leader: { instanceId: string } } } } } } };
      return w.__store!.getState().state.players.A.leader.instanceId;
    });
    const leaderDomBefore = await readDomPower(page, aLeaderIid);
    const ctlDomBefore = await readDomPower(page, ctlIid);
    expect(leaderDomBefore, 'A leader DOM power = 5000 before').toBe(5000);
    expect(ctlDomBefore, 'control char DOM power = 1000 before').toBe(1000);

    // Legality: ACTIVATE_MAIN for Hyogoro present.
    const aLegalBefore = await legalActionsFor(page, 'A') as { type: string; instanceId?: string }[];
    const amBefore = aLegalBefore.filter((a) => a.type === 'ACTIVATE_MAIN').map((a) => a.instanceId);
    expect(amBefore, 'Hyogoro offered as ACTIVATE_MAIN').toContain(hyogoroIid);
    expect(amBefore, 'control char NOT offered as ACTIVATE_MAIN').not.toContain(ctlIid);

    // ── UI: ACTIVATE button visible ─────────────────────────────────
    // Open Hyogoro via field-button click → CardDetailModal mounts →
    // ACTIVATE button renders when legal.
    await page.evaluate((id) => {
      const btn = document.querySelector(`button[data-instance-id="${id}"]`) as HTMLButtonElement | null;
      if (btn) btn.click();
    }, hyogoroIid);
    const activateBtn = page.getByRole('button', { name: /^activate$/i }).first();
    await expect(activateBtn, 'ACTIVATE button visible in CardDetailModal').toBeVisible({ timeout: 5_000 });

    // ── Click ACTIVATE via real UI ──────────────────────────────────
    await activateBtn.click();
    await page.waitForTimeout(300);

    // ── AFTER activate ──────────────────────────────────────────────
    const after = await readSnap(page, hyogoroIid, ctlIid);

    // Engine: Hyogoro rested, A leader powerModifierOneShot = 2000.
    expect(after.hyogoroRested, 'Hyogoro rested after activate').toBe(true);
    expect(after.aLeaderPowerMod, 'A leader powerModifierOneShot = 2000').toBe(2000);
    expect(after.aLeaderEffective, 'A leader effective = 7000').toBe(7000);
    expect(after.aLeaderBase, 'A leader base unchanged').toBe(5000);

    // Scope: control char unchanged (deterministic resolver picks leader).
    expect(after.ctlEffective, 'control char effective = 1000 (untargeted)').toBe(1000);
    expect(after.ctlPowerMod, 'control char powerModifier = 0').toBe(0);

    // Pending / phase.
    expect(after.pendingKind, 'no pending after activate').toBeNull();
    expect(after.phase, 'phase still main').toBe('main');
    expect(after.activePlayer, 'still A turn').toBe('A');

    // DOM truth: A leader aria-label shows 7000.
    const leaderDomAfter = await readDomPower(page, aLeaderIid);
    const ctlDomAfter = await readDomPower(page, ctlIid);
    expect(leaderDomAfter, 'A leader DOM power = 7000').toBe(7000);
    expect(ctlDomAfter, 'control char DOM power = 1000').toBe(1000);

    // Legality post-activate: ACTIVATE_MAIN no longer offered for Hyogoro.
    const aLegalAfter = await legalActionsFor(page, 'A') as { type: string; instanceId?: string }[];
    const amAfter = aLegalAfter.filter((a) => a.type === 'ACTIVATE_MAIN').map((a) => a.instanceId);
    expect(amAfter, 'Hyogoro NOT in legal ACTIVATE_MAIN (rested)').not.toContain(hyogoroIid);

    // UI: Hyogoro still on field but rested. Field-presence still true.
    expect(await isOnYourField(page, hyogoroIid), 'Hyogoro still on field after activate').toBe(true);

    // ── End A's turn → powerModifierOneShot tick expires ───────────
    const turnBefore = after.turn;
    await drv.endTurn();
    // Wait for cycle to leave A's turn.
    await expect.poll(
      async () => {
        const s = await readSnap(page, hyogoroIid, ctlIid);
        if (s.activePlayer === 'B') return 'B';
        if (s.turn > turnBefore) return 'cycledBackToA';
        return s.activePlayer + '/' + s.turn;
      },
      { timeout: 30_000 },
    ).toMatch(/^B$|^cycledBackToA$/);

    // After end-of-turn tick: A leader powerModifierOneShot cleared.
    const expired = await readSnap(page, hyogoroIid, ctlIid);
    expect(expired.aLeaderPowerMod, 'A leader powerModifierOneShot cleared at end of turn').toBe(0);
    expect(expired.aLeaderEffective, 'A leader effective back to 5000').toBe(5000);

    // DOM truth: A leader aria-label back to 5000.
    const leaderDomExpired = await readDomPower(page, aLeaderIid);
    expect(leaderDomExpired, 'A leader DOM power back to 5000').toBe(5000);

    // ── Stability ────────────────────────────────────────────────────
    expect(pageErrors, 'no pageerrors').toEqual([]);
    expect(invariantErrors, 'no InvariantErrors').toEqual([]);
  });
});
