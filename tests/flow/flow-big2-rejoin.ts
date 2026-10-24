// 大老二開局後重新整理（或用 #room= 連結）回到牌桌：POST /api/game/join 先認原座位、再看房間狀態（2026-10-25）
//   R1 playing 中 4 個原玩家重新加入：回原座位和 roomId（rejoined），/api/game/state 拿到的手牌和存檔一致；不廣播 player_joined、不多坐人
//   R2 開局後（playing、ready_check）陌生人加入：409 game_in_progress（附可讀的 message），座位不動、不廣播
//   R3 等人時退出後用房號再進來＝新加入（照舊）；退出後牌局開打，同一個人再加入：409 game_in_progress
//   R4 finished（打完一場、等繼續）原玩家重新加入：回原座位，state 是 finished、手牌一致；陌生人照樣擋
//   R5 等人階段的加入不變：依序坐空位、廣播 player_joined；滿 4 人 400 房間已滿；缺欄位 400；房號不存在 404
import { POST as join } from "../../app/api/game/join/route";
import { GET as state } from "../../app/api/game/state/route";
import { POST as leave } from "../../app/api/game/leave/route";
import { sent } from "../support/stub-broadcast";
import * as rs from "../support/stub-records-store";
import { extra } from "../support/stub-big2-leave-store";
import { dealAndStart } from "../../lib/deal-and-start";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
const post = (fn: (r: Request) => Promise<Response>, url: string, body: unknown) =>
  fn(new Request(`http://x${url}`, { method: "POST", body: JSON.stringify(body) })).then(async (r) => ({ status: r.status, body: await r.json() }));
const doJoin = (code: string, playerId: string) => post(join, "/api/game/join", { code, playerId, name: "N" + playerId });
const doLeave = (roomId: string, playerId: string) => post(leave, "/api/game/leave", { roomId, playerId });
const getState = async (roomId: string, playerId: string) => {
  const url = `http://x/api/game/state?roomId=${roomId}&playerId=${playerId}`;
  // 測試裡 next/server 換成了替身：路由只用到 nextUrl，自己補上
  const r = await state(Object.assign(new Request(url), { nextUrl: new URL(url) }) as unknown as Parameters<typeof state>[0]);
  return { status: r.status, body: await r.json() };
};
const pids = (id: string) => rs.big2Rooms[id]?.players.map((p) => p.player_id);
const joined = () => sent.filter((e) => e.event === "player_joined");
let n = 0;
/** 空的等人房（房主 host 還沒坐下，和 create 之後一樣） */
function emptyRoom(host: string) {
  const id = "RJ" + ++n, code = String(6100 + n);
  rs.big2Rooms[id] = { room: { id, code, status: "waiting", created_at: "2026-10-25T10:00:00Z", records_enabled: true, scores: null, updated_at: "2026-10-25T10:00:00Z", row_version: 1 }, players: [] };
  extra[id] = { host_id: host, ready_players: [] };
  return { id, code };
}
/** 4 個人用房號加入、發牌開打（和正式流程一樣走 join → dealAndStart） */
async function playingRoom(ps: string[]) {
  const r = emptyRoom(ps[0]);
  for (const p of ps) await doJoin(r.code, p);
  rs.big2Rooms[r.id].room.status = "ready_check";
  await dealAndStart(r.id, r.code);
  return r;
}
const handsOf = (id: string) => Object.fromEntries(rs.big2Rooms[id].players.map((p) => [p.player_id, JSON.stringify(p.hand)]));

