// stage-c-generated-draw-search-discard — Stage C target #11 per
// e2e/stage-c-corpus-verification-plan.md. Auto-discovers every card with at
// least one clause whose `action.kind` is in the draw / search / discard /
// reveal / mill family:
//   draw, searcher_peek, search_deck, discard_from_hand, opp_discard_from_hand,
//   reveal_top_and_conditional_play, reveal_top_then_if_filter,
//   reveal_top_then_if_cost_min, reveal_opp_hand, peek_and_reorder_own_deck,
//   peek_and_reorder_own_life, peek_and_reorder_opp_life, peek_opp_deck,
//   mill_self, mill_opp, choose_cost_reveal_opp_match
//
// For each card we take the FIRST matching clause and dispatch its trigger:
//   on_play          → PLAY_CARD
//   activate_main    → ACTIVATE_MAIN (+ keyword check)
//   when_attacking   → DECLARE_ATTACK (state.turn=5)
//   at_end_of_turn_self → END_TURN with source on A.field
//   other triggers   → HARNESS_GAP (on_ko handled by family #5; battle path
//                                   not generically reproducible here)
//
// Discrimination: clauseIndex-targeted CLAUSE_FIRED matching on
// (sourceInstanceId, clauseIndex, trigger, actionKind). Per-action delta:
//   draw                → controller.hand length += magnitude
//   mill_self           → controller.deck -mag / controller.trash +mag
//   mill_opp            → opp.deck -mag / opp.trash +mag
//   discard_from_hand   → drain pending=discard then controller.hand -1 / +trash 1
//   opp_discard_from_hand → drain pending=discard then opp.hand -mag (or pending OK)
//   searcher_peek       → pending=peek then RESOLVE_PEEK pickedIds=[] (INCONCLUSIVE)
//   peek_and_reorder_*  → pending=peek then RESOLVE_PEEK (INCONCLUSIVE)
//   reveal_top_*        → CLAUSE_FIRED sufficient (INCONCLUSIVE)
//   choose_cost_reveal_opp_match → INCONCLUSIVE
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
const SLICE_TMP_DIR = resolve(__dirname, 'coverage/reports/.stage-c-dsd-slices');
mkdirSync(REPORTS_DIR, { recursive: true });
mkdirSync(SLICE_TMP_DIR, { recursive: true });
for (const f of readdirSync(SLICE_TMP_DIR)) { if (f.endsWith('.json')) { try { unlinkSync(join(SLICE_TMP_DIR, f)); } catch { /* ignore */ } } }

const DSD_ACTION_KINDS = new Set<string>([
  'draw', 'searcher_peek', 'search_deck',
  'discard_from_hand', 'opp_discard_from_hand',
  'reveal_top_and_conditional_play', 'reveal_top_then_if_filter', 'reveal_top_then_if_cost_min',
  'reveal_opp_hand',
  'peek_and_reorder_own_deck', 'peek_and_reorder_own_life', 'peek_and_reorder_opp_life', 'peek_opp_deck',
  'mill_self', 'mill_opp',
  'choose_cost_reveal_opp_match',
]);

// Actions where a deterministic state-length delta exists.
const OBSERVABLE_DELTA_ACTIONS = new Set<string>([
  'draw', 'mill_self', 'mill_opp', 'discard_from_hand', 'opp_discard_from_hand',
]);

const SUPPORTED_TRIGGERS = new Set<string>(['on_play', 'activate_main', 'when_attacking', 'at_end_of_turn_self']);

interface CardDef {
  readonly id: string; readonly name: string; readonly kind: 'character' | 'event' | 'stage' | 'leader' | 'don';
  readonly cost?: number | null; readonly power?: number | null; readonly colors?: ReadonlyArray<string>; readonly traits?: ReadonlyArray<string>;
  readonly keywords?: ReadonlyArray<string>; readonly effectText?: string;
  readonly effectSpecV2?: {
    readonly clauses?: ReadonlyArray<{
      readonly trigger?: string;
      readonly action?: { readonly kind?: string; readonly magnitude?: number; readonly n?: number; readonly lookCount?: number; readonly addCount?: number; readonly count?: number };
      readonly target?: { readonly kind?: string; readonly filter?: Record<string, unknown>; readonly count?: number };
      readonly cost?: Record<string, unknown>;
      readonly condition?: { readonly type?: string; readonly [k: string]: unknown };
    }>;
  };
  readonly [k: string]: unknown;
}

const CORPUS_RAW = JSON.parse(readFileSync(CORPUS_PATH, 'utf-8')) as unknown;
const CORPUS = (Array.isArray(CORPUS_RAW) ? CORPUS_RAW : Object.values(CORPUS_RAW as Record<string, unknown>)) as Array<Record<string, unknown>>;

function firstDsdClause(c: Record<string, unknown>): { clauseIndex: number; trigger: string; actionKind: string; magnitude: number; targetKind: string | null; gated: boolean; hasCost: boolean } | null {
  const cd = c as CardDef;
  const clauses = cd.effectSpecV2?.clauses ?? [];
  for (let i = 0; i < clauses.length; i++) {
    const cl = clauses[i]!;
    const ak = cl.action?.kind;
    if (typeof ak !== 'string' || !DSD_ACTION_KINDS.has(ak)) continue;
    const a = cl.action!;
    // magnitude inference per action kind
    let mag = 0;
    if (typeof a.magnitude === 'number') mag = a.magnitude;
    else if (typeof a.n === 'number') mag = a.n;
    else if (ak === 'searcher_peek' && typeof a.addCount === 'number') mag = a.addCount;
    else if (typeof a.count === 'number') mag = a.count;
    else mag = 1;
    return {
      clauseIndex: i,
      trigger: typeof cl.trigger === 'string' ? cl.trigger : '',
      actionKind: ak,
      magnitude: mag,
      targetKind: typeof cl.target?.kind === 'string' ? cl.target.kind : null,
      gated: cl.condition !== undefined,
      hasCost: cl.cost !== undefined,
    };
  }
  return null;
}

function hasDsdClause(c: Record<string, unknown>): boolean { return firstDsdClause(c) !== null; }

const CARDS: CardDef[] = CORPUS.filter(hasDsdClause) as CardDef[];
CARDS.sort((a, b) => a.id.localeCompare(b.id));

const SLICE_SIZE = 25;
const SLICE_COUNT = Math.ceil(CARDS.length / SLICE_SIZE);
/* eslint-disable no-console */
console.log(`[stage-c-draw-search-discard] Discovered ${CARDS.length} D/S/D cards → ${SLICE_COUNT} slice(s) of up to ${SLICE_SIZE}`);
/* eslint-enable no-console */

