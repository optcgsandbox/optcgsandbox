// stage-b-target-selection — Stage B expansion confirming V0
// deterministic target resolver behavior across 7 target kinds.
//
// Source-confirmed resolver order (`shared/engine-v2/registry/handlers/
// targets.ts`):
//   - your_character           :69-73    — pl.field filter→slice(count)
//   - your_leader_or_character  :75-86    — LEADER FIRST, then field
//   - opp_character             :87-92    — opp.field filter→slice
//   - opp_leader_or_character   :93-104   — LEADER FIRST, then field
//   - any_character             :105-114  — [opp, own] concat→slice
//   - all_your_characters       :116-121  — all matching, NO slice
//   - all_opp_characters        :122-127  — all matching, NO slice
//
// Default count when `target.count` is unspecified = 1
// (`getCount` at :35-38).
//
// V0 has NO `PendingTargetPick` mounted for action targets — the
// `attack_target_pick` pending kind (`state/types.ts:193`) is exclusive
// to the attack flow. Hence all 7 tests classify as NO_UI_EXPECTED for
// the action-side prompt.
//
// Per directive: harness-only. No engine / UI / card-data /
// scenarioFactory changes.

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

// ─── Generic seeds ───────────────────────────────────────────────────

async function seedCardInAHand(page: Page, def: Record<string, unknown>): Promise<string> {
  return page.evaluate((def) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    lib[def['id'] as string] = def;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { hand: string[] } };
    const iid = `seedTS_${def['id']}_${Math.floor(Math.random() * 1e9).toString(36)}`;
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

async function seedCharOnField(page: Page, side: 'A' | 'B', overrides: Partial<{ cost: number; power: number; traits: string[]; rested: boolean; tag: string }>): Promise<string> {
  const cost = overrides.cost ?? 1;
  const power = overrides.power ?? 3000;
  const traits = overrides.traits ?? [];
  const rested = overrides.rested ?? false;
  const tag = overrides.tag ?? 'gen';
  return page.evaluate(({ side, cost, power, traits, rested, tag }) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { field: unknown[] }; B: { field: unknown[] } };
    const synthId = `__seed_ts_${side}_${tag}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    const iid = `seedTS_${side}_${tag}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    lib[synthId] = {
      id: synthId, name: `TS ${side} ${tag}`, kind: 'character',
      cost, power, counterValue: 1000,
      colors: ['red'], traits, keywords: [], effectText: '',
    };
    inst[iid] = {
      instanceId: iid, cardId: synthId, controller: side,
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
  }, { side, cost, power, traits, rested, tag });
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

async function playFromHand(page: Page, iid: string): Promise<void> {
  await page.evaluate((id) => {
    const w = window as unknown as { __store?: { getState: () => { dispatch: (a: unknown) => void } } };
    w.__store!.getState().dispatch({ type: 'PLAY_CARD', instanceId: id, replaceTargetId: null });
  }, iid);
  await page.waitForTimeout(400);
}

// ─── Read helpers ────────────────────────────────────────────────────

async function readInstFields(page: Page, iid: string): Promise<{ rested: boolean; powerMod: number; isInZone: 'A_field' | 'B_field' | 'A_hand' | 'B_hand' | 'A_trash' | 'B_trash' | 'orphan' }> {
  return page.evaluate((id) => {
    const w = window as unknown as { __store?: { getState: () => { state: { instances: Record<string, { rested?: boolean; powerModifierOneShot?: number; powerModifierContinuous?: number; powerModifierThisBattle?: number; controller?: string }>; players: { A: { field: { instanceId: string }[]; hand: string[]; trash: string[] }; B: { field: { instanceId: string }[]; hand: string[]; trash: string[] } } } } } };
    const s = w.__store!.getState().state;
    const inst = s.instances[id];
    const mod = (inst?.powerModifierOneShot ?? 0) + (inst?.powerModifierContinuous ?? 0) + (inst?.powerModifierThisBattle ?? 0);
    let zone: 'A_field' | 'B_field' | 'A_hand' | 'B_hand' | 'A_trash' | 'B_trash' | 'orphan' = 'orphan';
    if (s.players.A.field.some((i) => i.instanceId === id)) zone = 'A_field';
    else if (s.players.B.field.some((i) => i.instanceId === id)) zone = 'B_field';
    else if (s.players.A.hand.includes(id)) zone = 'A_hand';
    else if (s.players.B.hand.includes(id)) zone = 'B_hand';
    else if (s.players.A.trash.includes(id)) zone = 'A_trash';
    else if (s.players.B.trash.includes(id)) zone = 'B_trash';
    return { rested: !!inst?.rested, powerMod: mod, isInZone: zone };
  }, iid);
}

async function readALeaderMod(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { state: { players: { A: { leader: { powerModifierOneShot?: number; powerModifierContinuous?: number; powerModifierThisBattle?: number } } } } } } };
    const lead = w.__store!.getState().state.players.A.leader;
    return (lead.powerModifierOneShot ?? 0) + (lead.powerModifierContinuous ?? 0) + (lead.powerModifierThisBattle ?? 0);
  });
}

