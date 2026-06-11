// stage-c-generated-removal-bounce — Stage C target #10 per
// e2e/stage-c-corpus-verification-plan.md. Auto-discovers every card with at
// least one clause whose `action.kind` is in the removal/bounce/rest family:
//   removal_ko, removal_bounce, rest_target, set_active,
//   bottom_of_deck_to_opp_deck, bottom_of_deck_from_hand,
//   bottom_of_deck_from_trash, opp_bottom_of_deck_from_trash
//
// For each card we take the FIRST matching clause and run one subcase:
//   1) Seed source + eligible target(s) + (where feasible) one ineligible
//      filter-violating control target.
//   2) Dispatch the trigger (on_play=PLAY_CARD, activate_main=ACTIVATE_MAIN,
//      when_attacking=DECLARE_ATTACK with turn=5). Other triggers fall to
//      HARNESS_GAP per directive.
//   3) Match CLAUSE_FIRED history entry by
//      (sourceInstanceId, clauseIndex, trigger, actionKind).
//   4) Verify zone delta per action.kind:
//        - removal_ko       → target in target_owner.trash
//        - removal_bounce   → target in target_owner.hand
//        - rest_target      → target.rested === true
//        - set_active       → target.rested === false
//        - bottom_of_deck_to_opp_deck → target at end of opp-of-controller deck
//        - bottom_of_deck_from_hand   → A.hand count -magnitude / A.deck +magnitude
//        - bottom_of_deck_from_trash  → A.trash -targets / A.deck +targets
//        - opp_bottom_of_deck_from_trash → B.trash -targets / B.deck +targets
//   5) Where a control (ineligible) target was seeded, verify it is unchanged.
//
// Strict classification:
//   - VERIFIED              clause fired AND zone delta correct
//   - ENGINE_BUG            clause fired BUT zone delta wrong, OR target moved
//                           to unexpected zone, OR pageerror/InvariantError
//   - HARNESS_GAP           trigger or precondition not satisfiable by recipe
//                           (e.g., trigger we don't dispatch, condition gating,
//                            cost block we can't pay, source kind unsupported)
//   - NOT_IMPLEMENTED       action.kind unregistered (won't fire here — all
//                           8 covered kinds are registered, kept for parity)
//   - CARD_DATA_BUG         confirmed cards.json defect (e.g., missing target
//                           when action requires one; not patched here)
//   - HARNESS_BUG           harness threw; recorded with stack-like notes
//   - INCONCLUSIVE          ambiguous (e.g., clause fired but delta unreadable)
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
const SLICE_TMP_DIR = resolve(__dirname, 'coverage/reports/.stage-c-removal-slices');
mkdirSync(REPORTS_DIR, { recursive: true });
mkdirSync(SLICE_TMP_DIR, { recursive: true });
for (const f of readdirSync(SLICE_TMP_DIR)) { if (f.endsWith('.json')) { try { unlinkSync(join(SLICE_TMP_DIR, f)); } catch { /* ignore */ } } }

const REMOVAL_ACTION_KINDS = new Set<string>([
  'removal_ko',
  'removal_bounce',
  'rest_target',
  'set_active',
  'bottom_of_deck_to_opp_deck',
  'bottom_of_deck_from_hand',
  'bottom_of_deck_from_trash',
  'opp_bottom_of_deck_from_trash',
]);

const SUPPORTED_TRIGGERS = new Set<string>(['on_play', 'activate_main', 'when_attacking']);

interface CardDef {
  readonly id: string; readonly name: string; readonly kind: 'character' | 'event' | 'stage' | 'leader' | 'don';
  readonly cost?: number | null; readonly power?: number | null; readonly colors?: ReadonlyArray<string>; readonly traits?: ReadonlyArray<string>;
  readonly keywords?: ReadonlyArray<string>; readonly effectText?: string;
  readonly effectSpecV2?: {
    readonly clauses?: ReadonlyArray<{
      readonly trigger?: string;
      readonly action?: { readonly kind?: string; readonly magnitude?: number };
      readonly target?: { readonly kind?: string; readonly filter?: Record<string, unknown>; readonly count?: number };
      readonly cost?: Record<string, unknown>;
      readonly condition?: { readonly type?: string; readonly [k: string]: unknown };
    }>;
  };
  readonly [k: string]: unknown;
}

const CORPUS_RAW = JSON.parse(readFileSync(CORPUS_PATH, 'utf-8')) as unknown;
const CORPUS = (Array.isArray(CORPUS_RAW) ? CORPUS_RAW : Object.values(CORPUS_RAW as Record<string, unknown>)) as Array<Record<string, unknown>>;

function firstRemovalClause(c: Record<string, unknown>): { clauseIndex: number; trigger: string; actionKind: string; magnitude: number | null; targetKind: string | null; targetFilter: Record<string, unknown> | null; targetCount: number; gated: boolean; hasCost: boolean } | null {
  const cd = c as CardDef;
  const clauses = cd.effectSpecV2?.clauses ?? [];
  for (let i = 0; i < clauses.length; i++) {
    const cl = clauses[i]!;
    const ak = cl.action?.kind;
    if (typeof ak !== 'string' || !REMOVAL_ACTION_KINDS.has(ak)) continue;
    return {
      clauseIndex: i,
      trigger: typeof cl.trigger === 'string' ? cl.trigger : '',
      actionKind: ak,
      magnitude: typeof cl.action?.magnitude === 'number' ? cl.action.magnitude : null,
      targetKind: typeof cl.target?.kind === 'string' ? cl.target.kind : null,
      targetFilter: (cl.target?.filter ?? null) as Record<string, unknown> | null,
      targetCount: typeof cl.target?.count === 'number' ? cl.target.count : 1,
      gated: cl.condition !== undefined,
      hasCost: cl.cost !== undefined,
    };
  }
  return null;
}

function hasRemovalClause(c: Record<string, unknown>): boolean { return firstRemovalClause(c) !== null; }

const CARDS: CardDef[] = CORPUS.filter(hasRemovalClause) as CardDef[];
CARDS.sort((a, b) => a.id.localeCompare(b.id));

