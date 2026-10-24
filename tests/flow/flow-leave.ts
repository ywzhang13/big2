// 等人階段退出房間（老闆 2026-10-24）：麻將 POST /api/mahjong/leave、大老二 POST /api/game/leave
//   L1 麻將一般成員退出：200、座位空出來、廣播 mj_player_left（playerCount、hostId），房主不變
//   L2 麻將房主退出：房主交給最早加入、還在房裡的人（依加入先後，不是座位號）
//   L3 麻將最後一人退出：關房（不寫對局紀錄）
//   L4 麻將開局後退出：409 game_in_progress，座位和牌局不動
//   L5 麻將退出後 my-room 不再回這間房；用房號再加入是新加入（不是 rejoined）
//   L6 麻將重複退出 404 not_in_room；沒登入 401；缺 roomId 400
//   L7 麻將退出和開局同時送：只有一邊成功，不會開出少一人的局
//   B1～B6 大老二：一般成員退出、房主轉交、準備確認中退出（取消準備）、最後一人關房、開打後 409、重複退出 404
//   L8／L9 麻將刪掉座位後條件寫入失敗（一般錯誤 500、連續 5 次版本衝突 409）：座位補回去、房主不變（審伯 2026-10-24）
//   B7 大老二發牌讀完座位、改房間狀態前有人退出：不開局（房間仍 waiting、剩 3 人、沒有 game_start）（審伯 2026-10-24）
//   B8 大老二正常發牌、下一場（continue 從 finished）照常開局；狀態不對不開局
import { POST as leave } from "../../app/api/mahjong/leave/route";
import { POST as start } from "../../app/api/mahjong/start/route";
import { POST as join } from "../../app/api/mahjong/join/route";
import { GET as myRoom } from "../../app/api/mahjong/my-room/route";
import { POST as big2Leave } from "../../app/api/game/leave/route";
import { rooms, seats, leaveFaults } from "../support/stub-db";
import { sent } from "../support/stub-broadcast";
import * as rs from "../support/stub-records-store";
import { extra as big2Extra } from "../support/stub-big2-leave-store";
import { dealHooks } from "../support/stub-big2-deal-store";
import { dealAndStart } from "../../lib/deal-and-start";
import type { MahjongGameState } from "../../lib/mahjong/gameState";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
const as = (pid: string) => ({ authorization: `Bearer as:${pid}`, "content-type": "application/json" });
const mjLeave = async (roomId: string | undefined, pid?: string) => {
  const r = await leave(new Request("http://x/api/mahjong/leave", { method: "POST", headers: pid ? as(pid) : {}, body: JSON.stringify(roomId ? { roomId } : {}) }));
  return { status: r.status, body: await r.json() };
};
const mine = async (pid: string) => (await (await myRoom(new Request("http://x/api/mahjong/my-room", { headers: as(pid) }))).json()).room;
let n = 0;
/** 等人中的麻將房：order＝加入先後（陣列順序就是 created_at 先後） */
function mjRoom(order: [string, number][], host = order[0]?.[0], status = "waiting", gs: unknown = null) {
  const id = "LV" + ++n, code = String(7000 + n);
  rooms[id] = { id, code, status, host_id: host, game_state: gs as MahjongGameState, updated_at: "2026-10-24T10:00:00Z" };
  seats[id] = order.map(([pid, seat]) => ({ player_id: pid, name: "N" + pid, seat, user_id: `u:${pid}` }));
  return { id, code };
}
const left = () => sent.filter((e) => e.event === "mj_player_left").map((e) => e.payload);

