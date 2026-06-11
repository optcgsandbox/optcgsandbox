// stage-c-generated-don-manipulation — Stage C target #12 per
// e2e/stage-c-corpus-verification-plan.md. Auto-discovers every card with at
// least one clause whose `action.kind` is in the DON-manipulation family:
//   give_don_to_target, give_don_to_opp_target,
//   set_active_don, return_opp_don_to_deck,
//   transfer_attached_don, rest_opp_don
//
// Discovery confirmed (2026-06-08): 139 cards / 145 clauses
//   give_don_to_target=77, set_active_don=45, give_don_to_opp_target=10,
//   rest_opp_don=6, return_opp_don_to_deck=5, transfer_attached_don=2
//
// Triggers (dispatchable subset): on_play, activate_main, when_attacking,
// at_end_of_turn_self. Others → HARNESS_GAP.
//
// Engine handlers (verified clean by code inspection):
//   - give_don_to_target (actions.ts:307): pl.donCostArea → target.attachedDon
//   - set_active_don (actions2.ts:257): pl.donRested → pl.donCostArea
//   - return_opp_don_to_deck (actions2.ts:272): opp.donCostArea → opp.donDeck
//   - rest_opp_don (actions3.ts:747): opp.donCostArea → opp.donRested
//   - give_don_to_opp_target (actions3.ts:84): opp.donCostArea → target.attachedDon
//   - transfer_attached_don (actions2.ts:215): source.attachedDon → target.attachedDon
// None emit history events; verification uses clause-isolated DON-pool deltas
// with sibling-clause guards (analogous to mill_self path in family #11).
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
const SLICE_TMP_DIR = resolve(__dirname, 'coverage/reports/.stage-c-don-slices');
mkdirSync(REPORTS_DIR, { recursive: true });
mkdirSync(SLICE_TMP_DIR, { recursive: true });
for (const f of readdirSync(SLICE_TMP_DIR)) { if (f.endsWith('.json')) { try { unlinkSync(join(SLICE_TMP_DIR, f)); } catch { /* ignore */ } } }

const DON_ACTION_KINDS = new Set<string>([
  'give_don_to_target', 'give_don_to_opp_target',
  'set_active_don', 'return_opp_don_to_deck',
  'transfer_attached_don', 'rest_opp_don',
]);

const SUPPORTED_TRIGGERS = new Set<string>(['on_play', 'activate_main', 'when_attacking', 'at_end_of_turn_self']);

interface CardDef {
  readonly id: string; readonly name: string; readonly kind: 'character' | 'event' | 'stage' | 'leader' | 'don';
  readonly cost?: number | null; readonly power?: number | null; readonly colors?: ReadonlyArray<string>; readonly traits?: ReadonlyArray<string>;
  readonly keywords?: ReadonlyArray<string>; readonly effectText?: string;
  readonly effectSpecV2?: {
    readonly clauses?: ReadonlyArray<{
      readonly trigger?: string;
      readonly action?: { readonly kind?: string; readonly magnitude?: number | Record<string, unknown>; readonly rested?: boolean; readonly fromKind?: string };
      readonly target?: { readonly kind?: string; readonly filter?: Record<string, unknown>; readonly count?: number };
      readonly cost?: Record<string, unknown>;
      readonly condition?: { readonly type?: string; readonly [k: string]: unknown };
    }>;
  };
  readonly [k: string]: unknown;
}

const CORPUS_RAW = JSON.parse(readFileSync(CORPUS_PATH, 'utf-8')) as unknown;
const CORPUS = (Array.isArray(CORPUS_RAW) ? CORPUS_RAW : Object.values(CORPUS_RAW as Record<string, unknown>)) as Array<Record<string, unknown>>;

function firstDonClause(c: Record<string, unknown>): { clauseIndex: number; trigger: string; actionKind: string; magnitude: number; magnitudeIsDynamic: boolean; rested: boolean; targetKind: string | null; gated: boolean; hasCost: boolean } | null {
  const cd = c as CardDef;
  const clauses = cd.effectSpecV2?.clauses ?? [];
  for (let i = 0; i < clauses.length; i++) {
    const cl = clauses[i]!;
    const ak = cl.action?.kind;
    if (typeof ak !== 'string' || !DON_ACTION_KINDS.has(ak)) continue;
    const a = cl.action!;
    const m = a.magnitude;
    return {
      clauseIndex: i,
      trigger: typeof cl.trigger === 'string' ? cl.trigger : '',
      actionKind: ak,
      magnitude: typeof m === 'number' ? m : 1,
      magnitudeIsDynamic: typeof m !== 'number' && m !== undefined,
      rested: a.rested === true,
      targetKind: typeof cl.target?.kind === 'string' ? cl.target.kind : null,
      gated: cl.condition !== undefined,
      hasCost: cl.cost !== undefined,
    };
  }
  return null;
}

const CARDS: CardDef[] = CORPUS.filter((c) => firstDonClause(c) !== null) as CardDef[];
CARDS.sort((a, b) => a.id.localeCompare(b.id));

const SLICE_SIZE = 25;
const SLICE_COUNT = Math.ceil(CARDS.length / SLICE_SIZE);
/* eslint-disable no-console */
console.log(`[stage-c-don-manipulation] Discovered ${CARDS.length} DON-family cards → ${SLICE_COUNT} slice(s) of up to ${SLICE_SIZE}`);
/* eslint-enable no-console */