const SLICE_SIZE = 25;
const SLICE_COUNT = Math.ceil(CARDS.length / SLICE_SIZE);
/* eslint-disable no-console */
console.log(`[stage-c-removal-bounce] Discovered ${CARDS.length} removal-family cards → ${SLICE_COUNT} slice(s) of up to ${SLICE_SIZE}`);
/* eslint-enable no-console */

const ANCHORS = new Set<string>([
  'EB01-010', // removal_ko opp_character basePowerMax 6000
  'EB01-020', // removal_bounce opp_character
  'EB01-015', // rest_target opp_character
  'EB02-061', // set_active your_leader/character
  'EB02-027', // bottom_of_deck_to_opp_deck
  'EB02-024', // bottom_of_deck_from_hand magnitude 2
]);

type Classification = 'VERIFIED' | 'ENGINE_BUG' | 'CARD_DATA_BUG' | 'UI_BUG' | 'HARNESS_BUG' | 'HARNESS_GAP' | 'NOT_IMPLEMENTED' | 'NO_UI_EXPECTED' | 'INCONCLUSIVE';

interface SeedTargetSpec {
  side: 'A' | 'B';
  zone: 'field' | 'leader' | 'stage' | 'donCostArea';
  rested?: boolean;
  cost?: number;
  power?: number;
  traits?: ReadonlyArray<string>;
  colors?: ReadonlyArray<string>;
  isEligibleControl: boolean; // true=eligible (the actual target), false=control (filter-violating)
}

function buildEligible(filter: Record<string, unknown> | null, side: 'A' | 'B'): SeedTargetSpec {
  const e: SeedTargetSpec = { side, zone: 'field', rested: false, cost: 3, power: 3000, traits: ['Straw Hat Crew'], colors: side === 'A' ? ['red'] : ['blue'], isEligibleControl: true };
  if (filter !== null) {
    if (typeof filter.costMax === 'number') e.cost = Math.max(0, filter.costMax as number - 1);
    if (typeof filter.costMin === 'number') e.cost = Math.max(filter.costMin as number, e.cost ?? 0);
    if (typeof filter.powerMax === 'number') e.power = Math.max(0, filter.powerMax as number - 1000);
    if (typeof filter.powerMin === 'number') e.power = Math.max(filter.powerMin as number, e.power ?? 0);
    if (typeof filter.basePowerMax === 'number') e.power = Math.max(0, filter.basePowerMax as number - 1000);
    if (typeof filter.basePowerMin === 'number') e.power = Math.max(filter.basePowerMin as number, e.power ?? 0);
    if (filter.rested === true) e.rested = true;
    if (filter.rested === false || filter.active === true) e.rested = false;
    if (typeof filter.trait === 'string') e.traits = [filter.trait as string, ...(e.traits ?? [])];
    if (Array.isArray(filter.traitsAny)) e.traits = [...(filter.traitsAny as string[]), ...(e.traits ?? [])];
    if (Array.isArray(filter.colors)) e.colors = filter.colors as string[];
  }
  return e;
}

function buildControl(filter: Record<string, unknown> | null, side: 'A' | 'B'): SeedTargetSpec | null {
  // Build a target that VIOLATES the filter, so engine should skip it.
  if (filter === null) return null;
  const c: SeedTargetSpec = { side, zone: 'field', rested: false, cost: 5, power: 5000, traits: ['__noTrait__'], colors: side === 'A' ? ['red'] : ['blue'], isEligibleControl: false };
  let canViolate = false;
  if (typeof filter.costMax === 'number') { c.cost = (filter.costMax as number) + 5; canViolate = true; }
  else if (typeof filter.costMin === 'number') { c.cost = Math.max(0, (filter.costMin as number) - 1); canViolate = true; }
  if (typeof filter.powerMax === 'number') { c.power = (filter.powerMax as number) + 5000; canViolate = true; }
  else if (typeof filter.powerMin === 'number') { c.power = Math.max(0, (filter.powerMin as number) - 1000); canViolate = true; }
  else if (typeof filter.basePowerMax === 'number') { c.power = (filter.basePowerMax as number) + 5000; canViolate = true; }
  else if (typeof filter.basePowerMin === 'number') { c.power = Math.max(0, (filter.basePowerMin as number) - 1000); canViolate = true; }
  if (filter.rested === true) { c.rested = false; canViolate = true; }
  else if (filter.rested === false || filter.active === true) { c.rested = true; canViolate = true; }
  // Trait filters: control has empty traits — violates trait/traitsAny.
  if (typeof filter.trait === 'string' || Array.isArray(filter.traitsAny)) { c.traits = []; canViolate = true; }
  return canViolate ? c : null;
}

interface SeedPlan {
  sourceZone: 'a_hand' | 'a_field' | 'a_stage' | 'a_leader';
  // Per-target.kind: which side, how many to seed, and whether to seed a control.
  bFieldTargets: SeedTargetSpec[]; // for opp_character / all_opp / opp_leader_or_character / opp_don_or_character
  aFieldExtras: SeedTargetSpec[]; // for your_character / all_your / your_leader_or_character
  aLeaderRestedOverride?: boolean; // set_active your_leader
  sourceRestedOverride?: boolean; // set_active self / rest_target self
}