// L1
{
  const r = mjRoom([["a0", 0], ["a1", 1], ["a2", 2], ["a3", 3]]);
  sent.length = 0;
  const x = await mjLeave(r.id, "a2");
  eq([x.status, x.body.ok, seats[r.id].map((p) => p.player_id), rooms[r.id].host_id, left()], [200, true, ["a0", "a1", "a3"], "a0", [{ playerId: "a2", seat: 2, playerCount: 3, hostId: "a0" }]],
    "L1 麻將一般成員 a2 退出：200 ok，座位 2 空出來，房主仍是 a0，廣播 mj_player_left");
}
// L2
{
  const r = mjRoom([["b0", 0], ["b3", 3], ["b1", 1], ["b2", 2]]); // b3 比 b1 早加入（坐在 3 號是因為中間有人退出又補位）
  sent.length = 0;
  const x = await mjLeave(r.id, "b0");
  eq([x.status, x.body.hostId, rooms[r.id].host_id, left()[0]?.hostId, seats[r.id].length], [200, "b3", "b3", "b3", 3],
    "L2 麻將房主 b0 退出：房主交給最早加入的 b3（不是座位號最小的 b1），廣播帶新房主");
}
// L3
{
  const r = mjRoom([["c0", 0]]);
  sent.length = 0;
  const recs = rs.records.length;
  const x = await mjLeave(r.id, "c0");
  eq([x.status, x.body.closed, !!rooms[r.id], rs.deleted.some((d) => d.roomId === r.id), rs.records.length - recs], [200, true, false, true, 0],
    "L3 麻將最後一人退出：關房（房間刪掉），不寫對局紀錄");
}
// L4
{
  const gs = { status: "playing", stateVersion: 3, players: [0, 1, 2, 3].map((s) => ({ id: "d" + s, seat: s, name: "N", hand: [] })) };
  const r = mjRoom([["d0", 0], ["d1", 1], ["d2", 2], ["d3", 3]], "d0", "playing", gs);
  const before = JSON.stringify([rooms[r.id], seats[r.id]]);
  const x = await mjLeave(r.id, "d1");
  eq([x.status, x.body.error, JSON.stringify([rooms[r.id], seats[r.id]]) === before], [409, "game_in_progress", true],
    "L4 麻將開局後退出：409 game_in_progress，座位和牌局都沒動（照舊走投票離開）");
}
// L5
{
  const r = mjRoom([["e0", 0], ["e1", 1]]);
  const b4 = await mine("e1");
  await mjLeave(r.id, "e1");
  const after = await mine("e1");
  const rj = await join(new Request("http://x", { method: "POST", headers: as("e1"), body: JSON.stringify({ code: r.code, name: "Ne1", playerId: "e1x" }) }));
  const rb = await rj.json();
  eq([b4?.code, after, rj.status, rb.rejoined ?? false, rb.playerId, seats[r.id].length], [r.code, null, 200, false, "e1x", 2],
    "L5 麻將 e1 退出前 my-room 回這間房、退出後回 null；用房號再加入是新加入（新的玩家 id、不是 rejoined）");
}
// L6
{
  const r = mjRoom([["f0", 0], ["f1", 1]]);
  const a = await mjLeave(r.id, "f1");
  const b = await mjLeave(r.id, "f1");
  const c = await mjLeave(r.id);
  const d = await mjLeave(undefined, "f0");
  const e = await mjLeave("no-such-room", "f0");
  eq([a.status, b.status, b.body.error, c.status, d.status, e.status], [200, 404, "not_in_room", 401, 400, 404],
    "L6 麻將重複退出 404 not_in_room；沒登入 401；缺 roomId 400；房間不存在 404");
}
// L7
{
  let consistent = 0, leaveWon = 0, startWon = 0;
  for (let i = 0; i < 24; i++) {
    const r = mjRoom([["g0", 0], ["g1", 1], ["g2", 2], ["g3", 3]], "g0", "waiting", { roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 } }); // 有設定的大廳（stub 的開局要讀 stateVersion）
    const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
    const [lv, st] = await Promise.all([
      sleep(i % 3 === 1 ? 30 : 0).then(() => mjLeave(r.id, "g2")), // 三種：退出先送、開局先送、同時送（最容易出事的情況）
      sleep(i % 3 === 0 ? 30 : 0).then(() => start(new Request("http://x", { method: "POST", headers: as("g0"), body: JSON.stringify({ roomId: r.id, playerId: "g0" }) })).then(async (x) => ({ status: x.status }))),
    ]);
    const room = rooms[r.id], s = room?.game_state as MahjongGameState | null;
    const started = room?.status === "playing" || room?.status === "finished";
    const ok = started
      ? lv.status === 409 && s!.players.length === 4 && seats[r.id].length === 4 && s!.players.some((p) => p.id === "g2")
      : lv.status === 200 && st.status === 400 && seats[r.id].length === 3;
    if (started) startWon++; else leaveWon++;
    if (ok) consistent++; else console.error("L7 不一致", i, JSON.stringify({ started, status: room?.status, lv, st, seats: seats[r.id]?.length, players: s?.players?.length }));
  }
  eq([consistent, leaveWon + startWon, leaveWon > 0 && startWon > 0], [24, 24, true], `L7 麻將退出和開局送 24 次（退出先、開局先、同時各 8 次）（退出贏 ${leaveWon}、開局贏 ${startWon}）：每次都只有一邊成功，開局的牌局一定 4 人都在、退出的一定沒開局`);
}

