// stage-b-leader-gated — Stage B expansion of leader-gated family.
// Covers 8 cards across 3 leader-condition flavors:
//   - if_leader_has_trait : OP01-089 (control), OP04-018, OP04-037
//   - if_leader_is        : OP03-048, OP11-115
//   - if_leader_has_type  : EB01-035, OP02-021, OP12-054
//
// Test pattern (proven in Stage A):
//   1. Bootstrap to A main T1 via normalizeToATurn1Main.
//   2. Subcase A (WRONG leader): default A.leader (Zoro red — traits
//      ['Supernovas','Straw Hat Crew']). Seed card + scene; dispatch
//      play. Verify gated effect SKIPS.
//   3. Subcase B (MATCHING leader): mutate cardLibrary[A.leader.cardId]
//      to inject the required trait OR rewrite name. Reset board
//      between subcases. Seed fresh card + scene; play. Verify gated
//      effect FIRES.
//
// Engine sources cited:
//   - ifLeaderHasTrait  conditions.ts:55-58 — `card?.traits.includes(...)`.
//   - ifLeaderIs        conditions.ts:50-53 — `card?.name === ...`.
//   - ifLeaderHasType   conditions.ts:59-63 — `card?.traits.some((t) => t.includes(needle))` (substring match).
//   - removal_bounce    actions.ts:211-247 — field→owner.hand.
//   - removal_ko        actions.ts:140-205 — field→trash.
//   - power_buff        actions.ts:75-103 — writes powerModifier*.
//   - Event play path   mainPhase.ts:125-160.
//   - Character play    mainPhase.ts:163-220.
//
// Per directive: harness-only. No engine / UI / card-data /
// scenarioFactory changes. Runtime cardLibrary mutation only.

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
    const iid = `seedLG_${def['id']}_${Math.floor(Math.random() * 1e9).toString(36)}`;
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

async function seedBField(page: Page, cost: number, power: number, tag: string): Promise<string> {
  return page.evaluate(({ cost, power, tag }) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { B: { field: unknown[] } };
    const synthId = `__seed_lgb_${tag}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    const iid = `seedLGb_${tag}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    lib[synthId] = {
      id: synthId, name: `LG B ${tag}`, kind: 'character',
      cost, power, counterValue: 1000,
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
  }, { cost, power, tag });
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

async function topUpADon(page: Page, target: number): Promise<void> {
  await page.evaluate((target) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const players = s.players as { A: { donDeck: string[]; donCostArea: string[]; donRested: string[] } };
    // Recall ALL non-attached A DON into a fresh pool to avoid running out.
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

// Inject leader trait via cardLibrary mutation. Returns the pre-mutation
// traits/name snapshot so a test can restore it if needed.
async function setLeaderProps(page: Page, props: { name?: string; addTrait?: string; addType?: string }): Promise<void> {
  await page.evaluate((props) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    const players = s.players as { A: { leader: { cardId: string } } };
    const leaderId = players.A.leader.cardId;
    const card = lib[leaderId] as Record<string, unknown>;
    const pre = (Array.isArray(card.traits) ? [...(card.traits as string[])] : []) as string[];
    if (typeof props.name === 'string') (card as { name?: string }).name = props.name;
    if (typeof props.addTrait === 'string' && !pre.includes(props.addTrait)) {
      card.traits = [...pre, props.addTrait];
    } else if (typeof props.addType === 'string' && !pre.some((t) => t.includes(props.addType!))) {
      card.traits = [...pre, props.addType];
    }
    w.__store!.setState({ state: { ...s } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
  }, props);
  await page.waitForTimeout(50);
}

async function playFromHand(page: Page, iid: string): Promise<void> {
  await page.evaluate((id) => {
    const w = window as unknown as { __store?: { getState: () => { dispatch: (a: unknown) => void } } };
    w.__store!.getState().dispatch({ type: 'PLAY_CARD', instanceId: id, replaceTargetId: null });
  }, iid);
  await page.waitForTimeout(400);
}

// ─── Read helpers ────────────────────────────────────────────────────

interface FullSnap {
  phase: string;
  activePlayer: string;
  pendingKind: string | null;
  aHandIds: string[];
  aFieldIds: string[];
  aTrashIds: string[];
  bHandIds: string[];
  bTrashIds: string[];
  bFieldIds: string[];
  aLeaderMod: number;
  aLeaderTraits: string[];
  aLeaderName: string;
}

async function readSnap(page: Page): Promise<FullSnap> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __store?: {
        getState: () => {
          state: {
            phase: string;
            activePlayer: string;
            pending: { kind?: string } | null;
            players: {
              A: { hand: string[]; trash: string[]; field: { instanceId: string }[]; leader: { instanceId: string; cardId: string; powerModifierOneShot?: number; powerModifierContinuous?: number; powerModifierThisBattle?: number } };
              B: { hand: string[]; trash: string[]; field: { instanceId: string }[] };
            };
            cardLibrary: Record<string, { traits?: string[]; name?: string }>;
          };
        };
      };
    };
    const s = w.__store!.getState().state;
    const leaderCard = s.cardLibrary[s.players.A.leader.cardId];
    const lead = s.players.A.leader;
    const leaderMod = (lead.powerModifierOneShot ?? 0) + (lead.powerModifierContinuous ?? 0) + (lead.powerModifierThisBattle ?? 0);
    return {
      phase: s.phase,
      activePlayer: s.activePlayer,
      pendingKind: s.pending?.kind ?? null,
      aHandIds: [...s.players.A.hand],
      aFieldIds: s.players.A.field.map((i) => i.instanceId),
      aTrashIds: [...s.players.A.trash],
      bHandIds: [...s.players.B.hand],
      bTrashIds: [...s.players.B.trash],
      bFieldIds: s.players.B.field.map((i) => i.instanceId),
      aLeaderMod: leaderMod,
      aLeaderTraits: [...(leaderCard?.traits ?? [])],
      aLeaderName: leaderCard?.name ?? '',
    };
  });
}

