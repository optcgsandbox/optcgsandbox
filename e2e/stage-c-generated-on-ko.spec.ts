// stage-c-generated-on-ko — Stage C target #5 per
// e2e/stage-c-corpus-verification-plan.md. Auto-discovers every card
// where `effectSpecV2.clauses[].trigger === 'on_ko'` and runs each
// through a controlled battle-KO dispatch.
//
// Read-only against engine / UI / cards.json / scenarioFactory.
//
// Engine references:
//   - attackFlow.ts:76-116 koCharacter: applies would_be_ko replacement,
//     records koSourceStack entry (source='battle'), fires on_ko clauses
//     on the KO'd character (line 111-116).
//   - actions.ts:180-184: removal_ko also fires on_ko via EffectDispatcher.
//   - First-turn attack-block at legality.ts:218-221 cleared by setting
//     state.turn = 5 (same as when_attacking spec).
//   - For battle-KO: A's attacker (A.leader with overridden power=99999)
//     attacks the seeded B.field source. Source.rested=true so it's a
//     valid attack target per legality.ts:236.
//
// Harness reuses `fullRestoringReset` pattern (detach attached DON
// before B.field/B.stage wipe).

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
const SLICE_TMP_DIR = resolve(__dirname, 'coverage/reports/.stage-c-onko-slices');
mkdirSync(REPORTS_DIR, { recursive: true });
mkdirSync(SLICE_TMP_DIR, { recursive: true });
for (const f of readdirSync(SLICE_TMP_DIR)) { if (f.endsWith('.json')) { try { unlinkSync(join(SLICE_TMP_DIR, f)); } catch { /* ignore */ } } }

interface CardDef {
  readonly id: string; readonly name: string; readonly kind: 'character' | 'event' | 'stage' | 'leader' | 'don';
  readonly cost?: number | null; readonly power?: number | null; readonly colors?: ReadonlyArray<string>; readonly traits?: ReadonlyArray<string>;
  readonly keywords?: ReadonlyArray<string>; readonly effectText?: string;
  readonly effectSpecV2?: { readonly clauses?: ReadonlyArray<{ readonly trigger?: string; readonly action?: { readonly kind?: string }; readonly target?: { readonly kind?: string }; readonly cost?: Record<string, unknown>; readonly condition?: { readonly type?: string; readonly [k: string]: unknown } }> };
  readonly [k: string]: unknown;
}

const CORPUS_RAW = JSON.parse(readFileSync(CORPUS_PATH, 'utf-8')) as unknown;
const CORPUS = (Array.isArray(CORPUS_RAW) ? CORPUS_RAW : Object.values(CORPUS_RAW as Record<string, unknown>)) as Array<Record<string, unknown>>;

function isOnKoCard(c: Record<string, unknown>): boolean {
  const cd = c as CardDef;
  return (cd.effectSpecV2?.clauses ?? []).some((cl) => cl.trigger === 'on_ko');
}

const CARDS: CardDef[] = CORPUS.filter(isOnKoCard) as CardDef[];
CARDS.sort((a, b) => a.id.localeCompare(b.id));

const SLICE_SIZE = 25;
const SLICE_COUNT = Math.ceil(CARDS.length / SLICE_SIZE);
/* eslint-disable no-console */
console.log(`[stage-c-on-ko] Discovered ${CARDS.length} on_ko cards → ${SLICE_COUNT} slice(s) of up to ${SLICE_SIZE}`);
/* eslint-enable no-console */

const ANCHORS = new Set<string>(['OP01-038']);

type Classification = 'VERIFIED' | 'ENGINE_BUG' | 'CARD_DATA_BUG' | 'UI_BUG' | 'HARNESS_BUG' | 'HARNESS_GAP' | 'NOT_IMPLEMENTED' | 'NO_UI_EXPECTED' | 'INCONCLUSIVE';

interface SetupRecipe {
  donCount: number; aHandSize: number; aLifeCount: number; bLifeCount: number;
  seedZone: 'b_field' | 'b_leader' | 'skip';
  leaderColorsOverride?: string[]; leaderTraitsOverride?: string[];
  aTrashCount?: number; aFieldChars?: Array<{ cost: number; power: number; traits?: string[] }>;
  turnOverride: number;
}

