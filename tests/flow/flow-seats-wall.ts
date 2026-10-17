// 老闆 2026-10-17：
//   ③ 開局隨機排座位：四人按開始後隨機分配座位，之後照原本從房主擲骰定第一局莊家；
//      LINE 帳號認座位、找回房間（join／my-room）、動作權限都跟著新座位
//   ④ 牌庫：一局結束（胡牌、流局）後，公開狀態和 mj_game_over 帶這局剩下的牌牆（照摸牌順序）；
//      局還在進行時，任何 API 和廣播都拿不到
import { POST as create } from "../../app/api/mahjong/create/route";
import { POST as join } from "../../app/api/mahjong/join/route";
import { POST as start } from "../../app/api/mahjong/start/route";
import { POST as draw } from "../../app/api/mahjong/draw/route";
import { POST as discard } from "../../app/api/mahjong/discard/route";
import { POST as action } from "../../app/api/mahjong/action/route";
import { GET as stateGet } from "../../app/api/mahjong/state/route";
import { GET as myRoom } from "../../app/api/mahjong/my-room/route";
import { rooms, seats, opts } from "../support/stub-db";
import { sent } from "../support/stub-broadcast";
import { tokens } from "../support/stub-auth";
import { toPlayerGameState, toPublicGameState } from "../../lib/mahjong/db";
import { shuffleSeats, startNextGame } from "../../lib/mahjong/gameLogic";
import { paceClock } from "../../lib/mahjong/pace";
import type { MahjongGameState, Meld } from "../../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../../lib/mahjong/tiles";
import { asSeat } from "../support/stub-auth";

opts.autoBind = false;
paceClock.sleep = async () => {}; // 不測節奏

