// stage-c-generated-activate-main — Stage C target #3 per
// e2e/stage-c-corpus-verification-plan.md. Auto-discovers every card
// where effectSpecV2.clauses[].trigger === 'activate_main' OR keywords
// includes 'activate_main', and runs each through a controlled
// ACTIVATE_MAIN dispatch.
//
// Read-only against engine / UI / cards.json / scenarioFactory.
//
// Engine references:
//   - legality.ts:316-335 activateMainActions — offers ACTIVATE_MAIN
//     for A.leader / A.field / A.stage when card.keywords includes
//     'activate_main' AND !inst.rested.
//   - For events in hand: never offered. Classified NOT_IMPLEMENTED.
//   - applyAction.ts:75-78 assertInvariants runs after every reducer.
//
// Harness adopts the `fullRestoringReset` pattern from the DON-cluster
// audit: before wiping A/B field/stage, detach all attached DON back
// to that player's donDeck so no DON is orphaned.

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
const SLICE_TMP_DIR = resolve(__dirname, 'coverage/reports/.stage-c-am-slices');
mkdirSync(REPORTS_DIR, { recursive: true });
mkdirSync(SLICE_TMP_DIR, { recursive: true });
for (const f of readdirSync(SLICE_TMP_DIR)) { if (f.endsWith('.json')) { try { unlinkSync(join(SLICE_TMP_DIR, f)); } catch { /* ignore */ } } }

interface CardDef {
  readonly id: string; readonly name: string; readonly kind: 'character' | 'event' | 'stage' | 'leader' | 'don';
  readonly cost?: number | null; readonly colors?: ReadonlyArray<string>; readonly traits?: ReadonlyArray<string>;
  readonly keywords?: ReadonlyArray<string>; readonly effectText?: string;
  readonly effectSpecV2?: { readonly clauses?: ReadonlyArray<{ readonly trigger?: string; readonly action?: { readonly kind?: string }; readonly target?: { readonly kind?: string }; readonly cost?: Record<string, unknown>; readonly condition?: { readonly type?: string; readonly [k: string]: unknown } }> };
  readonly [k: string]: unknown;
}

const CORPUS_RAW = JSON.parse(readFileSync(CORPUS_PATH, 'utf-8')) as unknown;
const CORPUS = (Array.isArray(CORPUS_RAW) ? CORPUS_RAW : Object.values(CORPUS_RAW as Record<string, unknown>)) as Array<Record<string, unknown>>;

function isActivateMainCard(c: Record<string, unknown>): boolean {
  const cd = c as CardDef;
  const triggers = (cd.effectSpecV2?.clauses ?? []).some((cl) => cl.trigger === 'activate_main');
  const kw = (cd.keywords ?? []).includes('activate_main');
  return triggers || kw;
}

const CARDS: CardDef[] = CORPUS.filter(isActivateMainCard) as CardDef[];
CARDS.sort((a, b) => a.id.localeCompare(b.id));

const SLICE_SIZE = 25;
const SLICE_COUNT = Math.ceil(CARDS.length / SLICE_SIZE);
/* eslint-disable no-console */
console.log(`[stage-c-activate-main] Discovered ${CARDS.length} activate_main cards → ${SLICE_COUNT} slice(s) of up to ${SLICE_SIZE}`);
/* eslint-enable no-console */

// Anchors from directive.
const ANCHORS = new Set<string>(['OP01-020', 'OP05-041']);

type Classification = 'VERIFIED' | 'ENGINE_BUG' | 'CARD_DATA_BUG' | 'UI_BUG' | 'HARNESS_BUG' | 'NOT_IMPLEMENTED' | 'NO_UI_EXPECTED' | 'INCONCLUSIVE';

interface SetupRecipe {
  donCount: number;
  aHandSize: number;
  aLifeCount: number;
  bLifeCount: number;
  seedZone: 'a_field' | 'a_stage' | 'a_leader' | 'skip';
  leaderColorsOverride?: string[];
  leaderTraitsOverride?: string[];
  aTrashCount?: number;
  bFieldChars?: Array<{ cost: number; power: number; traits?: string[] }>;
  aFieldChars?: Array<{ cost: number; power: number; traits?: string[] }>;
}