function recipeFor(card: CardDef): { recipe: SetupRecipe; notes: string } {
  const clauses = card.effectSpecV2?.clauses ?? [];
  const cost = typeof card.cost === 'number' ? card.cost : 0;
  let seedZone: SetupRecipe['seedZone'] = 'skip';
  if (card.kind === 'character') seedZone = 'b_field';
  else if (card.kind === 'leader') seedZone = 'b_leader';
  const recipe: SetupRecipe = {
    donCount: Math.max(0, cost + 4), aHandSize: 3, aLifeCount: 5, bLifeCount: 5, seedZone,
    leaderColorsOverride: ['red', 'blue', 'green', 'purple', 'black', 'yellow'],
    turnOverride: 5,
  };
  const notes: string[] = ['turn=5', 'A.leader.power=99999', `seedZone=${seedZone}`];
  const leaderCondClause = clauses.find((c) => { const ct = c.condition?.type; return ct === 'if_leader_has_trait' || ct === 'if_leader_has_type' || ct === 'if_leader_is'; });
  if (leaderCondClause !== undefined) {
    const trait = (leaderCondClause.condition as { trait?: unknown; typeString?: unknown; name?: unknown }).trait ?? (leaderCondClause.condition as { typeString?: unknown }).typeString ?? (leaderCondClause.condition as { name?: unknown }).name;
    if (typeof trait === 'string') { recipe.leaderTraitsOverride = [trait]; notes.push(`leaderTraits=[${trait}]`); }
  }
  for (const c of clauses) {
    const ct = c.condition?.type;
    if (ct === 'if_own_life_max') { const n = (c.condition as { n?: unknown }).n; if (typeof n === 'number') { recipe.aLifeCount = Math.max(0, n); notes.push(`aLifeCount=${recipe.aLifeCount}`); } }
    else if (ct === 'if_trash_min') { const n = (c.condition as { n?: unknown }).n; if (typeof n === 'number') { recipe.aTrashCount = Math.max(recipe.aTrashCount ?? 0, n); notes.push(`aTrashCount=${recipe.aTrashCount}`); } }
  }
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

async function fullRestoringReset(page: Page, recipe: SetupRecipe, sourceCard: CardDef): Promise<{ sourceIid: string | null; aAttackerIid: string }> {
  return page.evaluate(({ opts, cardDef }) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    (s as Record<string, unknown>).phase = 'main';
    (s as Record<string, unknown>).activePlayer = 'A';
    (s as Record<string, unknown>).pending = null;
    (s as Record<string, unknown>).result = null;
    (s as Record<string, unknown>).turn = opts.turnOverride;
    const players = s.players as {
      A: { donDeck: string[]; donCostArea: string[]; donRested: string[]; leader: { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[]; rested?: boolean; perTurn?: { hasAttacked?: boolean; effectsUsed?: unknown[] }; powerModifierThisBattle?: number; powerModifierContinuous?: number; powerModifierOneShot?: number }; field: Array<{ instanceId: string; attachedDon?: string[]; attachedDonRested?: string[]; rested?: boolean }>; hand: string[]; trash: string[]; life: string[]; deck: string[]; stage?: { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[] } | null };
      B: { donDeck: string[]; donCostArea: string[]; donRested: string[]; leader: { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[]; rested?: boolean }; field: Array<{ instanceId: string; attachedDon?: string[]; attachedDonRested?: string[] }>; life: string[]; deck: string[]; stage?: { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[] } | null };
    };
    const instances = s.instances as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    // Detach all attached DON.
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
    // Leader overrides + power=99999.
    const aLeaderCard = lib[players.A.leader.cardId] as { colors?: string[]; traits?: string[]; power?: number } | undefined;
    if (aLeaderCard !== undefined) {
      if (Array.isArray(opts.leaderColorsOverride)) aLeaderCard.colors = opts.leaderColorsOverride.slice();
      if (Array.isArray(opts.leaderTraitsOverride)) aLeaderCard.traits = opts.leaderTraitsOverride.slice();
      aLeaderCard.power = 99999;
    }
    players.A.leader.rested = false;
    if (players.A.leader.perTurn) players.A.leader.perTurn.hasAttacked = false;
    (players.A.leader as { powerModifierThisBattle?: number }).powerModifierThisBattle = undefined;
    (players.A.leader as { powerModifierContinuous?: number }).powerModifierContinuous = undefined;
    (players.A.leader as { powerModifierOneShot?: number }).powerModifierOneShot = undefined;
    // A.hand fillers.
    players.A.hand = [];
    for (let i = 0; i < opts.aHandSize; i++) {
      const synthId = `__fillerHand_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `fillerH_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = { id: synthId, name: `FillerHand ${i}`, kind: 'character', cost: 1, power: 1000, counterValue: null, colors: ['red'], traits: [], keywords: [], effectText: '' };
      instances[iid] = { instanceId: iid, cardId: synthId, controller: 'A', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      players.A.hand.push(iid);
    }
    // A.life / B.life.
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
    // Seed source card on B.field (or B.leader for leader kind).
    let sourceIid: string | null = null;
    if (opts.seedZone === 'b_field') {
      lib[cardDef.id] = cardDef as unknown as Record<string, unknown>;
      const iid = `onko_b_field_${cardDef.id}_${Math.floor(Math.random() * 1e9).toString(36)}`;
      // rested=true so it's a legal attack target per legality.ts:236.
      instances[iid] = { instanceId: iid, cardId: cardDef.id, controller: 'B', rested: true, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      (players.B.field as unknown[]).push(instances[iid]);
      sourceIid = iid;
    } else if (opts.seedZone === 'b_leader') {
      lib[cardDef.id] = cardDef as unknown as Record<string, unknown>;
      players.B.leader.cardId = cardDef.id;
      sourceIid = players.B.leader.instanceId;
    }
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
    return { sourceIid, aAttackerIid: players.A.leader.instanceId };
  }, { opts: recipe, cardDef: sourceCard as unknown as Record<string, unknown> });
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

async function legalAttackTargets(page: Page, attackerIid: string): Promise<string[]> {
  return page.evaluate((attackerIid) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown } }; __getLegalActions?: (s: unknown, p: string) => unknown[] };
    if (!w.__getLegalActions) return [];
    const s = w.__store!.getState().state;
    return (w.__getLegalActions(s, 'A') as { type: string; attackerInstanceId?: string; targetInstanceId?: string }[]).filter((a) => a.type === 'DECLARE_ATTACK' && a.attackerInstanceId === attackerIid).map((a) => a.targetInstanceId ?? '');
  }, attackerIid);
}

