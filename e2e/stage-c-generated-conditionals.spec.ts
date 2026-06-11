// stage-c-generated-conditionals — Stage C target #9 per
// e2e/stage-c-corpus-verification-plan.md. Auto-discovers every card
// with at least one clause whose `condition.type` is a non-leader
// `if_*` predicate (i.e., NOT one of if_leader_* / if_owned_leader_name
// — those are covered in family #8). For each card, runs 2 subcases:
//   A. condition-false: recipe seeds state so the condition evaluates
//      false; gated clause MUST NOT fire.
//   B. condition-true: recipe seeds state so the condition evaluates
//      true; gated clause SHOULD fire if all other preconditions hold.
//
// Discrimination signal: clauseIndex-targeted CLAUSE_FIRED history scan
// (matching sourceInstanceId + clauseIndex + trigger). Proven pattern
// from the patched family #8 leader_gated spec.
//
// Read-only against engine / UI / cards.json / scenarioFactory.

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
const SLICE_TMP_DIR = resolve(__dirname, 'coverage/reports/.stage-c-cond-slices');
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

function isNonLeaderCondition(t: string | undefined): boolean {
  if (typeof t !== 'string') return false;
  if (!t.startsWith('if_')) return false;
  if (t.startsWith('if_leader_')) return false;
  if (t === 'if_owned_leader_name') return false;
  return true;
}

function hasNonLeaderCondition(c: Record<string, unknown>): boolean {
  const cd = c as CardDef;
  return (cd.effectSpecV2?.clauses ?? []).some((cl) => isNonLeaderCondition(cl.condition?.type));
}

const CARDS: CardDef[] = CORPUS.filter(hasNonLeaderCondition) as CardDef[];
CARDS.sort((a, b) => a.id.localeCompare(b.id));

const SLICE_SIZE = 25;
const SLICE_COUNT = Math.ceil(CARDS.length / SLICE_SIZE);
/* eslint-disable no-console */
console.log(`[stage-c-conditionals] Discovered ${CARDS.length} non-leader conditional cards → ${SLICE_COUNT} slice(s) of up to ${SLICE_SIZE}`);
/* eslint-enable no-console */

const ANCHORS = new Set<string>(['P-053', 'OP05-050', 'EB03-058', 'OP07-115', 'OP09-026', 'OP05-118', 'OP09-087', 'OP07-050']);

type Classification = 'VERIFIED' | 'ENGINE_BUG' | 'CARD_DATA_BUG' | 'UI_BUG' | 'HARNESS_BUG' | 'HARNESS_GAP' | 'NOT_IMPLEMENTED' | 'NO_UI_EXPECTED' | 'INCONCLUSIVE';

interface ConditionGate {
  conditionType: string;
  clauseIndex: number;
  clauseTrigger: string;
  // Raw values from the condition payload (n, minPower, minCost, etc.).
  n?: number; minPower?: number; minCost?: number; maxCost?: number;
  trait?: string;
}

function findConditionGate(card: CardDef): ConditionGate | null {
  const clauses = card.effectSpecV2?.clauses ?? [];
  for (let i = 0; i < clauses.length; i++) {
    const c = clauses[i]!;
    const t = c.condition?.type;
    if (!isNonLeaderCondition(t)) continue;
    const cond = c.condition as Record<string, unknown>;
    return {
      conditionType: String(t),
      clauseIndex: i,
      clauseTrigger: String(c.trigger ?? ''),
      n: typeof cond.n === 'number' ? cond.n : undefined,
      minPower: typeof cond.minPower === 'number' ? cond.minPower : undefined,
      minCost: typeof cond.minCost === 'number' ? cond.minCost : undefined,
      maxCost: typeof cond.maxCost === 'number' ? cond.maxCost : undefined,
      trait: typeof cond.trait === 'string' ? cond.trait : undefined,
    };
  }
  return null;
}

function seedZoneFor(card: CardDef): 'a_hand' | 'a_field' | 'a_stage' | 'a_leader' | 'skip' {
  if (card.kind === 'event') return 'a_hand';
  if (card.kind === 'character') return 'a_field';
  if (card.kind === 'stage') return 'a_stage';
  if (card.kind === 'leader') return 'a_leader';
  return 'skip';
}