// L8／L9：刪掉座位後條件寫入失敗 → 座位補回去、房主不變
{
  const r = mjRoom([["m0", 0], ["m1", 1], ["m2", 2]]); // m0 是房主，退出會觸發轉交
  leaveFaults.claimError = 1;
  const x = await mjLeave(r.id, "m0");
  leaveFaults.claimError = 0;
  const s8 = seats[r.id].find((p) => p.player_id === "m0");
  eq([x.status, !!s8, s8?.seat, s8?.user_id, seats[r.id].length, rooms[r.id].host_id], [500, true, 0, "u:m0", 3, "m0"],
    "L8 麻將房主 m0 退出時條件寫入丟一般錯誤：回 500、座位 0 補回去（帳號不變）、房主仍是 m0");
}
{
  const r = mjRoom([["n0", 0], ["n1", 1], ["n2", 2]]);
  sent.length = 0;
  leaveFaults.conflicts = 5;
  const x = await mjLeave(r.id, "n0");
  leaveFaults.conflicts = 0;
  const s9 = seats[r.id].find((p) => p.player_id === "n0");
  eq([x.status, !!s9, s9?.seat, seats[r.id].length, rooms[r.id].host_id, left().length], [409, true, 0, 3, "n0", 0],
    "L9 麻將房主 n0 退出時連續 5 次版本衝突：回 409、座位 0 補回去、房主仍是 n0、沒有廣播 mj_player_left");
}

// ---------------- 大老二 ----------------
let m = 0;
function b2Room(order: [string, number][], host = order[0]?.[0], status = "waiting", scores: Record<string, number> | null = null) {
  const id = "B2LV" + ++m, code = String(8000 + m);
  rs.big2Rooms[id] = { room: { id, code, status, created_at: "2026-10-24T10:00:00Z", records_enabled: true, scores, updated_at: "2026-10-24T10:00:00Z", row_version: 5 }, players: order.map(([pid, seat]) => ({ player_id: pid, name: "N" + pid, seat, hand: [] })) };
  big2Extra[id] = { host_id: host ?? null, ready_players: status === "ready_check" ? order.slice(0, 2).map((o) => o[0]) : [] };
  return { id, code };
}
const b2 = async (roomId: string, playerId?: string) => {
  const r = await big2Leave(new Request("http://x/api/game/leave", { method: "POST", body: JSON.stringify({ roomId, playerId }) }));
  return { status: r.status, body: await r.json() };
};
const b2left = () => sent.filter((e) => e.event === "player_left").map((e) => e.payload);
const pids = (id: string) => rs.big2Rooms[id]?.players.map((p) => p.player_id);
{
  const r = b2Room([["h0", 0], ["h1", 1], ["h2", 2]]);
  sent.length = 0;
  const x = await b2(r.id, "h1");
  eq([x.status, x.body.ok, pids(r.id), big2Extra[r.id].host_id, b2left()], [200, true, ["h0", "h2"], "h0", [{ playerId: "h1", seat: 1, playerCount: 2, hostId: "h0", readyCheckCancelled: false }]],
    "B1 大老二一般成員 h1 退出：200 ok，座位空出來，房主仍是 h0，廣播 player_left");
}
{
  const r = b2Room([["i0", 0], ["i2", 2], ["i1", 1]]);
  sent.length = 0;
  const x = await b2(r.id, "i0");
  eq([x.status, x.body.hostId, big2Extra[r.id].host_id, b2left()[0]?.hostId], [200, "i2", "i2", "i2"], "B2 大老二房主 i0 退出：房主交給最早加入的 i2");
}
{
  const r = b2Room([["j0", 0], ["j1", 1], ["j2", 2], ["j3", 3]], "j0", "ready_check");
  sent.length = 0;
  const x = await b2(r.id, "j3");
  eq([x.status, rs.big2Rooms[r.id].room.status, big2Extra[r.id].ready_players, b2left()[0]?.readyCheckCancelled, pids(r.id)], [200, "waiting", [], true, ["j0", "j1", "j2"]],
    "B3 大老二準備確認中有人退出：取消準備確認、回到等人（已按準備的清空），廣播 readyCheckCancelled");
}
{
  const r = b2Room([["k0", 0]]);
  const x = await b2(r.id, "k0");
  eq([x.status, x.body.closed, !!rs.big2Rooms[r.id], rs.deleted.some((d) => d.roomId === r.id)], [200, true, false, true], "B4 大老二最後一人退出：關房");
}
{
  const p = b2Room([["l0", 0], ["l1", 1], ["l2", 2], ["l3", 3]], "l0", "playing");
  const f = b2Room([["o0", 0], ["o1", 1], ["o2", 2], ["o3", 3]], "o0", "finished", { o0: 10, o1: -10, o2: 0, o3: 0 });
  const w = b2Room([["q0", 0], ["q1", 1]], "q0", "ready_check", { q0: 5, q1: -5 }); // 打過一場、又回到準備確認
  const xs = [await b2(p.id, "l1"), await b2(f.id, "o1"), await b2(w.id, "q1")];
  eq([xs.map((x) => [x.status, x.body.error]), pids(p.id).length, pids(f.id).length, pids(w.id).length], [[[409, "game_in_progress"], [409, "game_in_progress"], [409, "game_in_progress"]], 4, 4, 2],
    "B5 大老二開打後（發牌中、一場打完、打過一場又準備確認）退出：都 409 game_in_progress，座位不動");
}
{
  const r = b2Room([["s0", 0], ["s1", 1]]);
  const a = await b2(r.id, "s1"), b = await b2(r.id, "s1"), c = await b2(r.id), d = await b2("nope", "s0");
  eq([a.status, b.status, b.body.error, c.status, d.status], [200, 404, "not_in_room", 400, 404], "B6 大老二重複退出 404 not_in_room；缺 playerId 400；房間不存在 404");
}

