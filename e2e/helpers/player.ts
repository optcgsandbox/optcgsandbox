// Player driver — selector-free API over the gameplay UI. Tests should only
// use these helpers, never raw locators. If a selector breaks, fix it here.

import { expect, type Page } from '@playwright/test';

const TIMEOUTS = {
  short: 5_000,
  medium: 15_000,
  long: 30_000,
};

export class PlayerDriver {
  constructor(private readonly page: Page) {}

  async open(): Promise<void> {
    // ?test=1 exposes window.__store for state assertions (gated in main.tsx).
    await this.page.goto('/?test=1');
    await this.page.waitForLoadState('domcontentloaded');
    await expect(this.page.locator('header').first()).toBeVisible({ timeout: TIMEOUTS.medium });
    // Confirm the test hook is wired.
    await this.page.waitForFunction(
      () => Boolean((window as unknown as { __store?: unknown }).__store),
      undefined,
      { timeout: TIMEOUTS.medium },
    );
  }

  // ─── Phase detection ──────────────────────────────────────────────────

  async currentPhase(): Promise<string> {
    // Read the exact engine enum from __store (?test=1). The header now
    // shows friendly labels ("Setup · Dice roll"), not the enum — text
    // scraping broke when that landed (owner 2026-06-12).
    return this.page.evaluate(() => {
      const w = window as unknown as { __store?: { getState: () => { state: { phase: string } } } };
      return w.__store?.getState().state.phase ?? '';
    });
  }

  async waitForPhase(name: string, timeoutMs: number = TIMEOUTS.long): Promise<void> {
    await expect.poll(
      async () => this.currentPhase(),
      { timeout: timeoutMs, message: `waitForPhase ${name}` },
    ).toContain(name.toLowerCase());
  }

  // ─── Dice / mulligan / first-player ───────────────────────────────────

  async rollDice(): Promise<void> {
    // Loop until phase leaves dice_roll. Handles ties (both slots reset →
    // re-roll button re-enables after a 1500ms TIE hold).
    for (let i = 0; i < 8; i += 1) {
      const phase = await this.currentPhase().catch(() => '');
      if (!phase.includes('dice_roll')) return;
      const btn = this.page.getByRole('button', { name: /^roll your die$/i }).first();
      if (await btn.isVisible().catch(() => false)) {
        const disabled = await btn.isDisabled().catch(() => true);
        if (!disabled) {
          await btn.click();
        }
      }
      await this.page.waitForTimeout(2500);
    }
  }

  // Combined Stage B regression runs can be slower after large cards.json
  // edits; specs should pass 15_000 ms (not 8_000) to `waitForPhase(
  // 'first_player_choice', …)` to avoid the false second-player bootstrap
  // flake where A.donCost reads 2 instead of 1 at T1 main.
  async chooseGoFirst(): Promise<void> {
    const btn = this.page.getByRole('button', { name: /go first|first/i }).first();
    await expect(btn).toBeVisible({ timeout: TIMEOUTS.medium });
    await btn.click();
  }

  async keepMulliganHand(): Promise<void> {
    const btn = this.page.getByRole('button', { name: /^keep( hand)?$/i }).first();
    await expect(btn).toBeVisible({ timeout: TIMEOUTS.medium });
    await btn.click();
  }

  // ─── Hand interaction ─────────────────────────────────────────────────

  /** Open the card-detail modal for the Nth hand card (0-indexed). */
  async openHandCard(index: number = 0): Promise<void> {
    // Scoped to the HandFan container (HandFan.tsx:63 sets
    // aria-label="Your hand, N cards"). Without this scoping, the prior
    // selector `[aria-label*="cost"]` would also match DON buttons
    // (e.g. "Rested DON, +1000 power, ..."), causing the harness to
    // attempt clicking disabled DON tiles for ~30s each.
    const card = this.page.locator('[aria-label^="Your hand"] button').nth(index);
    await expect(card).toBeVisible({ timeout: TIMEOUTS.medium });
    await card.click();
  }

