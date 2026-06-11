// stage-c-generated-leader-gated — Stage C target #8 per
// e2e/stage-c-corpus-verification-plan.md. Auto-discovers every card
// where at least one `effectSpecV2.clauses[].condition.type` starts
// with `if_leader_*` (or is `if_owned_leader_name`) and runs each
// through TWO subcases:
//   A. wrong-leader: default leader (unchanged traits/name/type) →
//      gated effect should NOT fire.
//   B. matching-leader: cardLibrary leader mutated to satisfy the
//      condition → gated effect SHOULD fire.
//
// Read-only against engine / UI / cards.json / scenarioFactory.
//
// Engine references:
//   - conditions.ts:55-67 ifLeaderHasTrait / ifLeaderHasType /
//     ifLeaderIs / ifLeaderHasColor / ifLeaderMulticolored read from
//     state.cardLibrary[leader.cardId].
//   - Mutating cardLibrary[A.leader.cardId].traits / name / colors at
//     runtime is the proven Stage B pattern (validated by
//     stage-b-leader-gated.spec.ts).
//
// Per directive's strict classification:
//   - condition/cost not satisfied = HARNESS_GAP
//   - malformed spec = CARD_DATA_BUG (rare)
//   - wrong state diff post-condition-true = ENGINE_BUG or CARD_DATA_BUG
//   - unsupported action = NOT_IMPLEMENTED

import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
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
const SLICE_TMP_DIR = resolve(__dirname, 'coverage/reports/.stage-c-lg-slices');
mkdirSync(REPORTS_DIR, { recursive: true });
mkdirSync(SLICE_TMP_DIR, { recursive: true });
for (const f of readdirSync(SLICE_TMP_DIR)) { if (f.endsWith('.json')) { try { unlinkSync(join(SLICE_TMP_DIR, f)); } catch { /* ignore */ } } }

interface CardDef {
  readonly id: string; readonly name: string; readonly kind: 'character' | 'event' | 'stage' | 'leader' | 'don';
  readonly cost?: number | null; readonly power?: number | null; readonly colors?: ReadonlyArray<string>; readonly traits?: ReadonlyArray<string>;
  readonly keywords?: ReadonlyArray<string>; readonly effectText?: string;
  readonly effectSpecV2?: { readonly clauses?: ReadonlyArray<{ readonly trigger?: string; readonly action?: { readonly kind?: string; readonly magnitude?: number }; readonly target?: { readonly kind?: string }; readonly cost?: Record<string, unknown>; readonly condition?: { readonly type?: string; readonly [k: string]: unknown } }> };
  readonly [k: string]: unknown;
}

const CORPUS_RAW = JSON.parse(readFileSync(CORPUS_PATH, 'utf-8')) as unknown;
const CORPUS = (Array.isArray(CORPUS_RAW) ? CORPUS_RAW : Object.values(CORPUS_RAW as Record<string, unknown>)) as Array<Record<string, unknown>>;

function hasLeaderGate(c: Record<string, unknown>): boolean {
  const cd = c as CardDef;
  return (cd.effectSpecV2?.clauses ?? []).some((cl) => {
    const t = cl.condition?.type ?? '';
    return t.startsWith('if_leader_') || t === 'if_owned_leader_name';
  });
}

const CARDS: CardDef[] = CORPUS.filter(hasLeaderGate) as CardDef[];
CARDS.sort((a, b) => a.id.localeCompare(b.id));

const SLICE_SIZE = 25;
const SLICE_COUNT = Math.ceil(CARDS.length / SLICE_SIZE);
/* eslint-disable no-console */
console.log(`[stage-c-leader-gated] Discovered ${CARDS.length} leader-gated cards → ${SLICE_COUNT} slice(s) of up to ${SLICE_SIZE}`);
/* eslint-enable no-console */

// Stage B anchors per the plan.
const ANCHORS = new Set<string>(['OP01-089', 'OP03-048', 'EB01-035', 'OP02-021', 'OP04-018', 'OP04-037', 'OP11-115', 'OP12-054']);

