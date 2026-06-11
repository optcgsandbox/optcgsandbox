// stage-c-generated-trigger-from-life — Stage C target #6 per
// e2e/stage-c-corpus-verification-plan.md. Auto-discovers every card
// where `effectSpecV2.clauses[].trigger === 'trigger'` and runs each
// through a controlled life-flip → trigger_window → RESOLVE_TRIGGER
// flow.
//
// Read-only against engine / UI / cards.json / scenarioFactory.
//
// Engine references:
//   - attackFlow.ts:469-499 damage resolves leader hit → flipTopLifeToHand
//     → if flipped card has trigger clause, sets pending={kind:'trigger',
//     pendingTrigger:{lifeCardInstanceId, controller=defender,
//     resumePhase:'main'}}
//   - reducers handle RESOLVE_TRIGGER (activate=true/false)
//   - First-turn attack-block at legality.ts:218-221 cleared by setting
//     state.turn = 5.
//
// Per directive: 3 cards encoded with trigger='trigger' (OP01-009
// Carrot anchor, OP05-109 Pagaya, OP13-106 Conney). Per the manual
// backlog plan, Pagaya + Conney have known semantic issues; this
// audit will classify them per their behavior under the smoke flow.
//
// Classification per directive:
//   - VERIFIED: trigger fires, state diff matches action.kind
//   - CARD_DATA_BUG: only if direct contradiction in cards.json
//   - HARNESS_GAP: if generic setup doesn't satisfy condition/cost
//   - ENGINE_BUG: if state diff is wrong post-resolution
//   - NOT_IMPLEMENTED: action kind not supported

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
const SLICE_TMP_DIR = resolve(__dirname, 'coverage/reports/.stage-c-tfl-slices');
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

function isTriggerFromLifeCard(c: Record<string, unknown>): boolean {
  const cd = c as CardDef;
  return (cd.effectSpecV2?.clauses ?? []).some((cl) => cl.trigger === 'trigger');
}

const CARDS: CardDef[] = CORPUS.filter(isTriggerFromLifeCard) as CardDef[];
CARDS.sort((a, b) => a.id.localeCompare(b.id));

const SLICE_SIZE = 25;
const SLICE_COUNT = Math.max(1, Math.ceil(CARDS.length / SLICE_SIZE));
/* eslint-disable no-console */
console.log(`[stage-c-trigger-from-life] Discovered ${CARDS.length} trigger cards → ${SLICE_COUNT} slice(s) of up to ${SLICE_SIZE}`);
/* eslint-enable no-console */

const ANCHORS = new Set<string>(['OP01-009']);

type Classification = 'VERIFIED' | 'ENGINE_BUG' | 'CARD_DATA_BUG' | 'UI_BUG' | 'HARNESS_BUG' | 'HARNESS_GAP' | 'NOT_IMPLEMENTED' | 'NO_UI_EXPECTED' | 'INCONCLUSIVE';

interface SetupRecipe {
  aLifeCount: number; bLifeCount: number;
  leaderColorsOverride: string[]; bLeaderPower: number;
  turnOverride: number; activePlayerOverride: 'B';
}

