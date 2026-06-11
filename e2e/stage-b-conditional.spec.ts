// stage-b-conditional — Stage B expansion of non-leader conditional
// effects. 8 anchors, two subcases each (false / true).
//
// Anchors per Stage B plan:
//   1. P-053 Nami                 — if_hand_max:3 (control)
//   2. OP05-050 Hina              — if_hand_max:5
//   3. EB03-058 Lilith            — if_own_life_max:2
//   4. OP07-115 I Re-Quasar       — if_own_life_max:2 (event)
//   5. OP09-026 Sakazuki          — if_own_chars_min:2
//   6. OP05-118 Kaido             — if_opp_life_max:3
//   7. OP09-087 Charlotte Pudding — if_opp_hand_min:5
//   8. OP07-050 Boa Sandersonia   — if_own_chars_min_filter
//
// Engine sources cited:
//   - conditions.ts:115-116 ifHandMax  ⇒ hand.length <= n
//   - conditions.ts:113-114 ifHandMin  ⇒ hand.length >= n
//   - conditions.ts:111-112 ifOwnLifeMax
//   - conditions.ts:113-114 ifOppLifeMax (own_life parallel)
//   - conditions.ts:144 ifOwnCharsMin    ⇒ pl.field.length >= n
//   - conditions2.ts:210-224 ifOwnCharsMinFilter ⇒ trait/minCost/maxCost
//     only (NOT traitsAny — OP07-050 effectively reduces to
//     if_own_chars_min:2 in current engine; documented inline).
//   - mainPhase.ts:187-220 character play removes card BEFORE on_play
//     dispatches; condition evaluation sees post-removal hand.
//
// Per directive: harness-only. No engine / UI / card-data /
// scenarioFactory edits.

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

// ─── Seeds + helpers ────────────────────────────────────────────────

async function seedCardInAHand(page: Page, def: Record<string, unknown>): Promise<string> {
  return page.evaluate((def) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    lib[def['id'] as string] = def;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { hand: string[] } };
    const iid = `seedCD_${def['id']}_${Math.floor(Math.random() * 1e9).toString(36)}`;
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

async function seedCharOnField(page: Page, side: 'A' | 'B', overrides: Partial<{ cost: number; power: number; traits: string[]; tag: string }>): Promise<string> {
  const cost = overrides.cost ?? 1;
  const power = overrides.power ?? 3000;
  const traits = overrides.traits ?? [];
  const tag = overrides.tag ?? 'gen';
  return page.evaluate(({ side, cost, power, traits, tag }) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { field: unknown[] }; B: { field: unknown[] } };
    const synthId = `__seed_cd_${side}_${tag}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    const iid = `seedCD_${side}_${tag}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    lib[synthId] = {
      id: synthId, name: `CD ${side} ${tag}`, kind: 'character',
      cost, power, counterValue: 1000,
      colors: ['red'], traits, keywords: [], effectText: '',
    };
    inst[iid] = {
      instanceId: iid, cardId: synthId, controller: side,
      rested: false, summoningSick: false,
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
  }, { side, cost, power, traits, tag });
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
}

// Forces A.hand to exactly `n` synthetic placeholder cards. Used when
// a test needs to control post-play hand size precisely. Call BEFORE
// `seedCardInAHand(playTarget)` — the seeded play target appends to
// hand at index n.
async function setExactAHandSize(page: Page, n: number): Promise<void> {
  await page.evaluate((n) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { hand: string[] } };
    const newHand: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const synthId = `__pad_a_${i}_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `padA_${i}_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = {
        id: synthId, name: `Pad A ${i}`, kind: 'character',
        cost: 99, power: 1000, counterValue: 1000,
        colors: ['red'], traits: [], keywords: [], effectText: '',
      };
      inst[iid] = {
        instanceId: iid, cardId: synthId, controller: 'A',
        rested: false, summoningSick: false,
        attachedDon: [], attachedDonRested: [],
        perTurn: { hasAttacked: false, effectsUsed: [] },
      };
      newHand.push(iid);
    }
    players.A.hand = newHand;
    w.__store!.setState({ state: { ...s, players: { ...(s.players as Record<string, unknown>), A: { ...players.A } } } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
  }, n);
}

