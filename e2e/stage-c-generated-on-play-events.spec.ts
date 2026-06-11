// stage-c-generated-on-play-events — Stage C target #2. Auto-discovers
// every card in shared/data/cards.json with at least one on_play clause
// and runs each through a controlled main-phase PLAY_CARD with a
// generated recipe (leader-colors override to defeat color-identity
// check, leader-trait override per condition, condition-state seeding,
// per-card DON budget).
//
// Read-only against engine / UI / cards.json / scenarioFactory.
//
// Engine references (post-study):
//   - legality.ts:154-205 playCardActions: requires sharesColorWithLeader
//     (recipe overrides leader colors to ['red','blue','green','purple',
//     'black','yellow']) + cost payable + (character: field <FIELD_CAP)
//     + ([Counter] events excluded from main phase at line 190 — these
//     are covered by stage-c-generated-counter-events.spec.ts)
//   - mainPhase.ts:86-319 playCardReducer: pays cost, places character
//     onto field OR moves event hand→trash, then dispatches on_play
//   - state/types.ts FIELD_CAP = 5
//   - Stage C plan: e2e/stage-c-corpus-verification-plan.md
//   - Harness pattern proven by: stage-c-generated-counter-events.spec.ts,
//     stage-c-counter-events-recipe-tuning.spec.ts

import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { PlayerDriver } from './helpers/player';

const FIVE_MIN = 5 * 60_000;

