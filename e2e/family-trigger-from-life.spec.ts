// family-trigger-from-life — Stage A representative anchor for the
// trigger_from_life mechanic family. Verifies OP01-009 Carrot's
// life-trigger clause:
//   `[Trigger] Play this card.`
// (Encoded as trigger:'trigger', action:play_self_from_life.)
//
// Expected natural-attack flow (per source read):
//   1. B leader attacks A leader.
//   2. damage_resolution calls flipTopLifeToHand (attackFlow.ts:132-178)
//      ⇒ top of A.life shifts → A.hand.
//   3. attackFlow.ts:475-498 detects flipped card has `trigger` clause
//      and sets state.pending={kind:'trigger', pendingTrigger:{
//      lifeCardInstanceId:carrotIid, controller:'A', resumePhase:'main'}},
//      state.phase='trigger_window'.
//   4. TriggerPrompt UI mounts (src/components/TriggerPrompt.tsx).
//   5. Player dispatches RESOLVE_TRIGGER {activate:true}. Reducer at
//      choiceResolve.ts:51-61 dispatches the clause via sourceInstanceId.
//   6. playSelfFromLife handler at actions3.ts:289-318 does
//      `pl.life.indexOf(id)` — but Carrot is already in A.hand (step 2),
//      so idx=-1 ⇒ no-op.
//
// If step 6 no-ops, the printed-text behavior "play this card" fails
// to materialize in the natural attack flow: Carrot stays in A.hand
// rather than moving to A.field. The per-card unit test at
// `shared/engine-v2/__tests__/cards/OP01-009.test.ts:64-84` only tests
// the handler in isolation (Carrot pre-placed in A.life), bypassing
// flipTopLifeToHand.
//
// This Stage A test exercises the FULL natural flow to surface what
// actually happens and classifies accordingly. Expected outcomes:
//   - If Carrot ends up in A.field: ENGINE behavior matches text;
//     VERIFIED.
//   - If Carrot stays in A.hand: ENGINE_BUG (flow-vs-handler mismatch).
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
  // Normalize dice RNG variance — see helpers/player.ts::normalizeToATurn1Main.
  await drv.normalizeToATurn1Main();
  return { drv, pageErrors, invariantErrors };
}

const OP01_009_DEF = {
  id: 'OP01-009',
  name: 'Carrot',
  kind: 'character',
  colors: ['red'],
  cost: 2,
  power: 3000,
  counterValue: 1000,
  traits: ['Minks'],
  keywords: ['trigger'],
  effectTags: ['trigger'],
  effectText: '[Trigger] Play this card.',
  effectSpecV2: {
    clauses: [
      {
        trigger: 'trigger',
        action: { kind: 'play_self_from_life' },
        verified: 'human-reviewed',
      },
    ],
    continuous: [],
    replacements: [],
    schemaVersion: 2,
    verified: 'human-reviewed',
  },
};

// Inject a Carrot instance as the TOP of A.life. Replaces the existing
// top card with Carrot (the displaced card is dropped to keep life
// count at 5; the original top card's instance entry stays in
// state.instances but is no longer in any zone — engine doesn't mind
// orphaned instances).
async function placeCarrotAtTopOfALife(page: Page, def: unknown): Promise<string> {
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
    if (!lib['OP01-009']) lib['OP01-009'] = def;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { life: string[]; lifeFaceUp: Record<string, boolean> } };
    const iid = `seedCarrot_${Math.floor(Math.random() * 1e9).toString(36)}`;
    inst[iid] = {
      instanceId: iid, cardId: 'OP01-009', controller: 'A',
      rested: false, summoningSick: false,
      attachedDon: [], attachedDonRested: [],
      perTurn: { hasAttacked: false, effectsUsed: [] },
    };
    // Replace TOP of A.life with Carrot. life[0] is the top.
    const newLife = [iid, ...players.A.life.slice(1)];
    players.A.life = newLife;
    // Keep lifeFaceUp consistent (initial life cards are face-down i.e. unset).
    w.__store.setState({ state: { ...s, players: { ...(s.players as Record<string, unknown>), A: { ...players.A } } } });
    if (w.__getLegalActions) {
      const next = w.__store.getState().state as { activePlayer: string };
      w.__store.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
    return iid;
  }, def);
}