const U = ["a", "b", "c", "d"].map((x) => `${x}${x}${x}${x}1111-0000-4000-8000-000000000000`);
U.forEach((id, i) => (tokens[`s${i}`] = { id, displayName: `LINE${i}`, pictureUrl: null, isGuest: false }));
tokens.sx = { id: "eeee1111-0000-4000-8000-000000000000", displayName: "路人", pictureUrl: null, isGuest: false };

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
const headers = (tok?: string): Record<string, string> => (tok ? { authorization: `Bearer ${tok}` } : {});
async function post(fn: (r: Request) => Promise<Response>, body: object, tok?: string) {
  const r = await fn(new Request("http://x", { method: "POST", headers: headers(tok), body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
}
async function get(fn: (r: Request) => Promise<Response>, url: string, tok?: string) {
  const r = await fn(new Request(url, { headers: headers(tok) }));
  return { status: r.status, body: await r.json() };
}
const P = ["pA", "pB", "pC", "pD"]; // 入座順序：A 房主（mj_players seat 0）、B 1、C 2、D 3

// ===================== ③ 開局隨機排座位 =====================
eq(shuffleSeats(["A", "B", "C", "D"], () => 0), ["B", "C", "D", "A"], "R1 打亂函式（固定亂數＝0）：B C D A");
{
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) seen.add(shuffleSeats(["A", "B", "C", "D"]).join(""));
  eq(seen.size > 12, true, "R2 隨機 200 次：出現多種座位排列（不是固定照入座順序）");
}

let roomId = "", code = "";
{
  const c = await post(create, { hostId: "pA", totalRounds: 1, basePoints: 100, fanPoints: 20 }, "s0");
  roomId = c.body.roomId; code = c.body.code;
  for (let i = 0; i < 4; i++) await post(join, { code, name: `玩家${"ABCD"[i]}`, playerId: P[i] }, `s${i}`);
  const realRandom = Math.random;
  Math.random = () => 0; // 座位：B0 C1 D2 A3；三顆骰子都是 1（和 3）→ 從房主 A（座位 3）算起第 3 家＝座位 1
  const s = await post(start, { roomId, playerId: "pA" }, "s0");
  Math.random = realRandom;
  const gs = rooms[roomId].game_state as MahjongGameState;
  eq([s.status, gs.players.map((p) => p.id), gs.players.map((p) => p.seat)], [200, ["pB", "pC", "pD", "pA"], [0, 1, 2, 3]],
    "R3 開局後座位照打亂結果：B 座位 0、C 1、D 2、房主 A 3");
  eq(gs.players.map((p) => p.userId), [U[1], U[2], U[3], U[0]], "R4 每個座位綁的 LINE 帳號跟著玩家走（不是照入座順序）");
  eq([gs.dice, gs.dealerSeat, gs.doorSeat, gs.roundInfo?.initialDealerSeat], [[1, 1, 1], 1, 1, 1],
    "R5 第一局莊家照原本規則：從房主的新座位（3）擲骰算起，骰 3 → 座位 1（C）當莊、開門");
  eq(seats[roomId].map((p) => [p.player_id, p.seat]), [["pA", 0], ["pB", 1], ["pC", 2], ["pD", 3]], "R6 mj_players 的 seat 不動（只代表入座順序，避免唯一限制衝突）");
}
{
  const re = await post(join, { code, name: "玩家A", playerId: "app-new" }, "s0");
  const mr = await get(myRoom, "http://x/api/mahjong/my-room", "s0");
  eq([re.status, re.body.seat, re.body.playerId, re.body.rejoined, mr.body.room?.seat], [200, 3, "pA", true, 3],
    "R7 房主換 App（新的玩家 id）用房號 join、my-room：都回打亂後的座位 3 和原本的玩家 id");
  const st = await get(stateGet, `http://x/api/mahjong/state?roomId=${roomId}&playerId=pA`, "s0");
  eq([st.status, st.body.gameState?.players?.find((p: { id: string }) => p.id === "pA")?.seat], [200, 3], "R8 state 用原本的玩家 id 看得到自己在座位 3");
  const gs = rooms[roomId].game_state as MahjongGameState;
  const dealerTile = gs.players[1].hand[gs.players[1].hand.length - 1];
  const steal = await post(discard, { roomId, playerId: "pC", tileId: dealerTile.id }, "s0");
  eq(steal.status, 403, "R9 別人（A）拿莊家 C 的玩家 id 打牌：403");
  const ok = await post(discard, { roomId, playerId: "pC", tileId: dealerTile.id }, "s2");
  eq([ok.status, (rooms[roomId].game_state as MahjongGameState).lastDiscard?.from], [200, 1], "R10 莊家 C 本人（座位 1）打第一張：成功");
}

// ===================== ④ 牌庫 =====================
let nextId = 98000;
const t = (k: string): Tile => ({ id: nextId++, suit: k[0] as TileSuit, rank: parseInt(k.slice(1), 10), display: k });
const tiles = (s: string) => s.split(" ").filter(Boolean).map(t);
const NOT_WAIT = "m1 m1 m3 m4 m6 m7 m8 m9 s1 s3 s5 s9 z1 z2 z3 z6";
const WAIT25 = "m3 m4 p1 p2 p3 p4 p5 p6 p7 p8 p9 s1 s2 s3 z1 z1";
function setup(wall: string, hands: Record<number, string> = {}) {
  const s = {
    roomCode: "W", status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({ id: "p" + seat, userId: `u:p${seat}`, name: "P" + seat, seat, hand: tiles(hands[seat] ?? NOT_WAIT), revealed: [] as Meld[], flowers: [] as Tile[], discards: tiles("z7"), isDealer: seat === 0 })),
    wall: tiles(wall), currentTurn: 0, lastDiscard: null, dealerSeat: 0, doorSeat: 0,
    prevalentWind: 1, turnCount: 8, hasDrawn: false, isFirstRound: false, isAfterKong: false, stateVersion: 2,
    roomSettings: { totalRounds: 2, basePoints: 100, fanPoints: 20 },
    roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: 0, initialDealerSeat: 0 }, playerScores: [0, 0, 0, 0],
  } as MahjongGameState;
  rooms.W = { id: "W", code: "W", game_state: s, status: "playing" };
  sent.length = 0;
}
async function call(fn: (r: Request) => Promise<Response>, body: object) {
  const r = await fn(new Request("http://x", { method: "POST", headers: asSeat({ roomId: "W", ...body }), body: JSON.stringify({ roomId: "W", ...body }) }));
  return { status: r.status, body: await r.json() };
}
const W = () => rooms.W.game_state as MahjongGameState;
const WALL20 = Array.from({ length: 20 }, (_, i) => ["m", "p", "s"][i % 3] + ((i % 9) + 1)).join(" ");
{
  setup(WALL20, { 2: WAIT25 });
  const leaks: string[] = [];
  const check = (tag: string) => {
    if ("remainingWall" in toPublicGameState(W()) && toPublicGameState(W()).remainingWall !== undefined) leaks.push(`${tag}:public`);
    for (const id of ["p0", "p1", "p2", "p3"]) if (toPlayerGameState(W(), id).remainingWall !== undefined) leaks.push(`${tag}:${id}`);
    if (sent.some((e) => JSON.stringify(e).includes("remainingWall"))) leaks.push(`${tag}:broadcast`);
  };
  check("開始");
  const d = await call(draw, { playerId: "p0" }); check("摸牌");
  const tile = W().players[0].hand.find((x) => x.id === W().drawnTileId)!;
  await call(discard, { playerId: "p0", tileId: tile.id }); check("打牌");
  const st = await get(stateGet, "http://x/api/mahjong/state?roomId=W&playerId=p1", "as:p1");
  eq([d.status, leaks, st.status, st.body.gameState?.remainingWall], [200, [], 200, undefined],
    "W1 局進行中：公開狀態、四家各自的 state、state API、摸牌和打牌的廣播都沒有牌庫");
}
{
  setup(WALL20, { 2: WAIT25 });
  const s = W(); const m2 = t("m2"); s.players[0].hand.push(m2); s.hasDrawn = true; s.drawnTileId = m2.id;
  const wallBefore = s.wall.map((x) => x.id);
  await call(discard, { playerId: "p0", tileId: m2.id });
  const ref = rooms.W;
  const hu = await call(action, { playerId: "p2", actionType: "win" });
  const fin = ref.game_state as MahjongGameState;
  const over = sent.find((e) => e.event === "mj_game_over")?.payload as { remainingWall?: Tile[] } | undefined;
  eq([hu.status, fin.status, toPublicGameState(fin).remainingWall?.map((x) => x.id), over?.remainingWall?.map((x) => x.id)],
    [200, "finished", wallBefore, wallBefore], "W2 放槍胡、這局結束：公開狀態和 mj_game_over 都帶牌庫，照原本摸牌順序（第 0 張是下一張要摸的）");
  const next = startNextGame(fin);
  eq([next.status, toPublicGameState(next).remainingWall], ["playing", undefined], "W3 下一局開始：牌庫又不公開了");
}
{
  const wall16 = Array.from({ length: 16 }, (_, i) => "s" + ((i % 9) + 1)).join(" ");
  setup(wall16);
  const ids = W().wall.map((x) => x.id);
  const ref = rooms.W;
  const d = await call(draw, { playerId: "p0" }); // 剩 16 張：流局
  const fin = ref.game_state as MahjongGameState;
  const over = sent.find((e) => e.event === "mj_game_over")?.payload as { remainingWall?: Tile[]; winnerSeat?: number } | undefined;
  eq([d.status, fin.status, over?.winnerSeat, over?.remainingWall?.map((x) => x.id), toPublicGameState(fin).remainingWall?.length], [200, "finished", -1, ids, 16],
    "W4 流局：mj_game_over 和公開狀態帶剩下的 16 張，順序不變");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
