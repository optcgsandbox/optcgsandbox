// stage-b-continuous-passive — Stage B expansion of continuous/passive
// family. Covers 8 cards across the major continuous-action variants:
//   1. ST01-013 Zoro                — self_power_buff (DON gate)  [control]
//   2. OP01-001 Zoro leader         — aura_power_buff (DON + own_turn)
//   3. OP01-019 Bartolomeo          — 2 clauses: grant_keyword_to_self:
//                                     blocker (uncond) + self_power_buff
//                                     +3000 (DON≥2 AND is_opp_turn)
//   4. OP01-014 Jinbe               — grant_keyword_to_self:blocker
//                                     (uncond) — verifies refold
//                                     populates grantedKeywordsContinuous
//   5. EB04-057 Vegapunk            — 2 clauses: aura_immunity (life≤2)
//                                     + grant_keyword_to_self:blocker
//                                     (DON≥1)
//   6. OP01-068 Gecko Moria         — grant_keyword_to_self:double_attack
//                                     (if_hand_min:5)
//   7. EB01-014 Sanji               — self_power_buff per_count formula
//                                     (rested_don_count / 3 × 1000)
//   8. OP03-004 Curiel              — grant_keyword_to_self:rush
//                                     (if_attached_don_min:1)
//
// Engine sources:
//   - ContinuousManager.refold walks live sources (leader + field + stage)
//     and re-applies after every applyAction. Source:
//     shared/engine-v2/effects/ContinuousManager.ts:25-91.
//   - CONTINUOUS_RESET_FIELDS at :31-41 lists fields cleared per refold
//     tick: powerModifierContinuous, basePowerOverrideContinuous,
//     costModifierContinuous, grantedKeywordsContinuous,
//     immunityContinuous, attackLockedContinuous, counterBonus,
//     damageImmunityAttribute, restrictEffectType.
//   - applyAction calls refold post-reducer. Source:
//     shared/engine-v2/reducers/applyAction.ts:72. Any dispatch
//     triggers refold even when reducer no-ops.
//   - effectivePower formula. Source:
//     shared/engine-v2/state/derived/power.ts:31-52.
//   - aura_immunity writes inst.immunityContinuous = {against}. Source:
//     shared/engine-v2/registry/handlers/continuous.ts:288-300.
//
// Per directive: harness-only. No engine / UI / card-data /
// scenarioFactory changes. Each test runs <30s; whole spec budget
// under 5 min.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { PlayerDriver } from './helpers/player';

const TWO_MIN = 2 * 60_000;

test.use({
  launchOptions: {
    args: ['--disable-renderer-backgrounding', '--no-sandbox'],
  },
});

// Live corpus reads so card defs always match cards.json.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CORPUS_PATH = resolve(__dirname, '../shared/data/cards.json');
const CORPUS_RAW = JSON.parse(readFileSync(CORPUS_PATH, 'utf-8')) as unknown;
const CORPUS = (Array.isArray(CORPUS_RAW) ? CORPUS_RAW : Object.values(CORPUS_RAW as Record<string, unknown>)) as Array<Record<string, unknown>>;
function corpusDef(id: string): Record<string, unknown> {
  const found = CORPUS.find((c) => (c as { id?: string }).id === id);
  if (!found) throw new Error(`corpus missing ${id}`);
  return found;
}

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
    { timeout: 60_000 },
  ).toMatchObject({ phase: 'main', activePlayer: 'A' });
  await drv.normalizeToATurn1Main();
  return { drv, pageErrors, invariantErrors };
}

// ─── Seed helpers ────────────────────────────────────────────────────

