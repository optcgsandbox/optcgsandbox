// family-leader-gated — Stage A representative anchor for the
// leader-gated effects mechanic family. Verifies OP01-089 Crescent
// Cutlass's leader-gated clause:
//   `[Counter] If your Leader has the {The Seven Warlords of the Sea}
//    type, return up to 1 Character with a cost of 5 or less to the
//    owner's hand.`
// (Encoded as `on_play` w/ condition `if_leader_has_trait` + action
// `removal_bounce` target `opp_character {costMax:5}`.)
//
// Two subcases in one test:
//   1. WRONG leader (default A leader Zoro, traits ['Supernovas',
//      'Straw Hat Crew']): condition returns false ⇒ gated clause
//      SKIPS. B.field target unchanged.
//   2. MATCHING leader (mutate A's leader cardLibrary entry to inject
//      'The Seven Warlords of the Sea' trait): condition returns true
//      ⇒ gated clause FIRES. B.field target bounced to B.hand.
//
// Engine sources:
//   - ifLeaderHasTrait reads leader card from cardLibrary by
//     ctx.controller's leader.cardId. Source:
//     shared/engine-v2/registry/handlers/conditions.ts:55-58.
//   - Dispatcher skips clause via `continue` when canPay false /
//     condition false. Source:
//     shared/engine-v2/effects/EffectDispatcher.ts:189-219.
//   - removal_bounce: field→owner.hand. Source:
//     shared/engine-v2/registry/handlers/actions.ts:211-247.
//   - Event play path: pay DON, hand→A.trash, fire on_play. Source:
//     shared/engine-v2/reducers/mainPhase.ts:125-160.
//   - Color identity bypass via dispatch path; gate only enforced at
//     legality.ts:178 (main-phase getLegalActions). Cutlass is blue vs
//     red leader; dispatch plays cleanly. Same pattern as
//     family-bounce / discard / counter-event / cost-reduction.
//
// Audit note on anchor: cards.json spec is `verified:'flagged'` with
// auditNote about target=opp_character vs text "Character (any side)".
// Engine contract is the encoded spec; not classified here.
//
// Per directive 2026-06-06: harness-only. No engine / UI / card-data
// (file) / scenarioFactory changes. The leader-trait mutation is a
// test-only runtime mutation of state.cardLibrary in-browser. Test
// runs <2 min.

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

const OP01_089_DEF = {
  id: 'OP01-089',
  name: 'Crescent Cutlass',
  kind: 'event',
  colors: ['blue'],
  cost: 3,
  power: null,
  counterValue: null,
  traits: ['The Seven Warlords of the Sea', 'Baroque Works'],
  keywords: [],
  effectTags: ['counter_event', 'removal_bounce'],
  effectText: '[Counter] If your Leader has the {The Seven Warlords of the Sea} type, return up to 1 Character with a cost of 5 or less to the owner\'s hand.',
  counterEventBoost: null,
  effectSpecV2: {
    clauses: [
      {
        trigger: 'on_play',
        condition: { type: 'if_leader_has_trait', trait: 'The Seven Warlords of the Sea' },
        action: { kind: 'removal_bounce' },
        target: { kind: 'opp_character', filter: { costMax: 5 } },
        verified: 'auto',
      },
    ],
    continuous: [],
    replacements: [],
    schemaVersion: 2,
    verified: 'flagged',
  },
};

async function seedCutlassInHand(page: Page, def: unknown): Promise<string> {
  return page.evaluate((def) => {
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
    if (!lib['OP01-089']) lib['OP01-089'] = def;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { hand: string[] } };
    const iid = `seedCutlass_${Math.floor(Math.random() * 1e9).toString(36)}`;
    inst[iid] = {
      instanceId: iid, cardId: 'OP01-089', controller: 'A',
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
  }, def);
}