// Engineer counter_window: B leader → A leader pending attack, A reactive.
// Skipping the block_window simplifies the path (we're not testing blocker).
async function enterCounterWindow(page: Page): Promise<{ bAttackerIid: string; aLeaderIid: string }> {
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
    const players = s.players as {
      A: { leader: { instanceId: string } };
      B: { leader: { instanceId: string } };
    };
    const bAttackerIid = players.B.leader.instanceId;
    const aLeaderIid = players.A.leader.instanceId;
    (s as Record<string, unknown>).phase = 'counter_window';
    (s as Record<string, unknown>).activePlayer = 'B';
    (s as Record<string, unknown>).pending = {
      kind: 'attack',
      pendingAttack: {
        attackerInstanceId: bAttackerIid,
        targetInstanceId: aLeaderIid,
        counterBoost: 0,
      },
    };
    w.__store.setState({ state: { ...s, players: { ...players, A: { ...players.A }, B: { ...players.B } } } });
    if (w.__getLegalActions) {
      const next = w.__store.getState().state as { activePlayer: string };
      w.__store.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
    return { bAttackerIid, aLeaderIid };
  });
}

async function dispatchAs(page: Page, action: object): Promise<void> {
  await page.evaluate((a) => {
    const w = window as unknown as {
      __store?: { getState: () => { dispatch: (a: unknown) => void } };
    };
    if (!w.__store) throw new Error('window.__store not exposed');
    w.__store.getState().dispatch(a);
  }, action);
  await page.waitForTimeout(400);
}

interface Snap {
  phase: string;
  activePlayer: string;
  pendingKind: string | null;
  pendingTriggerLifeIid: string | null;
  aLife: string[];
  aHand: string[];
  aField: string[];
  aTrash: string[];
  historyTypes: string[];
}

async function readSnap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __store?: {
        getState: () => {
          state: {
            phase: string;
            activePlayer: string;
            pending: { kind?: string; pendingTrigger?: { lifeCardInstanceId?: string } } | null;
            players: {
              A: { hand: string[]; trash: string[]; life: string[]; field: { instanceId: string }[] };
            };
            history: ReadonlyArray<{ type?: string }>;
          };
        };
      };
    };
    if (!w.__store) return { phase: '', activePlayer: '', pendingKind: null, pendingTriggerLifeIid: null, aLife: [], aHand: [], aField: [], aTrash: [], historyTypes: [] };
    const s = w.__store.getState().state;
    return {
      phase: s.phase,
      activePlayer: s.activePlayer,
      pendingKind: s.pending?.kind ?? null,
      pendingTriggerLifeIid: s.pending?.pendingTrigger?.lifeCardInstanceId ?? null,
      aLife: [...s.players.A.life],
      aHand: [...s.players.A.hand],
      aField: s.players.A.field.map((i) => i.instanceId),
      aTrash: [...s.players.A.trash],
      historyTypes: s.history.map((h) => h.type ?? '?'),
    };
  });
}

async function readTriggerPromptVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    return Boolean(
      document.querySelector('[data-pending-kind="trigger"]') ??
      document.querySelector('[aria-label*="trigger" i]')
    );
  });
}

async function isOnYourField(page: Page, iid: string): Promise<boolean> {
  return page.evaluate((id) => {
    const btns = Array.from(document.querySelectorAll(`button[data-instance-id="${id}"]`));
    for (const b of btns) {
      let el: Element | null = b.parentElement;
      let inField = false;
      let inYourHalf = false;
      let depth = 0;
      while (el && depth < 20) {
        const label = el.getAttribute('aria-label') ?? '';
        if (label.startsWith('Character area')) inField = true;
        if (label === 'Your half') inYourHalf = true;
        el = el.parentElement;
        depth += 1;
      }
      if (inField && inYourHalf) return true;
    }
    return false;
  }, iid);
}