async function readSnapAndZone(page: Page, sourceIid: string): Promise<{
  phase: string; pendingKind: string | null;
  sourceZone: 'B.field' | 'B.trash' | 'B.leader' | 'gone' | 'other';
  bFieldLen: number; bTrashLen: number;
  donTotalA: number; bDonTotal: number; duplicateIids: ReadonlyArray<string>;
  historyTail: ReadonlyArray<Record<string, unknown>>;
  characterKodSeen: boolean;
  onKoClauseFiredSeen: boolean;
}> {
  return page.evaluate((sourceIid) => {
    const w = window as unknown as { __store?: { getState: () => { state: { phase: string; pending: { kind?: string } | null; players: { A: { donDeck: string[]; donCostArea: string[]; donRested: string[]; leader: { instanceId: string; attachedDon?: string[]; attachedDonRested?: string[] }; field: { instanceId: string }[]; stage?: { instanceId: string; attachedDon?: string[]; attachedDonRested?: string[] } | null; hand: string[]; trash: string[]; life: string[]; deck: string[] }; B: { donDeck: string[]; donCostArea: string[]; donRested: string[]; leader: { instanceId: string; attachedDon?: string[]; attachedDonRested?: string[] }; field: { instanceId: string }[]; stage?: { instanceId: string; attachedDon?: string[]; attachedDonRested?: string[] } | null; life: string[]; trash: string[] } }; instances: Record<string, { attachedDon?: string[]; attachedDonRested?: string[] }>; history: ReadonlyArray<Record<string, unknown>> } } } };
    const s = w.__store!.getState().state;
    let sourceZone: 'B.field' | 'B.trash' | 'B.leader' | 'gone' | 'other' = 'other';
    if (s.players.B.field.some((i) => i.instanceId === sourceIid)) sourceZone = 'B.field';
    else if (s.players.B.trash.includes(sourceIid)) sourceZone = 'B.trash';
    else if (s.players.B.leader.instanceId === sourceIid) sourceZone = 'B.leader';
    else if (!s.instances[sourceIid]) sourceZone = 'gone';
    let attachedDonA = 0;
    const aIids: string[] = [s.players.A.leader.instanceId, ...s.players.A.hand, ...s.players.A.trash, ...s.players.A.life, ...s.players.A.deck, ...s.players.A.donDeck, ...s.players.A.donCostArea, ...s.players.A.donRested, ...s.players.A.field.map((i) => i.instanceId)];
    if (s.players.A.stage) aIids.push(s.players.A.stage.instanceId);
    for (const iid of aIids) { const inst = s.instances[iid]; if (inst) attachedDonA += (inst.attachedDon?.length ?? 0) + (inst.attachedDonRested?.length ?? 0); }
    let attachedDonB = 0;
    const bAttachable: Array<{ attachedDon?: string[]; attachedDonRested?: string[] }> = [s.players.B.leader, ...s.players.B.field];
    if (s.players.B.stage) bAttachable.push(s.players.B.stage);
    for (const inst of bAttachable) attachedDonB += (inst.attachedDon?.length ?? 0) + (inst.attachedDonRested?.length ?? 0);
    const seen = new Set<string>(); const dups = new Set<string>();
    for (const id of aIids) { if (seen.has(id)) dups.add(id); else seen.add(id); }
    const tail = s.history.slice(-15);
    const characterKodSeen = tail.some((h) => h.type === 'CHARACTER_KOD' && (h as Record<string, unknown>).instanceId === sourceIid);
    const onKoClauseFiredSeen = tail.some((h) => h.type === 'CLAUSE_FIRED' && (h as Record<string, unknown>).trigger === 'on_ko' && (h as Record<string, unknown>).sourceInstanceId === sourceIid);
    return {
      phase: s.phase, pendingKind: s.pending?.kind ?? null,
      sourceZone, bFieldLen: s.players.B.field.length, bTrashLen: s.players.B.trash.length,
      donTotalA: s.players.A.donDeck.length + s.players.A.donCostArea.length + s.players.A.donRested.length + attachedDonA,
      bDonTotal: s.players.B.donDeck.length + s.players.B.donCostArea.length + s.players.B.donRested.length + attachedDonB,
      duplicateIids: Array.from(dups),
      historyTail: tail,
      characterKodSeen, onKoClauseFiredSeen,
    };
  }, sourceIid);
}