async function trimBHandTo(page: Page, n: number): Promise<void> {
  await page.evaluate((n) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const players = s.players as { B: { hand: string[] } };
    players.B.hand = players.B.hand.slice(0, n);
    w.__store!.setState({ state: { ...s, players: { ...(s.players as Record<string, unknown>), B: { ...players.B } } } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
  }, n);
}

async function setLifeCount(page: Page, side: 'A' | 'B', n: number): Promise<void> {
  await page.evaluate(({ side, n }) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const players = s.players as { A: { life: string[] }; B: { life: string[] } };
    players[side].life = players[side].life.slice(0, n);
    w.__store!.setState({ state: { ...s, players: { ...(s.players as Record<string, unknown>), [side]: { ...players[side] } } } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
  }, { side, n });
}

async function clearAField(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const players = s.players as { A: { field: unknown[] } };
    players.A.field = [];
    w.__store!.setState({ state: { ...s, players: { ...(s.players as Record<string, unknown>), A: { ...players.A } } } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
  });
}

async function clearBField(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const players = s.players as { B: { field: unknown[] } };
    players.B.field = [];
    w.__store!.setState({ state: { ...s, players: { ...(s.players as Record<string, unknown>), B: { ...players.B } } } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
  });
}

async function playFromHand(page: Page, iid: string): Promise<void> {
  await page.evaluate((id) => {
    const w = window as unknown as { __store?: { getState: () => { dispatch: (a: unknown) => void } } };
    w.__store!.getState().dispatch({ type: 'PLAY_CARD', instanceId: id, replaceTargetId: null });
  }, iid);
  await page.waitForTimeout(300);
}

interface Snap {
  aHand: number;
  aField: number;
  aTrash: number;
  bHand: number;
  bTrash: number;
  bField: number;
  bLife: number;
  aLeaderMod: number;
}

async function readSnap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { state: { players: { A: { hand: string[]; field: { instanceId: string }[]; trash: string[]; leader: { powerModifierOneShot?: number; powerModifierContinuous?: number; powerModifierThisBattle?: number } }; B: { hand: string[]; field: { instanceId: string }[]; trash: string[]; life: string[] } } } } } };
    const s = w.__store!.getState().state;
    const lead = s.players.A.leader;
    return {
      aHand: s.players.A.hand.length,
      aField: s.players.A.field.length,
      aTrash: s.players.A.trash.length,
      bHand: s.players.B.hand.length,
      bTrash: s.players.B.trash.length,
      bField: s.players.B.field.length,
      bLife: s.players.B.life.length,
      aLeaderMod: (lead.powerModifierOneShot ?? 0) + (lead.powerModifierContinuous ?? 0) + (lead.powerModifierThisBattle ?? 0),
    };
  });
}

async function readPending(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { state: { pending: { kind?: string } | null } } } };
    return w.__store!.getState().state.pending?.kind ?? null;
  });
}

function assertStable(_p: Page, pageErrors: string[], invariantErrors: string[]): void {
  expect(pageErrors).toEqual([]);
  expect(invariantErrors).toEqual([]);
}

// ─── Tests ──────────────────────────────────────────────────────────