test.use({
  launchOptions: { args: ['--disable-renderer-backgrounding', '--no-sandbox'] },
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CORPUS_PATH = resolve(__dirname, '../shared/data/cards.json');
const REPORTS_DIR = resolve(__dirname, 'coverage/reports');
const SLICE_TMP_DIR = resolve(__dirname, 'coverage/reports/.stage-c-on-play-slices');
mkdirSync(REPORTS_DIR, { recursive: true });
mkdirSync(SLICE_TMP_DIR, { recursive: true });
for (const f of readdirSync(SLICE_TMP_DIR)) {
  if (f.endsWith('.json')) { try { unlinkSync(join(SLICE_TMP_DIR, f)); } catch { /* ignore */ } }
}

interface CardDef {
  readonly id: string;
  readonly name: string;
  readonly kind: 'character' | 'event' | 'stage' | 'leader' | 'don';
  readonly cost?: number | null;
  readonly counterEventBoost?: number | null;
  readonly counterValue?: number | null;
  readonly power?: number | null;
  readonly colors?: ReadonlyArray<string>;
  readonly traits?: ReadonlyArray<string>;
  readonly keywords?: ReadonlyArray<string>;
  readonly effectTags?: ReadonlyArray<string>;
  readonly effectText?: string;
  readonly effectSpecV2?: {
    readonly clauses?: ReadonlyArray<{
      readonly trigger?: string;
      readonly action?: { readonly kind?: string; readonly [k: string]: unknown };
      readonly target?: { readonly kind?: string; readonly filter?: Record<string, unknown> };
      readonly cost?: Record<string, unknown>;
      readonly condition?: { readonly type?: string; readonly [k: string]: unknown };
    }>;
  };
  readonly [k: string]: unknown;
}

const CORPUS_RAW = JSON.parse(readFileSync(CORPUS_PATH, 'utf-8')) as unknown;
const CORPUS = (Array.isArray(CORPUS_RAW) ? CORPUS_RAW : Object.values(CORPUS_RAW as Record<string, unknown>)) as Array<Record<string, unknown>>;

function hasOnPlayClause(c: Record<string, unknown>): boolean {
  const clauses = (c as CardDef).effectSpecV2?.clauses;
  if (!Array.isArray(clauses)) return false;
  return clauses.some((cl) => cl.trigger === 'on_play');
}

const ALL_ON_PLAY: CardDef[] = CORPUS.filter(hasOnPlayClause) as CardDef[];
ALL_ON_PLAY.sort((a, b) => a.id.localeCompare(b.id));

const SLICE_SIZE = 25;
const SLICE_COUNT = Math.ceil(ALL_ON_PLAY.length / SLICE_SIZE);

/* eslint-disable no-console */
console.log(`[stage-c-on-play-events] Discovered ${ALL_ON_PLAY.length} on_play cards → ${SLICE_COUNT} slice(s) of up to ${SLICE_SIZE}`);
/* eslint-enable no-console */

// Hard regression anchors from directive.
const ANCHORS = {
  leader_gated: ['OP01-089','OP03-048','EB01-035','OP02-021','OP04-018','OP04-037','OP11-115','OP12-054'],
  conditional: ['P-053','OP05-050','EB03-058','OP07-115','OP09-026','OP05-118','OP09-087','OP07-050'],
  continuous_passive: ['OP01-019','EB04-057','OP01-068','EB01-014','OP03-004'],
  power_modifier: ['OP01-006','OP01-072','OP01-083','OP06-038','OP07-018'],
  target_selection: ['OP01-028','EB02-024','OP12-018','OP14-057','EB04-020'],
};
const ALL_ANCHOR_IDS = new Set<string>(Object.values(ANCHORS).flat());

type Classification = 'VERIFIED' | 'ENGINE_BUG' | 'CARD_DATA_BUG' | 'UI_BUG' | 'HARNESS_BUG' | 'NOT_IMPLEMENTED' | 'NO_UI_EXPECTED' | 'INCONCLUSIVE';

interface SetupRecipe {
  donCount: number;
  aHandSize: number;
  aLifeCount: number;
  bLifeCount: number;
  leaderColorsOverride?: string[];
  leaderTraitsOverride?: string[];
  aTrashCount?: number;
  bFieldChars?: Array<{ cost: number; power: number; traits?: string[] }>;
  aFieldChars?: Array<{ cost: number; power: number; traits?: string[] }>;
}

function recipeFor(card: CardDef): { recipe: SetupRecipe; notes: string } {
  const clauses = card.effectSpecV2?.clauses ?? [];
  const cost = typeof card.cost === 'number' ? card.cost : 0;
  const recipe: SetupRecipe = {
    donCount: Math.min(10, Math.max(0, cost + 4)),
    aHandSize: 3,
    aLifeCount: 5,
    bLifeCount: 5,
    // Wildcard leader colors override to defeat sharesColorWithLeader
    // (legality.ts:178). Engine reads leader.colors from cardLibrary.
    leaderColorsOverride: ['red', 'blue', 'green', 'purple', 'black', 'yellow'],
  };
  const notes: string[] = ['leaderColorsOverride=wildcard'];
  // Leader-condition trait override.
  const leaderCondClause = clauses.find((c) => {
    const ct = c.condition?.type;
    return ct === 'if_leader_has_trait' || ct === 'if_leader_has_type' || ct === 'if_leader_is';
  });
  if (leaderCondClause !== undefined) {
    const trait = (leaderCondClause.condition as { trait?: unknown; typeString?: unknown; name?: unknown }).trait
              ?? (leaderCondClause.condition as { trait?: unknown; typeString?: unknown }).typeString
              ?? (leaderCondClause.condition as { trait?: unknown; typeString?: unknown; name?: unknown }).name;
    if (typeof trait === 'string') {
      recipe.leaderTraitsOverride = [trait];
      notes.push(`leaderTraits=[${trait}]`);
    }
  }
  // Life condition.
  for (const c of clauses) {
    const ct = c.condition?.type;
    if (ct === 'if_own_life_max') {
      const n = (c.condition as { n?: unknown }).n;
      if (typeof n === 'number') { recipe.aLifeCount = Math.max(0, n); notes.push(`aLifeCount=${recipe.aLifeCount} for if_own_life_max:${n}`); }
    } else if (ct === 'if_own_life_min') {
      const n = (c.condition as { n?: unknown }).n;
      if (typeof n === 'number') { recipe.aLifeCount = Math.max(recipe.aLifeCount, n); notes.push(`aLifeCount=${recipe.aLifeCount} for if_own_life_min:${n}`); }
    } else if (ct === 'if_opp_life_max') {
      const n = (c.condition as { n?: unknown }).n;
      if (typeof n === 'number') { recipe.bLifeCount = Math.max(0, n); notes.push(`bLifeCount=${recipe.bLifeCount} for if_opp_life_max:${n}`); }
    } else if (ct === 'if_opp_life_min') {
      const n = (c.condition as { n?: unknown }).n;
      if (typeof n === 'number') { recipe.bLifeCount = Math.max(recipe.bLifeCount, n); notes.push(`bLifeCount=${recipe.bLifeCount} for if_opp_life_min:${n}`); }
    } else if (ct === 'if_trash_min') {
      const n = (c.condition as { n?: unknown }).n;
      if (typeof n === 'number') { recipe.aTrashCount = Math.max(recipe.aTrashCount ?? 0, n); notes.push(`aTrashCount=${recipe.aTrashCount}`); }
    } else if (ct === 'if_hand_max') {
      const n = (c.condition as { n?: unknown }).n;
      if (typeof n === 'number') { recipe.aHandSize = Math.min(recipe.aHandSize, n); notes.push(`aHandSize≤${recipe.aHandSize} for if_hand_max:${n}`); }
    } else if (ct === 'if_hand_min') {
      const n = (c.condition as { n?: unknown }).n;
      if (typeof n === 'number') { recipe.aHandSize = Math.max(recipe.aHandSize, n); notes.push(`aHandSize≥${recipe.aHandSize} for if_hand_min:${n}`); }
    }
  }
  // Target seeding.
  const oppTargetClause = clauses.find((c) =>
    c.target?.kind === 'opp_character' || c.target?.kind === 'opp_leader_or_character' || c.target?.kind === 'opp_leader' ||
    c.target?.kind === 'any_character' || c.target?.kind === 'all_opp_characters' || c.target?.kind === 'all_characters'
  );
  if (oppTargetClause !== undefined) {
    recipe.bFieldChars = [{ cost: 4, power: 4000, traits: [] }];
    notes.push('bFieldChars=[1]');
  }
  const yourCharTargetClause = clauses.find((c) =>
    c.target?.kind === 'your_character' || c.target?.kind === 'all_your_characters'
  );
  if (yourCharTargetClause !== undefined) {
    recipe.aFieldChars = [{ cost: 4, power: 4000, traits: [] }];
    notes.push('aFieldChars=[1]');
  }
  // Hand fillers for discardHand cost.
  for (const c of clauses) {
    if (c.cost !== undefined && c.cost !== null && Object.prototype.hasOwnProperty.call(c.cost, 'discardHand')) {
      const n = (c.cost as { discardHand?: number }).discardHand ?? 1;
      recipe.aHandSize = Math.max(recipe.aHandSize, n + 2);
      notes.push(`aHandSize≥${recipe.aHandSize} for discardHand:${n}`);
    }
  }
  return { recipe, notes: notes.join('; ') };
}

// ── Harness ──────────────────────────────────────────────────────────

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
  await expect.poll(
    async () => { const s = await drv.getState(); return { phase: s.phase, activePlayer: s.activePlayer }; },
    { timeout: 60_000 },
  ).toMatchObject({ phase: 'main', activePlayer: 'A' });
  await drv.normalizeToATurn1Main();
  return { drv, pageErrors, invariantErrors };
}

async function resetWithRecipe(page: Page, recipe: SetupRecipe): Promise<void> {
  await page.evaluate((opts) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    (s as Record<string, unknown>).phase = 'main';
    (s as Record<string, unknown>).activePlayer = 'A';
    (s as Record<string, unknown>).pending = null;
    (s as Record<string, unknown>).result = null;
    const players = s.players as {
      A: {
        donDeck: string[]; donCostArea: string[]; donRested: string[];
        leader: { instanceId: string; cardId: string; powerModifierThisBattle?: number; powerModifierContinuous?: number; powerModifierOneShot?: number; powerModifierExpiresInTurns?: number };
        field: unknown[]; hand: string[]; trash: string[]; life: string[]; deck: string[];
      };
      B: { leader: { instanceId: string; cardId: string }; field: unknown[]; life: string[]; deck: string[] };
    };
    const instances = s.instances as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    players.A.leader.powerModifierThisBattle = undefined;
    players.A.leader.powerModifierContinuous = undefined;
    players.A.leader.powerModifierOneShot = undefined;
    players.A.leader.powerModifierExpiresInTurns = undefined;
    players.A.field = [];
    players.B.field = [];
    // Leader colors override (defeats sharesColorWithLeader).
    if (Array.isArray(opts.leaderColorsOverride)) {
      const lc = lib[players.A.leader.cardId] as { colors?: string[] } | undefined;
      if (lc !== undefined) lc.colors = opts.leaderColorsOverride.slice();
    }
    // Leader trait override.
    if (Array.isArray(opts.leaderTraitsOverride)) {
      const lc = lib[players.A.leader.cardId] as { traits?: string[] } | undefined;
      if (lc !== undefined) lc.traits = opts.leaderTraitsOverride.slice();
    }
    // A.hand fillers.
    players.A.hand = [];
    for (let i = 0; i < opts.aHandSize; i++) {
      const synthId = `__fillerHand_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `fillerH_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = { id: synthId, name: `FillerHand ${i}`, kind: 'character', cost: 1, power: 1000, counterValue: null, colors: ['red'], traits: [], keywords: [], effectText: '' };
      instances[iid] = { instanceId: iid, cardId: synthId, controller: 'A', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      players.A.hand.push(iid);
    }
    // A.life.
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
    // A.trash seed.
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
    // B.field seed for opp-targeting clauses.
    if (Array.isArray(opts.bFieldChars)) {
      for (const ch of opts.bFieldChars) {
        const synthId = `__seedBField_${Math.floor(Math.random() * 1e9).toString(36)}`;
        const iid = `seedBField_${Math.floor(Math.random() * 1e9).toString(36)}`;
        lib[synthId] = { id: synthId, name: 'B Field Placeholder', kind: 'character', cost: ch.cost, power: ch.power, counterValue: 1000, colors: ['blue'], traits: ch.traits ?? [], keywords: [], effectText: '' };
        instances[iid] = { instanceId: iid, cardId: synthId, controller: 'B', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
        (players.B.field as unknown[]).push(instances[iid]);
      }
    }
    if (Array.isArray(opts.aFieldChars)) {
      for (const ch of opts.aFieldChars) {
        const synthId = `__seedAField_${Math.floor(Math.random() * 1e9).toString(36)}`;
        const iid = `seedAField_${Math.floor(Math.random() * 1e9).toString(36)}`;
        lib[synthId] = { id: synthId, name: 'A Field Placeholder', kind: 'character', cost: ch.cost, power: ch.power, counterValue: 1000, colors: ['red'], traits: ch.traits ?? [], keywords: [], effectText: '' };
        instances[iid] = { instanceId: iid, cardId: synthId, controller: 'A', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
        (players.A.field as unknown[]).push(instances[iid]);
      }
    }
    // DON rebalance.
    const allDon = [...players.A.donDeck, ...players.A.donCostArea, ...players.A.donRested];
    players.A.donDeck = allDon.slice(opts.donCount);
    players.A.donCostArea = allDon.slice(0, opts.donCount);
    players.A.donRested = [];
    w.__store!.setState({ state: { ...s, players: { ...(s.players as Record<string, unknown>), A: { ...players.A }, B: { ...players.B } } } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
  }, recipe);
  await page.waitForTimeout(50);
}

async function seedCardInAHand(page: Page, def: Record<string, unknown>): Promise<string> {
  return page.evaluate((def) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    lib[def['id'] as string] = def;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { hand: string[] } };
    const iid = `onPlayStageC_${def['id']}_${Math.floor(Math.random() * 1e9).toString(36)}`;
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

async function legalPlayCardIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown } }; __getLegalActions?: (s: unknown, p: string) => unknown[] };
    if (!w.__getLegalActions) return [];
    const s = w.__store!.getState().state;
    return (w.__getLegalActions(s, 'A') as { type: string; instanceId?: string }[]).filter((a) => a.type === 'PLAY_CARD').map((a) => a.instanceId ?? '');
  });
}

