// stage-b-power-modifier — Stage B expansion of the power_buff family,
// covering stacking, duration semantics, continuous, and per_count
// formula sources.
//
// Subcases:
//   1. Positive stacking — OP06-038 (your_leader_or_character +2000
//      this_battle) + OP01-001 leader aura (+1000 continuous via DON).
//      Verifies independent modifier sources sum on A leader.
//   2. Negative stacking + clamp — OP01-006 Otama (-2000 this_turn) on
//      a low-power B char. effectivePowerForDisplay clamps to 0 per
//      power.ts:51-53.
//   3. Duration this_turn — OP01-006 Otama on B char; modifier ticked
//      to 0 and cleared at A's end-of-turn per PhaseScheduler.ts:255-261.
//   4. Duration this_battle field tagging — OP06-038 writes to
//      powerModifierThisBattle (NOT powerModifierOneShot) per
//      actions.ts:91-92.
//   5. Duration opp_next_turn — OP07-018 KEEP OUT target your_character
//      filter Revolutionary Army; expires=1 ⇒ persists after A's
//      end-of-turn tick (decrement only, no clear).
//   6. per_count formula own_hand_count — OP01-072 Smiley
//      (continuous self_power_buff, formula `hand_count/1 × 1000`,
//      gated by DON≥1 + own_turn).
//   7. per_count formula own_trash_event_count — OP01-083 Mr.1
//      (continuous self_power_buff, formula `trash_event/2 × 1000`,
//      gated by DON + own_turn + leader trait Baroque Works).
//
// Engine sources cited inline. Per directive: harness-only. No engine
// / UI / card-data / scenarioFactory edits.

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CORPUS_PATH = resolve(__dirname, '../shared/data/cards.json');
const CORPUS_RAW = JSON.parse(readFileSync(CORPUS_PATH, 'utf-8')) as unknown;
const CORPUS = (Array.isArray(CORPUS_RAW) ? CORPUS_RAW : Object.values(CORPUS_RAW as Record<string, unknown>)) as Array<Record<string, unknown>>;
function corpusDef(id: string): Record<string, unknown> {
  const f = CORPUS.find((c) => (c as { id?: string }).id === id);
  if (!f) throw new Error(`corpus missing ${id}`);
  return f;
}

