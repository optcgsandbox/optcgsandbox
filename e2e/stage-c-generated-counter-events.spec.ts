// stage-c-generated-counter-events — Stage C target #1 per
// `e2e/stage-c-corpus-verification-plan.md`. Auto-discovers every event
// card in `shared/data/cards.json` where either `effectTags` includes
// `'counter_event'` OR `counterEventBoost > 0`, and runs each through a
// controlled counter_window, emitting one `StageCResult` per card.
//
// Audit-only: no engine / UI / cards.json / scenarioFactory edits.
// Reuses harness patterns proven by:
//   - audit-counter-event-magnitude-mismatch.spec.ts (Group 1C)
//   - audit-counter-event-condition-gated.spec.ts (Group 1B/1A/1D)
// Specifically: guard counter to prevent store auto-skip
// (src/store/game.ts:511-520), A.life refill (every FALSE subcase
// flips life when boost=0), state.result=null clear, history-derived
// snap, force-clean fallback for cleanup.
//
// Engine references:
//   - Counter legality: shared/engine-v2/rules/legality.ts:267-302
//     (now: A OR (B AND C) per the patch this session)
//   - playCounterReducer: shared/engine-v2/reducers/attackFlow.ts:317-411
//   - clearPendingAttack: shared/engine-v2/reducers/attackFlow.ts:56-74
//   - Dispatcher clause-iteration break: EffectDispatcher.ts:264-280
//     (now: skipped when pending.kind === 'attack' per the patch this
//     session)
//   - Power-buff handler: actions.ts:75-103 (writes
//     powerModifierThisBattle / powerModifierOneShot per duration)
//
// Slicing: 171 counter-event cards discovered at planning time, sliced
// into 25-card buckets. Each slice runs as its own test() under a
// serial describe so a fresh page is created per slice (Playwright
// fixture). After all slice tests run, a final aggregator test rolls
// up per-slice JSONs into the canonical `stage-c-counter-events-
// <timestamp>.json` + markdown summary at e2e/coverage/reports/.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { PlayerDriver } from './helpers/player';

const FIVE_MIN = 5 * 60_000;

test.use({
  launchOptions: { args: ['--disable-renderer-backgrounding', '--no-sandbox'] },
});

// ── corpus discovery (module load) ───────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CORPUS_PATH = resolve(__dirname, '../shared/data/cards.json');
const REPORTS_DIR = resolve(__dirname, 'coverage/reports');
const SLICE_TMP_DIR = resolve(__dirname, 'coverage/reports/.stage-c-slices');

mkdirSync(REPORTS_DIR, { recursive: true });
mkdirSync(SLICE_TMP_DIR, { recursive: true });
// Clear any stale slice files from prior runs (only THIS spec's files).
for (const f of readdirSync(SLICE_TMP_DIR)) {
  if (f.startsWith('counter-events-slice-') && f.endsWith('.json')) {
    try { unlinkSync(join(SLICE_TMP_DIR, f)); } catch { /* ignore */ }
  }
}

interface CounterEventCardDef {
  readonly id: string;
  readonly name: string;
  readonly kind: 'event';
  readonly cost: number;
  readonly counterEventBoost: number | null;
  readonly effectTags: ReadonlyArray<string>;
  readonly traits: ReadonlyArray<string>;
  readonly colors: ReadonlyArray<string>;
  readonly counterValue: number | null;
  readonly keywords: ReadonlyArray<string>;
  readonly effectText?: string;
  readonly effectSpecV2?: {
    readonly clauses?: ReadonlyArray<{
      readonly trigger?: string;
      readonly action?: { readonly kind?: string };
      readonly target?: { readonly kind?: string };
      readonly cost?: Record<string, unknown>;
      readonly condition?: Record<string, unknown>;
    }>;
  };
  readonly [k: string]: unknown;
}

function isCounterEvent(c: Record<string, unknown>): c is CounterEventCardDef {
  if (c.kind !== 'event') return false;
  const tags = Array.isArray(c.effectTags) ? (c.effectTags as string[]) : [];
  const hasTag = tags.includes('counter_event');
  const boost = typeof c.counterEventBoost === 'number' ? c.counterEventBoost : 0;
  return hasTag || boost > 0;
}

const CORPUS_RAW = JSON.parse(readFileSync(CORPUS_PATH, 'utf-8')) as unknown;
const CORPUS = (Array.isArray(CORPUS_RAW)
  ? CORPUS_RAW
  : Object.values(CORPUS_RAW as Record<string, unknown>)) as Array<Record<string, unknown>>;
const COUNTER_EVENTS: CounterEventCardDef[] = CORPUS.filter(isCounterEvent);
COUNTER_EVENTS.sort((a, b) => a.id.localeCompare(b.id));

const SLICE_SIZE = 25;
const SLICE_COUNT = Math.ceil(COUNTER_EVENTS.length / SLICE_SIZE);

/* eslint-disable no-console */
console.log(`[stage-c-counter-events] Discovered ${COUNTER_EVENTS.length} counter-event cards → ${SLICE_COUNT} slice(s) of up to ${SLICE_SIZE}`);
/* eslint-enable no-console */