async function readBLeaderMod(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { state: { players: { B: { leader: { powerModifierOneShot?: number; powerModifierContinuous?: number; powerModifierThisBattle?: number } } } } } } };
    const lead = w.__store!.getState().state.players.B.leader;
    return (lead.powerModifierOneShot ?? 0) + (lead.powerModifierContinuous ?? 0) + (lead.powerModifierThisBattle ?? 0);
  });
}

async function readPending(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { state: { pending: { kind?: string } | null } } } };
    return w.__store!.getState().state.pending?.kind ?? null;
  });
}

function assertStable(page: Page, pageErrors: string[], invariantErrors: string[]): void {
  void page;
  expect(pageErrors).toEqual([]);
  expect(invariantErrors).toEqual([]);
}

test.describe('stage-b target-selection expansion', () => {
  // 1. opp_character — first eligible opp char only
  test('opp_character — OP01-006 Otama; resolver picks B.field[0] only', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    const b1 = await seedCharOnField(page, 'B', { cost: 1, power: 3000, tag: 'first' });
    const b2 = await seedCharOnField(page, 'B', { cost: 1, power: 3000, tag: 'second' });
    await topUpADon(page, 1);
    const otamaIid = await seedCardInAHand(page, corpusDef('OP01-006'));
    await playFromHand(page, otamaIid);

    expect((await readInstFields(page, b1)).powerMod, 'B.field[0] picked: -2000').toBe(-2000);
    expect((await readInstFields(page, b2)).powerMod, 'B.field[1] untouched').toBe(0);
    expect(await readPending(page), 'no target-pick pending').toBeNull();
    assertStable(page, pageErrors, invariantErrors);
  });

  // 2. all_opp_characters — all B chars affected; A chars untouched
  // (also exercises your_character + opp_leader side clauses).
  test('all_opp_characters — OP12-018 Color of Supreme King Haki; all B field chars -1000; A leader unchanged; B leader -1000 via opp_leader clause', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    const a1 = await seedCharOnField(page, 'A', { cost: 1, power: 2000, tag: 'aown' });
    const b1 = await seedCharOnField(page, 'B', { cost: 1, power: 3000, tag: 'b1' });
    const b2 = await seedCharOnField(page, 'B', { cost: 1, power: 3000, tag: 'b2' });
    // Cost 0 — no DON top up needed but normalize gave us 1.
    const cardIid = await seedCardInAHand(page, corpusDef('OP12-018'));
    await playFromHand(page, cardIid);

    expect((await readInstFields(page, b1)).powerMod, 'B1 -1000 (all_opp clause)').toBe(-1000);
    expect((await readInstFields(page, b2)).powerMod, 'B2 -1000 (all_opp clause)').toBe(-1000);
    expect((await readInstFields(page, a1)).powerMod, 'A1 +2000 (your_character clause; first eligible)').toBe(2000);
    expect(await readALeaderMod(page), 'A leader untouched (your_character ≠ leader)').toBe(0);
    expect(await readBLeaderMod(page), 'B leader -1000 (opp_leader clause)').toBe(-1000);
    expect(await readPending(page), 'no pending').toBeNull();
    assertStable(page, pageErrors, invariantErrors);
  });

  // 3. all_your_characters with filter — only matching A chars affected
  test('all_your_characters — OP14-057 Don\'t Worry; +1000 to all A Fish-Man chars; non-Fish-Man untouched', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    const aFishMan = await seedCharOnField(page, 'A', { cost: 1, power: 1000, traits: ['Fish-Man'], tag: 'fish' });
    const aNonFish = await seedCharOnField(page, 'A', { cost: 1, power: 1000, traits: ['Pirate'], tag: 'pirate' });
    const bFishMan = await seedCharOnField(page, 'B', { cost: 1, power: 1000, traits: ['Fish-Man'], tag: 'bfish' });
    await topUpADon(page, 2);
    const cardIid = await seedCardInAHand(page, corpusDef('OP14-057'));
    await playFromHand(page, cardIid);

    expect((await readInstFields(page, aFishMan)).powerMod, 'A Fish-Man +1000').toBe(1000);
    expect((await readInstFields(page, aNonFish)).powerMod, 'A non-Fish-Man untouched (filter excludes)').toBe(0);
    expect((await readInstFields(page, bFishMan)).powerMod, 'B Fish-Man untouched (own-only scope)').toBe(0);
    expect(await readPending(page), 'no pending').toBeNull();
    assertStable(page, pageErrors, invariantErrors);
  });

  // 4. any_character — opp picked before own (resolver order [opp, own])
  test('any_character — EB02-024 Sogeking; resolver picks opp before own; B target bounced, A char remains', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    // Both eligible by costMax:1 filter.
    const aCtl = await seedCharOnField(page, 'A', { cost: 1, power: 1000, tag: 'aany' });
    const bTarget = await seedCharOnField(page, 'B', { cost: 1, power: 1000, tag: 'bany' });
    await topUpADon(page, 4);
    const cardIid = await seedCardInAHand(page, corpusDef('EB02-024'));
    await playFromHand(page, cardIid);

    // B target should be bounced (opp picked first by resolver).
    expect((await readInstFields(page, bTarget)).isInZone, 'B target moved to owner hand').toBe('B_hand');
    expect((await readInstFields(page, aCtl)).isInZone, 'A control still on field').toBe('A_field');
    expect(await readPending(page), 'no pending').toBeNull();
    assertStable(page, pageErrors, invariantErrors);
  });

  // 5. opp_leader_or_character — LEADER FIRST per resolver
  test('opp_leader_or_character — OP01-028 Rafflesia; B leader picked first; B field char untouched', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    const b1 = await seedCharOnField(page, 'B', { cost: 1, power: 3000, tag: 'bchar' });
    await topUpADon(page, 1);
    const cardIid = await seedCardInAHand(page, corpusDef('OP01-028'));
    await playFromHand(page, cardIid);

    expect(await readBLeaderMod(page), 'B leader -2000 (first in resolver)').toBe(-2000);
    expect((await readInstFields(page, b1)).powerMod, 'B field char untouched').toBe(0);
    expect(await readPending(page), 'no pending').toBeNull();
    assertStable(page, pageErrors, invariantErrors);
  });

  // 6. your_character with trait filter — first eligible only
  test('your_character — EB04-020 Shark Brick Fist; set_active picks first Fish-Man A char only', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    // Seed rested chars so we can observe set_active flipping to false.
    const aFish1 = await seedCharOnField(page, 'A', { cost: 1, power: 1000, traits: ['Fish-Man'], rested: true, tag: 'fish1' });
    const aFish2 = await seedCharOnField(page, 'A', { cost: 1, power: 1000, traits: ['Fish-Man'], rested: true, tag: 'fish2' });
    const aNonFish = await seedCharOnField(page, 'A', { cost: 1, power: 1000, traits: ['Pirate'], rested: true, tag: 'pir' });
    await topUpADon(page, 1);
    const cardIid = await seedCardInAHand(page, corpusDef('EB04-020'));
    await playFromHand(page, cardIid);

    expect((await readInstFields(page, aFish1)).rested, 'first Fish-Man un-rested').toBe(false);
    expect((await readInstFields(page, aFish2)).rested, 'second Fish-Man still rested (count=1)').toBe(true);
    expect((await readInstFields(page, aNonFish)).rested, 'non-Fish-Man still rested (filter excludes)').toBe(true);
    expect(await readPending(page), 'no pending').toBeNull();
    assertStable(page, pageErrors, invariantErrors);
  });

  // 7. your_leader_or_character — LEADER FIRST per resolver
  test('your_leader_or_character — OP06-038 Trichil; A leader picked first; A field char untouched', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    const a1 = await seedCharOnField(page, 'A', { cost: 1, power: 2000, tag: 'aown' });
    await topUpADon(page, 1);
    const cardIid = await seedCardInAHand(page, corpusDef('OP06-038'));
    await playFromHand(page, cardIid);

    expect(await readALeaderMod(page), 'A leader +2000 (resolver leader-first)').toBe(2000);
    expect((await readInstFields(page, a1)).powerMod, 'A field char untouched').toBe(0);
    expect(await readPending(page), 'no pending').toBeNull();
    assertStable(page, pageErrors, invariantErrors);
  });
});
