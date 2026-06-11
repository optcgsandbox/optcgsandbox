// stage-b-trigger-from-life — Stage B expansion verifying the Bug 1 +
// Bug 2 trigger_from_life fixes generalize across the corpus.
//
// Corpus pre-check (live read from shared/data/cards.json):
//   - `play_self_from_life` action: ONE corpus member — OP01-009
//     Carrot (already verified Stage A).
//   - Broader `trigger:'trigger'` clause coverage: 3 cards total —
//     OP01-009, OP05-109 Pagaya, OP13-106 Conney. Pagaya + Conney's
//     `trigger:'trigger'` encoding does NOT mean "this card's [Trigger]
//     ability when flipped from life" in the printed-text sense — both
//     are encoded with action handlers that mutate engine state when
//     RESOLVE_TRIGGER fires. Their printed text describes REACTIVE
//     abilities to OTHER triggers activating ("When a [Trigger]
//     activates …"), which is not wired in V0. Cards are
//     `verified:'flagged'` in spec.
//
// Engine sources (Stage A fixes):
//   - Bug 1 fix: shared/engine-v2/registry/handlers/actions3.ts:281-329
//     — playSelfFromLife now looks up source in pl.hand FIRST, then
//     falls back to pl.life. This only affects the play_self_from_life
//     action; Pagaya (draw) + Conney (give_keyword) action handlers are
//     unaffected by Bug 1.
//   - Bug 2 fix: src/store/game.ts:478-491 — dispatch wrapper routes
//     trigger_window actions through pendingTrigger.controller. This
//     applies to ANY card in the trigger family.
//
// Stage B scope: test all 3 corpus cards with a `trigger:'trigger'`
// clause via the natural attack flow to verify Bug 2 routing fix
// generalizes AND surface any behavioral notes for the flagged cards.

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

// Place the given card def as TOP of A.life.
async function placeCardAtTopOfALife(page: Page, def: Record<string, unknown>): Promise<string> {
  return page.evaluate((def) => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const lib = s.cardLibrary as Record<string, unknown>;
    lib[def['id'] as string] = def;
    const inst = s.instances as Record<string, unknown>;
    const players = s.players as { A: { life: string[] } };
    const iid = `seedTrigLife_${def['id']}_${Math.floor(Math.random() * 1e9).toString(36)}`;
    inst[iid] = {
      instanceId: iid, cardId: def['id'], controller: 'A',
      rested: false, summoningSick: false,
      attachedDon: [], attachedDonRested: [],
      perTurn: { hasAttacked: false, effectsUsed: [] },
    };
    players.A.life = [iid, ...players.A.life.slice(1)];
    w.__store!.setState({ state: { ...s, players: { ...(s.players as Record<string, unknown>), A: { ...players.A } } } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
    return iid;
  }, def);
}

async function enterCounterWindow(page: Page): Promise<{ bAttacker: string; aLeader: string }> {
  return page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { state: unknown }; setState: (p: { state: unknown } | { legalActions: unknown }) => void }; __getLegalActions?: (s: unknown, p: string) => unknown };
    const s = w.__store!.getState().state as Record<string, unknown>;
    const players = s.players as { A: { leader: { instanceId: string } }; B: { leader: { instanceId: string } } };
    const bAttacker = players.B.leader.instanceId;
    const aLeader = players.A.leader.instanceId;
    (s as Record<string, unknown>).phase = 'counter_window';
    (s as Record<string, unknown>).activePlayer = 'B';
    (s as Record<string, unknown>).pending = {
      kind: 'attack',
      pendingAttack: {
        attackerInstanceId: bAttacker,
        targetInstanceId: aLeader,
        counterBoost: 0,
      },
    };
    w.__store!.setState({ state: { ...s } });
    if (w.__getLegalActions) {
      const next = w.__store!.getState().state as { activePlayer: string };
      w.__store!.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
    }
    return { bAttacker, aLeader };
  });
}

async function dispatchAs(page: Page, action: object): Promise<void> {
  await page.evaluate((a) => {
    const w = window as unknown as { __store?: { getState: () => { dispatch: (a: unknown) => void } } };
    w.__store!.getState().dispatch(a);
  }, action);
  await page.waitForTimeout(350);
}

interface PromptSnap {
  triggerPromptVisible: boolean;
  phase: string;
  pendingKind: string | null;
  pendingTriggerCardIid: string | null;
}

