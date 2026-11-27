// 自動摸牌端到端（老闆 2026-11-27：輪到摸牌卻沒摸到、牌局卡住，現在還會發生）：
// 真的摸牌／打牌／吃碰路由（stub-db）＋真的 AutoDrawer＋真的計時器；前端畫面用「伺服器狀態的副本」模擬，
// 跟 hooks/useMahjong.ts 一樣：該摸牌條件成立就 start、不成立就 stop；sync＝重抓狀態。
//   E1 第一次摸牌回 500：退避後自動補摸成功，只摸一張
//   E2 斷網兩次：退避後補摸成功
//   E3 回應遺失（伺服器摸了、前端沒收到也沒事件）：重送回「已經摸過牌了」→ 重抓狀態 → 停，只摸一張
//   E4 在背景失敗：背景中不重送；回前景 kick 馬上補摸
//   E5 補花：一次請求就補到真牌，不會多摸
//   E6 眼牌：第一次 500，補摸成功，牌牆只少一次摸牌
//   E7 碰完畫面還沒更新：送出的摸牌回「已經摸過牌了」→ 重抓 → 停，手牌、牌牆都沒變
//   全程同時最多一個請求在路上
import { POST as draw } from "../../app/api/mahjong/draw/route";
import { POST as discard } from "../../app/api/mahjong/discard/route";
import { POST as action } from "../../app/api/mahjong/action/route";
import { rooms } from "../support/stub-db";
import { sent } from "../support/stub-broadcast";
import { asSeat } from "../support/stub-auth";
import { AutoDrawer, classifyDrawError, type DrawOutcome } from "../../lib/mahjong/autoDraw";
import type { MahjongGameState, Meld } from "../../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../../lib/mahjong/tiles";

let nextId = 90000;
const t = (k: string): Tile => ({ id: nextId++, suit: k[0] as TileSuit, rank: parseInt(k.slice(1), 10), display: k });
const tiles = (s: string) => s.split(" ").filter(Boolean).map(t);
const JUNK16 = "z1 z2 z3 z4 z5 z6 z7 s9 p1 p9 m9 z1 z2 z3 z4 z5";
const ME = 1;
const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
const st = () => rooms.R.game_state as MahjongGameState;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setup(opts: { wallFront?: string[]; hand?: string; eye?: boolean } = {}) {
  const wall = [...(opts.wallFront ?? []).map(t), ...tiles(Array(40).fill("s9").join(" "))];
  const s = {
    roomCode: "T", status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({ id: "p" + seat, name: "P" + seat, seat, hand: tiles(seat === ME && opts.hand ? opts.hand : JUNK16), revealed: [] as Meld[], flowers: [] as Tile[], discards: tiles("z7"), isDealer: seat === 0 })),
    wall, currentTurn: ME, lastDiscard: null, dealerSeat: 0, doorSeat: 0,
    prevalentWind: 1, turnCount: 8, hasDrawn: false, isFirstRound: false, isAfterKong: false, stateVersion: 2,
    roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 },
    roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: 0, initialDealerSeat: 0 }, playerScores: [0, 0, 0, 0],
    ...(opts.eye ? { eyeSeats: [ME] } : {}),
  } as MahjongGameState;
  rooms.R = { id: "R", code: "T", game_state: s, status: "playing" };
  sent.length = 0;
}
async function call(fn: (r: Request) => Promise<Response>, body: object) {
  const r = await fn(new Request("http://x", { method: "POST", headers: asSeat({ roomId: "R", ...body }), body: JSON.stringify({ roomId: "R", ...body }) }));
  return { status: r.status, text: await r.text() };
}

type Fault = "500" | "net" | "lost" | "pass";
/** 一個前端：畫面狀態＝伺服器狀態的副本（sync 或事件時更新）；faults[n]＝第 n 次摸牌請求怎麼壞 */
function client(faults: Fault[] = []) {
  const snap = () => { const s = st(); return { currentTurn: s.currentTurn, hasDrawn: s.hasDrawn, status: s.status, lastFrom: s.lastDiscard?.from ?? null, myActions: (s.pendingActions?.potentialActors ?? []).includes(ME) && !(s.pendingActions?.passedActors ?? []).includes(ME) }; };
  let ui = snap();
  const stats = { reqs: 0, ok200: 0, inFlight: 0, maxConcurrent: 0, syncs: 0, hidden: false, drawnAt: -1 };
  const t0 = Date.now();
  const should = () => ui.currentTurn === ME && !ui.hasDrawn && ui.status === "playing" && ui.lastFrom !== ME && !ui.myActions;
  const apply = () => { if (should()) drawer.start(); else drawer.stop(); };
  const drawer: AutoDrawer<ReturnType<typeof setTimeout>> = new AutoDrawer({
    now: () => Date.now(),
    isHidden: () => stats.hidden,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (x) => clearTimeout(x),
    sync: () => { stats.syncs++; ui = snap(); apply(); },
    draw: async (): Promise<DrawOutcome> => {
      const n = stats.reqs++;
      stats.inFlight++; stats.maxConcurrent = Math.max(stats.maxConcurrent, stats.inFlight);
      try {
        const f = faults[n] ?? "pass";
        if (f === "net") throw new TypeError("Failed to fetch");
        if (f === "500") throw Object.assign(new Error("Internal Server Error"), { status: 500 });
        const r = await call(draw, { playerId: "p" + ME });
        if (r.status !== 200) throw Object.assign(new Error(r.text), { status: r.status });
        stats.ok200++;
        if (f === "lost") throw new TypeError("Failed to fetch"); // 伺服器摸了，回應和事件都沒到
        stats.drawnAt = Date.now() - t0;
        ui = snap(); apply(); // 回應／私人事件到了：畫面更新
        return "ok";
      } catch (err) {
        return classifyDrawError(err);
      } finally { stats.inFlight--; }
    },
  });
  apply();
  return { stats, drawer, kick: () => drawer.kick(), sync: () => { ui = snap(); apply(); }, stop: () => drawer.stop(), elapsed: () => Date.now() - t0 };
}
const myHand = () => st().players[ME].hand.length;

