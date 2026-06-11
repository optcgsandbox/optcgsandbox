// family-power-reduction — Stage A representative anchor for the
// power_reduction mechanic family. Verifies that OP01-006 Otama's
// on-play effect
//   `[On Play] Give up to 1 of your opponent's Characters −2000 power
//    during this turn.`
// is reflected in BOTH engine state and the visible UI, and that the
// `this_turn` duration clears at end-of-turn.
//
// Engine path:
//   - duration:'this_turn' writes `powerModifierOneShot` on the target.
//     Source: shared/engine-v2/registry/handlers/actions.ts:76-103.
//   - At endTurn the scheduler ticks expiresInTurns and clears the
//     OneShot when it reaches 0. Source:
//     shared/engine-v2/phases/PhaseScheduler.ts:253-261.
//   - target.kind:'opp_character' deterministically picks the first
//     eligible opp char (no UI prompt). Source:
//     shared/engine-v2/registry/handlers/targets.ts:87-92.
//
// UI path:
//   - CardArt now displays `effectivePowerForDisplay` (post STEP 1 fix),
//     so the aria-label `power N` is the engine-truth value.
//
// Per directive 2026-06-06: harness-only. No engine / UI / card-data /
// scenarioFactory changes. Test runs <2 min.

import { test, expect, type Page } from '@playwright/test';
import { PlayerDriver } from './helpers/player';

const TWO_MIN = 2 * 60_000;

test.use({
  launchOptions: {
    args: ['--disable-renderer-backgrounding', '--no-sandbox'],
  },
});

interface Bootstrap {
  drv: PlayerDriver;
  pageErrors: string[];
  invariantErrors: string[];
}

async function bootstrap(page: Page): Promise<Bootstrap> {
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
    { timeout: 60_000, message: 'A did not reach main' },
  ).toMatchObject({ phase: 'main', activePlayer: 'A' });
  return { drv, pageErrors, invariantErrors };
}

// Seed one A character on field with given power. Mirrors helper used
// in family-power-boost.spec.ts.
async function seedOwnFieldChar(page: Page, power: number): Promise<string> {
  return page.evaluate((power) => {
    const w = window as unknown as {
      __store?: {
        getState: () => { state: unknown };
        setState: (p: { state: unknown } | { legalActions: unknown }) => void;
      };
      __getLegalActions?: (s: unknown, p: string) => unknown;
    };
    if (!w.__store) throw new Error('window.__store not exposed');
    const s = w.__store.getState().state as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { field: unknown[] } };
    const synthId = `__seed_pr_a_${Math.floor(Math.random() * 1e9).toString(36)}`;
    const iid = `seedPRa_${Math.floor(Math.random() * 1e9).toString(36)}`;
    lib[synthId] = {
      id: synthId, name: 'PR Char A', kind: 'character',
      cost: 1, power, counterValue: 1000,
      colors: ['red','green','blue','purple','black','yellow'],
      traits: [], keywords: [],
      effectText: '',
    };
    inst[iid] = {
      instanceId: iid, cardId: synthId, controller: 'A',
      rested: false, summoningSick: false,
      attachedDon: [], attachedDonRested: [],
      perTurn: { hasAttacked: false, effectsUsed: [] },
    };
    players.A.field = [...players.A.field, inst[iid]];
    w.__store.setState({ state: { ...s } });
    if (w.__getLegalActions) {
      const next = w.__store.getState().state as { activePlayer: string };
      w.__store.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
    return iid;
  }, power);
}

// Seed one B character on field with given power and stable name tag.
async function seedOppFieldChar(page: Page, power: number, tag: string): Promise<string> {
  return page.evaluate(({ power, tag }) => {
    const w = window as unknown as {
      __store?: {
        getState: () => { state: unknown };
        setState: (p: { state: unknown } | { legalActions: unknown }) => void;
      };
      __getLegalActions?: (s: unknown, p: string) => unknown;
    };
    if (!w.__store) throw new Error('window.__store not exposed');
    const s = w.__store.getState().state as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { B: { field: unknown[] } };
    const synthId = `__seed_pr_b_${tag}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    const iid = `seedPRb_${tag}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    lib[synthId] = {
      id: synthId, name: `PR Char B ${tag}`, kind: 'character',
      cost: 1, power, counterValue: 1000,
      colors: ['red','green','blue','purple','black','yellow'],
      traits: [], keywords: [],
      effectText: '',
    };
    inst[iid] = {
      instanceId: iid, cardId: synthId, controller: 'B',
      rested: false, summoningSick: false,
      attachedDon: [], attachedDonRested: [],
      perTurn: { hasAttacked: false, effectsUsed: [] },
    };
    players.B.field = [...players.B.field, inst[iid]];
    w.__store.setState({ state: { ...s } });
    if (w.__getLegalActions) {
      const next = w.__store.getState().state as { activePlayer: string };
      w.__store.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
    return iid;
  }, { power, tag });
}

// Force the real OP01-006 Otama card into A's hand as a new instance.
// Uses the actual card definition from cardLibrary (loaded by engine on
// boot) so on_play resolves through the live registry.
async function seedOtamaInHand(page: Page): Promise<string> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __store?: {
        getState: () => { state: unknown };
        setState: (p: { state: unknown } | { legalActions: unknown }) => void;
      };
      __getLegalActions?: (s: unknown, p: string) => unknown;
    };
    if (!w.__store) throw new Error('window.__store not exposed');
    const s = w.__store.getState().state as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    if (!lib['OP01-006']) throw new Error('OP01-006 not in cardLibrary');
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { hand: string[] } };
    const iid = `seedOtama_${Math.floor(Math.random() * 1e9).toString(36)}`;
    inst[iid] = {
      instanceId: iid, cardId: 'OP01-006', controller: 'A',
      rested: false, summoningSick: false,
      attachedDon: [], attachedDonRested: [],
      perTurn: { hasAttacked: false, effectsUsed: [] },
    };
    players.A.hand = [...players.A.hand, iid];
    w.__store.setState({ state: { ...s } });
    if (w.__getLegalActions) {
      const next = w.__store.getState().state as { activePlayer: string };
      w.__store.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
    return iid;
  });
}

