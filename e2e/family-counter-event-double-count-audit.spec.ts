// family-counter-event-double-count-audit — Stage B AUDIT spec.
//
// Goal: determine whether OP01 counter events that have BOTH a positive
// `counterEventBoost` field AND an on_play `power_buff` clause
// targeting `your_leader_or_character` cause the engine to apply BOTH
// to the defender, yielding effective_boost = counterEventBoost +
// clause magnitude (double-count), or whether only one source fires.
//
// Engine path (per Stage A study):
//   - playCounterReducer: pays DON, hand→trash, ADDs counterEventBoost
//     to pendingAttack.counterBoost, then dispatches on_play clauses.
//     Source: shared/engine-v2/reducers/attackFlow.ts:317-411.
//   - on_play `power_buff` writes to TARGET's `powerModifierThisBattle`
//     when duration is `this_battle`. Source:
//     shared/engine-v2/registry/handlers/actions.ts:75-103.
//   - effectivePower computed at damage resolution as:
//     baseTargetPower (= effective_power(defender) including
//     powerModifierThisBattle) + counterBoost. Source:
//     shared/engine-v2/reducers/attackFlow.ts:437-465.
//
// AUDIT semantics:
//   - Test PASSES whenever it captures the data cleanly. The
//     classification per card is the RESULT, not a pass/fail.
//   - Test FAILS only on infra/product crash: pageerror, InvariantError,
//     stuck pending, impossible state.
//
// Per directive 2026-06-06: harness-only. No engine / UI / card-data /
// scenarioFactory changes. Test runs <2 min.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { PlayerDriver } from './helpers/player';

// Load corpus card defs at module-load time so the audit reflects the
// LIVE shared/data/cards.json state. Earlier revision embedded defs
// inline; that masked any CARD_DATA patch. Now: take counterEventBoost,
// effectSpecV2 from the corpus directly.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CORPUS_PATH = resolve(__dirname, '../shared/data/cards.json');
const CORPUS_RAW = JSON.parse(readFileSync(CORPUS_PATH, 'utf-8')) as unknown;
const CORPUS = (Array.isArray(CORPUS_RAW) ? CORPUS_RAW : Object.values(CORPUS_RAW as Record<string, unknown>)) as Array<Record<string, unknown>>;
function corpusDef(id: string): Record<string, unknown> {
  const found = CORPUS.find((c) => (c as { id?: string }).id === id);
  if (!found) throw new Error(`corpus missing ${id}`);
  return found;
}

const TWO_MIN = 2 * 60_000;

test.use({
  launchOptions: {
    args: ['--disable-renderer-backgrounding', '--no-sandbox'],
  },
});

interface CardAuditSpec {
  id: string;
  name: string;
  cost: number;
  counterEventBoost: number;
  /** Printed power-boost expectation in the simplest scenario (no
   *  conditional second clauses firing). */
  printedBoost: number;
  /** Whether this card is a known suspect or the baseline control. */
  flavor: 'suspect' | 'baseline';
  /** Minimum DON to top A.donCostArea to before play so card cost is
   *  payable. Inner clauses without donCost will auto-fire; this number
   *  intentionally does NOT include inner-clause cost to preserve the
   *  audit. */
  donTopUp: number;
  /** Full card def, embedded so we don't need to touch cards.json. */
  def: Record<string, unknown>;
}