// R1
{
  const ps = ["a0", "a1", "a2", "a3"];
  const r = await playingRoom(ps);
  const before = handsOf(r.id);
  const seats = Object.fromEntries(rs.big2Rooms[r.id].players.map((p) => [p.player_id, p.seat]));
  sent.length = 0;
  const xs = [];
  for (const p of ps) {
    const j = await doJoin(r.code, p);
    const s = await getState(r.id, p);
    xs.push([j.status, j.body.seat === seats[p], j.body.roomId === r.id, j.body.rejoined, s.status, s.body.status, s.body.mySeat === seats[p], JSON.stringify(s.body.myHand) === before[p], s.body.myHand.length]);
  }
  eq([rs.big2Rooms[r.id].room.status, xs, joined().length, pids(r.id).length, JSON.stringify(handsOf(r.id)) === JSON.stringify(before)],
    ["playing", ps.map(() => [200, true, true, true, 200, "playing", true, true, 13]), 0, 4, true],
    "R1 playing 中 4 個原玩家重新加入：都回原座位和 roomId（rejoined），state 是 playing、mySeat 一樣、myHand 和存檔一致（13 張）；不廣播 player_joined、不多坐人、手牌沒被動");
}
// R2
{
  const r = await playingRoom(["b0", "b1", "b2", "b3"]);
  const before = handsOf(r.id);
  const w = emptyRoom("c0");
  for (const p of ["c0", "c1", "c2", "c3"]) await doJoin(w.code, p);
  rs.big2Rooms[w.id].room.status = "ready_check";
  sent.length = 0;
  const x = await doJoin(r.code, "zz");
  const y = await doJoin(w.code, "zz");
  const s = await getState(r.id, "zz");
  eq([x.status, x.body.error, x.body.message, y.status, y.body.error, pids(r.id), pids(w.id).length, JSON.stringify(handsOf(r.id)) === JSON.stringify(before), joined().length, s.status],
    [409, "game_in_progress", "房間已開始遊戲，無法加入", 409, "game_in_progress", ["b0", "b1", "b2", "b3"], 4, true, 0, 403],
    "R2 開局後陌生人 zz 加入：playing、ready_check 都 409 game_in_progress（message「房間已開始遊戲，無法加入」）；座位、手牌不動、不廣播；state 照舊 403");
}
// R3
{
  const r = emptyRoom("d0");
  for (const p of ["d0", "d1", "d2", "d3"]) await doJoin(r.code, p);
  const lv1 = await doLeave(r.id, "d2");
  sent.length = 0;
  const back = await doJoin(r.code, "d2"); // 等人時退出後用房號再進來：新加入
  const ev = joined().map((e) => e.payload);
  const lv2 = await doLeave(r.id, "d2");
  await doJoin(r.code, "d4"); // 別人補上空位
  rs.big2Rooms[r.id].room.status = "ready_check";
  await dealAndStart(r.id, r.code);
  sent.length = 0;
  const x = await doJoin(r.code, "d2");
  eq([lv1.status, back.status, back.body.seat, back.body.rejoined, ev, lv2.status, rs.big2Rooms[r.id].room.status, x.status, x.body.error, pids(r.id), joined().length],
    [200, 200, 2, undefined, [{ playerId: "d2", name: "Nd2", seat: 2, playerCount: 4 }], 200, "playing", 409, "game_in_progress", ["d0", "d1", "d3", "d4"], 0],
    "R3 等人時 d2 退出、用房號再進來＝新加入（廣播 player_joined、沒有 rejoined）；再退出、d4 補位開打後 d2 再加入：409 game_in_progress，座位不動");
}
// R4
{
  const ps = ["e0", "e1", "e2", "e3"];
  const r = await playingRoom(ps);
  rs.big2Rooms[r.id].room.status = "finished"; // 打完一場、等四家按繼續
  rs.big2Rooms[r.id].players[1].hand = []; // 有人出完牌
  const before = handsOf(r.id);
  const seats = Object.fromEntries(rs.big2Rooms[r.id].players.map((p) => [p.player_id, p.seat]));
  sent.length = 0;
  const xs = [];
  for (const p of ps) {
    const j = await doJoin(r.code, p);
    const s = await getState(r.id, p);
    xs.push([j.status, j.body.seat === seats[p], j.body.rejoined, s.body.status, s.body.mySeat === seats[p], JSON.stringify(s.body.myHand) === before[p]]);
  }
  const x = await doJoin(r.code, "zz");
  eq([xs, x.status, x.body.error, pids(r.id).length, joined().length],
    [ps.map(() => [200, true, true, "finished", true, true]), 409, "game_in_progress", 4, 0],
    "R4 finished（打完一場、等繼續）4 個原玩家重新加入：回原座位，state 是 finished、手牌一致（含出完牌的空手）；陌生人照樣 409");
}
// R5
{
  const r = emptyRoom("f0");
  sent.length = 0;
  const js = [];
  for (const p of ["f0", "f1", "f2", "f3"]) js.push(await doJoin(r.code, p));
  const again = await doJoin(r.code, "f1"); // 等人時重新整理：原座位
  const full = await doJoin(r.code, "f4");
  const miss = await post(join, "/api/game/join", { code: r.code, playerId: "f5" });
  const none = await doJoin("0000", "f5");
  eq([js.map((x) => [x.status, x.body.seat]), joined().map((e) => e.payload.playerCount), [again.status, again.body.seat, again.body.roomId === r.id], [full.status, full.body.error], miss.status, none.status, pids(r.id)],
    [[[200, 0], [200, 1], [200, 2], [200, 3]], [1, 2, 3, 4], [200, 1, true], [400, "房間已滿"], 400, 404, ["f0", "f1", "f2", "f3"]],
    "R5 等人階段加入不變：依序坐 0～3、廣播 player_joined；原玩家再進來回原座位；第 5 人 400 房間已滿；缺欄位 400；房號不存在 404");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
process.exit(0);
