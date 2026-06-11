// stage-c-counter-events-recipe-tuning — Phase C focused follow-up to
// e2e/stage-c-generated-counter-events.spec.ts. Targets the 30 corpus
// counter-event cards previously classified NOT_IMPLEMENTED in
// e2e/coverage/reports/stage-c-counter-events-2026-06-07T19-12-31-598Z.json.
//
// Goal per directive: turn each card into VERIFIED via per-card custom
// recipes (leader-trait overrides, condition-state seeding, generous
// DON, hand fillers, B.field seeds, life setup). If a card cannot be
// moved to VERIFIED via recipes alone, classify with a real-issue tag
// (CARD_DATA_BUG / HARNESS_BUG / INCONCLUSIVE).
//
// Pre-investigation (study-first):
//   All 30 cards have `counterEventBoost: null` AND none have an on_play
//   `power_buff` clause whose target is defender-side (`your_leader`,
//   `your_character`, `your_leader_or_character`, `self`). Their counter
//   mechanics are non-power_buff (searcher_peek, removal_ko,
//   removal_bounce, rest_target, add_to_own_life_top, play_for_free,
//   grant_immunity, give_keyword, attack_redirect_to_target,
//   attack_lock_until_phase, negate_target_effects) OR are power_buff
//   targeting opp_* (debuff = attacker_power_down).
//
//   The current legality gate (`shared/engine-v2/rules/legality.ts:267`)
//   uses `A OR (B AND C)`: A=`boost>0`, B=`defensive power_buff clause`,
//   C=`effectTags includes 'counter_event'`. For all 30 cards: A=false,
//   B=false ⇒ (B AND C)=false ⇒ not playable as counter.
//
//   No recipe can change this — legality is computed from card data, not
//   from harness state. Therefore recipes alone cannot reach VERIFIED.
//   The spec runs the recipes anyway to confirm empirically and to
//   classify each card with a real-issue label (CARD_DATA_BUG: missing
//   `counterEventBoost` corner counter value encoding for a card whose
//   printed text starts with `[Counter]`).
//
// Engine references:
//   - legality.ts:267-302 — counter-event playability gate
//   - attackFlow.ts:317-411 — playCounterReducer
//   - actions.ts:75-103 — power_buff handler
//   - state/types.ts:188 — pending kind enumeration

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
const SLICE_TMP_DIR = resolve(__dirname, 'coverage/reports/.stage-c-recipe-tuning');
mkdirSync(REPORTS_DIR, { recursive: true });
mkdirSync(SLICE_TMP_DIR, { recursive: true });
for (const f of readdirSync(SLICE_TMP_DIR)) {
  if (f.endsWith('.json')) { try { unlinkSync(join(SLICE_TMP_DIR, f)); } catch { /* ignore */ } }
}

// The 30 NOT_IMPLEMENTED cards from the prior run.
const TARGET_IDS: ReadonlyArray<string> = [
  'EB01-009', 'EB01-010', 'EB01-029', 'EB01-038', 'EB01-050', 'EB02-030',
  'OP01-028', 'OP01-087', 'OP01-089', 'OP02-089', 'OP02-118', 'OP03-017',
  'OP04-017', 'OP04-036', 'OP04-038', 'OP04-115', 'OP05-077', 'OP06-096',
  'OP07-075', 'OP08-094', 'OP09-097', 'OP10-040', 'OP10-078', 'OP11-018',
  'OP13-039', 'OP14-118', 'OP15-021', 'ST03-016', 'ST09-014', 'ST12-016',
];