const SUSPECTS: CardAuditSpec[] = [
  { id: 'OP01-026', name: 'Gum-Gum Fire-Fist Pistol Red Hawk', cost: 2, counterEventBoost: 4000, printedBoost: 4000, flavor: 'suspect', donTopUp: 2, def: corpusDef('OP01-026') },
  // OP01-029: printedBoost=2000 because A.life=5 ⇒ conditional clause skips.
  { id: 'OP01-029', name: 'Radical Beam!!', cost: 1, counterEventBoost: 4000, printedBoost: 2000, flavor: 'suspect', donTopUp: 1, def: corpusDef('OP01-029') },
  { id: 'OP01-057', name: 'Paradise Waterfall', cost: 1, counterEventBoost: 2000, printedBoost: 2000, flavor: 'suspect', donTopUp: 1, def: corpusDef('OP01-057') },
  { id: 'OP01-058', name: 'Punk Gibson', cost: 2, counterEventBoost: 4000, printedBoost: 4000, flavor: 'suspect', donTopUp: 2, def: corpusDef('OP01-058') },
  { id: 'OP01-086', name: 'Overheat', cost: 2, counterEventBoost: 4000, printedBoost: 4000, flavor: 'suspect', donTopUp: 2, def: corpusDef('OP01-086') },
  { id: 'OP01-088', name: 'Desert Spada', cost: 1, counterEventBoost: 2000, printedBoost: 2000, flavor: 'suspect', donTopUp: 1, def: corpusDef('OP01-088') },
  { id: 'OP01-119', name: 'Thunder Bagua', cost: 2, counterEventBoost: 4000, printedBoost: 4000, flavor: 'suspect', donTopUp: 2, def: corpusDef('OP01-119') },
  { id: 'OP01-118', name: 'Ulti-Mortar', cost: 1, counterEventBoost: 2000, printedBoost: 2000, flavor: 'baseline', donTopUp: 1, def: corpusDef('OP01-118') },
];

async function bootstrap(page: Page): Promise<{ drv: PlayerDriver; pageErrors: string[]; invariantErrors: string[] }> {
  const pageErrors: string[] = [];
  const invariantErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    const t = msg.text();
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
  return { drv, pageErrors, invariantErrors };
}

// Reset transient battle state on A.leader and B field. Top up A
// donCostArea to N and clear A.hand of any stale seeded counter cards.
async function resetForNextCard(page: Page, donCount: number): Promise<void> {
  await page.evaluate((donCount) => {
    const w = window as unknown as {
      __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void };
      __getLegalActions?: (s: unknown, p: string) => unknown;
    };
    const s = w.__store!.getState().state as Record<string, unknown>;
    (s as Record<string, unknown>).phase = 'main';
    (s as Record<string, unknown>).activePlayer = 'A';
    (s as Record<string, unknown>).pending = null;
    const players = s.players as {
      A: { donDeck: string[]; donCostArea: string[]; donRested: string[]; leader: { powerModifierThisBattle?: number; powerModifierContinuous?: number } };
      B: { field: unknown[] };
    };
    // Clear leader battle modifier.
    players.A.leader.powerModifierThisBattle = undefined;
    players.A.leader.powerModifierContinuous = undefined;
    // Clear B.field of leftover seeded chars.
    players.B.field = [];
    // Move ALL of A's DON (active+rested) back into a clean pool and
    // top up to exactly donCount.
    const allDon = [
      ...players.A.donDeck,
      ...players.A.donCostArea,
      ...players.A.donRested,
    ];
    players.A.donDeck = allDon.slice(donCount);
    players.A.donCostArea = allDon.slice(0, donCount);
    players.A.donRested = [];
    w.__store!.setState({ state: { ...s, players: { ...(s.players as Record<string, unknown>), A: { ...players.A }, B: { ...players.B } } } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
  }, donCount);
  await page.waitForTimeout(150);
}

async function seedCounterInHand(page: Page, def: Record<string, unknown>): Promise<string> {
  return page.evaluate((def) => {
    const w = window as unknown as {
      __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void };
      __getLegalActions?: (s: unknown, p: string) => unknown;
    };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    lib[def['id'] as string] = def;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { hand: string[] } };
    const iid = `seedCEv_${def['id']}_${Math.floor(Math.random() * 1e9).toString(36)}`;
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
  await page.waitForTimeout(100);
}

async function dispatchAs(page: Page, action: object): Promise<void> {
  await page.evaluate((a) => {
    const w = window as unknown as { __store?: { getState: () => { dispatch: (a: unknown) => void } } };
    w.__store!.getState().dispatch(a);
  }, action);
  await page.waitForTimeout(250);
}

interface MidSnap {
  counterBoost: number;
  leaderPowerModifierThisBattle: number;
  phase: string;
  pendingKind: string | null;
}

async function readMidSnap(page: Page): Promise<MidSnap> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __store?: {
        getState: () => {
          state: {
            phase: string;
            pending: { kind?: string; pendingAttack?: { counterBoost?: number } } | null;
            players: { A: { leader: { powerModifierThisBattle?: number } } };
          };
        };
      };
    };
    const s = w.__store!.getState().state;
    return {
      counterBoost: s.pending?.pendingAttack?.counterBoost ?? 0,
      leaderPowerModifierThisBattle: s.players.A.leader.powerModifierThisBattle ?? 0,
      phase: s.phase,
      pendingKind: s.pending?.kind ?? null,
    };
  });
}