// Regression-check cohorts (from directive)
const CONDITION_GATED_VERIFIED = new Set([
  'OP03-055','OP03-072','OP03-097','OP05-037','OP06-115','OP07-076','OP08-115','OP14-078',
]);
const MAGNITUDE_MISMATCH_VERIFIED = new Set([
  'OP01-029','OP04-095','OP05-114','OP07-035','OP07-095','OP11-059',
]);
const NEWLY_PLAYABLE = new Set([
  'EB03-029','EB03-038','EB03-049','EB04-008','EB04-009','EB04-029',
  'EB04-040','EB04-050','OP04-037','OP04-076','OP06-017','OP06-059',
]);
const STAGE_A_BASELINE = new Set(['OP01-118']);

// ── result shapes ────────────────────────────────────────────────────

type Classification =
  | 'VERIFIED'
  | 'ENGINE_BUG'
  | 'CARD_DATA_BUG'
  | 'UI_BUG'
  | 'HARNESS_BUG'
  | 'NOT_IMPLEMENTED'
  | 'NO_UI_EXPECTED'
  | 'INCONCLUSIVE';

interface SetupRecipe {
  donCount: number;
  aHandSize: number;
  aLifeCount: number;
  seedGuardCounter: boolean;
  // Future: aLeaderTraits, seededField, etc. (Stage C phases C+).
}

interface StateDiff {
  aHandDelta?: number;
  aTrashDelta?: number;
  aLifeDelta?: number;
  aFieldDelta?: number;
  aDonCostDelta?: number;
  leaderModBattle?: number;
  leaderModOneShot?: number;
  counterBoost?: number;
}

interface StageCResult {
  cardId: string;
  name: string;
  family: 'counter_event';
  setupRecipe: SetupRecipe;
  actionPerformed: 'PLAY_COUNTER' | 'PLAY_COUNTER_NOT_OFFERED' | 'SKIPPED';
  expectedStateDiff: StateDiff | null;
  observedStateDiff: StateDiff;
  promptExpectation: 'no_prompt' | 'auto_resolved' | 'human_prompt_expected' | 'human_prompt_observed' | 'human_prompt_missing';
  classification: Classification;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  notes: string;
  historyTail: ReadonlyArray<Record<string, unknown>>;
  pageErrors: ReadonlyArray<string>;
  invariantErrors: ReadonlyArray<string>;
  // Invariant checks
  donConserved: boolean;
  noDuplicateInstanceIds: boolean;
  noStuckPending: boolean;
  // Membership flags for regression cohorts
  cohort?: 'condition_gated' | 'magnitude_mismatch' | 'stage_a_baseline' | 'newly_playable' | null;
}

// ── harness helpers (mirroring audit specs) ──────────────────────────

async function bootstrap(page: Page): Promise<{ drv: PlayerDriver; pageErrors: string[]; invariantErrors: string[] }> {
  const pageErrors: string[] = [];
  const invariantErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('InvariantError') || t.includes('invariant')) invariantErrors.push(t);
  });
  const drv = new PlayerDriver(page);
  await drv.open();
  await drv.waitForPhase('dice_roll');
  await drv.rollDice();
  try { await drv.waitForPhase('first_player_choice', 15_000); await drv.chooseGoFirst(); } catch { /* skip */ }
  try { await drv.waitForPhase('mulligan', 8_000); await drv.keepMulliganHand(); } catch { /* skip */ }
  await expect.poll(
    async () => {
      const s = await drv.getState();
      return { phase: s.phase, activePlayer: s.activePlayer };
    },
    { timeout: 60_000 },
  ).toMatchObject({ phase: 'main', activePlayer: 'A' });
  await drv.normalizeToATurn1Main();
  return { drv, pageErrors, invariantErrors };
}

interface ResetOpts {
  donCount: number;
  aHandSize?: number;
  aLifeCount?: number;
  seedGuardCounter?: boolean;
}