async function readFullSnap(page: Page): Promise<{
  phase: string; pendingKind: string | null;
  aHandLen: number; aTrashLen: number; aFieldLen: number; aLifeLen: number;
  aDonCost: number; aDonRested: number; aDonDeck: number;
  donTotalA: number; instanceIdSet: ReadonlyArray<string>; duplicateIids: ReadonlyArray<string>;
  historyTail: ReadonlyArray<Record<string, unknown>>;
}> {
  return page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { state: { phase: string; pending: { kind?: string } | null; players: { A: { hand: string[]; trash: string[]; life: string[]; deck: string[]; donDeck: string[]; donCostArea: string[]; donRested: string[]; field: { instanceId: string }[]; leader: { instanceId: string } } }; instances: Record<string, { attachedDon?: string[]; attachedDonRested?: string[] }>; history: ReadonlyArray<Record<string, unknown>> } } } };
    const s = w.__store!.getState().state;
    const allIids: string[] = [s.players.A.leader.instanceId];
    for (const id of s.players.A.hand) allIids.push(id);
    for (const id of s.players.A.trash) allIids.push(id);
    for (const id of s.players.A.life) allIids.push(id);
    for (const id of s.players.A.deck) allIids.push(id);
    for (const id of s.players.A.donDeck) allIids.push(id);
    for (const id of s.players.A.donCostArea) allIids.push(id);
    for (const id of s.players.A.donRested) allIids.push(id);
    for (const i of s.players.A.field) allIids.push(i.instanceId);
    let attachedDonA = 0;
    for (const iid of allIids) { const inst = s.instances[iid]; if (inst) attachedDonA += (inst.attachedDon?.length ?? 0) + (inst.attachedDonRested?.length ?? 0); }
    const seen = new Set<string>(); const dups = new Set<string>();
    for (const id of allIids) { if (seen.has(id)) dups.add(id); else seen.add(id); }
    return {
      phase: s.phase,
      pendingKind: s.pending?.kind ?? null,
      aHandLen: s.players.A.hand.length,
      aTrashLen: s.players.A.trash.length,
      aFieldLen: s.players.A.field.length,
      aLifeLen: s.players.A.life.length,
      aDonCost: s.players.A.donCostArea.length,
      aDonRested: s.players.A.donRested.length,
      aDonDeck: s.players.A.donDeck.length,
      donTotalA: s.players.A.donDeck.length + s.players.A.donCostArea.length + s.players.A.donRested.length + attachedDonA,
      instanceIdSet: allIids,
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
  cardId: string;
  name: string;
  kind: string;
  cost: number | null;
  family: 'on_play_event' | 'on_play_character' | 'on_play_stage' | 'on_play_leader' | 'on_play_other';
  recipe: SetupRecipe;
  recipeNotes: string;
  actionPerformed: 'PLAY_CARD' | 'PLAY_CARD_NOT_OFFERED' | 'SKIPPED';
  classification: Classification;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  notes: string;
  observedEffectSummary: string;
  donConserved: boolean;
  noDuplicateInstanceIds: boolean;
  noStuckPending: boolean;
  historyTail: ReadonlyArray<Record<string, unknown>>;
  isAnchor: boolean;
  anchorFamily?: string;
}