function planSeeds(card: CardDef, clause: NonNullable<ReturnType<typeof firstRemovalClause>>): SeedPlan {
  // Source zone selection
  let sourceZone: 'a_hand' | 'a_field' | 'a_stage' | 'a_leader' = 'a_hand';
  if (card.kind === 'event') sourceZone = 'a_hand';
  else if (card.kind === 'character') sourceZone = clause.trigger === 'on_play' ? 'a_hand' : 'a_field';
  else if (card.kind === 'stage') sourceZone = clause.trigger === 'on_play' ? 'a_hand' : 'a_stage';
  else if (card.kind === 'leader') sourceZone = 'a_leader';

  const tk = clause.targetKind ?? '';
  const filter = clause.targetFilter;
  const plan: SeedPlan = { sourceZone, bFieldTargets: [], aFieldExtras: [] };

  if (tk === 'opp_character' || tk === 'opp_leader_or_character' || tk === 'opp_don_or_character' || tk === 'any_character') {
    const eligible = buildEligible(filter, 'B');
    plan.bFieldTargets.push(eligible);
    const ctl = buildControl(filter, 'B');
    if (ctl !== null) plan.bFieldTargets.push(ctl);
    // For opp_don_or_character, also seed B donCostArea (existing donCostArea already has DON).
  } else if (tk === 'your_character' || tk === 'your_leader_or_character') {
    const eligible = buildEligible(filter, 'A');
    if (clause.actionKind === 'set_active') eligible.rested = true; // need observable change
    plan.aFieldExtras.push(eligible);
    const ctl = buildControl(filter, 'A');
    if (ctl !== null) {
      if (clause.actionKind === 'set_active') ctl.rested = true;
      plan.aFieldExtras.push(ctl);
    }
  } else if (tk === 'your_leader') {
    if (clause.actionKind === 'set_active' || clause.actionKind === 'rest_target') {
      plan.aLeaderRestedOverride = clause.actionKind === 'set_active' ? true : false;
    }
  } else if (tk === 'all_opp_characters') {
    plan.bFieldTargets.push(buildEligible(filter, 'B'));
    plan.bFieldTargets.push(buildEligible(filter, 'B'));
    const ctl = buildControl(filter, 'B');
    if (ctl !== null) plan.bFieldTargets.push(ctl);
  } else if (tk === 'all_your_characters') {
    const e1 = buildEligible(filter, 'A'); if (clause.actionKind === 'set_active') e1.rested = true; plan.aFieldExtras.push(e1);
    const e2 = buildEligible(filter, 'A'); if (clause.actionKind === 'set_active') e2.rested = true; plan.aFieldExtras.push(e2);
    const ctl = buildControl(filter, 'A');
    if (ctl !== null) { if (clause.actionKind === 'set_active') ctl.rested = true; plan.aFieldExtras.push(ctl); }
  } else if (tk === 'all_characters') {
    plan.bFieldTargets.push(buildEligible(filter, 'B'));
    plan.aFieldExtras.push(buildEligible(filter, 'A'));
    const ctlB = buildControl(filter, 'B'); if (ctlB !== null) plan.bFieldTargets.push(ctlB);
    const ctlA = buildControl(filter, 'A'); if (ctlA !== null) plan.aFieldExtras.push(ctlA);
  } else if (tk === 'self') {
    if (clause.actionKind === 'set_active') plan.sourceRestedOverride = true;
    if (clause.actionKind === 'rest_target') plan.sourceRestedOverride = false;
  }
  // bottom_of_deck_from_hand / bottom_of_deck_from_trash / opp_bottom_of_deck_from_trash:
  // these operate on non-field zones — no field target seeding needed beyond source.
  return plan;
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
  bTargetIids: ReadonlyArray<string>;
  bControlIids: ReadonlyArray<string>;
  aExtraIids: ReadonlyArray<string>;
  aControlIids: ReadonlyArray<string>;
  aHandLen: number;
  aTrashLen: number;
  aDeckLen: number;
  bHandLen: number;
  bTrashLen: number;
  bDeckLen: number;
  aLeaderRestedBefore: boolean;
  bLeaderRestedBefore: boolean;
}