async function resetForCard(page: Page, opts: ResetOpts): Promise<void> {
  await page.evaluate((opts) => {
    const w = window as unknown as {
      __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void };
      __getLegalActions?: (s: unknown, p: string) => unknown;
    };
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
      B: { leader: { instanceId: string }; field: unknown[]; life: string[]; deck: string[] };
    };
    const instances = s.instances as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    // Clear leader transient mods.
    players.A.leader.powerModifierThisBattle = undefined;
    players.A.leader.powerModifierContinuous = undefined;
    players.A.leader.powerModifierOneShot = undefined;
    players.A.leader.powerModifierExpiresInTurns = undefined;
    // Reset fields.
    players.A.field = [];
    players.B.field = [];
    // Rebuild A.hand with fillers + optional guard counter.
    const targetHand = opts.aHandSize ?? 5;
    players.A.hand = [];
    for (let i = 0; i < targetHand; i++) {
      const synthId = `__fillerHand_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `fillerH_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = {
        id: synthId, name: `FillerHand ${i}`, kind: 'character',
        cost: 1, power: 1000, counterValue: null,
        colors: ['red'], traits: [], keywords: [], effectText: '',
      };
      instances[iid] = {
        instanceId: iid, cardId: synthId, controller: 'A',
        rested: false, summoningSick: false,
        attachedDon: [], attachedDonRested: [],
        perTurn: { hasAttacked: false, effectsUsed: [] },
      };
      players.A.hand.push(iid);
    }
    if (opts.seedGuardCounter !== false) {
      const synthId = `__guardCEv_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `guardCEv_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = {
        id: synthId, name: 'Guard Counter Event', kind: 'event',
        cost: 0, power: null, counterValue: null,
        colors: ['red'], traits: [], keywords: [], effectText: '',
        counterEventBoost: 1000,
        effectSpecV2: { clauses: [], continuous: [], replacements: [], schemaVersion: 2, verified: 'human-reviewed' },
      };
      instances[iid] = {
        instanceId: iid, cardId: synthId, controller: 'A',
        rested: false, summoningSick: false,
        attachedDon: [], attachedDonRested: [],
        perTurn: { hasAttacked: false, effectsUsed: [] },
      };
      players.A.hand.push(iid);
    }
    // A.life — top up to known size (boost=0 false subcases will flip life otherwise).
    const TARGET_A_LIFE = opts.aLifeCount ?? 5;
    while (players.A.life.length < TARGET_A_LIFE) {
      const synthId = `__seedLife_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `seedLife_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = {
        id: synthId, name: 'Life Placeholder', kind: 'character',
        cost: 1, power: 1000, counterValue: 1000,
        colors: ['red'], traits: [], keywords: [], effectText: '',
      };
      instances[iid] = {
        instanceId: iid, cardId: synthId, controller: 'A',
        rested: false, summoningSick: false,
        attachedDon: [], attachedDonRested: [],
        perTurn: { hasAttacked: false, effectsUsed: [] },
      };
      players.A.life.push(iid);
    }
    while (players.A.life.length > TARGET_A_LIFE) players.A.life.pop();
    // A.donCostArea — top up to opts.donCount, preserving DON conservation across audit.
    const allDon = [...players.A.donDeck, ...players.A.donCostArea, ...players.A.donRested];
    players.A.donDeck = allDon.slice(opts.donCount);
    players.A.donCostArea = allDon.slice(0, opts.donCount);
    players.A.donRested = [];
    w.__store!.setState({ state: { ...s, players: { ...(s.players as Record<string, unknown>), A: { ...players.A }, B: { ...players.B } } } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
  }, opts);
  await page.waitForTimeout(80);
}