test.describe('stage-b conditional expansion', () => {
  // 1. P-053 Nami — if_hand_max:3 (control)
  test('P-053 Nami — if_hand_max:3 (control); bounce on hand ≤3 post-play', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    const bA = await seedCharOnField(page, 'B', { cost: 1, power: 3000, tag: 'fA' });
    const namiA = await seedCardInAHand(page, corpusDef('P-053'));
    await topUpADon(page, 1);
    const before = await readSnap(page);
    expect(before.aHand, 'hand > 4 ⇒ post-play > 3').toBeGreaterThan(4);
    await playFromHand(page, namiA);
    const afterFalse = await readSnap(page);
    expect(afterFalse.bField, 'FALSE: B field unchanged').toBe(before.bField);
    expect(afterFalse.bHand, 'FALSE: B hand unchanged').toBe(before.bHand);

    // TRUE subcase — set hand to exactly 3 placeholder cards FIRST,
    // then seed Nami so hand = [3 pads + Nami] = 4; post-play = 3.
    await clearBField(page);
    await topUpADon(page, 1);
    const bB = await seedCharOnField(page, 'B', { cost: 1, power: 3000, tag: 'tB' });
    void bA; void bB;
    await setExactAHandSize(page, 3);
    const namiB = await seedCardInAHand(page, corpusDef('P-053'));
    const trueBefore = await readSnap(page);
    await playFromHand(page, namiB);
    const trueAfter = await readSnap(page);
    expect(trueAfter.bField, 'TRUE: B field -1').toBe(trueBefore.bField - 1);
    expect(trueAfter.bHand, 'TRUE: B hand +1').toBe(trueBefore.bHand + 1);
    expect(await readPending(page)).toBeNull();
    assertStable(page, pageErrors, invariantErrors);
  });

  // 2. OP05-050 Hina — if_hand_max:5
  test('OP05-050 Hina — if_hand_max:5; draw 1 if hand ≤5 post-play', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    // FALSE: post-play hand > 5. Pre-pad to 6 placeholders, seed Hina ⇒
    // hand = 7; post-play = 6.
    await setExactAHandSize(page, 6);
    const hinaA = await seedCardInAHand(page, corpusDef('OP05-050'));
    await topUpADon(page, 3);
    const beforeF = await readSnap(page);
    expect(beforeF.aHand, 'hand=7').toBe(7);
    await playFromHand(page, hinaA);
    const afterF = await readSnap(page);
    expect(afterF.aField, 'A field +1 (Hina)').toBe(beforeF.aField + 1);
    expect(afterF.aHand, 'FALSE: hand = 6 (no draw)').toBe(6);

    // TRUE: post-play hand = 5. Pre-pad to 5 placeholders, seed Hina ⇒
    // hand = 6; post-play pre-draw = 5; condition true ⇒ draw 1 ⇒ 6.
    await clearAField(page);
    await setExactAHandSize(page, 5);
    const hinaB = await seedCardInAHand(page, corpusDef('OP05-050'));
    await topUpADon(page, 3);
    const beforeT = await readSnap(page);
    expect(beforeT.aHand, 'hand=6').toBe(6);
    await playFromHand(page, hinaB);
    const afterT = await readSnap(page);
    expect(afterT.aHand, 'TRUE: hand = 6 (5 then +1)').toBe(6);
    assertStable(page, pageErrors, invariantErrors);
  });

  // 3. EB03-058 Lilith — if_own_life_max:2; draw 1
  test('EB03-058 Lilith — if_own_life_max:2; draw 1 only when A.life ≤ 2', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    const lilithA = await seedCardInAHand(page, corpusDef('EB03-058'));
    await topUpADon(page, 5);
    const beforeF = await readSnap(page);
    await playFromHand(page, lilithA);
    const afterF = await readSnap(page);
    // FALSE: A.life=5 default → no draw. Post-play hand = pre - 1.
    expect(afterF.aHand, 'FALSE: hand -1 (Lilith out, no draw)').toBe(beforeF.aHand - 1);

    // TRUE
    await clearAField(page);
    const lilithB = await seedCardInAHand(page, corpusDef('EB03-058'));
    await topUpADon(page, 5);
    await setLifeCount(page, 'A', 2);
    const beforeT = await readSnap(page);
    await playFromHand(page, lilithB);
    const afterT = await readSnap(page);
    // TRUE: hand-1+1 = same.
    expect(afterT.aHand, 'TRUE: hand unchanged (Lilith out, +1 draw)').toBe(beforeT.aHand);
    assertStable(page, pageErrors, invariantErrors);
  });

  // 4. OP07-115 — if_own_life_max:2 power_buff your_leader_or_character +3000 this_battle
  test('OP07-115 I Re-Quasar — if_own_life_max:2; A leader +3000 this_battle', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    const cardA = await seedCardInAHand(page, corpusDef('OP07-115'));
    await topUpADon(page, 1);
    await playFromHand(page, cardA);
    const afterF = await readSnap(page);
    expect(afterF.aLeaderMod, 'FALSE: A leader mod = 0').toBe(0);

    // TRUE
    await setLifeCount(page, 'A', 2);
    const cardB = await seedCardInAHand(page, corpusDef('OP07-115'));
    await topUpADon(page, 1);
    await playFromHand(page, cardB);
    const afterT = await readSnap(page);
    expect(afterT.aLeaderMod, 'TRUE: A leader +3000').toBe(3000);
    assertStable(page, pageErrors, invariantErrors);
  });

  // 5. OP09-026 Sakazuki — if_own_chars_min:2; removal_ko opp_character ≤5
  test('OP09-026 Sakazuki — if_own_chars_min:2 (counts AFTER play); KO opp', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    // FALSE: pre-seed 0 A chars. Post-play A.field = 1 (Sakazuki).
    const bA = await seedCharOnField(page, 'B', { cost: 1, power: 3000, tag: 'kA' });
    void bA;
    const sakaA = await seedCardInAHand(page, corpusDef('OP09-026'));
    await topUpADon(page, 6);
    const beforeF = await readSnap(page);
    await playFromHand(page, sakaA);
    const afterF = await readSnap(page);
    expect(afterF.bField, 'FALSE: B field unchanged').toBe(beforeF.bField);
    expect(afterF.bTrash, 'FALSE: B trash unchanged').toBe(beforeF.bTrash);

    // TRUE: pre-seed 1 A char + Sakazuki ⇒ A.field=2.
    await clearAField(page);
    await clearBField(page);
    const aChar = await seedCharOnField(page, 'A', { cost: 1, power: 1000, tag: 'aown' });
    const bB = await seedCharOnField(page, 'B', { cost: 1, power: 3000, tag: 'kB' });
    void aChar; void bB;
    const sakaB = await seedCardInAHand(page, corpusDef('OP09-026'));
    await topUpADon(page, 6);
    const beforeT = await readSnap(page);
    await playFromHand(page, sakaB);
    const afterT = await readSnap(page);
    expect(afterT.bField, 'TRUE: B field -1').toBe(beforeT.bField - 1);
    expect(afterT.bTrash, 'TRUE: B trash +1').toBe(beforeT.bTrash + 1);
    assertStable(page, pageErrors, invariantErrors);
  });

  // 6. OP05-118 Kaido — if_opp_life_max:3; draw 4
  test('OP05-118 Kaido — if_opp_life_max:3; draw 4', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    const kaidoA = await seedCardInAHand(page, corpusDef('OP05-118'));
    await topUpADon(page, 10);
    const beforeF = await readSnap(page);
    await playFromHand(page, kaidoA);
    const afterF = await readSnap(page);
    // FALSE: B.life=5 default → no draw. hand-1.
    expect(afterF.aHand, 'FALSE: hand -1 (Kaido out, no draw)').toBe(beforeF.aHand - 1);

    // TRUE: B.life=3.
    await clearAField(page);
    await setLifeCount(page, 'B', 3);
    const kaidoB = await seedCardInAHand(page, corpusDef('OP05-118'));
    await topUpADon(page, 10);
    const beforeT = await readSnap(page);
    await playFromHand(page, kaidoB);
    const afterT = await readSnap(page);
    // TRUE: hand-1+4 = +3.
    expect(afterT.aHand, 'TRUE: hand +3 (Kaido out, draw 4)').toBe(beforeT.aHand + 3);
    assertStable(page, pageErrors, invariantErrors);
  });

  // 7. OP09-087 Charlotte Pudding — if_opp_hand_min:5
  test('OP09-087 Charlotte Pudding — if_opp_hand_min:5; opp discards head-of-hand only when B.hand ≥5', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    // FALSE: trim B.hand to 4.
    await trimBHandTo(page, 4);
    const cardA = await seedCardInAHand(page, corpusDef('OP09-087'));
    await topUpADon(page, 2);
    const beforeF = await readSnap(page);
    await playFromHand(page, cardA);
    const afterF = await readSnap(page);
    expect(afterF.bHand, 'FALSE: B hand unchanged').toBe(beforeF.bHand);
    expect(afterF.bTrash, 'FALSE: B trash unchanged').toBe(beforeF.bTrash);

    // TRUE: ensure B.hand ≥ 5. Default mulligan gives 5.
    await page.evaluate(() => {
      const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown }) => void } };
      const s = w.__store!.getState().state as Record<string, unknown>;
      const players = s.players as { B: { hand: string[]; deck: string[] } };
      const newHand = [...players.B.hand];
      const newDeck = [...players.B.deck];
      while (newHand.length < 5 && newDeck.length > 0) {
        const id = newDeck.shift();
        if (id !== undefined) newHand.push(id);
      }
      players.B.hand = newHand;
      players.B.deck = newDeck;
      w.__store!.setState({ state: { ...s } });
    });
    await clearAField(page);
    const cardB = await seedCardInAHand(page, corpusDef('OP09-087'));
    await topUpADon(page, 2);
    const beforeT = await readSnap(page);
    expect(beforeT.bHand, 'B.hand ≥ 5 before TRUE play').toBeGreaterThanOrEqual(5);
    await playFromHand(page, cardB);
    const afterT = await readSnap(page);
    expect(afterT.bHand, 'TRUE: B hand -1').toBe(beforeT.bHand - 1);
    expect(afterT.bTrash, 'TRUE: B trash +1').toBe(beforeT.bTrash + 1);
    assertStable(page, pageErrors, invariantErrors);
  });

  // 8. OP07-050 Sandersonia — if_own_chars_min_filter
  // Post engine extension (conditions2.ts:210-232 now respects
  // traitsAny + kind), the filter is honored. Sandersonia's filter is
  // `{ traitsAny: ['Amazon Lily','Kuja Pirates'], kind: 'character' }`
  // and Sandersonia itself carries the Kuja Pirates trait, so it
  // contributes 1 matching post-play. The TRUE subcase seeds an
  // Amazon-Lily-trait filler to land at 2 matching.
  test('OP07-050 Sandersonia — if_own_chars_min_filter (filter respected post-fix); bounce when ≥2 Amazon Lily / Kuja Pirates chars', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    // FALSE: A.field empty pre-play. Post-play A.field=1 (Sandersonia).
    const bA = await seedCharOnField(page, 'B', { cost: 1, power: 3000, tag: 'sA' });
    void bA;
    const cardA = await seedCardInAHand(page, corpusDef('OP07-050'));
    await topUpADon(page, 3);
    const beforeF = await readSnap(page);
    await playFromHand(page, cardA);
    const afterF = await readSnap(page);
    expect(afterF.bField, 'FALSE: B field unchanged').toBe(beforeF.bField);

    // TRUE: pre-seed 1 A char + Sandersonia ⇒ A.field=2 post-play.
    await clearAField(page);
    await clearBField(page);
    // Post-engine-fix (conditions2.ts:210-232 now respects traitsAny/kind):
    // filler must carry one of `Amazon Lily` / `Kuja Pirates` to count
    // toward the condition's filtered match (Sandersonia itself has
    // `Kuja Pirates`).
    const aFiller = await seedCharOnField(page, 'A', { cost: 1, power: 1000, traits: ['Amazon Lily'], tag: 'sfill' });
    const bB = await seedCharOnField(page, 'B', { cost: 1, power: 3000, tag: 'sB' });
    void aFiller; void bB;
    const cardB = await seedCardInAHand(page, corpusDef('OP07-050'));
    await topUpADon(page, 3);
    const beforeT = await readSnap(page);
    await playFromHand(page, cardB);
    const afterT = await readSnap(page);
    expect(afterT.bField, 'TRUE: B field -1').toBe(beforeT.bField - 1);
    expect(afterT.bHand, 'TRUE: B hand +1').toBe(beforeT.bHand + 1);
    assertStable(page, pageErrors, invariantErrors);
  });
});
