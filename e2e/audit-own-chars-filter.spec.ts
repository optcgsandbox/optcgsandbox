// audit-own-chars-filter — Manual-review-backlog Group 4 targeted
// audit. Anchor OP07-050 Boa Sandersonia.
//
// Question: does the engine `if_own_chars_min_filter` handler at
// `shared/engine-v2/registry/handlers/conditions2.ts:210-224` honor
// the `traitsAny` + `kind` filter keys that cards.json uses for
// OP07-050?
//
// Source reads:
//   - cards.json OP07-050 effectSpecV2.clauses[0].condition:
//       { type: 'if_own_chars_min_filter', n: 2,
//         filter: { traitsAny: ['Amazon Lily','Kuja Pirates'], kind:'character' } }
//   - cards.json OP07-050.traits = ['Kuja Pirates']  (Sandersonia matches its own filter)
//   - cards.json OP07-050.effectText: "[On Play] If you have 2 or
//     more {Amazon Lily} or {Kuja Pirates} type Characters on your
//     field, return up to 1 of your opponent's Characters with a
//     cost of 3 or less to the owner's hand."
//   - engine handler reads only `f.trait` (singular), `f.minCost`,
//     `f.maxCost`. `traitsAny` and `kind` are silently dropped.
//
// Three subcases (printed-text vs current-engine-behavior comparison):
//
//   1. FALSE control: A.field empty pre-play; post-play A.field=1
//      (Sandersonia, Kuja Pirates). Both printed and current engine
//      evaluate condition FALSE because total < 2. Effect SKIPS.
//
//   2. TRUE control: pre-seed 1 Amazon Lily char + Sandersonia ⇒
//      post-play A.field=2 matching. Both printed and engine
//      evaluate TRUE. Effect FIRES (bounce B target).
//
//   3. DISCRIMINATOR: pre-seed 1 char with UNRELATED trait
//      (e.g. 'Land of Wano') + Sandersonia ⇒ post-play A.field=2
//      total but only 1 matching (Sandersonia). Per printed text:
//      condition FALSE ⇒ effect SKIPS. Per current engine (ignores
//      `traitsAny`): condition TRUE ⇒ effect FIRES.
//
// AUDIT semantics:
//   - test PASSES on clean data capture; classification per subcase
//     is the result.
//   - test FAILS only on infra/product crash (pageerror, invariant,
//     stuck pending).
//   - DO NOT patch yet — report only.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { PlayerDriver } from './helpers/player';

const TWO_MIN = 2 * 60_000;