  /** Click an action button by its visible label (e.g. "Play", "Attack"). */
  async clickAction(label: string | RegExp): Promise<void> {
    const btn = this.page.getByRole('button', { name: label }).first();
    await expect(btn).toBeVisible({ timeout: TIMEOUTS.medium });
    await btn.click();
  }

  /** Try to PLAY a hand card by clicking it then pressing the Play action.
   *  Returns true if successful, false if no Play action surfaced. */
  async playCard(index: number = 0): Promise<boolean> {
    await this.openHandCard(index);
    const playBtn = this.page.getByRole('button', { name: /^play$/i }).first();
    try {
      await playBtn.waitFor({ state: 'visible', timeout: TIMEOUTS.short });
    } catch {
      // No Play button (cost or kind blocked). Close the modal.
      await this.page.keyboard.press('Escape');
      return false;
    }
    await playBtn.click();
    return true;
  }

  // ─── Choose-one ──────────────────────────────────────────────────────

  async hasChoosePrompt(): Promise<boolean> {
    const heading = this.page.getByRole('heading', { name: /^choose one$/i });
    return await heading.isVisible().catch(() => false);
  }

  async chooseOption(optionIndex: number = 0): Promise<void> {
    const heading = this.page.getByRole('heading', { name: /^choose one$/i });
    await expect(heading).toBeVisible({ timeout: TIMEOUTS.medium });
    const dialog = this.page.getByRole('dialog').filter({ hasText: /choose one/i }).first();
    const buttons = dialog.getByRole('button', { name: /^choose option \d+:/i });
    const count = await buttons.count();
    if (count === 0) {
      throw new Error('ChoosePrompt rendered with zero option buttons — soft-lock');
    }
    await buttons.nth(optionIndex).click();
  }

  // ─── Turn control ────────────────────────────────────────────────────

  async endTurn(): Promise<void> {
    const btn = this.page.getByRole('button', { name: /^end turn$/i }).first();
    await expect(btn).toBeVisible({ timeout: TIMEOUTS.medium });
    await btn.click();
  }

  async currentTurnNumber(): Promise<number> {
    // From __store, same reason as currentPhase: setup phases no longer
    // print a "T{n}" in the header.
    return this.page.evaluate(() => {
      const w = window as unknown as { __store?: { getState: () => { state: { turn: number } } } };
      return w.__store?.getState().state.turn ?? -1;
    });
  }

  // ─── Debug snapshot ──────────────────────────────────────────────────

  async snapshot(label: string): Promise<{ phase: string; turn: number; bodyText: string }> {
    const phase = await this.currentPhase().catch(() => 'unknown');
    const turn = await this.currentTurnNumber().catch(() => -1);
    const bodyText = (await this.page.locator('main, [role="main"], body').first().innerText().catch(() => '')).slice(0, 500);
    // eslint-disable-next-line no-console
    console.log(`[${label}] phase=${phase} turn=${turn}\n  body: ${bodyText.replace(/\s+/g, ' ').slice(0, 200)}`);
    return { phase, turn, bodyText };
  }

  // ─── Store access (via window.__store, exposed in dev/test only) ──────