// Dispatch PLAY_CARD for the given instance id (Otama). This is a real
// engine action — routes through applyAction so on_play fires.
async function playFromHand(page: Page, iid: string): Promise<void> {
  await page.evaluate((id) => {
    const w = window as unknown as {
      __store?: {
        getState: () => { dispatch: (a: unknown) => void };
      };
    };
    if (!w.__store) throw new Error('window.__store not exposed');
    w.__store.getState().dispatch({ type: 'PLAY_CARD', instanceId: id, replaceTargetId: null });
  }, iid);
  await page.waitForTimeout(250);
}

// Engine-truth power: reconstructs effectivePowerForDisplay's formula
// from the live store. Source: shared/engine-v2/state/derived/power.ts.
async function readEnginePower(page: Page, iid: string): Promise<number | null> {
  return page.evaluate((id) => {
    const w = window as unknown as {
      __store?: { getState: () => { state: Record<string, unknown> } };
    };
    if (!w.__store) return null;
    const s = w.__store.getState().state;
    const instances = s.instances as Record<string, unknown> | undefined;
    const lib = s.cardLibrary as Record<string, unknown> | undefined;
    if (!instances || !lib) return null;
    const inst = instances[id] as Record<string, unknown> | undefined;
    if (!inst) return null;
    const cardId = inst.cardId as string;
    const card = lib[cardId] as Record<string, unknown> | undefined;
    if (!card) return null;
    const kind = card.kind as string;
    const printed = (kind === 'character' || kind === 'leader')
      ? ((card.power as number) ?? 0) : 0;
    const base = (inst.basePowerOverrideOneShot as number | null | undefined)
      ?? (inst.basePowerOverrideContinuous as number | null | undefined)
      ?? printed;
    const ad = inst.attachedDon as unknown[] ?? [];
    const adr = inst.attachedDonRested as unknown[] ?? [];
    const donCount = (ad.length + adr.length);
    const raw = base
      + donCount * 1000
      + ((inst.powerModifierOneShot as number | undefined) ?? 0)
      + ((inst.powerModifierContinuous as number | undefined) ?? 0)
      + ((inst.powerModifierThisBattle as number | undefined) ?? 0);
    return Math.max(0, raw);
  }, iid);
}

// UI-truth power: reads aria-label `power N` from the CardArt button.
async function readDomPower(page: Page, iid: string): Promise<number | null> {
  return page.evaluate((id) => {
    const btn = document.querySelector(`button[data-instance-id="${id}"]`);
    if (!btn) return null;
    const label = btn.getAttribute('aria-label') ?? '';
    const m = label.match(/power\s+(-?\d+)/i);
    return m ? parseInt(m[1]!, 10) : null;
  }, iid);
}

async function readStability(page: Page): Promise<{
  phase: string;
  activePlayer: string;
  pendingKind: string | null;
  leaderId: string | null;
  turn: number;
}> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __store?: {
        getState: () => {
          state: {
            phase: string;
            activePlayer: string;
            pending: { kind?: string } | null;
            players: { A: { leader: { cardId: string } } };
            turn: number;
          };
        };
      };
    };
    if (!w.__store) {
      return { phase: '', activePlayer: '', pendingKind: null, leaderId: null, turn: -1 };
    }
    const s = w.__store.getState().state;
    return {
      phase: s.phase,
      activePlayer: s.activePlayer,
      pendingKind: s.pending?.kind ?? null,
      leaderId: s.players.A.leader.cardId ?? null,
      turn: s.turn,
    };
  });
}