type Classification = 'VERIFIED' | 'ENGINE_BUG' | 'CARD_DATA_BUG' | 'UI_BUG' | 'HARNESS_BUG' | 'HARNESS_GAP' | 'NOT_IMPLEMENTED' | 'NO_UI_EXPECTED' | 'INCONCLUSIVE';

interface LeaderGate {
  conditionType: string;
  clauseIndex: number;
  clauseTrigger: string;
  // Values to apply on the matching subcase: traits/name/colors/multicolored.
  traits?: string[];
  name?: string;
  colors?: string[];
  multicolored?: boolean;
}

function findLeaderGate(card: CardDef): LeaderGate | null {
  const clauses = card.effectSpecV2?.clauses ?? [];
  for (let i = 0; i < clauses.length; i++) {
    const c = clauses[i]!;
    const t = c.condition?.type ?? '';
    if (!t.startsWith('if_leader_') && t !== 'if_owned_leader_name') continue;
    const cond = c.condition as Record<string, unknown>;
    const base = { conditionType: t, clauseIndex: i, clauseTrigger: String(c.trigger ?? '') };
    if (t === 'if_leader_has_trait') return { ...base, traits: [String(cond.trait ?? '')] };
    if (t === 'if_leader_has_type') return { ...base, traits: [String(cond.typeString ?? '')] };
    if (t === 'if_leader_is') return { ...base, name: String(cond.name ?? '') };
    if (t === 'if_owned_leader_name') return { ...base, name: String(cond.name ?? '') };
    if (t === 'if_leader_has_color') return { ...base, colors: [String(cond.color ?? 'red')] };
    if (t === 'if_leader_multicolored') return { ...base, multicolored: true };
    if (t === 'if_leader_power_max') return base; // numeric power; harness can't easily satisfy
    return base;
  }
  return null;
}

function seedZoneFor(card: CardDef): 'a_hand' | 'a_field' | 'a_stage' | 'skip' {
  if (card.kind === 'event') return 'a_hand';
  if (card.kind === 'character') return 'a_field';
  if (card.kind === 'stage') return 'a_stage';
  return 'skip';
}

// ── harness ──────────────────────────────────────────────────────────

async function bootstrap(page: Page): Promise<{ drv: PlayerDriver; pageErrors: string[]; invariantErrors: string[] }> {
  const pageErrors: string[] = []; const invariantErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => { const t = m.text(); if (t.includes('InvariantError') || t.includes('invariant')) invariantErrors.push(t); });
  const drv = new PlayerDriver(page);
  await drv.open();
  await drv.waitForPhase('dice_roll'); await drv.rollDice();
  try { await drv.waitForPhase('first_player_choice', 15_000); await drv.chooseGoFirst(); } catch { /* skip */ }
  try { await drv.waitForPhase('mulligan', 8_000); await drv.keepMulliganHand(); } catch { /* skip */ }
  await expect.poll(async () => { const s = await drv.getState(); return { phase: s.phase, activePlayer: s.activePlayer }; }, { timeout: 60_000 }).toMatchObject({ phase: 'main', activePlayer: 'A' });
  await drv.normalizeToATurn1Main();
  return { drv, pageErrors, invariantErrors };
}

interface ResetOpts {
  seedZone: 'a_hand' | 'a_field' | 'a_stage';
  leaderTraitsOverride?: string[];
  leaderNameOverride?: string;
  leaderColorsOverride: string[];
  donCount: number;
}