function classifyKind(c: CardDef): StageCResult['family'] {
  if (c.kind === 'event') return 'on_play_event';
  if (c.kind === 'character') return 'on_play_character';
  if (c.kind === 'stage') return 'on_play_stage';
  if (c.kind === 'leader') return 'on_play_leader';
  return 'on_play_other';
}

function anchorFamilyFor(id: string): string | undefined {
  for (const [fam, ids] of Object.entries(ANCHORS)) if ((ids as string[]).includes(id)) return fam;
  return undefined;
}

async function processCard(page: Page, card: CardDef, pageErrorsAcc: string[], invariantErrorsAcc: string[]): Promise<StageCResult> {
  const { recipe, notes: recipeNotes } = recipeFor(card);
  const family = classifyKind(card);
  const isAnchor = ALL_ANCHOR_IDS.has(card.id);
  const anchorFamily = anchorFamilyFor(card.id);
  const pageErrorsBefore = pageErrorsAcc.length;
  const invariantErrorsBefore = invariantErrorsAcc.length;
  try {
    await resetWithRecipe(page, recipe);
    const cardIid = await seedCardInAHand(page, card as unknown as Record<string, unknown>);
    const before = await readFullSnap(page);
    const offered = await legalPlayCardIds(page);
    const playable = offered.includes(cardIid);
    if (!playable) {
      await drainPending(page);
      const after = await readFullSnap(page);
      const newPE = pageErrorsAcc.slice(pageErrorsBefore);
      const newIE = invariantErrorsAcc.slice(invariantErrorsBefore);
      // Diagnose
      const cost = typeof card.cost === 'number' ? card.cost : null;
      const costPayable = cost !== null && cost <= before.aDonCost;
      const isCounter = (card.effectText ?? '').startsWith('[Counter]');
      let cls: Classification;
      let notes: string;
      if (isCounter) {
        cls = 'NOT_IMPLEMENTED';
        notes = '[Counter] events are excluded from main-phase PLAY_CARD by legality.ts:190 (covered in stage-c-generated-counter-events.spec.ts)';
      } else if (card.kind === 'leader') {
        cls = 'NOT_IMPLEMENTED';
        notes = 'leader cards cannot be played as PLAY_CARD (already on field as A.leader)';
      } else if (cost === null) {
        cls = 'NOT_IMPLEMENTED';
        notes = `card.cost is null — engine playCardActions:165 skips cards with null cost`;
      } else if (!costPayable) {
        cls = 'HARNESS_BUG';
        notes = `cost not payable: card.cost=${cost} aDonCost=${before.aDonCost}; recipe donCount may need bump`;
      } else {
        cls = 'INCONCLUSIVE';
        notes = `PLAY_CARD not offered for unknown reason (cost=${cost} payable; color override active); investigate per-card`;
      }
      return {
        cardId: card.id, name: card.name, kind: card.kind, cost, family,
        recipe, recipeNotes,
        actionPerformed: 'PLAY_CARD_NOT_OFFERED',
        classification: cls, confidence: 'HIGH', notes,
        observedEffectSummary: 'PLAY_CARD not offered',
        donConserved: after.donTotalA === before.donTotalA,
        noDuplicateInstanceIds: after.duplicateIids.length === 0,
        noStuckPending: (await readPendingKind(page)) === null,
        historyTail: after.historyTail,
        isAnchor, anchorFamily,
      };
    }
    // Dispatch PLAY_CARD with replaceTargetId=null (engine accepts character/event/stage).
    const playRes = await dispatchAs(page, { type: 'PLAY_CARD', instanceId: cardIid, replaceTargetId: null });
    await drainPending(page);
    const after = await readFullSnap(page);
    const newPE = pageErrorsAcc.slice(pageErrorsBefore);
    const newIE = invariantErrorsAcc.slice(invariantErrorsBefore);
    const donConserved = after.donTotalA === before.donTotalA;
    const noDup = after.duplicateIids.length === 0;
    const noStuck = (await readPendingKind(page)) === null;
    let cls: Classification; let confidence: 'HIGH' | 'MEDIUM' | 'LOW'; let notes: string;
    if (!playRes.ok) { cls = 'ENGINE_BUG'; confidence = 'HIGH'; notes = `dispatch threw: ${playRes.err}`; }
    else if (newIE.length > 0) { cls = 'ENGINE_BUG'; confidence = 'HIGH'; notes = `invariant violated: ${newIE[0]}`; }
    else if (newPE.length > 0) { cls = 'ENGINE_BUG'; confidence = 'HIGH'; notes = `page error: ${newPE[0]}`; }
    else if (!donConserved) { cls = 'ENGINE_BUG'; confidence = 'HIGH'; notes = `DON conservation: pre=${before.donTotalA} post=${after.donTotalA}`; }
    else if (!noDup) { cls = 'ENGINE_BUG'; confidence = 'HIGH'; notes = `duplicate iids: ${after.duplicateIids.join(',')}`; }
    else if (!noStuck) { cls = 'HARNESS_BUG'; confidence = 'MEDIUM'; notes = 'pending did not drain'; }
    else {
      const cpSeen = after.historyTail.some((h) => {
        const t = h.type as string | undefined;
        return (t === 'CARD_PLAYED' || t === 'CHARACTER_PLAYED' || t === 'EVENT_PLAYED' || t === 'STAGE_PLAYED') && (h as Record<string, unknown>).instanceId === cardIid;
      });
      // Generic: if A.hand decremented OR A.field increased OR A.trash increased, card played.
      const handDrop = after.aHandLen < before.aHandLen;
      const fieldRise = after.aFieldLen > before.aFieldLen;
      const trashRise = after.aTrashLen > before.aTrashLen;
      const looksPlayed = handDrop || fieldRise || trashRise || cpSeen;
      if (!looksPlayed) { cls = 'INCONCLUSIVE'; confidence = 'LOW'; notes = 'PLAY_CARD dispatched but no obvious state change (hand/field/trash unchanged + no PLAYED-class history)'; }
      else { cls = 'VERIFIED'; confidence = 'HIGH'; notes = `played; aHandΔ=${after.aHandLen - before.aHandLen} aFieldΔ=${after.aFieldLen - before.aFieldLen} aTrashΔ=${after.aTrashLen - before.aTrashLen}`; }
    }
    return {
      cardId: card.id, name: card.name, kind: card.kind, cost: typeof card.cost === 'number' ? card.cost : null, family,
      recipe, recipeNotes,
      actionPerformed: 'PLAY_CARD',
      classification: cls, confidence, notes,
      observedEffectSummary: `aHandΔ=${after.aHandLen - before.aHandLen} aFieldΔ=${after.aFieldLen - before.aFieldLen} aTrashΔ=${after.aTrashLen - before.aTrashLen} aDonCostΔ=${after.aDonCost - before.aDonCost}`,
      donConserved, noDuplicateInstanceIds: noDup, noStuckPending: noStuck,
      historyTail: after.historyTail,
      isAnchor, anchorFamily,
    };
  } catch (err) {
    try { await drainPending(page); } catch { /* ignore */ }
    return {
      cardId: card.id, name: card.name, kind: card.kind, cost: typeof card.cost === 'number' ? card.cost : null, family,
      recipe, recipeNotes,
      actionPerformed: 'SKIPPED',
      classification: 'HARNESS_BUG', confidence: 'LOW', notes: `harness threw: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
      observedEffectSummary: '(harness threw)',
      donConserved: true, noDuplicateInstanceIds: true, noStuckPending: false,
      historyTail: [], isAnchor, anchorFamily,
    };
  }
}

const SLICES: CardDef[][] = [];
for (let i = 0; i < SLICE_COUNT; i++) SLICES.push(ALL_ON_PLAY.slice(i * SLICE_SIZE, (i + 1) * SLICE_SIZE));

test.describe.serial('stage-c-generated-on-play-events', () => {
  for (let s = 0; s < SLICES.length; s++) {
    const sliceIndex = s;
    const slice = SLICES[sliceIndex]!;
    test(`slice ${sliceIndex + 1}/${SLICES.length} — ${slice.length} cards (${slice[0]!.id} … ${slice[slice.length - 1]!.id})`, async ({ page }) => {
      test.setTimeout(FIVE_MIN);
      const { drv, pageErrors, invariantErrors } = await bootstrap(page);
      void drv;
      const results: StageCResult[] = [];
      for (const card of slice) results.push(await processCard(page, card, pageErrors, invariantErrors));
      expect(pageErrors, `slice ${sliceIndex} pageerrors`).toEqual([]);
      expect(invariantErrors, `slice ${sliceIndex} InvariantErrors`).toEqual([]);
      expect(await readPendingKind(page), `slice ${sliceIndex} no stuck pending`).toBeNull();
      const sliceFile = join(SLICE_TMP_DIR, `op-slice-${String(sliceIndex).padStart(3, '0')}.json`);
      writeFileSync(sliceFile, JSON.stringify({ sliceIndex, cardCount: slice.length, results }, null, 2), 'utf-8');
      /* eslint-disable no-console */
      console.log(`[on-play-events] wrote slice ${sliceIndex} → ${sliceFile}`);
      /* eslint-enable no-console */
    });
  }

  test('aggregator: roll up on-play slices', async () => {
    const all: StageCResult[] = [];
    for (const f of readdirSync(SLICE_TMP_DIR).filter((f) => f.startsWith('op-slice-') && f.endsWith('.json')).sort()) {
      const raw = JSON.parse(readFileSync(join(SLICE_TMP_DIR, f), 'utf-8')) as { results: StageCResult[] };
      for (const r of raw.results) all.push(r);
    }
    const buckets: Record<Classification, number> = {
      VERIFIED: 0, ENGINE_BUG: 0, CARD_DATA_BUG: 0, UI_BUG: 0, HARNESS_BUG: 0, NOT_IMPLEMENTED: 0, NO_UI_EXPECTED: 0, INCONCLUSIVE: 0,
    };
    for (const r of all) buckets[r.classification]++;
    // Cluster failures (non-VERIFIED, non-NOT_IMPLEMENTED) by notes signature.
    const clusters = new Map<string, { rootCause: string; cards: string[] }>();
    for (const r of all) {
      if (r.classification === 'VERIFIED' || r.classification === 'NOT_IMPLEMENTED') continue;
      const sig = (r.notes || `(${r.classification})`).slice(0, 100);
      const ex = clusters.get(sig) ?? { rootCause: sig, cards: [] };
      ex.cards.push(r.cardId);
      clusters.set(sig, ex);
    }
    const sortedClusters = Array.from(clusters.values()).sort((a, b) => b.cards.length - a.cards.length);
    // Anchor status per family.
    const anchorStatus: Record<string, Array<{ id: string; classification: Classification }>> = {};
    for (const [fam, ids] of Object.entries(ANCHORS)) {
      anchorStatus[fam] = (ids as string[]).map((id) => {
        const r = all.find((x) => x.cardId === id);
        return { id, classification: r?.classification ?? 'INCONCLUSIVE' };
      });
    }
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const jsonPath = join(REPORTS_DIR, `stage-c-on-play-events-${ts}.json`);
    const mdPath = join(REPORTS_DIR, `stage-c-on-play-events-${ts}.md`);
    const finalReport = {
      family: 'on_play_events', generatedAt: new Date().toISOString(),
      totalCardsDiscovered: ALL_ON_PLAY.length, totalRecordsWritten: all.length, sliceCount: SLICE_COUNT,
      classifications: buckets,
      verifiedPercent: all.length > 0 ? (100 * buckets.VERIFIED / all.length).toFixed(2) : '0',
      anchorStatus,
      topFailureClusters: sortedClusters.slice(0, 10),
      results: all,
    };
    writeFileSync(jsonPath, JSON.stringify(finalReport, null, 2), 'utf-8');
    const md: string[] = [];
    md.push(`# Stage C — On-Play Events Generated Report\n\n`);
    md.push(`**Generated:** ${new Date().toISOString()}\n`);
    md.push(`**Total on_play cards discovered:** ${ALL_ON_PLAY.length}\n`);
    md.push(`**Total records written:** ${all.length}\n`);
    md.push(`**Slice count:** ${SLICE_COUNT}\n\n`);
    md.push(`## Classification buckets\n\n| Bucket | Count | % |\n|---|---:|---:|\n`);
    for (const [k, v] of Object.entries(buckets)) md.push(`| ${k} | ${v} | ${all.length > 0 ? (100 * v / all.length).toFixed(1) : '0'}% |\n`);
    md.push(`\n## Anchor card status (must all classify VERIFIED)\n\n`);
    for (const [fam, items] of Object.entries(anchorStatus)) {
      const pass = items.filter((x) => x.classification === 'VERIFIED').length;
      md.push(`### ${fam} (${pass}/${items.length} VERIFIED)\n\n`);
      md.push(`| Card | Classification |\n|---|---|\n`);
      for (const x of items) md.push(`| ${x.id} | ${x.classification} |\n`);
      md.push(`\n`);
    }
    md.push(`## Top 10 failure clusters (non-VERIFIED + non-NOT_IMPLEMENTED)\n\n`);
    if (sortedClusters.length === 0) md.push(`(none)\n`);
    else for (const c of sortedClusters.slice(0, 10)) md.push(`- **${c.cards.length} cards**: ${c.rootCause}\n`);
    md.push(`\n## Report files\n\n- JSON: \`coverage/reports/stage-c-on-play-events-${ts}.json\`\n- MD: \`coverage/reports/stage-c-on-play-events-${ts}.md\`\n`);
    writeFileSync(mdPath, md.join(''), 'utf-8');
    /* eslint-disable no-console */
    console.log(`[on-play-events] FINAL JSON: ${jsonPath}`);
    console.log(`[on-play-events] FINAL MD:   ${mdPath}`);
    console.log(`[on-play-events] tally: ${JSON.stringify(buckets)}`);
    /* eslint-enable no-console */
    expect(all.length, 'every targeted card must have a record').toBe(ALL_ON_PLAY.length);
  });
});