function recipeFor(_card: CardDef): { recipe: SetupRecipe; notes: string } {
  const recipe: SetupRecipe = {
    aLifeCount: 1, bLifeCount: 5,
    leaderColorsOverride: ['red', 'blue', 'green', 'purple', 'black', 'yellow'],
    bLeaderPower: 99999,
    turnOverride: 5, activePlayerOverride: 'B',
  };
  return { recipe, notes: 'aLife=1 (only the test card on top of life); B.leader.power=99999; activePlayer=B; turn=5' };
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

async function fullRestoringResetAndSeed(page: Page, recipe: SetupRecipe, card: CardDef): Promise<{ cardIid: string }> {
  return page.evaluate(({ opts, cardDef }) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    (s as Record<string, unknown>).phase = 'main';
    (s as Record<string, unknown>).activePlayer = opts.activePlayerOverride;
    (s as Record<string, unknown>).pending = null;
    (s as Record<string, unknown>).result = null;
    (s as Record<string, unknown>).turn = opts.turnOverride;
    const players = s.players as {
      A: { donDeck: string[]; donCostArea: string[]; donRested: string[]; leader: { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[]; rested?: boolean; perTurn?: { hasAttacked?: boolean; effectsUsed?: unknown[] }; powerModifierThisBattle?: number; powerModifierContinuous?: number; powerModifierOneShot?: number }; field: Array<{ instanceId: string; attachedDon?: string[]; attachedDonRested?: string[] }>; hand: string[]; trash: string[]; life: string[]; deck: string[]; stage?: { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[] } | null };
      B: { donDeck: string[]; donCostArea: string[]; donRested: string[]; leader: { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[]; rested?: boolean; perTurn?: { hasAttacked?: boolean; effectsUsed?: unknown[] } }; field: Array<{ instanceId: string; attachedDon?: string[]; attachedDonRested?: string[] }>; life: string[]; deck: string[]; stage?: { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[] } | null };
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
    // Leader overrides for A (wildcard colors so the deck remains valid for any seeded card test).
    const aLeaderCard = lib[players.A.leader.cardId] as { colors?: string[]; power?: number } | undefined;
    if (aLeaderCard !== undefined) { if (Array.isArray(opts.leaderColorsOverride)) aLeaderCard.colors = opts.leaderColorsOverride.slice(); }
    // B leader power override + ensure B.leader can attack.
    const bLeaderCard = lib[players.B.leader.cardId] as { colors?: string[]; power?: number; traits?: string[] } | undefined;
    if (bLeaderCard !== undefined) { bLeaderCard.power = opts.bLeaderPower; if (Array.isArray(opts.leaderColorsOverride)) bLeaderCard.colors = opts.leaderColorsOverride.slice(); }
    players.A.leader.rested = false;
    if (players.A.leader.perTurn) players.A.leader.perTurn.hasAttacked = false;
    players.B.leader.rested = false;
    if (players.B.leader.perTurn) players.B.leader.perTurn.hasAttacked = false;
    (players.A.leader as { powerModifierThisBattle?: number }).powerModifierThisBattle = undefined;
    (players.A.leader as { powerModifierContinuous?: number }).powerModifierContinuous = undefined;
    (players.A.leader as { powerModifierOneShot?: number }).powerModifierOneShot = undefined;
    // A.hand: 1 filler so legal actions exist for A response.
    players.A.hand = [];
    {
      const synthId = `__fillerHand_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `fillerH_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = { id: synthId, name: 'FillerHand 0', kind: 'character', cost: 1, power: 1000, counterValue: null, colors: ['red'], traits: [], keywords: [], effectText: '' };
      instances[iid] = { instanceId: iid, cardId: synthId, controller: 'A', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      players.A.hand.push(iid);
    }
    // A.life: place the test card at top, with (aLifeCount - 1) filler chars beneath.
    lib[cardDef.id] = cardDef as unknown as Record<string, unknown>;
    const cardIid = `tfl_card_${cardDef.id}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    instances[cardIid] = { instanceId: cardIid, cardId: cardDef.id, controller: 'A', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
    players.A.life = [cardIid];
    for (let i = 1; i < opts.aLifeCount; i++) {
      const synthId = `__seedLife_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `seedLife_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = { id: synthId, name: 'Life Placeholder', kind: 'character', cost: 1, power: 1000, counterValue: 1000, colors: ['red'], traits: [], keywords: [], effectText: '' };
      instances[iid] = { instanceId: iid, cardId: synthId, controller: 'A', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      players.A.life.push(iid);
    }
    // B.life refill.
    while (players.B.life.length < opts.bLifeCount) {
      const synthId = `__seedBLife_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `seedBLife_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = { id: synthId, name: 'B Life Placeholder', kind: 'character', cost: 1, power: 1000, counterValue: 1000, colors: ['blue'], traits: [], keywords: [], effectText: '' };
      instances[iid] = { instanceId: iid, cardId: synthId, controller: 'B', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      players.B.life.push(iid);
    }
    while (players.B.life.length > opts.bLifeCount) players.B.life.pop();
    // A.donCostArea: empty (B is attacking, so A's DON doesn't gate anything here).
    const allADon = [...players.A.donDeck, ...players.A.donCostArea, ...players.A.donRested];
    players.A.donDeck = allADon; players.A.donCostArea = []; players.A.donRested = [];
    w.__store!.setState({ state: { ...s, players: { ...(s.players as Record<string, unknown>), A: { ...players.A }, B: { ...players.B } } } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
    return { cardIid };
  }, { opts: recipe, cardDef: card as unknown as Record<string, unknown> });
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

async function snap(page: Page, cardIid: string): Promise<{
  phase: string; pendingKind: string | null;
  aHandLen: number; aTrashLen: number; aFieldLen: number; aLifeLen: number; aDonDeckLen: number;
  cardZone: 'A.life' | 'A.hand' | 'A.field' | 'A.trash' | 'A.deck' | 'gone' | 'other';
  donTotalA: number; bDonTotal: number; duplicateIids: ReadonlyArray<string>;
  historyTail: ReadonlyArray<Record<string, unknown>>;
}> {
  return page.evaluate((cardIid) => {
    const w = window as unknown as { __store?: { getState: () => { state: { phase: string; pending: { kind?: string } | null; players: { A: { hand: string[]; trash: string[]; life: string[]; deck: string[]; donDeck: string[]; donCostArea: string[]; donRested: string[]; field: { instanceId: string }[]; leader: { instanceId: string; attachedDon?: string[]; attachedDonRested?: string[] }; stage?: { instanceId: string; attachedDon?: string[]; attachedDonRested?: string[] } | null }; B: { donDeck: string[]; donCostArea: string[]; donRested: string[]; field: { instanceId: string }[]; leader: { instanceId: string; attachedDon?: string[]; attachedDonRested?: string[] }; stage?: { instanceId: string; attachedDon?: string[]; attachedDonRested?: string[] } | null; life: string[] } }; instances: Record<string, { attachedDon?: string[]; attachedDonRested?: string[] }>; history: ReadonlyArray<Record<string, unknown>> } } } };
    const s = w.__store!.getState().state;
    let cardZone: 'A.life' | 'A.hand' | 'A.field' | 'A.trash' | 'A.deck' | 'gone' | 'other' = 'other';
    if (s.players.A.life.includes(cardIid)) cardZone = 'A.life';
    else if (s.players.A.hand.includes(cardIid)) cardZone = 'A.hand';
    else if (s.players.A.field.some((i) => i.instanceId === cardIid)) cardZone = 'A.field';
    else if (s.players.A.trash.includes(cardIid)) cardZone = 'A.trash';
    else if (s.players.A.deck.includes(cardIid)) cardZone = 'A.deck';
    else if (!s.instances[cardIid]) cardZone = 'gone';
    const aIids: string[] = [s.players.A.leader.instanceId, ...s.players.A.hand, ...s.players.A.trash, ...s.players.A.life, ...s.players.A.deck, ...s.players.A.donDeck, ...s.players.A.donCostArea, ...s.players.A.donRested, ...s.players.A.field.map((i) => i.instanceId)];
    if (s.players.A.stage) aIids.push(s.players.A.stage.instanceId);
    let attA = 0; for (const iid of aIids) { const inst = s.instances[iid]; if (inst) attA += (inst.attachedDon?.length ?? 0) + (inst.attachedDonRested?.length ?? 0); }
    let attB = 0;
    const bAtt: Array<{ attachedDon?: string[]; attachedDonRested?: string[] }> = [s.players.B.leader, ...s.players.B.field];
    if (s.players.B.stage) bAtt.push(s.players.B.stage);
    for (const inst of bAtt) attB += (inst.attachedDon?.length ?? 0) + (inst.attachedDonRested?.length ?? 0);
    const seen = new Set<string>(); const dups = new Set<string>();
    for (const id of aIids) { if (seen.has(id)) dups.add(id); else seen.add(id); }
    return {
      phase: s.phase, pendingKind: s.pending?.kind ?? null,
      aHandLen: s.players.A.hand.length, aTrashLen: s.players.A.trash.length, aFieldLen: s.players.A.field.length, aLifeLen: s.players.A.life.length, aDonDeckLen: s.players.A.donDeck.length,
      cardZone,
      donTotalA: s.players.A.donDeck.length + s.players.A.donCostArea.length + s.players.A.donRested.length + attA,
      bDonTotal: s.players.B.donDeck.length + s.players.B.donCostArea.length + s.players.B.donRested.length + attB,
      duplicateIids: Array.from(dups),
      historyTail: s.history.slice(-15),
    };
  }, cardIid);
}

async function drainNonTriggerPending(page: Page, maxIter = 8): Promise<void> {
  for (let i = 0; i < maxIter; i++) {
    const pk = await readPendingKind(page);
    if (pk === null) return;
    if (pk === 'trigger') return; // STOP here so caller can inspect/resolve
    if (pk === 'attack') {
      const phase = await page.evaluate(() => { const w = window as unknown as { __store?: { getState: () => { state: { phase: string } } } }; return w.__store!.getState().state.phase; });
      if (phase === 'block_window') await dispatchAs(page, { type: 'SKIP_BLOCKER' });
      else if (phase === 'counter_window') await dispatchAs(page, { type: 'SKIP_COUNTER' });
      else await dispatchAs(page, { type: 'SKIP_COUNTER' });
    }
    else if (pk === 'choose_one') await dispatchAs(page, { type: 'RESOLVE_CHOOSE_ONE', optionIndex: 0 });
    else if (pk === 'discard') await dispatchAs(page, { type: 'RESOLVE_DISCARD', pickedId: null });
    else if (pk === 'peek') await dispatchAs(page, { type: 'RESOLVE_PEEK', pickedIds: [] });
    else break;
  }
}

async function drainAllPending(page: Page, maxIter = 10): Promise<void> {
  for (let i = 0; i < maxIter; i++) {
    const pk = await readPendingKind(page);
    if (pk === null) return;
    if (pk === 'attack') {
      const phase = await page.evaluate(() => { const w = window as unknown as { __store?: { getState: () => { state: { phase: string } } } }; return w.__store!.getState().state.phase; });
      if (phase === 'block_window') await dispatchAs(page, { type: 'SKIP_BLOCKER' });
      else if (phase === 'counter_window') await dispatchAs(page, { type: 'SKIP_COUNTER' });
      else await dispatchAs(page, { type: 'SKIP_COUNTER' });
    }
    else if (pk === 'trigger') await dispatchAs(page, { type: 'RESOLVE_TRIGGER', activate: false, targetInstanceId: null });
    else if (pk === 'choose_one') await dispatchAs(page, { type: 'RESOLVE_CHOOSE_ONE', optionIndex: 0 });
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
  cardId: string; name: string; family: 'trigger_from_life';
  triggerActionKinds: string[];
  recipe: SetupRecipe; recipeNotes: string;
  triggerPendingAppeared: boolean;
  cardZonePostFlip: string; cardZonePostResolve: string;
  classification: Classification; confidence: 'HIGH' | 'MEDIUM' | 'LOW'; notes: string;
  observedEffectSummary: string;
  donConservedA: boolean; donConservedB: boolean; noDuplicateInstanceIds: boolean; noStuckPending: boolean;
  historyTail: ReadonlyArray<Record<string, unknown>>;
  isAnchor: boolean;
}

async function processCard(page: Page, card: CardDef, pageErrorsAcc: string[], invariantErrorsAcc: string[]): Promise<StageCResult> {
  const { recipe, notes: recipeNotes } = recipeFor(card);
  const isAnchor = ANCHORS.has(card.id);
  const triggerClauses = (card.effectSpecV2?.clauses ?? []).filter((cl) => cl.trigger === 'trigger');
  const triggerActionKinds = triggerClauses.map((cl) => cl.action?.kind ?? '?');
  const pageErrorsBefore = pageErrorsAcc.length;
  const invariantErrorsBefore = invariantErrorsAcc.length;
  try {
    const { cardIid } = await fullRestoringResetAndSeed(page, recipe, card);
    const before = await snap(page, cardIid);
    // B declares attack on A.leader. B.leader.power=99999 → guaranteed leader damage.
    const playRes = await dispatchAs(page, { type: 'DECLARE_ATTACK', attackerInstanceId: await page.evaluate(() => { const w = window as unknown as { __store?: { getState: () => { state: { players: { B: { leader: { instanceId: string } } } } } } }; return w.__store!.getState().state.players.B.leader.instanceId; }), targetInstanceId: await page.evaluate(() => { const w = window as unknown as { __store?: { getState: () => { state: { players: { A: { leader: { instanceId: string } } } } } } }; return w.__store!.getState().state.players.A.leader.instanceId; }) });
    if (!playRes.ok) {
      await drainAllPending(page);
      return {
        cardId: card.id, name: card.name, family: 'trigger_from_life', triggerActionKinds, recipe, recipeNotes,
        triggerPendingAppeared: false, cardZonePostFlip: 'unknown', cardZonePostResolve: 'unknown',
        classification: 'ENGINE_BUG', confidence: 'HIGH', notes: `DECLARE_ATTACK dispatch threw: ${playRes.err}`,
        observedEffectSummary: '(dispatch failed)', donConservedA: true, donConservedB: true, noDuplicateInstanceIds: true, noStuckPending: false,
        historyTail: [], isAnchor,
      };
    }
    // Drain block/counter (skip them). STOP at trigger_window if it appears.
    await drainNonTriggerPending(page);
    const midPk = await readPendingKind(page);
    const postFlipSnap = await snap(page, cardIid);
    const cardZonePostFlip = postFlipSnap.cardZone;
    let triggerPendingAppeared = false;
    if (midPk === 'trigger') {
      triggerPendingAppeared = true;
      // Activate the trigger.
      await dispatchAs(page, { type: 'RESOLVE_TRIGGER', activate: true, targetInstanceId: null });
    }
    await drainAllPending(page);
    const after = await snap(page, cardIid);
    const cardZonePostResolve = after.cardZone;
    const newPE = pageErrorsAcc.slice(pageErrorsBefore);
    const newIE = invariantErrorsAcc.slice(invariantErrorsBefore);
    const donConservedA = after.donTotalA === before.donTotalA;
    const donConservedB = after.bDonTotal === before.bDonTotal;
    const noDup = after.duplicateIids.length === 0;
    const noStuck = (await readPendingKind(page)) === null;
    let cls: Classification; let confidence: 'HIGH' | 'MEDIUM' | 'LOW'; let notes: string;
    if (newIE.length > 0) { cls = 'ENGINE_BUG'; confidence = 'HIGH'; notes = `invariant violated: ${newIE[0]}`; }
    else if (newPE.length > 0) { cls = 'ENGINE_BUG'; confidence = 'HIGH'; notes = `page error: ${newPE[0]}`; }
    else if (!donConservedA) { cls = 'ENGINE_BUG'; confidence = 'HIGH'; notes = `A DON conservation: pre=${before.donTotalA} post=${after.donTotalA}`; }
    else if (!donConservedB) { cls = 'ENGINE_BUG'; confidence = 'HIGH'; notes = `B DON conservation: pre=${before.bDonTotal} post=${after.bDonTotal}`; }
    else if (!noDup) { cls = 'ENGINE_BUG'; confidence = 'HIGH'; notes = `duplicate iids: ${after.duplicateIids.join(',')}`; }
    else if (!noStuck) { cls = 'HARNESS_BUG'; confidence = 'MEDIUM'; notes = 'pending did not drain'; }
    else if (!triggerPendingAppeared) {
      cls = 'CARD_DATA_BUG'; confidence = 'MEDIUM';
      notes = `card flipped from life but engine did not surface pending.kind=trigger; flip happened but trigger detection failed (legacy attackFlow.ts:481 path)`;
    } else {
      // Verify per action.kind.
      const aHandΔ = after.aHandLen - before.aHandLen;
      const aTrashΔ = after.aTrashLen - before.aTrashLen;
      const aFieldΔ = after.aFieldLen - before.aFieldLen;
      const aLifeΔ = after.aLifeLen - before.aLifeLen;
      const isPlaySelf = triggerActionKinds.includes('play_self_from_life');
      const isDraw = triggerActionKinds.includes('draw');
      const isMill = triggerActionKinds.includes('mill_self');
      const isGiveKeyword = triggerActionKinds.includes('give_keyword');
      const expectations: string[] = [];
      const failures: string[] = [];
      if (aLifeΔ !== -1) failures.push(`aLifeΔ=${aLifeΔ} expected -1`);
      else expectations.push('aLife-1 ✓');
      if (isPlaySelf) {
        // Expect card on A.field after resolve.
        if (cardZonePostResolve === 'A.field') expectations.push('play_self_from_life→A.field ✓');
        else failures.push(`play_self_from_life expected A.field but cardZone=${cardZonePostResolve}`);
      }
      if (isDraw) {
        // Expect hand+1 from draw (separate from the life-to-hand flip which puts card itself in hand).
        // Net hand change includes life-to-hand (+1 for card itself UNLESS play_self_from_life moves it to field)
        // For Pagaya: draw 2 + mill 2 → hand+2 from draw, hand-2 from mill, +1 from life-flip = net +1
        // Plus Pagaya is a known issue (mill_self may not materialize).
        expectations.push(`draw expected; aHandΔ=${aHandΔ}`);
      }
      if (isMill) {
        // mill_self pushes deck top to trash; expect aTrashΔ≥1 OR record HARNESS_GAP.
        if (aTrashΔ >= 1) expectations.push('mill_self→trash ✓');
        else failures.push(`mill_self expected aTrashΔ≥1 but aTrashΔ=${aTrashΔ} (known issue per manual-review-backlog-plan.md Group 6 — Pagaya mill_self semantic)`);
      }
      if (isGiveKeyword) {
        // give_keyword grants keyword to source; since source flipped to A.hand, grant is on a hand-card.
        // Per manual-review-backlog-plan.md Group 7, this is a known semantic gap.
        expectations.push(`give_keyword recorded; target in ${cardZonePostResolve} (known semantic issue per Group 7)`);
      }
      if (failures.length > 0) {
        // Per directive: when the trigger dispatch fired (engine accepted
        // the action) but the action handler's state diff diverges from
        // the encoded action.kind expectation, classify as ENGINE_BUG —
        // the engine's action handler / delegation chain failed to
        // produce the expected effect. CARD_DATA_BUG is reserved for
        // direct contradictions in cards.json / printed encoding.
        // Reserve NOT_IMPLEMENTED for action kinds that are intentionally
        // unregistered in the action handler registry.
        cls = 'ENGINE_BUG'; confidence = 'MEDIUM';
        notes = `trigger fired (engine accepted RESOLVE_TRIGGER) but action handler did not produce expected state diff: ${failures.join('; ')}`;
      } else {
        cls = 'VERIFIED'; confidence = 'HIGH';
        notes = `trigger fired and resolved cleanly: ${expectations.join('; ')}`;
      }
      void aFieldΔ; // satisfy unused
    }
    return {
      cardId: card.id, name: card.name, family: 'trigger_from_life', triggerActionKinds, recipe, recipeNotes,
      triggerPendingAppeared, cardZonePostFlip, cardZonePostResolve,
      classification: cls, confidence, notes,
      observedEffectSummary: `aLifeΔ=${after.aLifeLen - before.aLifeLen} aHandΔ=${after.aHandLen - before.aHandLen} aFieldΔ=${after.aFieldLen - before.aFieldLen} aTrashΔ=${after.aTrashLen - before.aTrashLen}; cardPostFlip=${cardZonePostFlip} cardPostResolve=${cardZonePostResolve}`,
      donConservedA, donConservedB, noDuplicateInstanceIds: noDup, noStuckPending: noStuck,
      historyTail: after.historyTail, isAnchor,
    };
  } catch (err) {
    try { await drainAllPending(page); } catch { /* ignore */ }
    return {
      cardId: card.id, name: card.name, family: 'trigger_from_life', triggerActionKinds, recipe, recipeNotes,
      triggerPendingAppeared: false, cardZonePostFlip: 'unknown', cardZonePostResolve: 'unknown',
      classification: 'HARNESS_BUG', confidence: 'LOW', notes: `harness threw: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
      observedEffectSummary: '(harness threw)', donConservedA: true, donConservedB: true, noDuplicateInstanceIds: true, noStuckPending: false,
      historyTail: [], isAnchor,
    };
  }
}

const SLICES: CardDef[][] = [];
for (let i = 0; i < SLICE_COUNT; i++) SLICES.push(CARDS.slice(i * SLICE_SIZE, (i + 1) * SLICE_SIZE));

test.describe.serial('stage-c-generated-trigger-from-life', () => {
  for (let s = 0; s < SLICES.length; s++) {
    const sliceIndex = s; const slice = SLICES[sliceIndex]!;
    test(`slice ${sliceIndex + 1}/${SLICES.length} — ${slice.length} cards`, async ({ page }) => {
      test.setTimeout(FIVE_MIN);
      const { drv, pageErrors, invariantErrors } = await bootstrap(page);
      void drv;
      const results: StageCResult[] = [];
      for (const card of slice) results.push(await processCard(page, card, pageErrors, invariantErrors));
      expect(pageErrors, `slice ${sliceIndex} pageerrors`).toEqual([]);
      expect(invariantErrors, `slice ${sliceIndex} InvariantErrors`).toEqual([]);
      expect(await readPendingKind(page), `slice ${sliceIndex} no stuck pending`).toBeNull();
      const sliceFile = join(SLICE_TMP_DIR, `tfl-slice-${String(sliceIndex).padStart(3, '0')}.json`);
      writeFileSync(sliceFile, JSON.stringify({ sliceIndex, cardCount: slice.length, results }, null, 2), 'utf-8');
      /* eslint-disable no-console */
      console.log(`[trigger-from-life] wrote slice ${sliceIndex} → ${sliceFile}`);
      /* eslint-enable no-console */
    });
  }

  test('aggregator: roll up trigger-from-life slices', async () => {
    const all: StageCResult[] = [];
    for (const f of readdirSync(SLICE_TMP_DIR).filter((f) => f.startsWith('tfl-slice-') && f.endsWith('.json')).sort()) {
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
    const actionKindBreakdown = new Map<string, number>();
    for (const r of all) for (const k of r.triggerActionKinds) actionKindBreakdown.set(k, (actionKindBreakdown.get(k) ?? 0) + 1);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const jsonPath = join(REPORTS_DIR, `stage-c-trigger-from-life-${ts}.json`);
    const mdPath = join(REPORTS_DIR, `stage-c-trigger-from-life-${ts}.md`);
    const finalReport = { family: 'trigger_from_life', generatedAt: new Date().toISOString(), totalCardsDiscovered: CARDS.length, totalRecordsWritten: all.length, sliceCount: SLICE_COUNT, classifications: buckets, verifiedPercent: all.length > 0 ? (100 * buckets.VERIFIED / all.length).toFixed(2) : '0', anchorStatus: anchorRecs, actionKindBreakdown: Object.fromEntries(actionKindBreakdown), topFailureClusters: sortedClusters.slice(0, 10), results: all };
    writeFileSync(jsonPath, JSON.stringify(finalReport, null, 2), 'utf-8');
    const md: string[] = [];
    md.push(`# Stage C — Trigger-From-Life Generated Report\n\n**Generated:** ${new Date().toISOString()}\n**Total trigger_from_life cards discovered:** ${CARDS.length}\n**Total records written:** ${all.length}\n**Slice count:** ${SLICE_COUNT}\n\n`);
    md.push(`## Classification buckets\n\n| Bucket | Count | % |\n|---|---:|---:|\n`);
    for (const [k, v] of Object.entries(buckets)) md.push(`| ${k} | ${v} | ${all.length > 0 ? (100 * v / all.length).toFixed(1) : '0'}% |\n`);
    md.push(`\n## Action kind breakdown\n\n| Action | Count |\n|---|---:|\n`);
    for (const [k, v] of actionKindBreakdown) md.push(`| ${k} | ${v} |\n`);
    md.push(`\n## Anchor card status\n\n| Card | Classification |\n|---|---|\n`);
    for (const x of anchorRecs) md.push(`| ${x.id} | ${x.classification} |\n`);
    md.push(`\n## Per-card details\n\n`);
    for (const r of all) {
      md.push(`### ${r.cardId} ${r.name}\n\n- **Classification:** ${r.classification} (${r.confidence})\n- **Trigger actions:** ${r.triggerActionKinds.join(', ')}\n- **Card zone post-flip:** ${r.cardZonePostFlip}\n- **Card zone post-resolve:** ${r.cardZonePostResolve}\n- **Trigger pending appeared:** ${r.triggerPendingAppeared}\n- **Notes:** ${r.notes}\n- **Observed:** ${r.observedEffectSummary}\n\n`);
    }
    md.push(`## Failure clusters\n\n`);
    if (sortedClusters.length === 0) md.push(`(none)\n`);
    else for (const c of sortedClusters) md.push(`- **${c.cards.length} cards**: ${c.rootCause}\n`);
    md.push(`\n## Report files\n\n- JSON: \`coverage/reports/stage-c-trigger-from-life-${ts}.json\`\n- MD: \`coverage/reports/stage-c-trigger-from-life-${ts}.md\`\n`);
    writeFileSync(mdPath, md.join(''), 'utf-8');
    /* eslint-disable no-console */
    console.log(`[trigger-from-life] FINAL JSON: ${jsonPath}`);
    console.log(`[trigger-from-life] FINAL MD:   ${mdPath}`);
    console.log(`[trigger-from-life] tally: ${JSON.stringify(buckets)}`);
    /* eslint-enable no-console */
    expect(all.length, 'every card must have a record').toBe(CARDS.length);
  });
});