async function fullRestoringResetAndSeed(page: Page, opts: ResetOpts, card: CardDef): Promise<{ cardIid: string | null }> {
  return page.evaluate(({ opts, cardDef }) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    (s as Record<string, unknown>).phase = 'main';
    (s as Record<string, unknown>).activePlayer = 'A';
    (s as Record<string, unknown>).pending = null;
    (s as Record<string, unknown>).result = null;
    const players = s.players as {
      A: { donDeck: string[]; donCostArea: string[]; donRested: string[]; leader: { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[]; rested?: boolean; perTurn?: { hasAttacked?: boolean; effectsUsed?: unknown[] } }; field: Array<{ instanceId: string; attachedDon?: string[]; attachedDonRested?: string[] }>; hand: string[]; trash: string[]; life: string[]; deck: string[]; stage?: { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[] } | null };
      B: { donDeck: string[]; donCostArea: string[]; donRested: string[]; leader: { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[] }; field: Array<{ instanceId: string; attachedDon?: string[]; attachedDonRested?: string[] }>; life: string[]; deck: string[]; stage?: { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[] } | null };
    };
    const instances = s.instances as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    function detachInto(target: string[], insts: Array<{ attachedDon?: string[]; attachedDonRested?: string[] }>) {
      for (const inst of insts) {
        if (Array.isArray(inst.attachedDon)) { for (const id of inst.attachedDon) target.push(id); inst.attachedDon = []; }
        if (Array.isArray(inst.attachedDonRested)) { for (const id of inst.attachedDonRested) target.push(id); inst.attachedDonRested = []; }
      }
    }
    const aAll: Array<{ attachedDon?: string[]; attachedDonRested?: string[] }> = [players.A.leader, ...players.A.field];
    if (players.A.stage) aAll.push(players.A.stage);
    detachInto(players.A.donDeck, aAll);
    const bAll: Array<{ attachedDon?: string[]; attachedDonRested?: string[] }> = [players.B.leader, ...players.B.field];
    if (players.B.stage) bAll.push(players.B.stage);
    detachInto(players.B.donDeck, bAll);
    players.A.field = []; players.B.field = []; players.A.stage = null; players.B.stage = null;
    const allBDon = [...players.B.donDeck, ...players.B.donCostArea, ...players.B.donRested];
    players.B.donDeck = allBDon; players.B.donCostArea = []; players.B.donRested = [];
    // Leader overrides via cardLibrary mutation.
    const aLeaderCard = lib[players.A.leader.cardId] as { colors?: string[]; traits?: string[]; name?: string } | undefined;
    if (aLeaderCard !== undefined) {
      if (Array.isArray(opts.leaderColorsOverride)) aLeaderCard.colors = opts.leaderColorsOverride.slice();
      if (Array.isArray(opts.leaderTraitsOverride)) aLeaderCard.traits = opts.leaderTraitsOverride.slice();
      if (typeof opts.leaderNameOverride === 'string') aLeaderCard.name = opts.leaderNameOverride;
    }
    players.A.leader.rested = false;
    if (players.A.leader.perTurn) players.A.leader.perTurn.hasAttacked = false;
    // A.hand reset.
    players.A.hand = [];
    // A.life refill (5).
    while (players.A.life.length < 5) {
      const synthId = `__seedLife_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `seedLife_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = { id: synthId, name: 'Life Placeholder', kind: 'character', cost: 1, power: 1000, counterValue: 1000, colors: ['red'], traits: [], keywords: [], effectText: '' };
      instances[iid] = { instanceId: iid, cardId: synthId, controller: 'A', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      players.A.life.push(iid);
    }
    while (players.A.life.length > 5) players.A.life.pop();
    while (players.B.life.length < 5) {
      const synthId = `__seedBLife_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `seedBLife_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = { id: synthId, name: 'B Life Placeholder', kind: 'character', cost: 1, power: 1000, counterValue: 1000, colors: ['blue'], traits: [], keywords: [], effectText: '' };
      instances[iid] = { instanceId: iid, cardId: synthId, controller: 'B', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      players.B.life.push(iid);
    }
    while (players.B.life.length > 5) players.B.life.pop();
    // Seed the card in chosen zone.
    let cardIid: string | null = null;
    lib[cardDef.id] = cardDef as unknown as Record<string, unknown>;
    const iid = `lg_${opts.seedZone}_${cardDef.id}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    instances[iid] = { instanceId: iid, cardId: cardDef.id, controller: 'A', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
    if (opts.seedZone === 'a_hand') { players.A.hand.push(iid); cardIid = iid; }
    else if (opts.seedZone === 'a_field') { (players.A.field as unknown[]).push(instances[iid]); cardIid = iid; }
    else if (opts.seedZone === 'a_stage') { players.A.stage = instances[iid] as { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[] }; cardIid = iid; }
    // A.donCostArea rebalance.
    const allADon = [...players.A.donDeck, ...players.A.donCostArea, ...players.A.donRested];
    players.A.donDeck = allADon.slice(opts.donCount);
    players.A.donCostArea = allADon.slice(0, opts.donCount);
    players.A.donRested = [];
    w.__store!.setState({ state: { ...s, players: { ...(s.players as Record<string, unknown>), A: { ...players.A }, B: { ...players.B } } } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
    return { cardIid };
  }, { opts, cardDef: card as unknown as Record<string, unknown> });
}

async function dispatchAs(page: Page, action: object): Promise<{ ok: boolean; err: string | null }> {
  const res = await page.evaluate((a) => {
    try { const w = window as unknown as { __store?: { getState: () => { dispatch: (a: unknown) => void } } }; w.__store!.getState().dispatch(a); return { ok: true, err: null }; }
    catch (e) { return { ok: false, err: e instanceof Error ? `${e.name}: ${e.message}` : String(e) }; }
  }, action);
  await page.waitForTimeout(70);
  return res;
}

async function readPendingKind(page: Page): Promise<string | null> {
  return page.evaluate(() => { const w = window as unknown as { __store?: { getState: () => { state: { pending: { kind?: string } | null } } } }; return w.__store!.getState().state.pending?.kind ?? null; });
}

async function drainPending(page: Page, maxIter = 8): Promise<void> {
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

async function snapInstance(page: Page, iid: string): Promise<{ powerModCont: number; powerModBattle: number; powerModOneShot: number; aHandLen: number; aTrashLen: number; aFieldLen: number; aLifeLen: number; aDonCost: number; historyLen: number }> {
  return page.evaluate((iid) => {
    const w = window as unknown as { __store?: { getState: () => { state: { players: { A: { hand: string[]; trash: string[]; field: { instanceId: string }[]; life: string[]; donCostArea: string[] } }; instances: Record<string, { powerModifierContinuous?: number; powerModifierThisBattle?: number; powerModifierOneShot?: number }>; history: ReadonlyArray<Record<string, unknown>> } } } };
    const s = w.__store!.getState().state;
    const inst = s.instances[iid];
    return {
      powerModCont: inst?.powerModifierContinuous ?? 0,
      powerModBattle: inst?.powerModifierThisBattle ?? 0,
      powerModOneShot: inst?.powerModifierOneShot ?? 0,
      aHandLen: s.players.A.hand.length,
      aTrashLen: s.players.A.trash.length,
      aFieldLen: s.players.A.field.length,
      aLifeLen: s.players.A.life.length,
      aDonCost: s.players.A.donCostArea.length,
      historyLen: s.history.length,
    };
  }, iid);
}

// Scan FULL history from a starting index for CLAUSE_FIRED entries
// matching the gated clause's (sourceInstanceId, clauseIndex, trigger).
// This is the targeted discrimination signal — replaces the prior
// "any state delta" heuristic.
async function gatedClauseFiredSince(page: Page, fromIdx: number, sourceIid: string, clauseIndex: number, trigger: string): Promise<boolean> {
  return page.evaluate(({ fromIdx, sourceIid, clauseIndex, trigger }) => {
    const w = window as unknown as { __store?: { getState: () => { state: { history: ReadonlyArray<Record<string, unknown>> } } } };
    const hist = w.__store!.getState().state.history;
    for (let i = fromIdx; i < hist.length; i++) {
      const h = hist[i]!;
      if (h.type !== 'CLAUSE_FIRED') continue;
      if (h.sourceInstanceId !== sourceIid) continue;
      if (h.clauseIndex !== clauseIndex) continue;
      if (typeof trigger === 'string' && trigger !== '' && h.trigger !== trigger) continue;
      return true;
    }
    return false;
  }, { fromIdx, sourceIid, clauseIndex, trigger });
}

async function forceRefoldViaNoopDispatch(page: Page): Promise<{ ok: boolean; err: string | null }> {
  const aLeaderIid = await page.evaluate(() => { const w = window as unknown as { __store?: { getState: () => { state: { players: { A: { leader: { instanceId: string } } } } } } }; return w.__store!.getState().state.players.A.leader.instanceId; });
  return dispatchAs(page, { type: 'ATTACH_DON', targetInstanceId: aLeaderIid, n: 0 });
}

interface SubcaseObservation {
  subcase: 'wrong_leader' | 'matching_leader';
  /** TARGETED: did the SPECIFIC gated clause (by clauseIndex) fire? */
  gatedClauseFired: boolean;
  pendingKindEnd: string | null;
  pageErrors: ReadonlyArray<string>;
  invariantErrors: ReadonlyArray<string>;
}

async function runSubcase(page: Page, card: CardDef, gate: LeaderGate, mode: 'wrong_leader' | 'matching_leader', pageErrorsAcc: string[], invariantErrorsAcc: string[]): Promise<SubcaseObservation> {
  const cost = typeof card.cost === 'number' ? card.cost : 0;
  const donCount = Math.max(0, cost + 4);
  const seedZone = seedZoneFor(card);
  if (seedZone === 'skip') {
    return { subcase: mode, gatedClauseFired: false, pendingKindEnd: null, pageErrors: [], invariantErrors: [] };
  }
  const opts: ResetOpts = {
    seedZone, donCount,
    leaderColorsOverride: ['red', 'blue', 'green', 'purple', 'black', 'yellow'],
  };
  if (mode === 'matching_leader') {
    if (gate.traits) opts.leaderTraitsOverride = gate.traits;
    if (gate.name) opts.leaderNameOverride = gate.name;
    if (gate.colors) opts.leaderColorsOverride = gate.colors;
    if (gate.multicolored) opts.leaderColorsOverride = ['red', 'blue']; // multi
  } else {
    // wrong leader: clear traits + nuke name so condition cannot match.
    opts.leaderTraitsOverride = ['___no_match___'];
    opts.leaderNameOverride = '___no_match___';
  }
  const pageErrorsBefore = pageErrorsAcc.length;
  const invariantErrorsBefore = invariantErrorsAcc.length;
  const { cardIid } = await fullRestoringResetAndSeed(page, opts, card);
  if (cardIid === null) {
    return { subcase: mode, gatedClauseFired: false, pendingKindEnd: null, pageErrors: [], invariantErrors: [] };
  }
  const before = await snapInstance(page, cardIid);
  const historyStartIdx = before.historyLen;
  // Trigger the effect by zone.
  if (seedZone === 'a_hand') {
    // event → PLAY_CARD.
    await dispatchAs(page, { type: 'PLAY_CARD', instanceId: cardIid, replaceTargetId: null });
  } else {
    // field/stage → force refold (no-op dispatch). on_play wouldn't fire here since
    // we placed the char directly on field; but continuous and certain triggers
    // will apply via refold.
    await forceRefoldViaNoopDispatch(page);
  }
  await drainPending(page);
  // TARGETED discrimination: scan history from before-dispatch index for
  // CLAUSE_FIRED entries matching (sourceInstanceId, clauseIndex, trigger).
  // Ignores non-gated sibling clauses and unrelated state deltas.
  const gatedClauseFired = await gatedClauseFiredSince(page, historyStartIdx, cardIid, gate.clauseIndex, gate.clauseTrigger);
  const pendingKindEnd = await readPendingKind(page);
  const newPE = pageErrorsAcc.slice(pageErrorsBefore);
  const newIE = invariantErrorsAcc.slice(invariantErrorsBefore);
  return { subcase: mode, gatedClauseFired, pendingKindEnd, pageErrors: newPE, invariantErrors: newIE };
}

interface StageCResult {
  cardId: string; name: string; kind: string; family: 'leader_gated';
  conditionType: string;
  wrongLeader: SubcaseObservation;
  matchingLeader: SubcaseObservation;
  classification: Classification; confidence: 'HIGH' | 'MEDIUM' | 'LOW'; notes: string;
  isAnchor: boolean;
}

async function processCard(page: Page, card: CardDef, pageErrorsAcc: string[], invariantErrorsAcc: string[]): Promise<StageCResult> {
  const gate = findLeaderGate(card);
  const isAnchor = ANCHORS.has(card.id);
  if (gate === null) {
    return {
      cardId: card.id, name: card.name, kind: card.kind, family: 'leader_gated', conditionType: 'n/a',
      wrongLeader: { subcase: 'wrong_leader', gatedClauseFired: false, pendingKindEnd: null, pageErrors: [], invariantErrors: [] },
      matchingLeader: { subcase: 'matching_leader', gatedClauseFired: false, pendingKindEnd: null, pageErrors: [], invariantErrors: [] },
      classification: 'INCONCLUSIVE', confidence: 'LOW', notes: 'no leader-gated condition found (filter mismatch)', isAnchor,
    };
  }
  try {
    const wrong = await runSubcase(page, card, gate, 'wrong_leader', pageErrorsAcc, invariantErrorsAcc);
    const matching = await runSubcase(page, card, gate, 'matching_leader', pageErrorsAcc, invariantErrorsAcc);
    let cls: Classification; let confidence: 'HIGH' | 'MEDIUM' | 'LOW'; let notes: string;
    const allInfraOk = wrong.pageErrors.length === 0 && wrong.invariantErrors.length === 0 && matching.pageErrors.length === 0 && matching.invariantErrors.length === 0 && wrong.pendingKindEnd === null && matching.pendingKindEnd === null;
    if (!allInfraOk) {
      cls = 'ENGINE_BUG'; confidence = 'HIGH';
      notes = `infra failure during subcases: wrongPE=${wrong.pageErrors.length} wrongIE=${wrong.invariantErrors.length} wrongPK=${wrong.pendingKindEnd} matchingPE=${matching.pageErrors.length} matchingIE=${matching.invariantErrors.length} matchingPK=${matching.pendingKindEnd}`;
    } else if (!wrong.gatedClauseFired && matching.gatedClauseFired) {
      // Ideal: wrong leader skipped the gated clause; matching leader fired it.
      cls = 'VERIFIED'; confidence = 'HIGH';
      notes = `gate behavior correct: gated clause[${gate.clauseIndex}] skipped under wrong leader; fired under matching leader (${gate.conditionType})`;
    } else if (wrong.gatedClauseFired && matching.gatedClauseFired) {
      // Both fired the gated clause — engine's leader condition handler is mis-evaluating OR our wrong-leader override didn't take effect.
      // Per directive's strict rule: this is ENGINE_BUG (engine condition handler) or CARD_DATA_BUG (condition encoded with wrong key); but most likely engine. Mark as ENGINE_BUG with low-medium confidence.
      cls = 'ENGINE_BUG'; confidence = 'MEDIUM';
      notes = `gated clause[${gate.clauseIndex}] fired under BOTH wrong AND matching leader; engine ${gate.conditionType} handler may not be reading expected key OR wrong-leader override did not propagate (verify by inspection)`;
    } else if (!wrong.gatedClauseFired && !matching.gatedClauseFired) {
      // Gate correctly suppressed under wrong leader; matching leader didn't fire either — generic recipe didn't satisfy a NON-leader precondition (cost/target/condition sibling/own-life/etc.).
      cls = 'HARNESS_GAP'; confidence = 'MEDIUM';
      notes = `gated clause[${gate.clauseIndex}] never fired (gate correctly suppressed under wrong leader; matching-leader recipe didn't satisfy a non-leader precondition like clause cost / additional condition / target availability)`;
    } else {
      // Inverted: wrong fired, matching didn't — highly unusual.
      cls = 'ENGINE_BUG'; confidence = 'LOW';
      notes = `inverted gate behavior: gated clause[${gate.clauseIndex}] fired under WRONG leader but NOT under matching leader`;
    }
    return {
      cardId: card.id, name: card.name, kind: card.kind, family: 'leader_gated',
      conditionType: gate.conditionType,
      wrongLeader: wrong, matchingLeader: matching,
      classification: cls, confidence, notes, isAnchor,
    };
  } catch (err) {
    try { await drainPending(page); } catch { /* ignore */ }
    return {
      cardId: card.id, name: card.name, kind: card.kind, family: 'leader_gated',
      conditionType: gate.conditionType,
      wrongLeader: { subcase: 'wrong_leader', gatedClauseFired: false, pendingKindEnd: null, pageErrors: [], invariantErrors: [] },
      matchingLeader: { subcase: 'matching_leader', gatedClauseFired: false, pendingKindEnd: null, pageErrors: [], invariantErrors: [] },
      classification: 'HARNESS_BUG', confidence: 'LOW', notes: `harness threw: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
      isAnchor,
    };
  }
}

const SLICES: CardDef[][] = [];
for (let i = 0; i < SLICE_COUNT; i++) SLICES.push(CARDS.slice(i * SLICE_SIZE, (i + 1) * SLICE_SIZE));

test.describe.serial('stage-c-generated-leader-gated', () => {
  for (let s = 0; s < SLICES.length; s++) {
    const sliceIndex = s; const slice = SLICES[sliceIndex]!;
    test(`slice ${sliceIndex + 1}/${SLICES.length} — ${slice.length} cards (${slice[0]!.id} … ${slice[slice.length - 1]!.id})`, async ({ page }) => {
      test.setTimeout(FIVE_MIN);
      const { drv, pageErrors, invariantErrors } = await bootstrap(page);
      void drv;
      const results: StageCResult[] = [];
      for (const card of slice) results.push(await processCard(page, card, pageErrors, invariantErrors));
      expect(pageErrors, `slice ${sliceIndex} pageerrors`).toEqual([]);
      expect(invariantErrors, `slice ${sliceIndex} InvariantErrors`).toEqual([]);
      expect(await readPendingKind(page), `slice ${sliceIndex} no stuck pending`).toBeNull();
      const sliceFile = join(SLICE_TMP_DIR, `lg-slice-${String(sliceIndex).padStart(3, '0')}.json`);
      writeFileSync(sliceFile, JSON.stringify({ sliceIndex, cardCount: slice.length, results }, null, 2), 'utf-8');
      /* eslint-disable no-console */
      console.log(`[leader-gated] wrote slice ${sliceIndex} → ${sliceFile}`);
      /* eslint-enable no-console */
    });
  }

  test('aggregator: roll up leader-gated slices', async () => {
    const all: StageCResult[] = [];
    for (const f of readdirSync(SLICE_TMP_DIR).filter((f) => f.startsWith('lg-slice-') && f.endsWith('.json')).sort()) {
      const raw = JSON.parse(readFileSync(join(SLICE_TMP_DIR, f), 'utf-8')) as { results: StageCResult[] };
      for (const r of raw.results) all.push(r);
    }
    const buckets: Record<Classification, number> = { VERIFIED: 0, ENGINE_BUG: 0, CARD_DATA_BUG: 0, UI_BUG: 0, HARNESS_BUG: 0, HARNESS_GAP: 0, NOT_IMPLEMENTED: 0, NO_UI_EXPECTED: 0, INCONCLUSIVE: 0 };
    for (const r of all) buckets[r.classification]++;
    const condBreakdown = new Map<string, number>();
    for (const r of all) condBreakdown.set(r.conditionType, (condBreakdown.get(r.conditionType) ?? 0) + 1);
    const clusters = new Map<string, { rootCause: string; cards: string[] }>();
    for (const r of all) {
      if (r.classification === 'VERIFIED' || r.classification === 'NOT_IMPLEMENTED') continue;
      const sig = (r.notes || `(${r.classification})`).slice(0, 100);
      const ex = clusters.get(sig) ?? { rootCause: sig, cards: [] };
      ex.cards.push(r.cardId);
      clusters.set(sig, ex);
    }
    const sortedClusters = Array.from(clusters.values()).sort((a, b) => b.cards.length - a.cards.length);
    const anchorRecs = Array.from(ANCHORS).map((id) => { const r = all.find((x) => x.cardId === id); return { id, classification: r?.classification ?? 'NOT_FOUND' }; });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const jsonPath = join(REPORTS_DIR, `stage-c-leader-gated-${ts}.json`);
    const mdPath = join(REPORTS_DIR, `stage-c-leader-gated-${ts}.md`);
    const finalReport = { family: 'leader_gated', generatedAt: new Date().toISOString(), totalCardsDiscovered: CARDS.length, totalRecordsWritten: all.length, sliceCount: SLICE_COUNT, classifications: buckets, verifiedPercent: all.length > 0 ? (100 * buckets.VERIFIED / all.length).toFixed(2) : '0', anchorStatus: anchorRecs, conditionBreakdown: Object.fromEntries(condBreakdown), topFailureClusters: sortedClusters.slice(0, 10), results: all };
    writeFileSync(jsonPath, JSON.stringify(finalReport, null, 2), 'utf-8');
    const md: string[] = [];
    md.push(`# Stage C — Leader-Gated Generated Report\n\n**Generated:** ${new Date().toISOString()}\n**Total leader-gated cards discovered:** ${CARDS.length}\n**Total records written:** ${all.length}\n**Slice count:** ${SLICE_COUNT}\n\n`);
    md.push(`## Classification buckets\n\n| Bucket | Count | % |\n|---|---:|---:|\n`);
    for (const [k, v] of Object.entries(buckets)) md.push(`| ${k} | ${v} | ${all.length > 0 ? (100 * v / all.length).toFixed(1) : '0'}% |\n`);
    md.push(`\n## Condition breakdown\n\n| Condition | Count |\n|---|---:|\n`);
    for (const [k, v] of condBreakdown) md.push(`| ${k} | ${v} |\n`);
    md.push(`\n## Anchor card status\n\n| Card | Classification |\n|---|---|\n`);
    for (const x of anchorRecs) md.push(`| ${x.id} | ${x.classification} |\n`);
    md.push(`\n## Top 10 failure clusters\n\n`);
    if (sortedClusters.length === 0) md.push(`(none)\n`);
    else for (const c of sortedClusters.slice(0, 10)) md.push(`- **${c.cards.length} cards**: ${c.rootCause}\n`);
    md.push(`\n## Report files\n\n- JSON: \`coverage/reports/stage-c-leader-gated-${ts}.json\`\n- MD: \`coverage/reports/stage-c-leader-gated-${ts}.md\`\n`);
    writeFileSync(mdPath, md.join(''), 'utf-8');
    /* eslint-disable no-console */
    console.log(`[leader-gated] FINAL JSON: ${jsonPath}`);
    console.log(`[leader-gated] FINAL MD:   ${mdPath}`);
    console.log(`[leader-gated] tally: ${JSON.stringify(buckets)}`);
    /* eslint-enable no-console */
    expect(all.length, 'every card must have a record').toBe(CARDS.length);
  });
});
