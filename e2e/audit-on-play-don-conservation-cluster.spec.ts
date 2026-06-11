// audit-on-play-don-conservation-cluster — Stage C #2 follow-up.
//
// Diagnoses the 12-card ENGINE_BUG cluster from
// e2e/coverage/reports/stage-c-on-play-events-2026-06-07T21-55-54-401Z.json
// where PLAY_CARD dispatch threw:
//   InvariantError [DON_CONSERVATION]: player B: 9 DON instances total;
//                  expected 10.
//
// Hypothesis under investigation:
//   The Stage C #2 spec's resetWithRecipe wipes `B.field` between cards
//   without releasing DON attached to any B.field char back to a B DON
//   zone. A prior card's clause action (e.g. give_don_to_opp_target at
//   actions3.ts:84-97) attaches B's DON to a B character, then the next
//   card's reset deletes the character and the attached DON instance
//   IDs become orphaned. By the time a later card dispatches, the
//   invariant at shared/engine-v2/invariants/check.ts:34-51 counts B's
//   accounted zones as 9 instead of 10.
//
// Validation strategy (this diagnostic, fully isolated per card):
//   1. Fresh page bootstrap.
//   2. Per-card, fully-restoring reset that detaches ALL attached DON
//      from any A/B instance before clearing field; restores B donDeck
//      to ensure 10 DON accounted.
//   3. For each card, run TWO subcases:
//      A. B target with 0 attached DON.
//      B. B target with 1 attached DON (pre-attached from B donDeck).
//   4. Capture per-subcase: pre/post B DON by zone + invariant message
//      + target zone before/after + history tail.
//   5. Classify root cause per card.
//
// Read-only against engine / UI / cards.json / scenarioFactory.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { PlayerDriver } from './helpers/player';

const FIVE_MIN = 5 * 60_000;
test.use({ launchOptions: { args: ['--disable-renderer-backgrounding', '--no-sandbox'] } });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CORPUS_PATH = resolve(__dirname, '../shared/data/cards.json');
const REPORTS_DIR = resolve(__dirname, 'coverage/reports');
mkdirSync(REPORTS_DIR, { recursive: true });

const CORPUS_RAW = JSON.parse(readFileSync(CORPUS_PATH, 'utf-8')) as unknown;
const CORPUS = (Array.isArray(CORPUS_RAW) ? CORPUS_RAW : Object.values(CORPUS_RAW as Record<string, unknown>)) as Array<Record<string, unknown>>;

const TARGET_IDS = [
  'OP15-014', 'OP15-015', 'OP15-019', 'OP15-020', 'OP15-021', 'OP15-025',
  'OP15-026', 'OP15-027', 'OP15-028', 'OP15-029', 'OP15-031', 'OP15-032',
];

interface CardDef {
  readonly id: string; readonly name: string; readonly kind: string;
  readonly cost?: number | null; readonly colors?: ReadonlyArray<string>;
  readonly effectText?: string;
  readonly effectSpecV2?: { readonly clauses?: ReadonlyArray<{ readonly trigger?: string; readonly action?: { readonly kind?: string }; readonly target?: { readonly kind?: string }; readonly cost?: Record<string, unknown> }> };
  readonly [k: string]: unknown;
}
const CARDS: CardDef[] = TARGET_IDS.map((id) => CORPUS.find((c) => (c as { id?: string }).id === id) as unknown as CardDef);

interface BDonSnapshot {
  donDeck: number;
  donCostArea: number;
  donRested: number;
  attachedOnLeader: number;
  attachedOnFieldSum: number;
  total: number;
  expected: number;
}