async function seedCharOnAField(page: Page, def: Record<string, unknown>): Promise<string> {
  return page.evaluate((def) => {
    const w = window as unknown as {
      __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void };
      __getLegalActions?: (s: unknown, p: string) => unknown;
    };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    lib[def['id'] as string] = def;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { field: unknown[] } };
    const iid = `seedSB_${def['id']}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    inst[iid] = {
      instanceId: iid, cardId: def['id'], controller: 'A',
      rested: false, summoningSick: false,
      attachedDon: [], attachedDonRested: [],
      perTurn: { hasAttacked: false, effectsUsed: [] },
    };
    players.A.field = [...players.A.field, inst[iid]];
    w.__store!.setState({ state: { ...s } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
    return iid;
  }, def);
}

async function seedSummoningSickCharOnAField(page: Page, def: Record<string, unknown>): Promise<string> {
  return page.evaluate((def) => {
    const w = window as unknown as {
      __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void };
      __getLegalActions?: (s: unknown, p: string) => unknown;
    };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    lib[def['id'] as string] = def;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { field: unknown[] } };
    const iid = `seedSBss_${def['id']}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    inst[iid] = {
      instanceId: iid, cardId: def['id'], controller: 'A',
      rested: false, summoningSick: true,
      attachedDon: [], attachedDonRested: [],
      perTurn: { hasAttacked: false, effectsUsed: [] },
    };
    players.A.field = [...players.A.field, inst[iid]];
    w.__store!.setState({ state: { ...s } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
    return iid;
  }, def);
}

async function seedGenericACharOnField(page: Page, power: number, tag: string): Promise<string> {
  return page.evaluate(({ power, tag }) => {
    const w = window as unknown as {
      __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void };
      __getLegalActions?: (s: unknown, p: string) => unknown;
    };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { field: unknown[] } };
    const synthId = `__seed_sb_${tag}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    const iid = `seedSBg_${tag}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    lib[synthId] = {
      id: synthId, name: `SB ${tag}`, kind: 'character',
      cost: 1, power, counterValue: 1000,
      colors: ['red'], traits: [], keywords: [], effectText: '',
    };
    inst[iid] = {
      instanceId: iid, cardId: synthId, controller: 'A',
      rested: false, summoningSick: false,
      attachedDon: [], attachedDonRested: [],
      perTurn: { hasAttacked: false, effectsUsed: [] },
    };
    players.A.field = [...players.A.field, inst[iid]];
    w.__store!.setState({ state: { ...s } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
    return iid;
  }, { power, tag });
}

async function seedGenericBCharOnField(page: Page, power: number, tag: string): Promise<string> {
  return page.evaluate(({ power, tag }) => {
    const w = window as unknown as {
      __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void };
      __getLegalActions?: (s: unknown, p: string) => unknown;
    };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { B: { field: unknown[] } };
    const synthId = `__seed_sb_b_${tag}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    const iid = `seedSBb_${tag}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    lib[synthId] = {
      id: synthId, name: `SB B ${tag}`, kind: 'character',
      cost: 1, power, counterValue: 1000,
      colors: ['red'], traits: [], keywords: [], effectText: '',
    };
    inst[iid] = {
      instanceId: iid, cardId: synthId, controller: 'B',
      rested: false, summoningSick: false,
      attachedDon: [], attachedDonRested: [],
      perTurn: { hasAttacked: false, effectsUsed: [] },
    };
    players.B.field = [...players.B.field, inst[iid]];
    w.__store!.setState({ state: { ...s } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
    return iid;
  }, { power, tag });
}

// ─── State helpers ───────────────────────────────────────────────────

async function dispatchAs(page: Page, action: object): Promise<void> {
  await page.evaluate((a) => {
    const w = window as unknown as { __store?: { getState: () => { dispatch: (a: unknown) => void } } };
    w.__store!.getState().dispatch(a);
  }, action);
  await page.waitForTimeout(150);
}

// Trigger ContinuousManager.refold via a guaranteed no-op dispatch.
// Uses ATTACH_DON with a bogus targetInstanceId: the reducer rejects
// at `state.instances[target] === undefined` (mainPhase.ts:64-65) BEFORE
// touching donCostArea, but applyAction.ts:72 still runs refold. This
// guarantees zero side effects on attached DON / cost area.
async function triggerRefold(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __store?: { getState: () => { dispatch: (a: unknown) => void } };
    };
    w.__store!.getState().dispatch({ type: 'ATTACH_DON', targetInstanceId: '__noop_refold__' });
  });
  await page.waitForTimeout(150);
}