async function readInstPowerMod(page: Page, iid: string): Promise<number> {
  return page.evaluate((id) => {
    const w = window as unknown as { __store?: { getState: () => { state: { instances: Record<string, { powerModifierOneShot?: number; powerModifierContinuous?: number; powerModifierThisBattle?: number }> } } } };
    const inst = w.__store!.getState().state.instances[id];
    return ((inst?.powerModifierOneShot ?? 0) + (inst?.powerModifierContinuous ?? 0) + (inst?.powerModifierThisBattle ?? 0));
  }, iid);
}

interface SubResult {
  name: string;
  bFieldBefore: number;
  bFieldAfter: number;
  bHandBefore: number;
  bHandAfter: number;
  bTrashBefore: number;
  bTrashAfter: number;
  aLeaderModAfter: number;
  bTargetIidPowerModAfter: number;
}

// Run a subcase scenario: seed B target chars (per spec), seed the
// leader-gated card into A.hand, top up DON, play it; return delta.
async function runScenario(page: Page, cardId: string, _setup: { bTargetCost: number; bTargetPower: number; donCount: number; bControlCost?: number; bControlPower?: number; isCounterMain?: boolean }): Promise<SubResult> {
  const setup = _setup;
  // Fresh DON.
  await topUpADon(page, setup.donCount);
  // Clear B.field of any leftover.
  await clearBField(page);
  // Seed B target (and optional control).
  const bTarget = await seedBField(page, setup.bTargetCost, setup.bTargetPower, `t_${cardId.slice(-3)}`);
  let bControlIid: string | null = null;
  if (typeof setup.bControlCost === 'number' && typeof setup.bControlPower === 'number') {
    bControlIid = await seedBField(page, setup.bControlCost, setup.bControlPower, `c_${cardId.slice(-3)}`);
  }
  // Seed the card.
  const iid = await seedCardInAHand(page, corpusDef(cardId));

  const beforeSnap = await readSnap(page);
  const bFieldBefore = beforeSnap.bFieldIds.length;
  const bHandBefore = beforeSnap.bHandIds.length;
  const bTrashBefore = beforeSnap.bTrashIds.length;

  await playFromHand(page, iid);

  const afterSnap = await readSnap(page);
  const aLeaderModAfter = afterSnap.aLeaderMod;
  const bTargetIidPowerModAfter = await readInstPowerMod(page, bTarget);
  void bControlIid;

  return {
    name: cardId,
    bFieldBefore,
    bFieldAfter: afterSnap.bFieldIds.length,
    bHandBefore,
    bHandAfter: afterSnap.bHandIds.length,
    bTrashBefore,
    bTrashAfter: afterSnap.bTrashIds.length,
    aLeaderModAfter,
    bTargetIidPowerModAfter,
  };
}