test.use({
  launchOptions: {
    args: ['--disable-renderer-backgrounding', '--no-sandbox'],
  },
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CORPUS_PATH = resolve(__dirname, '../shared/data/cards.json');
const CORPUS_RAW = JSON.parse(readFileSync(CORPUS_PATH, 'utf-8')) as unknown;
const CORPUS = (Array.isArray(CORPUS_RAW) ? CORPUS_RAW : Object.values(CORPUS_RAW as Record<string, unknown>)) as Array<Record<string, unknown>>;
function corpusDef(id: string): Record<string, unknown> {
  const f = CORPUS.find((c) => (c as { id?: string }).id === id);
  if (!f) throw new Error(`corpus missing ${id}`);
  return f;
}

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
  try { await drv.waitForPhase('first_player_choice', 15_000); await drv.chooseGoFirst(); } catch {}
  try { await drv.waitForPhase('mulligan', 8_000); await drv.keepMulliganHand(); } catch {}
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

async function seedCardInAHand(page: Page, def: Record<string, unknown>): Promise<string> {
  return page.evaluate((def) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    lib[def['id'] as string] = def;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { hand: string[] } };
    const iid = `seedAudit_${def['id']}_${Math.floor(Math.random() * 1e9).toString(36)}`;
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

async function seedCharOnField(page: Page, side: 'A' | 'B', overrides: Partial<{ cost: number; power: number; traits: string[]; tag: string }>): Promise<string> {
  const cost = overrides.cost ?? 1;
  const power = overrides.power ?? 3000;
  const traits = overrides.traits ?? [];
  const tag = overrides.tag ?? 'gen';
  return page.evaluate(({ side, cost, power, traits, tag }) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { field: unknown[] }; B: { field: unknown[] } };
    const synthId = `__seed_aud_${side}_${tag}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    const iid = `seedAud_${side}_${tag}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    lib[synthId] = {
      id: synthId, name: `Aud ${side} ${tag}`, kind: 'character',
      cost, power, counterValue: 1000,
      colors: ['red'], traits, keywords: [], effectText: '',
    };
    inst[iid] = {
      instanceId: iid, cardId: synthId, controller: side,
      rested: false, summoningSick: false,
      attachedDon: [], attachedDonRested: [],
      perTurn: { hasAttacked: false, effectsUsed: [] },
    };
    players[side].field = [...players[side].field, inst[iid]];
    w.__store!.setState({ state: { ...s } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
    return iid;
  }, { side, cost, power, traits, tag });
}

async function topUpADon(page: Page, target: number): Promise<void> {
  await page.evaluate((target) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const players = s.players as { A: { donDeck: string[]; donCostArea: string[]; donRested: string[] } };
    const pool = [...players.A.donDeck, ...players.A.donCostArea, ...players.A.donRested];
    players.A.donCostArea = pool.slice(0, target);
    players.A.donDeck = pool.slice(target);
    players.A.donRested = [];
    w.__store!.setState({ state: { ...s, players: { ...(s.players as Record<string, unknown>), A: { ...players.A } } } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
  }, target);
}

async function clearAField(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const players = s.players as { A: { field: unknown[] } };
    players.A.field = [];
    w.__store!.setState({ state: { ...s, players: { ...(s.players as Record<string, unknown>), A: { ...players.A } } } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
  });
}

async function clearBField(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const players = s.players as { B: { field: unknown[] } };
    players.B.field = [];
    w.__store!.setState({ state: { ...s, players: { ...(s.players as Record<string, unknown>), B: { ...players.B } } } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
  });
}

async function playFromHand(page: Page, iid: string): Promise<void> {
  await page.evaluate((id) => {
    const w = window as unknown as { __store?: { getState: () => { dispatch: (a: unknown) => void } } };
    w.__store!.getState().dispatch({ type: 'PLAY_CARD', instanceId: id, replaceTargetId: null });
  }, iid);
  await page.waitForTimeout(300);
}

interface Snap {
  aFieldIds: string[];
  bFieldIds: string[];
  bHandIds: string[];
  phase: string;
  pendingKind: string | null;
}

async function readSnap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { state: { phase: string; pending: { kind?: string } | null; players: { A: { field: { instanceId: string }[] }; B: { field: { instanceId: string }[]; hand: string[] } } } } } };
    const s = w.__store!.getState().state;
    return {
      aFieldIds: s.players.A.field.map((i) => i.instanceId),
      bFieldIds: s.players.B.field.map((i) => i.instanceId),
      bHandIds: [...s.players.B.hand],
      phase: s.phase,
      pendingKind: s.pending?.kind ?? null,
    };
  });
}

// Count A.field chars whose card.traits includes any of the listed traits.
async function readAFieldMatchingCount(page: Page, traits: string[]): Promise<number> {
  return page.evaluate((traits) => {
    const w = window as unknown as { __store?: { getState: () => { state: { players: { A: { field: { instanceId: string }[] } }; instances: Record<string, { cardId: string }>; cardLibrary: Record<string, { traits?: string[]; kind?: string }> } } } };
    const s = w.__store!.getState().state;
    let count = 0;
    for (const inst of s.players.A.field) {
      const i = s.instances[inst.instanceId];
      const card = i ? s.cardLibrary[i.cardId] : undefined;
      const cardTraits = card?.traits ?? [];
      if (traits.some((t) => cardTraits.includes(t))) count += 1;
    }
    return count;
  }, traits);
}