async function readPromptSnap(page: Page): Promise<PromptSnap> {
  const dom = await page.evaluate(() => Boolean(document.querySelector('[data-pending-kind="trigger"]')));
  const engine = await page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { state: { phase: string; pending: { kind?: string; pendingTrigger?: { lifeCardInstanceId?: string } } | null } } } };
    const s = w.__store!.getState().state;
    return {
      phase: s.phase,
      pendingKind: s.pending?.kind ?? null,
      pendingTriggerCardIid: s.pending?.pendingTrigger?.lifeCardInstanceId ?? null,
    };
  });
  return { triggerPromptVisible: dom, ...engine };
}

interface ZoneSnap {
  aLife: string[];
  aHand: string[];
  aField: string[];
  aTrash: string[];
  aDeck: string[];
}

async function readZones(page: Page): Promise<ZoneSnap> {
  return page.evaluate(() => {
    const w = window as unknown as { __store?: { getState: () => { state: { players: { A: { life: string[]; hand: string[]; field: { instanceId: string }[]; trash: string[]; deck: string[] } } } } } };
    const s = w.__store!.getState().state;
    return {
      aLife: [...s.players.A.life],
      aHand: [...s.players.A.hand],
      aField: s.players.A.field.map((i) => i.instanceId),
      aTrash: [...s.players.A.trash],
      aDeck: [...s.players.A.deck],
    };
  });
}