interface SubcaseRecord {
  cardId: string; name: string; subcase: 'B-target-0-attached' | 'B-target-1-attached' | 'no-opp-target';
  actionsOnCard: string[]; targetsOnCard: string[];
  bDonBefore: BDonSnapshot;
  bDonAfter: BDonSnapshot;
  bDonDeltaTotal: number;
  bTargetInstanceId: string | null;
  bTargetZoneBefore: string | null;
  bTargetZoneAfter: string | null;
  bTargetAttachedDonBefore: number;
  bTargetAttachedDonAfter: number;
  invariantMessage: string | null;
  dispatchThrew: boolean;
  historyTail: ReadonlyArray<Record<string, unknown>>;
  classification: 'VERIFIED_NO_BUG' | 'ENGINE_BUG' | 'HARNESS_BUG' | 'INCONCLUSIVE';
  rootCauseSignature: string;
}

// ── harness ──────────────────────────────────────────────────────────

async function bootstrap(page: Page): Promise<{ drv: PlayerDriver; pageErrors: string[]; invariantErrors: string[] }> {
  const pageErrors: string[] = [];
  const invariantErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => { const t = m.text(); if (t.includes('InvariantError') || t.includes('invariant')) invariantErrors.push(t); });
  const drv = new PlayerDriver(page);
  await drv.open();
  await drv.waitForPhase('dice_roll'); await drv.rollDice();
  try { await drv.waitForPhase('first_player_choice', 15_000); await drv.chooseGoFirst(); } catch { /* skip */ }
  try { await drv.waitForPhase('mulligan', 8_000); await drv.keepMulliganHand(); } catch { /* skip */ }
  await expect.poll(async () => {
    const s = await drv.getState(); return { phase: s.phase, activePlayer: s.activePlayer };
  }, { timeout: 60_000 }).toMatchObject({ phase: 'main', activePlayer: 'A' });
  await drv.normalizeToATurn1Main();
  return { drv, pageErrors, invariantErrors };
}