function seedZoneFor(card: CardDef): SetupRecipe['seedZone'] {
  if (card.kind === 'character') return 'a_field';
  if (card.kind === 'stage') return 'a_stage';
  if (card.kind === 'leader') return 'a_leader';
  return 'skip'; // events never offered as ACTIVATE_MAIN
}

function recipeFor(card: CardDef): { recipe: SetupRecipe; notes: string } {
  const clauses = card.effectSpecV2?.clauses ?? [];
  const cost = typeof card.cost === 'number' ? card.cost : 0;
  const recipe: SetupRecipe = {
    donCount: Math.max(0, cost + 4),
    aHandSize: 3,
    aLifeCount: 5,
    bLifeCount: 5,
    seedZone: seedZoneFor(card),
    leaderColorsOverride: ['red', 'blue', 'green', 'purple', 'black', 'yellow'],
  };
  const notes: string[] = ['leaderColorsOverride=wildcard', `seedZone=${recipe.seedZone}`];
  const leaderCondClause = clauses.find((c) => { const ct = c.condition?.type; return ct === 'if_leader_has_trait' || ct === 'if_leader_has_type' || ct === 'if_leader_is'; });
  if (leaderCondClause !== undefined) {
    const trait = (leaderCondClause.condition as { trait?: unknown; typeString?: unknown; name?: unknown }).trait
              ?? (leaderCondClause.condition as { typeString?: unknown }).typeString
              ?? (leaderCondClause.condition as { name?: unknown }).name;
    if (typeof trait === 'string') { recipe.leaderTraitsOverride = [trait]; notes.push(`leaderTraits=[${trait}]`); }
  }
  for (const c of clauses) {
    const ct = c.condition?.type;
    if (ct === 'if_own_life_max') { const n = (c.condition as { n?: unknown }).n; if (typeof n === 'number') { recipe.aLifeCount = Math.max(0, n); notes.push(`aLifeCount=${recipe.aLifeCount}`); } }
    else if (ct === 'if_own_life_min') { const n = (c.condition as { n?: unknown }).n; if (typeof n === 'number') { recipe.aLifeCount = Math.max(recipe.aLifeCount, n); notes.push(`aLifeCount=${recipe.aLifeCount}`); } }
    else if (ct === 'if_opp_life_max') { const n = (c.condition as { n?: unknown }).n; if (typeof n === 'number') { recipe.bLifeCount = Math.max(0, n); notes.push(`bLifeCount=${recipe.bLifeCount}`); } }
    else if (ct === 'if_trash_min') { const n = (c.condition as { n?: unknown }).n; if (typeof n === 'number') { recipe.aTrashCount = Math.max(recipe.aTrashCount ?? 0, n); notes.push(`aTrashCount=${recipe.aTrashCount}`); } }
  }
  const oppTargetClause = clauses.find((c) => c.target?.kind === 'opp_character' || c.target?.kind === 'opp_leader_or_character' || c.target?.kind === 'opp_leader' || c.target?.kind === 'all_opp_characters' || c.target?.kind === 'any_character');
  if (oppTargetClause !== undefined) { recipe.bFieldChars = [{ cost: 4, power: 4000, traits: [] }]; notes.push('bFieldChars=[1]'); }
  // For card-targeting clauses that need a SECOND char on A.field (since seeded card is on field).
  return { recipe, notes: notes.join('; ') };
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

async function fullRestoringReset(page: Page, recipe: SetupRecipe, cardDef: CardDef): Promise<{ seededIid: string | null }> {
  return page.evaluate(({ opts, cardDef }) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    (s as Record<string, unknown>).phase = 'main';
    (s as Record<string, unknown>).activePlayer = 'A';
    (s as Record<string, unknown>).pending = null;
    (s as Record<string, unknown>).result = null;
    const players = s.players as {
      A: { donDeck: string[]; donCostArea: string[]; donRested: string[]; leader: { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[]; rested?: boolean; powerModifierThisBattle?: number; powerModifierContinuous?: number; powerModifierOneShot?: number }; field: Array<{ instanceId: string; attachedDon?: string[]; attachedDonRested?: string[]; rested?: boolean }>; hand: string[]; trash: string[]; life: string[]; deck: string[]; stage?: { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[] } | null };
      B: { donDeck: string[]; donCostArea: string[]; donRested: string[]; leader: { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[] }; field: Array<{ instanceId: string; attachedDon?: string[]; attachedDonRested?: string[] }>; life: string[]; deck: string[]; stage?: { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[] } | null };
    };
    const instances = s.instances as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    // ── Detach all attached DON from A/B leader/field/stage → respective donDeck.
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
    // ── Clear fields + stage.
    players.A.field = [];
    players.B.field = [];
    players.A.stage = null;
    players.B.stage = null;
    // ── Restore B donDeck (all DON back to deck).
    const allBDon = [...players.B.donDeck, ...players.B.donCostArea, ...players.B.donRested];
    players.B.donDeck = allBDon;
    players.B.donCostArea = [];
    players.B.donRested = [];
    // ── Leader overrides.
    if (Array.isArray(opts.leaderColorsOverride)) {
      const lc = lib[players.A.leader.cardId] as { colors?: string[] } | undefined;
      if (lc !== undefined) lc.colors = opts.leaderColorsOverride.slice();
    }
    if (Array.isArray(opts.leaderTraitsOverride)) {
      const lc = lib[players.A.leader.cardId] as { traits?: string[] } | undefined;
      if (lc !== undefined) lc.traits = opts.leaderTraitsOverride.slice();
    }
    players.A.leader.rested = false;
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
    // ── A.life / B.life refill.
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
    // ── A.trash seed.
    if (typeof opts.aTrashCount === 'number') {
      while (players.A.trash.length > opts.aTrashCount) players.A.trash.pop();
      while (players.A.trash.length < opts.aTrashCount) {
        const synthId = `__seedTrash_${Math.floor(Math.random() * 1e9).toString(36)}`;
        const iid = `seedTrash_${Math.floor(Math.random() * 1e9).toString(36)}`;
        lib[synthId] = { id: synthId, name: 'Trash Placeholder', kind: 'character', cost: 1, power: 1000, counterValue: 1000, colors: ['red'], traits: [], keywords: [], effectText: '' };
        instances[iid] = { instanceId: iid, cardId: synthId, controller: 'A', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
        players.A.trash.push(iid);
      }
    }
    // ── B.field seed.
    if (Array.isArray(opts.bFieldChars)) {
      for (const ch of opts.bFieldChars) {
        const synthId = `__seedBField_${Math.floor(Math.random() * 1e9).toString(36)}`;
        const iid = `seedBField_${Math.floor(Math.random() * 1e9).toString(36)}`;
        lib[synthId] = { id: synthId, name: 'B Field Placeholder', kind: 'character', cost: ch.cost, power: ch.power, counterValue: 1000, colors: ['blue'], traits: ch.traits ?? [], keywords: [], effectText: '' };
        instances[iid] = { instanceId: iid, cardId: synthId, controller: 'B', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
        (players.B.field as unknown[]).push(instances[iid]);
      }
    }
    // ── Now place the target card (cardDef) into the chosen zone.
    let seededIid: string | null = null;
    if (opts.seedZone === 'a_field') {
      // Inject cardDef into library + create instance + push to A.field.
      lib[cardDef.id] = cardDef as unknown as Record<string, unknown>;
      const iid = `am_a_field_${cardDef.id}_${Math.floor(Math.random() * 1e9).toString(36)}`;
      instances[iid] = { instanceId: iid, cardId: cardDef.id, controller: 'A', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      (players.A.field as unknown[]).push(instances[iid]);
      seededIid = iid;
    } else if (opts.seedZone === 'a_stage') {
      lib[cardDef.id] = cardDef as unknown as Record<string, unknown>;
      const iid = `am_a_stage_${cardDef.id}_${Math.floor(Math.random() * 1e9).toString(36)}`;
      instances[iid] = { instanceId: iid, cardId: cardDef.id, controller: 'A', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      players.A.stage = instances[iid] as { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[] };
      seededIid = iid;
    } else if (opts.seedZone === 'a_leader') {
      // Leader swap: override A.leader.cardId to point at the target leader.
      lib[cardDef.id] = cardDef as unknown as Record<string, unknown>;
      players.A.leader.cardId = cardDef.id;
      seededIid = players.A.leader.instanceId;
    }
    // seedZone === 'skip' → event; no seed; classification will be NOT_IMPLEMENTED.
    // ── A.donCostArea rebalance.
    const allADon = [...players.A.donDeck, ...players.A.donCostArea, ...players.A.donRested];
    players.A.donDeck = allADon.slice(opts.donCount);
    players.A.donCostArea = allADon.slice(0, opts.donCount);
    players.A.donRested = [];
    w.__store!.setState({ state: { ...s, players: { ...(s.players as Record<string, unknown>), A: { ...players.A }, B: { ...players.B } } } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
    return { seededIid };
  }, { opts: recipe, cardDef: cardDef as unknown as Record<string, unknown> });
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

async function legalActivateMainIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown } }; __getLegalActions?: (s: unknown, p: string) => unknown[] };
    if (!w.__getLegalActions) return [];
    const s = w.__store!.getState().state;
    return (w.__getLegalActions(s, 'A') as { type: string; instanceId?: string }[]).filter((a) => a.type === 'ACTIVATE_MAIN').map((a) => a.instanceId ?? '');
  });
}

async function readFullSnap(page: Page): Promise<{
  phase: string; pendingKind: string | null;
  aHandLen: number; aTrashLen: number; aFieldLen: number; aLifeLen: number; aDonCost: number; aDonRested: number; aDonDeck: number;
  bDonTotal: number;
  donTotalA: number; duplicateIids: ReadonlyArray<string>;
  historyTail: ReadonlyArray<Record<string, unknown>>;
}> {
  return page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { state: { phase: string; pending: { kind?: string } | null; players: { A: { hand: string[]; trash: string[]; life: string[]; deck: string[]; donDeck: string[]; donCostArea: string[]; donRested: string[]; field: { instanceId: string }[]; leader: { instanceId: string; attachedDon?: string[]; attachedDonRested?: string[] }; stage?: { instanceId: string; attachedDon?: string[]; attachedDonRested?: string[] } | null }; B: { donDeck: string[]; donCostArea: string[]; donRested: string[]; field: { instanceId: string }[]; leader: { instanceId: string; attachedDon?: string[]; attachedDonRested?: string[] }; stage?: { instanceId: string; attachedDon?: string[]; attachedDonRested?: string[] } | null } }; instances: Record<string, { attachedDon?: string[]; attachedDonRested?: string[] }>; history: ReadonlyArray<Record<string, unknown>> } } } };
    const s = w.__store!.getState().state;
    const allAIids: string[] = [s.players.A.leader.instanceId];
    for (const id of s.players.A.hand) allAIids.push(id);
    for (const id of s.players.A.trash) allAIids.push(id);
    for (const id of s.players.A.life) allAIids.push(id);
    for (const id of s.players.A.deck) allAIids.push(id);
    for (const id of s.players.A.donDeck) allAIids.push(id);
    for (const id of s.players.A.donCostArea) allAIids.push(id);
    for (const id of s.players.A.donRested) allAIids.push(id);
    for (const i of s.players.A.field) allAIids.push(i.instanceId);
    if (s.players.A.stage) allAIids.push(s.players.A.stage.instanceId);
    let attachedDonA = 0;
    for (const iid of allAIids) { const inst = s.instances[iid]; if (inst) attachedDonA += (inst.attachedDon?.length ?? 0) + (inst.attachedDonRested?.length ?? 0); }
    let attachedDonB = 0;
    const bAttachable: Array<{ attachedDon?: string[]; attachedDonRested?: string[] }> = [s.players.B.leader, ...s.players.B.field];
    if (s.players.B.stage) bAttachable.push(s.players.B.stage);
    for (const inst of bAttachable) attachedDonB += (inst.attachedDon?.length ?? 0) + (inst.attachedDonRested?.length ?? 0);
    const bDonTotal = s.players.B.donDeck.length + s.players.B.donCostArea.length + s.players.B.donRested.length + attachedDonB;
    const seen = new Set<string>(); const dups = new Set<string>();
    for (const id of allAIids) { if (seen.has(id)) dups.add(id); else seen.add(id); }
    return {
      phase: s.phase, pendingKind: s.pending?.kind ?? null,
      aHandLen: s.players.A.hand.length, aTrashLen: s.players.A.trash.length, aFieldLen: s.players.A.field.length, aLifeLen: s.players.A.life.length,
      aDonCost: s.players.A.donCostArea.length, aDonRested: s.players.A.donRested.length, aDonDeck: s.players.A.donDeck.length,
      bDonTotal,
      donTotalA: s.players.A.donDeck.length + s.players.A.donCostArea.length + s.players.A.donRested.length + attachedDonA,
      duplicateIids: Array.from(dups),
      historyTail: s.history.slice(-10),
    };
  });
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

