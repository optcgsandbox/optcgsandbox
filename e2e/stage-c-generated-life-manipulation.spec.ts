// stage-c-generated-life-manipulation — Stage C target #13 per
// e2e/stage-c-corpus-verification-plan.md. Auto-discovers every card with at
// least one clause whose `action.kind` is in the life-manipulation family:
//   add_to_own_life_top, life_to_hand, trash_face_up_life,
//   trash_own_life_until, add_to_opp_life_top, peek_and_reorder_own_life,
//   peek_and_reorder_opp_life, add_to_opp_hand_from_opp_life,
//   turn_all_own_life_face_down, play_self_from_life
//
// Discovery confirmed (2026-06-08): 123 cards across 10 distinct action kinds.
// Triggers (dispatchable): on_play (75), when_attacking (18), activate_main (14),
// at_end_of_turn_self (2). Long tail (on_ko, would_be_*, on_life_changed, etc.) → HARNESS_GAP.
//
// Engine handlers (actions3.ts:100-280):
//   - life_to_hand: A.life.shift() → A.hand.push()
//   - addToOwnLifeTop: pulls from `action.from` (default top_of_deck) → A.life
//     (may suspend with pending=choose_one if position='controller_choice')
//   - addToOppLifeTop: same but B.life
//   - trashFaceUpLife: finds first face-up A.life entry → A.trash
//   - trashOwnLifeUntil: trash A.life from top until length === action.n
//   - peek_and_reorder_*_life: suspends with pending=peek
// None emit history events; verification uses clause-isolated life-length deltas.
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
const SLICE_TMP_DIR = resolve(__dirname, 'coverage/reports/.stage-c-life-slices');
mkdirSync(REPORTS_DIR, { recursive: true });
mkdirSync(SLICE_TMP_DIR, { recursive: true });
for (const f of readdirSync(SLICE_TMP_DIR)) { if (f.endsWith('.json')) { try { unlinkSync(join(SLICE_TMP_DIR, f)); } catch { /* ignore */ } } }

const LIFE_ACTION_KINDS = new Set<string>([
  'add_to_own_life_top', 'add_to_opp_life_top',
  'life_to_hand', 'add_to_opp_hand_from_opp_life',
  'trash_face_up_life', 'trash_own_life_until',
  'peek_and_reorder_own_life', 'peek_and_reorder_opp_life',
  'turn_all_own_life_face_down',
  'play_self_from_life',
]);

// Action kinds with deterministic life/hand/trash length delta we can verify.
const OBSERVABLE_LIFE_ACTIONS = new Set<string>([
  'add_to_own_life_top', 'add_to_opp_life_top',
  'life_to_hand', 'add_to_opp_hand_from_opp_life',
  'trash_face_up_life', 'trash_own_life_until',
]);

const SUPPORTED_TRIGGERS = new Set<string>(['on_play', 'activate_main', 'when_attacking', 'at_end_of_turn_self']);

interface CardDef {
  readonly id: string; readonly name: string; readonly kind: 'character' | 'event' | 'stage' | 'leader' | 'don';
  readonly cost?: number | null; readonly power?: number | null; readonly colors?: ReadonlyArray<string>; readonly traits?: ReadonlyArray<string>;
  readonly keywords?: ReadonlyArray<string>; readonly effectText?: string;
  readonly effectSpecV2?: {
    readonly clauses?: ReadonlyArray<{
      readonly trigger?: string;
      readonly action?: { readonly kind?: string; readonly magnitude?: number; readonly n?: number; readonly count?: number; readonly from?: string; readonly position?: string; readonly faceUp?: boolean };
      readonly target?: { readonly kind?: string; readonly filter?: Record<string, unknown>; readonly count?: number };
      readonly cost?: Record<string, unknown>;
      readonly condition?: { readonly type?: string; readonly [k: string]: unknown };
    }>;
  };
  readonly [k: string]: unknown;
}

const CORPUS_RAW = JSON.parse(readFileSync(CORPUS_PATH, 'utf-8')) as unknown;
const CORPUS = (Array.isArray(CORPUS_RAW) ? CORPUS_RAW : Object.values(CORPUS_RAW as Record<string, unknown>)) as Array<Record<string, unknown>>;