// Fully-restoring reset that:
//   - clears A.field + B.field
//   - DETACHES every attached DON on B leader / B field / B stage and
//     pushes them back to B.donDeck (so B is always at 10 DON accounted)
//   - DETACHES every attached DON on A leader / A field / A stage
//   - rebuilds A.hand with fillers + 1 guard counter
//   - rebalances A.donCostArea to opts.donCount
//   - clears state.result, sets phase=main, A active
async function fullRestoringReset(page: Page, opts: { donCount: number; aHandSize: number; aLifeCount: number; bLifeCount: number; leaderColorsOverride?: string[] }): Promise<void> {
  await page.evaluate((opts) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    (s as Record<string, unknown>).phase = 'main';
    (s as Record<string, unknown>).activePlayer = 'A';
    (s as Record<string, unknown>).pending = null;
    (s as Record<string, unknown>).result = null;
    const players = s.players as {
      A: { donDeck: string[]; donCostArea: string[]; donRested: string[]; leader: { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[]; powerModifierThisBattle?: number; powerModifierContinuous?: number; powerModifierOneShot?: number }; field: { instanceId: string }[]; hand: string[]; trash: string[]; life: string[]; deck: string[]; stage?: { instanceId: string; attachedDon?: string[]; attachedDonRested?: string[] } | null };
      B: { donDeck: string[]; donCostArea: string[]; donRested: string[]; leader: { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[] }; field: { instanceId: string }[]; life: string[]; deck: string[]; stage?: { instanceId: string; attachedDon?: string[]; attachedDonRested?: string[] } | null };
    };
    const instances = s.instances as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    // ── Detach all attached DON on BOTH sides into respective donDeck.
    function detachInto(side: 'A' | 'B', insts: Array<{ attachedDon?: string[]; attachedDonRested?: string[] }>) {
      const target = side === 'A' ? players.A.donDeck : players.B.donDeck;
      for (const inst of insts) {
        if (Array.isArray(inst.attachedDon)) { for (const id of inst.attachedDon) target.push(id); inst.attachedDon = []; }
        if (Array.isArray(inst.attachedDonRested)) { for (const id of inst.attachedDonRested) target.push(id); inst.attachedDonRested = []; }
      }
    }
    const aAll = [players.A.leader, ...players.A.field as Array<{ attachedDon?: string[]; attachedDonRested?: string[] }>];
    if (players.A.stage) aAll.push(players.A.stage);
    detachInto('A', aAll);
    const bAll = [players.B.leader, ...players.B.field as Array<{ attachedDon?: string[]; attachedDonRested?: string[] }>];
    if (players.B.stage) bAll.push(players.B.stage);
    detachInto('B', bAll);
    // ── Clear A.field + B.field.
    players.A.field = [];
    players.B.field = [];
    // ── Restore B donDeck up to 10 (using DON ids from cost/rested if any).
    // After detach, B.donDeck should already have all B's DON.
    const allBDon = [...players.B.donDeck, ...players.B.donCostArea, ...players.B.donRested];
    players.B.donDeck = allBDon;
    players.B.donCostArea = [];
    players.B.donRested = [];
    // ── Leader overrides (colors only for this diagnostic).
    if (Array.isArray(opts.leaderColorsOverride)) {
      const lc = lib[players.A.leader.cardId] as { colors?: string[] } | undefined;
      if (lc !== undefined) lc.colors = opts.leaderColorsOverride.slice();
    }
    // ── Clear A leader transient mods.
    players.A.leader.attachedDon = players.A.leader.attachedDon ?? [];
    players.A.leader.attachedDonRested = players.A.leader.attachedDonRested ?? [];
    (players.A.leader as { powerModifierThisBattle?: number; powerModifierContinuous?: number; powerModifierOneShot?: number }).powerModifierThisBattle = undefined;
    (players.A.leader as { powerModifierContinuous?: number }).powerModifierContinuous = undefined;
    (players.A.leader as { powerModifierOneShot?: number }).powerModifierOneShot = undefined;
    // ── A.hand fillers.
    players.A.hand = [];
    for (let i = 0; i < opts.aHandSize; i++) {
      const synthId = `__fillerHand_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `fillerH_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = { id: synthId, name: `FillerHand ${i}`, kind: 'character', cost: 1, power: 1000, counterValue: null, colors: ['red'], traits: [], keywords: [], effectText: '' };
      instances[iid] = { instanceId: iid, cardId: synthId, controller: 'A', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      players.A.hand.push(iid);
    }
    // ── A.life refill.
    while (players.A.life.length < opts.aLifeCount) {
      const synthId = `__seedLife_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `seedLife_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = { id: synthId, name: 'Life Placeholder', kind: 'character', cost: 1, power: 1000, counterValue: 1000, colors: ['red'], traits: [], keywords: [], effectText: '' };
      instances[iid] = { instanceId: iid, cardId: synthId, controller: 'A', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      players.A.life.push(iid);
    }
    while (players.A.life.length > opts.aLifeCount) players.A.life.pop();
    while (players.B.life.length < opts.bLifeCount) {
      const synthId = `__seedBLife_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `seedBLife_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = { id: synthId, name: 'B Life Placeholder', kind: 'character', cost: 1, power: 1000, counterValue: 1000, colors: ['blue'], traits: [], keywords: [], effectText: '' };
      instances[iid] = { instanceId: iid, cardId: synthId, controller: 'B', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      players.B.life.push(iid);
    }
    while (players.B.life.length > opts.bLifeCount) players.B.life.pop();
    // ── A.donCostArea rebalance to opts.donCount.
    const allADon = [...players.A.donDeck, ...players.A.donCostArea, ...players.A.donRested];
    players.A.donDeck = allADon.slice(opts.donCount);
    players.A.donCostArea = allADon.slice(0, opts.donCount);
    players.A.donRested = [];
    w.__store!.setState({ state: { ...s, players: { ...(s.players as Record<string, unknown>), A: { ...players.A }, B: { ...players.B } } } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
  }, opts);
  await page.waitForTimeout(50);
}

async function seedBFieldChar(page: Page, attachedDonCount: number): Promise<{ targetIid: string; attachedDonIds: string[] }> {
  return page.evaluate((attachedDonCount) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    const instances = s.instances as Record<string, unknown>;
    const players = s.players as { B: { donDeck: string[]; field: unknown[] } };
    const synthCardId = `__diagBChar_${Math.floor(Math.random() * 1e9).toString(36)}`;
    const synthIid = `diagBChar_${Math.floor(Math.random() * 1e9).toString(36)}`;
    lib[synthCardId] = { id: synthCardId, name: 'Diag B Char', kind: 'character', cost: 4, power: 4000, counterValue: 1000, colors: ['blue'], traits: [], keywords: [], effectText: '' };
    // Take attachedDonCount DON ids from B.donDeck.
    const attachedDonIds: string[] = [];
    for (let i = 0; i < attachedDonCount; i++) {
      const id = players.B.donDeck.shift();
      if (id !== undefined) attachedDonIds.push(id);
    }
    instances[synthIid] = { instanceId: synthIid, cardId: synthCardId, controller: 'B', rested: false, summoningSick: false, attachedDon: attachedDonIds.slice(), attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
    (players.B.field as unknown[]).push(instances[synthIid]);
    w.__store!.setState({ state: { ...s } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
    return { targetIid: synthIid, attachedDonIds };
  }, attachedDonCount);
}

async function seedCardInAHand(page: Page, def: Record<string, unknown>): Promise<string> {
  return page.evaluate((def) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    lib[def['id'] as string] = def;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { hand: string[] } };
    const iid = `diag_${def['id']}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    inst[iid] = { instanceId: iid, cardId: def['id'], controller: 'A', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
    players.A.hand = [...players.A.hand, iid];
    w.__store!.setState({ state: { ...s } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
    return iid;
  }, def);
}

async function readBDonSnapshot(page: Page): Promise<BDonSnapshot> {
  return page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { state: { players: { B: { donDeck: string[]; donCostArea: string[]; donRested: string[]; leader: { attachedDon?: string[]; attachedDonRested?: string[] }; field: Array<{ attachedDon?: string[]; attachedDonRested?: string[] }>; stage?: { attachedDon?: string[]; attachedDonRested?: string[] } | null } } } } } };
    const s = w.__store!.getState().state;
    const B = s.players.B;
    const leaderAttached = (B.leader.attachedDon?.length ?? 0) + (B.leader.attachedDonRested?.length ?? 0);
    let fieldAttachedSum = 0;
    for (const inst of B.field) fieldAttachedSum += (inst.attachedDon?.length ?? 0) + (inst.attachedDonRested?.length ?? 0);
    if (B.stage) fieldAttachedSum += (B.stage.attachedDon?.length ?? 0) + (B.stage.attachedDonRested?.length ?? 0);
    return {
      donDeck: B.donDeck.length,
      donCostArea: B.donCostArea.length,
      donRested: B.donRested.length,
      attachedOnLeader: leaderAttached,
      attachedOnFieldSum: fieldAttachedSum,
      total: B.donDeck.length + B.donCostArea.length + B.donRested.length + leaderAttached + fieldAttachedSum,
      expected: 10,
    };
  });
}

async function readTargetZone(page: Page, iid: string): Promise<{ zone: string | null; attachedDon: number }> {
  return page.evaluate((iid) => {
    const w = window as unknown as { __store?: { getState: () => { state: { players: { A: { hand: string[]; field: { instanceId: string }[]; trash: string[] }; B: { hand?: string[]; field: { instanceId: string }[]; trash: string[]; leader: { instanceId: string } } }; instances: Record<string, { attachedDon?: string[]; attachedDonRested?: string[] }> } } } };
    const s = w.__store!.getState().state;
    const inst = s.instances[iid];
    const attached = inst ? ((inst.attachedDon?.length ?? 0) + (inst.attachedDonRested?.length ?? 0)) : 0;
    for (const i of s.players.B.field) if (i.instanceId === iid) return { zone: 'B.field', attachedDon: attached };
    if (s.players.B.leader.instanceId === iid) return { zone: 'B.leader', attachedDon: attached };
    if (s.players.B.trash.includes(iid)) return { zone: 'B.trash', attachedDon: attached };
    return { zone: null, attachedDon: attached };
  }, iid);
}

async function dispatchAs(page: Page, action: object): Promise<{ ok: boolean; err: string | null }> {
  const res = await page.evaluate((a) => {
    try { const w = window as unknown as { __store?: { getState: () => { dispatch: (a: unknown) => void } } }; w.__store!.getState().dispatch(a); return { ok: true, err: null }; }
    catch (e) { return { ok: false, err: e instanceof Error ? `${e.name}: ${e.message}` : String(e) }; }
  }, action);
  await page.waitForTimeout(80);
  return res;
}

async function readPendingKind(page: Page): Promise<string | null> {
  return page.evaluate(() => { const w = window as unknown as { __store?: { getState: () => { state: { pending: { kind?: string } | null } } } }; return w.__store!.getState().state.pending?.kind ?? null; });
}

async function readHistoryTail(page: Page, n = 10): Promise<ReadonlyArray<Record<string, unknown>>> {
  return page.evaluate((n) => { const w = window as unknown as { __store?: { getState: () => { state: { history: ReadonlyArray<Record<string, unknown>> } } } }; return w.__store!.getState().state.history.slice(-n); }, n);
}

async function drainPending(page: Page, maxIter = 6): Promise<void> {
  for (let i = 0; i < maxIter; i++) {
    const pk = await readPendingKind(page);
    if (pk === null) return;
    if (pk === 'attack') await dispatchAs(page, { type: 'SKIP_COUNTER' });
    else if (pk === 'choose_one') await dispatchAs(page, { type: 'RESOLVE_CHOOSE_ONE', optionIndex: 0 });
    else if (pk === 'trigger') await dispatchAs(page, { type: 'RESOLVE_TRIGGER', activate: false, targetInstanceId: null });
    else if (pk === 'discard') await dispatchAs(page, { type: 'RESOLVE_DISCARD', pickedId: null });
    else if (pk === 'peek') await dispatchAs(page, { type: 'RESOLVE_PEEK', pickedIds: [] });
    else break;
  }
  if (await readPendingKind(page) !== null) {
    await page.evaluate(() => {
      const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown }) => void } };
      const s = w.__store!.getState().state as Record<string, unknown>;
      (s as { pending: unknown }).pending = null;
      (s as { phase: string }).phase = 'main';
      w.__store!.setState({ state: { ...s } });
    });
  }
}

function actionsOf(card: CardDef): string[] {
  return (card.effectSpecV2?.clauses ?? []).filter((c) => c.trigger === 'on_play').map((c) => c.action?.kind ?? '?');
}
function targetsOf(card: CardDef): string[] {
  return (card.effectSpecV2?.clauses ?? []).filter((c) => c.trigger === 'on_play').map((c) => c.target?.kind ?? 'null');
}
function hasOppTarget(card: CardDef): boolean {
  return targetsOf(card).some((k) => k === 'opp_character' || k === 'opp_leader_or_character' || k === 'opp_leader' || k === 'all_opp_characters' || k === 'any_character');
}

async function processSubcase(
  page: Page, card: CardDef, subcase: SubcaseRecord['subcase'], attachedDonCount: number,
): Promise<SubcaseRecord> {
  const donCount = Math.max(0, (card.cost ?? 0) + 4);
  await fullRestoringReset(page, { donCount, aHandSize: 3, aLifeCount: 5, bLifeCount: 5, leaderColorsOverride: ['red','blue','green','purple','black','yellow'] });
  let bTargetInstanceId: string | null = null;
  let bTargetZoneBefore: string | null = null;
  let bTargetAttachedDonBefore = 0;
  if (hasOppTarget(card)) {
    const seed = await seedBFieldChar(page, attachedDonCount);
    bTargetInstanceId = seed.targetIid;
    const z = await readTargetZone(page, seed.targetIid);
    bTargetZoneBefore = z.zone;
    bTargetAttachedDonBefore = z.attachedDon;
  }
  const cardIid = await seedCardInAHand(page, card as unknown as Record<string, unknown>);
  const bDonBefore = await readBDonSnapshot(page);
  const playRes = await dispatchAs(page, { type: 'PLAY_CARD', instanceId: cardIid, replaceTargetId: null });
  await drainPending(page);
  const bDonAfter = await readBDonSnapshot(page);
  const historyTail = await readHistoryTail(page);
  let bTargetZoneAfter: string | null = null;
  let bTargetAttachedDonAfter = 0;
  if (bTargetInstanceId !== null) {
    const z = await readTargetZone(page, bTargetInstanceId);
    bTargetZoneAfter = z.zone;
    bTargetAttachedDonAfter = z.attachedDon;
  }
  const delta = bDonAfter.total - bDonBefore.total;
  const invariantMsg = !playRes.ok ? playRes.err : null;
  let classification: SubcaseRecord['classification'];
  let rootCauseSignature: string;
  if (playRes.ok && delta === 0) {
    classification = 'VERIFIED_NO_BUG'; rootCauseSignature = 'dispatch succeeded; B DON total conserved';
  } else if (!playRes.ok && (invariantMsg ?? '').includes('DON_CONSERVATION')) {
    classification = 'ENGINE_BUG'; rootCauseSignature = `DON_CONSERVATION fired in dispatch — pre.total=${bDonBefore.total} post.total=${bDonAfter.total}`;
  } else if (!playRes.ok) {
    classification = 'INCONCLUSIVE'; rootCauseSignature = `dispatch threw non-DON error: ${invariantMsg}`;
  } else if (delta !== 0) {
    classification = 'ENGINE_BUG'; rootCauseSignature = `B DON delta non-zero (Δ=${delta}); pre=${bDonBefore.total} post=${bDonAfter.total}`;
  } else {
    classification = 'INCONCLUSIVE'; rootCauseSignature = 'unknown outcome';
  }
  return {
    cardId: card.id, name: card.name, subcase,
    actionsOnCard: actionsOf(card), targetsOnCard: targetsOf(card),
    bDonBefore, bDonAfter, bDonDeltaTotal: delta,
    bTargetInstanceId, bTargetZoneBefore, bTargetZoneAfter, bTargetAttachedDonBefore, bTargetAttachedDonAfter,
    invariantMessage: invariantMsg, dispatchThrew: !playRes.ok,
    historyTail, classification, rootCauseSignature,
  };
}

test.describe.serial('audit-on-play-don-conservation-cluster', () => {
  test('12 cards × 2 subcases — root-cause diagnosis', async ({ page }) => {
    test.setTimeout(FIVE_MIN);
    const { drv, pageErrors, invariantErrors } = await bootstrap(page);
    void drv;
    const records: SubcaseRecord[] = [];
    for (const card of CARDS) {
      // Subcase A: B target with 0 attached DON.
      records.push(await processSubcase(page, card, hasOppTarget(card) ? 'B-target-0-attached' : 'no-opp-target', 0));
      // Subcase B: B target with 1 attached DON (only meaningful when card has opp target).
      if (hasOppTarget(card)) {
        records.push(await processSubcase(page, card, 'B-target-1-attached', 1));
      }
    }
    expect(pageErrors, 'no pageerrors').toEqual([]);
    // NB: invariantErrors via console.log of InvariantError may fire on
    // dispatch — but the test catches the throw via dispatchAs. We allow
    // invariantErrors here because they're the DIAGNOSTIC TARGET; the
    // spec PASSES on capturing them, not on absence.
    expect(records.length, 'records emitted').toBeGreaterThanOrEqual(CARDS.length);
    // ── aggregate.
    const tally = {
      VERIFIED_NO_BUG: records.filter((r) => r.classification === 'VERIFIED_NO_BUG').length,
      ENGINE_BUG: records.filter((r) => r.classification === 'ENGINE_BUG').length,
      HARNESS_BUG: records.filter((r) => r.classification === 'HARNESS_BUG').length,
      INCONCLUSIVE: records.filter((r) => r.classification === 'INCONCLUSIVE').length,
    };
    const clusters = new Map<string, { sig: string; subcases: string[] }>();
    for (const r of records) {
      if (r.classification === 'VERIFIED_NO_BUG') continue;
      const sig = r.rootCauseSignature.slice(0, 100);
      const ex = clusters.get(sig) ?? { sig, subcases: [] };
      ex.subcases.push(`${r.cardId}/${r.subcase}`);
      clusters.set(sig, ex);
    }
    const sortedClusters = Array.from(clusters.values()).sort((a, b) => b.subcases.length - a.subcases.length);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const jsonPath = join(REPORTS_DIR, `audit-on-play-don-conservation-cluster-${ts}.json`);
    const mdPath = join(REPORTS_DIR, `audit-on-play-don-conservation-cluster-${ts}.md`);
    const finalReport = {
      generatedAt: new Date().toISOString(),
      targetCards: TARGET_IDS, totalSubcases: records.length, tally,
      clusters: sortedClusters, records, invariantErrorsCaught: invariantErrors,
    };
    writeFileSync(jsonPath, JSON.stringify(finalReport, null, 2), 'utf-8');
    const md: string[] = [];
    md.push(`# Audit — On-Play DON Conservation Cluster\n\n`);
    md.push(`**Generated:** ${new Date().toISOString()}\n`);
    md.push(`**Target cards:** ${TARGET_IDS.length}\n`);
    md.push(`**Total subcases:** ${records.length}\n\n`);
    md.push(`## Classification\n\n| Bucket | Count |\n|---|---:|\n`);
    for (const [k, v] of Object.entries(tally)) md.push(`| ${k} | ${v} |\n`);
    md.push(`\n## Per-card / per-subcase\n\n| Card | Subcase | actions | targets | preB | postB | Δ | targetZoneBefore→After | preAttached→post | classification | invariant |\n|---|---|---|---|---:|---:|---:|---|---|---|---|\n`);
    for (const r of records) {
      md.push(`| ${r.cardId} ${r.name.slice(0, 24)} | ${r.subcase} | ${r.actionsOnCard.join(',')} | ${r.targetsOnCard.join(',')} | ${r.bDonBefore.total} | ${r.bDonAfter.total} | ${r.bDonDeltaTotal} | ${r.bTargetZoneBefore}→${r.bTargetZoneAfter} | ${r.bTargetAttachedDonBefore}→${r.bTargetAttachedDonAfter} | ${r.classification} | ${(r.invariantMessage ?? '').slice(0, 50)} |\n`);
    }
    md.push(`\n## Root-cause clusters\n\n`);
    if (sortedClusters.length === 0) md.push(`(none — all VERIFIED_NO_BUG)\n`);
    else for (const c of sortedClusters) md.push(`- **${c.subcases.length} subcases**: ${c.sig}\n  - Affected: ${c.subcases.join(', ')}\n\n`);
    md.push(`\n## Report files\n\n- JSON: \`coverage/reports/audit-on-play-don-conservation-cluster-${ts}.json\`\n- MD: \`coverage/reports/audit-on-play-don-conservation-cluster-${ts}.md\`\n`);
    writeFileSync(mdPath, md.join(''), 'utf-8');
    /* eslint-disable no-console */
    console.log(`[DON-cluster] JSON: ${jsonPath}`);
    console.log(`[DON-cluster] MD:   ${mdPath}`);
    console.log(`[DON-cluster] tally: ${JSON.stringify(tally)}`);
    /* eslint-enable no-console */
    expect(await readPendingKind(page), 'no stuck pending at end').toBeNull();
  });
});
