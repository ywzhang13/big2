// 地聽 API（地聽不用單獨宣告）：第一輪打牌時宣告眼牌（discard + declareEye）＝同時地聽、mj_eye_declared／mj_ting_declared、
// 摸到不能胡自動打出、摸到能胡自動胡（地聽 8 台）、只能打摸到的牌、state 讀得到誰宣告
import { POST as discard } from "../../app/api/mahjong/discard/route";
import { POST as draw } from "../../app/api/mahjong/draw/route";
import { POST as action } from "../../app/api/mahjong/action/route";
import { rooms } from "../support/stub-db";
import { sent } from "../support/stub-broadcast";
import { toPlayerGameState } from "../../lib/mahjong/db";
import type { MahjongGameState, Meld } from "../../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../../lib/mahjong/tiles";
import { asSeat } from "../support/stub-auth";

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
  const r = await fn(new Request("http://x", { method: "POST", headers: asSeat({ roomId: "R", ...body }), body: JSON.stringify({ roomId: "R", ...body }) }));
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
  const opt = view.myAvailableActions?.find((a) => a.type === "declare_eye");
  eq([opt?.tiles?.map((x) => x.display), opt?.ting, view.myAvailableActions?.some((a) => a.type === "declare_ting")], [["z5"], true, false],
    "T1 開局莊家重新整理：myAvailableActions 有 declare_eye（ting=true＝這次宣告同時算地聽），可宣告的出牌只有中；沒有 declare_ting");
  const old = await call(discard, { playerId: "p0", tileId: st().players[0].hand[16].id, declareTing: true });
  const bad = await call(discard, { playerId: "p0", tileId: st().players[0].hand[0].id, declareEye: true });
  eq([old.status, bad.status, bad.body.error, st().tingSeats ?? [], st().eyeSeats ?? [], st().turnCount], [400, 400, "現在不能宣告眼牌，或打出這張後沒有聽牌", [], [], 0],
    "T2 舊的 declareTing 單獨宣告：400；用打出後不會聽牌的 1 萬宣告眼牌：400；狀態都不變");
  const ok = await call(discard, { playerId: "p0", tileId: st().players[0].hand[16].id, declareEye: true });
  eq([ok.status, ok.body.ting, ok.body.eye, st().tingSeats, st().eyeSeats, evs().slice(0, 3), { ...sent[0].payload, sv: undefined }, { ...sent[1].payload, sv: undefined }],
    [200, true, true, [0], [0], ["mj_eye_declared", "mj_ting_declared", "mj_discard"], { seat: 0, tile: st().lastDiscard!.tile, ting: true }, { seat: 0, tile: st().lastDiscard!.tile }],
    "T3 第一輪打出中並宣告眼牌：200（ting、eye 都是 true），同時記地聽；先送 mj_eye_declared(ting:true)、mj_ting_declared，再送 mj_discard");
  const pub = toPlayerGameState(st(), "p2");
  eq([pub.tingSeats, pub.eyeSeats], [[0], [0]], "T4 其他玩家重新整理：公開狀態 tingSeats=[0]、eyeSeats=[0]");
}
{
  // 莊家已地聽（眼牌），摸到不能胡的 9 萬 → 伺服器自動打出
  backToDealer("m9");
  const r = await call(draw, { playerId: "p0" });
  const disc = sent.find((e) => e.event === "mj_discard")!.payload;
  eq([r.status, r.body.autoDiscarded?.display, evs().slice(0, 3), disc.auto, disc.seat, st().players[0].hand.length, st().currentTurn !== 0 || !!st().pendingActions],
    [200, "m9", ["mj_draw", "mj_draw_tile", "mj_discard"], true, 0, 16, true],
    "T5 地聽後摸到不能胡的牌：draw 回 autoDiscarded，廣播 摸牌→mj_discard(auto:true)，手牌回到 16 張、輪到下一家");
}
{
  // 摸到還沒打的狀態（例如重新整理時）：只能打摸到的那張
  const s = st();
  s.currentTurn = 0; s.hasDrawn = true; s.lastDiscard = null; s.pendingActions = undefined;
  const drawn = t("m9"); s.players[0].hand.push(drawn); s.drawnTileId = drawn.id;
  const other = await call(discard, { playerId: "p0", tileId: st().players[0].hand[0].id });
  eq([other.status, other.body.error], [400, "地聽後只能打出摸到的牌"], "T7 地聽後想打別張：400");
  s.players[0].hand.pop(); s.drawnTileId = undefined;
}
{
  backToDealer("s7"); // 摸到能胡的 7 條 → 眼牌自動胡
  const r = await call(draw, { playerId: "p0" });
  const fans = st().winners?.[0].score.fans.map((f) => f.name + f.value);
  eq([r.status, r.body.autoDiscarded, r.body.autoWin, st().status, evs().includes("mj_game_over"), fans, st().settlement?.deltas],
    [200, null, true, "finished", true, ["地聽8", "莊家1", "自摸1"], [900, -300, -300, -300]],
    "T6/T8 摸到能胡的牌：自動自摸；MIGI 地聽8+莊家1+自摸1=10 台（不算門清自摸 3），三家各付 100+10×20=300（眼牌不加台）");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