test.describe('family-trigger-from-life (Stage A)', () => {
  test('OP01-009 Carrot [Trigger]: B attacks A leader → flip life → trigger_window → RESOLVE_TRIGGER activates Carrot', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { drv, pageErrors, invariantErrors } = await bootstrap(page);
    void drv;

    // Place Carrot as top of A.life.
    const carrotIid = await placeCarrotAtTopOfALife(page, OP01_009_DEF);

    // Engineer counter_window with B leader → A leader.
    const { bAttackerIid, aLeaderIid } = await enterCounterWindow(page);
    void bAttackerIid;
    void aLeaderIid;

    // ── BEFORE damage ───────────────────────────────────────────────
    const before = await readSnap(page);
    expect(before.phase, 'phase=counter_window').toBe('counter_window');
    expect(before.activePlayer, 'B is attacker').toBe('B');
    expect(before.pendingKind, 'attack pending').toBe('attack');
    expect(before.aLife.length, 'A life count = 5 (default)').toBe(5);
    expect(before.aLife[0], 'Carrot at top of A life').toBe(carrotIid);
    expect(before.aField, 'Carrot NOT on A field before').not.toContain(carrotIid);
    expect(before.aHand, 'Carrot NOT in A hand before').not.toContain(carrotIid);
    const aHandBeforeLen = before.aHand.length;
    const aFieldBeforeLen = before.aField.length;

    // ── Skip counter → damage resolves on A leader ─────────────────
    await dispatchAs(page, { type: 'SKIP_COUNTER' });

    // ── DURING TRIGGER (post-damage) ────────────────────────────────
    const duringTrigger = await readSnap(page);
    // Engine: damage flipped A's top life. flipTopLifeToHand at
    // attackFlow.ts:160 moved Carrot to A.hand. Then attackFlow.ts:484
    // set pending=trigger, phase=trigger_window.
    expect(duringTrigger.phase, 'phase=trigger_window after life flip').toBe('trigger_window');
    expect(duringTrigger.pendingKind, 'pending kind=trigger').toBe('trigger');
    expect(duringTrigger.pendingTriggerLifeIid, 'pending.pendingTrigger.lifeCardInstanceId=carrot iid').toBe(carrotIid);
    expect(duringTrigger.aLife.length, 'A life -1').toBe(4);
    expect(duringTrigger.aLife, 'Carrot no longer in A life').not.toContain(carrotIid);
    // Note: per flipTopLifeToHand source, Carrot is now in A.hand.
    expect(duringTrigger.aHand, 'Carrot now in A hand (flipped)').toContain(carrotIid);
    expect(duringTrigger.historyTypes, 'LIFE_CARD_TO_HAND history').toContain('LIFE_CARD_TO_HAND');

    // UI: TriggerPrompt should be mounted.
    await expect.poll(
      async () => readTriggerPromptVisible(page),
      { timeout: 5_000, message: 'TriggerPrompt visible during trigger_window' },
    ).toBe(true);

    // ── Activate trigger ────────────────────────────────────────────
    // store/game.ts dispatch wrapper now routes trigger_window actions
    // through pendingTrigger.controller (post-fix), mirroring the AI
    // auto-pump route at game.ts:575-583. No harness activePlayer flip
    // needed.
    await dispatchAs(page, { type: 'RESOLVE_TRIGGER', activate: true, targetInstanceId: null });

    // ── AFTER trigger resolves ──────────────────────────────────────
    const after = await readSnap(page);

    // Engine: trigger resolution should restore phase/pending.
    expect(after.pendingKind, 'pending cleared after RESOLVE_TRIGGER').toBeNull();
    expect(after.phase, 'phase resumed to main').toBe('main');
    expect(after.historyTypes, 'TRIGGER_RESOLVED in history').toContain('TRIGGER_RESOLVED');

    // Card-data printed text: "[Trigger] Play this card." Engine expected
    // behavior: Carrot moves to A.field for free.
    //
    // CR-NATURAL-FLOW caveat: playSelfFromLife handler at actions3.ts:289
    // calls `pl.life.indexOf(id)`. flipTopLifeToHand already moved
    // Carrot to hand, so the lookup fails. If this materializes,
    // Carrot stays in A.hand and A.field is unchanged ⇒ ENGINE_BUG.
    //
    // Assert printed-text-intended behavior. If FAIL, classify the
    // outcome per actual observed state.
    expect(after.aField, 'Carrot now on A field (printed text)').toContain(carrotIid);
    expect(after.aField.length, 'A field +1').toBe(aFieldBeforeLen + 1);
    expect(after.aHand, 'Carrot not in A hand after trigger plays it').not.toContain(carrotIid);
    expect(after.aHand.length, 'A hand back to pre-flip count (Carrot played out)').toBe(aHandBeforeLen);

    // UI: Carrot visible in Your half / Character area.
    await expect.poll(
      async () => isOnYourField(page, carrotIid),
      { timeout: 5_000, message: 'Carrot visible on Your field after trigger' },
    ).toBe(true);

    // UI: TriggerPrompt dismissed.
    await expect.poll(
      async () => readTriggerPromptVisible(page),
      { timeout: 5_000, message: 'TriggerPrompt dismissed after RESOLVE_TRIGGER' },
    ).toBe(false);

    // ── Stability ────────────────────────────────────────────────────
    expect(pageErrors, 'no pageerrors').toEqual([]);
    expect(invariantErrors, 'no InvariantErrors').toEqual([]);
  });
});