async function setActivePlayerAndRefold(page: Page, player: 'A' | 'B'): Promise<void> {
  await page.evaluate((p) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    (s as Record<string, unknown>).activePlayer = p;
    w.__store!.setState({ state: { ...s } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
  }, player);
  await triggerRefold(page);
}

async function attachDonToInst(page: Page, iid: string, n: number): Promise<void> {
  await page.evaluate(({ iid, n }) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown; dispatch: (a: unknown) => void } } };
    for (let i = 0; i < n; i += 1) {
      w.__store!.getState().dispatch({ type: 'ATTACH_DON', targetInstanceId: iid });
    }
  }, { iid, n });
  await page.waitForTimeout(150);
}

// Replenish A's donCostArea up to N from donDeck so subsequent attaches succeed.
async function topUpADon(page: Page, n: number): Promise<void> {
  await page.evaluate((n) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const players = s.players as { A: { donDeck: string[]; donCostArea: string[] } };
    const newDeck = [...players.A.donDeck];
    const newCost = [...players.A.donCostArea];
    while (newCost.length < n && newDeck.length > 0) {
      const id = newDeck.shift();
      if (id !== undefined) newCost.push(id);
    }
    players.A.donDeck = newDeck;
    players.A.donCostArea = newCost;
    w.__store!.setState({ state: { ...s, players: { ...(s.players as Record<string, unknown>), A: { ...players.A } } } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
  }, n);
  await page.waitForTimeout(100);
}

// Mutate A.donRested to exactly N (move excess to donDeck OR pull from donDeck).
async function setADonRestedCount(page: Page, n: number): Promise<void> {
  await page.evaluate((n) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const players = s.players as { A: { donDeck: string[]; donRested: string[] } };
    const newDeck = [...players.A.donDeck];
    const newRested = [...players.A.donRested];
    while (newRested.length > n) {
      const id = newRested.pop();
      if (id !== undefined) newDeck.push(id);
    }
    while (newRested.length < n && newDeck.length > 0) {
      const id = newDeck.shift();
      if (id !== undefined) newRested.push(id);
    }
    players.A.donDeck = newDeck;
    players.A.donRested = newRested;
    w.__store!.setState({ state: { ...s, players: { ...(s.players as Record<string, unknown>), A: { ...players.A } } } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
  }, n);
  await page.waitForTimeout(100);
}

// Shrinks A.life to N cards. Returns the FULL pre-shrink A.life array
// so the test can restore it later.
async function setALifeCount(page: Page, n: number): Promise<string[]> {
  return page.evaluate((n) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const players = s.players as { A: { life: string[] } };
    const snapshot = [...players.A.life];
    players.A.life = players.A.life.slice(0, n);
    w.__store!.setState({ state: { ...s, players: { ...(s.players as Record<string, unknown>), A: { ...players.A } } } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
    return snapshot;
  }, n);
}

async function restoreALife(page: Page, snapshot: string[]): Promise<void> {
  await page.evaluate((snap) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const players = s.players as { A: { life: string[] } };
    players.A.life = [...snap];
    w.__store!.setState({ state: { ...s, players: { ...(s.players as Record<string, unknown>), A: { ...players.A } } } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
  }, snapshot);
  await page.waitForTimeout(100);
}

async function trimAHandTo(page: Page, n: number): Promise<void> {
  await page.evaluate((n) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const players = s.players as { A: { hand: string[] } };
    players.A.hand = players.A.hand.slice(0, n);
    w.__store!.setState({ state: { ...s, players: { ...(s.players as Record<string, unknown>), A: { ...players.A } } } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
  }, n);
  await page.waitForTimeout(100);
}

// ─── Read helpers ────────────────────────────────────────────────────

interface InstObs {
  powerModifierContinuous: number;
  grantedKeywordsContinuous: string[];
  immunityAgainst: string | null;
  effectivePower: number;
  attachedDonCount: number;
}

async function readInst(page: Page, iid: string): Promise<InstObs> {
  return page.evaluate((id) => {
    const w = window as unknown as {
      __store?: {
        getState: () => {
          state: {
            instances: Record<string, {
              cardId: string;
              attachedDon?: string[]; attachedDonRested?: string[];
              powerModifierOneShot?: number; powerModifierContinuous?: number; powerModifierThisBattle?: number;
              basePowerOverrideOneShot?: number | null; basePowerOverrideContinuous?: number | null;
              grantedKeywordsContinuous?: string[];
              immunityContinuous?: { against?: string };
            }>;
            cardLibrary: Record<string, { power?: number; kind?: string }>;
          };
        };
      };
    };
    const s = w.__store!.getState().state;
    const inst = s.instances[id];
    if (!inst) return { powerModifierContinuous: 0, grantedKeywordsContinuous: [], immunityAgainst: null, effectivePower: -1, attachedDonCount: 0 };
    const card = s.cardLibrary[inst.cardId];
    const printed = (card?.kind === 'character' || card?.kind === 'leader') ? (card?.power ?? 0) : 0;
    const base = (inst.basePowerOverrideOneShot ?? inst.basePowerOverrideContinuous) ?? printed;
    const donCount = (inst.attachedDon?.length ?? 0) + (inst.attachedDonRested?.length ?? 0);
    const mod = (inst.powerModifierOneShot ?? 0) + (inst.powerModifierContinuous ?? 0) + (inst.powerModifierThisBattle ?? 0);
    return {
      powerModifierContinuous: inst.powerModifierContinuous ?? 0,
      grantedKeywordsContinuous: [...(inst.grantedKeywordsContinuous ?? [])],
      immunityAgainst: inst.immunityContinuous?.against ?? null,
      effectivePower: Math.max(0, base + donCount * 1000 + mod),
      attachedDonCount: donCount,
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

async function getALeaderIid(page: Page): Promise<string> {
  return page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { state: { players: { A: { leader: { instanceId: string } } } } } } };
    return w.__store!.getState().state.players.A.leader.instanceId;
  });
}

async function legalActionsFor(page: Page, player: 'A' | 'B'): Promise<Array<{ type: string; instanceId?: string; attackerInstanceId?: string }>> {
  return page.evaluate((p) => {
    const w = window as unknown as {
      __store?: { getState: () => { state: unknown } };
      __getLegalActions?: (s: unknown, p: string) => unknown[];
    };
    if (!w.__getLegalActions) return [];
    return w.__getLegalActions(w.__store!.getState().state, p) as Array<{ type: string; instanceId?: string; attackerInstanceId?: string }>;
  }, player);
}

// Set turn=3 + perTurn cleanup so attack legality opens (CR §6-5-6-1
// first-turn rule otherwise blocks).
async function forceT3AMain(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    (s as Record<string, unknown>).turn = 3;
    (s as Record<string, unknown>).activePlayer = 'A';
    (s as Record<string, unknown>).phase = 'main';
    (s as Record<string, unknown>).firstPlayer = 'A';
    w.__store!.setState({ state: { ...s } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
  });
  await page.waitForTimeout(100);
}

// ─── Tests ───────────────────────────────────────────────────────────

test.describe('stage-b continuous/passive expansion', () => {
  // 1. ST01-013 control
  test('ST01-013 Zoro — self_power_buff if_attached_don_min:1 (Stage A control)', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    const zoroIid = await seedCharOnAField(page, corpusDef('ST01-013'));
    const before = await readInst(page, zoroIid);
    expect(before.powerModifierContinuous, 'FALSE: no continuous buff').toBe(0);
    expect(before.effectivePower, 'FALSE: 5000').toBe(5000);
    await attachDonToInst(page, zoroIid, 1);
    const after = await readInst(page, zoroIid);
    expect(after.powerModifierContinuous, 'TRUE: +1000').toBe(1000);
    expect(after.effectivePower, 'TRUE: 7000 (5000+DON+continuous)').toBe(7000);
    expect(await readDomPower(page, zoroIid), 'DOM matches engine').toBe(7000);
    expect(pageErrors).toEqual([]);
    expect(invariantErrors).toEqual([]);
  });

  // 2. OP01-001 leader aura: scope + multi-DON + own-turn gate
  test('OP01-001 Zoro leader — aura_power_buff +1000 to ALL own chars (DON≥1 + is_own_turn); B chars unchanged; reverts on opp turn', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    const a1 = await seedGenericACharOnField(page, 1000, 'aura1');
    const a2 = await seedGenericACharOnField(page, 1500, 'aura2');
    const b1 = await seedGenericBCharOnField(page, 1000, 'aurab');
    const aLeader = await getALeaderIid(page);

    // FALSE state: no DON on A.leader.
    await triggerRefold(page);
    expect((await readInst(page, a1)).powerModifierContinuous, 'a1 FALSE').toBe(0);
    expect((await readInst(page, a2)).powerModifierContinuous, 'a2 FALSE').toBe(0);
    expect((await readInst(page, b1)).powerModifierContinuous, 'b1 FALSE').toBe(0);

    // TRUE state: attach 1 DON to A.leader on A's turn.
    await attachDonToInst(page, aLeader, 1);
    expect((await readInst(page, a1)).powerModifierContinuous, 'a1 TRUE').toBe(1000);
    expect((await readInst(page, a2)).powerModifierContinuous, 'a2 TRUE').toBe(1000);
    expect((await readInst(page, b1)).powerModifierContinuous, 'b1 scope-filter').toBe(0);
    expect(await readDomPower(page, a1), 'DOM a1 = 2000').toBe(2000);
    expect(await readDomPower(page, a2), 'DOM a2 = 2500').toBe(2500);
    expect(await readDomPower(page, b1), 'DOM b1 = 1000').toBe(1000);

    // Reversion: flip to opp turn → is_own_turn false → aura clears.
    await setActivePlayerAndRefold(page, 'B');
    expect((await readInst(page, a1)).powerModifierContinuous, 'a1 reverted').toBe(0);
    expect((await readInst(page, a2)).powerModifierContinuous, 'a2 reverted').toBe(0);

    expect(pageErrors).toEqual([]);
    expect(invariantErrors).toEqual([]);
  });

  // 3. OP01-019 Bartolomeo: TWO continuous clauses
  test('OP01-019 Bartolomeo — grant_keyword_to_self:blocker (uncond) + self_power_buff +3000 (DON≥2 AND is_opp_turn)', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    const bartoIid = await seedCharOnAField(page, corpusDef('OP01-019'));
    await topUpADon(page, 2);

    // Initial: 0 DON, A's turn → grant should fire, self_power_buff false.
    await triggerRefold(page);
    const init = await readInst(page, bartoIid);
    expect(init.grantedKeywordsContinuous, 'grant_keyword:blocker uncond').toContain('blocker');
    expect(init.powerModifierContinuous, 'self_power_buff FALSE').toBe(0);
    expect(init.effectivePower, 'effective 2000').toBe(2000);

    // Attach 2 DON; A still active turn.
    await attachDonToInst(page, bartoIid, 2);
    const a1 = await readInst(page, bartoIid);
    expect(a1.grantedKeywordsContinuous, 'still has blocker').toContain('blocker');
    expect(a1.powerModifierContinuous, 'still FALSE (is_own_turn)').toBe(0);

    // Flip to opp turn → condition true (DON≥2 AND is_opp_turn).
    await setActivePlayerAndRefold(page, 'B');
    const a2 = await readInst(page, bartoIid);
    expect(a2.powerModifierContinuous, 'TRUE: +3000').toBe(3000);
    expect(a2.effectivePower, 'effective 2000+2*1000+3000=7000').toBe(7000);
    expect(await readDomPower(page, bartoIid), 'DOM = 7000').toBe(7000);

    // Reversion: flip back to A's turn.
    await setActivePlayerAndRefold(page, 'A');
    const a3 = await readInst(page, bartoIid);
    expect(a3.powerModifierContinuous, 'reverted to 0').toBe(0);

    expect(pageErrors).toEqual([]);
    expect(invariantErrors).toEqual([]);
  });

  // 4. OP01-014 Jinbe — unconditional grant_keyword_to_self
  test('OP01-014 Jinbe — grant_keyword_to_self:blocker unconditionally writes grantedKeywordsContinuous', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    const jinbeIid = await seedCharOnAField(page, corpusDef('OP01-014'));
    // No refold yet — grantedKeywordsContinuous undefined.
    const pre = await readInst(page, jinbeIid);
    expect(pre.grantedKeywordsContinuous, 'pre-refold empty').toEqual([]);
    // Trigger refold.
    await triggerRefold(page);
    const post = await readInst(page, jinbeIid);
    expect(post.grantedKeywordsContinuous, 'post-refold contains blocker').toContain('blocker');
    expect(pageErrors).toEqual([]);
    expect(invariantErrors).toEqual([]);
  });

  // 5. EB04-057 Vegapunk — aura_immunity (life≤2) + grant blocker (DON≥1)
  test('EB04-057 Vegapunk — aura_immunity when A.life≤2; grant_keyword:blocker when DON≥1; independent toggles', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    const vegapunkIid = await seedCharOnAField(page, corpusDef('EB04-057'));

    // Initial: A.life=5 (>2), DON=0 → both clauses FALSE.
    await triggerRefold(page);
    let s = await readInst(page, vegapunkIid);
    expect(s.immunityAgainst, 'no immunity').toBeNull();
    expect(s.grantedKeywordsContinuous, 'no blocker grant').not.toContain('blocker');

    // Toggle aura_immunity TRUE: set A.life=2 (snapshot full A.life
    // first so we can restore at reversion).
    const lifeSnapshot = await setALifeCount(page, 2);
    await triggerRefold(page);
    s = await readInst(page, vegapunkIid);
    expect(s.immunityAgainst, 'aura_immunity fires (life≤2)').not.toBeNull();
    expect(s.grantedKeywordsContinuous, 'blocker still FALSE').not.toContain('blocker');

    // Toggle grant TRUE: attach 1 DON.
    await attachDonToInst(page, vegapunkIid, 1);
    s = await readInst(page, vegapunkIid);
    expect(s.grantedKeywordsContinuous, 'blocker now TRUE (DON≥1)').toContain('blocker');
    expect(s.immunityAgainst, 'immunity still TRUE').not.toBeNull();

    // Reversion: restore A.life → immunity drops; blocker persists (DON unchanged).
    await restoreALife(page, lifeSnapshot);
    await triggerRefold(page);
    s = await readInst(page, vegapunkIid);
    expect(s.immunityAgainst, 'immunity cleared').toBeNull();
    expect(s.grantedKeywordsContinuous, 'blocker remains').toContain('blocker');

    expect(pageErrors).toEqual([]);
    expect(invariantErrors).toEqual([]);
  });

  // 6. OP01-068 Gecko Moria — grant double_attack via hand-size
  test('OP01-068 Gecko Moria — grant_keyword:double_attack iff if_hand_min:5; toggle by hand-size', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    const moriaIid = await seedCharOnAField(page, corpusDef('OP01-068'));

    // Default hand likely > 5 ⇒ TRUE.
    await triggerRefold(page);
    let s = await readInst(page, moriaIid);
    expect(s.grantedKeywordsContinuous, 'hand>5 TRUE: double_attack').toContain('double_attack');

    // Trim to 4 → FALSE.
    await trimAHandTo(page, 4);
    await triggerRefold(page);
    s = await readInst(page, moriaIid);
    expect(s.grantedKeywordsContinuous, 'hand=4 FALSE: no double_attack').not.toContain('double_attack');

    // Trim back to ensure exactly 5 → TRUE boundary.
    await page.evaluate(() => {
      const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown }) => void } };
      const st = w.__store!.getState().state as Record<string, unknown>;
      const players = st.players as { A: { hand: string[]; deck: string[] } };
      const newHand = [...players.A.hand];
      const newDeck = [...players.A.deck];
      while (newHand.length < 5 && newDeck.length > 0) {
        const id = newDeck.shift();
        if (id !== undefined) newHand.push(id);
      }
      players.A.hand = newHand;
      players.A.deck = newDeck;
      w.__store!.setState({ state: { ...st, players: { ...(st.players as Record<string, unknown>), A: { ...players.A } } } });
    });
    await triggerRefold(page);
    s = await readInst(page, moriaIid);
    expect(s.grantedKeywordsContinuous, 'hand=5 TRUE boundary').toContain('double_attack');

    expect(pageErrors).toEqual([]);
    expect(invariantErrors).toEqual([]);
  });

  // 7. EB01-014 Sanji — formula-driven magnitude per_count
  test('EB01-014 Sanji — self_power_buff per_count (rested_don/3 × 1000); magnitude scales with rested DON', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    const sanjiIid = await seedCharOnAField(page, corpusDef('EB01-014'));
    await attachDonToInst(page, sanjiIid, 1); // satisfies if_attached_don_min:1

    // 0 rested → 0 buff.
    await setADonRestedCount(page, 0);
    await triggerRefold(page);
    expect((await readInst(page, sanjiIid)).powerModifierContinuous, 'rested=0').toBe(0);

    // 3 rested → +1000.
    await setADonRestedCount(page, 3);
    await triggerRefold(page);
    expect((await readInst(page, sanjiIid)).powerModifierContinuous, 'rested=3 → +1000').toBe(1000);

    // 6 rested → +2000.
    await setADonRestedCount(page, 6);
    await triggerRefold(page);
    expect((await readInst(page, sanjiIid)).powerModifierContinuous, 'rested=6 → +2000').toBe(2000);

    // 0 rested again → 0.
    await setADonRestedCount(page, 0);
    await triggerRefold(page);
    expect((await readInst(page, sanjiIid)).powerModifierContinuous, 'rested=0 again').toBe(0);

    expect(pageErrors).toEqual([]);
    expect(invariantErrors).toEqual([]);
  });

  // 8. OP03-004 Curiel — grant_keyword:rush (DON≥1) toggles
  // `grantedKeywordsContinuous`. NOTE: corpus card-data also has
  // printed `keywords:['rush']`, so legality.ts:228 hasKeyword path
  // already considers Curiel rush-capable regardless of the continuous
  // clause. The continuous-grant observability is therefore engine
  // state only (the `grantedKeywordsContinuous` field), not legality.
  // The printed-text restriction "cannot attack a Leader on the turn
  // played" is NOT encoded as a spec — flagging as latent
  // CARD_DATA_BUG candidate (rush should be conditional, not printed)
  // but out of Stage B scope here.
  test('OP03-004 Curiel — continuous grant_keyword:rush toggles grantedKeywordsContinuous via DON (legality masked by printed rush)', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    const curielIid = await seedCharOnAField(page, corpusDef('OP03-004'));
    // FALSE: 0 DON on Curiel → continuous grant does NOT fire ⇒
    // grantedKeywordsContinuous lacks 'rush' (printed kw lives on the
    // card def, not on the inst's continuous bag).
    await triggerRefold(page);
    const sFalse = await readInst(page, curielIid);
    expect(sFalse.grantedKeywordsContinuous, 'continuous grant FALSE: no rush in grantedKeywordsContinuous').not.toContain('rush');

    // TRUE: attach 1 DON to Curiel → continuous grant fires.
    await attachDonToInst(page, curielIid, 1);
    const sTrue = await readInst(page, curielIid);
    expect(sTrue.grantedKeywordsContinuous, 'continuous grant TRUE: rush in grantedKeywordsContinuous').toContain('rush');

    expect(pageErrors).toEqual([]);
    expect(invariantErrors).toEqual([]);
  });
});
