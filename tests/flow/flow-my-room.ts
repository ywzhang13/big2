// 換 Safari／主畫面 App（同一個 LINE 帳號、不同玩家 id）接回原本座位（2026-10-16 房 5878：SHAN 卡在下一局）
//   M1 my-room：沒登入 401；遊客、沒坐下的人回 null；坐著的人拿到房號和座位
//   M2 用房號 join：認帳號回到原本座位、沿用原本的玩家 id，局數、連莊、已同意下一局都保留
//   M3 用原本的玩家 id 按下一局：四家到齊照常開局；拿不到別人的座位
import { POST as join } from "../../app/api/mahjong/join/route";
import { POST as nextGame } from "../../app/api/mahjong/next-game/route";
import { GET as myRoom } from "../../app/api/mahjong/my-room/route";
import { rooms, seats } from "../support/stub-db";
import { tokens } from "../support/stub-auth";
import type { MahjongGameState, Meld } from "../../lib/mahjong/gameState";
import type { Tile } from "../../lib/mahjong/tiles";

const U = ["a", "b", "c", "d"].map((x) => `${x}${x}${x}${x}0000-0000-4000-8000-000000000000`);
U.forEach((id, i) => (tokens[`line${i}`] = { id, displayName: `LINE${i}`, pictureUrl: null, isGuest: false }));
tokens.outsider = { id: "eeee0000-0000-4000-8000-000000000000", displayName: "路人", pictureUrl: null, isGuest: false };
tokens.guest = { id: "ffff0000-0000-4000-8000-000000000000", displayName: null, pictureUrl: null, isGuest: true };

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
async function get(tok?: string) {
  const r = await myRoom(new Request("http://x/api/mahjong/my-room", { headers: headers(tok) }));
  return { status: r.status, body: await r.json() };
}

// 和 5878 一樣：2 圈、第 2 圈第 1 局打完（finished），三家已同意下一局、等座位 0
let nid = 30000;
const t = (k: string): Tile => ({ id: nid++, suit: k[0] as Tile["suit"], rank: parseInt(k.slice(1), 10), display: k });
const P = ["p0", "p1", "p2", "p3"];
const state = {
  roomCode: "5878", status: "finished",
  players: P.map((id, seat) => ({ id, userId: U[seat], name: "P" + seat, seat, hand: [t("m1")], revealed: [] as Meld[], flowers: [] as Tile[], discards: [] as Tile[], isDealer: seat === 3 })),
  wall: [], currentTurn: 3, lastDiscard: null, dealerSeat: 3, doorSeat: 3, prevalentWind: 2, turnCount: 30,
  hasDrawn: false, isFirstRound: false, isAfterKong: false, stateVersion: 526,
  roomSettings: { totalRounds: 2, basePoints: 100, fanPoints: 20 },
  roundInfo: { currentRound: 2, currentGame: 1, dealerConsecutive: 2, initialDealerSeat: 3 },
  playerScores: [-680, 340, 680, -340],
  winner: { seat: 2, from: 3, score: { fans: [], totalFan: 2 } },
  nextGameReady: ["p1", "p2", "p3"],
} as unknown as MahjongGameState;
rooms.R = { id: "R", code: "5878", game_state: state, status: "finished", updated_at: "2026-10-16T14:59:56Z" };
seats.R = P.map((player_id, seat) => ({ player_id, name: "P" + seat, seat, user_id: U[seat] }));
// 同一個人另一間比較舊、還在等人的房：my-room 要回最近有動靜的那間
rooms.OLD = { id: "OLD", code: "1111", game_state: null as unknown as MahjongGameState, status: "waiting", updated_at: "2026-10-16T13:00:00Z" };
seats.OLD = [{ player_id: "old0", name: "P0", seat: 2, user_id: U[0] }];

{
  eq((await get()).status, 401, "M1a my-room 沒登入：401");
  eq((await get("guest")).body, { room: null }, "M1b 遊客：不提供（null）");
  eq((await get("outsider")).body, { room: null }, "M1c 沒坐在任何房的帳號：null");
  eq((await get("line0")).body, { room: { code: "5878", status: "finished", seat: 0 } }, "M1d 坐著的人：拿到最近有動靜那間的房號、狀態、座位");
}
{
  const before = JSON.stringify(rooms.R.game_state);
  const j = await post(join, { code: "5878", name: "SHAN", playerId: "app-new-id" }, "line0");
  eq([j.status, j.body.seat, j.body.playerId, j.body.rejoined, seats.R.length], [200, 0, "p0", true, 4], "M2a 主畫面 App（新的玩家 id）用房號 join：回到座位 0、沿用原本的玩家 id p0，不多佔位子");
  eq(JSON.stringify(rooms.R.game_state) === before, true, "M2b join 不改牌局：圈局、連莊 2、已同意 p1～p3 都保留");
  const steal = await post(join, { code: "5878", name: "冒名", playerId: "p0" }, "outsider");
  eq([steal.status, steal.body.error], [403, "not_your_seat"], "M2c 別的帳號拿 p0 join：403");
}
{
  const wrongId = await post(nextGame, { roomId: "R", playerId: "app-new-id" }, "line0");
  eq(wrongId.status, 403, "M3a 沒換回原本玩家 id（還用 App 的新 id）按下一局：403（前端要用 join 回傳的 playerId）");
  const other = await post(nextGame, { roomId: "R", playerId: "p0" }, "line1");
  eq([other.status, rooms.R.game_state.nextGameReady], [403, ["p1", "p2", "p3"]], "M3b 別人拿 p0 按下一局：403，已同意名單不變");
  const ok = await post(nextGame, { roomId: "R", playerId: "p0" }, "line0");
  const gs = rooms.R.game_state;
  eq([ok.status, ok.body.started, gs.status, gs.nextGameReady, gs.roundInfo?.currentRound, gs.roundInfo?.currentGame, gs.dealerSeat],
    [200, true, "playing", [], 2, 2, 0], "M3c 用 join 拿回的 p0 按下一局：四家到齊照常開局（莊家 3 下莊 → 第 2 圈第 2 局、莊家 0）");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
