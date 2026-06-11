/**
 * LIVE GAMEPLAY AUTO-PLAYER — drives full UI matches at localhost:5175.
 * Loop: play game → break game → fix game → replay game.
 * No store dispatch. No engine shortcuts. UI only.
 *
 * env PLAY_URL (default http://localhost:5175/)
 * env HEADED=1 to see the browser
 * env MAX_TURNS (default 30)
 * env MAX_MATCHES (default 1)
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';

const URL = process.env.PLAY_URL ?? 'http://localhost:5175/';
const HEADLESS = process.env.HEADED === '1' ? false : true;
const MAX_TURNS = parseInt(process.env.MAX_TURNS ?? '30', 10);
const MAX_MATCHES = parseInt(process.env.MAX_MATCHES ?? '1', 10);
// COLOR_ONLY=red restricts the rotation to a single color — used for the
// red-only validation batch when chasing a non-deterministic stall.
const COLOR_ONLY = process.env.COLOR_ONLY ?? '';
// Artifacts MUST live outside the project tree — vite's dev server watches
// the whole repo and triggers a full page reload when files are written to
// any watched path. Writing dump files mid-stall caused HMR-induced page
// reloads that wiped real engine state and made the dumps useless. Keep
// artifacts in /tmp so vite never sees them. Coverage JSON is also moved
// for the same reason (it's overwritten after every match).
const ARTIFACT_DIR = '/tmp/optcg-play-artifacts';
const COVERAGE_FILE = '/tmp/optcg-play-artifacts/card-coverage.json';
// Existing on-repo coverage seed — copy in on first run so we don't lose
// the corpus growth already accumulated.
const COVERAGE_SEED = '/Users/minamakar/Developer/optcgsandbox/tools/card-coverage.json';
const CARDS_FILE = '/Users/minamakar/Developer/optcgsandbox/shared/data/cards.json';
mkdirSync(ARTIFACT_DIR, { recursive: true });

// Load corpus once. Used for: leader rotation, per-color prefer-list,
// AI-play DOM observation, coverage tagging.
const ALL_CARDS = JSON.parse(readFileSync(CARDS_FILE, 'utf8'));
const NON_LEADERS = ALL_CARDS.filter(
  (c) => c.kind !== 'leader' && Array.isArray(c.colors),
);
const LEADERS = ALL_CARDS.filter((c) => c.kind === 'leader');
// Map from "Name (kind)" → card id. Covers ALL non-leader cards so we can
// match observed names across any color.
const NAME_TO_ID = new Map();
for (const c of NON_LEADERS) NAME_TO_ID.set(`${c.name} (${c.kind})`, c.id);
// Map from "Name (leader)" → leader id, for seat tracking.
const LEADER_NAME_TO_ID = new Map();
for (const l of LEADERS) LEADER_NAME_TO_ID.set(`${l.name} (leader)`, l.id);

// Leader rotation: one mono-leader per color. Falls back to the first
// found leader of that color. The driver cycles through this list match
// by match so coverage spreads across all colors.
const COLORS = ['red', 'green', 'blue', 'purple', 'black', 'yellow'];
const LEADERS_BY_COLOR = {};
for (const color of COLORS) {
  const mono = LEADERS.find((l) => l.colors.length === 1 && l.colors[0] === color);
  if (mono !== undefined) LEADERS_BY_COLOR[color] = mono;
}
const ROTATION = (
  COLOR_ONLY.length > 0
    ? [COLOR_ONLY]
    : COLORS
).filter((c) => LEADERS_BY_COLOR[c] !== undefined).map((c) => LEADERS_BY_COLOR[c]);

let consoleLog = [];
let pageErrors = [];
let actionHistory = [];

function log(...a) { console.log('[driver]', ...a); }
function record(step, detail) {
  actionHistory.push({ step, detail, t: Date.now() });
  if (actionHistory.length > 2000) actionHistory.shift();
}

function loadCoverage() {
  // Seed migration: first run after relocation copies the repo's last
  // recorded coverage into /tmp so we keep accumulating IDs.
  if (!existsSync(COVERAGE_FILE) && existsSync(COVERAGE_SEED)) {
    try {
      writeFileSync(COVERAGE_FILE, readFileSync(COVERAGE_SEED, 'utf8'));
    } catch {}
  }
  if (existsSync(COVERAGE_FILE)) {
    try {
      const c = JSON.parse(readFileSync(COVERAGE_FILE, 'utf8'));
      // Backward-compat: ensure new fields exist on legacy files.
      if (!Array.isArray(c.playedCardIds)) c.playedCardIds = [];
      if (!Array.isArray(c.leadersObserved)) c.leadersObserved = [];
      if (!c.byColor) c.byColor = { red: [], green: [], blue: [], purple: [], black: [], yellow: [] };
      // Backfill IDs from existing playedCardNames if not yet captured.
      for (const name of c.playedCardNames ?? []) {
        const id = NAME_TO_ID.get(name);
        if (id !== undefined && !c.playedCardIds.includes(id)) c.playedCardIds.push(id);
      }
      return c;
    } catch {}
  }
  return {
    playedCardNames: [], playedAt: {}, matches: 0, lastUpdated: null,
    playedCardIds: [],
    leadersObserved: [],
    byColor: { red: [], green: [], blue: [], purple: [], black: [], yellow: [] },
  };
}

function recordCardId(coverage, id, source) {
  if (id === undefined || id === null) return false;
  if (coverage.playedCardIds.includes(id)) return false;
  coverage.playedCardIds.push(id);
  const card = ALL_CARDS.find((c) => c.id === id);
  if (card !== undefined && Array.isArray(card.colors)) {
    for (const color of card.colors) {
      if (coverage.byColor[color] && !coverage.byColor[color].includes(id)) {
        coverage.byColor[color].push(id);
      }
    }
  }
  log(`  ✓ NEW [${source}] ${id} ${card?.name ?? '?'} (${card?.kind ?? '?'}) — total ids: ${coverage.playedCardIds.length}`);
  return true;
}
function saveCoverage(cov) {
  cov.lastUpdated = new Date().toISOString();
  writeFileSync(COVERAGE_FILE, JSON.stringify(cov, null, 2));
}

async function snapshot(page, label) {
  const f = `${ARTIFACT_DIR}/${Date.now()}-${label}.png`;
  try { await page.screenshot({ path: f, fullPage: false }); } catch (e) {}
  return f;
}

async function captureEngineSnapshot(page) {
  // Read the driver-only snapshot accessor wired in src/store/game.ts.
  // Returns null if the gate isn't enabled or the accessor isn't present
  // (e.g. page reloaded without the localStorage key surviving).
  try {
    return await page.evaluate(() => {
      const fn = window.__PLAY_DRIVER_SNAPSHOT__;
      return typeof fn === 'function' ? fn() : null;
    });
  } catch (e) {
    return { error: String(e) };
  }
}

async function captureVisiblePrompts(page) {
  // Best-effort: list aria-label of visible dialog/prompt roots so we
  // know what (if anything) is rendered to the user at stall time.
  try {
    return await page.locator('[role="dialog"], [role="alertdialog"]').evaluateAll((els) =>
      els.map((e) => ({
        ariaLabel: e.getAttribute('aria-label') ?? null,
        ariaLabelledby: e.getAttribute('aria-labelledby') ?? null,
        text: (e.textContent ?? '').trim().slice(0, 200),
      })),
    );
  } catch {
    return [];
  }
}

async function dumpFailure(page, label, ctx) {
  const pageErr = pageErrors.length > 0;
  const eng = consoleLog.some(m => m.text?.includes('applyAction') || m.text?.includes('RegistryValidationError'));
  let cls;
  if (pageErr || eng) cls = 'ENGINE BUG';
  else if (ctx?.kind === 'state_unchanged_after_play') cls = 'CARD DATA BUG';
  else cls = 'UI BUG';

  // Capture snapshot FIRST — before any artifact writes, before any
  // navigation, before screenshot. This is the true engine state at the
  // moment the driver decided to give up.
  const engineSnapshot = await captureEngineSnapshot(page);
  const visiblePrompts = await captureVisiblePrompts(page);

  const png = await snapshot(page, `FAIL-${label}`);
  let html = '';
  try { html = await page.content(); } catch {}
  const stamp = Date.now();
  const dumpf = `${ARTIFACT_DIR}/${stamp}-FAIL-${label}.json`;
  const htmlf = `${ARTIFACT_DIR}/${stamp}-FAIL-${label}.html`;
  writeFileSync(dumpf, JSON.stringify({
    classification: cls, label, ctx,
    engineSnapshot, visiblePrompts,
    consoleLog: consoleLog.slice(-30), pageErrors,
    actionHistory: actionHistory.slice(-50),
    screenshot: png, timestamp: new Date().toISOString(),
  }, null, 2));
  writeFileSync(htmlf, html);
  log('-------------------------------------------------------------');
  log(`FAILURE: ${cls}`);
  log(`Label: ${label}`); log(`ctx:`, ctx);
  log(`Screenshot: ${png}`); log(`Dump: ${dumpf}`);
  log(`Page errors:`); for (const e of pageErrors.slice(-5)) log(`  ${e}`);
  log(`Console events (last 10):`); for (const c of consoleLog.slice(-10)) log(`  [${c.type}] ${c.text}`);
  log(`Actions (last 15):`); for (const a of actionHistory.slice(-15)) log(`  ${a.step}: ${a.detail}`);
  log('-------------------------------------------------------------');
  return { cls, dump: dumpf, png };
}

async function visible(loc) { return loc.isVisible().catch(() => false); }
async function enabled(loc) { return loc.isEnabled().catch(() => false); }

// ── Per-phase ─────────────────────────────────────────────────────────

async function pickMode(page) {
  const easy = page.locator('button:has-text("Easy")').first();
  if (!(await visible(easy))) return false;
  await easy.click({ timeout: 5000 });
  record('mode', 'Easy');
  return true;
}

async function rollDice(page) {
  const btn = page.locator('button[aria-label*="Roll your die" i]').first();
  if (await visible(btn)) {
    await btn.click({ timeout: 5000 });
    record('action', 'ROLL_DICE');
  }
  // Wait for dice phase to clear (AI auto-rolls after a delay).
  // Poll up to 8s for "Roll your die" to disappear AND for next-phase
  // prompts (Go First / Keep) to appear.
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(500);
    const stillRolling = await visible(page.locator('button[aria-label*="Roll your die" i]').first());
    const next = (await visible(page.locator('button:has-text("Go First")').first())) ||
                 (await visible(page.locator('button:has-text("Keep")').first()));
    if (!stillRolling && next) return true;
    if (next) return true; // tie-resolution may still show the button
  }
  return true;
}

async function firstPlayerChoice(page) {
  const gf = page.locator('button:has-text("Go First")').first();
  if (await visible(gf)) {
    await gf.click({ timeout: 5000 });
    record('action', 'CHOOSE_FIRST');
    await page.waitForTimeout(1500);
  }
  return true;
}

async function keepMulligan(page) {
  // Poll up to 20s for "Keep" to be visible, click it. The Keep button only
  // appears for the human when phase === mulligan_first/second and decider
  // === viewAs. AI auto-fires its own mulligan via the store, so we may
  // only need to act once (mulligan_second).
  let clicked = false;
  for (let i = 0; i < 40; i++) {
    const keep = page.locator('button:has-text("Keep")').first();
    if (await visible(keep)) {
      await keep.click({ timeout: 5000 }).catch(() => null);
      record('action', 'KEEP_HAND');
      clicked = true;
      await page.waitForTimeout(800);
    }
    // Past mulligan if the mulligan dialog ("role=dialog" with "Keep") is gone.
    if (clicked && !(await visible(page.locator('button:has-text("Keep")').first()))) {
      return true;
    }
    await page.waitForTimeout(500);
  }
  return true;
}

// Resolve any modal/prompt currently blocking the human. Returns true if
// it took an action. The previous closeModalIfOpen only knew how to close
// card-detail modals (CLOSE/CANCEL); choose_one/peek/discard prompts
// stayed open and stalled the hand-play loop because their buttons don't
// match those texts. The store auto-resolves these for any controller,
// but the auto-resolve safety cap (50 iters in src/store/game.ts:535) can
// leave a prompt visible after a chain of effects — the driver needs its
// own fallback so we don't sit on a prompt forever.
async function resolveAnyOpenPrompts(page) {
  // Choose-one: pick the first option (matches store auto-resolve
  // optionIndex: 0). Buttons have aria-label "Choose option 1: ...".
  const chooseFirst = page.locator('button[aria-label^="Choose option 1:"]').first();
  if (await visible(chooseFirst)) {
    await chooseFirst.click({ timeout: 2000 }).catch(() => null);
    record('action', 'RESOLVE_CHOOSE_ONE[0]');
    await page.waitForTimeout(220);
    return true;
  }
  // Peek: skip (matches store auto-resolve pickedIds: []). Button text
  // is "Skip — none" per PeekChoicePrompt.tsx:100.
  const peekSkip = page.locator('button:has-text("Skip — none")').first();
  if (await visible(peekSkip)) {
    await peekSkip.click({ timeout: 2000 }).catch(() => null);
    record('action', 'RESOLVE_PEEK[skip]');
    await page.waitForTimeout(220);
    return true;
  }
  // Discard: pick the first available card (matches store auto-resolve
  // hand[0]). Cards have role="button" with aria-label "Discard X".
  const discardFirst = page.locator('[role="button"][aria-label^="Discard "]').first();
  if (await visible(discardFirst)) {
    await discardFirst.click({ timeout: 2000 }).catch(() => null);
    record('action', 'RESOLVE_DISCARD[first]');
    await page.waitForTimeout(220);
    return true;
  }
  // Card-detail modal: close it. Trash viewer also uses CLOSE.
  const closeBtn = page.locator('button:has-text("CLOSE")').or(page.locator('button:has-text("CANCEL")')).first();
  if (await visible(closeBtn)) {
    await closeBtn.click({ timeout: 2000 }).catch(() => null);
    await page.waitForTimeout(180);
    return true;
  }
  return false;
}

// Back-compat alias — older call sites still use closeModalIfOpen. Keeps
// the diff small while routing every prompt through the new resolver.
async function closeModalIfOpen(page) {
  await resolveAnyOpenPrompts(page);
}

async function recordCardFromModal(page, coverage) {
  let name = null;
  try {
    name = await page.locator('[role="dialog"] >> h2,[role="dialog"] >> h3').first()
      .textContent({ timeout: 400 });
  } catch {}
  if (!name) {
    try {
      const all = await page.locator('[role="dialog"]').first().innerText({ timeout: 400 });
      name = all.split('\n').map(s => s.trim()).filter(Boolean).find(line =>
        line.length > 2 && line.length < 70 &&
        !/^(play|cancel|close|attack|attach|activate|select|use counter|decline)$/i.test(line) &&
        !/^play[ ·]+/i.test(line) && !/^use counter/i.test(line) && !/^attach don/i.test(line)
      ) ?? null;
    } catch {}
  }
  if (name) {
    name = name.trim().slice(0, 80);
    if (!coverage.playedCardNames.includes(name)) {
      coverage.playedCardNames.push(name);
      coverage.playedAt[name] = new Date().toISOString();
      log(`  ✓ NEW: "${name}" (total ${coverage.playedCardNames.length})`);
    }
    const id = NAME_TO_ID.get(name);
    if (id !== undefined) recordCardId(coverage, id, 'modal');
  }
  return name;
}

// Capture opponent-side cards present on field / trash / life after each
// AI turn. Computes set-diff vs previous snapshot to attribute new card
// observations. Reads aria-labels; cross-references to NAME_TO_ID via the
// card name suffix " (kind)".
async function recordAiZoneSnapshot(page, coverage, prev) {
  const current = new Set();
  try {
    const labels = await page.locator('[aria-label]').evaluateAll((els) =>
      els.map((e) => e.getAttribute('aria-label') ?? ''),
    );
    for (const lbl of labels) {
      if (!lbl) continue;
      // aria-label format example: "Yamato, character, cost 6, power 7000, counter 1000"
      // OR for leaders: "Buggy (leader)"
      // Match the "Name, kind, ..." pattern OR the "Name (kind)" pattern.
      let cardName = null;
      const m1 = lbl.match(/^([^,]+),\s*(character|event|stage)\b/);
      if (m1) cardName = `${m1[1].trim()} (${m1[2]})`;
      const m2 = lbl.match(/^(.+)\s*\((leader)\)$/);
      if (m2) cardName = `${m2[1].trim()} (leader)`;
      if (cardName) current.add(cardName);
    }
  } catch {}
  // New observations = current \ prev
  for (const name of current) {
    if (prev.has(name)) continue;
    const id = NAME_TO_ID.get(name);
    if (id !== undefined) recordCardId(coverage, id, 'dom-diff');
    // Leaders
    const lid = LEADER_NAME_TO_ID.get(name);
    if (lid !== undefined && !coverage.leadersObserved.includes(lid)) {
      coverage.leadersObserved.push(lid);
      log(`  ✓ NEW [seat-leader] ${lid} ${name} — total leaders: ${coverage.leadersObserved.length}`);
    }
  }
  return current;
}

async function playAllPlayableHandCards(page, coverage) {
  let plays = 0;
  for (let attempt = 0; attempt < 25; attempt++) {
    // Drain any prompt left over from a prior play (choose_one, peek,
    // discard) BEFORE re-resolving the hand selector. Loop up to 5 times
    // because a single play can chain multiple prompts (e.g. card-detail
    // → choose-one → trigger).
    for (let p = 0; p < 5; p++) {
      const did = await resolveAnyOpenPrompts(page);
      if (!did) break;
    }
    // Re-fetch hand AFTER prompts are resolved — the prior `cards` array
    // is stale once any modal renders/un-renders.
    const cards = await page.locator('[aria-label^="Your hand"] button').all();
    if (cards.length === 0) return plays;
    let progressed = false;
    for (let i = 0; i < cards.length; i++) {
      // Targeted prompt-resolve before each card click — cheaper than
      // closeModalIfOpen because resolveAnyOpenPrompts short-circuits
      // when no prompts are open.
      await resolveAnyOpenPrompts(page);
      const card = cards[i];
      if (!(await visible(card))) continue;
      const clicked = await card.click({ timeout: 2500 }).then(() => true).catch(() => false);
      if (!clicked) continue;
      await page.waitForTimeout(220);
      const playBtn = page.locator('button:has-text("PLAY")').first();
      if ((await visible(playBtn)) && (await enabled(playBtn))) {
        await recordCardFromModal(page, coverage);
        await playBtn.click({ timeout: 3000 });
        record('action', `PLAY_CARD[hand#${i}]`);
        await page.waitForTimeout(900);
        // Drain post-play prompts (on_play effects can spawn
        // choose_one/peek/discard chains). Loop bounded so we don't
        // burn iterations on a stuck prompt.
        for (let p = 0; p < 5; p++) {
          const did = await resolveAnyOpenPrompts(page);
          if (!did) break;
        }
        progressed = true;
        plays += 1;
        break;
      } else {
        await closeModalIfOpen(page);
      }
    }
    if (!progressed) break;
  }
  return plays;
}

async function getOwnLeader(page, leaderName) {
  // Player A's leader is set per-match via PLAY_DRIVER_LEADER_ID (gate read
  // by src/store/game.ts:bootGame). leaderName threads from playMatch so the
  // selector tracks rotation. Fallback: last() — opp renders FIRST in DOM
  // order in PlayfieldStage so last() prefers self.
  if (leaderName) {
    const named = page.locator(`button[aria-label="${leaderName} (leader)"]`).first();
    if (await visible(named)) return named;
  }
  return page.locator('[aria-label*="(leader)" i]').last();
}

async function getOppLeader(page) {
  // Opponent leader is hardcoded to OP09-042 Buggy in src/store/game.ts:bootGame.
  const named = page.locator('button[aria-label="Buggy (leader)"]').first();
  if (await visible(named)) return named;
  return page.locator('[aria-label*="(leader)" i]').first();
}

async function activateLeader(page, coverage, leaderName) {
  const leader = await getOwnLeader(page, leaderName);
  if (!(await visible(leader))) return false;
  await leader.click({ timeout: 3000 }).catch(() => null);
  await page.waitForTimeout(250);
  const act = page.locator('button:has-text("ACTIVATE")').first();
  if ((await visible(act)) && (await enabled(act))) {
    await recordCardFromModal(page, coverage);
    await act.click({ timeout: 3000 });
    record('action', 'ACTIVATE_MAIN(leader)');
    await page.waitForTimeout(800);
    return true;
  }
  await closeModalIfOpen(page);
  return false;
}

async function attackWithLeader(page, leaderName) {
  const own = await getOwnLeader(page, leaderName);
  if (!(await visible(own))) return false;
  await own.click({ timeout: 3000 }).catch(() => null);
  await page.waitForTimeout(280);
  const sel = page.locator('button:has-text("SELECT AS ATTACKER")').first();
  if (!(await visible(sel))) { await closeModalIfOpen(page); return false; }
  await sel.click({ timeout: 3000 });
  record('action', 'SELECT_ATTACKER(leader)');
  await page.waitForTimeout(350);

  const opp = await getOppLeader(page);
  if (!(await visible(opp))) { await closeModalIfOpen(page); return false; }
  await opp.click({ timeout: 3000 }).catch(() => null);
  await page.waitForTimeout(280);
  const atk = page.locator('button:has-text("ATTACK THIS")').first();
  if (!(await visible(atk))) { await closeModalIfOpen(page); return false; }
  await atk.click({ timeout: 3000 });
  record('action', 'DECLARE_ATTACK(leader)');
  await page.waitForTimeout(2800);
  // Drain any prompts spawned by the attack — life-flip triggers,
  // counter-window prompts (if the AI counter UI lands), etc. Bounded
  // loop avoids spinning on a stuck prompt.
  for (let p = 0; p < 5; p++) {
    const did = await resolveAnyOpenPrompts(page);
    if (!did) break;
  }
  return true;
}

async function endTurn(page) {
  // Wait up to 60s for OUR END TURN button. Then wait up to 600s for AI's
  // turn to complete (AI safety cap=200 actions × ~2.5s pacing = ~500s worst).
  // During the AI-return wait, snapshot engine state every ~30s so a stall
  // shows up in action history with real phase/pending data instead of just
  // "endturn-blocked" after the ceiling fires.
  for (let i = 0; i < 120; i++) {
    if (await isGameOver(page)) return true;
    const our = page.locator('button[aria-label="END TURN"]').first();
    if (await visible(our)) {
      await our.click({ timeout: 5000 });
      record('action', 'END_TURN');
      let lastSnapshotJson = '';
      for (let j = 0; j < 1200; j++) {
        await page.waitForTimeout(500);
        if (await isGameOver(page)) return true;
        const ours = await visible(page.locator('button[aria-label="END TURN"]').first());
        if (ours) return true;
        // Every 60 iterations (~30s), snapshot engine state. If we see the
        // same state twice in a row past 60s elapsed, log a STALL marker
        // so the dump captures a meaningful diff vs the prior call.
        if (j > 0 && j % 60 === 0) {
          const snap = await captureEngineSnapshot(page);
          const snapJson = JSON.stringify(snap);
          if (snapJson === lastSnapshotJson) {
            record('stall', `same engine state at j=${j} (~${(j * 0.5).toFixed(0)}s) snap=${snapJson?.slice(0, 200)}`);
          } else {
            record('progress', `j=${j} snap=${snapJson?.slice(0, 200)}`);
            lastSnapshotJson = snapJson;
          }
        }
      }
      return true;
    }
    await page.waitForTimeout(500);
  }
  return false;
}

async function isGameOver(page) {
  const overlay = page
    .locator('[aria-label="Game over"]')
    .or(page.locator(':text("A wins")'))
    .or(page.locator(':text("B wins")'))
    .or(page.locator(':text("You won")'))
    .or(page.locator(':text("You lost")'))
    .or(page.locator(':text("Game over")'))
    .or(page.locator('button:has-text("New game")'))
    .first();
  return visible(overlay);
}

// ── Match ────────────────────────────────────────────────────────────

async function playMatch(page, coverage, matchIdx, leaderName) {
  log(`=== match ${matchIdx} ===`);
  await snapshot(page, `m${matchIdx}-00-loaded`);

  if (!(await pickMode(page))) { await dumpFailure(page, `m${matchIdx}-mode`, { kind: 'selector_missing', selector: 'Easy' }); return { ended: false, reason: 'mode' }; }
  await page.waitForTimeout(400);
  if (!(await rollDice(page))) { await dumpFailure(page, `m${matchIdx}-dice`, { kind: 'selector_missing' }); return { ended: false, reason: 'dice' }; }
  await firstPlayerChoice(page);
  if (!(await keepMulligan(page))) { await dumpFailure(page, `m${matchIdx}-mulligan`, { kind: 'selector_missing' }); return { ended: false, reason: 'mulligan' }; }
  await page.waitForTimeout(2000);
  await snapshot(page, `m${matchIdx}-main`);

  // Initial DOM snapshot — captures leader names + any pre-existing opp
  // field state. New cards appearing later are credited via diff.
  let zoneSnapshot = await recordAiZoneSnapshot(page, coverage, new Set());

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (await isGameOver(page)) return { ended: true, reason: 'game-over', turns: turn };
    log(`-- m${matchIdx} t${turn} --`);

    const activated = await activateLeader(page, coverage, leaderName);
    if (activated) log('  activated leader');
    const plays = await playAllPlayableHandCards(page, coverage);
    log(`  plays: ${plays}`);
    await snapshot(page, `m${matchIdx}-t${turn}-played`);
    const attacked = await attackWithLeader(page, leaderName);
    if (attacked) log('  attacked');
    await snapshot(page, `m${matchIdx}-t${turn}-attacked`);

    if (await isGameOver(page)) return { ended: true, reason: 'game-over-on-attack', turns: turn };

    if (!(await endTurn(page))) {
      await dumpFailure(page, `m${matchIdx}-t${turn}-endturn-blocked`, { kind: 'click_noop', detail: 'End Turn missing' });
      return { ended: false, reason: 'endturn-blocked', turns: turn };
    }
    await snapshot(page, `m${matchIdx}-t${turn}-end`);
    // DOM diff after AI's turn returns control — captures AI plays + spawns.
    zoneSnapshot = await recordAiZoneSnapshot(page, coverage, zoneSnapshot);
  }
  return { ended: false, reason: 'max-turns', turns: MAX_TURNS };
}

// ── Top ──────────────────────────────────────────────────────────────

async function main() {
  const browser = await chromium.launch({ headless: HEADLESS });
  const coverage = loadCoverage();
  const t0 = Date.now();
  log(`coverage loaded: ${coverage.playedCardNames.length} cards / ${coverage.matches} prior matches`);

  for (let m = 1; m <= MAX_MATCHES; m++) {
    consoleLog = []; pageErrors = []; actionHistory = [];
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });

    // Leader rotation: cycle through one mono-leader per color. Driver-only
    // gate via PLAY_DRIVER_LEADER_ID. Production never sees this key.
    const leader = ROTATION[(m - 1) % ROTATION.length];
    const leaderColor = leader.colors[0];

    // Coverage injection: compute untested non-leader card IDs FILTERED BY
    // the active leader's color (OPTCG legality: cards must share a color
    // with leader). Prefer-list always satisfies the engine's
    // sharesColorWithLeader check.
    const observedIds = new Set(coverage.playedCardIds);
    const colorPool = NON_LEADERS.filter((c) => c.colors.includes(leaderColor));
    const preferIds = colorPool
      .filter((c) => !observedIds.has(c.id))
      .map((c) => c.id);

    await ctx.addInitScript(
      ({ prefer, leaderId }) => {
        try { window.localStorage.setItem('PLAY_DRIVER_PREFER', JSON.stringify(prefer)); } catch {}
        try { window.localStorage.setItem('PLAY_DRIVER_LEADER_ID', leaderId); } catch {}
        // Gate for window.__PLAY_DRIVER_SNAPSHOT__ — read-only snapshot
        // accessor wired in src/store/game.ts. Production users without
        // this localStorage key never see the global.
        try { window.localStorage.setItem('PLAY_DRIVER_SNAPSHOT', '1'); } catch {}
      },
      { prefer: preferIds, leaderId: leader.id },
    );
    log(`match ${m}: leader=${leader.id} ${leader.name} (${leaderColor}) | prefer=${preferIds.length} untested ${leaderColor} cards (observed total: ${observedIds.size})`);

    // Track the seat leader explicitly (independent of name-matching from DOM).
    if (!coverage.leadersObserved.includes(leader.id)) {
      coverage.leadersObserved.push(leader.id);
      log(`  ✓ NEW [seat-leader] ${leader.id} ${leader.name}`);
    }

    const page = await ctx.newPage();
    page.on('console', x => consoleLog.push({ type: x.type(), text: x.text() }));
    page.on('pageerror', e => pageErrors.push(String(e)));
    try {
      await page.goto(URL, { waitUntil: 'networkidle', timeout: 20000 });
      record('goto', URL);
    } catch (e) {
      await dumpFailure(page, `m${m}-goto`, { kind: 'selector_missing', detail: e?.message });
      await ctx.close();
      break;
    }
    const result = await playMatch(page, coverage, m, leader.name);
    coverage.matches += 1; saveCoverage(coverage);
    log(`match ${m}: ${JSON.stringify(result)} | coverage=${coverage.playedCardNames.length}`);
    if (!result.ended && result.reason !== 'max-turns') {
      log(`NOTE — failure surfaced in match ${m}. Continuing to next match for coverage.`);
    }
    await ctx.close();
  }
  writeCoverageReport(coverage);
  log(`done. ${coverage.matches} matches, ${coverage.playedCardNames.length} unique cards (legacy names), ${coverage.playedCardIds.length} unique ids, ${coverage.leadersObserved.length} leaders, ${((Date.now()-t0)/1000).toFixed(1)}s`);
  await browser.close();
}

// Generates tools/coverage-report.md — per-color breakdown plus leader
// observation summary. Reads counts from the in-memory coverage object so
// it stays consistent with the JSON artifact.
function writeCoverageReport(cov) {
  const lines = [];
  lines.push(`# Card Coverage Report`);
  lines.push(``);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Total matches: ${cov.matches}`);
  lines.push(``);
  lines.push(`## Corpus`);
  const nonLeaderTotal = NON_LEADERS.length;
  const leaderTotal = LEADERS.length;
  lines.push(`- Non-leader cards: ${nonLeaderTotal}`);
  lines.push(`- Leader cards: ${leaderTotal}`);
  lines.push(``);
  lines.push(`## Observed`);
  lines.push(`- Non-leader IDs observed: ${cov.playedCardIds.length} / ${nonLeaderTotal} (${((cov.playedCardIds.length / nonLeaderTotal) * 100).toFixed(1)}%)`);
  lines.push(`- Leaders observed: ${cov.leadersObserved.length} / ${leaderTotal} (${((cov.leadersObserved.length / leaderTotal) * 100).toFixed(1)}%)`);
  lines.push(``);
  lines.push(`## Per-color (non-leader cards)`);
  lines.push(``);
  lines.push(`| Color | Observed | Total | % | Remaining |`);
  lines.push(`|---|---|---|---|---|`);
  for (const color of COLORS) {
    const colorTotal = NON_LEADERS.filter((c) => c.colors.includes(color)).length;
    const observed = (cov.byColor[color] ?? []).length;
    const pct = colorTotal === 0 ? '—' : `${((observed / colorTotal) * 100).toFixed(1)}%`;
    const remaining = colorTotal - observed;
    lines.push(`| ${color} | ${observed} | ${colorTotal} | ${pct} | ${remaining} |`);
  }
  lines.push(``);
  lines.push(`## Leaders observed`);
  for (const id of cov.leadersObserved) {
    const l = LEADERS.find((x) => x.id === id);
    lines.push(`- ${id} — ${l?.name ?? '?'} (${(l?.colors ?? []).join('/')})`);
  }
  // Report mirrors to /tmp (driver-private) AND repo (for owner review).
  // The repo copy is only written after the batch completes — not in a
  // hot loop — so it doesn't trigger mid-run HMR reloads.
  writeFileSync(`${ARTIFACT_DIR}/coverage-report.md`, lines.join('\n') + '\n');
  writeFileSync('/Users/minamakar/Developer/optcgsandbox/tools/coverage-report.md', lines.join('\n') + '\n');
}

main().catch(async (e) => { log('UNEXPECTED ERROR:', e); process.exit(2); });
