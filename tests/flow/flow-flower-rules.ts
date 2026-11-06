// 熱修兩個規則（老闆 2026-11-07），走真的 API 路由，證明結算台數正確：
//   F1 補花補到的牌自摸：槓上開花有算，結算金額跟著台數正確
//   F2 最後一張（17→16）是花、沒湊成花胡：draw route 直接流局，draw:true，wall 停在 16
import { POST as draw } from "../../app/api/mahjong/draw/route";
import { POST as action } from "../../app/api/mahjong/action/route";
import { rooms } from "../support/stub-db";
import { sent } from "../support/stub-broadcast";
import { paceClock } from "../../lib/mahjong/pace";
import { calculateSettlement } from "../../lib/mahjong/gameLogic";
import type { MahjongGameState, Meld } from "../../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../../lib/mahjong/tiles";
import { asSeat } from "../support/stub-auth";

// 假時鐘：sleep 只記錄要等多久並把時間往前推，不真的等（補花有 1 秒的節奏膠囊）
let now = 2_000_000;
paceClock.now = () => now;
paceClock.sleep = async (ms: number) => { now += ms; };

let nextId = 91000;
const t = (k: string): Tile => ({ id: nextId++, suit: k[0] as TileSuit, rank: parseInt(k.slice(1), 10), display: k });
const tiles = (s: string) => s.split(" ").filter(Boolean).map(t);
// 座位 1 單吊 p5（手上已有 1 張 p5，再摸到 1 張 p5 就胡）
const WIN16 = "m1 m2 m3 m4 m5 m6 m7 m8 m9 s1 s1 s1 s5 s6 s7 p5";
const JUNK16 = "z1 z2 z3 z4 z5 z6 z7 s9 p1 p9 m9 z1 z2 z3 z4 z5";

function setup(wallLen: number, opts: { turn: number; wallFront?: string[]; wallBack?: string[] }) {
  const front = (opts.wallFront ?? []).map(t);
  const back = (opts.wallBack ?? []).map(t);
  const fillerLen = wallLen - front.length - back.length;
  const wall = [...front, ...tiles(Array(fillerLen).fill("s9").join(" ")), ...back];
  const s = {
    roomCode: "T", status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({ id: "p" + seat, name: "P" + seat, seat, hand: tiles(seat === 1 ? WIN16 : JUNK16), revealed: [] as Meld[], flowers: [] as Tile[], discards: tiles("z7"), isDealer: seat === 0 })),
    wall, currentTurn: opts.turn, lastDiscard: null, dealerSeat: 0, doorSeat: 0,
    prevalentWind: 1, turnCount: 8, hasDrawn: false, isFirstRound: false, isAfterKong: false, stateVersion: 2,
    roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 },
    roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: 0, initialDealerSeat: 0 }, playerScores: [0, 0, 0, 0],
  } as MahjongGameState;
  rooms.R = { id: "R", code: "T", game_state: s, status: "playing" };
  sent.length = 0;
}
async function call(fn: (r: Request) => Promise<Response>, body: object) {
  const r = await fn(new Request("http://x", { method: "POST", headers: asSeat({ roomId: "R", ...body }), body: JSON.stringify({ roomId: "R", ...body }) }));
  return { status: r.status, body: await r.json() };
}
const st = () => rooms.R.game_state as MahjongGameState;
const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}

// F1：補花（f1）補到真牌（p5）完成單吊，自摸算槓上開花，結算金額正確（底 100 ＋ 台數×20）
{
  setup(40, { turn: 1, wallFront: ["f1"], wallBack: ["p5"] });
  const d = await call(draw, { playerId: "p1" });
  eq([d.status, st().players[1].flowers.map((x) => x.display), st().isAfterKong, st().drawnTileId === st().players[1].hand.at(-1)?.id],
    [200, ["f1"], true, true], "F1a 補花（補到 p5）：draw route 成功，花進花牌，isAfterKong 標上，補到的真牌在手牌最後");
  const w = await call(action, { playerId: "p1", actionType: "win" });
  eq(w.status, 200, "F1b 自摸：成立");
  const fans = (st().winners![0].score.fans as { name: string; value: number }[]);
  const names = fans.map((f) => f.name);
  eq(names.includes("槓上開花"), true, "F1c 胡牌紀錄的台數裡有槓上開花");
  const totalFan = st().winners![0].score.totalFan as number;
  const settle = calculateSettlement(st());
  // 座位 1 是閒家自摸：閒家（座位 2、3）各付「底＋一般台×台」，莊家（座位 0）多付「莊家(斷)1 台」那份
  const streakFan = 1; // 莊家(斷) 1 台，連莊 0 所以沒有連拉
  const nonDealerPay = 100 + Math.max(0, totalFan - streakFan) * 20;
  const dealerPay = nonDealerPay + streakFan * 20;
  eq(settle.deltas, [-dealerPay, dealerPay + nonDealerPay * 2, -nonDealerPay, -nonDealerPay],
    `F1d 結算：台數 ${totalFan}，座位 0（莊家）付 ${dealerPay}、座位 2／3 各付 ${nonDealerPay}，座位 1 收下三家的總和`);
}

// F2：牌牆 17 張，座位 1 摸最後一張（17→16）是花，沒湊成七搶一／八仙過海：直接流局，不補牌
{
  setup(17, { turn: 1, wallFront: ["f2"] });
  const d = await call(draw, { playerId: "p1" });
  eq([d.status, d.body.draw, st().status, st().wall.length, st().players[1].flowers.map((x) => x.display)],
    [200, true, "finished", 16, ["f2"]], "F2 最後一張是花、沒湊成花胡：draw route 直接回流局，wall 停在 16，不再補牌");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