async function seedOppFieldChar(page: Page, cost: number, tag: string): Promise<string> {
  return page.evaluate(({ cost, tag }) => {
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
    const synthId = `__seed_lg_b_${tag}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    const iid = `seedLGb_${tag}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    lib[synthId] = {
      id: synthId, name: `LG B ${tag}`, kind: 'character',
      cost, power: 3000, counterValue: 1000,
      colors: ['red'],
      traits: [],
      keywords: [],
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
  }, { cost, tag });
}

async function topUpADon(page: Page, target: number): Promise<void> {
  await page.evaluate((target) => {
    const w = window as unknown as {
      __store?: {
        getState: () => { state: unknown };
        setState: (p: { state: unknown } | { legalActions: unknown }) => void;
      };
      __getLegalActions?: (s: unknown, p: string) => unknown;
    };
    if (!w.__store) throw new Error('window.__store not exposed');
    const s = w.__store.getState().state as Record<string, unknown>;
    const players = s.players as { A: { donDeck: string[]; donCostArea: string[] } };
    const newDeck = [...players.A.donDeck];
    const newCost = [...players.A.donCostArea];
    while (newCost.length < target && newDeck.length > 0) {
      const id = newDeck.shift();
      if (id !== undefined) newCost.push(id);
    }
    players.A.donDeck = newDeck;
    players.A.donCostArea = newCost;
    w.__store.setState({ state: { ...s, players: { ...(s.players as Record<string, unknown>), A: { ...players.A } } } });
    if (w.__getLegalActions) {
      const next = w.__store.getState().state as { activePlayer: string };
      w.__store.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
  }, target);
  await page.waitForTimeout(150);
}

// Test-only runtime mutation: inject a trait into A's leader card def
// in cardLibrary. Does not touch the file system. Engine conditions
// re-evaluate against the live cardLibrary entry.
async function injectLeaderTrait(page: Page, trait: string): Promise<{ leaderId: string; preTraits: string[] }> {
  return page.evaluate((trait) => {
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
    const players = s.players as { A: { leader: { cardId: string } } };
    const leaderId = players.A.leader.cardId;
    const card = lib[leaderId] as Record<string, unknown>;
    const preTraits = Array.isArray(card.traits) ? [...(card.traits as string[])] : [];
    if (!preTraits.includes(trait)) {
      card.traits = [...preTraits, trait];
    }
    w.__store.setState({ state: { ...s } });
    if (w.__getLegalActions) {
      const next = w.__store.getState().state as { activePlayer: string };
      w.__store.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
    return { leaderId, preTraits };
  }, trait);
}

async function playFromHand(page: Page, iid: string): Promise<void> {
  await page.evaluate((id) => {
    const w = window as unknown as {
      __store?: { getState: () => { dispatch: (a: unknown) => void } };
    };
    if (!w.__store) throw new Error('window.__store not exposed');
    w.__store.getState().dispatch({ type: 'PLAY_CARD', instanceId: id, replaceTargetId: null });
  }, iid);
  await page.waitForTimeout(900);
}

interface Snap {
  phase: string;
  activePlayer: string;
  pendingKind: string | null;
  bFieldIds: string[];
  bHandIds: string[];
  bTrashIds: string[];
  aHandIds: string[];
  aTrashIds: string[];
  aLeaderTraits: string[];
}

async function readSnap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __store?: {
        getState: () => {
          state: {
            phase: string;
            activePlayer: string;
            pending: { kind?: string } | null;
            players: {
              A: { hand: string[]; trash: string[]; leader: { cardId: string } };
              B: { hand: string[]; trash: string[]; field: { instanceId: string }[] };
            };
            cardLibrary: Record<string, { traits?: ReadonlyArray<string> }>;
          };
        };
      };
    };
    if (!w.__store) return { phase: '', activePlayer: '', pendingKind: null, bFieldIds: [], bHandIds: [], bTrashIds: [], aHandIds: [], aTrashIds: [], aLeaderTraits: [] };
    const s = w.__store.getState().state;
    const aLeaderCard = s.cardLibrary[s.players.A.leader.cardId];
    return {
      phase: s.phase,
      activePlayer: s.activePlayer,
      pendingKind: s.pending?.kind ?? null,
      bFieldIds: s.players.B.field.map((i) => i.instanceId),
      bHandIds: [...s.players.B.hand],
      bTrashIds: [...s.players.B.trash],
      aHandIds: [...s.players.A.hand],
      aTrashIds: [...s.players.A.trash],
      aLeaderTraits: [...(aLeaderCard?.traits ?? [])],
    };
  });
}