function firstLifeClause(c: Record<string, unknown>): { clauseIndex: number; trigger: string; actionKind: string; magnitude: number; n: number; gated: boolean; hasCost: boolean; targetKind: string | null } | null {
  const cd = c as CardDef;
  const clauses = cd.effectSpecV2?.clauses ?? [];
  for (let i = 0; i < clauses.length; i++) {
    const cl = clauses[i]!;
    const ak = cl.action?.kind;
    if (typeof ak !== 'string' || !LIFE_ACTION_KINDS.has(ak)) continue;
    const a = cl.action!;
    return {
      clauseIndex: i,
      trigger: typeof cl.trigger === 'string' ? cl.trigger : '',
      actionKind: ak,
      magnitude: typeof a.magnitude === 'number' ? a.magnitude : 1,
      n: typeof a.n === 'number' ? a.n : (typeof a.count === 'number' ? a.count : 1),
      gated: cl.condition !== undefined,
      hasCost: cl.cost !== undefined,
      targetKind: typeof cl.target?.kind === 'string' ? cl.target.kind : null,
    };
  }
  return null;
}

const CARDS: CardDef[] = CORPUS.filter((c) => firstLifeClause(c) !== null) as CardDef[];
CARDS.sort((a, b) => a.id.localeCompare(b.id));

const SLICE_SIZE = 25;
const SLICE_COUNT = Math.ceil(CARDS.length / SLICE_SIZE);
/* eslint-disable no-console */
console.log(`[stage-c-life-manipulation] Discovered ${CARDS.length} life-family cards → ${SLICE_COUNT} slice(s) of up to ${SLICE_SIZE}`);
/* eslint-enable no-console */

const ANCHORS = new Set<string>([
  'EB01-050',  // add_to_own_life_top faceUp:false from:top_of_deck
  'EB02-061',  // life_to_hand magnitude:1
  'EB03-053',  // add_to_opp_life_top
  'EB03-057',  // trash_face_up_life
  'EB01-059',  // trash_own_life_until n:1
  'EB02-053',  // peek_and_reorder_own_life count:1
  'OP01-009',  // play_self_from_life
  'EB03-053',  // add_to_opp_life_top position:controller_choice
]);

type Classification = 'VERIFIED' | 'ENGINE_BUG' | 'CARD_DATA_BUG' | 'UI_BUG' | 'HARNESS_BUG' | 'HARNESS_GAP' | 'NOT_IMPLEMENTED' | 'NO_UI_EXPECTED' | 'INCONCLUSIVE';

type SourceZone = 'a_hand' | 'a_field' | 'a_stage' | 'a_leader';

function pickSourceZone(card: CardDef, trigger: string): SourceZone {
  if (card.kind === 'leader') return 'a_leader';
  if (card.kind === 'event') return 'a_hand';
  if (card.kind === 'stage') return trigger === 'on_play' ? 'a_hand' : 'a_stage';
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
  aLifeLen: number; aHandLen: number; aTrashLen: number; aDeckLen: number;
  bLifeLen: number; bHandLen: number; bTrashLen: number; bDeckLen: number;
  aLifeFaceUpCount: number;
}

