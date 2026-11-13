// 解散投票：超過 3 分鐘沒操作的玩家不計票（老闆 2026-11-13；lib/mahjong/leave/rules.ts）
//   A 四人都有在操作：照舊要其他三家都同意
//   B 一人閒置超過 3 分鐘：其他兩家同意就解散；投票畫面列出誰不計票
//   C 閒置的人回來操作（打牌、聊天、投票）就立刻恢復投票權
//   D 大家都閒置：不會自動解散；發起者自己也閒置時「重新確認」不會解散
//   E 其他三家都閒置、發起者有在操作：發起當下就解散（至少一位有在操作的人同意＝發起者本人）
//   F 中途解散記下的分數和原本四家同意時一樣（對戰紀錄同一個格式）
//   G 看投票狀態、重新確認都不算操作；只有發起者能重新確認；閒置的人投「不同意」照樣取消（投票本身就是操作）
//   H 上線當下正在打的房（沒有任何記錄）：維持要大家同意；開始記錄滿 3 分鐘還沒動的人才算閒置
import { POST as leaveRequest } from "../../app/api/mahjong/leave-request/route";
import { GET as voteStatus, POST as leaveVote } from "../../app/api/mahjong/leave-vote/route";
import { POST as draw } from "../../app/api/mahjong/draw/route";
import { rooms } from "../support/stub-db";
import { sent } from "../support/stub-broadcast";
import { records, reset as resetRecords } from "../support/stub-records-store";
import { activity } from "../support/stub-leave-store";
import { asSeat } from "../support/stub-auth";
import { dealTiles, initGame } from "../../lib/mahjong/gameLogic";
import { IDLE_VOTE_MS } from "../../lib/mahjong/leave/rules";
import type { MahjongGameState } from "../../lib/mahjong/gameState";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`}`);
}
const post = async (fn: (r: Request) => Promise<Response>, body: { playerId: string } & Record<string, unknown>) => {
  const r = await fn(new Request("http://x", { method: "POST", headers: { "content-type": "application/json", ...asSeat(body) }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
};
const status = async (roomId: string, pid: string) => {
  const r = await voteStatus(new Request(`http://x/api/mahjong/leave-vote?roomId=${roomId}&playerId=${pid}`, { headers: asSeat({ playerId: pid }) }));
  return { status: r.status, body: await r.json() };
};
const ago = (ms: number) => Date.now() - ms;
const IDLE = IDLE_VOTE_MS + 30_000; // 超過 3 分鐘
let n = 0;

/** 一間打過 2 局、正在打第 3 局的房；lastActive：每家多久前操作過（毫秒） */
function room(idleMs: [number, number, number, number]): string {
  const id = `room-idle-${++n}`;
  const s = dealTiles(initGame([0, 1, 2, 3].map((i) => ({ id: "p" + i, name: "玩家" + (i + 1) })), { totalRounds: 2, basePoints: 100, fanPoints: 20 }));
  Object.assign(s, {
    roomCode: String(8100 + n), startedAt: new Date(ago(3600_000)).toISOString(), handsCompleted: 2, playerScores: [120, -40, -60, -20],
    lastActive: Object.fromEntries(idleMs.map((ms, i) => ["p" + i, ago(ms)])), stateVersion: 1,
  });
  rooms[id] = { id, code: s.roomCode, game_state: s as MahjongGameState, status: "playing" };
  return id;
}
const alive = (id: string) => !!rooms[id];
const rec = (id: string) => records.find((r) => r.roomId === id);
const shape = (id: string) => { const r = rec(id); return r ? { endReason: r.endReason, handsPlayed: r.handsPlayed, scores: r.players.map((p) => [p.seat, p.totalScore]) } : null; };
resetRecords();

// ---------- A 四人都有在操作 ----------
const A = room([0, 0, 0, 0]);
{
  const r0 = await post(leaveRequest, { roomId: A, playerId: "p0" });
  const v1 = await post(leaveVote, { roomId: A, playerId: "p1", approve: true });
  const v2 = await post(leaveVote, { roomId: A, playerId: "p2", approve: true });
  const mid = alive(A);
  const v3 = await post(leaveVote, { roomId: A, playerId: "p3", approve: true });
  eq([r0.body.result, r0.body.needed, v1.body.result, v2.body.result, mid, v3.body.result, alive(A)], ["vote", 3, "vote", "vote", true, "granted", false],
    "A 四人都有在操作：要其他三家都同意，兩家同意時還沒解散，第三家同意才解散");
}

// ---------- B 一人閒置 ----------
const B = room([0, 0, 0, IDLE]);
{
  const r0 = await post(leaveRequest, { roomId: B, playerId: "p0" });
  const st = await status(B, "p1");
  eq([r0.body.result, r0.body.needed, st.body.needed, st.body.idleSeats.map((x: { seat: number; name: string }) => [x.seat, x.name])], ["vote", 2, 2, [[3, "玩家4"]]],
    "B1 玩家4 超過 3 分鐘沒操作：只需要另外兩家同意；投票狀態列出玩家4「不計票」");
  const v1 = await post(leaveVote, { roomId: B, playerId: "p1", approve: true });
  const v2 = await post(leaveVote, { roomId: B, playerId: "p2", approve: true });
  const ev = sent.filter((e) => e.event === "mj_leave_vote").at(-1)?.payload;
  eq([v1.body.result, v2.body.result, alive(B), ev?.result, ev?.needed, (ev?.idleSeats as { seat: number }[])?.map((x) => x.seat)], ["vote", "granted", false, "granted", 2, [3]],
    "B2 其他兩家同意就解散，關房；廣播也帶需要人數和不計票的座位");
}

// ---------- F 分數紀錄和原本一樣 ----------
eq([shape(A), shape(B)], [
  { endReason: "dissolved", handsPlayed: 2, scores: [[0, 120], [1, -40], [2, -60], [3, -20]] },
  { endReason: "dissolved", handsPlayed: 2, scores: [[0, 120], [1, -40], [2, -60], [3, -20]] },
], "F 有人閒置時解散，對戰紀錄和四家同意解散完全同一個格式：中途解散、打完的局數、當下四家總分");

// ---------- C 閒置的人回來操作就恢復投票權 ----------
{
  // C1 回來打牌：輪到玩家4 摸牌（真的走摸牌 API）
  const C = room([0, 0, 0, IDLE]);
  const s = rooms[C].game_state;
  Object.assign(s, { currentTurn: 3, hasDrawn: false, lastDiscard: null, pendingActions: undefined, drawnTileId: undefined });
  await post(leaveRequest, { roomId: C, playerId: "p0" });
  const before = (await status(C, "p0")).body.needed;
  const d = await post(draw, { roomId: C, playerId: "p3" });
  const after = (await status(C, "p0")).body;
  await post(leaveVote, { roomId: C, playerId: "p1", approve: true });
  const v2 = await post(leaveVote, { roomId: C, playerId: "p2", approve: true });
  eq([before, d.status, after.needed, after.idleSeats.length, v2.body.result, alive(C)], [2, 200, 3, 0, "vote", true],
    "C1 玩家4 回來摸牌：馬上恢復投票權（需要 3 人），兩家同意不會解散");
  const v3 = await post(leaveVote, { roomId: C, playerId: "p3", approve: true });
  eq([v3.body.result, alive(C)], ["granted", false], "C1 玩家4 也同意才解散");

  // C2 回來聊天（聊天、丟互動的時間從冷卻紀錄讀）
  const C2 = room([0, 0, 0, IDLE]);
  await post(leaveRequest, { roomId: C2, playerId: "p0" });
  activity[C2] = { "u:p3": Date.now() };
  const v1b = await post(leaveVote, { roomId: C2, playerId: "p1", approve: true });
  const v2b = await post(leaveVote, { roomId: C2, playerId: "p2", approve: true });
  eq([v1b.body.needed, v2b.body.result, alive(C2)], [3, "vote", true], "C2 玩家4 剛剛聊過天：算有在操作，要他也同意");

  // C3 閒置的人投「不同意」：投票本身就是操作，照樣取消
  const C3 = room([0, 0, 0, IDLE]);
  await post(leaveRequest, { roomId: C3, playerId: "p0" });
  const no = await post(leaveVote, { roomId: C3, playerId: "p3", approve: false });
  eq([no.body.result, alive(C3), rooms[C3].game_state.leaveRequest ?? null], ["denied", true, null], "C3 閒置的玩家4 回來按不同意：照樣取消解散");
}

// ---------- D 大家都閒置 ----------
{
  const D = room([IDLE, IDLE, IDLE, IDLE]);
  const st0 = await status(D, "p1");
  eq([st0.body.active, alive(D)], [false, true], "D1 四人都閒置、沒有人發起：房間不會自己解散");
  // 發起後發起者也走開了（發起時間已超過 3 分鐘），其他人也都閒置
  rooms[D].game_state.leaveRequest = { requesterId: "p0", requesterName: "玩家1", requesterSeat: 0, approvedBy: [], deniedBy: [] };
  const chk = await post(leaveVote, { roomId: D, playerId: "p0", check: true });
  eq([chk.body.result, alive(D), chk.body.needed], ["vote", true, 0],
    "D2 發起者和其他三家都超過 3 分鐘沒操作：重新確認也不會解散（至少要一位有在操作的人同意）");
}

// ---------- E 其他三家都閒置 ----------
{
  const E = room([0, IDLE, IDLE, IDLE]);
  const r0 = await post(leaveRequest, { roomId: E, playerId: "p0" });
  eq([r0.body.result, alive(E), shape(E)?.endReason, sent.filter((e) => e.event === "mj_leave_vote").at(-1)?.payload.result],
    ["granted", false, "dissolved", "granted"], "E 其他三家都閒置、玩家1 有在操作：發起當下就解散（記成中途解散，前端收到和投票解散同一個事件）");
}

// ---------- G 不算操作的請求、權限 ----------
{
  const G = room([0, 0, 0, IDLE]);
  await post(leaveRequest, { roomId: G, playerId: "p0" });
  const t3 = rooms[G].game_state.lastActive!.p3;
  await status(G, "p3"); // 閒置的人只是開著畫面看投票狀態
  const notMine = await post(leaveVote, { roomId: G, playerId: "p1", check: true });
  const t0 = rooms[G].game_state.lastActive!.p0;
  await new Promise((r) => setTimeout(r, 5));
  const chk = await post(leaveVote, { roomId: G, playerId: "p0", check: true });
  eq([rooms[G].game_state.lastActive!.p3 === t3, `${notMine.status}`, chk.body.result, rooms[G].game_state.lastActive!.p0 === t0, alive(G)],
    [true, "403", "vote", true, true],
    "G 看投票狀態不算操作（閒置的人還是閒置）；只有發起者能重新確認；重新確認結果沒變時不存檔、不算操作");
  // 等待中有人變成閒置：發起者重新確認就解散
  await post(leaveVote, { roomId: G, playerId: "p1", approve: true });
  await post(leaveVote, { roomId: G, playerId: "p2", approve: true });
  eq(alive(G), false, "G 玩家4 一開始就閒置：兩家同意即解散（對照 C1）");
  const G2 = room([0, 0, 0, 0]);
  await post(leaveRequest, { roomId: G2, playerId: "p0" });
  await post(leaveVote, { roomId: G2, playerId: "p1", approve: true });
  await post(leaveVote, { roomId: G2, playerId: "p2", approve: true });
  rooms[G2].game_state.lastActive!.p3 = ago(IDLE); // 玩家4 在等待期間走開超過 3 分鐘
  const chk2 = await post(leaveVote, { roomId: G2, playerId: "p0", check: true });
  eq([chk2.body.result, alive(G2)], ["granted", false], "G 等待期間玩家4 走開超過 3 分鐘：發起者畫面自動重新確認時就解散");
}

// ---------- H 上線當下正在打的房 ----------
{
  const H = room([0, 0, 0, 0]);
  const s = rooms[H].game_state;
  delete s.lastActive; delete s.activeSince; // 舊房：完全沒有記錄
  await post(leaveRequest, { roomId: H, playerId: "p0" });
  const v1 = await post(leaveVote, { roomId: H, playerId: "p1", approve: true });
  eq([v1.body.needed, v1.body.result, alive(H), rooms[H].game_state.activeSince !== undefined], [3, "vote", true, true],
    "H1 舊房第一次有人操作才開始記錄：沒記到的玩家先當成有在操作，照舊要三家同意");
  rooms[H].game_state.activeSince = ago(IDLE); // 開始記錄已經超過 3 分鐘，玩家3、玩家4 都沒動過
  rooms[H].game_state.lastActive = { p0: Date.now(), p1: Date.now() };
  const chk = await post(leaveVote, { roomId: H, playerId: "p0", check: true });
  eq([chk.body.result, alive(H)], ["granted", false], "H2 開始記錄滿 3 分鐘還沒動過的玩家3、玩家4 算閒置：玩家2 已同意，重新確認就解散");
}

for (const r of results) console.log(r);
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