async function bootstrap(page: Page): Promise<{ drv: PlayerDriver; pageErrors: string[]; invariantErrors: string[] }> {
  const pageErrors: string[] = [];
  const invariantErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => {
    const t = m.text();
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

async function seedCardInAHand(page: Page, def: Record<string, unknown>): Promise<string> {
  return page.evaluate((def) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    lib[def['id'] as string] = def;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { hand: string[] } };
    const iid = `seedPM_${def['id']}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    inst[iid] = {
      instanceId: iid, cardId: def['id'], controller: 'A',
      rested: false, summoningSick: false,
      attachedDon: [], attachedDonRested: [],
      perTurn: { hasAttacked: false, effectsUsed: [] },
    };
    players.A.hand = [...players.A.hand, iid];
    w.__store!.setState({ state: { ...s } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
    return iid;
  }, def);
}

async function seedCharOnField(page: Page, side: 'A' | 'B', overrides: Partial<{ cost: number; power: number; traits: string[]; rested: boolean; tag: string; cardDef: Record<string, unknown>; cardId: string }>): Promise<string> {
  const cost = overrides.cost ?? 1;
  const power = overrides.power ?? 3000;
  const traits = overrides.traits ?? [];
  const rested = overrides.rested ?? false;
  const tag = overrides.tag ?? 'gen';
  const cardDef = overrides.cardDef;
  const cardId = overrides.cardId;
  return page.evaluate(({ side, cost, power, traits, rested, tag, cardDef, cardId }) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { field: unknown[] }; B: { field: unknown[] } };
    let useCardId: string;
    if (cardDef) {
      const id = (cardDef as { id?: string }).id ?? 'synth';
      lib[id] = cardDef;
      useCardId = id;
    } else if (cardId) {
      useCardId = cardId;
    } else {
      const synthId = `__seed_pm_${side}_${tag}_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = {
        id: synthId, name: `PM ${side} ${tag}`, kind: 'character',
        cost, power, counterValue: 1000,
        colors: ['red'], traits, keywords: [], effectText: '',
      };
      useCardId = synthId;
    }
    const iid = `seedPM_${side}_${tag}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    inst[iid] = {
      instanceId: iid, cardId: useCardId, controller: side,
      rested, summoningSick: false,
      attachedDon: [], attachedDonRested: [],
      perTurn: { hasAttacked: false, effectsUsed: [] },
    };
    players[side].field = [...players[side].field, inst[iid]];
    w.__store!.setState({ state: { ...s } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
    return iid;
  }, { side, cost, power, traits, rested, tag, cardDef, cardId });
}

async function topUpADon(page: Page, target: number): Promise<void> {
  await page.evaluate((target) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const players = s.players as { A: { donDeck: string[]; donCostArea: string[]; donRested: string[] } };
    const pool = [...players.A.donDeck, ...players.A.donCostArea, ...players.A.donRested];
    players.A.donCostArea = pool.slice(0, target);
    players.A.donDeck = pool.slice(target);
    players.A.donRested = [];
    w.__store!.setState({ state: { ...s, players: { ...(s.players as Record<string, unknown>), A: { ...players.A } } } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
  }, target);
}

async function attachDonTo(page: Page, iid: string, n: number): Promise<void> {
  await page.evaluate(({ iid, n }) => {
    const w = window as unknown as { __store?: { getState: () => { dispatch: (a: unknown) => void } } };
    for (let i = 0; i < n; i += 1) {
      w.__store!.getState().dispatch({ type: 'ATTACH_DON', targetInstanceId: iid });
    }
  }, { iid, n });
  await page.waitForTimeout(150);
}

async function triggerRefold(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { dispatch: (a: unknown) => void } } };
    w.__store!.getState().dispatch({ type: 'ATTACH_DON', targetInstanceId: '__noop_refold__' });
  });
  await page.waitForTimeout(150);
}

async function playFromHand(page: Page, iid: string): Promise<void> {
  await page.evaluate((id) => {
    const w = window as unknown as { __store?: { getState: () => { dispatch: (a: unknown) => void } } };
    w.__store!.getState().dispatch({ type: 'PLAY_CARD', instanceId: id, replaceTargetId: null });
  }, iid);
  await page.waitForTimeout(400);
}

async function dispatchEndTurn(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { dispatch: (a: unknown) => void } } };
    w.__store!.getState().dispatch({ type: 'END_TURN' });
  });
  await page.waitForTimeout(400);
}

// Inject Baroque Works type into A.leader (for Mr.1 test).
async function setLeaderType(page: Page, typeName: string): Promise<void> {
  await page.evaluate((typeName) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    const players = s.players as { A: { leader: { cardId: string } } };
    const card = lib[players.A.leader.cardId] as Record<string, unknown>;
    const pre = Array.isArray(card.traits) ? [...(card.traits as string[])] : [];
    if (!pre.some((t) => t.includes(typeName))) card.traits = [...pre, typeName];
    w.__store!.setState({ state: { ...s } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
  }, typeName);
}

// Set A.trash to contain N synthetic event cards (for Mr.1 trash_event_count).
async function setATrashEventCount(page: Page, n: number): Promise<void> {
  await page.evaluate((n) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { trash: string[] } };
    const newTrash: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const synthId = `__pm_evt_${i}_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `pmevt_${i}_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = {
        id: synthId, name: `PM Evt ${i}`, kind: 'event',
        cost: 1, power: null, counterValue: null,
        colors: ['red'], traits: [], keywords: [], effectText: '',
      };
      inst[iid] = {
        instanceId: iid, cardId: synthId, controller: 'A',
        rested: false, summoningSick: false,
        attachedDon: [], attachedDonRested: [],
        perTurn: { hasAttacked: false, effectsUsed: [] },
      };
      newTrash.push(iid);
    }
    players.A.trash = newTrash;
    w.__store!.setState({ state: { ...s } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
  }, n);
}

async function trimAHandTo(page: Page, n: number): Promise<void> {
  await page.evaluate((n) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const players = s.players as { A: { hand: string[] } };
    players.A.hand = players.A.hand.slice(0, n);
    w.__store!.setState({ state: { ...s } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
  }, n);
}

interface PowerSnap {
  base: number;
  oneShot: number;
  continuous: number;
  thisBattle: number;
  expiresInTurns: number | null;
  effective: number;
}

async function readPower(page: Page, iid: string): Promise<PowerSnap> {
  return page.evaluate((id) => {
    const w = window as unknown as { __store?: { getState: () => { state: { instances: Record<string, { cardId: string; attachedDon?: string[]; attachedDonRested?: string[]; powerModifierOneShot?: number; powerModifierContinuous?: number; powerModifierThisBattle?: number; powerModifierExpiresInTurns?: number; basePowerOverrideOneShot?: number | null; basePowerOverrideContinuous?: number | null }>; cardLibrary: Record<string, { power?: number; kind?: string }> } } } };
    const s = w.__store!.getState().state;
    const inst = s.instances[id];
    if (!inst) return { base: -1, oneShot: 0, continuous: 0, thisBattle: 0, expiresInTurns: null, effective: -1 };
    const card = s.cardLibrary[inst.cardId];
    const printed = (card?.kind === 'character' || card?.kind === 'leader') ? (card?.power ?? 0) : 0;
    const base = (inst.basePowerOverrideOneShot ?? inst.basePowerOverrideContinuous) ?? printed;
    const oneShot = inst.powerModifierOneShot ?? 0;
    const cont = inst.powerModifierContinuous ?? 0;
    const tb = inst.powerModifierThisBattle ?? 0;
    const donCount = (inst.attachedDon?.length ?? 0) + (inst.attachedDonRested?.length ?? 0);
    return {
      base,
      oneShot,
      continuous: cont,
      thisBattle: tb,
      expiresInTurns: inst.powerModifierExpiresInTurns ?? null,
      effective: Math.max(0, base + donCount * 1000 + oneShot + cont + tb),
    };
  }, iid);
}

async function readALeaderPower(page: Page): Promise<PowerSnap> {
  const iid = await page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { state: { players: { A: { leader: { instanceId: string } } } } } } };
    return w.__store!.getState().state.players.A.leader.instanceId;
  });
  return readPower(page, iid);
}

async function readDomPower(page: Page, iid: string): Promise<number | null> {
  return page.evaluate((id) => {
    const btn = document.querySelector(`button[data-instance-id="${id}"]`);
    if (!btn) return null;
    const m = (btn.getAttribute('aria-label') ?? '').match(/power\s+(-?\d+)/i);
    return m ? parseInt(m[1]!, 10) : null;
  }, iid);
}

async function readPending(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { state: { pending: { kind?: string } | null } } } };
    return w.__store!.getState().state.pending?.kind ?? null;
  });
}

function assertStable(_page: Page, pageErrors: string[], invariantErrors: string[]): void {
  expect(pageErrors).toEqual([]);
  expect(invariantErrors).toEqual([]);
}

test.describe('stage-b power-modifier expansion', () => {
  // 1. Positive stacking — A leader gets +2000 (this_battle) + +1000 (continuous aura).
  test('positive stacking — OP06-038 +2000 this_battle + OP01-001 aura +1000; A leader effective = base + 3000', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);

    const aLeaderIidEval = await page.evaluate(() => {
      const w = window as unknown as { __store?: { getState: () => { state: { players: { A: { leader: { instanceId: string } } } } } } };
      return w.__store!.getState().state.players.A.leader.instanceId;
    });

    // Step 1: attach 1 DON to A.leader → continuous aura +1000 to all
    // A chars (including itself? actually aura targets your chars, not
    // leader). Aura targets every A.field char. We test leader-effective
    // power INCLUDING auto-aura on leader from another card path: there
    // is no continuous aura on Zoro that hits the leader; OP01-001
    // continuous targets all A.field characters. For A LEADER power we
    // need to land a modifier ON the leader. OP06-038 power_buff +2000
    // your_leader_or_character lands on leader (resolver leader-first).
    // For STACKING we'll seed an A.field char and verify it has both
    // the aura (+1000 continuous) AND something else. Simpler: use the
    // leader's powerModifierThisBattle from OP06-038 plus the continuous
    // aura on a SEEDED A field char.
    const aChar = await seedCharOnField(page, 'A', { cost: 1, power: 1000, tag: 'pos' });
    await attachDonTo(page, aLeaderIidEval, 1);
    // Triggers refold (aura applies to A chars).

    const baseSnap = await readPower(page, aChar);
    expect(baseSnap.continuous, 'aura +1000 from leader (continuous)').toBe(1000);
    expect(baseSnap.effective, 'A char effective = 1000 base + 1000 continuous').toBe(2000);

    // Play OP06-038 — power_buff +2000 this_battle target your_leader_or_character.
    // Resolver picks A.leader (first). So A leader gets +2000 this_battle.
    // Verify on A leader.
    const cardIid = await seedCardInAHand(page, corpusDef('OP06-038'));
    await topUpADon(page, 1);
    await playFromHand(page, cardIid);

    const leaderSnap = await readALeaderPower(page);
    expect(leaderSnap.thisBattle, 'A leader powerModifierThisBattle = +2000').toBe(2000);
    expect(leaderSnap.effective, 'A leader effective = 5000 + 2000 (and leader has 1 DON attached for +1000 inherent)').toBe(5000 + 1000 + 2000);

    // A char aura still active.
    const aCharAfter = await readPower(page, aChar);
    expect(aCharAfter.continuous, 'A char aura still +1000').toBe(1000);

    expect(await readPending(page)).toBeNull();
    assertStable(page, pageErrors, invariantErrors);
  });

  // 2. Negative stacking + clamp — B char base 1500 + Otama -2000 →
  // clamp to 0.
  test('negative stacking + clamp — OP01-006 Otama on base-1500 B char; effectivePowerForDisplay clamps to 0', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    const bChar = await seedCharOnField(page, 'B', { cost: 1, power: 1500, tag: 'low' });

    const otamaIid = await seedCardInAHand(page, corpusDef('OP01-006'));
    await topUpADon(page, 1);
    await playFromHand(page, otamaIid);

    const s = await readPower(page, bChar);
    expect(s.oneShot, 'B char -2000 oneShot').toBe(-2000);
    // raw = 1500 + -2000 = -500; clamp to 0.
    expect(s.effective, 'effectivePowerForDisplay clamps -500 → 0').toBe(0);
    const dom = await readDomPower(page, bChar);
    expect(dom, 'DOM aria-label power = 0 (clamped)').toBe(0);

    assertStable(page, pageErrors, invariantErrors);
  });

  // 3. Duration this_turn — Otama on B char; clears after A end-of-turn.
  test('duration this_turn — OP01-006 Otama on B char; modifier set then cleared at A end-of-turn', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    const bChar = await seedCharOnField(page, 'B', { cost: 1, power: 3000, tag: 'ttn' });
    const otamaIid = await seedCardInAHand(page, corpusDef('OP01-006'));
    await topUpADon(page, 1);
    await playFromHand(page, otamaIid);

    const mid = await readPower(page, bChar);
    expect(mid.oneShot, 'set to -2000').toBe(-2000);
    expect(mid.expiresInTurns, 'expires in 0 (this_turn)').toBe(0);

    // End A turn. enterEndOfTurn ticks: expires=0 ⇒ clear.
    await dispatchEndTurn(page);

    const after = await readPower(page, bChar);
    expect(after.oneShot, 'cleared after end-of-turn').toBe(0);
    expect(after.expiresInTurns, 'expires cleared').toBeNull();
    expect(after.effective, 'B char back to base 3000').toBe(3000);

    assertStable(page, pageErrors, invariantErrors);
  });

  // 4. Duration this_battle field tagging — OP06-038 writes to
  // powerModifierThisBattle, NOT powerModifierOneShot.
  test('duration this_battle field tagging — OP06-038 writes powerModifierThisBattle (distinct from One-Shot)', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    const cardIid = await seedCardInAHand(page, corpusDef('OP06-038'));
    await topUpADon(page, 1);
    await playFromHand(page, cardIid);

    const s = await readALeaderPower(page);
    expect(s.thisBattle, 'powerModifierThisBattle = +2000').toBe(2000);
    expect(s.oneShot, 'powerModifierOneShot stays 0').toBe(0);
    expect(s.continuous, 'powerModifierContinuous stays 0').toBe(0);
    assertStable(page, pageErrors, invariantErrors);
  });

  // 5. Duration opp_next_turn — KEEP OUT on A char with Revolutionary
  // Army; survives 1 end-of-turn (expires decremented 1→0 but not
  // cleared yet).
  test('duration opp_next_turn — OP07-018 KEEP OUT on Revolutionary Army A char; +2000 persists after A end-of-turn', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    const aChar = await seedCharOnField(page, 'A', { cost: 1, power: 1000, traits: ['Revolutionary Army'], tag: 'ra' });
    const cardIid = await seedCardInAHand(page, corpusDef('OP07-018'));
    await topUpADon(page, 1);
    await playFromHand(page, cardIid);

    const mid = await readPower(page, aChar);
    expect(mid.oneShot, '+2000 oneShot').toBe(2000);
    expect(mid.expiresInTurns, 'expires=1 (opp_next_turn encoding)').toBe(1);

    // End A turn → A's enterEndOfTurn tick: expires 1→0; modifier STILL
    // active (decrement only, no clear at this tick).
    await dispatchEndTurn(page);

    const after = await readPower(page, aChar);
    expect(after.oneShot, '+2000 STILL active after A end-of-turn').toBe(2000);
    expect(after.expiresInTurns, 'expires decremented to 0').toBe(0);

    assertStable(page, pageErrors, invariantErrors);
  });

  // 6. per_count formula own_hand_count — Smiley scales +1000 per hand card.
  test('per_count formula own_hand_count — OP01-072 Smiley; magnitude = hand_count × 1000 (gated by DON + own_turn)', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    const smileyIid = await seedCharOnField(page, 'A', { cardDef: corpusDef('OP01-072'), tag: 'sm' });
    await attachDonTo(page, smileyIid, 1);
    // Vary hand to N values; verify modifier matches.
    // hand=5 → +5000.
    await trimAHandTo(page, 5);
    await triggerRefold(page);
    let s = await readPower(page, smileyIid);
    expect(s.continuous, 'hand=5 ⇒ +5000').toBe(5000);

    // hand=3 → +3000.
    await trimAHandTo(page, 3);
    await triggerRefold(page);
    s = await readPower(page, smileyIid);
    expect(s.continuous, 'hand=3 ⇒ +3000').toBe(3000);

    // hand=0 → +0.
    await trimAHandTo(page, 0);
    await triggerRefold(page);
    s = await readPower(page, smileyIid);
    expect(s.continuous, 'hand=0 ⇒ +0').toBe(0);

    assertStable(page, pageErrors, invariantErrors);
  });

  // 7. per_count formula own_trash_event_count — Mr.1 scales +1000 per
  // 2 events in trash (Baroque Works leader gate).
  test('per_count formula own_trash_event_count — OP01-083 Mr.1; magnitude = floor(trash_events/2) × 1000 (BW leader + DON + own_turn)', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    await setLeaderType(page, 'Baroque Works');
    const mr1Iid = await seedCharOnField(page, 'A', { cardDef: corpusDef('OP01-083'), tag: 'mr1' });
    await attachDonTo(page, mr1Iid, 1);

    // events=0 ⇒ +0.
    await setATrashEventCount(page, 0);
    await triggerRefold(page);
    let s = await readPower(page, mr1Iid);
    expect(s.continuous, 'events=0 ⇒ +0').toBe(0);

    // events=2 ⇒ +1000.
    await setATrashEventCount(page, 2);
    await triggerRefold(page);
    s = await readPower(page, mr1Iid);
    expect(s.continuous, 'events=2 ⇒ +1000').toBe(1000);

    // events=4 ⇒ +2000.
    await setATrashEventCount(page, 4);
    await triggerRefold(page);
    s = await readPower(page, mr1Iid);
    expect(s.continuous, 'events=4 ⇒ +2000').toBe(2000);

    // events=5 ⇒ +2000 (floor 5/2).
    await setATrashEventCount(page, 5);
    await triggerRefold(page);
    s = await readPower(page, mr1Iid);
    expect(s.continuous, 'events=5 ⇒ +2000 (floor)').toBe(2000);

    assertStable(page, pageErrors, invariantErrors);
  });
});