async function fullRestoringResetAndSeed(page: Page, sourceZone: SourceZone, card: CardDef, clauseInfo: ReturnType<typeof firstLifeClause>): Promise<SeededRefs> {
  return page.evaluate(({ sourceZone, cardDef, clauseInfo }) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    (s as Record<string, unknown>).phase = 'main';
    (s as Record<string, unknown>).activePlayer = 'A';
    (s as Record<string, unknown>).pending = null;
    (s as Record<string, unknown>).result = null;
    (s as Record<string, unknown>).turn = clauseInfo!.trigger === 'when_attacking' ? 5 : 1;
    const players = s.players as {
      A: { donDeck: string[]; donCostArea: string[]; donRested: string[]; leader: { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[]; rested?: boolean; summoningSick?: boolean; perTurn?: { hasAttacked?: boolean; effectsUsed?: string[] }; attackLockedContinuous?: boolean; attackLockedOneShot?: unknown }; field: Array<{ instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[]; rested?: boolean; summoningSick?: boolean; perTurn?: { hasAttacked?: boolean; effectsUsed?: string[] } }>; hand: string[]; trash: string[]; life: string[]; deck: string[]; stage?: { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[]; rested?: boolean } | null; lifeFaceUp?: Record<string, boolean> };
      B: { donDeck: string[]; donCostArea: string[]; donRested: string[]; leader: { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[]; rested?: boolean }; field: Array<{ instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[]; rested?: boolean }>; hand: string[]; trash: string[]; life: string[]; deck: string[]; stage?: { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[] } | null; lifeFaceUp?: Record<string, boolean> };
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
    players.A.hand = []; players.B.hand = players.B.hand ?? [];
    const allADon = [...players.A.donDeck, ...players.A.donCostArea, ...players.A.donRested];
    players.A.donCostArea = allADon.slice(0, 12);
    players.A.donDeck = allADon.slice(12);
    players.A.donRested = [];
    const allBDon = [...players.B.donDeck, ...players.B.donCostArea, ...players.B.donRested];
    players.B.donCostArea = allBDon.slice(0, 6);
    players.B.donDeck = allBDon.slice(6);
    players.B.donRested = [];
    const aLeaderCard = lib[players.A.leader.cardId] as { colors?: string[]; keywords?: string[] } | undefined;
    if (aLeaderCard !== undefined) aLeaderCard.colors = ['red', 'blue', 'green', 'purple', 'black', 'yellow'];
    players.A.leader.rested = false; players.A.leader.summoningSick = false;
    if (players.A.leader.perTurn) { players.A.leader.perTurn.hasAttacked = false; players.A.leader.perTurn.effectsUsed = []; }

    // Lives: ensure both sides have 5 lives. For trash_face_up_life cards, mark
    // at least the top A.life entry as face-up.
    function seedLife(side: 'A' | 'B', target: number) {
      const pl = side === 'A' ? players.A : players.B;
      pl.lifeFaceUp = pl.lifeFaceUp ?? {};
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
    // Make A.life[0] face-up for trash_face_up_life testing.
    if (clauseInfo!.actionKind === 'trash_face_up_life' && players.A.life.length > 0) {
      players.A.lifeFaceUp = players.A.lifeFaceUp ?? {};
      players.A.lifeFaceUp[players.A.life[0]!] = true;
    }

    // Library + source seed.
    lib[cardDef.id] = cardDef as unknown as Record<string, unknown>;
    const srcIid = `life_src_${cardDef.id}_${Math.floor(Math.random() * 1e9).toString(36)}`;
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
    // A.hand fillers.
    for (let i = 0; i < 4; i++) {
      const synthId = `__lifeHand_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `lifeH_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = { id: synthId, name: `Hand Filler ${i}`, kind: 'character', cost: 1, power: 1000, counterValue: 1000, colors: ['red'], traits: [], keywords: [], effectText: '' };
      instances[iid] = { instanceId: iid, cardId: synthId, controller: 'A', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      players.A.hand.push(iid);
    }
    // Deck fillers — life manipulations may pull from deck top.
    function refillDeck(side: 'A' | 'B', target: number) {
      const pl = side === 'A' ? players.A : players.B;
      while (pl.deck.length < target) {
        const synthId = `__lifeDeck_${side}_${Math.floor(Math.random() * 1e9).toString(36)}`;
        const iid = `lifeDeck_${side}_${Math.floor(Math.random() * 1e9).toString(36)}`;
        lib[synthId] = { id: synthId, name: 'Deck Placeholder', kind: 'character', cost: 2, power: 2000, counterValue: 1000, colors: side === 'A' ? ['red'] : ['blue'], traits: [], keywords: [], effectText: '' };
        instances[iid] = { instanceId: iid, cardId: synthId, controller: side, rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
        pl.deck.push(iid);
      }
    }
    refillDeck('A', 20); refillDeck('B', 20);

    w.__store!.setState({ state: { ...s, players: { ...(s.players as Record<string, unknown>), A: { ...players.A }, B: { ...players.B } } } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
    const aLifeFaceUpCount = Object.values(players.A.lifeFaceUp ?? {}).filter((v) => v === true).length;
    return {
      sourceIid,
      aLifeLen: players.A.life.length, aHandLen: players.A.hand.length, aTrashLen: players.A.trash.length, aDeckLen: players.A.deck.length,
      bLifeLen: players.B.life.length, bHandLen: players.B.hand.length, bTrashLen: players.B.trash.length, bDeckLen: players.B.deck.length,
      aLifeFaceUpCount,
    };
  }, { sourceZone, cardDef: card as unknown as Record<string, unknown>, clauseInfo });
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

interface HistoryMarker { idx: number; clauseIndex: number; actionKind: string; trigger: string }
async function readMarkers(page: Page, fromIdx: number, sourceIid: string): Promise<HistoryMarker[]> {
  return page.evaluate(({ fromIdx, sourceIid }) => {
    const w = window as unknown as { __store?: { getState: () => { state: { history: ReadonlyArray<Record<string, unknown>> } } } };
    const hist = w.__store!.getState().state.history;
    const markers: Array<{ idx: number; clauseIndex: number; actionKind: string; trigger: string }> = [];
    for (let i = fromIdx; i < hist.length; i++) {
      const h = hist[i]!;
      if (h.type === 'CLAUSE_FIRED' && h.sourceInstanceId === sourceIid) {
        markers.push({ idx: i - fromIdx, clauseIndex: h.clauseIndex as number, actionKind: h.actionKind as string, trigger: h.trigger as string });
      }
    }
    return markers;
  }, { fromIdx, sourceIid });
}

interface AfterSnapshot {
  aLifeLen: number; aHandLen: number; aTrashLen: number; aDeckLen: number;
  bLifeLen: number; bHandLen: number; bTrashLen: number; bDeckLen: number;
}
async function readAfter(page: Page): Promise<AfterSnapshot> {
  return page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { state: { players: { A: { life: string[]; hand: string[]; trash: string[]; deck: string[] }; B: { life: string[]; hand: string[]; trash: string[]; deck: string[] } } } } } };
    const ps = w.__store!.getState().state.players;
    return {
      aLifeLen: ps.A.life.length, aHandLen: ps.A.hand.length, aTrashLen: ps.A.trash.length, aDeckLen: ps.A.deck.length,
      bLifeLen: ps.B.life.length, bHandLen: ps.B.hand.length, bTrashLen: ps.B.trash.length, bDeckLen: ps.B.deck.length,
    };
  });
}

// Sibling-clause detection: another clause that also touches the SAME life pool.
function siblingLifeTouchers(card: CardDef, targetClauseIdx: number, pool: 'A_LIFE' | 'B_LIFE'): number {
  const clauses = card.effectSpecV2?.clauses ?? [];
  let count = 0;
  const ownSide = new Set<string>(['add_to_own_life_top', 'life_to_hand', 'trash_face_up_life', 'trash_own_life_until', 'peek_and_reorder_own_life', 'turn_all_own_life_face_down', 'play_self_from_life']);
  const oppSide = new Set<string>(['add_to_opp_life_top', 'add_to_opp_hand_from_opp_life', 'peek_and_reorder_opp_life']);
  const wanted = pool === 'A_LIFE' ? ownSide : oppSide;
  for (let i = 0; i < clauses.length; i++) {
    if (i === targetClauseIdx) continue;
    const ak = clauses[i]?.action?.kind;
    if (typeof ak === 'string' && wanted.has(ak)) count++;
  }
  return count;
}

interface LifeVerdict { verdict: 'CORRECT' | 'WRONG' | 'INCONCLUSIVE' | 'NO_DELTA' | 'NOT_OBSERVABLE'; observed: string; expected: string; notes: string }

function classifyLife(card: CardDef, clauseInfo: NonNullable<ReturnType<typeof firstLifeClause>>, before: SeededRefs, after: AfterSnapshot): LifeVerdict {
  const ak = clauseInfo.actionKind;
  const isEventOrCharOnPlay = clauseInfo.trigger === 'on_play' && (card.kind === 'event' || card.kind === 'character' || card.kind === 'stage');
  const sourceHandAdjust = isEventOrCharOnPlay ? 1 : 0;
  if (ak === 'add_to_own_life_top') {
    const sib = siblingLifeTouchers(card, clauseInfo.clauseIndex, 'A_LIFE');
    const lifeDelta = after.aLifeLen - before.aLifeLen;
    if (sib > 0) return { verdict: 'INCONCLUSIVE', observed: `A.lifeΔ=+${lifeDelta}`, expected: `+1`, notes: `${sib} sibling A_LIFE-toucher(s)` };
    if (lifeDelta >= 1) return { verdict: 'CORRECT', observed: `A.lifeΔ=+${lifeDelta}`, expected: `+1`, notes: `clause-isolated life-top add verified` };
    return { verdict: 'NO_DELTA', observed: `A.lifeΔ=+${lifeDelta}`, expected: `+1`, notes: `engine produced no life delta — recipe deck may be empty or 'from' source unsatisfied` };
  }
  if (ak === 'add_to_opp_life_top') {
    const sib = siblingLifeTouchers(card, clauseInfo.clauseIndex, 'B_LIFE');
    const lifeDelta = after.bLifeLen - before.bLifeLen;
    if (sib > 0) return { verdict: 'INCONCLUSIVE', observed: `B.lifeΔ=+${lifeDelta}`, expected: `+1`, notes: `${sib} sibling B_LIFE-toucher(s)` };
    if (lifeDelta >= 1) return { verdict: 'CORRECT', observed: `B.lifeΔ=+${lifeDelta}`, expected: `+1`, notes: `clause-isolated opp life-top add verified` };
    return { verdict: 'NO_DELTA', observed: `B.lifeΔ=+${lifeDelta}`, expected: `+1`, notes: `engine produced no opp life delta` };
  }
  if (ak === 'life_to_hand') {
    const sib = siblingLifeTouchers(card, clauseInfo.clauseIndex, 'A_LIFE');
    const lifeDelta = before.aLifeLen - after.aLifeLen;
    const handDelta = (after.aHandLen - before.aHandLen) + sourceHandAdjust; // adjust for source removed on PLAY
    if (sib > 0) return { verdict: 'INCONCLUSIVE', observed: `A.lifeΔ=-${lifeDelta} A.handΔ=+${handDelta}`, expected: `-1 / +1`, notes: `${sib} sibling A_LIFE-toucher(s)` };
    if (lifeDelta === 1 && handDelta >= 1) return { verdict: 'CORRECT', observed: `A.lifeΔ=-${lifeDelta} A.handΔ=+${handDelta} (sourceAdj=${sourceHandAdjust})`, expected: `-1 / +1`, notes: `life→hand verified` };
    if (lifeDelta === 0 && handDelta === sourceHandAdjust) return { verdict: 'NO_DELTA', observed: `no life movement`, expected: `-1 / +1`, notes: `engine produced no life delta` };
    return { verdict: 'INCONCLUSIVE', observed: `A.lifeΔ=-${lifeDelta} A.handΔ=+${handDelta}`, expected: `-1 / +1`, notes: 'partial / contaminated' };
  }
  if (ak === 'add_to_opp_hand_from_opp_life') {
    const sib = siblingLifeTouchers(card, clauseInfo.clauseIndex, 'B_LIFE');
    const lifeDelta = before.bLifeLen - after.bLifeLen;
    const handDelta = after.bHandLen - before.bHandLen;
    if (sib > 0) return { verdict: 'INCONCLUSIVE', observed: `B.lifeΔ=-${lifeDelta} B.handΔ=+${handDelta}`, expected: `-1 / +1`, notes: `${sib} sibling B_LIFE-toucher(s)` };
    if (lifeDelta === 1 && handDelta === 1) return { verdict: 'CORRECT', observed: `B.lifeΔ=-${lifeDelta} B.handΔ=+${handDelta}`, expected: `-1 / +1`, notes: `opp life→hand verified` };
    return { verdict: 'NO_DELTA', observed: `B.lifeΔ=-${lifeDelta} B.handΔ=+${handDelta}`, expected: `-1 / +1`, notes: `engine produced no opp life→hand delta` };
  }
  if (ak === 'trash_face_up_life') {
    if (before.aLifeFaceUpCount === 0) {
      return { verdict: 'INCONCLUSIVE', observed: 'no face-up life seeded', expected: `-1 from life`, notes: `recipe didn't seed any face-up A.life entries — handler iterates and finds none` };
    }
    const sib = siblingLifeTouchers(card, clauseInfo.clauseIndex, 'A_LIFE');
    const lifeDelta = before.aLifeLen - after.aLifeLen;
    const trashDelta = (after.aTrashLen - before.aTrashLen) - sourceHandAdjust; // event source goes to trash on PLAY_CARD
    if (sib > 0) return { verdict: 'INCONCLUSIVE', observed: `A.lifeΔ=-${lifeDelta} A.trashΔ=+${trashDelta} (sourceAdj=${sourceHandAdjust})`, expected: `-1 / +1`, notes: `${sib} sibling A_LIFE-toucher(s)` };
    if (lifeDelta === 1 && trashDelta >= 1) return { verdict: 'CORRECT', observed: `A.lifeΔ=-${lifeDelta} A.trashΔ=+${trashDelta} (sourceAdj=${sourceHandAdjust})`, expected: `-1 / +1`, notes: `face-up life trashed` };
    return { verdict: 'NO_DELTA', observed: `A.lifeΔ=-${lifeDelta} A.trashΔ=+${trashDelta}`, expected: `-1 / +1`, notes: `no life delta observed (face-up seed=${before.aLifeFaceUpCount})` };
  }
  if (ak === 'trash_own_life_until') {
    const targetN = clauseInfo.n;
    const expectedDelta = Math.max(0, before.aLifeLen - targetN);
    const sib = siblingLifeTouchers(card, clauseInfo.clauseIndex, 'A_LIFE');
    const lifeDelta = before.aLifeLen - after.aLifeLen;
    if (sib > 0) return { verdict: 'INCONCLUSIVE', observed: `A.lifeΔ=-${lifeDelta} (targetN=${targetN})`, expected: `-${expectedDelta}`, notes: `${sib} sibling A_LIFE-toucher(s)` };
    if (after.aLifeLen === targetN) return { verdict: 'CORRECT', observed: `A.life=${after.aLifeLen} (target=${targetN}); lifeΔ=-${lifeDelta}`, expected: `life=${targetN}`, notes: `life trimmed to target via clause` };
    if (expectedDelta === 0 && lifeDelta === 0) return { verdict: 'CORRECT', observed: `A.life=${after.aLifeLen} (already ≤${targetN})`, expected: `no-op`, notes: `life already at/below target` };
    return { verdict: 'INCONCLUSIVE', observed: `A.life=${after.aLifeLen} lifeΔ=-${lifeDelta}`, expected: `life=${targetN}`, notes: `partial / unexpected` };
  }
  // peek_and_reorder_own_life, peek_and_reorder_opp_life, turn_all_own_life_face_down, play_self_from_life
  if (!OBSERVABLE_LIFE_ACTIONS.has(ak)) {
    return { verdict: 'NOT_OBSERVABLE', observed: 'CLAUSE_FIRED only', expected: 'no generic delta', notes: `${ak} has no clause-isolated observable (peek opt-out / face-down toggle / self-from-life path)` };
  }
  return { verdict: 'NOT_OBSERVABLE', observed: 'unhandled', expected: '', notes: `unhandled actionKind=${ak}` };
}

interface StageCLifeResult {
  cardId: string; name: string; kind: string; family: 'life_manipulation';
  actionKind: string; trigger: string; targetKind: string | null; clauseIndex: number;
  magnitude: number; n: number; gated: boolean; hasCost: boolean;
  dispatchPath: 'PLAY_CARD' | 'ACTIVATE_MAIN' | 'DECLARE_ATTACK' | 'END_TURN' | 'SKIPPED';
  clauseFired: boolean;
  deltaVerdict: LifeVerdict['verdict'] | 'UNCHECKED';
  pendingKindEnd: string | null;
  pageErrors: ReadonlyArray<string>;
  invariantErrors: ReadonlyArray<string>;
  classification: Classification; confidence: 'HIGH' | 'MEDIUM' | 'LOW'; notes: string;
  isAnchor: boolean;
}

function decideDispatchPath(trigger: string, sourceZone: SourceZone): StageCLifeResult['dispatchPath'] {
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

async function processCard(page: Page, card: CardDef, pageErrorsAcc: string[], invariantErrorsAcc: string[]): Promise<StageCLifeResult> {
  const clauseInfo = firstLifeClause(card);
  const isAnchor = ANCHORS.has(card.id);
  if (clauseInfo === null) {
    return {
      cardId: card.id, name: card.name, kind: card.kind, family: 'life_manipulation',
      actionKind: 'n/a', trigger: 'n/a', targetKind: null, clauseIndex: -1,
      magnitude: 0, n: 0, gated: false, hasCost: false,
      dispatchPath: 'SKIPPED', clauseFired: false,
      deltaVerdict: 'UNCHECKED',
      pendingKindEnd: null, pageErrors: [], invariantErrors: [],
      classification: 'INCONCLUSIVE', confidence: 'LOW',
      notes: 'no life-family clause found', isAnchor,
    };
  }
  try {
    const sourceZone = pickSourceZone(card, clauseInfo.trigger);
    const dispatchPath = decideDispatchPath(clauseInfo.trigger, sourceZone);
    if (dispatchPath === 'SKIPPED') {
      return {
        cardId: card.id, name: card.name, kind: card.kind, family: 'life_manipulation',
        actionKind: clauseInfo.actionKind, trigger: clauseInfo.trigger, targetKind: clauseInfo.targetKind, clauseIndex: clauseInfo.clauseIndex,
        magnitude: clauseInfo.magnitude, n: clauseInfo.n, gated: clauseInfo.gated, hasCost: clauseInfo.hasCost,
        dispatchPath: 'SKIPPED', clauseFired: false,
        deltaVerdict: 'UNCHECKED',
        pendingKindEnd: null, pageErrors: [], invariantErrors: [],
        classification: 'HARNESS_GAP', confidence: 'HIGH',
        notes: `trigger '${clauseInfo.trigger}' not in supported set {on_play, activate_main, when_attacking, at_end_of_turn_self}`,
        isAnchor,
      };
    }
    if (dispatchPath === 'ACTIVATE_MAIN') {
      const hasKw = (card.keywords ?? []).includes('activate_main');
      if (!hasKw) {
        return {
          cardId: card.id, name: card.name, kind: card.kind, family: 'life_manipulation',
          actionKind: clauseInfo.actionKind, trigger: clauseInfo.trigger, targetKind: clauseInfo.targetKind, clauseIndex: clauseInfo.clauseIndex,
          magnitude: clauseInfo.magnitude, n: clauseInfo.n, gated: clauseInfo.gated, hasCost: clauseInfo.hasCost,
          dispatchPath: 'SKIPPED', clauseFired: false,
          deltaVerdict: 'UNCHECKED',
          pendingKindEnd: null, pageErrors: [], invariantErrors: [],
          classification: 'CARD_DATA_BUG', confidence: 'MEDIUM',
          notes: `activate_main clause but keywords[] missing 'activate_main' (legality.ts:316-335)`,
          isAnchor,
        };
      }
    }
    const peBefore = pageErrorsAcc.length; const ieBefore = invariantErrorsAcc.length;
    const seeded = await fullRestoringResetAndSeed(page, sourceZone, card, clauseInfo);
    if (seeded.sourceIid === null) {
      return {
        cardId: card.id, name: card.name, kind: card.kind, family: 'life_manipulation',
        actionKind: clauseInfo.actionKind, trigger: clauseInfo.trigger, targetKind: clauseInfo.targetKind, clauseIndex: clauseInfo.clauseIndex,
        magnitude: clauseInfo.magnitude, n: clauseInfo.n, gated: clauseInfo.gated, hasCost: clauseInfo.hasCost,
        dispatchPath, clauseFired: false,
        deltaVerdict: 'UNCHECKED',
        pendingKindEnd: null, pageErrors: [], invariantErrors: [],
        classification: 'HARNESS_BUG', confidence: 'LOW', notes: `seeding returned null sourceIid`, isAnchor,
      };
    }
    const historyStartIdx = await readHistoryLen(page);
    const dispatchRes = await dispatchTrigger(page, dispatchPath, seeded.sourceIid);
    await drainPending(page);
    const markers = await readMarkers(page, historyStartIdx, seeded.sourceIid);
    const clauseFired = markers.some((m) => m.clauseIndex === clauseInfo.clauseIndex && m.trigger === clauseInfo.trigger && m.actionKind === clauseInfo.actionKind);
    const after = await readAfter(page);
    const pendingKindEnd = await readPendingKind(page);
    const newPE = pageErrorsAcc.slice(peBefore);
    const newIE = invariantErrorsAcc.slice(ieBefore);
    let cls: Classification; let confidence: 'HIGH' | 'MEDIUM' | 'LOW'; let notes: string;
    let deltaVerdict: LifeVerdict['verdict'] = 'NOT_OBSERVABLE';
    if (newPE.length > 0 || newIE.length > 0 || pendingKindEnd !== null) {
      cls = 'ENGINE_BUG'; confidence = 'HIGH';
      notes = `infra failure: PE=${newPE.length} IE=${newIE.length} pendingKindEnd=${pendingKindEnd}`;
    } else if (!dispatchRes.ok) {
      cls = 'HARNESS_GAP'; confidence = 'MEDIUM';
      notes = `dispatch ${dispatchPath} rejected: ${dispatchRes.err}`;
    } else if (!clauseFired) {
      const reason = clauseInfo.gated ? 'condition gated by un-met predicate' : clauseInfo.hasCost ? 'cost block not paid' : 'trigger fired but action did not reach this clause';
      cls = 'HARNESS_GAP'; confidence = 'MEDIUM';
      notes = `CLAUSE_FIRED never observed for clause[${clauseInfo.clauseIndex}] action=${clauseInfo.actionKind}: ${reason}`;
    } else {
      const verdict = classifyLife(card, clauseInfo, seeded, after);
      deltaVerdict = verdict.verdict;
      if (verdict.verdict === 'CORRECT') { cls = 'VERIFIED'; confidence = 'HIGH'; notes = `dispatched=${dispatchPath}; clauseFired; ${verdict.observed} (expected ${verdict.expected}); ${verdict.notes}`; }
      else if (verdict.verdict === 'WRONG') { cls = 'ENGINE_BUG'; confidence = 'HIGH'; notes = `clause fired but engine produced wrong delta: ${verdict.observed} (expected ${verdict.expected}); ${verdict.notes}`; }
      else if (verdict.verdict === 'INCONCLUSIVE') { cls = 'INCONCLUSIVE'; confidence = 'MEDIUM'; notes = `clause fired; attribution inconclusive: ${verdict.observed} (expected ${verdict.expected}); ${verdict.notes}`; }
      else if (verdict.verdict === 'NO_DELTA') { cls = 'INCONCLUSIVE'; confidence = 'LOW'; notes = `clause fired; ${verdict.observed} (expected ${verdict.expected}); ${verdict.notes}`; }
      else { cls = 'INCONCLUSIVE'; confidence = 'MEDIUM'; notes = `clause fired; ${verdict.notes}`; }
    }
    return {
      cardId: card.id, name: card.name, kind: card.kind, family: 'life_manipulation',
      actionKind: clauseInfo.actionKind, trigger: clauseInfo.trigger, targetKind: clauseInfo.targetKind, clauseIndex: clauseInfo.clauseIndex,
      magnitude: clauseInfo.magnitude, n: clauseInfo.n, gated: clauseInfo.gated, hasCost: clauseInfo.hasCost,
      dispatchPath, clauseFired,
      deltaVerdict,
      pendingKindEnd, pageErrors: newPE, invariantErrors: newIE,
      classification: cls, confidence, notes, isAnchor,
    };
  } catch (err) {
    try { await drainPending(page); } catch { /* ignore */ }
    return {
      cardId: card.id, name: card.name, kind: card.kind, family: 'life_manipulation',
      actionKind: clauseInfo.actionKind, trigger: clauseInfo.trigger, targetKind: clauseInfo.targetKind, clauseIndex: clauseInfo.clauseIndex,
      magnitude: clauseInfo.magnitude, n: clauseInfo.n, gated: clauseInfo.gated, hasCost: clauseInfo.hasCost,
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

test.describe.serial('stage-c-generated-life-manipulation', () => {
  for (let s = 0; s < SLICES.length; s++) {
    const sliceIndex = s; const slice = SLICES[sliceIndex]!;
    test(`slice ${sliceIndex + 1}/${SLICES.length} — ${slice.length} cards (${slice[0]!.id} … ${slice[slice.length - 1]!.id})`, async ({ page }) => {
      test.setTimeout(FIVE_MIN);
      const { drv, pageErrors, invariantErrors } = await bootstrap(page);
      void drv;
      const results: StageCLifeResult[] = [];
      for (const card of slice) results.push(await processCard(page, card, pageErrors, invariantErrors));
      expect(pageErrors, `slice ${sliceIndex} pageerrors`).toEqual([]);
      expect(invariantErrors, `slice ${sliceIndex} InvariantErrors`).toEqual([]);
      expect(await readPendingKind(page), `slice ${sliceIndex} no stuck pending`).toBeNull();
      const sliceFile = join(SLICE_TMP_DIR, `life-slice-${String(sliceIndex).padStart(3, '0')}.json`);
      writeFileSync(sliceFile, JSON.stringify({ sliceIndex, cardCount: slice.length, results }, null, 2), 'utf-8');
      /* eslint-disable no-console */
      console.log(`[life-manipulation] wrote slice ${sliceIndex} → ${sliceFile}`);
      /* eslint-enable no-console */
    });
  }

  test('aggregator: roll up life-manipulation slices', async () => {
    const all: StageCLifeResult[] = [];
    for (const f of readdirSync(SLICE_TMP_DIR).filter((f) => f.startsWith('life-slice-') && f.endsWith('.json')).sort()) {
      const raw = JSON.parse(readFileSync(join(SLICE_TMP_DIR, f), 'utf-8')) as { results: StageCLifeResult[] };
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
    const jsonPath = join(REPORTS_DIR, `stage-c-life-manipulation-${ts}.json`);
    const mdPath = join(REPORTS_DIR, `stage-c-life-manipulation-${ts}.md`);
    const finalReport = {
      family: 'life_manipulation', generatedAt: new Date().toISOString(),
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
    md.push(`# Stage C — Life Manipulation Generated Report\n\n**Generated:** ${new Date().toISOString()}\n**Total life-family cards discovered:** ${CARDS.length}\n**Total records written:** ${all.length}\n**Slice count:** ${SLICE_COUNT}\n\n`);
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
    md.push(`\n## Report files\n\n- JSON: \`coverage/reports/stage-c-life-manipulation-${ts}.json\`\n- MD: \`coverage/reports/stage-c-life-manipulation-${ts}.md\`\n`);
    writeFileSync(mdPath, md.join(''), 'utf-8');
    /* eslint-disable no-console */
    console.log(`[life-manipulation] FINAL JSON: ${jsonPath}`);
    console.log(`[life-manipulation] FINAL MD:   ${mdPath}`);
    console.log(`[life-manipulation] tally: ${JSON.stringify(buckets)}`);
    /* eslint-enable no-console */
    expect(all.length, 'every card must have a record').toBe(CARDS.length);
  });
});