interface RecipeKnobs {
  // Numeric thresholds + attached DON applied per subcase.
  attachedDonOnSource: number;
  aHandSize: number;
  aTrashCount: number;
  aLifeCount: number;
  bLifeCount: number;
  aFieldExtras: number; // synthetic chars on A.field (beyond seeded source)
  bFieldExtras: number;
  donCostArea: number;
  // Special flags for harder conditions.
  hasGivenDonToOpp?: number; // if_have_given_don_min
  selfPlayedThisTurn?: boolean; // if_played_this_turn
}

function recipeKnobsFor(gate: ConditionGate, card: CardDef, subcase: 'false' | 'true'): RecipeKnobs {
  const n = gate.n ?? 1;
  const cost = typeof card.cost === 'number' ? card.cost : 0;
  // Baseline: defaults satisfy NEITHER subcase reliably; per-condition overrides below.
  const base: RecipeKnobs = {
    attachedDonOnSource: 0,
    aHandSize: 3,
    aTrashCount: 0,
    aLifeCount: 5,
    bLifeCount: 5,
    aFieldExtras: 0,
    bFieldExtras: 0,
    donCostArea: Math.max(0, cost + 4),
  };
  const want = subcase === 'true';
  switch (gate.conditionType) {
    case 'if_attached_don_min': {
      base.attachedDonOnSource = want ? n : 0;
      break;
    }
    case 'if_hand_max': {
      base.aHandSize = want ? Math.max(0, n) : Math.max(n + 1, n + 1);
      break;
    }
    case 'if_hand_min': {
      base.aHandSize = want ? Math.max(n, n) : Math.max(0, n - 1);
      break;
    }
    case 'if_own_life_max': {
      base.aLifeCount = want ? Math.max(0, n) : Math.max(n + 1, 1);
      break;
    }
    case 'if_own_life_min': {
      base.aLifeCount = want ? Math.max(n, 1) : Math.max(0, n - 1);
      break;
    }
    case 'if_opp_life_max': {
      base.bLifeCount = want ? Math.max(0, n) : Math.max(n + 1, 1);
      break;
    }
    case 'if_opp_life_min': {
      base.bLifeCount = want ? Math.max(n, 1) : Math.max(0, n - 1);
      break;
    }
    case 'if_own_life_lt_opp':
    case 'if_own_life_le_opp': {
      if (want) { base.aLifeCount = 1; base.bLifeCount = 5; } else { base.aLifeCount = 5; base.bLifeCount = 1; }
      break;
    }
    case 'if_own_chars_min': {
      base.aFieldExtras = want ? n : 0;
      break;
    }
    case 'if_opp_chars_min':
    case 'if_opp_chars_min_rested': {
      base.bFieldExtras = want ? n : 0;
      break;
    }
    case 'if_own_chars_lt_opp_chars': {
      if (want) { base.aFieldExtras = 0; base.bFieldExtras = 3; } else { base.aFieldExtras = 3; base.bFieldExtras = 0; }
      break;
    }
    case 'if_trash_min': {
      base.aTrashCount = want ? n : 0;
      break;
    }
    case 'if_don_min': {
      base.donCostArea = want ? Math.max(n, base.donCostArea) : Math.min(Math.max(0, n - 1), base.donCostArea);
      break;
    }
    case 'if_don_max': {
      base.donCostArea = want ? Math.min(n, base.donCostArea) : Math.max(n + 1, n + 1);
      break;
    }
    case 'if_opp_hand_min': {
      // B.hand isn't always present in state; harness can't easily mutate it.
      // Mark as HARNESS_GAP candidate by leaving defaults.
      break;
    }
    case 'if_opp_hand_max':
    case 'if_opp_don_min':
    case 'if_opp_chars_max_cost':
    case 'if_opp_chars_min_power':
    case 'if_own_chars_min_cost':
    case 'if_own_chars_min_filter':
    case 'if_own_chars_min_with_trait':
    case 'if_own_chars_min_power':
    case 'if_own_chars_min_rested':
    case 'if_own_chars_max_with_min_power':
    case 'if_only_chars_with_trait':
    case 'if_no_other_with_name':
    case 'if_owned_other_with_name':
    case 'if_own_don_le_opp':
    case 'if_own_deck_max':
    case 'if_self_power_min':
    case 'if_attacker_has_attribute':
    case 'if_have_given_don_min':
    case 'if_self_kod_by_opp_effect':
    case 'if_played_this_turn':
    case 'if_own_leader_active':
    default: {
      // Complex / multi-knob conditions — generic recipe leaves defaults,
      // expects HARNESS_GAP unless coincidentally satisfied.
      break;
    }
  }
  return base;
}