interface SubcaseResult {
  name: string;
  aFieldTotal: number;
  aFieldMatching: number;
  bTargetBouncedToHand: boolean;
  bFieldBefore: number;
  bFieldAfter: number;
  bHandBefore: number;
  bHandAfter: number;
  intendedConditionResult: 'TRUE' | 'FALSE';
  observedEngineResult: 'TRUE' | 'FALSE';
  classification: 'VERIFIED' | 'ENGINE_BUG' | 'CARD_DATA_BUG' | 'HARNESS_BUG' | 'INCONCLUSIVE';
  notes: string;
}

test.describe('audit-own-chars-filter (Group 4 — OP07-050)', () => {
  test('OP07-050 Boa Sandersonia — if_own_chars_min_filter handler honors traitsAny + kind?', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    const results: SubcaseResult[] = [];

    const SUSPECT_TRAITS = ['Amazon Lily', 'Kuja Pirates'];

    // ── Subcase 1: FALSE control (A.field empty pre-play; post-play=1) ──
    await clearAField(page);
    await clearBField(page);
    await topUpADon(page, 3);
    const bTarget1 = await seedCharOnField(page, 'B', { cost: 2, power: 3000, tag: 'tgt1' });
    const sand1 = await seedCardInAHand(page, corpusDef('OP07-050'));
    const before1 = await readSnap(page);
    await playFromHand(page, sand1);
    const after1 = await readSnap(page);
    const after1Matching = await readAFieldMatchingCount(page, SUSPECT_TRAITS);
    const bouncedHand1 = after1.bHandIds.includes(bTarget1);
    const fired1 = !after1.bFieldIds.includes(bTarget1);
    results.push({
      name: '1. FALSE control (A.field empty pre-play)',
      aFieldTotal: after1.aFieldIds.length,
      aFieldMatching: after1Matching,
      bTargetBouncedToHand: bouncedHand1,
      bFieldBefore: before1.bFieldIds.length,
      bFieldAfter: after1.bFieldIds.length,
      bHandBefore: before1.bHandIds.length,
      bHandAfter: after1.bHandIds.length,
      intendedConditionResult: 'FALSE',
      observedEngineResult: fired1 ? 'TRUE' : 'FALSE',
      classification: fired1 ? 'INCONCLUSIVE' : 'VERIFIED',
      notes: fired1
        ? 'effect fired but printed text expects SKIP (count<2)'
        : 'condition false; effect skipped as expected',
    });

    // ── Subcase 2: TRUE control (pre-seed 1 Amazon Lily char) ───────
    await clearAField(page);
    await clearBField(page);
    await topUpADon(page, 3);
    const aAmazonLily = await seedCharOnField(page, 'A', { cost: 1, power: 1000, traits: ['Amazon Lily'], tag: 'al' });
    const bTarget2 = await seedCharOnField(page, 'B', { cost: 2, power: 3000, tag: 'tgt2' });
    void aAmazonLily;
    const sand2 = await seedCardInAHand(page, corpusDef('OP07-050'));
    const before2 = await readSnap(page);
    await playFromHand(page, sand2);
    const after2 = await readSnap(page);
    const after2Matching = await readAFieldMatchingCount(page, SUSPECT_TRAITS);
    const bouncedHand2 = after2.bHandIds.includes(bTarget2);
    const fired2 = !after2.bFieldIds.includes(bTarget2);
    results.push({
      name: '2. TRUE control (1 Amazon Lily + Sandersonia ⇒ 2 matching)',
      aFieldTotal: after2.aFieldIds.length,
      aFieldMatching: after2Matching,
      bTargetBouncedToHand: bouncedHand2,
      bFieldBefore: before2.bFieldIds.length,
      bFieldAfter: after2.bFieldIds.length,
      bHandBefore: before2.bHandIds.length,
      bHandAfter: after2.bHandIds.length,
      intendedConditionResult: 'TRUE',
      observedEngineResult: fired2 ? 'TRUE' : 'FALSE',
      classification: fired2 ? 'VERIFIED' : 'INCONCLUSIVE',
      notes: fired2
        ? 'condition true; effect fired as expected'
        : 'effect skipped but printed text expects FIRE',
    });

    // ── Subcase 3: DISCRIMINATOR (1 UNRELATED-trait char + Sandersonia) ──
    await clearAField(page);
    await clearBField(page);
    await topUpADon(page, 3);
    const aUnrelated = await seedCharOnField(page, 'A', { cost: 1, power: 1000, traits: ['Land of Wano'], tag: 'unrel' });
    const bTarget3 = await seedCharOnField(page, 'B', { cost: 2, power: 3000, tag: 'tgt3' });
    void aUnrelated;
    const sand3 = await seedCardInAHand(page, corpusDef('OP07-050'));
    const before3 = await readSnap(page);
    await playFromHand(page, sand3);
    const after3 = await readSnap(page);
    const after3Matching = await readAFieldMatchingCount(page, SUSPECT_TRAITS);
    const bouncedHand3 = after3.bHandIds.includes(bTarget3);
    const fired3 = !after3.bFieldIds.includes(bTarget3);
    // Per printed: condition FALSE (only 1 matching: Sandersonia itself; Land
    // of Wano char is NOT Amazon Lily / Kuja Pirates).
    // Per current engine (suspected): condition TRUE (counts both).
    results.push({
      name: '3. DISCRIMINATOR (1 Land of Wano + Sandersonia ⇒ 2 total, 1 matching)',
      aFieldTotal: after3.aFieldIds.length,
      aFieldMatching: after3Matching,
      bTargetBouncedToHand: bouncedHand3,
      bFieldBefore: before3.bFieldIds.length,
      bFieldAfter: after3.bFieldIds.length,
      bHandBefore: before3.bHandIds.length,
      bHandAfter: after3.bHandIds.length,
      intendedConditionResult: 'FALSE',
      observedEngineResult: fired3 ? 'TRUE' : 'FALSE',
      classification: fired3 ? 'ENGINE_BUG' : 'VERIFIED',
      notes: fired3
        ? 'condition fired but only 1 matching trait char present ⇒ traitsAny/kind ignored by engine handler (conditions2.ts:210-224)'
        : 'condition correctly evaluated false; engine respects traitsAny/kind',
    });

    // ── Report ───────────────────────────────────────────────────────
    /* eslint-disable no-console */
    console.log('\n=== AUDIT: OP07-050 if_own_chars_min_filter ===');
    console.log(['subcase', 'aTotal', 'aMatch', 'bouncedToHand', 'bFieldΔ', 'bHandΔ', 'intended', 'observed', 'classification'].join('\t'));
    for (const r of results) {
      console.log([
        r.name,
        r.aFieldTotal,
        r.aFieldMatching,
        r.bTargetBouncedToHand,
        r.bFieldAfter - r.bFieldBefore,
        r.bHandAfter - r.bHandBefore,
        r.intendedConditionResult,
        r.observedEngineResult,
        r.classification,
      ].join('\t'));
      console.log('    notes:', r.notes);
    }
    const overall = results.find((r) => r.classification === 'ENGINE_BUG' || r.classification === 'CARD_DATA_BUG' || r.classification === 'HARNESS_BUG');
    console.log('\nFINAL CLASSIFICATION:', overall ? overall.classification : 'VERIFIED');
    console.log('=== END AUDIT ===\n');
    /* eslint-enable no-console */

    // Audit invariants: PASS iff data captured cleanly + no infra crash.
    expect(pageErrors, 'no pageerrors').toEqual([]);
    expect(invariantErrors, 'no InvariantErrors').toEqual([]);
    expect(results.length, 'all 3 subcases iterated').toBe(3);
    // No stuck pending in any subcase.
    const tail = await readSnap(page);
    expect(tail.pendingKind, 'no stuck pending after audit').toBeNull();
  });
});