interface FinalSnap {
  aLifeAfter: number;
  phase: string;
  pendingKind: string | null;
  historyTypes: string[];
}

async function readFinalSnap(page: Page): Promise<FinalSnap> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __store?: {
        getState: () => {
          state: {
            phase: string;
            pending: { kind?: string } | null;
            players: { A: { life: string[] } };
            history: ReadonlyArray<{ type?: string }>;
          };
        };
      };
    };
    const s = w.__store!.getState().state;
    return {
      aLifeAfter: s.players.A.life.length,
      phase: s.phase,
      pendingKind: s.pending?.kind ?? null,
      historyTypes: s.history.map((h) => h.type ?? '?'),
    };
  });
}

async function readALife(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { state: { players: { A: { life: string[] } } } } } };
    return w.__store!.getState().state.players.A.life.length;
  });
}

interface AuditResult {
  id: string;
  name: string;
  printedBoost: number;
  counterEventBoost: number;
  observedCounterBoost: number;
  observedLeaderMod: number;
  totalEffectiveBoost: number;
  combatResult: 'leader_survived' | 'leader_lost_life' | 'unknown';
  classification: 'SINGLE_COUNT' | 'DOUBLE_COUNT' | 'SIDE_EFFECT_ONLY' | 'NOT_PLAYABLE_AS_COUNTER' | 'INCONCLUSIVE';
  notes: string;
}