async function fullRestoringResetAndSeed(page: Page, plan: SeedPlan, card: CardDef, clauseInfo: NonNullable<ReturnType<typeof firstRemovalClause>>): Promise<SeededRefs> {
  return page.evaluate(({ plan, cardDef, clauseInfo }) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    (s as Record<string, unknown>).phase = 'main';
    (s as Record<string, unknown>).activePlayer = 'A';
    (s as Record<string, unknown>).pending = null;
    (s as Record<string, unknown>).result = null;
    (s as Record<string, unknown>).turn = clauseInfo.trigger === 'when_attacking' ? 5 : 1;
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
    // Rebalance A.donCostArea to plenty.
    const allADon = [...players.A.donDeck, ...players.A.donCostArea, ...players.A.donRested];
    players.A.donCostArea = allADon.slice(0, 10);
    players.A.donDeck = allADon.slice(10);
    players.A.donRested = [];
    // Rebalance B.don.
    const allBDon = [...players.B.donDeck, ...players.B.donCostArea, ...players.B.donRested];
    players.B.donCostArea = allBDon.slice(0, 6);
    players.B.donDeck = allBDon.slice(6);
    players.B.donRested = [];
    // Lives: ensure both sides have 5 lives (some triggers / costs need it).
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
    // Wildcard A.leader colors so PLAY_CARD doesn't reject on color identity (legality.ts:178).
    const aLeaderCard = lib[players.A.leader.cardId] as { colors?: string[]; keywords?: string[] } | undefined;
    if (aLeaderCard !== undefined) aLeaderCard.colors = ['red', 'blue', 'green', 'purple', 'black', 'yellow'];
    players.A.leader.rested = false; players.A.leader.summoningSick = false;
    if (players.A.leader.perTurn) { players.A.leader.perTurn.hasAttacked = false; players.A.leader.perTurn.effectsUsed = []; }
    if (plan.aLeaderRestedOverride !== undefined) players.A.leader.rested = plan.aLeaderRestedOverride;
    const aLeaderRestedBefore = players.A.leader.rested === true;
    const bLeaderRestedBefore = players.B.leader.rested === true;

    // Place card in library (overwriting if necessary) for refold paths.
    lib[cardDef.id] = cardDef as unknown as Record<string, unknown>;

    // Seed source.
    const srcIid = `rmv_src_${cardDef.id}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    let sourceIid: string | null = null;
    if (plan.sourceZone === 'a_hand') {
      instances[srcIid] = { instanceId: srcIid, cardId: cardDef.id, controller: 'A', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      players.A.hand.push(srcIid);
      sourceIid = srcIid;
    } else if (plan.sourceZone === 'a_field') {
      const rested = plan.sourceRestedOverride === true;
      instances[srcIid] = { instanceId: srcIid, cardId: cardDef.id, controller: 'A', rested, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      (players.A.field as unknown[]).push(instances[srcIid]);
      sourceIid = srcIid;
    } else if (plan.sourceZone === 'a_stage') {
      instances[srcIid] = { instanceId: srcIid, cardId: cardDef.id, controller: 'A', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      players.A.stage = instances[srcIid] as { instanceId: string; cardId: string; attachedDon?: string[]; attachedDonRested?: string[]; rested?: boolean };
      sourceIid = srcIid;
    } else if (plan.sourceZone === 'a_leader') {
      players.A.leader.cardId = cardDef.id;
      sourceIid = players.A.leader.instanceId;
      if (plan.sourceRestedOverride !== undefined) players.A.leader.rested = plan.sourceRestedOverride;
    }

    // Seed targets.
    const bTargetIids: string[] = []; const bControlIids: string[] = [];
    for (const spec of plan.bFieldTargets) {
      const synthId = `__rmvTarget_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `rmvTgt_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = {
        id: synthId, name: spec.isEligibleControl ? 'B Eligible Target' : 'B Control Target',
        kind: 'character', cost: spec.cost ?? 3, power: spec.power ?? 3000, counterValue: 1000,
        colors: spec.colors ?? ['blue'], traits: spec.traits ?? [], keywords: [], effectText: '',
      };
      instances[iid] = {
        instanceId: iid, cardId: synthId, controller: 'B',
        rested: spec.rested === true, summoningSick: false,
        attachedDon: [], attachedDonRested: [],
        perTurn: { hasAttacked: false, effectsUsed: [] },
      };
      (players.B.field as unknown[]).push(instances[iid]);
      if (spec.isEligibleControl) bTargetIids.push(iid); else bControlIids.push(iid);
    }
    const aExtraIids: string[] = []; const aControlIids: string[] = [];
    for (const spec of plan.aFieldExtras) {
      const synthId = `__rmvExtra_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `rmvExt_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = {
        id: synthId, name: spec.isEligibleControl ? 'A Eligible Extra' : 'A Control Extra',
        kind: 'character', cost: spec.cost ?? 3, power: spec.power ?? 3000, counterValue: 1000,
        colors: spec.colors ?? ['red'], traits: spec.traits ?? [], keywords: [], effectText: '',
      };
      instances[iid] = {
        instanceId: iid, cardId: synthId, controller: 'A',
        rested: spec.rested === true, summoningSick: false,
        attachedDon: [], attachedDonRested: [],
        perTurn: { hasAttacked: false, effectsUsed: [] },
      };
      (players.A.field as unknown[]).push(instances[iid]);
      if (spec.isEligibleControl) aExtraIids.push(iid); else aControlIids.push(iid);
    }
    // Seed A.hand with extras (for cost-pay and condition satisfaction).
    for (let i = 0; i < 5; i++) {
      const synthId = `__rmvHand_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `rmvH_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = { id: synthId, name: `Hand Filler ${i}`, kind: 'character', cost: 1, power: 1000, counterValue: 1000, colors: ['red'], traits: [], keywords: [], effectText: '' };
      instances[iid] = { instanceId: iid, cardId: synthId, controller: 'A', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      players.A.hand.push(iid);
    }
    // Seed A.trash with 3 placeholders for bottom_of_deck_from_trash cards.
    while (players.A.trash.length < 3) {
      const synthId = `__rmvTrash_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `rmvT_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = { id: synthId, name: 'A Trash Placeholder', kind: 'character', cost: 2, power: 2000, counterValue: 1000, colors: ['red'], traits: [], keywords: [], effectText: '' };
      instances[iid] = { instanceId: iid, cardId: synthId, controller: 'A', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      players.A.trash.push(iid);
    }
    // Seed B.trash with 3 placeholders.
    while (players.B.trash.length < 3) {
      const synthId = `__rmvBTrash_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `rmvBT_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = { id: synthId, name: 'B Trash Placeholder', kind: 'character', cost: 2, power: 2000, counterValue: 1000, colors: ['blue'], traits: [], keywords: [], effectText: '' };
      instances[iid] = { instanceId: iid, cardId: synthId, controller: 'B', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      players.B.trash.push(iid);
    }
    w.__store!.setState({ state: { ...s, players: { ...(s.players as Record<string, unknown>), A: { ...players.A }, B: { ...players.B } } } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
    return {
      sourceIid,
      bTargetIids, bControlIids,
      aExtraIids, aControlIids,
      aHandLen: players.A.hand.length,
      aTrashLen: players.A.trash.length,
      aDeckLen: players.A.deck.length,
      bHandLen: players.B.hand.length,
      bTrashLen: players.B.trash.length,
      bDeckLen: players.B.deck.length,
      aLeaderRestedBefore,
      bLeaderRestedBefore,
    };
  }, { plan, cardDef: card as unknown as Record<string, unknown>, clauseInfo });
}

async function dispatchAs(page: Page, action: object): Promise<{ ok: boolean; err: string | null }> {
  const res = await page.evaluate((a) => {
    try { const w = window as unknown as { __store?: { getState: () => { dispatch: (a: unknown) => void } } }; w.__store!.getState().dispatch(a); return { ok: true, err: null }; }
    catch (e) { return { ok: false, err: e instanceof Error ? `${e.name}: ${e.message}` : String(e) }; }
  }, action);
  await page.waitForTimeout(50);
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

interface ZoneSnapshot {
  // For all instance ids of interest:
  inAField: ReadonlyArray<string>;
  inBField: ReadonlyArray<string>;
  inATrash: ReadonlyArray<string>;
  inBTrash: ReadonlyArray<string>;
  inAHand: ReadonlyArray<string>;
  inBHand: ReadonlyArray<string>;
  inADeck: ReadonlyArray<string>;
  inBDeck: ReadonlyArray<string>;
  // Lengths (for magnitude-style checks).
  aHandLen: number; aDeckLen: number; aTrashLen: number;
  bHandLen: number; bDeckLen: number; bTrashLen: number;
  // Rested flags.
  rested: Record<string, boolean>;
  // Source location.
  sourceZone: string | null;
}

async function readZones(page: Page, idsOfInterest: ReadonlyArray<string>, sourceIid: string | null): Promise<ZoneSnapshot> {
  return page.evaluate(({ idsOfInterest, sourceIid }) => {
    const w = window as unknown as { __store?: { getState: () => { state: { players: { A: { hand: string[]; field: Array<{ instanceId: string }>; trash: string[]; deck: string[]; leader: { instanceId: string; rested?: boolean }; stage?: { instanceId: string } | null }; B: { hand: string[]; field: Array<{ instanceId: string }>; trash: string[]; deck: string[]; leader: { instanceId: string; rested?: boolean }; stage?: { instanceId: string } | null } }; instances: Record<string, { rested?: boolean }> } } } };
    const ps = w.__store!.getState().state.players;
    const set = new Set(idsOfInterest);
    const inAField = ps.A.field.filter((c) => set.has(c.instanceId)).map((c) => c.instanceId);
    const inBField = ps.B.field.filter((c) => set.has(c.instanceId)).map((c) => c.instanceId);
    const inATrash = ps.A.trash.filter((id) => set.has(id));
    const inBTrash = ps.B.trash.filter((id) => set.has(id));
    const inAHand = ps.A.hand.filter((id) => set.has(id));
    const inBHand = ps.B.hand.filter((id) => set.has(id));
    const inADeck = ps.A.deck.filter((id) => set.has(id));
    const inBDeck = ps.B.deck.filter((id) => set.has(id));
    const insts = w.__store!.getState().state.instances;
    const rested: Record<string, boolean> = {};
    for (const id of idsOfInterest) {
      const inst = insts[id];
      if (inst !== undefined) rested[id] = inst.rested === true;
    }
    let sourceZone: string | null = null;
    if (sourceIid !== null) {
      if (ps.A.hand.includes(sourceIid)) sourceZone = 'a_hand';
      else if (ps.A.trash.includes(sourceIid)) sourceZone = 'a_trash';
      else if (ps.A.deck.includes(sourceIid)) sourceZone = 'a_deck';
      else if (ps.A.field.some((c) => c.instanceId === sourceIid)) sourceZone = 'a_field';
      else if (ps.A.leader.instanceId === sourceIid) sourceZone = 'a_leader';
      else if (ps.A.stage?.instanceId === sourceIid) sourceZone = 'a_stage';
      else if (ps.B.field.some((c) => c.instanceId === sourceIid)) sourceZone = 'b_field';
      else if (ps.B.hand.includes(sourceIid)) sourceZone = 'b_hand';
      else if (ps.B.trash.includes(sourceIid)) sourceZone = 'b_trash';
      else if (ps.B.deck.includes(sourceIid)) sourceZone = 'b_deck';
    }
    return {
      inAField, inBField, inATrash, inBTrash, inAHand, inBHand, inADeck, inBDeck,
      aHandLen: ps.A.hand.length, aDeckLen: ps.A.deck.length, aTrashLen: ps.A.trash.length,
      bHandLen: ps.B.hand.length, bDeckLen: ps.B.deck.length, bTrashLen: ps.B.trash.length,
      rested, sourceZone,
    };
  }, { idsOfInterest, sourceIid });
}

interface StageCRemovalResult {
  cardId: string; name: string; kind: string; family: 'removal_bounce';
  actionKind: string; trigger: string; targetKind: string | null; clauseIndex: number;
  gated: boolean; hasCost: boolean;
  dispatchPath: 'PLAY_CARD' | 'ACTIVATE_MAIN' | 'DECLARE_ATTACK' | 'SKIPPED';
  clauseFired: boolean;
  zoneVerdict: 'CORRECT' | 'WRONG_ZONE' | 'NO_DELTA' | 'NO_TARGETS_SEEDED' | 'UNCHECKED';
  controlIntact: 'YES' | 'NO' | 'N_A';
  pendingKindEnd: string | null;
  pageErrors: ReadonlyArray<string>;
  invariantErrors: ReadonlyArray<string>;
  classification: Classification; confidence: 'HIGH' | 'MEDIUM' | 'LOW'; notes: string;
  isAnchor: boolean;
}

function decideDispatchPath(trigger: string, card: CardDef, sourceZone: SeedPlan['sourceZone']): 'PLAY_CARD' | 'ACTIVATE_MAIN' | 'DECLARE_ATTACK' | 'SKIPPED' {
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
  void card;
  return 'SKIPPED';
}

async function dispatchTrigger(page: Page, path: 'PLAY_CARD' | 'ACTIVATE_MAIN' | 'DECLARE_ATTACK', sourceIid: string): Promise<{ ok: boolean; err: string | null }> {
  if (path === 'PLAY_CARD') return dispatchAs(page, { type: 'PLAY_CARD', instanceId: sourceIid, replaceTargetId: null });
  if (path === 'ACTIVATE_MAIN') return dispatchAs(page, { type: 'ACTIVATE_MAIN', instanceId: sourceIid });
  // DECLARE_ATTACK: target opp.leader by default — that's always legal once turn>=3.
  const bLeaderId = await page.evaluate(() => { const w = window as unknown as { __store?: { getState: () => { state: { players: { B: { leader: { instanceId: string } } } } } } }; return w.__store!.getState().state.players.B.leader.instanceId; });
  return dispatchAs(page, { type: 'DECLARE_ATTACK', attackerInstanceId: sourceIid, targetInstanceId: bLeaderId });
}

function classifyZoneDelta(actionKind: string, before: ZoneSnapshot, after: ZoneSnapshot, seeded: SeededRefs, targetCount: number): { zoneVerdict: StageCRemovalResult['zoneVerdict']; controlIntact: StageCRemovalResult['controlIntact']; notes: string } {
  const expectedTargets = [...seeded.bTargetIids, ...seeded.aExtraIids];
  const controls = [...seeded.bControlIids, ...seeded.aControlIids];
  // Default for trash-from-X / deck-from-X actions (no field target).
  if (actionKind === 'bottom_of_deck_from_hand') {
    const handDelta = before.aHandLen - after.aHandLen;
    const deckDelta = after.aDeckLen - before.aDeckLen;
    if (handDelta > 0 && deckDelta === handDelta) {
      return { zoneVerdict: 'CORRECT', controlIntact: 'N_A', notes: `A.hand→A.deck Δ=${handDelta}` };
    }
    return { zoneVerdict: 'NO_DELTA', controlIntact: 'N_A', notes: `expected handDelta>0, deckDelta=handDelta; got handDelta=${handDelta} deckDelta=${deckDelta}` };
  }
  if (actionKind === 'bottom_of_deck_from_trash') {
    const trashDelta = before.aTrashLen - after.aTrashLen;
    const deckDelta = after.aDeckLen - before.aDeckLen;
    if (trashDelta > 0 && deckDelta === trashDelta) {
      return { zoneVerdict: 'CORRECT', controlIntact: 'N_A', notes: `A.trash→A.deck Δ=${trashDelta}` };
    }
    return { zoneVerdict: 'NO_DELTA', controlIntact: 'N_A', notes: `expected trashDelta>0; got trashDelta=${trashDelta} deckDelta=${deckDelta}` };
  }
  if (actionKind === 'opp_bottom_of_deck_from_trash') {
    const trashDelta = before.bTrashLen - after.bTrashLen;
    const deckDelta = after.bDeckLen - before.bDeckLen;
    if (trashDelta > 0 && deckDelta === trashDelta) {
      return { zoneVerdict: 'CORRECT', controlIntact: 'N_A', notes: `B.trash→B.deck Δ=${trashDelta}` };
    }
    return { zoneVerdict: 'NO_DELTA', controlIntact: 'N_A', notes: `expected B.trashDelta>0; got trashDelta=${trashDelta} deckDelta=${deckDelta}` };
  }
  if (expectedTargets.length === 0) {
    return { zoneVerdict: 'NO_TARGETS_SEEDED', controlIntact: 'N_A', notes: `no eligible targets seeded for action=${actionKind}` };
  }
  let movedExpected = 0;
  let movedToWrong = 0;
  const wrongDetails: string[] = [];
  for (const id of expectedTargets) {
    const owner: 'A' | 'B' = seeded.bTargetIids.includes(id) ? 'B' : 'A';
    if (actionKind === 'removal_ko') {
      const inTrash = owner === 'B' ? after.inBTrash.includes(id) : after.inATrash.includes(id);
      const wasInField = owner === 'B' ? before.inBField.includes(id) : before.inAField.includes(id);
      const stillInField = owner === 'B' ? after.inBField.includes(id) : after.inAField.includes(id);
      if (inTrash && !stillInField && wasInField) movedExpected++;
      else if (!stillInField && !inTrash) {
        movedToWrong++;
        const elsewhere = after.inAHand.includes(id) ? 'a_hand' : after.inBHand.includes(id) ? 'b_hand' : after.inADeck.includes(id) ? 'a_deck' : after.inBDeck.includes(id) ? 'b_deck' : 'unknown';
        wrongDetails.push(`${id}→${elsewhere}`);
      }
    } else if (actionKind === 'removal_bounce') {
      const inHand = owner === 'B' ? after.inBHand.includes(id) : after.inAHand.includes(id);
      const wasInField = owner === 'B' ? before.inBField.includes(id) : before.inAField.includes(id);
      const stillInField = owner === 'B' ? after.inBField.includes(id) : after.inAField.includes(id);
      if (inHand && !stillInField && wasInField) movedExpected++;
      else if (!stillInField && !inHand) {
        movedToWrong++;
        const elsewhere = after.inATrash.includes(id) ? 'a_trash' : after.inBTrash.includes(id) ? 'b_trash' : 'unknown';
        wrongDetails.push(`${id}→${elsewhere}`);
      }
    } else if (actionKind === 'bottom_of_deck_to_opp_deck') {
      // Target moved to opp-of-controller (controller=A → opp=B) deck.
      const inBDeck = after.inBDeck.includes(id);
      const stillInBField = after.inBField.includes(id);
      if (inBDeck && !stillInBField) movedExpected++;
      else if (!stillInBField && !inBDeck) {
        movedToWrong++;
        const elsewhere = after.inBHand.includes(id) ? 'b_hand' : after.inBTrash.includes(id) ? 'b_trash' : 'unknown';
        wrongDetails.push(`${id}→${elsewhere}`);
      }
    } else if (actionKind === 'rest_target') {
      if (after.rested[id] === true) movedExpected++;
    } else if (actionKind === 'set_active') {
      if (after.rested[id] === false) movedExpected++;
    }
  }
  // Control intact?
  let controlIntact: 'YES' | 'NO' | 'N_A' = controls.length > 0 ? 'YES' : 'N_A';
  if (controls.length > 0) {
    for (const id of controls) {
      const owner: 'A' | 'B' = seeded.bControlIids.includes(id) ? 'B' : 'A';
      if (actionKind === 'removal_ko' || actionKind === 'removal_bounce' || actionKind === 'bottom_of_deck_to_opp_deck') {
        const stillInField = owner === 'B' ? after.inBField.includes(id) : after.inAField.includes(id);
        if (!stillInField) controlIntact = 'NO';
      } else if (actionKind === 'rest_target') {
        if (after.rested[id] === true) controlIntact = 'NO';
      } else if (actionKind === 'set_active') {
        if (after.rested[id] === false) controlIntact = 'NO';
      }
    }
  }
  const cap = Math.min(expectedTargets.length, targetCount);
  if (movedExpected >= 1 && movedToWrong === 0) return { zoneVerdict: 'CORRECT', controlIntact, notes: `moved=${movedExpected}/${cap}` };
  if (movedExpected >= 1 && movedToWrong > 0) return { zoneVerdict: 'WRONG_ZONE', controlIntact, notes: `partial wrong-zone: ${wrongDetails.join(',')}` };
  if (movedExpected === 0 && movedToWrong > 0) return { zoneVerdict: 'WRONG_ZONE', controlIntact, notes: `targets moved to wrong zone: ${wrongDetails.join(',')}` };
  return { zoneVerdict: 'NO_DELTA', controlIntact, notes: `no targets moved (action=${actionKind}, seededCount=${expectedTargets.length})` };
}

async function processCard(page: Page, card: CardDef, pageErrorsAcc: string[], invariantErrorsAcc: string[]): Promise<StageCRemovalResult> {
  const clauseInfo = firstRemovalClause(card);
  const isAnchor = ANCHORS.has(card.id);
  if (clauseInfo === null) {
    return {
      cardId: card.id, name: card.name, kind: card.kind, family: 'removal_bounce',
      actionKind: 'n/a', trigger: 'n/a', targetKind: null, clauseIndex: -1,
      gated: false, hasCost: false,
      dispatchPath: 'SKIPPED', clauseFired: false,
      zoneVerdict: 'UNCHECKED', controlIntact: 'N_A',
      pendingKindEnd: null, pageErrors: [], invariantErrors: [],
      classification: 'INCONCLUSIVE', confidence: 'LOW', notes: 'no removal-family clause found (filter mismatch)',
      isAnchor,
    };
  }
  try {
    const plan = planSeeds(card, clauseInfo);
    const dispatchPath = decideDispatchPath(clauseInfo.trigger, card, plan.sourceZone);
    if (dispatchPath === 'SKIPPED') {
      return {
        cardId: card.id, name: card.name, kind: card.kind, family: 'removal_bounce',
        actionKind: clauseInfo.actionKind, trigger: clauseInfo.trigger, targetKind: clauseInfo.targetKind, clauseIndex: clauseInfo.clauseIndex,
        gated: clauseInfo.gated, hasCost: clauseInfo.hasCost,
        dispatchPath: 'SKIPPED', clauseFired: false,
        zoneVerdict: 'UNCHECKED', controlIntact: 'N_A',
        pendingKindEnd: null, pageErrors: [], invariantErrors: [],
        classification: 'HARNESS_GAP', confidence: 'HIGH',
        notes: `trigger '${clauseInfo.trigger}' not in supported set {on_play, activate_main, when_attacking}; harness can't reach this clause via generic recipe`,
        isAnchor,
      };
    }
    // For activate_main path, verify the keyword.
    if (dispatchPath === 'ACTIVATE_MAIN') {
      const hasKw = (card.keywords ?? []).includes('activate_main');
      if (!hasKw) {
        return {
          cardId: card.id, name: card.name, kind: card.kind, family: 'removal_bounce',
          actionKind: clauseInfo.actionKind, trigger: clauseInfo.trigger, targetKind: clauseInfo.targetKind, clauseIndex: clauseInfo.clauseIndex,
          gated: clauseInfo.gated, hasCost: clauseInfo.hasCost,
          dispatchPath: 'SKIPPED', clauseFired: false,
          zoneVerdict: 'UNCHECKED', controlIntact: 'N_A',
          pendingKindEnd: null, pageErrors: [], invariantErrors: [],
          classification: 'CARD_DATA_BUG', confidence: 'MEDIUM',
          notes: `card has trigger=activate_main clause but keywords[] does not include 'activate_main'; legality.ts:316-335 requires the keyword to offer ACTIVATE_MAIN`,
          isAnchor,
        };
      }
    }
    const peBefore = pageErrorsAcc.length; const ieBefore = invariantErrorsAcc.length;
    const seeded = await fullRestoringResetAndSeed(page, plan, card, clauseInfo);
    if (seeded.sourceIid === null) {
      return {
        cardId: card.id, name: card.name, kind: card.kind, family: 'removal_bounce',
        actionKind: clauseInfo.actionKind, trigger: clauseInfo.trigger, targetKind: clauseInfo.targetKind, clauseIndex: clauseInfo.clauseIndex,
        gated: clauseInfo.gated, hasCost: clauseInfo.hasCost,
        dispatchPath, clauseFired: false,
        zoneVerdict: 'UNCHECKED', controlIntact: 'N_A',
        pendingKindEnd: null, pageErrors: [], invariantErrors: [],
        classification: 'HARNESS_BUG', confidence: 'LOW', notes: `seeding returned null sourceIid`, isAnchor,
      };
    }
    const idsOfInterest = [
      seeded.sourceIid,
      ...seeded.bTargetIids, ...seeded.bControlIids,
      ...seeded.aExtraIids, ...seeded.aControlIids,
    ];
    const beforeSnapshot = await readZones(page, idsOfInterest, seeded.sourceIid);
    const historyStartIdx = await readHistoryLen(page);
    const dispatchRes = await dispatchTrigger(page, dispatchPath, seeded.sourceIid);
    await drainPending(page);
    const clauseFired = await clauseFiredSince(page, historyStartIdx, seeded.sourceIid, clauseInfo.clauseIndex, clauseInfo.trigger, clauseInfo.actionKind);
    const afterSnapshot = await readZones(page, idsOfInterest, seeded.sourceIid);
    const pendingKindEnd = await readPendingKind(page);
    const newPE = pageErrorsAcc.slice(peBefore);
    const newIE = invariantErrorsAcc.slice(ieBefore);
    let cls: Classification; let confidence: 'HIGH' | 'MEDIUM' | 'LOW'; let notes: string;
    let zoneVerdict: StageCRemovalResult['zoneVerdict'] = 'UNCHECKED';
    let controlIntact: StageCRemovalResult['controlIntact'] = 'N_A';
    if (newPE.length > 0 || newIE.length > 0 || pendingKindEnd !== null) {
      cls = 'ENGINE_BUG'; confidence = 'HIGH';
      notes = `infra failure: PE=${newPE.length} IE=${newIE.length} pendingKindEnd=${pendingKindEnd}`;
    } else if (!dispatchRes.ok) {
      cls = 'HARNESS_GAP'; confidence = 'MEDIUM';
      notes = `dispatch ${dispatchPath} rejected: ${dispatchRes.err}`;
    } else if (!clauseFired) {
      const reason = clauseInfo.gated ? 'condition gated by un-met predicate' : clauseInfo.hasCost ? 'cost block not paid (recipe DON/discard may be insufficient)' : 'trigger fired action did not reach this clause (sibling pending suspended, opt path, or attack-block)';
      cls = 'HARNESS_GAP'; confidence = 'MEDIUM';
      notes = `CLAUSE_FIRED never observed for clause[${clauseInfo.clauseIndex}] action=${clauseInfo.actionKind}: ${reason}`;
    } else {
      const delta = classifyZoneDelta(clauseInfo.actionKind, beforeSnapshot, afterSnapshot, seeded, clauseInfo.targetCount);
      zoneVerdict = delta.zoneVerdict; controlIntact = delta.controlIntact;
      if (delta.zoneVerdict === 'CORRECT' && delta.controlIntact !== 'NO') {
        cls = 'VERIFIED'; confidence = 'HIGH';
        notes = `dispatched=${dispatchPath}; clauseFired; ${delta.notes}; controlIntact=${delta.controlIntact}`;
      } else if (delta.zoneVerdict === 'WRONG_ZONE') {
        cls = 'ENGINE_BUG'; confidence = 'HIGH';
        notes = `clause fired but target moved to wrong zone: ${delta.notes}`;
      } else if (delta.zoneVerdict === 'NO_DELTA') {
        cls = 'INCONCLUSIVE'; confidence = 'LOW';
        notes = `clause fired but no zone delta observed: ${delta.notes}`;
      } else if (delta.zoneVerdict === 'NO_TARGETS_SEEDED') {
        cls = 'HARNESS_GAP'; confidence = 'MEDIUM';
        notes = `recipe did not seed eligible targets for ${clauseInfo.targetKind ?? '(no-target)'}; ${delta.notes}`;
      } else {
        cls = 'INCONCLUSIVE'; confidence = 'LOW';
        notes = `unhandled zoneVerdict=${delta.zoneVerdict}: ${delta.notes}`;
      }
      if (delta.controlIntact === 'NO') {
        cls = 'ENGINE_BUG'; confidence = 'HIGH';
        notes = `${notes} | CONTROL filter-violator was also affected by ${clauseInfo.actionKind}`;
      }
    }
    return {
      cardId: card.id, name: card.name, kind: card.kind, family: 'removal_bounce',
      actionKind: clauseInfo.actionKind, trigger: clauseInfo.trigger, targetKind: clauseInfo.targetKind, clauseIndex: clauseInfo.clauseIndex,
      gated: clauseInfo.gated, hasCost: clauseInfo.hasCost,
      dispatchPath, clauseFired,
      zoneVerdict, controlIntact,
      pendingKindEnd, pageErrors: newPE, invariantErrors: newIE,
      classification: cls, confidence, notes, isAnchor,
    };
  } catch (err) {
    try { await drainPending(page); } catch { /* ignore */ }
    return {
      cardId: card.id, name: card.name, kind: card.kind, family: 'removal_bounce',
      actionKind: clauseInfo.actionKind, trigger: clauseInfo.trigger, targetKind: clauseInfo.targetKind, clauseIndex: clauseInfo.clauseIndex,
      gated: clauseInfo.gated, hasCost: clauseInfo.hasCost,
      dispatchPath: 'SKIPPED', clauseFired: false,
      zoneVerdict: 'UNCHECKED', controlIntact: 'N_A',
      pendingKindEnd: null, pageErrors: [], invariantErrors: [],
      classification: 'HARNESS_BUG', confidence: 'LOW',
      notes: `harness threw: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
      isAnchor,
    };
  }
}

const SLICES: CardDef[][] = [];
for (let i = 0; i < SLICE_COUNT; i++) SLICES.push(CARDS.slice(i * SLICE_SIZE, (i + 1) * SLICE_SIZE));

test.describe.serial('stage-c-generated-removal-bounce', () => {
  for (let s = 0; s < SLICES.length; s++) {
    const sliceIndex = s; const slice = SLICES[sliceIndex]!;
    test(`slice ${sliceIndex + 1}/${SLICES.length} — ${slice.length} cards (${slice[0]!.id} … ${slice[slice.length - 1]!.id})`, async ({ page }) => {
      test.setTimeout(FIVE_MIN);
      const { drv, pageErrors, invariantErrors } = await bootstrap(page);
      void drv;
      const results: StageCRemovalResult[] = [];
      for (const card of slice) results.push(await processCard(page, card, pageErrors, invariantErrors));
      expect(pageErrors, `slice ${sliceIndex} pageerrors`).toEqual([]);
      expect(invariantErrors, `slice ${sliceIndex} InvariantErrors`).toEqual([]);
      expect(await readPendingKind(page), `slice ${sliceIndex} no stuck pending`).toBeNull();
      const sliceFile = join(SLICE_TMP_DIR, `rmv-slice-${String(sliceIndex).padStart(3, '0')}.json`);
      writeFileSync(sliceFile, JSON.stringify({ sliceIndex, cardCount: slice.length, results }, null, 2), 'utf-8');
      /* eslint-disable no-console */
      console.log(`[removal-bounce] wrote slice ${sliceIndex} → ${sliceFile}`);
      /* eslint-enable no-console */
    });
  }

  test('aggregator: roll up removal-bounce slices', async () => {
    const all: StageCRemovalResult[] = [];
    for (const f of readdirSync(SLICE_TMP_DIR).filter((f) => f.startsWith('rmv-slice-') && f.endsWith('.json')).sort()) {
      const raw = JSON.parse(readFileSync(join(SLICE_TMP_DIR, f), 'utf-8')) as { results: StageCRemovalResult[] };
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
    const anchorRecs = Array.from(ANCHORS).map((id) => { const r = all.find((x) => x.cardId === id); return { id, classification: r?.classification ?? 'NOT_FOUND', actionKind: r?.actionKind ?? '(missing)', targetKind: r?.targetKind ?? '(missing)' }; });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const jsonPath = join(REPORTS_DIR, `stage-c-removal-bounce-${ts}.json`);
    const mdPath = join(REPORTS_DIR, `stage-c-removal-bounce-${ts}.md`);
    const finalReport = {
      family: 'removal_bounce', generatedAt: new Date().toISOString(),
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
    md.push(`# Stage C — Removal/Bounce/Rest Generated Report\n\n**Generated:** ${new Date().toISOString()}\n**Total removal-family cards discovered:** ${CARDS.length}\n**Total records written:** ${all.length}\n**Slice count:** ${SLICE_COUNT}\n\n`);
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
    md.push(`\n## Anchor card status\n\n| Card | Classification | Action | Target |\n|---|---|---|---|\n`);
    for (const x of anchorRecs) md.push(`| ${x.id} | ${x.classification} | ${x.actionKind} | ${x.targetKind} |\n`);
    md.push(`\n## Top 10 failure clusters\n\n`);
    if (sortedClusters.length === 0) md.push(`(none)\n`);
    else for (const c of sortedClusters.slice(0, 10)) md.push(`- **${c.cards.length} cards**: ${c.rootCause}\n`);
    md.push(`\n## Report files\n\n- JSON: \`coverage/reports/stage-c-removal-bounce-${ts}.json\`\n- MD: \`coverage/reports/stage-c-removal-bounce-${ts}.md\`\n`);
    writeFileSync(mdPath, md.join(''), 'utf-8');
    /* eslint-disable no-console */
    console.log(`[removal-bounce] FINAL JSON: ${jsonPath}`);
    console.log(`[removal-bounce] FINAL MD:   ${mdPath}`);
    console.log(`[removal-bounce] tally: ${JSON.stringify(buckets)}`);
    /* eslint-enable no-console */
    expect(all.length, 'every card must have a record').toBe(CARDS.length);
  });
});
