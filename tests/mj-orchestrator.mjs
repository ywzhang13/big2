// Mahjong end-to-end test orchestrator
// - Creates a room with 4 API-driven players
// - P1 also joins via Playwright browser (video-recorded) for visual review
// - Strategy: P2/P3/P4 discard tiles that feed P1 toward a winning hand
// - If P1 has dealer-consecutive >= 3, switch target to P2
// - Handles chi/pong/kong/win action windows automatically

import { chromium } from "playwright";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const TOTAL_ROUNDS = Number(process.env.TOTAL_ROUNDS || 1);
const VIDEO_DIR = "./tests/videos";
const LOG_FILE = "./tests/mj-test.log";

mkdirSync(VIDEO_DIR, { recursive: true });
writeFileSync(LOG_FILE, `=== Test run ${new Date().toISOString()} ===\n`);

function log(...args) {
  const line = args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ");
  console.log(line);
  appendFileSync(LOG_FILE, line + "\n");
}

async function api(method, path, body) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body && method === "POST") opts.body = JSON.stringify(body);
  const res = await fetch(BASE + path, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`${method} ${path} → ${res.status}: ${text}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ---------- win check (inlined from lib/mahjong/winCheck.ts) ----------
function toCountMap(tiles) {
  const m = new Map();
  for (const t of tiles) {
    if (t.suit === "f") continue;
    const k = t.suit + t.rank;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}
function canFormMelds(counts, meldsNeeded) {
  if (meldsNeeded === 0) {
    for (const v of counts.values()) if (v !== 0) return false;
    return true;
  }
  let firstKey = null;
  const keys = Array.from(counts.keys()).sort();
  for (const k of keys) if ((counts.get(k) || 0) > 0) { firstKey = k; break; }
  if (firstKey === null) return false;
  const suit = firstKey[0];
  const rank = parseInt(firstKey.slice(1), 10);
  if ((counts.get(firstKey) || 0) >= 3) {
    counts.set(firstKey, counts.get(firstKey) - 3);
    if (canFormMelds(counts, meldsNeeded - 1)) { counts.set(firstKey, counts.get(firstKey) + 3); return true; }
    counts.set(firstKey, counts.get(firstKey) + 3);
  }
  if ((suit === "m" || suit === "p" || suit === "s") && rank <= 7) {
    const k2 = suit + (rank + 1);
    const k3 = suit + (rank + 2);
    if ((counts.get(firstKey) || 0) >= 1 && (counts.get(k2) || 0) >= 1 && (counts.get(k3) || 0) >= 1) {
      counts.set(firstKey, counts.get(firstKey) - 1);
      counts.set(k2, counts.get(k2) - 1);
      counts.set(k3, counts.get(k3) - 1);
      if (canFormMelds(counts, meldsNeeded - 1)) {
        counts.set(firstKey, counts.get(firstKey) + 1);
        counts.set(k2, counts.get(k2) + 1);
        counts.set(k3, counts.get(k3) + 1);
        return true;
      }
      counts.set(firstKey, counts.get(firstKey) + 1);
      counts.set(k2, counts.get(k2) + 1);
      counts.set(k3, counts.get(k3) + 1);
    }
  }
  return false;
}
function isWinningHand(concealed, revealedMelds = 0) {
  const meldsNeeded = 5 - revealedMelds;
  const expected = meldsNeeded * 3 + 2;
  const non = concealed.filter(t => t.suit !== "f");
  if (non.length !== expected) return false;
  const counts = toCountMap(non);
  for (const pk of Array.from(counts.keys())) {
    if ((counts.get(pk) || 0) >= 2) {
      counts.set(pk, counts.get(pk) - 2);
      if (canFormMelds(counts, meldsNeeded)) { counts.set(pk, counts.get(pk) + 2); return true; }
      counts.set(pk, counts.get(pk) + 2);
    }
  }
  return false;
}

// ---------- feeding strategy ----------
function scoreForTarget(tile, targetHand) {
  const counts = new Map();
  for (const t of targetHand) {
    if (t.suit === "f") continue;
    const k = t.suit + t.rank;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const k = tile.suit + tile.rank;
  const same = counts.get(k) || 0;
  let s = 0;
  if (same === 2) s += 100;      // completes triplet (碰 candidate)
  else if (same === 3) s += 60;  // kong candidate
  else if (same === 1) s += 30;  // completes pair
  if (tile.suit === "m" || tile.suit === "p" || tile.suit === "s") {
    const prev1 = counts.get(tile.suit + (tile.rank - 1)) || 0;
    const prev2 = counts.get(tile.suit + (tile.rank - 2)) || 0;
    const next1 = counts.get(tile.suit + (tile.rank + 1)) || 0;
    const next2 = counts.get(tile.suit + (tile.rank + 2)) || 0;
    if (prev1 && next1) s += 80;       // middle of X-Y-Z
    if (prev1 && prev2) s += 70;
    if (next1 && next2) s += 70;
    if (prev1 || next1) s += 20;
  }
  return s;
}

// pick tile to discard from my hand that best feeds target
function pickFeedDiscard(myHand, targetHand, targetRevealedMelds) {
  // If target is ready, try to discard a tile that completes their hand
  for (const t of myHand) {
    if (t.suit === "f") continue;
    const fakeHand = [...targetHand.filter(x => x.suit !== "f"), t];
    if (isWinningHand(fakeHand, targetRevealedMelds)) return t.id;
  }
  // Otherwise, pick highest feeding score
  let best = null, bestScore = -1;
  for (const t of myHand) {
    if (t.suit === "f") continue;
    const s = scoreForTarget(t, targetHand);
    if (s > bestScore) { bestScore = s; best = t; }
  }
  return best ? best.id : myHand.find(t => t.suit !== "f").id;
}

// pick safe discard for target player (self) — discard something useless
function pickSelfDiscard(myHand, myRevealedMelds) {
  const counts = new Map();
  for (const t of myHand) {
    if (t.suit === "f") continue;
    const k = t.suit + t.rank;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  // discard lowest-count tile, preferring honors (z suit, hard to form sequences)
  let best = null, bestScore = Infinity;
  for (const t of myHand) {
    if (t.suit === "f") continue;
    const k = t.suit + t.rank;
    const c = counts.get(k) || 0;
    let s = c * 100;
    if (t.suit === "z") s -= 50;
    // adjacency bonus for keeping sequences
    if (t.suit === "m" || t.suit === "p" || t.suit === "s") {
      for (const d of [-2, -1, 1, 2]) {
        const r = t.rank + d;
        if (r >= 1 && r <= 9) s += (counts.get(t.suit + r) || 0) * 10;
      }
    }
    if (s < bestScore) { bestScore = s; best = t; }
  }
  return best ? best.id : myHand.find(t => t.suit !== "f").id;
}

// ---------- player actors ----------
const PIDS = { p1: randomUUID(), p2: randomUUID(), p3: randomUUID(), p4: randomUUID() };
const PID_LIST = [PIDS.p1, PIDS.p2, PIDS.p3, PIDS.p4];
const NAMES = ["P1", "P2", "P3", "P4"];

let roomId, roomCode;
let target = 0; // seat index of who we want to win (0=P1 initially)

async function getStateFor(seat) {
  return api("GET", `/api/mahjong/state?roomId=${roomId}&playerId=${PID_LIST[seat]}`);
}

function findPongTiles(hand, tile) {
  const matches = hand.filter(t => t.suit === tile.suit && t.rank === tile.rank);
  return matches.length >= 2 ? matches.slice(0, 2) : null;
}
function findKongTiles(hand, tile) {
  const matches = hand.filter(t => t.suit === tile.suit && t.rank === tile.rank);
  return matches.length >= 3 ? matches.slice(0, 3) : null;
}
function findChiTiles(hand, tile) {
  if (tile.suit !== "m" && tile.suit !== "p" && tile.suit !== "s") return null;
  const byRank = new Map();
  for (const t of hand) {
    if (t.suit !== tile.suit) continue;
    if (!byRank.has(t.rank)) byRank.set(t.rank, t);
  }
  const r = tile.rank;
  const combos = [
    [r - 2, r - 1],
    [r - 1, r + 1],
    [r + 1, r + 2],
  ];
  for (const [a, b] of combos) {
    if (byRank.has(a) && byRank.has(b)) return [byRank.get(a), byRank.get(b)];
  }
  return null;
}

async function resolvePendingActions(state) {
  if (!state.pendingActions) return false;
  const { potentialActors, passedActors, discardFrom } = state.pendingActions;
  let acted = false;
  // First pass: have everyone who can win, call win (supports 一炮多響).
  // After all wins, remaining unresolved seats will pass in the loop below.
  const winSeats = [];
  for (const seat of potentialActors) {
    if (passedActors.includes(seat)) continue;
    const playerState = await getStateFor(seat);
    const gs = playerState.gameState;
    const lastDiscard = gs.lastDiscard;
    if (!lastDiscard) continue;
    const hand = gs.hand || [];
    const player = gs.players[seat];
    const revealedMelds = player.revealed.length;
    const testHand = [...hand.filter(t => t.suit !== "f"), lastDiscard.tile];
    if (isWinningHand(testHand, revealedMelds)) {
      try {
        const r = await api("POST", "/api/mahjong/action", {
          roomId, playerId: PID_LIST[seat], actionType: "win"
        });
        log(`  🏆 seat ${seat} WINS on discard ${lastDiscard.tile.display}${r.partial ? " (partial)" : ""}`);
        winSeats.push(seat);
        acted = true;
        if (!r.partial) return "win";
      } catch (e) { log(`  win failed seat ${seat}:`, e.message); }
    }
  }
  if (winSeats.length > 0) {
    // Re-read state and have any non-winning remaining seats pass
    const fresh = await api("GET", `/api/mahjong/state?roomId=${roomId}`);
    if (fresh.gameState?.status === "finished") return "win";
    if (fresh.gameState?.pendingActions) {
      for (const seat of fresh.gameState.pendingActions.potentialActors) {
        if (fresh.gameState.pendingActions.passedActors.includes(seat)) continue;
        try {
          await api("POST", "/api/mahjong/action", { roomId, playerId: PID_LIST[seat], actionType: "pass" });
        } catch {}
      }
    }
    return "win";
  }
  for (const seat of potentialActors) {
    if (passedActors.includes(seat)) continue;
    const playerState = await getStateFor(seat);
    const gs = playerState.gameState;
    const lastDiscard = gs.lastDiscard;
    if (!lastDiscard) continue;
    const hand = gs.hand || [];
    const player = gs.players[seat];
    const revealedMelds = player.revealed.length;
    // (skip win — handled above)
    void revealedMelds;

    // Target player: aggressively claim melds to advance toward 聽
    if (seat === target) {
      // Try kong (4th tile)
      const kong = findKongTiles(hand, lastDiscard.tile);
      if (kong) {
        try {
          await api("POST", "/api/mahjong/action", {
            roomId, playerId: PID_LIST[seat], actionType: "kong",
            tiles: kong.map(t => t.id),
          });
          log(`  seat ${seat} claims KONG on ${lastDiscard.tile.display}`);
          acted = true;
          continue;
        } catch (e) { log(`  kong failed:`, e.message); }
      }
      // Try pong
      const pong = findPongTiles(hand, lastDiscard.tile);
      if (pong) {
        try {
          await api("POST", "/api/mahjong/action", {
            roomId, playerId: PID_LIST[seat], actionType: "pong",
            tiles: pong.map(t => t.id),
          });
          log(`  seat ${seat} claims PONG on ${lastDiscard.tile.display}`);
          acted = true;
          continue;
        } catch (e) { log(`  pong failed:`, e.message); }
      }
      // Try chi (only from previous seat)
      if (discardFrom === (seat + 3) % 4) {
        const chi = findChiTiles(hand, lastDiscard.tile);
        if (chi) {
          try {
            await api("POST", "/api/mahjong/action", {
              roomId, playerId: PID_LIST[seat], actionType: "chi",
              tiles: chi.map(t => t.id),
            });
            log(`  seat ${seat} claims CHI on ${lastDiscard.tile.display}`);
            acted = true;
            continue;
          } catch (e) { log(`  chi failed:`, e.message); }
        }
      }
    }

    // Otherwise pass
    try {
      await api("POST", "/api/mahjong/action", {
        roomId, playerId: PID_LIST[seat], actionType: "pass"
      });
      acted = true;
    } catch (e) {
      log(`  pass failed seat ${seat}:`, e.message);
    }
  }
  return acted;
}

async function playTurn() {
  // Get public state to see whose turn it is
  const publicState = await api("GET", `/api/mahjong/state?roomId=${roomId}`);
  const gs = publicState.gameState;
  if (!gs) return "no-state";
  if (gs.status === "finished") return "finished";

  // Resolve pending actions first
  if (gs.pendingActions) {
    const r = await resolvePendingActions(gs);
    if (r === "win") return "finished";
    return "continue";
  }

  const seat = gs.currentTurn;
  const pid = PID_LIST[seat];

  // Draw if not drawn yet
  if (!gs.hasDrawn) {
    try {
      const drawRes = await api("POST", "/api/mahjong/draw", { roomId, playerId: pid });
      if (drawRes.draw) {
        log("  流局 (wall exhausted)");
        return "finished";
      }
      if (drawRes.canWin) {
        await api("POST", "/api/mahjong/action", { roomId, playerId: pid, actionType: "win" });
        log(`  🏆 seat ${seat} 自摸`);
        // Screenshot the celebration overlay mid-animation for design review
        try {
          const pg = globalThis.__orchPage;
          if (pg) {
            await pg.waitForTimeout(1000);
            await pg.screenshot({ path: `${VIDEO_DIR}/zimo-celebration.png` });
          }
        } catch {}
        return "finished";
      }
    } catch (e) {
      if (e.message && (e.message.includes("已經摸過牌了") || e.message.includes("等待其他玩家動作中"))) {
        await new Promise(r => setTimeout(r, 100));
        return "continue";
      }
      log(`  draw failed seat ${seat}:`, e.message);
      return "error";
    }
  }

  // Discard
  const myState = await getStateFor(seat);
  const myGs = myState.gameState;
  const myHand = myGs.hand || [];
  const myPlayer = myGs.players[seat];

  let tileId;
  if (seat === target) {
    tileId = pickSelfDiscard(myHand, myPlayer.revealed.length);
  } else {
    // Read target's hand to feed
    const tState = await getStateFor(target);
    const tGs = tState.gameState;
    const tHand = tGs.hand || [];
    const tRevealed = tGs.players[target].revealed.length;
    tileId = pickFeedDiscard(myHand, tHand, tRevealed);
  }

  try {
    await api("POST", "/api/mahjong/discard", { roomId, playerId: pid, tileId });
  } catch (e) {
    log(`  discard failed seat ${seat}:`, e.message);
    return "error";
  }
  return "continue";
}

function shanten(hand) {
  // crude estimate: how many tiles away from winning if 16 tiles
  // count pairs + partial melds, cap at "good enough" indicator
  const counts = new Map();
  for (const t of hand) {
    if (t.suit === "f") continue;
    const k = t.suit + t.rank;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let triples = 0, pairs = 0;
  for (const v of counts.values()) {
    triples += Math.floor(v / 3);
    const rem = v % 3;
    if (rem >= 2) pairs += 1;
  }
  return { triples, pairs };
}

async function waitForGameOver(maxTurns = 400) {
  for (let i = 0; i < maxTurns; i++) {
    const r = await playTurn();
    if (r === "finished") return true;
    if (r === "error") return false;
    await new Promise(r => setTimeout(r, 20));
  }
  log("  ⚠️ hit max turns without finishing");
  return false;
}

async function main() {
  // 1. Create room (as P1)
  const created = await api("POST", "/api/mahjong/create", {
    hostId: PIDS.p1, totalRounds: TOTAL_ROUNDS, basePoints: 100, fanPoints: 20,
  });
  roomCode = created.code;
  roomId = created.roomId;
  log(`Room created: code=${roomCode} id=${roomId} rounds=${TOTAL_ROUNDS}`);

  // 2. Join all 4
  for (let i = 0; i < 4; i++) {
    await api("POST", "/api/mahjong/join", {
      code: roomCode, name: NAMES[i], playerId: PID_LIST[i],
    });
  }
  log("All 4 players joined");

  // 3. Launch Playwright for P1 viewing (video)
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 430, height: 932 },
    recordVideo: { dir: VIDEO_DIR, size: { width: 430, height: 932 } },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript((pid) => {
    localStorage.setItem("mj_pid", pid);
    localStorage.setItem("mj_name", "P1");
  }, PIDS.p1);
  const page = await context.newPage();
  globalThis.__orchPage = page;
  page.on("pageerror", (err) => log("  [browser pageerror]", err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") log("  [browser console.error]", msg.text());
  });
  await page.goto(`${BASE}/mahjong#room=${roomCode}`);
  await page.waitForTimeout(1500);

  // 4. Start game
  await api("POST", "/api/mahjong/start", { roomId, playerId: PIDS.p1 });
  log("Game started");
  await page.waitForTimeout(1500);

  // 5. Play rounds
  let gameNum = 1;
  while (true) {
    log(`--- Game ${gameNum} (target seat=${target}) ---`);
    const finished = await waitForGameOver();
    if (!finished) {
      log("Game did not finish cleanly, aborting");
      break;
    }
    // Get final state
    const finalState = await api("GET", `/api/mahjong/state?roomId=${roomId}`);
    const gs = finalState.gameState;
    const winnersArr = gs?.winners ?? (gs?.winner ? [gs.winner] : []);
    if (winnersArr.length > 1) {
      log(`  🔥 一炮${winnersArr.length}響！winners: ${winnersArr.map(w => `seat${w.seat}(${w.score.totalFan}台)`).join(", ")}`);
    } else {
      log(`  winner seat: ${gs?.winner?.seat ?? "draw"}, score: ${gs?.winner?.score?.totalFan ?? 0}台, fans: ${JSON.stringify(gs?.winner?.score?.fans ?? [])}`);
    }
    log(`  scores: ${JSON.stringify(gs?.playerScores)} settlement: ${JSON.stringify(gs?.settlement)}`);
    // Log flowers per player
    for (let s = 0; s < 4; s++) {
      const p = gs.players[s];
      if (p.flowers && p.flowers.length > 0) {
        log(`  seat ${s} flowers: ${p.flowers.map(f=>f.display).join(" ")}`);
      }
    }
    log(`  roundInfo: ${JSON.stringify(gs?.roundInfo)}`);
    // Log P1 final hand for debugging
    try {
      const p1Final = await getStateFor(target);
      const h = p1Final.gameState.hand || [];
      const sh = shanten(h);
      log(`  target(seat ${target}) final hand (${h.length} tiles, triples=${sh.triples} pairs=${sh.pairs}): ${h.map(t=>t.display).join(" ")}`);
    } catch {}

    // Check dealer consecutive for target switching (only while P1 is target)
    const ri = gs?.roundInfo;
    if (ri && target === 0 && ri.dealerConsecutive >= 3 && gs.dealerSeat === 0) {
      target = 1;
      log(`  ⚠️ P1 連${ri.dealerConsecutive}, switching target to P2`);
    }
    // Anti-infinite-loop: if P2 streaks too long, rotate target to next non-P2
    if (target !== 0 && ri && ri.dealerConsecutive >= 3 && gs.dealerSeat === target) {
      target = (target + 1) % 4;
      log(`  ⚠️ seat ${gs.dealerSeat} streaked, rotating target to seat ${target}`);
    }

    if (gs?.gameOver) {
      log("All rounds complete");
      break;
    }

    // Screenshot P1 view at game over
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${VIDEO_DIR}/game${gameNum}-over.png`, fullPage: true });

    // Next game: all 4 click ready
    for (let i = 0; i < 4; i++) {
      await api("POST", "/api/mahjong/next-game", { roomId, playerId: PID_LIST[i] });
    }
    // Wait until new game is playing and current turn is consistent (dealer's first discard)
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(200);
      const s = await api("GET", `/api/mahjong/state?roomId=${roomId}`);
      if (s.gameState?.status === "playing" && s.gameState.players[s.gameState.currentTurn]?.isDealer) break;
    }
    gameNum++;
    if (gameNum > 15) { log("Hit 15-game safety limit"); break; }
  }

  // 6. Close and save video
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${VIDEO_DIR}/final.png`, fullPage: true });
  await context.close();
  await browser.close();
  log("✅ Done");
}

main().catch((e) => {
  log("FATAL", e.stack || e.message);
  process.exit(1);
});