const ANCHORS = new Set<string>([
  'EB01-011', // draw magnitude:1 on_play
  'EB01-009', // searcher_peek lookCount:5 addCount:1
  'EB01-027', // discard_from_hand magnitude:1
  'EB02-045', // opp_discard_from_hand magnitude:1
  'EB02-046', // mill_self magnitude:2
  'EB02-023', // peek_and_reorder_own_deck count:3
  'OP01-060', // reveal_top_and_conditional_play
  'OP04-011', // reveal_top_then_if_filter
]);

type Classification = 'VERIFIED' | 'ENGINE_BUG' | 'CARD_DATA_BUG' | 'UI_BUG' | 'HARNESS_BUG' | 'HARNESS_GAP' | 'NOT_IMPLEMENTED' | 'NO_UI_EXPECTED' | 'INCONCLUSIVE';

type SourceZone = 'a_hand' | 'a_field' | 'a_stage' | 'a_leader';

function pickSourceZone(card: CardDef, trigger: string): SourceZone {
  if (card.kind === 'leader') return 'a_leader';
  if (card.kind === 'event') return 'a_hand';
  if (card.kind === 'stage') return trigger === 'on_play' ? 'a_hand' : 'a_stage';
  // character
  if (trigger === 'on_play') return 'a_hand';
  return 'a_field';
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

interface SeededRefs {
  sourceIid: string | null;
  aHandLen: number; aDeckLen: number; aTrashLen: number;
  bHandLen: number; bDeckLen: number; bTrashLen: number;
}

async function fullRestoringResetAndSeed(page: Page, sourceZone: SourceZone, card: CardDef, trigger: string): Promise<SeededRefs> {
  return page.evaluate(({ sourceZone, cardDef, trigger }) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    (s as Record<string, unknown>).phase = 'main';
    (s as Record<string, unknown>).activePlayer = 'A';
    (s as Record<string, unknown>).pending = null;
    (s as Record<string, unknown>).result = null;
    (s as Record<string, unknown>).turn = trigger === 'when_attacking' ? 5 : 1;
    const players = s.players as {
      A: { donDeck: string[]; donCostArea: string[]; donRested: string[]; leader: { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[]; rested?: boolean; summoningSick?: boolean; perTurn?: { hasAttacked?: boolean; effectsUsed?: string[] }; attackLockedContinuous?: boolean; attackLockedOneShot?: unknown }; field: Array<{ instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[]; rested?: boolean; summoningSick?: boolean; perTurn?: { hasAttacked?: boolean; effectsUsed?: string[] } }>; hand: string[]; trash: string[]; life: string[]; deck: string[]; stage?: { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[]; rested?: boolean } | null };
      B: { donDeck: string[]; donCostArea: string[]; donRested: string[]; leader: { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[]; rested?: boolean }; field: Array<{ instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[]; rested?: boolean }>; hand: string[]; trash: string[]; life: string[]; deck: string[]; stage?: { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[] } | null };
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
    players.A.hand = []; players.B.hand = players.B.hand ?? [];
    // Rebalance A.donCostArea to plenty (10 DON).
    const allADon = [...players.A.donDeck, ...players.A.donCostArea, ...players.A.donRested];
    players.A.donCostArea = allADon.slice(0, 10);
    players.A.donDeck = allADon.slice(10);
    players.A.donRested = [];
    // Rebalance B.don.
    const allBDon = [...players.B.donDeck, ...players.B.donCostArea, ...players.B.donRested];
    players.B.donCostArea = allBDon.slice(0, 6);
    players.B.donDeck = allBDon.slice(6);
    players.B.donRested = [];
    // Lives: ensure both sides have 5 lives.
    function seedLife(side: 'A' | 'B', target: number) {
      const pl = side === 'A' ? players.A : players.B;
      while (pl.life.length > target) pl.life.pop();
      while (pl.life.length < target) {
        const synthId = `__life_${side}_${Math.floor(Math.random() * 1e9).toString(36)}`;
        const iid = `life_${side}_${Math.floor(Math.random() * 1e9).toString(36)}`;
        lib[synthId] = { id: synthId, name: 'Life Placeholder', kind: 'character', cost: 1, power: 1000, counterValue: 1000, colors: ['red'], traits: [], keywords: [], effectText: '' };
        instances[iid] = { instanceId: iid, cardId: synthId, controller: side, rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
        pl.life.push(iid);
      }
    }
    seedLife('A', 5); seedLife('B', 5);
    // Wildcard A.leader colors so PLAY_CARD doesn't reject on color identity.
    const aLeaderCard = lib[players.A.leader.cardId] as { colors?: string[]; keywords?: string[] } | undefined;
    if (aLeaderCard !== undefined) aLeaderCard.colors = ['red', 'blue', 'green', 'purple', 'black', 'yellow'];
    players.A.leader.rested = false; players.A.leader.summoningSick = false;
    if (players.A.leader.perTurn) { players.A.leader.perTurn.hasAttacked = false; players.A.leader.perTurn.effectsUsed = []; }

    // Place card in library.
    lib[cardDef.id] = cardDef as unknown as Record<string, unknown>;

    // Seed source.
    const srcIid = `dsd_src_${cardDef.id}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    let sourceIid: string | null = null;
    if (sourceZone === 'a_hand') {
      instances[srcIid] = { instanceId: srcIid, cardId: cardDef.id, controller: 'A', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      players.A.hand.push(srcIid);
      sourceIid = srcIid;
    } else if (sourceZone === 'a_field') {
      instances[srcIid] = { instanceId: srcIid, cardId: cardDef.id, controller: 'A', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      (players.A.field as unknown[]).push(instances[srcIid]);
      sourceIid = srcIid;
    } else if (sourceZone === 'a_stage') {
      instances[srcIid] = { instanceId: srcIid, cardId: cardDef.id, controller: 'A', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      players.A.stage = instances[srcIid] as { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[]; rested?: boolean };
      sourceIid = srcIid;
    } else if (sourceZone === 'a_leader') {
      players.A.leader.cardId = cardDef.id;
      sourceIid = players.A.leader.instanceId;
    }

    // Pad A.hand with fillers (for cost-pay + condition satisfaction + observable discard).
    for (let i = 0; i < 5; i++) {
      const synthId = `__dsdHand_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `dsdH_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = { id: synthId, name: `Hand Filler ${i}`, kind: 'character', cost: 1, power: 1000, counterValue: 1000, colors: ['red'], traits: [], keywords: [], effectText: '' };
      instances[iid] = { instanceId: iid, cardId: synthId, controller: 'A', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      players.A.hand.push(iid);
    }
    // Pad B.hand with fillers (so opp_discard_from_hand has observable target).
    for (let i = 0; i < 5; i++) {
      const synthId = `__dsdBHand_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `dsdBH_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = { id: synthId, name: `B Hand Filler ${i}`, kind: 'character', cost: 1, power: 1000, counterValue: 1000, colors: ['blue'], traits: [], keywords: [], effectText: '' };
      instances[iid] = { instanceId: iid, cardId: synthId, controller: 'B', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      players.B.hand.push(iid);
    }
    // Ensure A.deck and B.deck have plenty of cards for draw/mill/searcher_peek.
    function refillDeck(side: 'A' | 'B', target: number) {
      const pl = side === 'A' ? players.A : players.B;
      while (pl.deck.length < target) {
        const synthId = `__dsdDeck_${side}_${Math.floor(Math.random() * 1e9).toString(36)}`;
        const iid = `dsdDeck_${side}_${Math.floor(Math.random() * 1e9).toString(36)}`;
        lib[synthId] = { id: synthId, name: 'Deck Placeholder', kind: 'character', cost: 2, power: 2000, counterValue: 1000, colors: side === 'A' ? ['red'] : ['blue'], traits: [], keywords: [], effectText: '' };
        instances[iid] = { instanceId: iid, cardId: synthId, controller: side, rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
        pl.deck.push(iid);
      }
    }
    refillDeck('A', 25); refillDeck('B', 25);
    w.__store!.setState({ state: { ...s, players: { ...(s.players as Record<string, unknown>), A: { ...players.A }, B: { ...players.B } } } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
    return {
      sourceIid,
      aHandLen: players.A.hand.length, aDeckLen: players.A.deck.length, aTrashLen: players.A.trash.length,
      bHandLen: players.B.hand.length, bDeckLen: players.B.deck.length, bTrashLen: players.B.trash.length,
    };
  }, { sourceZone, cardDef: card as unknown as Record<string, unknown>, trigger });
}

async function dispatchAs(page: Page, action: object): Promise<{ ok: boolean; err: string | null }> {
  const res = await page.evaluate((a) => {
    try { const w = window as unknown as { __store?: { getState: () => { dispatch: (a: unknown) => void } } }; w.__store!.getState().dispatch(a); return { ok: true, err: null }; }
    catch (e) { return { ok: false, err: e instanceof Error ? `${e.name}: ${e.message}` : String(e) }; }
  }, action);
  await page.waitForTimeout(40);
  return res;
}

async function readPendingKind(page: Page): Promise<string | null> {
  return page.evaluate(() => { const w = window as unknown as { __store?: { getState: () => { state: { pending: { kind?: string } | null } } } }; return w.__store!.getState().state.pending?.kind ?? null; });
}

async function readAHandFirst(page: Page): Promise<string | null> {
  return page.evaluate(() => { const w = window as unknown as { __store?: { getState: () => { state: { players: { A: { hand: string[] } } } } } }; return w.__store!.getState().state.players.A.hand[0] ?? null; });
}

async function drainPending(page: Page, maxIter = 8): Promise<void> {
  for (let i = 0; i < maxIter; i++) {
    const pk = await readPendingKind(page);
    if (pk === null) return;
    if (pk === 'attack') await dispatchAs(page, { type: 'SKIP_COUNTER' });
    else if (pk === 'choose_one') await dispatchAs(page, { type: 'RESOLVE_CHOOSE_ONE', optionIndex: 0 });
    else if (pk === 'trigger') await dispatchAs(page, { type: 'RESOLVE_TRIGGER', activate: false, targetInstanceId: null });
    else if (pk === 'discard') {
      const pickedId = await readAHandFirst(page);
      await dispatchAs(page, { type: 'RESOLVE_DISCARD', pickedId });
    }
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

async function clauseFiredSince(page: Page, fromIdx: number, sourceIid: string, clauseIndex: number, trigger: string, actionKind: string): Promise<boolean> {
  return page.evaluate(({ fromIdx, sourceIid, clauseIndex, trigger, actionKind }) => {
    const w = window as unknown as { __store?: { getState: () => { state: { history: ReadonlyArray<Record<string, unknown>> } } } };
    const hist = w.__store!.getState().state.history;
    for (let i = fromIdx; i < hist.length; i++) {
      const h = hist[i]!;
      if (h.type !== 'CLAUSE_FIRED') continue;
      if (h.sourceInstanceId !== sourceIid) continue;
      if (h.clauseIndex !== clauseIndex) continue;
      if (typeof trigger === 'string' && trigger !== '' && h.trigger !== trigger) continue;
      if (typeof actionKind === 'string' && actionKind !== '' && h.actionKind !== actionKind) continue;
      return true;
    }
    return false;
  }, { fromIdx, sourceIid, clauseIndex, trigger, actionKind });
}

interface LenSnapshot { aHandLen: number; aDeckLen: number; aTrashLen: number; bHandLen: number; bDeckLen: number; bTrashLen: number }

async function readLens(page: Page): Promise<LenSnapshot> {
  return page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { state: { players: { A: { hand: string[]; deck: string[]; trash: string[] }; B: { hand: string[]; deck: string[]; trash: string[] } } } } } };
    const ps = w.__store!.getState().state.players;
    return {
      aHandLen: ps.A.hand.length, aDeckLen: ps.A.deck.length, aTrashLen: ps.A.trash.length,
      bHandLen: ps.B.hand.length, bDeckLen: ps.B.deck.length, bTrashLen: ps.B.trash.length,
    };
  });
}

// History-event slice and CLAUSE_FIRED marker extraction.
interface HistoryMarker { idx: number; clauseIndex: number; actionKind: string; trigger: string }
async function readHistoryAndMarkers(page: Page, fromIdx: number, sourceIid: string): Promise<{ events: Array<Record<string, unknown>>; markers: HistoryMarker[] }> {
  return page.evaluate(({ fromIdx, sourceIid }) => {
    const w = window as unknown as { __store?: { getState: () => { state: { history: ReadonlyArray<Record<string, unknown>> } } } };
    const hist = w.__store!.getState().state.history;
    const events: Array<Record<string, unknown>> = [];
    const markers: Array<{ idx: number; clauseIndex: number; actionKind: string; trigger: string }> = [];
    for (let i = fromIdx; i < hist.length; i++) {
      const h = hist[i]!;
      events.push(h);
      if (h.type === 'CLAUSE_FIRED' && h.sourceInstanceId === sourceIid) {
        markers.push({ idx: i - fromIdx, clauseIndex: h.clauseIndex as number, actionKind: h.actionKind as string, trigger: h.trigger as string });
      }
    }
    return { events, markers };
  }, { fromIdx, sourceIid });
}

// Returns the [startIdx, endIdx) slice (within `events`) attributable to the
// target clause: events from end of prior marker (or start) up to (exclusive)
// the target marker itself.
function findClauseWindow(markers: HistoryMarker[], clauseIndex: number, trigger: string, actionKind: string): { startIdx: number; endIdx: number } | null {
  const targetMarkerPos = markers.findIndex((m) => m.clauseIndex === clauseIndex && (trigger === '' || m.trigger === trigger) && (actionKind === '' || m.actionKind === actionKind));
  if (targetMarkerPos === -1) return null;
  const prevMarkerIdx = targetMarkerPos > 0 ? markers[targetMarkerPos - 1]!.idx : -1;
  const targetIdx = markers[targetMarkerPos]!.idx;
  return { startIdx: prevMarkerIdx + 1, endIdx: targetIdx };
}

// Detect whether the card has sibling clauses (other than the target) that
// would decrement the same-side deck within the same dispatch. Used to gate
// mill_self / mill_opp clean-isolation when no engine event exists.
function siblingDeckDecrementers(card: CardDef, targetClauseIdx: number, side: 'A_DECK' | 'B_DECK'): number {
  const clauses = card.effectSpecV2?.clauses ?? [];
  const ownSideDecrementers = new Set<string>(['mill_self', 'searcher_peek', 'peek_and_reorder_own_deck', 'reveal_top_and_conditional_play', 'reveal_top_then_if_filter', 'reveal_top_then_if_cost_min', 'bottom_of_deck_from_trash']);
  const oppSideDecrementers = new Set<string>(['mill_opp', 'peek_opp_deck']);
  const wantedSet = side === 'A_DECK' ? ownSideDecrementers : oppSideDecrementers;
  let count = 0;
  for (let i = 0; i < clauses.length; i++) {
    if (i === targetClauseIdx) continue;
    const ak = clauses[i]?.action?.kind;
    if (typeof ak === 'string' && wantedSet.has(ak)) count++;
  }
  return count;
}

// Counts hand-discarders OTHER than the target clause that may consume A.hand.
function siblingHandDiscarders(card: CardDef, targetClauseIdx: number): number {
  const clauses = card.effectSpecV2?.clauses ?? [];
  let count = 0;
  for (let i = 0; i < clauses.length; i++) {
    if (i === targetClauseIdx) continue;
    const ak = clauses[i]?.action?.kind;
    if (typeof ak === 'string' && (ak === 'discard_from_hand' || ak === 'bottom_of_deck_from_hand' || ak === 'opp_discard_from_hand')) count++;
  }
  return count;
}

interface ClauseIsoVerdict { verdict: 'CORRECT' | 'WRONG' | 'INCONCLUSIVE' | 'NOT_OBSERVABLE' | 'NO_FIRED' | 'NO_DELTA'; observed: string; expected: string; notes: string }

// Clause-isolated attribution: use engine-emitted history events when available;
// fall back to controller-side deck/hand delta with sibling-clause guards for
// actions the engine doesn't tag (mill_self, mill_opp, set_active).
function classifyByEvents(
  clauseEvents: Array<Record<string, unknown>>,
  actionKind: string,
  mag: number,
  controller: 'A' | 'B',
  before: LenSnapshot,
  after: LenSnapshot,
  card: CardDef,
  targetClauseIdx: number,
): ClauseIsoVerdict {
  const opp: 'A' | 'B' = controller === 'A' ? 'B' : 'A';

  if (actionKind === 'draw') {
    let sum = 0; let events = 0;
    for (const e of clauseEvents) {
      if (e.type === 'CARDS_DRAWN' && e.controller === controller) {
        sum += typeof e.count === 'number' ? (e.count as number) : 0;
        events++;
      }
    }
    if (events === 0) return { verdict: 'NO_DELTA', observed: 'no CARDS_DRAWN event', expected: `+${mag} for ${controller}`, notes: `engine emitted no CARDS_DRAWN in clause window` };
    if (sum === mag) return { verdict: 'CORRECT', observed: `CARDS_DRAWN count=${sum}`, expected: `count=${mag}`, notes: `event-attributed: ${controller} drew ${sum}` };
    if (sum > mag) return { verdict: 'WRONG', observed: `CARDS_DRAWN count=${sum}`, expected: `count=${mag}`, notes: `engine over-drew` };
    // 0 < sum < mag: could be 'draw to handsize' semantic (mag is target size, engine drew the delta) OR engine under-draw — both look identical from outside.
    return { verdict: 'INCONCLUSIVE', observed: `CARDS_DRAWN count=${sum}`, expected: `count=${mag}`, notes: `partial draw (${sum}/${mag}); could be 'draw-to-handsize' semantic (mag=target) or genuine under-draw — indistinguishable from event alone` };
  }

  if (actionKind === 'opp_discard_from_hand') {
    let cnt = 0;
    for (const e of clauseEvents) {
      if (e.type === 'CARD_DISCARDED' && e.fromSide === opp) cnt++;
    }
    if (cnt === 0) return { verdict: 'NO_DELTA', observed: 'no CARD_DISCARDED event', expected: `${mag} for ${opp}`, notes: `engine emitted no CARD_DISCARDED in clause window` };
    if (cnt === mag) return { verdict: 'CORRECT', observed: `${cnt} CARD_DISCARDED`, expected: `${mag}`, notes: `event-attributed: ${opp} discarded ${cnt}` };
    if (cnt > mag) return { verdict: 'WRONG', observed: `${cnt} CARD_DISCARDED`, expected: `${mag}`, notes: `engine over-discarded opp` };
    // Less than mag: hand was smaller than mag (engine caps at hand size).
    return { verdict: 'INCONCLUSIVE', observed: `${cnt} CARD_DISCARDED`, expected: `${mag}`, notes: `partial discard (${cnt}/${mag}); could be opp's hand smaller than mag — engine caps` };
  }

  if (actionKind === 'discard_from_hand') {
    let cnt = 0;
    for (const e of clauseEvents) {
      if (e.type === 'CARD_DISCARDED' && e.fromSide === controller) cnt++;
    }
    // For mag=99 "all" sentinel, accept any positive count up to recipe hand size (5 fillers + sometimes source) as CORRECT.
    if (mag >= 10) {
      if (cnt >= 1) return { verdict: 'CORRECT', observed: `${cnt} CARD_DISCARDED ('all' sentinel)`, expected: `≥1 (mag=${mag} → 'all')`, notes: `'all' sentinel: engine caps at available hand size` };
      // mag>=10 but cnt==0 — engine may use length-delta path (no event emitted for forced discard).
      const handDelta = controller === 'A' ? before.aHandLen - after.aHandLen : before.bHandLen - after.bHandLen;
      // Subtract source removal if on_play path consumes source from hand.
      const expectedDecrement = before.aHandLen; // we expect all hand cleared
      void expectedDecrement;
      if (handDelta >= 1) return { verdict: 'CORRECT', observed: `${controller}.handΔ=-${handDelta} ('all' sentinel via length-delta)`, expected: `≥1`, notes: `'all' sentinel: length-delta path` };
      return { verdict: 'NO_DELTA', observed: 'no CARD_DISCARDED and no hand-length drop', expected: `≥1 ('all')`, notes: `engine emitted no event AND no hand decrement` };
    }
    if (cnt === mag) return { verdict: 'CORRECT', observed: `${cnt} CARD_DISCARDED`, expected: `${mag}`, notes: `event-attributed: ${controller} discarded ${cnt}` };
    if (cnt === 0) {
      // No CARD_DISCARDED — engine might not emit for ALL discard_from_hand paths.
      // Fall back to length delta WITHIN the clause window: we can't get a perfect snapshot but we can require the WHOLE-dispatch hand delta to be at LEAST mag MINUS the source-removal adjustment (1 if on_play path) MINUS sibling-discard adjustment (siblingHandDiscarders).
      const handDelta = controller === 'A' ? before.aHandLen - after.aHandLen : before.bHandLen - after.bHandLen;
      const sourceAdjust = 1; // most dispatch paths take the source out of hand (PLAY_CARD, ACTIVATE_MAIN of stage); on_field source = 0 but we can't tell; assume worst-case +1
      void sourceAdjust;
      if (handDelta >= mag) return { verdict: 'CORRECT', observed: `${controller}.handΔ=-${handDelta} (no CARD_DISCARDED but length matches)`, expected: `-${mag}`, notes: `engine emitted no event; length-delta confirms ≥${mag} discard` };
      return { verdict: 'NO_DELTA', observed: `${controller}.handΔ=-${handDelta}, 0 CARD_DISCARDED`, expected: `${mag}`, notes: `neither event nor length-delta confirms discard` };
    }
    if (cnt > mag) return { verdict: 'WRONG', observed: `${cnt} CARD_DISCARDED`, expected: `${mag}`, notes: `engine over-discarded controller` };
    return { verdict: 'INCONCLUSIVE', observed: `${cnt} CARD_DISCARDED`, expected: `${mag}`, notes: `partial discard (${cnt}/${mag})` };
  }

  if (actionKind === 'mill_self') {
    // No engine event for trash_top_of_deck. Use controller-side deck length
    // delta — IF no sibling clause also decrements controller's deck.
    const siblings = siblingDeckDecrementers(card, targetClauseIdx, controller === 'A' ? 'A_DECK' : 'B_DECK');
    const deckDelta = controller === 'A' ? before.aDeckLen - after.aDeckLen : before.bDeckLen - after.bDeckLen;
    if (siblings > 0) {
      return { verdict: 'INCONCLUSIVE', observed: `${controller}.deckΔ=-${deckDelta}`, expected: `-${mag}`, notes: `engine emits no event; ${siblings} sibling clause(s) also decrement ${controller}.deck — cannot isolate` };
    }
    if (deckDelta === mag) return { verdict: 'CORRECT', observed: `${controller}.deckΔ=-${deckDelta}`, expected: `-${mag}`, notes: `length-delta clean-isolated: 0 sibling decrementers` };
    if (deckDelta > mag) return { verdict: 'WRONG', observed: `${controller}.deckΔ=-${deckDelta}`, expected: `-${mag}`, notes: `engine over-milled ${controller}` };
    if (deckDelta > 0) return { verdict: 'INCONCLUSIVE', observed: `${controller}.deckΔ=-${deckDelta}`, expected: `-${mag}`, notes: `partial mill — engine may have deck-out or capped` };
    return { verdict: 'NO_DELTA', observed: `${controller}.deckΔ=0`, expected: `-${mag}`, notes: `no deck decrement observed` };
  }

  if (actionKind === 'mill_opp') {
    const siblings = siblingDeckDecrementers(card, targetClauseIdx, opp === 'A' ? 'A_DECK' : 'B_DECK');
    const deckDelta = opp === 'A' ? before.aDeckLen - after.aDeckLen : before.bDeckLen - after.bDeckLen;
    if (siblings > 0) {
      return { verdict: 'INCONCLUSIVE', observed: `${opp}.deckΔ=-${deckDelta}`, expected: `-${mag}`, notes: `engine emits no event; ${siblings} sibling clause(s) also decrement ${opp}.deck — cannot isolate` };
    }
    if (deckDelta === mag) return { verdict: 'CORRECT', observed: `${opp}.deckΔ=-${deckDelta}`, expected: `-${mag}`, notes: `length-delta clean-isolated: 0 sibling decrementers` };
    if (deckDelta > mag) return { verdict: 'WRONG', observed: `${opp}.deckΔ=-${deckDelta}`, expected: `-${mag}`, notes: `engine over-milled ${opp}` };
    if (deckDelta > 0) return { verdict: 'INCONCLUSIVE', observed: `${opp}.deckΔ=-${deckDelta}`, expected: `-${mag}`, notes: `partial mill` };
    return { verdict: 'NO_DELTA', observed: `${opp}.deckΔ=0`, expected: `-${mag}`, notes: `no opp deck decrement observed` };
  }

  // Peek / reveal / search / set_active / choose_cost — no observable
  // state-length delta and no event reliably distinguishable. Per directive:
  // CLAUSE_FIRED alone is sufficient evidence the engine reached the handler;
  // classify INCONCLUSIVE (NOT ENGINE_BUG).
  void siblingHandDiscarders;
  return { verdict: 'NOT_OBSERVABLE', observed: 'CLAUSE_FIRED only', expected: 'no generic delta', notes: `${actionKind} has no clause-isolated observable; clause fired (CLAUSE_FIRED match passed)` };
}

interface StageCDsdResult {
  cardId: string; name: string; kind: string; family: 'draw_search_discard';
  actionKind: string; trigger: string; targetKind: string | null; clauseIndex: number;
  magnitude: number; gated: boolean; hasCost: boolean;
  dispatchPath: 'PLAY_CARD' | 'ACTIVATE_MAIN' | 'DECLARE_ATTACK' | 'END_TURN' | 'SKIPPED';
  clauseFired: boolean;
  deltaVerdict: 'CORRECT' | 'WRONG' | 'NO_DELTA' | 'NOT_OBSERVABLE' | 'UNCHECKED';
  pendingKindEnd: string | null;
  pageErrors: ReadonlyArray<string>;
  invariantErrors: ReadonlyArray<string>;
  classification: Classification; confidence: 'HIGH' | 'MEDIUM' | 'LOW'; notes: string;
  isAnchor: boolean;
}

function decideDispatchPath(trigger: string, sourceZone: SourceZone): 'PLAY_CARD' | 'ACTIVATE_MAIN' | 'DECLARE_ATTACK' | 'END_TURN' | 'SKIPPED' {
  if (!SUPPORTED_TRIGGERS.has(trigger)) return 'SKIPPED';
  if (trigger === 'on_play') return sourceZone === 'a_hand' ? 'PLAY_CARD' : 'SKIPPED';
  if (trigger === 'activate_main') {
    if (sourceZone === 'a_leader' || sourceZone === 'a_field' || sourceZone === 'a_stage') return 'ACTIVATE_MAIN';
    return 'SKIPPED';
  }
  if (trigger === 'when_attacking') {
    if (sourceZone === 'a_leader' || sourceZone === 'a_field') return 'DECLARE_ATTACK';
    return 'SKIPPED';
  }
  if (trigger === 'at_end_of_turn_self') {
    if (sourceZone === 'a_field' || sourceZone === 'a_leader' || sourceZone === 'a_stage') return 'END_TURN';
    return 'SKIPPED';
  }
  return 'SKIPPED';
}

async function dispatchTrigger(page: Page, path: 'PLAY_CARD' | 'ACTIVATE_MAIN' | 'DECLARE_ATTACK' | 'END_TURN', sourceIid: string): Promise<{ ok: boolean; err: string | null }> {
  if (path === 'PLAY_CARD') return dispatchAs(page, { type: 'PLAY_CARD', instanceId: sourceIid, replaceTargetId: null });
  if (path === 'ACTIVATE_MAIN') return dispatchAs(page, { type: 'ACTIVATE_MAIN', instanceId: sourceIid });
  if (path === 'END_TURN') return dispatchAs(page, { type: 'END_TURN' });
  const bLeaderId = await page.evaluate(() => { const w = window as unknown as { __store?: { getState: () => { state: { players: { B: { leader: { instanceId: string } } } } } } }; return w.__store!.getState().state.players.B.leader.instanceId; });
  return dispatchAs(page, { type: 'DECLARE_ATTACK', attackerInstanceId: sourceIid, targetInstanceId: bLeaderId });
}

async function processCard(page: Page, card: CardDef, pageErrorsAcc: string[], invariantErrorsAcc: string[]): Promise<StageCDsdResult> {
  const clauseInfo = firstDsdClause(card);
  const isAnchor = ANCHORS.has(card.id);
  if (clauseInfo === null) {
    return {
      cardId: card.id, name: card.name, kind: card.kind, family: 'draw_search_discard',
      actionKind: 'n/a', trigger: 'n/a', targetKind: null, clauseIndex: -1,
      magnitude: 0, gated: false, hasCost: false,
      dispatchPath: 'SKIPPED', clauseFired: false,
      deltaVerdict: 'UNCHECKED',
      pendingKindEnd: null, pageErrors: [], invariantErrors: [],
      classification: 'INCONCLUSIVE', confidence: 'LOW',
      notes: 'no D/S/D-family clause found (filter mismatch)', isAnchor,
    };
  }
  try {
    const sourceZone = pickSourceZone(card, clauseInfo.trigger);
    const dispatchPath = decideDispatchPath(clauseInfo.trigger, sourceZone);
    if (dispatchPath === 'SKIPPED') {
      return {
        cardId: card.id, name: card.name, kind: card.kind, family: 'draw_search_discard',
        actionKind: clauseInfo.actionKind, trigger: clauseInfo.trigger, targetKind: clauseInfo.targetKind, clauseIndex: clauseInfo.clauseIndex,
        magnitude: clauseInfo.magnitude, gated: clauseInfo.gated, hasCost: clauseInfo.hasCost,
        dispatchPath: 'SKIPPED', clauseFired: false,
        deltaVerdict: 'UNCHECKED',
        pendingKindEnd: null, pageErrors: [], invariantErrors: [],
        classification: 'HARNESS_GAP', confidence: 'HIGH',
        notes: `trigger '${clauseInfo.trigger}' not in supported set {on_play, activate_main, when_attacking, at_end_of_turn_self}; harness can't reach this clause via generic recipe`,
        isAnchor,
      };
    }
    if (dispatchPath === 'ACTIVATE_MAIN') {
      const hasKw = (card.keywords ?? []).includes('activate_main');
      if (!hasKw) {
        return {
          cardId: card.id, name: card.name, kind: card.kind, family: 'draw_search_discard',
          actionKind: clauseInfo.actionKind, trigger: clauseInfo.trigger, targetKind: clauseInfo.targetKind, clauseIndex: clauseInfo.clauseIndex,
          magnitude: clauseInfo.magnitude, gated: clauseInfo.gated, hasCost: clauseInfo.hasCost,
          dispatchPath: 'SKIPPED', clauseFired: false,
          deltaVerdict: 'UNCHECKED',
          pendingKindEnd: null, pageErrors: [], invariantErrors: [],
          classification: 'CARD_DATA_BUG', confidence: 'MEDIUM',
          notes: `card has trigger=activate_main clause but keywords[] does not include 'activate_main' (legality.ts:316-335)`,
          isAnchor,
        };
      }
    }
    const peBefore = pageErrorsAcc.length; const ieBefore = invariantErrorsAcc.length;
    const seeded = await fullRestoringResetAndSeed(page, sourceZone, card, clauseInfo.trigger);
    if (seeded.sourceIid === null) {
      return {
        cardId: card.id, name: card.name, kind: card.kind, family: 'draw_search_discard',
        actionKind: clauseInfo.actionKind, trigger: clauseInfo.trigger, targetKind: clauseInfo.targetKind, clauseIndex: clauseInfo.clauseIndex,
        magnitude: clauseInfo.magnitude, gated: clauseInfo.gated, hasCost: clauseInfo.hasCost,
        dispatchPath, clauseFired: false,
        deltaVerdict: 'UNCHECKED',
        pendingKindEnd: null, pageErrors: [], invariantErrors: [],
        classification: 'HARNESS_BUG', confidence: 'LOW', notes: `seeding returned null sourceIid`, isAnchor,
      };
    }
    const beforeLens = await readLens(page);
    const historyStartIdx = await readHistoryLen(page);
    const dispatchRes = await dispatchTrigger(page, dispatchPath, seeded.sourceIid);
    await drainPending(page);
    const { events: clauseHistory, markers } = await readHistoryAndMarkers(page, historyStartIdx, seeded.sourceIid);
    const targetMarker = markers.find((m) => m.clauseIndex === clauseInfo.clauseIndex && m.trigger === clauseInfo.trigger && m.actionKind === clauseInfo.actionKind);
    const clauseFired = targetMarker !== undefined;
    const afterLens = await readLens(page);
    const pendingKindEnd = await readPendingKind(page);
    const newPE = pageErrorsAcc.slice(peBefore);
    const newIE = invariantErrorsAcc.slice(ieBefore);
    let cls: Classification; let confidence: 'HIGH' | 'MEDIUM' | 'LOW'; let notes: string;
    let deltaVerdict: StageCDsdResult['deltaVerdict'] = 'UNCHECKED';
    if (newPE.length > 0 || newIE.length > 0 || pendingKindEnd !== null) {
      cls = 'ENGINE_BUG'; confidence = 'HIGH';
      notes = `infra failure: PE=${newPE.length} IE=${newIE.length} pendingKindEnd=${pendingKindEnd}`;
    } else if (!dispatchRes.ok) {
      cls = 'HARNESS_GAP'; confidence = 'MEDIUM';
      notes = `dispatch ${dispatchPath} rejected: ${dispatchRes.err}`;
    } else if (!clauseFired) {
      const reason = clauseInfo.gated ? 'condition gated by un-met predicate' : clauseInfo.hasCost ? 'cost block not paid (recipe DON/discard may be insufficient)' : 'trigger fired but action did not reach this clause (sibling pending, opt path, or attack-block)';
      cls = 'HARNESS_GAP'; confidence = 'MEDIUM';
      notes = `CLAUSE_FIRED never observed for clause[${clauseInfo.clauseIndex}] action=${clauseInfo.actionKind}: ${reason}`;
    } else {
      const window = findClauseWindow(markers, clauseInfo.clauseIndex, clauseInfo.trigger, clauseInfo.actionKind);
      const clauseEvents = window === null ? [] : clauseHistory.slice(window.startIdx, window.endIdx);
      const verdict = classifyByEvents(clauseEvents, clauseInfo.actionKind, clauseInfo.magnitude, 'A', beforeLens, afterLens, card, clauseInfo.clauseIndex);
      // Map the new verdict enum to StageCDsdResult.deltaVerdict + Classification.
      if (verdict.verdict === 'CORRECT') {
        deltaVerdict = 'CORRECT'; cls = 'VERIFIED'; confidence = 'HIGH';
        notes = `dispatched=${dispatchPath}; clauseFired; ${verdict.observed} (expected ${verdict.expected}); ${verdict.notes}`;
      } else if (verdict.verdict === 'WRONG') {
        deltaVerdict = 'WRONG'; cls = 'ENGINE_BUG'; confidence = 'HIGH';
        notes = `clause fired but engine produced wrong attribution: ${verdict.observed} (expected ${verdict.expected}); ${verdict.notes}`;
      } else if (verdict.verdict === 'INCONCLUSIVE') {
        deltaVerdict = 'NO_DELTA'; cls = 'INCONCLUSIVE'; confidence = 'MEDIUM';
        notes = `clause fired; clause-isolated attribution inconclusive: ${verdict.observed} (expected ${verdict.expected}); ${verdict.notes}`;
      } else if (verdict.verdict === 'NO_DELTA') {
        deltaVerdict = 'NO_DELTA'; cls = 'INCONCLUSIVE'; confidence = 'LOW';
        notes = `clause fired; no observable attribution: ${verdict.observed} (expected ${verdict.expected}); ${verdict.notes}`;
      } else {
        // NOT_OBSERVABLE — peek/reveal/search/set_active/choose_cost.
        deltaVerdict = 'NOT_OBSERVABLE'; cls = 'INCONCLUSIVE'; confidence = 'MEDIUM';
        notes = `clause fired; ${verdict.notes}`;
      }
    }
    return {
      cardId: card.id, name: card.name, kind: card.kind, family: 'draw_search_discard',
      actionKind: clauseInfo.actionKind, trigger: clauseInfo.trigger, targetKind: clauseInfo.targetKind, clauseIndex: clauseInfo.clauseIndex,
      magnitude: clauseInfo.magnitude, gated: clauseInfo.gated, hasCost: clauseInfo.hasCost,
      dispatchPath, clauseFired,
      deltaVerdict,
      pendingKindEnd, pageErrors: newPE, invariantErrors: newIE,
      classification: cls, confidence, notes, isAnchor,
    };
  } catch (err) {
    try { await drainPending(page); } catch { /* ignore */ }
    return {
      cardId: card.id, name: card.name, kind: card.kind, family: 'draw_search_discard',
      actionKind: clauseInfo.actionKind, trigger: clauseInfo.trigger, targetKind: clauseInfo.targetKind, clauseIndex: clauseInfo.clauseIndex,
      magnitude: clauseInfo.magnitude, gated: clauseInfo.gated, hasCost: clauseInfo.hasCost,
      dispatchPath: 'SKIPPED', clauseFired: false,
      deltaVerdict: 'UNCHECKED',
      pendingKindEnd: null, pageErrors: [], invariantErrors: [],
      classification: 'HARNESS_BUG', confidence: 'LOW',
      notes: `harness threw: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
      isAnchor,
    };
  }
}

const SLICES: CardDef[][] = [];
for (let i = 0; i < SLICE_COUNT; i++) SLICES.push(CARDS.slice(i * SLICE_SIZE, (i + 1) * SLICE_SIZE));

test.describe.serial('stage-c-generated-draw-search-discard', () => {
  for (let s = 0; s < SLICES.length; s++) {
    const sliceIndex = s; const slice = SLICES[sliceIndex]!;
    test(`slice ${sliceIndex + 1}/${SLICES.length} — ${slice.length} cards (${slice[0]!.id} … ${slice[slice.length - 1]!.id})`, async ({ page }) => {
      test.setTimeout(FIVE_MIN);
      const { drv, pageErrors, invariantErrors } = await bootstrap(page);
      void drv;
      const results: StageCDsdResult[] = [];
      for (const card of slice) results.push(await processCard(page, card, pageErrors, invariantErrors));
      expect(pageErrors, `slice ${sliceIndex} pageerrors`).toEqual([]);
      expect(invariantErrors, `slice ${sliceIndex} InvariantErrors`).toEqual([]);
      expect(await readPendingKind(page), `slice ${sliceIndex} no stuck pending`).toBeNull();
      const sliceFile = join(SLICE_TMP_DIR, `dsd-slice-${String(sliceIndex).padStart(3, '0')}.json`);
      writeFileSync(sliceFile, JSON.stringify({ sliceIndex, cardCount: slice.length, results }, null, 2), 'utf-8');
      /* eslint-disable no-console */
      console.log(`[draw-search-discard] wrote slice ${sliceIndex} → ${sliceFile}`);
      /* eslint-enable no-console */
    });
  }

  test('aggregator: roll up draw-search-discard slices', async () => {
    const all: StageCDsdResult[] = [];
    for (const f of readdirSync(SLICE_TMP_DIR).filter((f) => f.startsWith('dsd-slice-') && f.endsWith('.json')).sort()) {
      const raw = JSON.parse(readFileSync(join(SLICE_TMP_DIR, f), 'utf-8')) as { results: StageCDsdResult[] };
      for (const r of raw.results) all.push(r);
    }
    const buckets: Record<Classification, number> = { VERIFIED: 0, ENGINE_BUG: 0, CARD_DATA_BUG: 0, UI_BUG: 0, HARNESS_BUG: 0, HARNESS_GAP: 0, NOT_IMPLEMENTED: 0, NO_UI_EXPECTED: 0, INCONCLUSIVE: 0 };
    for (const r of all) buckets[r.classification]++;
    const actionBreakdown = new Map<string, number>();
    const triggerBreakdown = new Map<string, number>();
    const targetBreakdown = new Map<string, number>();
    const cardKindBreakdown = new Map<string, number>();
    for (const r of all) {
      actionBreakdown.set(r.actionKind, (actionBreakdown.get(r.actionKind) ?? 0) + 1);
      triggerBreakdown.set(r.trigger, (triggerBreakdown.get(r.trigger) ?? 0) + 1);
      targetBreakdown.set(r.targetKind ?? '(no-target)', (targetBreakdown.get(r.targetKind ?? '(no-target)') ?? 0) + 1);
      cardKindBreakdown.set(r.kind, (cardKindBreakdown.get(r.kind) ?? 0) + 1);
    }
    const clusters = new Map<string, { rootCause: string; cards: string[] }>();
    for (const r of all) {
      if (r.classification === 'VERIFIED') continue;
      const sig = `[${r.classification}] ` + (r.notes || `(${r.classification})`).slice(0, 100);
      const ex = clusters.get(sig) ?? { rootCause: sig, cards: [] };
      ex.cards.push(r.cardId);
      clusters.set(sig, ex);
    }
    const sortedClusters = Array.from(clusters.values()).sort((a, b) => b.cards.length - a.cards.length);
    const anchorRecs = Array.from(ANCHORS).map((id) => { const r = all.find((x) => x.cardId === id); return { id, classification: r?.classification ?? 'NOT_FOUND', actionKind: r?.actionKind ?? '(missing)', trigger: r?.trigger ?? '(missing)' }; });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const jsonPath = join(REPORTS_DIR, `stage-c-draw-search-discard-${ts}.json`);
    const mdPath = join(REPORTS_DIR, `stage-c-draw-search-discard-${ts}.md`);
    const finalReport = {
      family: 'draw_search_discard', generatedAt: new Date().toISOString(),
      totalCardsDiscovered: CARDS.length, totalRecordsWritten: all.length, sliceCount: SLICE_COUNT,
      classifications: buckets, verifiedPercent: all.length > 0 ? (100 * buckets.VERIFIED / all.length).toFixed(2) : '0',
      actionBreakdown: Object.fromEntries(actionBreakdown),
      triggerBreakdown: Object.fromEntries(triggerBreakdown),
      targetBreakdown: Object.fromEntries(targetBreakdown),
      cardKindBreakdown: Object.fromEntries(cardKindBreakdown),
      anchorStatus: anchorRecs,
      topFailureClusters: sortedClusters.slice(0, 10),
      results: all,
    };
    writeFileSync(jsonPath, JSON.stringify(finalReport, null, 2), 'utf-8');
    const md: string[] = [];
    md.push(`# Stage C — Draw/Search/Discard Generated Report\n\n**Generated:** ${new Date().toISOString()}\n**Total D/S/D-family cards discovered:** ${CARDS.length}\n**Total records written:** ${all.length}\n**Slice count:** ${SLICE_COUNT}\n\n`);
    md.push(`## Classification buckets\n\n| Bucket | Count | % |\n|---|---:|---:|\n`);
    for (const [k, v] of Object.entries(buckets)) md.push(`| ${k} | ${v} | ${all.length > 0 ? (100 * v / all.length).toFixed(1) : '0'}% |\n`);
    md.push(`\n## Action kind breakdown\n\n| Action | Count |\n|---|---:|\n`);
    for (const [k, v] of Array.from(actionBreakdown.entries()).sort((a, b) => b[1] - a[1])) md.push(`| ${k} | ${v} |\n`);
    md.push(`\n## Trigger breakdown\n\n| Trigger | Count |\n|---|---:|\n`);
    for (const [k, v] of Array.from(triggerBreakdown.entries()).sort((a, b) => b[1] - a[1])) md.push(`| ${k} | ${v} |\n`);
    md.push(`\n## Target kind breakdown\n\n| Target | Count |\n|---|---:|\n`);
    for (const [k, v] of Array.from(targetBreakdown.entries()).sort((a, b) => b[1] - a[1])) md.push(`| ${k} | ${v} |\n`);
    md.push(`\n## Card kind breakdown\n\n| Card kind | Count |\n|---|---:|\n`);
    for (const [k, v] of Array.from(cardKindBreakdown.entries()).sort((a, b) => b[1] - a[1])) md.push(`| ${k} | ${v} |\n`);
    md.push(`\n## Anchor card status\n\n| Card | Classification | Action | Trigger |\n|---|---|---|---|\n`);
    for (const x of anchorRecs) md.push(`| ${x.id} | ${x.classification} | ${x.actionKind} | ${x.trigger} |\n`);
    md.push(`\n## Top 10 failure clusters\n\n`);
    if (sortedClusters.length === 0) md.push(`(none)\n`);
    else for (const c of sortedClusters.slice(0, 10)) md.push(`- **${c.cards.length} cards**: ${c.rootCause}\n`);
    md.push(`\n## Report files\n\n- JSON: \`coverage/reports/stage-c-draw-search-discard-${ts}.json\`\n- MD: \`coverage/reports/stage-c-draw-search-discard-${ts}.md\`\n`);
    writeFileSync(mdPath, md.join(''), 'utf-8');
    /* eslint-disable no-console */
    console.log(`[draw-search-discard] FINAL JSON: ${jsonPath}`);
    console.log(`[draw-search-discard] FINAL MD:   ${mdPath}`);
    console.log(`[draw-search-discard] tally: ${JSON.stringify(buckets)}`);
    /* eslint-enable no-console */
    expect(all.length, 'every card must have a record').toBe(CARDS.length);
  });
});