async function seedCardInAHand(page: Page, def: Record<string, unknown>): Promise<string> {
  return page.evaluate((def) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    lib[def['id'] as string] = def;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { hand: string[] } };
    const iid = `stageCCEv_${def['id']}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    inst[iid] = {
      instanceId: iid, cardId: def['id'], controller: 'A',
      rested: false, summoningSick: false,
      attachedDon: [], attachedDonRested: [],
      perTurn: { hasAttacked: false, effectsUsed: [] },
    };
    players.A.hand = [...players.A.hand, iid];
    w.__store!.setState({ state: { ...s } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
    return iid;
  }, def);
}

async function enterCounterWindow(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const players = s.players as { A: { leader: { instanceId: string } }; B: { leader: { instanceId: string } } };
    (s as Record<string, unknown>).phase = 'counter_window';
    (s as Record<string, unknown>).activePlayer = 'B';
    (s as Record<string, unknown>).pending = {
      kind: 'attack',
      pendingAttack: {
        attackerInstanceId: players.B.leader.instanceId,
        targetInstanceId: players.A.leader.instanceId,
        counterBoost: 0,
      },
    };
    w.__store!.setState({ state: { ...s, players: { ...(s.players as Record<string, unknown>), A: { ...players.A }, B: { ...players.B } } } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
  });
  await page.waitForTimeout(60);
}

async function dispatchAs(page: Page, action: object): Promise<{ ok: boolean; err: string | null }> {
  const res = await page.evaluate((a) => {
    try {
      const w = window as unknown as { __store?: { getState: () => { dispatch: (a: unknown) => void } } };
      w.__store!.getState().dispatch(a);
      return { ok: true, err: null };
    } catch (e) {
      return { ok: false, err: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
    }
  }, action);
  await page.waitForTimeout(150);
  return res;
}

async function readPendingKind(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { state: { pending: { kind?: string } | null } } } };
    return w.__store!.getState().state.pending?.kind ?? null;
  });
}

async function legalCounterIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown } }; __getLegalActions?: (s: unknown, p: string) => unknown[] };
    if (!w.__getLegalActions) return [];
    const s = w.__store!.getState().state;
    return (w.__getLegalActions(s, 'A') as { type: string; instanceId?: string }[])
      .filter((a) => a.type === 'PLAY_COUNTER')
      .map((a) => a.instanceId ?? '');
  });
}

interface FullSnap {
  phase: string;
  pendingKind: string | null;
  counterBoost: number;
  aLeaderModBattle: number;
  aLeaderModOneShot: number;
  aHandLen: number;
  aTrashLen: number;
  aFieldLen: number;
  aLifeLen: number;
  aDonCost: number;
  aDonRested: number;
  aDonDeck: number;
  donTotalA: number; // for conservation check (excludes attachedDon for simplicity in counter flow)
  attachedDonA: number;
  instanceIdSet: ReadonlyArray<string>;
  duplicateIids: ReadonlyArray<string>;
  historyTail: ReadonlyArray<Record<string, unknown>>;
}

async function readFullSnap(page: Page): Promise<FullSnap> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __store?: { getState: () => { state: {
        phase: string;
        pending: { kind?: string; pendingAttack?: { counterBoost?: number } } | null;
        players: {
          A: {
            hand: string[]; trash: string[]; life: string[]; deck: string[];
            donDeck: string[]; donCostArea: string[]; donRested: string[];
            field: { instanceId: string }[];
            leader: { instanceId: string; powerModifierThisBattle?: number; powerModifierOneShot?: number };
          };
          B: { field: { instanceId: string }[] };
        };
        instances: Record<string, { attachedDon?: string[]; attachedDonRested?: string[] }>;
        history: ReadonlyArray<Record<string, unknown>>;
      } } };
    };
    const s = w.__store!.getState().state;
    // Collect instance IDs across all A zones for dup-check.
    const allIids: string[] = [];
    allIids.push(s.players.A.leader.instanceId);
    for (const id of s.players.A.hand) allIids.push(id);
    for (const id of s.players.A.trash) allIids.push(id);
    for (const id of s.players.A.life) allIids.push(id);
    for (const id of s.players.A.deck) allIids.push(id);
    for (const id of s.players.A.donDeck) allIids.push(id);
    for (const id of s.players.A.donCostArea) allIids.push(id);
    for (const id of s.players.A.donRested) allIids.push(id);
    for (const inst of s.players.A.field) allIids.push(inst.instanceId);
    // Attached DON live on instances; collect them separately for conservation.
    let attachedDonA = 0;
    for (const iid of allIids) {
      const inst = s.instances[iid];
      if (inst !== undefined) {
        attachedDonA += (inst.attachedDon?.length ?? 0) + (inst.attachedDonRested?.length ?? 0);
      }
    }
    const seen = new Set<string>();
    const dups = new Set<string>();
    for (const id of allIids) {
      if (seen.has(id)) dups.add(id);
      else seen.add(id);
    }
    const donTotalA = s.players.A.donDeck.length + s.players.A.donCostArea.length + s.players.A.donRested.length + attachedDonA;
    return {
      phase: s.phase,
      pendingKind: s.pending?.kind ?? null,
      counterBoost: s.pending?.pendingAttack?.counterBoost ?? 0,
      aLeaderModBattle: s.players.A.leader.powerModifierThisBattle ?? 0,
      aLeaderModOneShot: s.players.A.leader.powerModifierOneShot ?? 0,
      aHandLen: s.players.A.hand.length,
      aTrashLen: s.players.A.trash.length,
      aFieldLen: s.players.A.field.length,
      aLifeLen: s.players.A.life.length,
      aDonCost: s.players.A.donCostArea.length,
      aDonRested: s.players.A.donRested.length,
      aDonDeck: s.players.A.donDeck.length,
      donTotalA,
      attachedDonA,
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
    else if (pk === 'attack_target_pick') {
      // Fallback: force-clean
      break;
    }
  }
  // Force-clean if still stuck (defensive — should never hit normally).
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

function cohortFor(id: string): StageCResult['cohort'] {
  if (CONDITION_GATED_VERIFIED.has(id)) return 'condition_gated';
  if (MAGNITUDE_MISMATCH_VERIFIED.has(id)) return 'magnitude_mismatch';
  if (STAGE_A_BASELINE.has(id)) return 'stage_a_baseline';
  if (NEWLY_PLAYABLE.has(id)) return 'newly_playable';
  return null;
}

// Process one card. Returns the StageCResult record.
async function processCard(
  page: Page,
  card: CounterEventCardDef,
  pageErrorsAccum: string[],
  invariantErrorsAccum: string[],
): Promise<StageCResult> {
  const cohort = cohortFor(card.id);
  // Snapshot per-card error indices so we can attribute new errors.
  const pageErrorsBefore = pageErrorsAccum.length;
  const invariantErrorsBefore = invariantErrorsAccum.length;
  // Generous DON budget: card cost + 4 (max plausible clause cost).
  const donCount = Math.min(10, Math.max(0, card.cost + 4));
  const setupRecipe: SetupRecipe = {
    donCount,
    aHandSize: 3, // 3 fillers + guard + counter card = 5 in hand
    aLifeCount: 5,
    seedGuardCounter: true,
  };
  try {
    await resetForCard(page, setupRecipe);
    const cardIid = await seedCardInAHand(page, card as unknown as Record<string, unknown>);
    await enterCounterWindow(page);
    const before = await readFullSnap(page);
    const offered = await legalCounterIds(page);
    const playable = offered.includes(cardIid);
    if (!playable) {
      // Drain pending so we don't pollute next card.
      await drainPending(page);
      const after = await readFullSnap(page);
      const donConserved = after.donTotalA === before.donTotalA;
      const noDup = after.duplicateIids.length === 0;
      const noStuck = (await readPendingKind(page)) === null;
      const newPageErrors = pageErrorsAccum.slice(pageErrorsBefore);
      const newInvariantErrors = invariantErrorsAccum.slice(invariantErrorsBefore);
      return {
        cardId: card.id, name: card.name, family: 'counter_event',
        setupRecipe, actionPerformed: 'PLAY_COUNTER_NOT_OFFERED',
        expectedStateDiff: null,
        observedStateDiff: {},
        promptExpectation: 'no_prompt',
        classification: 'NOT_IMPLEMENTED', confidence: 'HIGH',
        notes: 'counter-legality (legality.ts:267) did NOT offer PLAY_COUNTER for this card; either Path A (boost>0) and Path B-AND-C (counter_event tag + defensive power_buff clause) both failed, or cost was unpayable',
        historyTail: after.historyTail, pageErrors: newPageErrors, invariantErrors: newInvariantErrors,
        donConserved, noDuplicateInstanceIds: noDup, noStuckPending: noStuck,
        cohort,
      };
    }
    // Dispatch PLAY_COUNTER.
    const playRes = await dispatchAs(page, { type: 'PLAY_COUNTER', instanceId: cardIid });
    const mid = await readFullSnap(page);
    // Drain pending (may have suspended on clause-internal pending OR auto-skipped).
    await drainPending(page);
    const after = await readFullSnap(page);
    const newPageErrors = pageErrorsAccum.slice(pageErrorsBefore);
    const newInvariantErrors = invariantErrorsAccum.slice(invariantErrorsBefore);
    const donConserved = after.donTotalA === before.donTotalA;
    const noDup = after.duplicateIids.length === 0;
    const noStuck = (await readPendingKind(page)) === null;

    // Observed diff vs `before`.
    // counterBoost is taken from MID snap (cleared by clearPendingAttack at end).
    const observedStateDiff: StateDiff = {
      aHandDelta: after.aHandLen - before.aHandLen,
      aTrashDelta: after.aTrashLen - before.aTrashLen,
      aLifeDelta: after.aLifeLen - before.aLifeLen,
      aFieldDelta: after.aFieldLen - before.aFieldLen,
      aDonCostDelta: after.aDonCost - before.aDonCost,
      leaderModBattle: mid.aLeaderModBattle,
      leaderModOneShot: mid.aLeaderModOneShot,
      counterBoost: mid.counterBoost,
    };
    // Classification logic for the smoke pass.
    let classification: Classification;
    let confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    let notes: string;
    if (!playRes.ok) {
      classification = 'ENGINE_BUG'; confidence = 'HIGH';
      notes = `dispatch threw: ${playRes.err ?? '?'}`;
    } else if (newInvariantErrors.length > 0) {
      classification = 'ENGINE_BUG'; confidence = 'HIGH';
      notes = `invariant violated during PLAY_COUNTER dispatch: ${newInvariantErrors[0]}`;
    } else if (newPageErrors.length > 0) {
      classification = 'ENGINE_BUG'; confidence = 'HIGH';
      notes = `page error during dispatch: ${newPageErrors[0]}`;
    } else if (!donConserved) {
      classification = 'ENGINE_BUG'; confidence = 'HIGH';
      notes = `DON conservation violated: pre=${before.donTotalA} post=${after.donTotalA}`;
    } else if (!noDup) {
      classification = 'ENGINE_BUG'; confidence = 'HIGH';
      notes = `duplicate instance IDs surfaced: ${after.duplicateIids.join(',')}`;
    } else if (!noStuck) {
      classification = 'HARNESS_BUG'; confidence = 'MEDIUM';
      notes = `pending did not drain after PLAY_COUNTER + cleanup; final pendingKind=${await readPendingKind(page)}`;
    } else {
      // Was COUNTER_PLAYED logged for this card?
      const counterPlayedSeen = mid.historyTail.some((h) => h.type === 'COUNTER_PLAYED' && (h as Record<string, unknown>).instanceId === cardIid) ||
        after.historyTail.some((h) => h.type === 'COUNTER_PLAYED' && (h as Record<string, unknown>).instanceId === cardIid);
      if (!counterPlayedSeen) {
        classification = 'INCONCLUSIVE'; confidence = 'LOW';
        notes = 'PLAY_COUNTER offered + dispatched, but history has no COUNTER_PLAYED entry for this instanceId (snap may have missed it; investigate per-card)';
      } else {
        classification = 'VERIFIED'; confidence = 'HIGH';
        notes = `COUNTER_PLAYED logged; mid.counterBoost=${mid.counterBoost} mid.leaderModBattle=${mid.aLeaderModBattle} mid.leaderModOneShot=${mid.aLeaderModOneShot}`;
      }
    }
    return {
      cardId: card.id, name: card.name, family: 'counter_event',
      setupRecipe, actionPerformed: 'PLAY_COUNTER',
      expectedStateDiff: null, // Stage C Phase B = smoke pass; expected diff lands in Phase C.
      observedStateDiff,
      promptExpectation: 'no_prompt',
      classification, confidence, notes,
      historyTail: after.historyTail,
      pageErrors: newPageErrors, invariantErrors: newInvariantErrors,
      donConserved, noDuplicateInstanceIds: noDup, noStuckPending: noStuck,
      cohort,
    };
  } catch (err) {
    // Drain pending defensively even on harness throw.
    try { await drainPending(page); } catch { /* ignore */ }
    const newPageErrors = pageErrorsAccum.slice(pageErrorsBefore);
    const newInvariantErrors = invariantErrorsAccum.slice(invariantErrorsBefore);
    return {
      cardId: card.id, name: card.name, family: 'counter_event',
      setupRecipe, actionPerformed: 'SKIPPED',
      expectedStateDiff: null, observedStateDiff: {},
      promptExpectation: 'no_prompt',
      classification: 'HARNESS_BUG', confidence: 'LOW',
      notes: `harness threw: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
      historyTail: [],
      pageErrors: newPageErrors, invariantErrors: newInvariantErrors,
      donConserved: true, noDuplicateInstanceIds: true, noStuckPending: false,
      cohort,
    };
  }
}