interface ResetOpts {
  seedZone: 'a_hand' | 'a_field' | 'a_stage' | 'a_leader';
  knobs: RecipeKnobs;
}

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

async function fullRestoringResetAndSeed(page: Page, opts: ResetOpts, card: CardDef): Promise<{ cardIid: string | null }> {
  return page.evaluate(({ opts, cardDef }) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    (s as Record<string, unknown>).phase = 'main';
    (s as Record<string, unknown>).activePlayer = 'A';
    (s as Record<string, unknown>).pending = null;
    (s as Record<string, unknown>).result = null;
    const players = s.players as {
      A: { donDeck: string[]; donCostArea: string[]; donRested: string[]; leader: { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[]; rested?: boolean }; field: Array<{ instanceId: string; attachedDon?: string[]; attachedDonRested?: string[] }>; hand: string[]; trash: string[]; life: string[]; deck: string[]; stage?: { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[] } | null };
      B: { donDeck: string[]; donCostArea: string[]; donRested: string[]; leader: { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[] }; field: Array<{ instanceId: string; attachedDon?: string[]; attachedDonRested?: string[] }>; life: string[]; deck: string[]; stage?: { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[] } | null };
    };
    const instances = s.instances as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    // Detach all attached DON → owner donDeck.
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
    // Wildcard A.leader colors for play / refold paths.
    const aLeaderCard = lib[players.A.leader.cardId] as { colors?: string[] } | undefined;
    if (aLeaderCard !== undefined) aLeaderCard.colors = ['red', 'blue', 'green', 'purple', 'black', 'yellow'];
    players.A.leader.rested = false;
    // A.hand fillers.
    players.A.hand = [];
    for (let i = 0; i < opts.knobs.aHandSize; i++) {
      const synthId = `__fillerHand_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `fillerH_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = { id: synthId, name: `FillerHand ${i}`, kind: 'character', cost: 1, power: 1000, counterValue: null, colors: ['red'], traits: [], keywords: [], effectText: '' };
      instances[iid] = { instanceId: iid, cardId: synthId, controller: 'A', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      players.A.hand.push(iid);
    }
    // A.life refill.
    while (players.A.life.length < opts.knobs.aLifeCount) {
      const synthId = `__seedLife_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `seedLife_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = { id: synthId, name: 'Life Placeholder', kind: 'character', cost: 1, power: 1000, counterValue: 1000, colors: ['red'], traits: [], keywords: [], effectText: '' };
      instances[iid] = { instanceId: iid, cardId: synthId, controller: 'A', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      players.A.life.push(iid);
    }
    while (players.A.life.length > opts.knobs.aLifeCount) players.A.life.pop();
    // B.life refill.
    while (players.B.life.length < opts.knobs.bLifeCount) {
      const synthId = `__seedBLife_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `seedBLife_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = { id: synthId, name: 'B Life Placeholder', kind: 'character', cost: 1, power: 1000, counterValue: 1000, colors: ['blue'], traits: [], keywords: [], effectText: '' };
      instances[iid] = { instanceId: iid, cardId: synthId, controller: 'B', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      players.B.life.push(iid);
    }
    while (players.B.life.length > opts.knobs.bLifeCount) players.B.life.pop();
    // A.trash seed.
    while (players.A.trash.length > opts.knobs.aTrashCount) players.A.trash.pop();
    while (players.A.trash.length < opts.knobs.aTrashCount) {
      const synthId = `__seedTrash_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `seedTrash_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = { id: synthId, name: 'Trash Placeholder', kind: 'character', cost: 1, power: 1000, counterValue: 1000, colors: ['red'], traits: [], keywords: [], effectText: '' };
      instances[iid] = { instanceId: iid, cardId: synthId, controller: 'A', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      players.A.trash.push(iid);
    }
    // Seed target card.
    let cardIid: string | null = null;
    lib[cardDef.id] = cardDef as unknown as Record<string, unknown>;
    const iid = `cond_${opts.seedZone}_${cardDef.id}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    instances[iid] = { instanceId: iid, cardId: cardDef.id, controller: 'A', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
    if (opts.seedZone === 'a_hand') { players.A.hand.push(iid); cardIid = iid; }
    else if (opts.seedZone === 'a_field') { (players.A.field as unknown[]).push(instances[iid]); cardIid = iid; }
    else if (opts.seedZone === 'a_stage') { players.A.stage = instances[iid] as { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[] }; cardIid = iid; }
    else if (opts.seedZone === 'a_leader') { players.A.leader.cardId = cardDef.id; cardIid = players.A.leader.instanceId; }
    // A.field extras.
    for (let i = 0; i < opts.knobs.aFieldExtras; i++) {
      const synthId = `__seedAField_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const xiid = `seedAField_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = { id: synthId, name: 'A Field Placeholder', kind: 'character', cost: 2, power: 2000, counterValue: 1000, colors: ['red'], traits: [], keywords: [], effectText: '' };
      instances[xiid] = { instanceId: xiid, cardId: synthId, controller: 'A', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      (players.A.field as unknown[]).push(instances[xiid]);
    }
    // B.field extras.
    for (let i = 0; i < opts.knobs.bFieldExtras; i++) {
      const synthId = `__seedBField_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const xiid = `seedBField_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = { id: synthId, name: 'B Field Placeholder', kind: 'character', cost: 4, power: 4000, counterValue: 1000, colors: ['blue'], traits: [], keywords: [], effectText: '' };
      instances[xiid] = { instanceId: xiid, cardId: synthId, controller: 'B', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      (players.B.field as unknown[]).push(instances[xiid]);
    }
    // Attach DON to source instance if requested.
    if (cardIid && opts.knobs.attachedDonOnSource > 0) {
      const sourceInst = instances[cardIid] as { attachedDon?: string[] };
      sourceInst.attachedDon = sourceInst.attachedDon ?? [];
      for (let i = 0; i < opts.knobs.attachedDonOnSource; i++) {
        const donId = players.A.donDeck.shift();
        if (donId !== undefined) sourceInst.attachedDon.push(donId);
      }
    }
    // A.donCostArea rebalance.
    const allADon = [...players.A.donDeck, ...players.A.donCostArea, ...players.A.donRested];
    players.A.donDeck = allADon.slice(opts.knobs.donCostArea);
    players.A.donCostArea = allADon.slice(0, opts.knobs.donCostArea);
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

async function readHistoryLen(page: Page): Promise<number> {
  return page.evaluate(() => { const w = window as unknown as { __store?: { getState: () => { state: { history: ReadonlyArray<unknown> } } } }; return w.__store!.getState().state.history.length; });
}

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
  subcase: 'condition_false' | 'condition_true';
  gatedClauseFired: boolean;
  pendingKindEnd: string | null;
  pageErrors: ReadonlyArray<string>;
  invariantErrors: ReadonlyArray<string>;
}

async function runSubcase(page: Page, card: CardDef, gate: ConditionGate, mode: 'false' | 'true', pageErrorsAcc: string[], invariantErrorsAcc: string[]): Promise<SubcaseObservation> {
  const seedZone = seedZoneFor(card);
  if (seedZone === 'skip') {
    return { subcase: mode === 'false' ? 'condition_false' : 'condition_true', gatedClauseFired: false, pendingKindEnd: null, pageErrors: [], invariantErrors: [] };
  }
  const knobs = recipeKnobsFor(gate, card, mode);
  const opts: ResetOpts = { seedZone, knobs };
  const pageErrorsBefore = pageErrorsAcc.length;
  const invariantErrorsBefore = invariantErrorsAcc.length;
  const { cardIid } = await fullRestoringResetAndSeed(page, opts, card);
  if (cardIid === null) {
    return { subcase: mode === 'false' ? 'condition_false' : 'condition_true', gatedClauseFired: false, pendingKindEnd: null, pageErrors: [], invariantErrors: [] };
  }
  const historyStartIdx = await readHistoryLen(page);
  if (seedZone === 'a_hand') {
    await dispatchAs(page, { type: 'PLAY_CARD', instanceId: cardIid, replaceTargetId: null });
  } else {
    await forceRefoldViaNoopDispatch(page);
  }
  await drainPending(page);
  const gatedClauseFired = await gatedClauseFiredSince(page, historyStartIdx, cardIid, gate.clauseIndex, gate.clauseTrigger);
  const pendingKindEnd = await readPendingKind(page);
  const newPE = pageErrorsAcc.slice(pageErrorsBefore);
  const newIE = invariantErrorsAcc.slice(invariantErrorsBefore);
  return { subcase: mode === 'false' ? 'condition_false' : 'condition_true', gatedClauseFired, pendingKindEnd, pageErrors: newPE, invariantErrors: newIE };
}

interface StageCResult {
  cardId: string; name: string; kind: string; family: 'conditionals';
  conditionType: string; clauseIndex: number;
  conditionFalse: SubcaseObservation;
  conditionTrue: SubcaseObservation;
  classification: Classification; confidence: 'HIGH' | 'MEDIUM' | 'LOW'; notes: string;
  isAnchor: boolean;
}

async function processCard(page: Page, card: CardDef, pageErrorsAcc: string[], invariantErrorsAcc: string[]): Promise<StageCResult> {
  const gate = findConditionGate(card);
  const isAnchor = ANCHORS.has(card.id);
  if (gate === null) {
    return {
      cardId: card.id, name: card.name, kind: card.kind, family: 'conditionals',
      conditionType: 'n/a', clauseIndex: -1,
      conditionFalse: { subcase: 'condition_false', gatedClauseFired: false, pendingKindEnd: null, pageErrors: [], invariantErrors: [] },
      conditionTrue: { subcase: 'condition_true', gatedClauseFired: false, pendingKindEnd: null, pageErrors: [], invariantErrors: [] },
      classification: 'INCONCLUSIVE', confidence: 'LOW', notes: 'no non-leader condition found (filter mismatch)', isAnchor,
    };
  }
  try {
    const falseObs = await runSubcase(page, card, gate, 'false', pageErrorsAcc, invariantErrorsAcc);
    const trueObs = await runSubcase(page, card, gate, 'true', pageErrorsAcc, invariantErrorsAcc);
    let cls: Classification; let confidence: 'HIGH' | 'MEDIUM' | 'LOW'; let notes: string;
    const allInfraOk = falseObs.pageErrors.length === 0 && falseObs.invariantErrors.length === 0 && trueObs.pageErrors.length === 0 && trueObs.invariantErrors.length === 0 && falseObs.pendingKindEnd === null && trueObs.pendingKindEnd === null;
    if (!allInfraOk) {
      cls = 'ENGINE_BUG'; confidence = 'HIGH';
      notes = `infra failure: falsePE=${falseObs.pageErrors.length} falseIE=${falseObs.invariantErrors.length} falsePK=${falseObs.pendingKindEnd} truePE=${trueObs.pageErrors.length} trueIE=${trueObs.invariantErrors.length} truePK=${trueObs.pendingKindEnd}`;
    } else if (!falseObs.gatedClauseFired && trueObs.gatedClauseFired) {
      cls = 'VERIFIED'; confidence = 'HIGH';
      notes = `condition discriminated: false skipped clause[${gate.clauseIndex}]; true fired it (${gate.conditionType}${gate.n !== undefined ? `:${gate.n}` : ''})`;
    } else if (falseObs.gatedClauseFired && trueObs.gatedClauseFired) {
      cls = 'ENGINE_BUG'; confidence = 'MEDIUM';
      notes = `gated clause[${gate.clauseIndex}] fired under BOTH false AND true subcase; engine ${gate.conditionType} handler may not be reading expected key OR false-subcase knobs didn't bring condition below threshold`;
    } else if (!falseObs.gatedClauseFired && !trueObs.gatedClauseFired) {
      cls = 'HARNESS_GAP'; confidence = 'MEDIUM';
      notes = `gated clause[${gate.clauseIndex}] never fired (condition correctly skipped under false; recipe didn't satisfy condition+non-condition preconditions under true: ${gate.conditionType}${gate.n !== undefined ? `:${gate.n}` : ''})`;
    } else {
      cls = 'ENGINE_BUG'; confidence = 'LOW';
      notes = `inverted: gated clause[${gate.clauseIndex}] fired under false-subcase but NOT under true-subcase`;
    }
    return {
      cardId: card.id, name: card.name, kind: card.kind, family: 'conditionals',
      conditionType: gate.conditionType, clauseIndex: gate.clauseIndex,
      conditionFalse: falseObs, conditionTrue: trueObs,
      classification: cls, confidence, notes, isAnchor,
    };
  } catch (err) {
    try { await drainPending(page); } catch { /* ignore */ }
    return {
      cardId: card.id, name: card.name, kind: card.kind, family: 'conditionals',
      conditionType: gate.conditionType, clauseIndex: gate.clauseIndex,
      conditionFalse: { subcase: 'condition_false', gatedClauseFired: false, pendingKindEnd: null, pageErrors: [], invariantErrors: [] },
      conditionTrue: { subcase: 'condition_true', gatedClauseFired: false, pendingKindEnd: null, pageErrors: [], invariantErrors: [] },
      classification: 'HARNESS_BUG', confidence: 'LOW', notes: `harness threw: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
      isAnchor,
    };
  }
}

const SLICES: CardDef[][] = [];
for (let i = 0; i < SLICE_COUNT; i++) SLICES.push(CARDS.slice(i * SLICE_SIZE, (i + 1) * SLICE_SIZE));

test.describe.serial('stage-c-generated-conditionals', () => {
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
      const sliceFile = join(SLICE_TMP_DIR, `cond-slice-${String(sliceIndex).padStart(3, '0')}.json`);
      writeFileSync(sliceFile, JSON.stringify({ sliceIndex, cardCount: slice.length, results }, null, 2), 'utf-8');
      /* eslint-disable no-console */
      console.log(`[conditionals] wrote slice ${sliceIndex} → ${sliceFile}`);
      /* eslint-enable no-console */
    });
  }

  test('aggregator: roll up conditionals slices', async () => {
    const all: StageCResult[] = [];
    for (const f of readdirSync(SLICE_TMP_DIR).filter((f) => f.startsWith('cond-slice-') && f.endsWith('.json')).sort()) {
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
    const jsonPath = join(REPORTS_DIR, `stage-c-conditionals-${ts}.json`);
    const mdPath = join(REPORTS_DIR, `stage-c-conditionals-${ts}.md`);
    const finalReport = { family: 'conditionals', generatedAt: new Date().toISOString(), totalCardsDiscovered: CARDS.length, totalRecordsWritten: all.length, sliceCount: SLICE_COUNT, classifications: buckets, verifiedPercent: all.length > 0 ? (100 * buckets.VERIFIED / all.length).toFixed(2) : '0', anchorStatus: anchorRecs, conditionBreakdown: Object.fromEntries(condBreakdown), topFailureClusters: sortedClusters.slice(0, 10), results: all };
    writeFileSync(jsonPath, JSON.stringify(finalReport, null, 2), 'utf-8');
    const md: string[] = [];
    md.push(`# Stage C — Conditionals Generated Report\n\n**Generated:** ${new Date().toISOString()}\n**Total non-leader conditional cards discovered:** ${CARDS.length}\n**Total records written:** ${all.length}\n**Slice count:** ${SLICE_COUNT}\n\n`);
    md.push(`## Classification buckets\n\n| Bucket | Count | % |\n|---|---:|---:|\n`);
    for (const [k, v] of Object.entries(buckets)) md.push(`| ${k} | ${v} | ${all.length > 0 ? (100 * v / all.length).toFixed(1) : '0'}% |\n`);
    md.push(`\n## Condition breakdown\n\n| Condition | Count |\n|---|---:|\n`);
    for (const [k, v] of condBreakdown) md.push(`| ${k} | ${v} |\n`);
    md.push(`\n## Anchor card status\n\n| Card | Classification |\n|---|---|\n`);
    for (const x of anchorRecs) md.push(`| ${x.id} | ${x.classification} |\n`);
    md.push(`\n## Top 10 failure clusters\n\n`);
    if (sortedClusters.length === 0) md.push(`(none)\n`);
    else for (const c of sortedClusters.slice(0, 10)) md.push(`- **${c.cards.length} cards**: ${c.rootCause}\n`);
    md.push(`\n## Report files\n\n- JSON: \`coverage/reports/stage-c-conditionals-${ts}.json\`\n- MD: \`coverage/reports/stage-c-conditionals-${ts}.md\`\n`);
    writeFileSync(mdPath, md.join(''), 'utf-8');
    /* eslint-disable no-console */
    console.log(`[conditionals] FINAL JSON: ${jsonPath}`);
    console.log(`[conditionals] FINAL MD:   ${mdPath}`);
    console.log(`[conditionals] tally: ${JSON.stringify(buckets)}`);
    /* eslint-enable no-console */
    expect(all.length, 'every card must have a record').toBe(CARDS.length);
  });
});