(async () => {
  // E1 第一次 500
  {
    setup(); const w0 = st().wall.length, h0 = myHand();
    const c = client(["500"]); await wait(4000); c.stop();
    eq([c.stats.reqs, c.stats.ok200, st().hasDrawn, myHand() - h0, w0 - st().wall.length, c.stats.drawnAt > 0 && c.stats.drawnAt < 10000], [2, 1, true, 1, 1, true],
      `E1 第一次摸牌 500：${c.stats.drawnAt}ms 自動補摸成功，只摸一張（請求 2 次、成功 1 次）`);
  }
  // E2 斷網兩次
  {
    setup(); const w0 = st().wall.length;
    const c = client(["net", "net"]); await wait(5500); c.stop();
    eq([c.stats.reqs, c.stats.ok200, st().hasDrawn, w0 - st().wall.length, c.stats.drawnAt >= 3000 && c.stats.drawnAt < 10000], [3, 1, true, 1, true],
      `E2 斷網兩次：退避 1、2 秒後 ${c.stats.drawnAt}ms 補摸成功（3～10 秒內）`);
  }
  // E3 回應遺失
  {
    setup(); const w0 = st().wall.length, h0 = myHand();
    const c = client(["lost"]); await wait(4500); c.stop();
    eq([c.stats.ok200, myHand() - h0, w0 - st().wall.length, c.stats.syncs >= 1, c.stats.reqs], [1, 1, 1, true, 2],
      "E3 回應遺失：重送回「已經摸過牌了」→ 重抓狀態 → 停；伺服器只發一張");
  }
  // E4 背景
  {
    setup(); const w0 = st().wall.length;
    const c = client(["500"]); c.stats.hidden = true;
    await wait(4000);
    const reqsHidden = c.stats.reqs, drawnHidden = st().hasDrawn;
    c.stats.hidden = false; const back = c.elapsed(); c.kick(); await wait(800); c.stop();
    eq([reqsHidden, drawnHidden, st().hasDrawn, w0 - st().wall.length, c.stats.drawnAt - back < 800], [1, false, true, 1, true],
      `E4 在背景失敗：背景 4 秒只送 1 次、不重送；回前景 kick 後 ${c.stats.drawnAt - back}ms 補摸成功`);
  }
  // E5 補花
  {
    setup({ wallFront: ["f1"] }); const w0 = st().wall.length, h0 = myHand();
    const c = client(); await wait(5500); c.stop();
    const p = st().players[ME];
    eq([c.stats.reqs, c.stats.ok200, p.flowers.map((x) => x.display), myHand() - h0, w0 - st().wall.length, st().hasDrawn], [1, 1, ["f1"], 1, 2, true],
      "E5 補花：一次請求就補到真牌（花進花牌、手牌多 1、牌牆少 2），沒有多摸");
  }
  // E6 眼牌
  {
    setup({ eye: true }); const w0 = st().wall.length;
    const c = client(["500"]); await wait(8000); c.stop();
    const discards = st().players[ME].discards.length;
    eq([c.stats.ok200, w0 - st().wall.length, c.stats.maxConcurrent], [1, 1, 1],
      `E6 眼牌：第一次 500，補摸成功一次、牌牆只少 1（之後伺服器自動打出，打出 ${discards - 1} 張）`);
  }
  // E7 碰完畫面還沒更新
  {
    setup({ hand: "p5 p5 z1 z2 z3 z4 z5 z6 z7 s9 p1 p9 m9 z1 z2 z3" });
    const s = st(); s.currentTurn = 0; s.hasDrawn = true;
    const x = t("p5"); s.players[0].hand.push(x); s.drawnTileId = x.id;
    await call(discard, { playerId: "p0", tileId: x.id });
    const pong = await call(action, { playerId: "p" + ME, actionType: "pong", tiles: st().players[ME].hand.filter((y) => y.display === "p5").map((y) => y.id) });
    const w0 = st().wall.length, h0 = myHand();
    // 碰的事件還沒到：畫面停在「輪到我、還沒摸」→ 自動摸牌啟動
    const c2 = client();
    const s2 = st(); const realDrawn = s2.hasDrawn; s2.hasDrawn = false; c2.sync(); s2.hasDrawn = realDrawn;
    await wait(1500); c2.stop();
    eq([pong.status, c2.stats.ok200, myHand() - h0, w0 - st().wall.length, c2.stats.syncs >= 1], [200, 0, 0, 0, true],
      "E7 碰完、畫面還沒更新：送出的摸牌回「已經摸過牌了」→ 重抓狀態 → 停；手牌、牌牆都沒變");
  }
  console.log(results.join("\n"));
  if (results.some((r) => r.startsWith("❌"))) process.exit(1);
  process.exit(0);
})();