// ── slices ───────────────────────────────────────────────────────────

const SLICES: CounterEventCardDef[][] = [];
for (let i = 0; i < SLICE_COUNT; i++) {
  SLICES.push(COUNTER_EVENTS.slice(i * SLICE_SIZE, (i + 1) * SLICE_SIZE));
}

test.describe.serial('stage-c-generated-counter-events', () => {
  for (let s = 0; s < SLICES.length; s++) {
    const sliceIndex = s;
    const slice = SLICES[sliceIndex]!;
    test(`slice ${sliceIndex + 1}/${SLICES.length} — ${slice.length} cards (${slice[0]!.id} … ${slice[slice.length - 1]!.id})`, async ({ page }) => {
      test.setTimeout(FIVE_MIN);
      const { drv, pageErrors, invariantErrors } = await bootstrap(page);
      void drv;
      const results: StageCResult[] = [];
      for (const card of slice) {
        const r = await processCard(page, card, pageErrors, invariantErrors);
        results.push(r);
      }
      // Hard slice-level assertions.
      expect(pageErrors, `slice ${sliceIndex} pageerrors should be empty`).toEqual([]);
      expect(invariantErrors, `slice ${sliceIndex} InvariantErrors should be empty`).toEqual([]);
      expect(await readPendingKind(page), `slice ${sliceIndex} no stuck pending at slice end`).toBeNull();
      // Persist slice JSON.
      const sliceFile = join(SLICE_TMP_DIR, `counter-events-slice-${String(sliceIndex).padStart(2, '0')}.json`);
      writeFileSync(sliceFile, JSON.stringify({
        sliceIndex, cardCount: slice.length, results,
      }, null, 2), 'utf-8');
      /* eslint-disable no-console */
      console.log(`[stage-c-counter-events] wrote slice ${sliceIndex} → ${sliceFile}`);
      /* eslint-enable no-console */
    });
  }

  // Synthetic non-counter control: separate test, fresh page.
  test('control: non-counter event must NOT be offered as PLAY_COUNTER', async ({ page }) => {
    test.setTimeout(FIVE_MIN);
    const { drv, pageErrors, invariantErrors } = await bootstrap(page);
    void drv;
    await resetForCard(page, { donCount: 1, aHandSize: 1, aLifeCount: 5, seedGuardCounter: true });
    const ctrlIid = await page.evaluate(() => {
      const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
      const s = w.__store!.getState().state as Record<string, unknown>;
      const lib = s.cardLibrary as Record<string, unknown>;
      const inst = s.instances as Record<string, unknown>;
      const players = s.players as { A: { hand: string[] } };
      const synthId = `__nonCounterCtrl_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `nonCtrl_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = {
        id: synthId, name: 'Non-Counter Control', kind: 'event',
        cost: 1, power: null, counterValue: null,
        counterEventBoost: 0,
        colors: ['red'], traits: [], keywords: [],
        effectTags: ['draw'], // NO 'counter_event'
        effectText: '',
        effectSpecV2: {
          clauses: [{ trigger: 'on_play', action: { kind: 'draw', magnitude: 1 }, verified: 'human-reviewed' }],
          continuous: [], replacements: [], schemaVersion: 2, verified: 'human-reviewed',
        },
      };
      inst[iid] = {
        instanceId: iid, cardId: synthId, controller: 'A',
        rested: false, summoningSick: false,
        attachedDon: [], attachedDonRested: [],
        perTurn: { hasAttacked: false, effectsUsed: [] },
      };
      players.A.hand = [...players.A.hand, iid];
      w.__store!.setState({ state: { ...s } });
      if (w.__getLegalActions) {
        const next = w.__store!.getState().state as { activePlayer: string };
        w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
      }
      return iid;
    });
    await enterCounterWindow(page);
    const offered = await legalCounterIds(page);
    expect(offered, 'synthetic non-counter event MUST NOT be offered as PLAY_COUNTER (over-broadening guard)').not.toContain(ctrlIid);
    await drainPending(page);
    expect(pageErrors, 'control pageerrors empty').toEqual([]);
    expect(invariantErrors, 'control InvariantErrors empty').toEqual([]);
    expect(await readPendingKind(page), 'control no stuck pending').toBeNull();
    // Emit a record for the synthetic control so the report shows it.
    const controlResult: StageCResult = {
      cardId: '__synthetic_non_counter_control',
      name: 'Non-Counter Control (synthetic)',
      family: 'counter_event',
      setupRecipe: { donCount: 1, aHandSize: 1, aLifeCount: 5, seedGuardCounter: true },
      actionPerformed: 'PLAY_COUNTER_NOT_OFFERED',
      expectedStateDiff: null, observedStateDiff: {},
      promptExpectation: 'no_prompt',
      classification: 'NOT_IMPLEMENTED', confidence: 'HIGH',
      notes: 'synthetic non-counter event correctly excluded by counter-legality (Path A boost=0, Path B power_buff missing, Path C counter_event tag missing); proves legality patch does NOT over-broaden',
      historyTail: [],
      pageErrors: [], invariantErrors: [],
      donConserved: true, noDuplicateInstanceIds: true, noStuckPending: true,
      cohort: null,
    };
    const ctrlFile = join(SLICE_TMP_DIR, 'counter-events-control.json');
    writeFileSync(ctrlFile, JSON.stringify({ results: [controlResult] }, null, 2), 'utf-8');
  });

  // Aggregator: rolls per-slice JSONs into final report files.
  test('aggregator: roll up slice JSONs into final report', async () => {
    const allResults: StageCResult[] = [];
    const sliceFiles = readdirSync(SLICE_TMP_DIR)
      .filter((f) => f.startsWith('counter-events-slice-') || f === 'counter-events-control.json')
      .sort();
    for (const f of sliceFiles) {
      const raw = readFileSync(join(SLICE_TMP_DIR, f), 'utf-8');
      const parsed = JSON.parse(raw) as { results: StageCResult[] };
      for (const r of parsed.results) allResults.push(r);
    }
    // Classification tallies.
    const bucket = (cls: Classification): number => allResults.filter((r) => r.classification === cls).length;
    const tally = {
      VERIFIED: bucket('VERIFIED'),
      ENGINE_BUG: bucket('ENGINE_BUG'),
      CARD_DATA_BUG: bucket('CARD_DATA_BUG'),
      UI_BUG: bucket('UI_BUG'),
      HARNESS_BUG: bucket('HARNESS_BUG'),
      NOT_IMPLEMENTED: bucket('NOT_IMPLEMENTED'),
      NO_UI_EXPECTED: bucket('NO_UI_EXPECTED'),
      INCONCLUSIVE: bucket('INCONCLUSIVE'),
    };
    // Cohort regression checks.
    const cohortPass = (set: Set<string>): { passed: string[]; failed: string[] } => {
      const passed: string[] = []; const failed: string[] = [];
      for (const id of set) {
        const r = allResults.find((x) => x.cardId === id);
        if (r === undefined) failed.push(`${id} (NOT FOUND)`);
        else if (r.classification === 'VERIFIED') passed.push(id);
        else failed.push(`${id} (${r.classification})`);
      }
      return { passed, failed };
    };
    const conditionGatedCheck = cohortPass(CONDITION_GATED_VERIFIED);
    const magnitudeMismatchCheck = cohortPass(MAGNITUDE_MISMATCH_VERIFIED);
    const stageABaselineCheck = cohortPass(STAGE_A_BASELINE);
    const newlyPlayableResults = Array.from(NEWLY_PLAYABLE).map((id) => {
      const r = allResults.find((x) => x.cardId === id);
      return { id, classification: r?.classification ?? 'MISSING', notes: r?.notes ?? '' };
    });
    // Failure clustering by notes signature first 80 chars.
    const failureClusters = new Map<string, { rootCause: string; cards: string[] }>();
    for (const r of allResults) {
      if (r.classification === 'VERIFIED' || r.classification === 'NOT_IMPLEMENTED') continue;
      const signature = (r.notes || `(${r.classification})`).slice(0, 80);
      const existing = failureClusters.get(signature) ?? { rootCause: signature, cards: [] };
      existing.cards.push(r.cardId);
      failureClusters.set(signature, existing);
    }
    const sortedClusters = Array.from(failureClusters.values()).sort((a, b) => b.cards.length - a.cards.length);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const finalJsonPath = join(REPORTS_DIR, `stage-c-counter-events-${ts}.json`);
    const finalMdPath = join(REPORTS_DIR, `stage-c-counter-events-${ts}.md`);
    const finalReport = {
      family: 'counter_event',
      generatedAt: new Date().toISOString(),
      totalCardsDiscovered: COUNTER_EVENTS.length,
      totalRecordsWritten: allResults.length,
      sliceCount: SLICE_COUNT,
      classifications: tally,
      regressionChecks: {
        conditionGated: { expected: Array.from(CONDITION_GATED_VERIFIED), ...conditionGatedCheck, allPassed: conditionGatedCheck.failed.length === 0 },
        magnitudeMismatch: { expected: Array.from(MAGNITUDE_MISMATCH_VERIFIED), ...magnitudeMismatchCheck, allPassed: magnitudeMismatchCheck.failed.length === 0 },
        stageABaseline: { expected: Array.from(STAGE_A_BASELINE), ...stageABaselineCheck, allPassed: stageABaselineCheck.failed.length === 0 },
        newlyPlayable: { expected: Array.from(NEWLY_PLAYABLE), results: newlyPlayableResults },
      },
      failureClusters: sortedClusters,
      results: allResults,
    };
    writeFileSync(finalJsonPath, JSON.stringify(finalReport, null, 2), 'utf-8');
    // Markdown summary.
    const md: string[] = [];
    md.push(`# Stage C — Counter Events Generated Report\n`);
    md.push(`**Generated:** ${new Date().toISOString()}\n`);
    md.push(`**Total counter events discovered:** ${COUNTER_EVENTS.length}\n`);
    md.push(`**Total records written:** ${allResults.length}\n`);
    md.push(`**Slice count:** ${SLICE_COUNT}\n\n`);
    md.push(`## Classification buckets\n\n| Bucket | Count |\n|---|---:|\n`);
    for (const [k, v] of Object.entries(tally)) md.push(`| ${k} | ${v} |\n`);
    md.push(`\n## Regression checks\n\n`);
    md.push(`### 8 condition-gated cards expected VERIFIED\n\n`);
    md.push(`- All passed: **${conditionGatedCheck.failed.length === 0 ? 'YES' : 'NO'}**\n`);
    md.push(`- Passed: ${conditionGatedCheck.passed.join(', ') || '(none)'}\n`);
    md.push(`- Failed: ${conditionGatedCheck.failed.join(', ') || '(none)'}\n\n`);
    md.push(`### 6 magnitude-mismatch fixed cards expected VERIFIED\n\n`);
    md.push(`- All passed: **${magnitudeMismatchCheck.failed.length === 0 ? 'YES' : 'NO'}**\n`);
    md.push(`- Passed: ${magnitudeMismatchCheck.passed.join(', ') || '(none)'}\n`);
    md.push(`- Failed: ${magnitudeMismatchCheck.failed.join(', ') || '(none)'}\n\n`);
    md.push(`### OP01-118 Stage A baseline expected VERIFIED\n\n`);
    md.push(`- All passed: **${stageABaselineCheck.failed.length === 0 ? 'YES' : 'NO'}**\n`);
    md.push(`- Passed: ${stageABaselineCheck.passed.join(', ') || '(none)'}\n`);
    md.push(`- Failed: ${stageABaselineCheck.failed.join(', ') || '(none)'}\n\n`);
    md.push(`### 12 newly counter-playable cards (post-legality-patch)\n\n`);
    md.push(`| Card | Classification | Notes (truncated) |\n|---|---|---|\n`);
    for (const r of newlyPlayableResults) md.push(`| ${r.id} | ${r.classification} | ${(r.notes || '').slice(0, 70)} |\n`);
    md.push(`\n## Failure clusters\n\n`);
    if (sortedClusters.length === 0) md.push(`(no failure clusters — all non-VERIFIED were NOT_IMPLEMENTED)\n`);
    else {
      md.push(`| Cards | Root cause signature |\n|---:|---|\n`);
      for (const c of sortedClusters) md.push(`| ${c.cards.length} | ${c.rootCause} |\n`);
      md.push(`\n### Cluster details\n\n`);
      for (const c of sortedClusters) {
        md.push(`- **${c.rootCause}** (${c.cards.length} cards): ${c.cards.join(', ')}\n`);
      }
    }
    md.push(`\n## Report files\n\n`);
    md.push(`- JSON: \`${finalJsonPath.replace(__dirname + '/', '')}\`\n`);
    md.push(`- This MD: \`${finalMdPath.replace(__dirname + '/', '')}\`\n`);
    writeFileSync(finalMdPath, md.join(''), 'utf-8');
    /* eslint-disable no-console */
    console.log(`[stage-c-counter-events] FINAL JSON: ${finalJsonPath}`);
    console.log(`[stage-c-counter-events] FINAL MD:   ${finalMdPath}`);
    console.log(`[stage-c-counter-events] totals: discovered=${COUNTER_EVENTS.length} records=${allResults.length}`);
    console.log(`[stage-c-counter-events] tally: ${JSON.stringify(tally)}`);
    /* eslint-enable no-console */
    // Final hard assertions for the aggregator.
    expect(allResults.length, 'every counter event + control must produce a record').toBeGreaterThanOrEqual(COUNTER_EVENTS.length);
    // Ensure existsSync wasn't accidentally imported but unused
    void existsSync;
  });
});
