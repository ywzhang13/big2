// 地聽 API：打牌時宣告（discard + declareTing）、mj_ting_declared、摸到不能胡自動打出、只能打摸到的牌、state 讀得到誰宣告
import { POST as discard } from "../../app/api/mahjong/discard/route";
import { POST as draw } from "../../app/api/mahjong/draw/route";
import { POST as action } from "../../app/api/mahjong/action/route";
import { rooms } from "../support/stub-db";
import { sent } from "../support/stub-broadcast";
import { toPlayerGameState } from "../../lib/mahjong/db";
import type { MahjongGameState, Meld } from "../../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../../lib/mahjong/tiles";

let nextId = 50000;
const t = (k: string): Tile => ({ id: nextId++, suit: k[0] as TileSuit, rank: parseInt(k.slice(1), 10), display: k });
const tiles = (s: string) => s.split(" ").filter(Boolean).map(t);
const H16 = "m1 m2 m3 m4 m5 m6 p7 p8 p9 s2 s3 s4 z4 z4 s5 s6"; // 聽 1s/4s/7s
const NOT_WAIT = "m1 m1 m3 m4 m6 m7 m8 m9 s1 s3 s5 s9 z1 z2 z3 z6";
function setup() {
  const s = {
    roomCode: "T", status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({ id: "p" + seat, name: "P" + seat, seat, hand: tiles(NOT_WAIT), revealed: [] as Meld[], flowers: [] as Tile[], discards: [] as Tile[], isDealer: seat === 0 })),
    wall: tiles(Array(40).fill("m9").join(" ")), currentTurn: 0, lastDiscard: null, dealerSeat: 0, doorSeat: 0,
    prevalentWind: 1, turnCount: 0, hasDrawn: true, isFirstRound: true, isAfterKong: false, stateVersion: 2,
    roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 },
    roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: 0, initialDealerSeat: 0 }, playerScores: [0, 0, 0, 0],
  } as MahjongGameState;
  s.players[0].hand = tiles(H16 + " z5"); // 莊家 17 張，打出中後聽 1/4/7 條
  s.drawnTileId = s.players[0].hand[16].id;
  rooms.R = { id: "R", code: "T", game_state: s, status: "playing" };
  sent.length = 0;
}
async function call(fn: (r: Request) => Promise<Response>, body: object) {
  const r = await fn(new Request("http://x", { method: "POST", body: JSON.stringify({ roomId: "R", ...body }) }));
  return { status: r.status, body: await r.json() };
}
const st = () => rooms.R.game_state;
const evs = () => sent.map((e) => e.event);
const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
/** 讓輪次回到莊家、牌牆第一張換成 key（模擬繞一圈後莊家摸牌） */
function backToDealer(key: string) {
  const s = st();
  s.currentTurn = 0; s.hasDrawn = false; s.lastDiscard = null; s.pendingActions = undefined; s.turnCount = 8;
  s.wall[0] = t(key);
  sent.length = 0;
}

{
  setup();
  const view = toPlayerGameState(st(), "p0");
  const opt = view.myAvailableActions?.find((a) => a.type === "declare_ting");
  eq(opt?.tiles?.map((x) => x.display), ["z5"], "T1 開局莊家重新整理：myAvailableActions 有 declare_ting，可宣告的出牌只有中");
  const bad = await call(discard, { playerId: "p0", tileId: st().players[0].hand[0].id, declareTing: true });
  eq([bad.status, bad.body.error, st().tingSeats ?? []], [400, "現在不能宣告地聽，或打出這張後沒有聽牌", []], "T2 打出後不會聽牌的 1 萬還宣告：400，狀態不變");
  const ok = await call(discard, { playerId: "p0", tileId: st().players[0].hand[16].id, declareTing: true });
  eq([ok.status, ok.body.ting, st().tingSeats, evs()[0], sent[0].payload, evs()[1]],
    [200, true, [0], "mj_ting_declared", { seat: 0, tile: st().lastDiscard!.tile }, "mj_discard"],
    "T3 打出中並宣告：200，先送 mj_ting_declared { seat:0, tile }，再送 mj_discard");
  eq([toPlayerGameState(st(), "p2").tingSeats], [[0]], "T4 其他玩家重新整理：公開狀態 tingSeats=[0]");
}
{
  // 莊家已地聽，摸到不能胡的 9 萬 → 伺服器自動打出
  backToDealer("m9");
  const r = await call(draw, { playerId: "p0" });
  const disc = sent.find((e) => e.event === "mj_discard")!.payload;
  eq([r.status, r.body.autoDiscarded?.display, evs().slice(0, 3), disc.auto, disc.seat, st().players[0].hand.length, st().currentTurn !== 0 || !!st().pendingActions],
    [200, "m9", ["mj_draw", "mj_draw_tile", "mj_discard"], true, 0, 16, true],
    "T5 地聽後摸到不能胡的牌：draw 回 autoDiscarded，廣播 摸牌→mj_discard(auto:true)，手牌回到 16 張、輪到下一家");
}
{
  backToDealer("s7"); // 摸到能胡的 7 條
  const r = await call(draw, { playerId: "p0" });
  eq([r.status, r.body.autoDiscarded, r.body.canWin, evs().includes("mj_discard")], [200, null, true, false], "T6 摸到能胡的牌：不自動打，canWin=true");
  const other = await call(discard, { playerId: "p0", tileId: st().players[0].hand[0].id });
  eq([other.status, other.body.error], [400, "地聽後只能打出摸到的牌"], "T7 地聽後想打別張：400");
  const w = await call(action, { playerId: "p0", actionType: "win" });
  const fans = st().winners?.[0].score.fans.map((f) => f.name + f.value);
  eq([w.status, fans, st().settlement?.deltas], [200, ["地聽8", "莊家1", "門清自摸3"], [1020, -340, -340, -340]],
    "T8 莊家地聽自摸：地聽8+莊家1+門清自摸3=12 台，三家各付 100+12×20=340");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