async function readInstKeywords(page: Page, iid: string): Promise<{ continuous: string[]; oneShot: string[] }> {
  return page.evaluate((id) => {
    const w = window as unknown as { __store?: { getState: () => { state: { instances: Record<string, { grantedKeywordsContinuous?: string[]; grantedKeywordsOneShot?: { keyword: string }[] }> } } } };
    const inst = w.__store!.getState().state.instances[id];
    return {
      continuous: [...(inst?.grantedKeywordsContinuous ?? [])],
      oneShot: (inst?.grantedKeywordsOneShot ?? []).map((g) => g.keyword),
    };
  }, iid);
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

function assertStable(_p: Page, pageErrors: string[], invariantErrors: string[]): void {
  expect(pageErrors).toEqual([]);
  expect(invariantErrors).toEqual([]);
}

test.describe('stage-b trigger-from-life expansion', () => {
  // 1. OP01-009 Carrot — control: verify Stage A play_self_from_life
  // behavior still holds.
  test('OP01-009 Carrot — play_self_from_life (control); flipped life card moves to A field on RESOLVE_TRIGGER', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    const carrotIid = await placeCardAtTopOfALife(page, corpusDef('OP01-009'));
    await enterCounterWindow(page);

    const before = await readZones(page);
    expect(before.aLife[0], 'Carrot at top of A.life before damage').toBe(carrotIid);
    expect(before.aField, 'Carrot not on field pre-damage').not.toContain(carrotIid);

    await dispatchAs(page, { type: 'SKIP_COUNTER' });

    const mid = await readPromptSnap(page);
    expect(mid.phase, 'trigger_window mounted').toBe('trigger_window');
    expect(mid.pendingKind, 'pending=trigger').toBe('trigger');
    expect(mid.pendingTriggerCardIid, 'pendingTrigger.lifeCardInstanceId').toBe(carrotIid);
    expect(mid.triggerPromptVisible, 'TriggerPrompt visible').toBe(true);
    const midZones = await readZones(page);
    expect(midZones.aHand, 'Carrot in A.hand after flip').toContain(carrotIid);

    await dispatchAs(page, { type: 'RESOLVE_TRIGGER', activate: true, targetInstanceId: null });

    const after = await readZones(page);
    const afterPrompt = await readPromptSnap(page);
    expect(afterPrompt.pendingKind, 'pending cleared').toBeNull();
    expect(afterPrompt.phase, 'phase=main').toBe('main');
    expect(after.aField, 'Carrot on A.field (play_self_from_life)').toContain(carrotIid);
    expect(after.aHand, 'Carrot not in A.hand').not.toContain(carrotIid);
    expect(after.aLife, 'Carrot not in A.life').not.toContain(carrotIid);
    expect(await isOnYourField(page, carrotIid), 'Carrot visible in Your half').toBe(true);
    await expect.poll(
      async () => (await readPromptSnap(page)).triggerPromptVisible,
      { timeout: 5_000, message: 'TriggerPrompt dismissed (animation may delay)' },
    ).toBe(false);
    assertStable(page, pageErrors, invariantErrors);
  });

  // 2. OP05-109 Pagaya — Bug 2 routing smoke test.
  // Per printed text, Pagaya's `[Trigger]` clause encodes a REACTIVE
  // ability ("When a [Trigger] activates, draw 2 + trash 2"). The spec
  // uses `trigger:'trigger'` (same trigger keyword as
  // play_self_from_life) — engine fires it whenever the flipped life
  // card has clauses tagged 'trigger'. Card-data is
  // `verified:'flagged'`; action effect (draw 2 + mill_self 2) may not
  // fully realize per printed text (mill_self handler trashes top-of-
  // deck, not hand). Stage B scope: verify Bug 2 routing works
  // (pending clears + phase returns to main) — action correctness
  // is out of scope (latent CARD_DATA encoding flag).
  test('OP05-109 Pagaya — Bug 2 routing: trigger window mounts + RESOLVE_TRIGGER routes via pendingTrigger.controller (action effect out of scope)', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    const pagayaIid = await placeCardAtTopOfALife(page, corpusDef('OP05-109'));
    await enterCounterWindow(page);

    await dispatchAs(page, { type: 'SKIP_COUNTER' });
    const mid = await readPromptSnap(page);
    expect(mid.pendingKind, 'pending=trigger after damage').toBe('trigger');
    expect(mid.pendingTriggerCardIid, 'pendingTrigger.lifeCardInstanceId = Pagaya').toBe(pagayaIid);
    expect(mid.triggerPromptVisible, 'TriggerPrompt UI mounts').toBe(true);

    // Bug 2: dispatch wrapper must route RESOLVE_TRIGGER to A
    // (pendingTrigger.controller), even though activePlayer=B.
    await dispatchAs(page, { type: 'RESOLVE_TRIGGER', activate: true, targetInstanceId: null });

    const afterPrompt = await readPromptSnap(page);
    expect(afterPrompt.pendingKind, 'pending cleared (routing fix held)').toBeNull();
    expect(afterPrompt.phase, 'phase=main').toBe('main');
    await expect.poll(
      async () => (await readPromptSnap(page)).triggerPromptVisible,
      { timeout: 5_000, message: 'TriggerPrompt dismissed (animation may delay)' },
    ).toBe(false);
    assertStable(page, pageErrors, invariantErrors);
  });

  // 3. OP13-106 Conney — Bug 2 routing smoke test.
  // Printed text: "[Opponent's Turn] When a [Trigger] activates, this
  // Character gains [Blocker] during this turn." Same REACTIVE
  // semantic as Pagaya. Encoded with condition is_opp_turn + opt:true.
  // Spec `verified:'flagged'`. Stage B verifies the Bug 2 dispatch
  // routing — opt clause + condition + give_keyword action shape are
  // out of scope as a latent CARD_DATA observation.
  test('OP13-106 Conney — Bug 2 routing: trigger window mounts + RESOLVE_TRIGGER routes via pendingTrigger.controller', async ({ page }) => {
    test.setTimeout(TWO_MIN);
    const { pageErrors, invariantErrors } = await bootstrap(page);
    const conneyIid = await placeCardAtTopOfALife(page, corpusDef('OP13-106'));
    await enterCounterWindow(page);

    await dispatchAs(page, { type: 'SKIP_COUNTER' });
    const mid = await readPromptSnap(page);
    expect(mid.pendingKind, 'pending=trigger after damage').toBe('trigger');
    expect(mid.pendingTriggerCardIid, 'pendingTrigger.lifeCardInstanceId = Conney').toBe(conneyIid);
    expect(mid.triggerPromptVisible, 'TriggerPrompt UI mounts').toBe(true);

    await dispatchAs(page, { type: 'RESOLVE_TRIGGER', activate: true, targetInstanceId: null });

    const afterPrompt = await readPromptSnap(page);
    expect(afterPrompt.pendingKind, 'pending cleared').toBeNull();
    expect(afterPrompt.phase, 'phase=main').toBe('main');
    await expect.poll(
      async () => (await readPromptSnap(page)).triggerPromptVisible,
      { timeout: 5_000, message: 'TriggerPrompt dismissed (animation may delay)' },
    ).toBe(false);
    assertStable(page, pageErrors, invariantErrors);
  });
});