test.describe('family-counter-event-double-count-audit (Stage B)', () => {
  test('OP01 counter events: capture counterBoost + leader.powerModifierThisBattle for each suspect', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { drv, pageErrors, invariantErrors } = await bootstrap(page);
    void drv;

    const results: AuditResult[] = [];

    for (const card of SUSPECTS) {
      await resetForNextCard(page, card.donTopUp);
      const cardIid = await seedCounterInHand(page, card.def);
      await enterCounterWindow(page);

      const lifeBefore = await readALife(page);

      // Verify legality offers PLAY_COUNTER for this card.
      const legal = await page.evaluate((iid) => {
        const w = window as unknown as { __store?: { getState: () => { state: unknown } }; __getLegalActions?: (s: unknown, p: string) => unknown[] };
        if (!w.__getLegalActions) return [];
        const s = w.__store!.getState().state;
        return (w.__getLegalActions(s, 'A') as { type: string; instanceId?: string }[])
          .filter((a) => a.type === 'PLAY_COUNTER')
          .map((a) => a.instanceId);
      }, cardIid);

      if (!legal.includes(cardIid)) {
        results.push({
          id: card.id, name: card.name,
          printedBoost: card.printedBoost, counterEventBoost: card.counterEventBoost,
          observedCounterBoost: 0, observedLeaderMod: 0, totalEffectiveBoost: 0,
          combatResult: 'unknown',
          classification: 'NOT_PLAYABLE_AS_COUNTER',
          notes: 'legality.ts:267 counterActions did not offer PLAY_COUNTER',
        });
        continue;
      }

      // Play the counter.
      await dispatchAs(page, { type: 'PLAY_COUNTER', instanceId: cardIid });

      const mid = await readMidSnap(page);
      const total = mid.counterBoost + mid.leaderPowerModifierThisBattle;

      // Resolve damage.
      await dispatchAs(page, { type: 'SKIP_COUNTER' });
      const final = await readFinalSnap(page);
      const lifeAfter = final.aLifeAfter;

      // Combat math: attacker (B leader) = 5000. Defender (A leader)
      // effective at damage = 5000 + leader.powerModifierThisBattle +
      // counterBoost. Attack succeeds iff attacker ≥ target. If
      // attacker (5000) >= target (5000 + total) ⇒ 0 ≥ total ⇒ only
      // true when total = 0. Therefore any positive boost ⇒ defender
      // survives and life unchanged.
      let combatResult: AuditResult['combatResult'];
      if (lifeAfter < lifeBefore) combatResult = 'leader_lost_life';
      else if (lifeAfter === lifeBefore) combatResult = 'leader_survived';
      else combatResult = 'unknown';

      // Classification logic.
      let classification: AuditResult['classification'];
      const notes: string[] = [];
      if (mid.counterBoost > 0 && mid.leaderPowerModifierThisBattle > 0) {
        classification = 'DOUBLE_COUNT';
        notes.push(`engine applied BOTH counterEventBoost (${mid.counterBoost}) and on_play power_buff (${mid.leaderPowerModifierThisBattle}) ⇒ effective ${total} vs printed ${card.printedBoost}`);
      } else if (mid.counterBoost > 0 && mid.leaderPowerModifierThisBattle === 0) {
        classification = 'SINGLE_COUNT';
        notes.push(`only counterEventBoost (${mid.counterBoost}) fired`);
      } else if (mid.counterBoost === 0 && mid.leaderPowerModifierThisBattle > 0) {
        classification = 'SIDE_EFFECT_ONLY';
        notes.push(`only on_play power_buff (${mid.leaderPowerModifierThisBattle}) fired — counterEventBoost not applied`);
      } else {
        classification = 'INCONCLUSIVE';
        notes.push(`no boost observed; PLAY_COUNTER may have no-op'd`);
      }

      // Sanity: combat outcome should match the captured boost.
      if (total > 0 && combatResult !== 'leader_survived') {
        notes.push(`MISMATCH: boost ${total} > 0 but leader lost life`);
      }

      results.push({
        id: card.id, name: card.name,
        printedBoost: card.printedBoost, counterEventBoost: card.counterEventBoost,
        observedCounterBoost: mid.counterBoost,
        observedLeaderMod: mid.leaderPowerModifierThisBattle,
        totalEffectiveBoost: total,
        combatResult,
        classification,
        notes: notes.join('; '),
      });
    }

    // ── Report ───────────────────────────────────────────────────────
    // eslint-disable-next-line no-console
    console.log('\n=== COUNTER-EVENT DOUBLE-COUNT AUDIT REPORT ===');
    // eslint-disable-next-line no-console
    console.log(['id', 'printed', 'cardBoost', 'obsBoost', 'leaderMod', 'totalEffective', 'combat', 'class'].join('\t'));
    for (const r of results) {
      // eslint-disable-next-line no-console
      console.log([r.id, r.printedBoost, r.counterEventBoost, r.observedCounterBoost, r.observedLeaderMod, r.totalEffectiveBoost, r.combatResult, r.classification].join('\t'));
      if (r.notes) {
        // eslint-disable-next-line no-console
        console.log('    note:', r.notes);
      }
    }
    // eslint-disable-next-line no-console
    console.log('=== END REPORT ===\n');

    // Audit invariants — test FAILS only on real infra/product crash.
    expect(pageErrors, 'no pageerrors during audit').toEqual([]);
    expect(invariantErrors, 'no InvariantErrors during audit').toEqual([]);
    expect(results.length, 'all 8 cards iterated').toBe(SUSPECTS.length);

    // Final state per card: pending was cleared by SKIP_COUNTER damage
    // resolution. (Audit captures classification; an INCONCLUSIVE
    // result is data, not a failure.) Ensure final phase is main for
    // the last card, indicating attack flow cleared cleanly.
    const tail = await readFinalSnap(page);
    expect(tail.pendingKind, 'no stuck pending after audit').toBeNull();
    expect(tail.phase, 'phase restored to main').toBe('main');
  });
});