// Common stability + invariant assertions used at the end of each test.
function assertStable(page: Page, pageErrors: string[], invariantErrors: string[]): void {
  void page;
  expect(pageErrors).toEqual([]);
  expect(invariantErrors).toEqual([]);
}

test.describe('stage-b leader-gated expansion', () => {
  // ── 1. OP01-089 Crescent Cutlass (control) ───────────────────────
  test('OP01-089 Cutlass — if_leader_has_trait "Seven Warlords"; bounce gated', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    // Wrong leader.
    const wrong = await runScenario(page, 'OP01-089', { bTargetCost: 4, bTargetPower: 3000, donCount: 3 });
    expect(wrong.bFieldAfter, 'WRONG: B target still on field').toBe(wrong.bFieldBefore);
    expect(wrong.bHandAfter, 'WRONG: B hand unchanged').toBe(wrong.bHandBefore);
    // Matching leader.
    await setLeaderProps(page, { addTrait: 'The Seven Warlords of the Sea' });
    const match = await runScenario(page, 'OP01-089', { bTargetCost: 4, bTargetPower: 3000, donCount: 3 });
    expect(match.bFieldAfter, 'MATCH: B field -1').toBe(0);
    expect(match.bHandAfter, 'MATCH: B hand +1').toBe(match.bHandBefore + 1);
    assertStable(page, pageErrors, invariantErrors);
  });

  // ── 2. OP03-048 Nojiko — if_leader_is "Nami" ─────────────────────
  test('OP03-048 Nojiko — if_leader_is name="Nami"; bounce gated', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    const wrong = await runScenario(page, 'OP03-048', { bTargetCost: 4, bTargetPower: 3000, donCount: 2 });
    expect(wrong.bFieldAfter, 'WRONG: B field unchanged').toBe(wrong.bFieldBefore);
    expect(wrong.bHandAfter, 'WRONG: B hand unchanged').toBe(wrong.bHandBefore);
    // Rename A leader to "Nami".
    await setLeaderProps(page, { name: 'Nami' });
    const match = await runScenario(page, 'OP03-048', { bTargetCost: 4, bTargetPower: 3000, donCount: 2 });
    expect(match.bFieldAfter, 'MATCH: B field -1').toBe(0);
    expect(match.bHandAfter, 'MATCH: B hand +1').toBe(match.bHandBefore + 1);
    assertStable(page, pageErrors, invariantErrors);
  });

  // ── 3. EB01-035 Ms. Monday — if_leader_has_type "Baroque Works" ─
  test('EB01-035 Ms. Monday — if_leader_has_type "Baroque Works"; +1000 to A leader gated', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    const wrong = await runScenario(page, 'EB01-035', { bTargetCost: 1, bTargetPower: 1000, donCount: 3 });
    expect(wrong.aLeaderModAfter, 'WRONG: A leader unchanged').toBe(0);
    await setLeaderProps(page, { addType: 'Baroque Works' });
    const match = await runScenario(page, 'EB01-035', { bTargetCost: 1, bTargetPower: 1000, donCount: 3 });
    expect(match.aLeaderModAfter, 'MATCH: A leader +1000 (this_turn)').toBe(1000);
    assertStable(page, pageErrors, invariantErrors);
  });

  // ── 4. OP02-021 Seaquake — if_leader_has_type "Whitebeard Pirates"
  test('OP02-021 Seaquake — if_leader_has_type "Whitebeard Pirates"; KO opp ≤3000 power gated', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    const wrong = await runScenario(page, 'OP02-021', { bTargetCost: 1, bTargetPower: 2000, donCount: 1 });
    expect(wrong.bFieldAfter, 'WRONG: B field unchanged').toBe(wrong.bFieldBefore);
    expect(wrong.bTrashAfter, 'WRONG: B trash unchanged').toBe(wrong.bTrashBefore);
    await setLeaderProps(page, { addType: 'Whitebeard Pirates' });
    const match = await runScenario(page, 'OP02-021', { bTargetCost: 1, bTargetPower: 2000, donCount: 1 });
    expect(match.bFieldAfter, 'MATCH: B field -1').toBe(0);
    expect(match.bTrashAfter, 'MATCH: B trash +1').toBe(match.bTrashBefore + 1);
    assertStable(page, pageErrors, invariantErrors);
  });

  // ── 5. OP04-018 Vertigo Dance — if_leader_has_trait "Alabasta" ──
  test('OP04-018 Vertigo Dance — if_leader_has_trait "Alabasta"; -2000 opp char gated', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    const wrong = await runScenario(page, 'OP04-018', { bTargetCost: 1, bTargetPower: 5000, donCount: 3 });
    expect(wrong.bTargetIidPowerModAfter, 'WRONG: opp target unchanged').toBe(0);
    await setLeaderProps(page, { addTrait: 'Alabasta' });
    const match = await runScenario(page, 'OP04-018', { bTargetCost: 1, bTargetPower: 5000, donCount: 3 });
    expect(match.bTargetIidPowerModAfter, 'MATCH: opp target -2000').toBe(-2000);
    assertStable(page, pageErrors, invariantErrors);
  });

  // ── 6. OP04-037 Flapping Thread — if_leader_has_trait "Donquixote Pirates"
  test('OP04-037 Flapping Thread — if_leader_has_trait "Donquixote Pirates"; +2000 A leader gated', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    const wrong = await runScenario(page, 'OP04-037', { bTargetCost: 1, bTargetPower: 1000, donCount: 2 });
    expect(wrong.aLeaderModAfter, 'WRONG: A leader unchanged').toBe(0);
    await setLeaderProps(page, { addTrait: 'Donquixote Pirates' });
    const match = await runScenario(page, 'OP04-037', { bTargetCost: 1, bTargetPower: 1000, donCount: 2 });
    expect(match.aLeaderModAfter, 'MATCH: A leader +2000').toBe(2000);
    assertStable(page, pageErrors, invariantErrors);
  });

  // ── 7. OP11-115 — if_leader_is "Shirahoshi" ─────────────────────
  test('OP11-115 You\'re Just Not My Type! — if_leader_is "Shirahoshi"; +4000 A leader this_battle gated', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    const wrong = await runScenario(page, 'OP11-115', { bTargetCost: 1, bTargetPower: 1000, donCount: 1 });
    expect(wrong.aLeaderModAfter, 'WRONG: A leader unchanged').toBe(0);
    await setLeaderProps(page, { name: 'Shirahoshi' });
    const match = await runScenario(page, 'OP11-115', { bTargetCost: 1, bTargetPower: 1000, donCount: 1 });
    expect(match.aLeaderModAfter, 'MATCH: A leader +4000 (this_battle)').toBe(4000);
    assertStable(page, pageErrors, invariantErrors);
  });

  // ── 8. OP12-054 — if_leader_has_type "Seven Warlords" ───────────
  test('OP12-054 Marshall.D.Teach — if_leader_has_type "Seven Warlords"; bounce cost≤1 opp char gated', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    const wrong = await runScenario(page, 'OP12-054', { bTargetCost: 1, bTargetPower: 1000, donCount: 1 });
    expect(wrong.bFieldAfter, 'WRONG: B field unchanged').toBe(wrong.bFieldBefore);
    await setLeaderProps(page, { addType: 'The Seven Warlords of the Sea' });
    const match = await runScenario(page, 'OP12-054', { bTargetCost: 1, bTargetPower: 1000, donCount: 1 });
    expect(match.bFieldAfter, 'MATCH: B field -1').toBe(0);
    expect(match.bHandAfter, 'MATCH: B hand +1').toBe(match.bHandBefore + 1);
    assertStable(page, pageErrors, invariantErrors);
  });
});