// B7：發牌讀完座位、改房間狀態之前有人退出 → 不開局
{
  const r = b2Room([["t0", 0], ["t1", 1], ["t2", 2], ["t3", 3]], "t0", "ready_check");
  sent.length = 0;
  const lv: { status?: number } = {};
  dealHooks.beforeStart = async () => { dealHooks.beforeStart = undefined; lv.status = (await b2(r.id, "t2")).status; };
  const started = await dealAndStart(r.id, r.code);
  dealHooks.beforeStart = undefined;
  eq([lv.status, started, rs.big2Rooms[r.id].room.status, pids(r.id), sent.filter((e) => e.event === "game_start" || e.event === "deal_hand").length],
    [200, false, "waiting", ["t0", "t1", "t3"], 0],
    "B7 大老二發牌讀完 4 個座位後 t2 退出：dealAndStart 回失敗（ready／deal 路由回 409），房間仍 waiting、剩 3 人、沒有 game_start／deal_hand");
}
// B8：沒有人動房間時照常開局；下一場（finished → continue）照常；狀態不對不開局
{
  const r = b2Room([["u0", 0], ["u1", 1], ["u2", 2], ["u3", 3]], "u0", "ready_check");
  sent.length = 0;
  const ok1 = await dealAndStart(r.id, r.code);
  const hands = rs.big2Rooms[r.id].players.map((p) => p.hand.length);
  const ev1 = [rs.big2Rooms[r.id].room.status, sent.filter((e) => e.event === "game_start").length, sent.filter((e) => e.event === "deal_hand").length];
  rs.big2Rooms[r.id].room.status = "finished";
  sent.length = 0;
  const ok2 = await dealAndStart(r.id, r.code, { u0: 10, u1: -10, u2: 0, u3: 0 }, ["finished"]);
  const st2 = [rs.big2Rooms[r.id].room.status, rs.big2Rooms[r.id].room.scores, sent.filter((e) => e.event === "game_start").length];
  const w = b2Room([["v0", 0], ["v1", 1], ["v2", 2], ["v3", 3]], "v0", "playing");
  sent.length = 0;
  const ok3 = await dealAndStart(w.id, w.code);
  eq([ok1, hands, ev1, ok2, st2, ok3, rs.big2Rooms[w.id].room.status, sent.length],
    [true, [13, 13, 13, 13], ["playing", 1, 4], true, ["playing", { u0: 10, u1: -10, u2: 0, u3: 0 }, 1], false, "playing", 0],
    "B8 大老二正常發牌：開局（每人 13 張、game_start 1 次、deal_hand 4 次）；下一場從 finished 照常開局、帶分數；已在 playing 時再發牌不開局、不廣播");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
process.exit(0);