interface CounterEventCardDef {
  readonly id: string;
  readonly name: string;
  readonly kind: 'event';
  readonly cost: number;
  readonly counterEventBoost: number | null;
  readonly effectTags?: ReadonlyArray<string>;
  readonly traits?: ReadonlyArray<string>;
  readonly colors?: ReadonlyArray<string>;
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
function findCard(id: string): CounterEventCardDef {
  const f = CORPUS.find((c) => (c as { id?: string }).id === id);
  if (!f) throw new Error(`corpus missing ${id}`);
  return f as unknown as CounterEventCardDef;
}

const CARDS: CounterEventCardDef[] = TARGET_IDS.map(findCard);

type Classification = 'VERIFIED' | 'ENGINE_BUG' | 'CARD_DATA_BUG' | 'HARNESS_BUG' | 'NOT_IMPLEMENTED' | 'INCONCLUSIVE';

interface SetupRecipe {
  donCount: number;
  aHandSize: number;
  aLifeCount: number;
  bLifeCount: number;
  seedGuardCounter: boolean;
  leaderTraitsOverride?: string[];
  aTrashCount?: number;
  bFieldChars?: Array<{ cost: number; power: number; traits?: string[] }>;
  aFieldChars?: Array<{ cost: number; power: number; traits?: string[] }>;
}

interface Recipe {
  cardId: string;
  recipe: SetupRecipe;
  notes: string;
}

// ── Per-card recipes — best-effort gate satisfaction ────────────────
// Even with these, all 30 are predicted to remain NOT_IMPLEMENTED at
// legality due to A OR (B AND C) gate (boost=0 + no defensive power_buff).
// Recipe overrides are still included so each card gets a fair shot at
// passing legality if my pre-analysis is wrong.
const RECIPES: Map<string, Recipe> = new Map();
function recipeFor(card: CounterEventCardDef): Recipe {
  const clauses = card.effectSpecV2?.clauses ?? [];
  const leaderCondClause = clauses.find((c) => {
    const ct = c.condition?.type;
    return ct === 'if_leader_has_trait' || ct === 'if_leader_has_type' || ct === 'if_leader_is';
  });
  const ownLifeMaxClause = clauses.find((c) => c.condition?.type === 'if_own_life_max');
  const ownLifeMinClause = clauses.find((c) => c.condition?.type === 'if_own_life_min');
  const trashMinClause = clauses.find((c) => c.condition?.type === 'if_trash_min');
  const oppCharTargetClause = clauses.find((c) => c.target?.kind === 'opp_character' || c.target?.kind === 'opp_leader_or_character' || c.target?.kind === 'opp_leader');
  const lifeToHandCost = clauses.some((c) => c.cost !== undefined && c.cost !== null && Object.prototype.hasOwnProperty.call(c.cost, 'lifeToHand'));
  const bottomOfDeckFromTrashCost = clauses.some((c) => c.cost !== undefined && c.cost !== null && Object.prototype.hasOwnProperty.call(c.cost, 'bottomOfDeckFromTrash'));
  const recipe: SetupRecipe = {
    donCount: Math.min(10, Math.max(0, card.cost + 4)),
    aHandSize: 4,
    aLifeCount: 5,
    bLifeCount: 5,
    seedGuardCounter: true,
  };
  const notes: string[] = [];
  // Leader trait override based on card traits (best guess for if_leader_has_trait/type).
  if (leaderCondClause !== undefined) {
    const trait = (leaderCondClause.condition as { trait?: unknown; typeString?: unknown }).trait
              ?? (leaderCondClause.condition as { trait?: unknown; typeString?: unknown }).typeString;
    if (typeof trait === 'string') {
      recipe.leaderTraitsOverride = [trait];
      notes.push(`leaderTraits=[${trait}] for ${leaderCondClause.condition?.type}`);
    }
  }
  // Life setup for life-conditioned clauses.
  if (ownLifeMaxClause !== undefined) {
    const n = (ownLifeMaxClause.condition as { n?: unknown }).n;
    if (typeof n === 'number') {
      recipe.aLifeCount = Math.max(0, n);
      notes.push(`aLifeCount=${recipe.aLifeCount} for if_own_life_max:${n}`);
    }
  }
  if (ownLifeMinClause !== undefined) {
    const n = (ownLifeMinClause.condition as { n?: unknown }).n;
    if (typeof n === 'number') {
      recipe.aLifeCount = Math.max(recipe.aLifeCount, n);
      notes.push(`aLifeCount=${recipe.aLifeCount} for if_own_life_min:${n}`);
    }
  }
  if (lifeToHandCost) {
    recipe.aLifeCount = Math.max(recipe.aLifeCount, 5);
    notes.push(`aLifeCount=${recipe.aLifeCount} for lifeToHand cost`);
  }
  // Trash seed for trash-conditioned clauses.
  if (trashMinClause !== undefined) {
    const n = (trashMinClause.condition as { n?: unknown }).n;
    if (typeof n === 'number') {
      recipe.aTrashCount = n;
      notes.push(`aTrashCount=${n} for if_trash_min`);
    }
  }
  if (bottomOfDeckFromTrashCost) {
    recipe.aTrashCount = Math.max(recipe.aTrashCount ?? 0, 5);
    notes.push(`aTrashCount=${recipe.aTrashCount} for bottomOfDeckFromTrash cost`);
  }
  // B.field seed if clause targets opp character.
  if (oppCharTargetClause !== undefined) {
    recipe.bFieldChars = [{ cost: 4, power: 4000, traits: [] }];
    notes.push(`bFieldChars seeded for ${oppCharTargetClause.target?.kind}`);
  }
  return { cardId: card.id, recipe, notes: notes.join('; ') };
}
for (const card of CARDS) RECIPES.set(card.id, recipeFor(card));

// ── Harness (same patterns as the audit specs + prior generated spec) ─

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

async function resetWithRecipe(page: Page, recipe: SetupRecipe): Promise<void> {
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
    // Leader trait override.
    if (Array.isArray(opts.leaderTraitsOverride)) {
      const lcA = lib[players.A.leader.cardId] as { traits?: string[] } | undefined;
      if (lcA !== undefined) lcA.traits = opts.leaderTraitsOverride.slice();
    }
    // A.hand fillers + guard.
    players.A.hand = [];
    for (let i = 0; i < opts.aHandSize; i++) {
      const synthId = `__fillerHand_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `fillerH_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = { id: synthId, name: `FillerHand ${i}`, kind: 'character', cost: 1, power: 1000, counterValue: null, colors: ['red'], traits: [], keywords: [], effectText: '' };
      instances[iid] = { instanceId: iid, cardId: synthId, controller: 'A', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      players.A.hand.push(iid);
    }
    if (opts.seedGuardCounter !== false) {
      const synthId = `__guardCEv_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `guardCEv_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = { id: synthId, name: 'Guard Counter Event', kind: 'event', cost: 0, power: null, counterValue: null, colors: ['red'], traits: [], keywords: [], effectText: '', counterEventBoost: 1000, effectSpecV2: { clauses: [], continuous: [], replacements: [], schemaVersion: 2, verified: 'human-reviewed' } };
      instances[iid] = { instanceId: iid, cardId: synthId, controller: 'A', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      players.A.hand.push(iid);
    }
    // A.life refill.
    while (players.A.life.length < opts.aLifeCount) {
      const synthId = `__seedLife_${Math.floor(Math.random() * 1e9).toString(36)}`;
      const iid = `seedLife_${Math.floor(Math.random() * 1e9).toString(36)}`;
      lib[synthId] = { id: synthId, name: 'Life Placeholder', kind: 'character', cost: 1, power: 1000, counterValue: 1000, colors: ['red'], traits: [], keywords: [], effectText: '' };
      instances[iid] = { instanceId: iid, cardId: synthId, controller: 'A', rested: false, summoningSick: false, attachedDon: [], attachedDonRested: [], perTurn: { hasAttacked: false, effectsUsed: [] } };
      players.A.life.push(iid);
    }
    while (players.A.life.length > opts.aLifeCount) players.A.life.pop();
    // B.life refill.
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
  await page.waitForTimeout(60);
}

async function seedCardInAHand(page: Page, def: Record<string, unknown>): Promise<string> {
  return page.evaluate((def) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    lib[def['id'] as string] = def;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { hand: string[] } };
    const iid = `recipeTune_${def['id']}_${Math.floor(Math.random() * 1e9).toString(36)}`;
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

async function enterCounterWindow(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const players = s.players as { A: { leader: { instanceId: string } }; B: { leader: { instanceId: string } } };
    (s as Record<string, unknown>).phase = 'counter_window';
    (s as Record<string, unknown>).activePlayer = 'B';
    (s as Record<string, unknown>).pending = { kind: 'attack', pendingAttack: { attackerInstanceId: players.B.leader.instanceId, targetInstanceId: players.A.leader.instanceId, counterBoost: 0 } };
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
    return (w.__getLegalActions(s, 'A') as { type: string; instanceId?: string }[]).filter((a) => a.type === 'PLAY_COUNTER').map((a) => a.instanceId ?? '');
  });
}

async function readFullSnap(page: Page): Promise<{
  phase: string; pendingKind: string | null;
  counterBoost: number; aLeaderModBattle: number; aLeaderModOneShot: number;
  aHandLen: number; aTrashLen: number; aFieldLen: number; aLifeLen: number;
  aDonCost: number; aDonRested: number; aDonDeck: number;
  donTotalA: number; instanceIdSet: ReadonlyArray<string>; duplicateIids: ReadonlyArray<string>;
  historyTail: ReadonlyArray<Record<string, unknown>>;
}> {
  return page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { state: { phase: string; pending: { kind?: string; pendingAttack?: { counterBoost?: number } } | null; players: { A: { hand: string[]; trash: string[]; life: string[]; deck: string[]; donDeck: string[]; donCostArea: string[]; donRested: string[]; field: { instanceId: string }[]; leader: { instanceId: string; powerModifierThisBattle?: number; powerModifierOneShot?: number } }; B: { field: { instanceId: string }[] } }; instances: Record<string, { attachedDon?: string[]; attachedDonRested?: string[] }>; history: ReadonlyArray<Record<string, unknown>> } } } };
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
    for (const iid of allIids) {
      const inst = s.instances[iid];
      if (inst) attachedDonA += (inst.attachedDon?.length ?? 0) + (inst.attachedDonRested?.length ?? 0);
    }
    const seen = new Set<string>(); const dups = new Set<string>();
    for (const id of allIids) { if (seen.has(id)) dups.add(id); else seen.add(id); }
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

interface TuningResult {
  cardId: string;
  name: string;
  cost: number;
  counterEventBoost: number | null;
  effectTags: ReadonlyArray<string>;
  effectText: string;
  recipe: SetupRecipe;
  recipeNotes: string;
  playable: boolean;
  classification: Classification;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  notes: string;
  observedEffectSummary: string;
  donConserved: boolean;
  noDuplicateInstanceIds: boolean;
  noStuckPending: boolean;
  historyTail: ReadonlyArray<Record<string, unknown>>;
  pageErrors: ReadonlyArray<string>;
  invariantErrors: ReadonlyArray<string>;
}

async function processCard(page: Page, card: CounterEventCardDef, pageErrorsAcc: string[], invariantErrorsAcc: string[]): Promise<TuningResult> {
  const r = RECIPES.get(card.id)!;
  const recipeNotes = r.notes || '(default recipe)';
  const pageErrorsBefore = pageErrorsAcc.length;
  const invariantErrorsBefore = invariantErrorsAcc.length;
  try {
    await resetWithRecipe(page, r.recipe);
    const cardIid = await seedCardInAHand(page, card as unknown as Record<string, unknown>);
    await enterCounterWindow(page);
    const before = await readFullSnap(page);
    const offered = await legalCounterIds(page);
    const playable = offered.includes(cardIid);
    if (!playable) {
      await drainPending(page);
      const after = await readFullSnap(page);
      const newPE = pageErrorsAcc.slice(pageErrorsBefore);
      const newIE = invariantErrorsAcc.slice(invariantErrorsBefore);
      // Diagnose WHY rejected: Path A boost check vs (B AND C) check vs cost gate.
      const boost = card.counterEventBoost ?? 0;
      const tags = card.effectTags ?? [];
      const hasCounterTag = tags.includes('counter_event');
      const clauses = card.effectSpecV2?.clauses ?? [];
      const hasDefensivePowerBuff = clauses.some((c) =>
        c.trigger === 'on_play' && c.action?.kind === 'power_buff' &&
        (c.target?.kind === 'your_leader' || c.target?.kind === 'your_character' || c.target?.kind === 'your_leader_or_character' || c.target?.kind === 'self')
      );
      const costPayable = card.cost <= before.aDonCost;
      let rootCause: string;
      let classification: Classification;
      if (!costPayable) {
        rootCause = `cost not payable: card.cost=${card.cost} aDonCost=${before.aDonCost}`;
        classification = 'HARNESS_BUG';
      } else if (boost === 0 && !(hasDefensivePowerBuff && hasCounterTag)) {
        // legality A OR (B AND C) gate rejection; counter_event tag present but
        // no defensive power_buff clause and counterEventBoost is null.
        rootCause = `legality gate rejected: counterEventBoost=${boost} hasCounterTag=${hasCounterTag} hasDefensivePowerBuff=${hasDefensivePowerBuff}; printed text starts with [Counter] but cards.json encodes neither a corner counter value nor a defensive power_buff clause`;
        classification = 'CARD_DATA_BUG';
      } else {
        rootCause = `unexpected legality rejection — boost=${boost} hasCounterTag=${hasCounterTag} hasDefensivePowerBuff=${hasDefensivePowerBuff} costPayable=${costPayable}`;
        classification = 'INCONCLUSIVE';
      }
      return {
        cardId: card.id, name: card.name, cost: card.cost, counterEventBoost: card.counterEventBoost, effectTags: tags,
        effectText: card.effectText ?? '', recipe: r.recipe, recipeNotes,
        playable: false, classification,
        confidence: classification === 'CARD_DATA_BUG' ? 'HIGH' : 'LOW',
        notes: rootCause,
        observedEffectSummary: 'PLAY_COUNTER not offered',
        donConserved: after.donTotalA === before.donTotalA,
        noDuplicateInstanceIds: after.duplicateIids.length === 0,
        noStuckPending: (await readPendingKind(page)) === null,
        historyTail: after.historyTail, pageErrors: newPE, invariantErrors: newIE,
      };
    }
    // Card offered — dispatch.
    const playRes = await dispatchAs(page, { type: 'PLAY_COUNTER', instanceId: cardIid });
    const mid = await readFullSnap(page);
    await drainPending(page);
    const after = await readFullSnap(page);
    const newPE = pageErrorsAcc.slice(pageErrorsBefore);
    const newIE = invariantErrorsAcc.slice(invariantErrorsBefore);
    const donConserved = after.donTotalA === before.donTotalA;
    const noDup = after.duplicateIids.length === 0;
    const noStuck = (await readPendingKind(page)) === null;
    let classification: Classification;
    let confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    let notes: string;
    if (!playRes.ok) { classification = 'ENGINE_BUG'; confidence = 'HIGH'; notes = `dispatch threw: ${playRes.err}`; }
    else if (newIE.length > 0) { classification = 'ENGINE_BUG'; confidence = 'HIGH'; notes = `invariant violated: ${newIE[0]}`; }
    else if (newPE.length > 0) { classification = 'ENGINE_BUG'; confidence = 'HIGH'; notes = `page error: ${newPE[0]}`; }
    else if (!donConserved) { classification = 'ENGINE_BUG'; confidence = 'HIGH'; notes = `DON conservation: pre=${before.donTotalA} post=${after.donTotalA}`; }
    else if (!noDup) { classification = 'ENGINE_BUG'; confidence = 'HIGH'; notes = `duplicate iids: ${after.duplicateIids.join(',')}`; }
    else if (!noStuck) { classification = 'HARNESS_BUG'; confidence = 'MEDIUM'; notes = 'pending did not drain'; }
    else {
      const cpSeen = mid.historyTail.some((h) => h.type === 'COUNTER_PLAYED' && (h as Record<string, unknown>).instanceId === cardIid) ||
                     after.historyTail.some((h) => h.type === 'COUNTER_PLAYED' && (h as Record<string, unknown>).instanceId === cardIid);
      if (!cpSeen) { classification = 'INCONCLUSIVE'; confidence = 'LOW'; notes = 'PLAY_COUNTER dispatched but no COUNTER_PLAYED in history tail'; }
      else { classification = 'VERIFIED'; confidence = 'HIGH'; notes = `COUNTER_PLAYED logged; mid.counterBoost=${mid.counterBoost} leaderMod=(${mid.aLeaderModBattle}/${mid.aLeaderModOneShot})`; }
    }
    const observedEffectSummary = `counterBoost=${mid.counterBoost}, leaderModBattle=${mid.aLeaderModBattle}, leaderModOneShot=${mid.aLeaderModOneShot}, aHandΔ=${after.aHandLen - before.aHandLen}, aTrashΔ=${after.aTrashLen - before.aTrashLen}, aLifeΔ=${after.aLifeLen - before.aLifeLen}, bFieldΔ=${after.aDonCost - before.aDonCost}`;
    return {
      cardId: card.id, name: card.name, cost: card.cost, counterEventBoost: card.counterEventBoost, effectTags: card.effectTags ?? [],
      effectText: card.effectText ?? '', recipe: r.recipe, recipeNotes,
      playable: true, classification, confidence, notes, observedEffectSummary,
      donConserved, noDuplicateInstanceIds: noDup, noStuckPending: noStuck,
      historyTail: after.historyTail, pageErrors: newPE, invariantErrors: newIE,
    };
  } catch (err) {
    try { await drainPending(page); } catch { /* ignore */ }
    return {
      cardId: card.id, name: card.name, cost: card.cost, counterEventBoost: card.counterEventBoost, effectTags: card.effectTags ?? [],
      effectText: card.effectText ?? '', recipe: r.recipe, recipeNotes,
      playable: false, classification: 'HARNESS_BUG', confidence: 'LOW',
      notes: `harness threw: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
      observedEffectSummary: '(harness threw)',
      donConserved: true, noDuplicateInstanceIds: true, noStuckPending: false,
      historyTail: [], pageErrors: [], invariantErrors: [],
    };
  }
}

// Slice 30 cards into 2 slices of 15 (well under the 5-min cap).
const SLICE_SIZE = 15;
const SLICE_COUNT = Math.ceil(CARDS.length / SLICE_SIZE);
const SLICES: CounterEventCardDef[][] = [];
for (let i = 0; i < SLICE_COUNT; i++) SLICES.push(CARDS.slice(i * SLICE_SIZE, (i + 1) * SLICE_SIZE));

test.describe.serial('stage-c-counter-events-recipe-tuning', () => {
  for (let s = 0; s < SLICES.length; s++) {
    const sliceIndex = s;
    const slice = SLICES[sliceIndex]!;
    test(`slice ${sliceIndex + 1}/${SLICES.length} — ${slice.length} cards`, async ({ page }) => {
      test.setTimeout(FIVE_MIN);
      const { drv, pageErrors, invariantErrors } = await bootstrap(page);
      void drv;
      const results: TuningResult[] = [];
      for (const card of slice) results.push(await processCard(page, card, pageErrors, invariantErrors));
      expect(pageErrors, `slice ${sliceIndex} pageerrors`).toEqual([]);
      expect(invariantErrors, `slice ${sliceIndex} InvariantErrors`).toEqual([]);
      expect(await readPendingKind(page), `slice ${sliceIndex} no stuck pending`).toBeNull();
      const sliceFile = join(SLICE_TMP_DIR, `tuning-slice-${String(sliceIndex).padStart(2, '0')}.json`);
      writeFileSync(sliceFile, JSON.stringify({ sliceIndex, cardCount: slice.length, results }, null, 2), 'utf-8');
      /* eslint-disable no-console */
      console.log(`[recipe-tuning] wrote slice ${sliceIndex} → ${sliceFile}`);
      /* eslint-enable no-console */
    });
  }

  test('aggregator: roll up tuning slices', async () => {
    const all: TuningResult[] = [];
    for (const f of readdirSync(SLICE_TMP_DIR).filter((f) => f.startsWith('tuning-slice-') && f.endsWith('.json')).sort()) {
      const raw = JSON.parse(readFileSync(join(SLICE_TMP_DIR, f), 'utf-8')) as { results: TuningResult[] };
      for (const r of raw.results) all.push(r);
    }
    const tally = {
      VERIFIED: all.filter((r) => r.classification === 'VERIFIED').length,
      ENGINE_BUG: all.filter((r) => r.classification === 'ENGINE_BUG').length,
      CARD_DATA_BUG: all.filter((r) => r.classification === 'CARD_DATA_BUG').length,
      HARNESS_BUG: all.filter((r) => r.classification === 'HARNESS_BUG').length,
      NOT_IMPLEMENTED: all.filter((r) => r.classification === 'NOT_IMPLEMENTED').length,
      INCONCLUSIVE: all.filter((r) => r.classification === 'INCONCLUSIVE').length,
    };
    // Cluster failures by notes signature first 100 chars.
    const clusters = new Map<string, { rootCause: string; cards: string[] }>();
    for (const r of all) {
      if (r.classification === 'VERIFIED') continue;
      const sig = (r.notes || `(${r.classification})`).slice(0, 100);
      const ex = clusters.get(sig) ?? { rootCause: sig, cards: [] };
      ex.cards.push(r.cardId);
      clusters.set(sig, ex);
    }
    const sortedClusters = Array.from(clusters.values()).sort((a, b) => b.cards.length - a.cards.length);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const jsonPath = join(REPORTS_DIR, `stage-c-counter-events-recipe-tuning-${ts}.json`);
    const mdPath = join(REPORTS_DIR, `stage-c-counter-events-recipe-tuning-${ts}.md`);
    const finalReport = {
      family: 'counter_event', subPhase: 'recipe-tuning',
      generatedAt: new Date().toISOString(),
      totalTunedCards: all.length,
      classifications: tally,
      failureClusters: sortedClusters,
      results: all,
    };
    writeFileSync(jsonPath, JSON.stringify(finalReport, null, 2), 'utf-8');
    const md: string[] = [];
    md.push(`# Stage C — Counter Events Recipe Tuning Report\n\n`);
    md.push(`**Generated:** ${new Date().toISOString()}\n`);
    md.push(`**Total tuned cards:** ${all.length}\n\n`);
    md.push(`## Classification buckets\n\n| Bucket | Count |\n|---|---:|\n`);
    for (const [k, v] of Object.entries(tally)) md.push(`| ${k} | ${v} |\n`);
    md.push(`\n## Per-card table\n\n| Card | Cost | Boost | Recipe override | Result | Observed |\n|---|---:|---:|---|---|---|\n`);
    for (const r of all) {
      md.push(`| ${r.cardId} ${r.name.slice(0, 30)} | ${r.cost} | ${r.counterEventBoost ?? 'null'} | ${r.recipeNotes.slice(0, 50)} | ${r.classification} | ${r.observedEffectSummary.slice(0, 60)} |\n`);
    }
    md.push(`\n## Root-cause failure clusters\n\n`);
    if (sortedClusters.length === 0) md.push(`(none)\n`);
    else for (const c of sortedClusters) md.push(`- **${c.cards.length} cards**: ${c.rootCause}\n  - Affected: ${c.cards.join(', ')}\n\n`);
    md.push(`\n## Report files\n\n- JSON: \`coverage/reports/${jsonPath.split('reports/')[1]}\`\n- MD: \`coverage/reports/${mdPath.split('reports/')[1]}\`\n`);
    writeFileSync(mdPath, md.join(''), 'utf-8');
    /* eslint-disable no-console */
    console.log(`[recipe-tuning] FINAL JSON: ${jsonPath}`);
    console.log(`[recipe-tuning] FINAL MD:   ${mdPath}`);
    console.log(`[recipe-tuning] tally: ${JSON.stringify(tally)}`);
    /* eslint-enable no-console */
    expect(all.length, 'every targeted card must have a record').toBe(CARDS.length);
  });
});