test.describe('family-power-reduction (Stage A)', () => {
  test('OP01-006 Otama on_play: -2000 to one opp char this_turn; restores at end_of_turn', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { drv, pageErrors, invariantErrors } = await bootstrap(page);

    // ── Precondition ─────────────────────────────────────────────────
    const pre = await readStability(page);
    expect(pre.phase, 'phase=main').toBe('main');
    expect(pre.activePlayer, 'A turn').toBe('A');
    expect(pre.pendingKind, 'no pending').toBeNull();

    // ── Seed scene ───────────────────────────────────────────────────
    const aCharIid = await seedOwnFieldChar(page, 1000);
    const b1Iid = await seedOppFieldChar(page, 3000, 'first');
    const b2Iid = await seedOppFieldChar(page, 3000, 'second');
    const otamaIid = await seedOtamaInHand(page);

    // Confirm DON sufficient. Otama cost=1; A starts T1 with 1 DON.
    const beforePlay = await drv.getState();
    expect(beforePlay.A.donCost, 'A has ≥1 active DON for Otama cost=1').toBeGreaterThanOrEqual(1);

    // ── BEFORE Otama ────────────────────────────────────────────────
    const aBefEng = await readEnginePower(page, aCharIid);
    const b1BefEng = await readEnginePower(page, b1Iid);
    const b2BefEng = await readEnginePower(page, b2Iid);
    const aBefDom = await readDomPower(page, aCharIid);
    const b1BefDom = await readDomPower(page, b1Iid);
    const b2BefDom = await readDomPower(page, b2Iid);
    expect(aBefEng, 'A char engine power=1000 before').toBe(1000);
    expect(b1BefEng, 'B1 engine power=3000 before').toBe(3000);
    expect(b2BefEng, 'B2 engine power=3000 before').toBe(3000);
    expect(aBefDom, 'A char DOM power=1000 before').toBe(1000);
    expect(b1BefDom, 'B1 DOM power=3000 before').toBe(3000);
    expect(b2BefDom, 'B2 DOM power=3000 before').toBe(3000);

    // ── Play Otama (real PLAY_CARD action via store) ────────────────
    await playFromHand(page, otamaIid);

    // ── AFTER Otama (still A's turn) ────────────────────────────────
    const aAftEng = await readEnginePower(page, aCharIid);
    const b1AftEng = await readEnginePower(page, b1Iid);
    const b2AftEng = await readEnginePower(page, b2Iid);
    const aAftDom = await readDomPower(page, aCharIid);
    const b1AftDom = await readDomPower(page, b1Iid);
    const b2AftDom = await readDomPower(page, b2Iid);

    // The engine `opp_character` resolver deterministically picks the
    // first eligible B char (B field index 0 = b1).
    expect(b1AftEng, 'B1 engine power = 3000 - 2000 = 1000 after Otama').toBe(1000);
    expect(b1AftDom, 'B1 DOM power = 1000 after Otama').toBe(1000);
    expect(b1AftDom, 'B1 DOM/engine parity after').toBe(b1AftEng);

    // Scope filter: only one B char buffed; other B char unchanged;
    // A char unchanged.
    expect(b2AftEng, 'B2 engine power unchanged (3000)').toBe(3000);
    expect(b2AftDom, 'B2 DOM power unchanged (3000)').toBe(3000);
    expect(aAftEng, 'A char engine power unchanged (1000)').toBe(1000);
    expect(aAftDom, 'A char DOM power unchanged (1000)').toBe(1000);

    // Pending must clear after on_play resolves with deterministic target.
    const midState = await readStability(page);
    expect(midState.pendingKind, 'no stuck pending after on_play').toBeNull();
    expect(midState.phase, 'phase still main after on_play').toBe('main');
    expect(midState.activePlayer, 'still A turn after on_play').toBe('A');

    // ── End A's turn → end_of_turn tick clears this_turn modifiers ──
    // PhaseScheduler enterEndOfTurn ticks expiresInTurns; expires=0
    // clears powerModifierOneShot. After cycle resumes A's next turn,
    // b1 power should be restored.
    const turnBefore = midState.turn;
    await drv.endTurn();

    // Wait until either (a) activePlayer became B (cycle started) or
    // (b) turn number incremented to A again.
    await expect.poll(
      async () => {
        const s = await readStability(page);
        if (s.activePlayer === 'B') return 'B';
        if (s.turn > turnBefore) return 'cycledBackToA';
        return s.activePlayer + '/' + s.turn;
      },
      { timeout: 30_000 },
    ).toMatch(/^B$|^cycledBackToA$/);

    // Read B1 power again. The end-of-turn tick fired when A's turn
    // ended; b1 powerModifierOneShot should now be cleared regardless
    // of whose turn it is.
    const b1AfterExpEng = await readEnginePower(page, b1Iid);
    const b1AfterExpDom = await readDomPower(page, b1Iid);
    expect(b1AfterExpEng, 'B1 engine power restored to 3000 after end_of_turn').toBe(3000);
    expect(b1AfterExpDom, 'B1 DOM power restored to 3000 after end_of_turn').toBe(3000);

    // ── Final stability ────────────────────────────────────────────
    expect(pageErrors, 'no pageerrors').toEqual([]);
    expect(invariantErrors, 'no InvariantErrors').toEqual([]);
  });
});