  async getState(): Promise<GameStateSnap> {
    return this.page.evaluate(() => {
      const store = (window as unknown as { __store?: { getState: () => { state: unknown } } }).__store;
      if (!store) throw new Error('window.__store not exposed — load with ?test=1 or run in dev build');
      const s = store.getState().state as Record<string, unknown>;
      const players = s.players as Record<string, { hand: string[]; field: { instanceId: string; rested: boolean; summoningSick: boolean; attachedDon: string[] }[]; life: string[]; deck: string[]; trash: string[]; donCostArea: string[]; donRested: string[]; leader: { instanceId: string; rested: boolean; attachedDon: string[] }; stage: unknown }>;
      return {
        phase: s.phase as string,
        turn: s.turn as number,
        activePlayer: s.activePlayer as string,
        pendingKind: s.pending ? (s.pending as { kind: string }).kind : null,
        result: s.result,
        A: {
          hand: players.A.hand.length,
          field: players.A.field.length,
          life: players.A.life.length,
          leaderRested: players.A.leader.rested,
          leaderDon: players.A.leader.attachedDon.length,
          donCost: players.A.donCostArea.length,
          donRested: players.A.donRested.length,
        },
        B: {
          hand: players.B.hand.length,
          field: players.B.field.length,
          life: players.B.life.length,
          leaderRested: players.B.leader.rested,
          leaderDon: players.B.leader.attachedDon.length,
          donCost: players.B.donCostArea.length,
          donRested: players.B.donRested.length,
        },
      };
    });
  }

  /** Dispatch any engine Action through the store directly. Use sparingly —
   *  prefer real UI interactions when validating UI wiring. Useful for
   *  setup steps that the UI can't easily reach (e.g. forcing a card into
   *  hand for a specific mechanic). */
  async dispatch(action: object): Promise<void> {
    await this.page.evaluate((a) => {
      const store = (window as unknown as { __store?: { getState: () => { dispatch: (a: unknown) => void } } }).__store;
      if (!store) throw new Error('window.__store not exposed');
      store.getState().dispatch(a);
    }, action);
  }

  /** Pump the event loop so async store side effects (AI loop, R/D/D
   *  pipeline) can settle. */
  async wait(ms: number): Promise<void> {
    await this.page.waitForTimeout(ms);
  }