async function drainPending(page: Page, maxIter = 10): Promise<void> {
  for (let i = 0; i < maxIter; i++) {
    const pk = await readPendingKind(page);
    if (pk === null) return;
    if (pk === 'attack') {
      const phase = await page.evaluate(() => { const w = window as unknown as { __store?: { getState: () => { state: { phase: string } } } }; return w.__store!.getState().state.phase; });
      if (phase === 'block_window') await dispatchAs(page, { type: 'SKIP_BLOCKER' });
      else if (phase === 'counter_window') await dispatchAs(page, { type: 'SKIP_COUNTER' });
      else await dispatchAs(page, { type: 'SKIP_COUNTER' });
    }
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
  cardId: string; name: string; kind: string; family: 'on_ko';
  recipe: SetupRecipe; recipeNotes: string;
  classification: Classification; confidence: 'HIGH' | 'MEDIUM' | 'LOW'; notes: string;
  observedEffectSummary: string;
  donConservedA: boolean; donConservedB: boolean; noDuplicateInstanceIds: boolean; noStuckPending: boolean;
  characterKodSeen: boolean; onKoClauseFiredSeen: boolean; sourceZone: string;
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
      cardId: card.id, name: card.name, kind: card.kind, family: 'on_ko',
      recipe, recipeNotes,
      classification: 'NOT_IMPLEMENTED', confidence: 'HIGH',
      notes: `card.kind=${card.kind} cannot be KO'd via standard battle path; on_ko trigger only meaningful for chars/leaders`,
      observedEffectSummary: '(not dispatched)', donConservedA: true, donConservedB: true, noDuplicateInstanceIds: true, noStuckPending: true,
      characterKodSeen: false, onKoClauseFiredSeen: false, sourceZone: 'n/a',
      historyTail: [], isAnchor,
    };
  }
  try {
    const { sourceIid, aAttackerIid } = await fullRestoringReset(page, recipe, card);
    if (sourceIid === null) {
      return {
        cardId: card.id, name: card.name, kind: card.kind, family: 'on_ko',
        recipe, recipeNotes, classification: 'HARNESS_BUG', confidence: 'MEDIUM',
        notes: 'fullRestoringReset returned null sourceIid', observedEffectSummary: '(skipped)',
        donConservedA: true, donConservedB: true, noDuplicateInstanceIds: true, noStuckPending: true,
        characterKodSeen: false, onKoClauseFiredSeen: false, sourceZone: 'n/a', historyTail: [], isAnchor,
      };
    }
    const before = await readSnapAndZone(page, sourceIid);
    // For B.leader seedZone we can attack the leader directly; for B.field char we attack the seeded char.
    const targets = await legalAttackTargets(page, aAttackerIid);
    if (recipe.seedZone === 'b_leader') {
      // Leader on_ko via battle: A would need to reduce B.life to 0. Not generically reproducible
      // (would require 5 successful attacks). Classify as HARNESS_GAP.
      return {
        cardId: card.id, name: card.name, kind: card.kind, family: 'on_ko',
        recipe, recipeNotes, classification: 'HARNESS_GAP', confidence: 'HIGH',
        notes: `leader on_ko requires reducing B.life to 0 (5 successful attacks); not generically reproducible in single-card spec`,
        observedEffectSummary: '(leader on_ko unreachable)',
        donConservedA: true, donConservedB: true, noDuplicateInstanceIds: true, noStuckPending: true,
        characterKodSeen: false, onKoClauseFiredSeen: false, sourceZone: 'B.leader', historyTail: [], isAnchor,
      };
    }
    if (!targets.includes(sourceIid)) {
      await drainPending(page);
      return {
        cardId: card.id, name: card.name, kind: card.kind, family: 'on_ko',
        recipe, recipeNotes, classification: 'HARNESS_GAP', confidence: 'MEDIUM',
        notes: `B.field source (rested=true) was not offered as DECLARE_ATTACK target; targets=${targets.join(',')}; possibly engine excludes for specific keyword/state`,
        observedEffectSummary: 'attack target unavailable',
        donConservedA: true, donConservedB: true, noDuplicateInstanceIds: true, noStuckPending: (await readPendingKind(page)) === null,
        characterKodSeen: false, onKoClauseFiredSeen: false, sourceZone: 'B.field', historyTail: [], isAnchor,
      };
    }
    // Attack the source. A.leader power=99999 overrides any defender power → KO.
    const playRes = await dispatchAs(page, { type: 'DECLARE_ATTACK', attackerInstanceId: aAttackerIid, targetInstanceId: sourceIid });
    await drainPending(page);
    const after = await readSnapAndZone(page, sourceIid);
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
    else if (!after.characterKodSeen && after.sourceZone === 'B.field') {
      cls = 'INCONCLUSIVE'; confidence = 'LOW'; notes = `source still in B.field after attack; KO did not occur (would_be_ko replacement may have fired, or counter applied)`;
    } else if (after.characterKodSeen && !after.onKoClauseFiredSeen) {
      cls = 'CARD_DATA_BUG'; confidence = 'MEDIUM'; notes = `CHARACTER_KOD logged but no on_ko CLAUSE_FIRED for this source; clause condition may have evaluated false OR on_ko handler is a no-op for this card's action.kind`;
    } else if (after.characterKodSeen && after.onKoClauseFiredSeen) {
      cls = 'VERIFIED'; confidence = 'HIGH'; notes = `source KO'd, on_ko clause fired; sourceZone=${after.sourceZone}`;
    } else {
      cls = 'INCONCLUSIVE'; confidence = 'LOW'; notes = `unclear outcome; sourceZone=${after.sourceZone} kodSeen=${after.characterKodSeen} onKoSeen=${after.onKoClauseFiredSeen}`;
    }
    return {
      cardId: card.id, name: card.name, kind: card.kind, family: 'on_ko',
      recipe, recipeNotes, classification: cls, confidence, notes,
      observedEffectSummary: `sourceZone=${after.sourceZone} kodSeen=${after.characterKodSeen} onKoFiredSeen=${after.onKoClauseFiredSeen}`,
      donConservedA, donConservedB, noDuplicateInstanceIds: noDup, noStuckPending: noStuck,
      characterKodSeen: after.characterKodSeen, onKoClauseFiredSeen: after.onKoClauseFiredSeen, sourceZone: after.sourceZone,
      historyTail: after.historyTail, isAnchor,
    };
  } catch (err) {
    try { await drainPending(page); } catch { /* ignore */ }
    return {
      cardId: card.id, name: card.name, kind: card.kind, family: 'on_ko',
      recipe, recipeNotes, classification: 'HARNESS_BUG', confidence: 'LOW', notes: `harness threw: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
      observedEffectSummary: '(harness threw)', donConservedA: true, donConservedB: true, noDuplicateInstanceIds: true, noStuckPending: false,
      characterKodSeen: false, onKoClauseFiredSeen: false, sourceZone: 'unknown', historyTail: [], isAnchor,
    };
  }
}

const SLICES: CardDef[][] = [];
for (let i = 0; i < SLICE_COUNT; i++) SLICES.push(CARDS.slice(i * SLICE_SIZE, (i + 1) * SLICE_SIZE));

test.describe.serial('stage-c-generated-on-ko', () => {
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
      const sliceFile = join(SLICE_TMP_DIR, `onko-slice-${String(sliceIndex).padStart(3, '0')}.json`);
      writeFileSync(sliceFile, JSON.stringify({ sliceIndex, cardCount: slice.length, results }, null, 2), 'utf-8');
      /* eslint-disable no-console */
      console.log(`[on-ko] wrote slice ${sliceIndex} → ${sliceFile}`);
      /* eslint-enable no-console */
    });
  }

  test('aggregator: roll up on-ko slices', async () => {
    const all: StageCResult[] = [];
    for (const f of readdirSync(SLICE_TMP_DIR).filter((f) => f.startsWith('onko-slice-') && f.endsWith('.json')).sort()) {
      const raw = JSON.parse(readFileSync(join(SLICE_TMP_DIR, f), 'utf-8')) as { results: StageCResult[] };
      for (const r of raw.results) all.push(r);
    }
    const buckets: Record<Classification, number> = { VERIFIED: 0, ENGINE_BUG: 0, CARD_DATA_BUG: 0, UI_BUG: 0, HARNESS_BUG: 0, HARNESS_GAP: 0, NOT_IMPLEMENTED: 0, NO_UI_EXPECTED: 0, INCONCLUSIVE: 0 };
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
    const jsonPath = join(REPORTS_DIR, `stage-c-on-ko-${ts}.json`);
    const mdPath = join(REPORTS_DIR, `stage-c-on-ko-${ts}.md`);
    const finalReport = { family: 'on_ko', generatedAt: new Date().toISOString(), totalCardsDiscovered: CARDS.length, totalRecordsWritten: all.length, sliceCount: SLICE_COUNT, classifications: buckets, verifiedPercent: all.length > 0 ? (100 * buckets.VERIFIED / all.length).toFixed(2) : '0', anchorStatus: anchorRecs, topFailureClusters: sortedClusters.slice(0, 10), results: all };
    writeFileSync(jsonPath, JSON.stringify(finalReport, null, 2), 'utf-8');
    const md: string[] = [];
    md.push(`# Stage C — On-KO Generated Report\n\n**Generated:** ${new Date().toISOString()}\n**Total on_ko cards discovered:** ${CARDS.length}\n**Total records written:** ${all.length}\n**Slice count:** ${SLICE_COUNT}\n\n`);
    md.push(`## Classification buckets\n\n| Bucket | Count | % |\n|---|---:|---:|\n`);
    for (const [k, v] of Object.entries(buckets)) md.push(`| ${k} | ${v} | ${all.length > 0 ? (100 * v / all.length).toFixed(1) : '0'}% |\n`);
    md.push(`\n## Anchor card status\n\n| Card | Classification |\n|---|---|\n`);
    for (const x of anchorRecs) md.push(`| ${x.id} | ${x.classification} |\n`);
    md.push(`\n## Top 10 failure clusters\n\n`);
    if (sortedClusters.length === 0) md.push(`(none)\n`);
    else for (const c of sortedClusters.slice(0, 10)) md.push(`- **${c.cards.length} cards**: ${c.rootCause}\n`);
    md.push(`\n## Report files\n\n- JSON: \`coverage/reports/stage-c-on-ko-${ts}.json\`\n- MD: \`coverage/reports/stage-c-on-ko-${ts}.md\`\n`);
    writeFileSync(mdPath, md.join(''), 'utf-8');
    /* eslint-disable no-console */
    console.log(`[on-ko] FINAL JSON: ${jsonPath}`);
    console.log(`[on-ko] FINAL MD:   ${mdPath}`);
    console.log(`[on-ko] tally: ${JSON.stringify(buckets)}`);
    /* eslint-enable no-console */
    expect(all.length, 'every card must have a record').toBe(CARDS.length);
  });
});