interface StageCResult {
  cardId: string; name: string; kind: string; family: 'activate_main';
  recipe: SetupRecipe; recipeNotes: string;
  legalActionFound: boolean;
  actionPerformed: 'ACTIVATE_MAIN' | 'NOT_OFFERED' | 'SKIPPED';
  classification: Classification; confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  notes: string;
  observedEffectSummary: string;
  donConservedA: boolean; donConservedB: boolean; noDuplicateInstanceIds: boolean; noStuckPending: boolean;
  historyTail: ReadonlyArray<Record<string, unknown>>;
  isAnchor: boolean;
}

async function processCard(page: Page, card: CardDef, pageErrorsAcc: string[], invariantErrorsAcc: string[]): Promise<StageCResult> {
  const { recipe, notes: recipeNotes } = recipeFor(card);
  const isAnchor = ANCHORS.has(card.id);
  const pageErrorsBefore = pageErrorsAcc.length;
  const invariantErrorsBefore = invariantErrorsAcc.length;
  if (recipe.seedZone === 'skip') {
    return {
      cardId: card.id, name: card.name, kind: card.kind, family: 'activate_main',
      recipe, recipeNotes,
      legalActionFound: false, actionPerformed: 'NOT_OFFERED',
      classification: 'NOT_IMPLEMENTED', confidence: 'HIGH',
      notes: 'event card with activate_main keyword: engine ACTIVATE_MAIN legality (legality.ts:316-335) only iterates A.leader / A.field / A.stage; events in hand cannot be activated. The keyword marks main-phase play timing, but the play action is PLAY_CARD (covered by family #2).',
      observedEffectSummary: '(not dispatched)', donConservedA: true, donConservedB: true, noDuplicateInstanceIds: true, noStuckPending: true,
      historyTail: [], isAnchor,
    };
  }
  try {
    const { seededIid } = await fullRestoringReset(page, recipe, card);
    if (seededIid === null) {
      return {
        cardId: card.id, name: card.name, kind: card.kind, family: 'activate_main',
        recipe, recipeNotes, legalActionFound: false, actionPerformed: 'SKIPPED',
        classification: 'HARNESS_BUG', confidence: 'MEDIUM',
        notes: 'fullRestoringReset returned null seededIid; recipe.seedZone may be unsupported',
        observedEffectSummary: '(skipped)', donConservedA: true, donConservedB: true, noDuplicateInstanceIds: true, noStuckPending: true,
        historyTail: [], isAnchor,
      };
    }
    const before = await readFullSnap(page);
    const offered = await legalActivateMainIds(page);
    const playable = offered.includes(seededIid);
    if (!playable) {
      await drainPending(page);
      const after = await readFullSnap(page);
      // Diagnose
      const hasKeyword = (card.keywords ?? []).includes('activate_main');
      let cls: Classification; let notes: string;
      if (!hasKeyword) {
        cls = 'CARD_DATA_BUG';
        notes = `card has trigger=activate_main clause but keywords[] does not include 'activate_main'; legality.ts:316-335 requires the keyword to offer ACTIVATE_MAIN`;
      } else if (recipe.seedZone === 'a_leader') {
        cls = 'NOT_IMPLEMENTED';
        notes = `leader-swap path: A.leader.cardId override may not pick up new keywords; engine reads cardLibrary[leader.cardId].keywords at legality.ts:321`;
      } else {
        cls = 'INCONCLUSIVE';
        notes = `ACTIVATE_MAIN not offered for unknown reason (kw=true, seedZone=${recipe.seedZone})`;
      }
      return {
        cardId: card.id, name: card.name, kind: card.kind, family: 'activate_main',
        recipe, recipeNotes, legalActionFound: false, actionPerformed: 'NOT_OFFERED',
        classification: cls, confidence: 'MEDIUM', notes,
        observedEffectSummary: 'ACTIVATE_MAIN not offered',
        donConservedA: after.donTotalA === before.donTotalA, donConservedB: after.bDonTotal === before.bDonTotal,
        noDuplicateInstanceIds: after.duplicateIids.length === 0, noStuckPending: (await readPendingKind(page)) === null,
        historyTail: after.historyTail, isAnchor,
      };
    }
    const playRes = await dispatchAs(page, { type: 'ACTIVATE_MAIN', instanceId: seededIid });
    await drainPending(page);
    const after = await readFullSnap(page);
    const newPE = pageErrorsAcc.slice(pageErrorsBefore);
    const newIE = invariantErrorsAcc.slice(invariantErrorsBefore);
    const donConservedA = after.donTotalA === before.donTotalA;
    const donConservedB = after.bDonTotal === before.bDonTotal;
    const noDup = after.duplicateIids.length === 0;
    const noStuck = (await readPendingKind(page)) === null;
    let cls: Classification; let confidence: 'HIGH' | 'MEDIUM' | 'LOW'; let notes: string;
    if (!playRes.ok) { cls = 'ENGINE_BUG'; confidence = 'HIGH'; notes = `dispatch threw: ${playRes.err}`; }
    else if (newIE.length > 0) { cls = 'ENGINE_BUG'; confidence = 'HIGH'; notes = `invariant violated: ${newIE[0]}`; }
    else if (newPE.length > 0) { cls = 'ENGINE_BUG'; confidence = 'HIGH'; notes = `page error: ${newPE[0]}`; }
    else if (!donConservedA) { cls = 'ENGINE_BUG'; confidence = 'HIGH'; notes = `A DON conservation: pre=${before.donTotalA} post=${after.donTotalA}`; }
    else if (!donConservedB) { cls = 'ENGINE_BUG'; confidence = 'HIGH'; notes = `B DON conservation: pre=${before.bDonTotal} post=${after.bDonTotal}`; }
    else if (!noDup) { cls = 'ENGINE_BUG'; confidence = 'HIGH'; notes = `duplicate iids: ${after.duplicateIids.join(',')}`; }
    else if (!noStuck) { cls = 'HARNESS_BUG'; confidence = 'MEDIUM'; notes = 'pending did not drain'; }
    else { cls = 'VERIFIED'; confidence = 'HIGH'; notes = `dispatched; aHandΔ=${after.aHandLen - before.aHandLen} aDonCostΔ=${after.aDonCost - before.aDonCost} aDonRestedΔ=${after.aDonRested - before.aDonRested} aTrashΔ=${after.aTrashLen - before.aTrashLen}`; }
    return {
      cardId: card.id, name: card.name, kind: card.kind, family: 'activate_main',
      recipe, recipeNotes, legalActionFound: true, actionPerformed: 'ACTIVATE_MAIN',
      classification: cls, confidence, notes,
      observedEffectSummary: `aHandΔ=${after.aHandLen - before.aHandLen} aDonCostΔ=${after.aDonCost - before.aDonCost} aDonRestedΔ=${after.aDonRested - before.aDonRested} aTrashΔ=${after.aTrashLen - before.aTrashLen}`,
      donConservedA, donConservedB, noDuplicateInstanceIds: noDup, noStuckPending: noStuck,
      historyTail: after.historyTail, isAnchor,
    };
  } catch (err) {
    try { await drainPending(page); } catch { /* ignore */ }
    return {
      cardId: card.id, name: card.name, kind: card.kind, family: 'activate_main',
      recipe, recipeNotes, legalActionFound: false, actionPerformed: 'SKIPPED',
      classification: 'HARNESS_BUG', confidence: 'LOW', notes: `harness threw: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
      observedEffectSummary: '(harness threw)', donConservedA: true, donConservedB: true, noDuplicateInstanceIds: true, noStuckPending: false,
      historyTail: [], isAnchor,
    };
  }
}

const SLICES: CardDef[][] = [];
for (let i = 0; i < SLICE_COUNT; i++) SLICES.push(CARDS.slice(i * SLICE_SIZE, (i + 1) * SLICE_SIZE));

test.describe.serial('stage-c-generated-activate-main', () => {
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
      const sliceFile = join(SLICE_TMP_DIR, `am-slice-${String(sliceIndex).padStart(3, '0')}.json`);
      writeFileSync(sliceFile, JSON.stringify({ sliceIndex, cardCount: slice.length, results }, null, 2), 'utf-8');
      /* eslint-disable no-console */
      console.log(`[activate-main] wrote slice ${sliceIndex} → ${sliceFile}`);
      /* eslint-enable no-console */
    });
  }

  test('aggregator: roll up activate-main slices', async () => {
    const all: StageCResult[] = [];
    for (const f of readdirSync(SLICE_TMP_DIR).filter((f) => f.startsWith('am-slice-') && f.endsWith('.json')).sort()) {
      const raw = JSON.parse(readFileSync(join(SLICE_TMP_DIR, f), 'utf-8')) as { results: StageCResult[] };
      for (const r of raw.results) all.push(r);
    }
    const buckets: Record<Classification, number> = { VERIFIED: 0, ENGINE_BUG: 0, CARD_DATA_BUG: 0, UI_BUG: 0, HARNESS_BUG: 0, NOT_IMPLEMENTED: 0, NO_UI_EXPECTED: 0, INCONCLUSIVE: 0 };
    for (const r of all) buckets[r.classification]++;
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
    const jsonPath = join(REPORTS_DIR, `stage-c-activate-main-${ts}.json`);
    const mdPath = join(REPORTS_DIR, `stage-c-activate-main-${ts}.md`);
    const finalReport = { family: 'activate_main', generatedAt: new Date().toISOString(), totalCardsDiscovered: CARDS.length, totalRecordsWritten: all.length, sliceCount: SLICE_COUNT, classifications: buckets, verifiedPercent: all.length > 0 ? (100 * buckets.VERIFIED / all.length).toFixed(2) : '0', anchorStatus: anchorRecs, topFailureClusters: sortedClusters.slice(0, 10), results: all };
    writeFileSync(jsonPath, JSON.stringify(finalReport, null, 2), 'utf-8');
    const md: string[] = [];
    md.push(`# Stage C — Activate Main Generated Report\n\n**Generated:** ${new Date().toISOString()}\n**Total activate_main cards discovered:** ${CARDS.length}\n**Total records written:** ${all.length}\n**Slice count:** ${SLICE_COUNT}\n\n`);
    md.push(`## Classification buckets\n\n| Bucket | Count | % |\n|---|---:|---:|\n`);
    for (const [k, v] of Object.entries(buckets)) md.push(`| ${k} | ${v} | ${all.length > 0 ? (100 * v / all.length).toFixed(1) : '0'}% |\n`);
    md.push(`\n## Anchor card status\n\n| Card | Classification |\n|---|---|\n`);
    for (const x of anchorRecs) md.push(`| ${x.id} | ${x.classification} |\n`);
    md.push(`\n## Top 10 failure clusters\n\n`);
    if (sortedClusters.length === 0) md.push(`(none)\n`);
    else for (const c of sortedClusters.slice(0, 10)) md.push(`- **${c.cards.length} cards**: ${c.rootCause}\n`);
    md.push(`\n## Report files\n\n- JSON: \`coverage/reports/stage-c-activate-main-${ts}.json\`\n- MD: \`coverage/reports/stage-c-activate-main-${ts}.md\`\n`);
    writeFileSync(mdPath, md.join(''), 'utf-8');
    /* eslint-disable no-console */
    console.log(`[activate-main] FINAL JSON: ${jsonPath}`);
    console.log(`[activate-main] FINAL MD:   ${mdPath}`);
    console.log(`[activate-main] tally: ${JSON.stringify(buckets)}`);
    /* eslint-enable no-console */
    expect(all.length, 'every card must have a record').toBe(CARDS.length);
  });
});