  /** Test-only normalization: removes dice RNG first-player variance so
   *  family specs start from A Turn 1 main with 1 active DON.
   *
   *  Why this exists: the bootstrap flow ends at A's main phase, but
   *  who reaches main first depends on dice RNG. When A loses the dice
   *  roll, A becomes second player and reaches main on T2 with 2 active
   *  DON (one per turn). Tests asserting `A.donCostArea.length === 1`
   *  then fail. This helper post-processes state into a canonical
   *  fixture so test assertions are stable across runs.
   *
   *  Invariants enforced:
   *    - turn = 1, phase = 'main', activePlayer = 'A', firstPlayer = 'A',
   *      pending = null.
   *    - A.donCostArea has exactly 1 instance (reused from the existing
   *      DON pool — no synthetic mint).
   *    - A.donRested empty; extras returned to A.donDeck.
   *    - A & B perTurn fields reset on leader/field/stage.
   *    - A's attached DON is NOT disturbed.
   *    - Total A DON count (donDeck + donCostArea + donRested + attached)
   *      equals 10 after normalization.
   *    - B DON state untouched (stays whatever it is — legal either
   *      way since B is AI / inactive in these tests).
   *
   *  Returns the normalized A DON conservation count (always 10) so
   *  caller can assert. */
  async normalizeToATurn1Main(): Promise<number> {
    const conservation = await this.page.evaluate(() => {
      const w = window as unknown as {
        __store?: {
          getState: () => { state: unknown };
          setState: (p: { state: unknown } | { legalActions: unknown }) => void;
        };
        __getLegalActions?: (s: unknown, p: string) => unknown;
      };
      if (!w.__store) throw new Error('window.__store not exposed');
      const s = w.__store.getState().state as Record<string, unknown>;
      (s as Record<string, unknown>).turn = 1;
      (s as Record<string, unknown>).phase = 'main';
      (s as Record<string, unknown>).activePlayer = 'A';
      (s as Record<string, unknown>).firstPlayer = 'A';
      (s as Record<string, unknown>).pending = null;

      type InstWithPerTurn = {
        instanceId: string;
        attachedDon?: string[];
        attachedDonRested?: string[];
        perTurn?: Record<string, unknown>;
      };
      const players = s.players as {
        A: {
          donDeck: string[]; donCostArea: string[]; donRested: string[];
          field: InstWithPerTurn[];
          leader: InstWithPerTurn;
          stage: InstWithPerTurn | null;
        };
        B: {
          field: InstWithPerTurn[];
          leader: InstWithPerTurn;
          stage: InstWithPerTurn | null;
        };
      };

      // Collect attached DON across A (do NOT disturb).
      const attachedA: string[] = [];
      const collectAttached = (inst: InstWithPerTurn): void => {
        for (const id of inst.attachedDon ?? []) attachedA.push(id);
        for (const id of inst.attachedDonRested ?? []) attachedA.push(id);
      };
      collectAttached(players.A.leader);
      for (const inst of players.A.field) collectAttached(inst);
      if (players.A.stage) collectAttached(players.A.stage);

      // Pool together all non-attached A DON.
      const pool = [
        ...players.A.donDeck,
        ...players.A.donCostArea,
        ...players.A.donRested,
      ];
      if (pool.length === 0 && attachedA.length === 0) {
        throw new Error('A has no DON instances');
      }
      // Reset to canonical layout: 1 active in cost area, rest in deck.
      const desiredActive = 1;
      const newCost: string[] = [];
      const newDeck: string[] = [];
      for (let i = 0; i < pool.length; i += 1) {
        if (i < desiredActive) newCost.push(pool[i]!);
        else newDeck.push(pool[i]!);
      }
      players.A.donCostArea = newCost;
      players.A.donRested = [];
      players.A.donDeck = newDeck;

      // Reset perTurn for A & B (leader + field + stage).
      const blankPerTurn = (): Record<string, unknown> => ({ hasAttacked: false, effectsUsed: [] });
      players.A.leader.perTurn = blankPerTurn();
      for (const inst of players.A.field) inst.perTurn = blankPerTurn();
      if (players.A.stage) players.A.stage.perTurn = blankPerTurn();
      players.B.leader.perTurn = blankPerTurn();
      for (const inst of players.B.field) inst.perTurn = blankPerTurn();
      if (players.B.stage) players.B.stage.perTurn = blankPerTurn();

      w.__store.setState({
        state: {
          ...s,
          players: {
            ...(s.players as Record<string, unknown>),
            A: { ...players.A },
            B: { ...players.B },
          },
        },
      });
      if (w.__getLegalActions) {
        const next = w.__store.getState().state as { activePlayer: string };
        w.__store.setState({ legalActions: w.__getLegalActions(next, next.activePlayer) });
      }

      const totalA =
        players.A.donDeck.length +
        players.A.donCostArea.length +
        players.A.donRested.length +
        attachedA.length;
      return totalA;
    });
    await this.page.waitForTimeout(150);
    return conservation;
  }