const ANCHORS = new Set<string>([
  'EB01-002',  // give_don_to_target rested:true mag:1
  'EB01-012',  // set_active_don mag:2
  'EB02-009',  // transfer_attached_don fromKind:any_own
  'OP02-085',  // return_opp_don_to_deck mag:1
  'OP04-021',  // rest_opp_don mag:1
  'OP12-075',  // give_don_to_opp_target mag:1
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
  targetIids: ReadonlyArray<string>; // primary targets the action should affect
  controlIids: ReadonlyArray<string>; // optional filter-violator controls
  aDonDeckLen: number; aDonCostAreaLen: number; aDonRestedLen: number;
  bDonDeckLen: number; bDonCostAreaLen: number; bDonRestedLen: number;
  targetAttachedDon: Record<string, { active: number; rested: number }>;
  controlAttachedDon: Record<string, { active: number; rested: number }>;
  sourceAttachedDon: { active: number; rested: number } | null;
}

async function fullRestoringResetAndSeed(page: Page, sourceZone: SourceZone, card: CardDef, clauseInfo: ReturnType<typeof firstDonClause>): Promise<SeededRefs> {
  return page.evaluate(({ sourceZone, cardDef, clauseInfo }) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    (s as Record<string, unknown>).phase = 'main';
    (s as Record<string, unknown>).activePlayer = 'A';
    (s as Record<string, unknown>).pending = null;
    (s as Record<string, unknown>).result = null;
    (s as Record<string, unknown>).turn = clauseInfo!.trigger === 'when_attacking' ? 5 : 1;
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
    // Wildcard A.leader colors.
    const aLeaderCard = lib[players.A.leader.cardId] as { colors?: string[]; keywords?: string[] } | undefined;
    if (aLeaderCard !== undefined) aLeaderCard.colors = ['red', 'blue', 'green', 'purple', 'black', 'yellow'];
    players.A.leader.rested = false; players.A.leader.summoningSick = false;
    if (players.A.leader.perTurn) { players.A.leader.perTurn.hasAttacked = false; players.A.leader.perTurn.effectsUsed = []; }

    // ── Critical DON setup ──
    // Consolidate all A DON → donDeck baseline, then partition: 16 in donCostArea, 4 in donRested.
    // Patch (2026-06-08): A.donCostArea seed raised 8 → 16 to cover high-cost PLAY_CARD then
    // clause spend without exhausting the pool (e.g., OP07-015 cost-8 Dragon).
    const allADon = [...players.A.donDeck, ...players.A.donCostArea, ...players.A.donRested];
    players.A.donCostArea = allADon.slice(0, 16);
    players.A.donRested = allADon.slice(16, 20);
    players.A.donDeck = allADon.slice(20);
    // Consolidate all B DON → 6 in donCostArea, 2 in donRested.
    const allBDon = [...players.B.donDeck, ...players.B.donCostArea, ...players.B.donRested];
    players.B.donCostArea = allBDon.slice(0, 6);
    players.B.donRested = allBDon.slice(6, 8);
    players.B.donDeck = allBDon.slice(8);

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

    // Place card in library.
    lib[cardDef.id] = cardDef as unknown as Record<string, unknown>;

    // Seed source.
    const srcIid = `don_src_${cardDef.id}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    let sourceIid: string | null = null;
    if (sourceZone === 'a_hand') {
      instances[srcIid] = { instanceId: srcIid, cardId: cardDef.id, controller: 'A', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      players.A.hand.push(srcIid);
      sourceIid = srcIid;
    } else if (sourceZone === 'a_field') {
      instances[srcIid] = { instanceId: srcIid, cardId: cardDef.id, controller: 'A', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      // For transfer_attached_don sources, pre-attach 4 DON to the source.
      if (clauseInfo!.actionKind === 'transfer_attached_don') {
        const inst = instances[srcIid] as { attachedDon: string[] };
        for (let i = 0; i < 4; i++) {
          const donId = players.A.donDeck.shift();
          if (donId !== undefined) inst.attachedDon.push(donId);
        }
      }
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

    // Seed target(s) based on target.kind.
    const targetIids: string[] = []; const controlIids: string[] = [];
    const tk = clauseInfo!.targetKind;
    function seedAFieldChar(name: string): string {
      const synthId = `__donAFld_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `donAFld_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = { id: synthId, name, kind: 'character', cost: 3, power: 3000, counterValue: 1000, colors: ['red'], traits: ['Straw Hat Crew'], keywords: [], effectText: '' };
      instances[iid] = { instanceId: iid, cardId: synthId, controller: 'A', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      (players.A.field as unknown[]).push(instances[iid]);
      return iid;
    }
    function seedBFieldChar(name: string): string {
      const synthId = `__donBFld_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `donBFld_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = { id: synthId, name, kind: 'character', cost: 3, power: 3000, counterValue: 1000, colors: ['blue'], traits: [], keywords: [], effectText: '' };
      instances[iid] = { instanceId: iid, cardId: synthId, controller: 'B', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      (players.B.field as unknown[]).push(instances[iid]);
      return iid;
    }
    if (tk === 'your_leader') {
      targetIids.push(players.A.leader.instanceId);
    } else if (tk === 'your_character') {
      targetIids.push(seedAFieldChar('A Target Char'));
      controlIids.push(seedAFieldChar('A Control Char'));
    } else if (tk === 'your_leader_or_character') {
      // Engine picks first eligible → leader. Use leader as primary; control = extra char.
      targetIids.push(players.A.leader.instanceId);
      controlIids.push(seedAFieldChar('A Control Char'));
    } else if (tk === 'opp_character') {
      targetIids.push(seedBFieldChar('B Target Char'));
      controlIids.push(seedBFieldChar('B Control Char'));
    } else if (tk === 'all_your_characters') {
      targetIids.push(seedAFieldChar('A Multi 1'));
      targetIids.push(seedAFieldChar('A Multi 2'));
    } else if (tk === 'opp_leader') {
      targetIids.push(players.B.leader.instanceId);
    } else if (tk === 'self') {
      if (sourceIid !== null) targetIids.push(sourceIid);
    }
    // (no-target) actions operate on pools only — no target seeding needed.

    // A.hand fillers (cost/discard satisfaction).
    for (let i = 0; i < 4; i++) {
      const synthId = `__donHand_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `donH_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = { id: synthId, name: `Hand Filler ${i}`, kind: 'character', cost: 1, power: 1000, counterValue: 1000, colors: ['red'], traits: [], keywords: [], effectText: '' };
      instances[iid] = { instanceId: iid, cardId: synthId, controller: 'A', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      players.A.hand.push(iid);
    }
    w.__store!.setState({ state: { ...s, players: { ...(s.players as Record<string, unknown>), A: { ...players.A }, B: { ...players.B } } } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }

    // Snapshot DON pools + attached DON counts for target/control/source.
    const targetAttachedDon: Record<string, { active: number; rested: number }> = {};
    const controlAttachedDon: Record<string, { active: number; rested: number }> = {};
    function inspectAttach(iid: string): { active: number; rested: number } {
      if (iid === players.A.leader.instanceId) return { active: players.A.leader.attachedDon?.length ?? 0, rested: players.A.leader.attachedDonRested?.length ?? 0 };
      if (iid === players.B.leader.instanceId) return { active: players.B.leader.attachedDon?.length ?? 0, rested: players.B.leader.attachedDonRested?.length ?? 0 };
      const inst = instances[iid] as { attachedDon?: string[]; attachedDonRested?: string[] } | undefined;
      return { active: inst?.attachedDon?.length ?? 0, rested: inst?.attachedDonRested?.length ?? 0 };
    }
    for (const iid of targetIids) targetAttachedDon[iid] = inspectAttach(iid);
    for (const iid of controlIids) controlAttachedDon[iid] = inspectAttach(iid);
    const sourceAttachedDon = sourceIid !== null ? inspectAttach(sourceIid) : null;
    return {
      sourceIid,
      targetIids, controlIids,
      aDonDeckLen: players.A.donDeck.length, aDonCostAreaLen: players.A.donCostArea.length, aDonRestedLen: players.A.donRested.length,
      bDonDeckLen: players.B.donDeck.length, bDonCostAreaLen: players.B.donCostArea.length, bDonRestedLen: players.B.donRested.length,
      targetAttachedDon, controlAttachedDon, sourceAttachedDon,
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

interface AfterSnapshot {
  aDonDeckLen: number; aDonCostAreaLen: number; aDonRestedLen: number;
  bDonDeckLen: number; bDonCostAreaLen: number; bDonRestedLen: number;
  attached: Record<string, { active: number; rested: number }>;
  sourceAttached: { active: number; rested: number } | null;
}

async function readAfterSnapshot(page: Page, idsOfInterest: ReadonlyArray<string>, sourceIid: string | null): Promise<AfterSnapshot> {
  return page.evaluate(({ ids, sourceIid }) => {
    const w = window as unknown as { __store?: { getState: () => { state: { players: { A: { donDeck: string[]; donCostArea: string[]; donRested: string[]; leader: { instanceId: string; attachedDon?: string[]; attachedDonRested?: string[] } }; B: { donDeck: string[]; donCostArea: string[]; donRested: string[]; leader: { instanceId: string; attachedDon?: string[]; attachedDonRested?: string[] } } }; instances: Record<string, { attachedDon?: string[]; attachedDonRested?: string[] }> } } } };
    const ps = w.__store!.getState().state.players;
    const insts = w.__store!.getState().state.instances;
    function inspect(iid: string): { active: number; rested: number } {
      if (iid === ps.A.leader.instanceId) return { active: ps.A.leader.attachedDon?.length ?? 0, rested: ps.A.leader.attachedDonRested?.length ?? 0 };
      if (iid === ps.B.leader.instanceId) return { active: ps.B.leader.attachedDon?.length ?? 0, rested: ps.B.leader.attachedDonRested?.length ?? 0 };
      const inst = insts[iid];
      return { active: inst?.attachedDon?.length ?? 0, rested: inst?.attachedDonRested?.length ?? 0 };
    }
    const attached: Record<string, { active: number; rested: number }> = {};
    for (const id of ids) attached[id] = inspect(id);
    return {
      aDonDeckLen: ps.A.donDeck.length, aDonCostAreaLen: ps.A.donCostArea.length, aDonRestedLen: ps.A.donRested.length,
      bDonDeckLen: ps.B.donDeck.length, bDonCostAreaLen: ps.B.donCostArea.length, bDonRestedLen: ps.B.donRested.length,
      attached, sourceAttached: sourceIid !== null ? inspect(sourceIid) : null,
    };
  }, { ids: idsOfInterest, sourceIid });
}

// Sibling-clause detection: count OTHER clauses in same card that also touch DON pools.
function siblingDonTouchers(card: CardDef, targetClauseIdx: number, pool: 'A_COST' | 'A_RESTED' | 'A_DECK' | 'B_COST' | 'B_RESTED' | 'B_DECK' | 'ATTACHED'): number {
  const clauses = card.effectSpecV2?.clauses ?? [];
  // Roughly: any DON-family action OR any cost-spend that touches DON.
  let count = 0;
  for (let i = 0; i < clauses.length; i++) {
    if (i === targetClauseIdx) continue;
    const ak = clauses[i]?.action?.kind;
    if (typeof ak !== 'string') continue;
    if (DON_ACTION_KINDS.has(ak)) {
      // Specifically detect overlap with `pool`.
      if (pool === 'A_COST' && (ak === 'give_don_to_target' || ak === 'set_active_don')) count++;
      else if (pool === 'A_RESTED' && (ak === 'set_active_don')) count++;
      else if (pool === 'B_COST' && (ak === 'give_don_to_opp_target' || ak === 'return_opp_don_to_deck' || ak === 'rest_opp_don')) count++;
      else if (pool === 'B_RESTED' && ak === 'rest_opp_don') count++;
      else if (pool === 'B_DECK' && ak === 'return_opp_don_to_deck') count++;
      else if (pool === 'ATTACHED' && (ak === 'give_don_to_target' || ak === 'give_don_to_opp_target' || ak === 'transfer_attached_don')) count++;
      void pool;
    }
    // Also detect DON-spending costs that reduce A.donCostArea.
    const c = clauses[i]?.cost as Record<string, unknown> | undefined;
    if (pool === 'A_COST' && c !== undefined) {
      if (typeof c['donCost'] === 'number' && (c['donCost'] as number) > 0) count++;
      else if (c['donCostReturnToDeck'] !== undefined) count++;
    }
  }
  return count;
}

interface DeltaVerdict { verdict: 'CORRECT' | 'WRONG' | 'INCONCLUSIVE' | 'NO_DELTA' | 'NOT_OBSERVABLE'; observed: string; expected: string; notes: string }

function classifyDonDelta(
  card: CardDef,
  clauseInfo: NonNullable<ReturnType<typeof firstDonClause>>,
  before: SeededRefs,
  after: AfterSnapshot,
): DeltaVerdict {
  const mag = clauseInfo.magnitude;
  const ak = clauseInfo.actionKind;
  if (clauseInfo.magnitudeIsDynamic) {
    // Dynamic magnitude (e.g., per_count) — we can't compute exact expected; accept any non-zero matching delta.
    return classifyDonDeltaLoose(ak, before, after, clauseInfo);
  }
  if (ak === 'give_don_to_target') {
    const aSpentDelta = before.aDonCostAreaLen - after.aDonCostAreaLen;
    // Patch (2026-06-08): engine target resolver may legally pick the source itself when
    // target.kind = your_character / your_leader_or_character and the source matches the
    // clause filter (e.g. Karoo→trait:Alabasta, Wyper→typeIncludes:Sky Island). DON attaches
    // correctly to source — sum target + source + control to capture all legal attachments.
    function sumAttach(ids: ReadonlyArray<string>, beforeMap: Record<string, { active: number; rested: number }>, sumBoth: boolean): number {
      let sum = 0;
      for (const tid of ids) {
        const b = beforeMap[tid] ?? { active: 0, rested: 0 };
        const a = after.attached[tid] ?? { active: 0, rested: 0 };
        if (sumBoth) sum += (a.active - b.active) + (a.rested - b.rested);
        else {
          const restedField: 'rested' | 'active' = clauseInfo.rested ? 'rested' : 'active';
          sum += a[restedField] - b[restedField];
        }
      }
      return sum;
    }
    const targetDelta = sumAttach(before.targetIids, before.targetAttachedDon, true);
    const controlDelta = sumAttach(before.controlIids, before.controlAttachedDon, true);
    // Source delta: source.attachedDon may have grown if engine picked source as target.
    const sourceBeforeTotal = (before.sourceAttachedDon?.active ?? 0) + (before.sourceAttachedDon?.rested ?? 0);
    const sourceAfterTotal = (after.sourceAttached?.active ?? 0) + (after.sourceAttached?.rested ?? 0);
    const sourceDelta = sourceAfterTotal - sourceBeforeTotal;
    const totalLegalAttach = targetDelta + sourceDelta;
    const sibCount = siblingDonTouchers(card, clauseInfo.clauseIndex, 'A_COST');
    if (controlDelta > 0) {
      return { verdict: 'WRONG', observed: `control.attachΔ=+${controlDelta} target.attachΔ=+${targetDelta} source.attachΔ=+${sourceDelta}`, expected: `+${mag} to target or source only`, notes: `filter-violating control gained DON — engine resolver targeting bug` };
    }
    if (totalLegalAttach === mag && aSpentDelta >= mag) {
      const landed = sourceDelta > 0 && targetDelta === 0 ? 'source' : targetDelta > 0 && sourceDelta === 0 ? 'target' : 'split';
      return { verdict: 'CORRECT', observed: `target+source attachΔ=+${totalLegalAttach} (${landed}); A.costΔ=-${aSpentDelta}`, expected: `+${mag} / -${mag}`, notes: `clause-isolated DON attachment verified (engine resolved to ${landed})` };
    }
    if (totalLegalAttach === 0 && aSpentDelta === 0) {
      return { verdict: 'NO_DELTA', observed: 'no DON movement', expected: `+${mag}`, notes: 'engine produced no attach delta' };
    }
    if (sibCount > 0) {
      return { verdict: 'INCONCLUSIVE', observed: `totalAttachΔ=+${totalLegalAttach}; A.costΔ=-${aSpentDelta}`, expected: `+${mag}`, notes: `${sibCount} sibling DON-touchers may contaminate A.donCostArea` };
    }
    if (totalLegalAttach > 0) {
      return { verdict: 'INCONCLUSIVE', observed: `totalAttachΔ=+${totalLegalAttach}`, expected: `+${mag}`, notes: 'partial — engine may have run out of A.donCostArea' };
    }
    return { verdict: 'WRONG', observed: `attachΔ=+${totalLegalAttach} aSpend=${aSpentDelta}`, expected: `+${mag}`, notes: `engine moved DON but not to any inspected instance (target/source/control)` };
  }
  if (ak === 'give_don_to_opp_target') {
    const bSpentDelta = before.bDonCostAreaLen - after.bDonCostAreaLen;
    // Mirror give_don_to_target: also consider source/control.
    function sumAttachOpp(ids: ReadonlyArray<string>, beforeMap: Record<string, { active: number; rested: number }>): number {
      let sum = 0;
      for (const tid of ids) {
        const b = beforeMap[tid] ?? { active: 0, rested: 0 };
        const a = after.attached[tid] ?? { active: 0, rested: 0 };
        sum += (a.active - b.active) + (a.rested - b.rested);
      }
      return sum;
    }
    const targetDelta = sumAttachOpp(before.targetIids, before.targetAttachedDon);
    const controlDelta = sumAttachOpp(before.controlIids, before.controlAttachedDon);
    const sourceBeforeTotal = (before.sourceAttachedDon?.active ?? 0) + (before.sourceAttachedDon?.rested ?? 0);
    const sourceAfterTotal = (after.sourceAttached?.active ?? 0) + (after.sourceAttached?.rested ?? 0);
    const sourceDelta = sourceAfterTotal - sourceBeforeTotal;
    const totalLegalAttach = targetDelta + sourceDelta;
    if (controlDelta > 0) {
      return { verdict: 'WRONG', observed: `control.attachΔ=+${controlDelta}`, expected: 'control unaffected', notes: 'filter-violating control gained DON' };
    }
    if (totalLegalAttach === mag && bSpentDelta >= mag) {
      return { verdict: 'CORRECT', observed: `target+source attachΔ=+${totalLegalAttach}; B.donCostΔ=-${bSpentDelta}`, expected: `+${mag} / -${mag}`, notes: `opp DON attached` };
    }
    if (totalLegalAttach === 0 && bSpentDelta === 0) {
      return { verdict: 'NO_DELTA', observed: 'no DON movement', expected: `+${mag}`, notes: 'engine produced no delta' };
    }
    return { verdict: 'INCONCLUSIVE', observed: `attachΔ=+${totalLegalAttach} bSpend=${bSpentDelta}`, expected: `+${mag}`, notes: 'partial / contaminated' };
  }
  if (ak === 'set_active_don') {
    // Patch (2026-06-08): on_play characters pay their cost via PLAY_CARD before the clause
    // fires, REST-ing card.cost DON (costArea → donRested). The set_active_don clause then
    // un-rests `mag` (donRested → costArea). Net direction: rested grows by (cost - mag),
    // costArea shrinks by (cost - mag). For other triggers the source is already on field, no
    // PLAY cost-rest contamination — direct -mag / +mag.
    const sib = siblingDonTouchers(card, clauseInfo.clauseIndex, 'A_COST');
    const isPlayCardPath = clauseInfo.trigger === 'on_play' && (card.kind === 'character' || card.kind === 'stage' || card.kind === 'event');
    const cardCost = typeof card.cost === 'number' ? card.cost : 0;
    const restedDelta = after.aDonRestedLen - before.aDonRestedLen;   // positive means rested grew
    const costDelta = after.aDonCostAreaLen - before.aDonCostAreaLen; // positive means cost grew
    // Expected per clause alone: rested-mag, cost+mag. Combined with PLAY_CARD cost-rest:
    //   restedExpected = +cost (rest) - mag (un-rest) = cost - mag
    //   costExpected   = -cost (cost-rested) + mag (set-active) = mag - cost
    const expectedRestedNet = isPlayCardPath ? cardCost - mag : -mag;
    const expectedCostNet = isPlayCardPath ? mag - cardCost : mag;
    if (sib > 0) {
      return { verdict: 'INCONCLUSIVE', observed: `A.restedΔ=${restedDelta} A.costΔ=${costDelta}`, expected: `restedΔ=${expectedRestedNet} costΔ=${expectedCostNet}`, notes: `${sib} sibling DON-toucher(s) — contamination possible` };
    }
    if (restedDelta === expectedRestedNet && costDelta === expectedCostNet) {
      return { verdict: 'CORRECT', observed: `A.restedΔ=${restedDelta} A.costΔ=${costDelta}`, expected: `restedΔ=${expectedRestedNet} costΔ=${expectedCostNet}`, notes: isPlayCardPath ? `set_active_don clean-isolated (PLAY cost-rest=${cardCost} netted against mag=${mag})` : `set_active_don clean-isolated` };
    }
    // Loose acceptance: the un-rest action ran at least once (donRested decreased OR costArea increased relative to the cost-rest baseline).
    if (isPlayCardPath && restedDelta < cardCost && costDelta > -cardCost) {
      // Engine un-rested at least some — partial because donRested ran out.
      return { verdict: 'INCONCLUSIVE', observed: `A.restedΔ=${restedDelta} A.costΔ=${costDelta} (PLAY cost-rest=${cardCost})`, expected: `restedΔ=${expectedRestedNet} costΔ=${expectedCostNet}`, notes: `partial set_active_don — engine may have insufficient donRested after PLAY cost` };
    }
    if (restedDelta === 0 && costDelta === 0) {
      return { verdict: 'NO_DELTA', observed: 'no donRested movement', expected: `restedΔ=${expectedRestedNet}`, notes: 'engine produced no delta' };
    }
    return { verdict: 'WRONG', observed: `A.restedΔ=${restedDelta} A.costΔ=${costDelta}`, expected: `restedΔ=${expectedRestedNet} costΔ=${expectedCostNet}`, notes: `unbalanced movement (PLAY cost-rest=${cardCost})` };
  }
  if (ak === 'return_opp_don_to_deck') {
    const sib = siblingDonTouchers(card, clauseInfo.clauseIndex, 'B_COST');
    const costDelta = before.bDonCostAreaLen - after.bDonCostAreaLen;
    const deckDelta = after.bDonDeckLen - before.bDonDeckLen;
    if (sib > 0) return { verdict: 'INCONCLUSIVE', observed: `B.costΔ=-${costDelta} B.deckΔ=+${deckDelta}`, expected: `-${mag} / +${mag}`, notes: `${sib} sibling B.donCost-toucher(s)` };
    if (costDelta === mag && deckDelta === mag) return { verdict: 'CORRECT', observed: `B.costΔ=-${costDelta} B.deckΔ=+${deckDelta}`, expected: `-${mag} / +${mag}`, notes: 'opp DON returned to deck' };
    if (costDelta === 0 && deckDelta === 0) return { verdict: 'NO_DELTA', observed: 'no opp DON delta', expected: `-${mag}`, notes: 'engine produced no delta' };
    return { verdict: 'INCONCLUSIVE', observed: `costΔ=-${costDelta} deckΔ=+${deckDelta}`, expected: `${mag}`, notes: 'partial — opp.donCost may have <mag' };
  }
  if (ak === 'rest_opp_don') {
    const sib = siblingDonTouchers(card, clauseInfo.clauseIndex, 'B_COST');
    const costDelta = before.bDonCostAreaLen - after.bDonCostAreaLen;
    const restedDelta = after.bDonRestedLen - before.bDonRestedLen;
    if (sib > 0) return { verdict: 'INCONCLUSIVE', observed: `B.costΔ=-${costDelta} B.restedΔ=+${restedDelta}`, expected: `-${mag} / +${mag}`, notes: `${sib} sibling B.donCost-toucher(s)` };
    if (costDelta === mag && restedDelta === mag) return { verdict: 'CORRECT', observed: `B.costΔ=-${costDelta} B.restedΔ=+${restedDelta}`, expected: `-${mag} / +${mag}`, notes: 'opp DON rested' };
    if (costDelta === 0 && restedDelta === 0) return { verdict: 'NO_DELTA', observed: 'no opp DON cost-area delta', expected: `-${mag}`, notes: 'engine produced no delta' };
    return { verdict: 'INCONCLUSIVE', observed: `costΔ=-${costDelta} restedΔ=+${restedDelta}`, expected: `${mag}`, notes: 'partial' };
  }
  if (ak === 'transfer_attached_don') {
    // Source.attached → target.attached.
    if (before.sourceAttachedDon === null || after.sourceAttached === null || before.targetIids.length === 0) {
      return { verdict: 'NO_DELTA', observed: 'no source/target', expected: 'transfer', notes: 'recipe did not seed source or target' };
    }
    const sourceTotalBefore = before.sourceAttachedDon.active + before.sourceAttachedDon.rested;
    const sourceTotalAfter = after.sourceAttached.active + after.sourceAttached.rested;
    const sourceDelta = sourceTotalBefore - sourceTotalAfter;
    let targetGain = 0;
    for (const tid of before.targetIids) {
      const b = before.targetAttachedDon[tid] ?? { active: 0, rested: 0 };
      const a = after.attached[tid] ?? { active: 0, rested: 0 };
      targetGain += (a.active - b.active) + (a.rested - b.rested);
    }
    if (sourceDelta === mag && targetGain === mag) {
      return { verdict: 'CORRECT', observed: `source.attachΔ=-${sourceDelta} target.attachΔ=+${targetGain}`, expected: `${mag}`, notes: 'transfer verified' };
    }
    if (sourceDelta === 0 && targetGain === 0) {
      return { verdict: 'NO_DELTA', observed: 'no transfer', expected: `${mag}`, notes: 'engine produced no delta — source may have had insufficient DON' };
    }
    return { verdict: 'INCONCLUSIVE', observed: `sourceΔ=-${sourceDelta} targetΔ=+${targetGain}`, expected: `${mag}`, notes: 'partial transfer' };
  }
  return { verdict: 'NOT_OBSERVABLE', observed: 'unhandled', expected: '', notes: `unhandled actionKind=${ak}` };
}

function classifyDonDeltaLoose(ak: string, before: SeededRefs, after: AfterSnapshot, clauseInfo: NonNullable<ReturnType<typeof firstDonClause>>): DeltaVerdict {
  // For dynamic-magnitude actions: accept any nonzero delta in expected direction as CORRECT.
  if (ak === 'give_don_to_target') {
    let attachDelta = 0;
    for (const tid of before.targetIids) {
      const b = before.targetAttachedDon[tid] ?? { active: 0, rested: 0 };
      const a = after.attached[tid] ?? { active: 0, rested: 0 };
      attachDelta += (a.active - b.active) + (a.rested - b.rested);
    }
    if (attachDelta > 0) return { verdict: 'CORRECT', observed: `attachΔ=+${attachDelta} (dynamic mag)`, expected: '≥1', notes: 'dynamic magnitude — any non-zero attach counts' };
  }
  void clauseInfo;
  return { verdict: 'INCONCLUSIVE', observed: 'dynamic magnitude', expected: 'context-dependent', notes: `${ak} has dynamic magnitude expression; can't compute literal expected delta` };
}

interface StageCDonResult {
  cardId: string; name: string; kind: string; family: 'don_manipulation';
  actionKind: string; trigger: string; targetKind: string | null; clauseIndex: number;
  magnitude: number; magnitudeIsDynamic: boolean; rested: boolean; gated: boolean; hasCost: boolean;
  dispatchPath: 'PLAY_CARD' | 'ACTIVATE_MAIN' | 'DECLARE_ATTACK' | 'END_TURN' | 'SKIPPED';
  clauseFired: boolean;
  deltaVerdict: DeltaVerdict['verdict'] | 'UNCHECKED';
  pendingKindEnd: string | null;
  pageErrors: ReadonlyArray<string>;
  invariantErrors: ReadonlyArray<string>;
  classification: Classification; confidence: 'HIGH' | 'MEDIUM' | 'LOW'; notes: string;
  isAnchor: boolean;
}

function decideDispatchPath(trigger: string, sourceZone: SourceZone): StageCDonResult['dispatchPath'] {
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

async function processCard(page: Page, card: CardDef, pageErrorsAcc: string[], invariantErrorsAcc: string[]): Promise<StageCDonResult> {
  const clauseInfo = firstDonClause(card);
  const isAnchor = ANCHORS.has(card.id);
  if (clauseInfo === null) {
    return {
      cardId: card.id, name: card.name, kind: card.kind, family: 'don_manipulation',
      actionKind: 'n/a', trigger: 'n/a', targetKind: null, clauseIndex: -1,
      magnitude: 0, magnitudeIsDynamic: false, rested: false, gated: false, hasCost: false,
      dispatchPath: 'SKIPPED', clauseFired: false,
      deltaVerdict: 'UNCHECKED',
      pendingKindEnd: null, pageErrors: [], invariantErrors: [],
      classification: 'INCONCLUSIVE', confidence: 'LOW',
      notes: 'no DON-family clause found (filter mismatch)', isAnchor,
    };
  }
  try {
    const sourceZone = pickSourceZone(card, clauseInfo.trigger);
    const dispatchPath = decideDispatchPath(clauseInfo.trigger, sourceZone);
    if (dispatchPath === 'SKIPPED') {
      return {
        cardId: card.id, name: card.name, kind: card.kind, family: 'don_manipulation',
        actionKind: clauseInfo.actionKind, trigger: clauseInfo.trigger, targetKind: clauseInfo.targetKind, clauseIndex: clauseInfo.clauseIndex,
        magnitude: clauseInfo.magnitude, magnitudeIsDynamic: clauseInfo.magnitudeIsDynamic, rested: clauseInfo.rested, gated: clauseInfo.gated, hasCost: clauseInfo.hasCost,
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
          cardId: card.id, name: card.name, kind: card.kind, family: 'don_manipulation',
          actionKind: clauseInfo.actionKind, trigger: clauseInfo.trigger, targetKind: clauseInfo.targetKind, clauseIndex: clauseInfo.clauseIndex,
          magnitude: clauseInfo.magnitude, magnitudeIsDynamic: clauseInfo.magnitudeIsDynamic, rested: clauseInfo.rested, gated: clauseInfo.gated, hasCost: clauseInfo.hasCost,
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
    const seeded = await fullRestoringResetAndSeed(page, sourceZone, card, clauseInfo);
    if (seeded.sourceIid === null) {
      return {
        cardId: card.id, name: card.name, kind: card.kind, family: 'don_manipulation',
        actionKind: clauseInfo.actionKind, trigger: clauseInfo.trigger, targetKind: clauseInfo.targetKind, clauseIndex: clauseInfo.clauseIndex,
        magnitude: clauseInfo.magnitude, magnitudeIsDynamic: clauseInfo.magnitudeIsDynamic, rested: clauseInfo.rested, gated: clauseInfo.gated, hasCost: clauseInfo.hasCost,
        dispatchPath, clauseFired: false,
        deltaVerdict: 'UNCHECKED',
        pendingKindEnd: null, pageErrors: [], invariantErrors: [],
        classification: 'HARNESS_BUG', confidence: 'LOW', notes: `seeding returned null sourceIid`, isAnchor,
      };
    }
    const historyStartIdx = await readHistoryLen(page);
    const dispatchRes = await dispatchTrigger(page, dispatchPath, seeded.sourceIid);
    await drainPending(page);
    const { markers } = await readHistoryAndMarkers(page, historyStartIdx, seeded.sourceIid);
    const clauseFired = markers.some((m) => m.clauseIndex === clauseInfo.clauseIndex && m.trigger === clauseInfo.trigger && m.actionKind === clauseInfo.actionKind);
    const idsOfInterest = [...seeded.targetIids, ...seeded.controlIids];
    const after = await readAfterSnapshot(page, idsOfInterest, seeded.sourceIid);
    const pendingKindEnd = await readPendingKind(page);
    const newPE = pageErrorsAcc.slice(peBefore);
    const newIE = invariantErrorsAcc.slice(ieBefore);
    let cls: Classification; let confidence: 'HIGH' | 'MEDIUM' | 'LOW'; let notes: string;
    let deltaVerdict: DeltaVerdict['verdict'] = 'NOT_OBSERVABLE';
    if (newPE.length > 0 || newIE.length > 0 || pendingKindEnd !== null) {
      cls = 'ENGINE_BUG'; confidence = 'HIGH';
      notes = `infra failure: PE=${newPE.length} IE=${newIE.length} pendingKindEnd=${pendingKindEnd}`;
    } else if (!dispatchRes.ok) {
      cls = 'HARNESS_GAP'; confidence = 'MEDIUM';
      notes = `dispatch ${dispatchPath} rejected: ${dispatchRes.err}`;
    } else if (!clauseFired) {
      const reason = clauseInfo.gated ? 'condition gated by un-met predicate' : clauseInfo.hasCost ? 'cost block not paid (recipe DON/discard may be insufficient)' : 'trigger fired but action did not reach this clause';
      cls = 'HARNESS_GAP'; confidence = 'MEDIUM';
      notes = `CLAUSE_FIRED never observed for clause[${clauseInfo.clauseIndex}] action=${clauseInfo.actionKind}: ${reason}`;
    } else {
      const verdict = classifyDonDelta(card, clauseInfo, seeded, after);
      deltaVerdict = verdict.verdict;
      if (verdict.verdict === 'CORRECT') { cls = 'VERIFIED'; confidence = 'HIGH'; notes = `dispatched=${dispatchPath}; clauseFired; ${verdict.observed} (expected ${verdict.expected}); ${verdict.notes}`; }
      else if (verdict.verdict === 'WRONG') { cls = 'ENGINE_BUG'; confidence = 'HIGH'; notes = `clause fired but engine produced wrong delta: ${verdict.observed} (expected ${verdict.expected}); ${verdict.notes}`; }
      else if (verdict.verdict === 'INCONCLUSIVE') { cls = 'INCONCLUSIVE'; confidence = 'MEDIUM'; notes = `clause fired; attribution inconclusive: ${verdict.observed} (expected ${verdict.expected}); ${verdict.notes}`; }
      else if (verdict.verdict === 'NO_DELTA') { cls = 'INCONCLUSIVE'; confidence = 'LOW'; notes = `clause fired; ${verdict.observed} (expected ${verdict.expected}); ${verdict.notes}`; }
      else { cls = 'INCONCLUSIVE'; confidence = 'MEDIUM'; notes = `clause fired; ${verdict.notes}`; }
    }
    return {
      cardId: card.id, name: card.name, kind: card.kind, family: 'don_manipulation',
      actionKind: clauseInfo.actionKind, trigger: clauseInfo.trigger, targetKind: clauseInfo.targetKind, clauseIndex: clauseInfo.clauseIndex,
      magnitude: clauseInfo.magnitude, magnitudeIsDynamic: clauseInfo.magnitudeIsDynamic, rested: clauseInfo.rested, gated: clauseInfo.gated, hasCost: clauseInfo.hasCost,
      dispatchPath, clauseFired,
      deltaVerdict,
      pendingKindEnd, pageErrors: newPE, invariantErrors: newIE,
      classification: cls, confidence, notes, isAnchor,
    };
  } catch (err) {
    try { await drainPending(page); } catch { /* ignore */ }
    return {
      cardId: card.id, name: card.name, kind: card.kind, family: 'don_manipulation',
      actionKind: clauseInfo.actionKind, trigger: clauseInfo.trigger, targetKind: clauseInfo.targetKind, clauseIndex: clauseInfo.clauseIndex,
      magnitude: clauseInfo.magnitude, magnitudeIsDynamic: clauseInfo.magnitudeIsDynamic, rested: clauseInfo.rested, gated: clauseInfo.gated, hasCost: clauseInfo.hasCost,
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

test.describe.serial('stage-c-generated-don-manipulation', () => {
  for (let s = 0; s < SLICES.length; s++) {
    const sliceIndex = s; const slice = SLICES[sliceIndex]!;
    test(`slice ${sliceIndex + 1}/${SLICES.length} — ${slice.length} cards (${slice[0]!.id} … ${slice[slice.length - 1]!.id})`, async ({ page }) => {
      test.setTimeout(FIVE_MIN);
      const { drv, pageErrors, invariantErrors } = await bootstrap(page);
      void drv;
      const results: StageCDonResult[] = [];
      for (const card of slice) results.push(await processCard(page, card, pageErrors, invariantErrors));
      expect(pageErrors, `slice ${sliceIndex} pageerrors`).toEqual([]);
      expect(invariantErrors, `slice ${sliceIndex} InvariantErrors`).toEqual([]);
      expect(await readPendingKind(page), `slice ${sliceIndex} no stuck pending`).toBeNull();
      const sliceFile = join(SLICE_TMP_DIR, `don-slice-${String(sliceIndex).padStart(3, '0')}.json`);
      writeFileSync(sliceFile, JSON.stringify({ sliceIndex, cardCount: slice.length, results }, null, 2), 'utf-8');
      /* eslint-disable no-console */
      console.log(`[don-manipulation] wrote slice ${sliceIndex} → ${sliceFile}`);
      /* eslint-enable no-console */
    });
  }

  test('aggregator: roll up don-manipulation slices', async () => {
    const all: StageCDonResult[] = [];
    for (const f of readdirSync(SLICE_TMP_DIR).filter((f) => f.startsWith('don-slice-') && f.endsWith('.json')).sort()) {
      const raw = JSON.parse(readFileSync(join(SLICE_TMP_DIR, f), 'utf-8')) as { results: StageCDonResult[] };
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
    const jsonPath = join(REPORTS_DIR, `stage-c-don-manipulation-${ts}.json`);
    const mdPath = join(REPORTS_DIR, `stage-c-don-manipulation-${ts}.md`);
    const finalReport = {
      family: 'don_manipulation', generatedAt: new Date().toISOString(),
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
    md.push(`# Stage C — DON Manipulation Generated Report\n\n**Generated:** ${new Date().toISOString()}\n**Total DON-family cards discovered:** ${CARDS.length}\n**Total records written:** ${all.length}\n**Slice count:** ${SLICE_COUNT}\n\n`);
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
    md.push(`\n## Report files\n\n- JSON: \`coverage/reports/stage-c-don-manipulation-${ts}.json\`\n- MD: \`coverage/reports/stage-c-don-manipulation-${ts}.md\`\n`);
    writeFileSync(mdPath, md.join(''), 'utf-8');
    /* eslint-disable no-console */
    console.log(`[don-manipulation] FINAL JSON: ${jsonPath}`);
    console.log(`[don-manipulation] FINAL MD:   ${mdPath}`);
    console.log(`[don-manipulation] tally: ${JSON.stringify(buckets)}`);
    /* eslint-enable no-console */
    expect(all.length, 'every card must have a record').toBe(CARDS.length);
  });
});