test.describe('family-leader-gated (Stage A)', () => {
  test('OP01-089 Cutlass: gated clause SKIPS under wrong leader; FIRES under matching leader', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { drv, pageErrors, invariantErrors } = await bootstrap(page);
    void drv;

    // ── SUBCASE A: WRONG LEADER (default Zoro, no Warlords trait) ──
    {
      // Verify default leader traits do NOT include the gate.
      const pre0 = await readSnap(page);
      expect(pre0.aLeaderTraits, 'default A leader (Zoro) lacks Warlords trait').not.toContain('The Seven Warlords of the Sea');

      // Seed B target (eligible cost ≤ 5) + Cutlass + DON.
      const bTargetA = await seedOppFieldChar(page, 4, 'wrongA');
      const cutlassA = await seedCutlassInHand(page, OP01_089_DEF);
      await topUpADon(page, 3); // Cutlass cost 3

      const before = await readSnap(page);
      expect(before.bFieldIds, 'B target on field before').toContain(bTargetA);
      expect(before.aHandIds, 'Cutlass in A hand before').toContain(cutlassA);
      const bFieldBeforeLen = before.bFieldIds.length;
      const bHandBeforeLen = before.bHandIds.length;
      const aTrashBeforeLen = before.aTrashIds.length;

      // Play Cutlass.
      await playFromHand(page, cutlassA);

      const after = await readSnap(page);

      // Event resolution still happens (card hand→trash, cost paid).
      expect(after.aHandIds, 'Cutlass left A hand').not.toContain(cutlassA);
      expect(after.aTrashIds, 'Cutlass in A trash (event resolution)').toContain(cutlassA);
      expect(after.aTrashIds.length, 'A trash +1 (Cutlass)').toBe(aTrashBeforeLen + 1);

      // GATED clause SKIPPED — B target NOT bounced.
      expect(after.bFieldIds, 'B target STILL on field (gate failed)').toContain(bTargetA);
      expect(after.bFieldIds.length, 'B field unchanged').toBe(bFieldBeforeLen);
      expect(after.bHandIds, 'B target NOT in B hand').not.toContain(bTargetA);
      expect(after.bHandIds.length, 'B hand unchanged').toBe(bHandBeforeLen);

      // Stability.
      expect(after.pendingKind, 'no stuck pending').toBeNull();
      expect(after.phase, 'phase main').toBe('main');
      expect(after.activePlayer, 'A turn').toBe('A');
    }

    // ── SUBCASE B: MATCHING LEADER (inject Warlords trait into Zoro) ─
    {
      const inj = await injectLeaderTrait(page, 'The Seven Warlords of the Sea');
      expect(inj.preTraits.includes('The Seven Warlords of the Sea'), 'pre-mutation leader lacked trait').toBe(false);

      // Verify mutation applied.
      const post0 = await readSnap(page);
      expect(post0.aLeaderTraits, 'leader now has Warlords trait').toContain('The Seven Warlords of the Sea');

      // Clear B.field so the resolver picks ONLY the new target. The
      // opp_character resolver returns the first eligible (V0
      // deterministic); without clearing, subcase A's leftover target
      // would still be at B.field[0] and get bounced instead.
      await page.evaluate(() => {
        const w = window as unknown as {
          __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void };
          __getLegalActions?: (s: unknown, p: string) => unknown;
        };
        const s = w.__store!.getState().state as Record<string, unknown>;
        const players = s.players as { B: { field: unknown[] } };
        players.B.field = [];
        w.__store!.setState({ state: { ...s, players: { ...(s.players as Record<string, unknown>), B: { ...players.B } } } });
        if (w.__getLegalActions) {
          const next = w.__store!.getState().state as { activePlayer: string };
          w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
        }
      });

      // Fresh seeds: new B target + new Cutlass + replenish DON.
      const bTargetB = await seedOppFieldChar(page, 4, 'matchB');
      const cutlassB = await seedCutlassInHand(page, OP01_089_DEF);
      await topUpADon(page, 3);

      const before = await readSnap(page);
      expect(before.bFieldIds, 'B target B on field before').toContain(bTargetB);
      expect(before.aHandIds, 'Cutlass B in A hand before').toContain(cutlassB);
      const bFieldBeforeLen = before.bFieldIds.length;
      const bHandBeforeLen = before.bHandIds.length;
      const aTrashBeforeLen = before.aTrashIds.length;

      // Play Cutlass.
      await playFromHand(page, cutlassB);

      const after = await readSnap(page);

      // Event resolution.
      expect(after.aHandIds, 'Cutlass left A hand').not.toContain(cutlassB);
      expect(after.aTrashIds, 'Cutlass in A trash').toContain(cutlassB);
      expect(after.aTrashIds.length, 'A trash +1').toBe(aTrashBeforeLen + 1);

      // GATED clause FIRES — B target bounced to B hand.
      expect(after.bFieldIds, 'B target removed from field').not.toContain(bTargetB);
      expect(after.bFieldIds.length, 'B field -1').toBe(bFieldBeforeLen - 1);
      expect(after.bHandIds, 'B target now in B hand').toContain(bTargetB);
      expect(after.bHandIds.length, 'B hand +1').toBe(bHandBeforeLen + 1);

      // Stability.
      expect(after.pendingKind, 'no stuck pending').toBeNull();
      expect(after.phase, 'phase main').toBe('main');
      expect(after.activePlayer, 'A turn').toBe('A');
    }

    // ── Stability ────────────────────────────────────────────────────
    expect(pageErrors, 'no pageerrors').toEqual([]);
    expect(invariantErrors, 'no InvariantErrors').toEqual([]);
  });
});