  /** F-7n follow-up — drain human reactive windows while polling for
   *  `phase=main, activePlayer=A`.
   *
   *  Pre-BUG-010, the local store auto-skipped block/counter/trigger
   *  windows for the human defender during the AI's turn, so legacy
   *  combat smoke tests could simply poll `phase===main` after
   *  `endTurn()`. Post-fix (`src/store/game.ts:341-385`, BUG-010
   *  Phase A/B), the AI loop yields to the UI when the human has any
   *  non-skip option. Tests that don't intend to exercise those windows
   *  must explicitly drain them.
   *
   *  This helper polls the store every 200ms:
   *   - If `phase === 'main' && activePlayer === 'A'` → success.
   *   - If `phase` is a reactive window and the pending controller
   *     is `A`, dispatch the safe default:
   *       block_window    → SKIP_BLOCKER
   *       counter_window  → SKIP_COUNTER
   *       trigger_window  → RESOLVE_TRIGGER { activate:false }
   *       discard_choice  → RESOLVE_DISCARD { pickedId: first-hand-id }
   *   - Otherwise wait and re-poll.
   *
   *  Test-only — never used by production code. Does NOT change app
   *  behavior; it only stands in for a human player who would normally
   *  click the relevant prompt button. Tests that want to ASSERT the
   *  prompt rendered (see `e2e/local-ai/local-vs-ai-human-reactive.spec.ts`
   *  or `e2e/family-blocker.spec.ts`) must NOT use this helper — they
   *  drive the choice themselves. */
  async waitForAMainControlDrainingReactive(message: string, timeoutMs = 90_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastSnapshot: { phase: string; activePlayer: string; pendingKind: string | null } = {
      phase: '',
      activePlayer: '',
      pendingKind: null,
    };
    while (Date.now() < deadline) {
      const snap = await this.page.evaluate(() => {
        const w = window as unknown as {
          __store?: {
            getState: () => {
              state: {
                phase: string;
                activePlayer: string;
                pending: null | {
                  kind: 'attack' | 'trigger' | 'discard' | 'peek' | 'choose_one';
                  pendingAttack?: { targetInstanceId: string };
                  pendingTrigger?: { controller: string };
                  pendingDiscard?: { controller: string };
                  pendingPeek?: { controller: string };
                  pendingChoose?: { controller: string };
                };
                instances: Record<string, { controller: string }>;
                players: { A: { hand: string[] } };
              };
            };
            setState: (p: unknown) => void;
          };
        };
        if (!w.__store) return null;
        const s = w.__store.getState().state;
        let pendingController: string | null = null;
        if (s.pending) {
          if (s.pending.kind === 'attack' && s.pending.pendingAttack) {
            pendingController = s.instances[s.pending.pendingAttack.targetInstanceId]?.controller ?? null;
          } else if (s.pending.kind === 'trigger' && s.pending.pendingTrigger) {
            pendingController = s.pending.pendingTrigger.controller;
          } else if (s.pending.kind === 'discard' && s.pending.pendingDiscard) {
            pendingController = s.pending.pendingDiscard.controller;
          } else if (s.pending.kind === 'peek' && s.pending.pendingPeek) {
            pendingController = s.pending.pendingPeek.controller;
          } else if (s.pending.kind === 'choose_one' && s.pending.pendingChoose) {
            pendingController = s.pending.pendingChoose.controller;
          }
        }
        return {
          phase: s.phase,
          activePlayer: s.activePlayer,
          pendingKind: s.pending?.kind ?? null,
          pendingController,
          firstHandId: s.players.A.hand[0] ?? null,
        };
      });
      if (snap === null) throw new Error('window.__store not exposed (load with ?test=1)');
      lastSnapshot = {
        phase: snap.phase,
        activePlayer: snap.activePlayer,
        pendingKind: snap.pendingKind,
      };
      if (snap.phase === 'main' && snap.activePlayer === 'A') return;

      // Drain only when the human (A) controls the pending choice.
      if (snap.pendingController === 'A') {
        let action: object | null = null;
        if (snap.phase === 'block_window') action = { type: 'SKIP_BLOCKER' };
        else if (snap.phase === 'counter_window') action = { type: 'SKIP_COUNTER' };
        else if (snap.phase === 'trigger_window') {
          action = { type: 'RESOLVE_TRIGGER', activate: false, targetInstanceId: null };
        } else if (snap.phase === 'discard_choice') {
          action = { type: 'RESOLVE_DISCARD', pickedId: snap.firstHandId };
        }
        if (action !== null) {
          await this.dispatch(action);
          await this.page.waitForTimeout(120);
          continue;
        }
      }
      await this.page.waitForTimeout(200);
    }
    throw new Error(
      `${message} — last snapshot phase=${lastSnapshot.phase} activePlayer=${lastSnapshot.activePlayer} pendingKind=${lastSnapshot.pendingKind}`,
    );
  }
}

export interface GameStateSnap {
  phase: string;
  turn: number;
  activePlayer: string;
  pendingKind: string | null;
  result: unknown;
  A: SideSnap;
  B: SideSnap;
}

export interface SideSnap {
  hand: number;
  field: number;
  life: number;
  leaderRested: boolean;
  leaderDon: number;
  donCost: number;
  donRested: number;
}
