// 解散投票：輪到他的牌局動作超過 3 分鐘沒做，就不計票（老闆 2026-11-13 定案；lib/mahjong/leave/rules.ts）
//   A 沒有人卡住：照舊要其他三家都同意
//   B 一人在自己回合卡住超過 3 分鐘：其他三家同意就解散（發起者＋兩家）；投票畫面列出他「不計票」
//   W 正在等別人的玩家不算卡住（就算整桌 4 分鐘沒動）
//   T 兩人卡住（等吃碰槓胡的窗口兩家都沒決定、或一局結束兩家沒按下一局）：其他兩人同意就解散
//   R 卡住的人做牌局動作（真的走摸牌 API）就恢復投票權
//   X 判斷之後卡住的人剛好出牌（牌局版本變了）：不會誤解散——發起、最後一票、重新確認三條路都測
//   C 聊天、丟互動不影響判斷；發起、投票、看狀態、重新確認也不算牌局動作
//   D 有投票權的人一個都沒有同意時不解散（大家都卡住、發起者也卡住）；卡住的人投的票不計
//   E 其他三家都卡住、發起者有投票權：發起當下就解散
//   F 中途解散記下的分數和原本四家同意時一樣
//   H 上線當下正在打的房（沒有任何牌局動作紀錄）：判斷不了，照舊要全員同意
import { POST as leaveRequest } from "../../app/api/mahjong/leave-request/route";
import { GET as voteStatus, POST as leaveVote } from "../../app/api/mahjong/leave-vote/route";
import { POST as draw } from "../../app/api/mahjong/draw/route";
import { POST as effectApi } from "../../app/api/mahjong/effect/route";
import { POST as chatApi } from "../../app/api/mahjong/chat/route";
import { rooms } from "../support/stub-db";
import { sent } from "../support/stub-broadcast";
import { records, reset as resetRecords, opts as recOpts } from "../support/stub-records-store";
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
const STUCK = IDLE_VOTE_MS + 30_000; // 超過 3 分鐘
let n = 0;

/**
 * 一間打過 2 局、正在打第 3 局的房。lastMs＝最後一次牌局動作是多久前（誰做的不重要）；
 * setup 決定現在輪到誰（預設輪到玩家4（p3）摸牌）。
 */
function room(lastMs: number, setup?: (s: MahjongGameState) => void): string {
  const id = `room-idle-${++n}`;
  const s = dealTiles(initGame([0, 1, 2, 3].map((i) => ({ id: "p" + i, name: "玩家" + (i + 1) })), { totalRounds: 2, basePoints: 100, fanPoints: 20 }));
  Object.assign(s, {
    roomCode: String(8100 + n), startedAt: new Date(ago(3600_000)).toISOString(), handsCompleted: 2, playerScores: [120, -40, -60, -20],
    currentTurn: 3, hasDrawn: false, lastDiscard: null, pendingActions: undefined, drawnTileId: undefined,
    lastActive: { p2: ago(lastMs) }, activeSince: ago(3600_000), stateVersion: 1,
  });
  setup?.(s as MahjongGameState);
  rooms[id] = { id, code: s.roomCode, game_state: s as MahjongGameState, status: "playing" };
  return id;
}
const alive = (id: string) => !!rooms[id];
const rec = (id: string) => records.find((r) => r.roomId === id);
const shape = (id: string) => { const r = rec(id); return r ? { endReason: r.endReason, handsPlayed: r.handsPlayed, scores: r.players.map((p) => [p.seat, p.totalScore]) } : null; };
const grantedEvents = () => sent.filter((e) => e.event === "mj_leave_vote" && e.payload.result === "granted").length;
const idleNames = (b: { idleSeats: { name: string }[] }) => b.idleSeats.map((x) => x.name);
resetRecords();

// ---------- A 沒有人卡住 ----------
const A = room(10_000);
{
  const r0 = await post(leaveRequest, { roomId: A, playerId: "p0" });
  const v1 = await post(leaveVote, { roomId: A, playerId: "p1", approve: true });
  const v2 = await post(leaveVote, { roomId: A, playerId: "p2", approve: true });
  const mid = alive(A);
  const v3 = await post(leaveVote, { roomId: A, playerId: "p3", approve: true });
  eq([r0.body.result, r0.body.needed, v1.body.result, v2.body.result, mid, v3.body.result, alive(A)], ["vote", 3, "vote", "vote", true, "granted", false],
    "A 輪到玩家4 才 10 秒：沒有人卡住，要其他三家都同意");
}

// ---------- B 一人卡住 ----------
const B = room(STUCK);
{
  const r0 = await post(leaveRequest, { roomId: B, playerId: "p0" });
  const st = await status(B, "p1");
  eq([r0.body.needed, st.body.needed, idleNames(st.body)], [2, 2, ["玩家4"]],
    "B1 輪到玩家4 摸牌、超過 3 分鐘沒動：他不計票，只需要玩家2、玩家3 同意；投票狀態列出玩家4");
  await post(leaveVote, { roomId: B, playerId: "p1", approve: true });
  const v2 = await post(leaveVote, { roomId: B, playerId: "p2", approve: true });
  const ev = sent.filter((e) => e.event === "mj_leave_vote").at(-1)?.payload;
  eq([v2.body.result, alive(B), ev?.result, (ev?.idleSeats as { seat: number }[])?.map((x) => x.seat)], ["granted", false, "granted", [3]],
    "B2 其他三家（發起者＋兩家）同意就解散；廣播帶不計票的座位");
}

// ---------- F 分數紀錄 ----------
eq([shape(A), shape(B)], [
  { endReason: "dissolved", handsPlayed: 2, scores: [[0, 120], [1, -40], [2, -60], [3, -20]] },
  { endReason: "dissolved", handsPlayed: 2, scores: [[0, 120], [1, -40], [2, -60], [3, -20]] },
], "F 有人卡住時解散，對戰紀錄和四家同意解散完全同一個格式：中途解散、打完的局數、當下四家總分");

// ---------- W 等待中的玩家不算卡住 ----------
{
  const W = room(STUCK); // 整桌 4 分鐘沒動，但只有輪到的玩家4 算卡住
  await post(leaveRequest, { roomId: W, playerId: "p1" });
  const st = await status(W, "p0");
  eq([st.body.needed, idleNames(st.body)], [2, ["玩家4"]], "W 整桌 4 分鐘沒動作，只有輪到的玩家4 算卡住；玩家1、玩家3 在等別人，照樣要他們同意");
}

// ---------- T 兩人卡住 ----------
{
  // T1 玩家2 打出一張牌，玩家3、玩家4 都能碰／胡、4 分鐘都沒決定
  const T1 = room(STUCK, (s) => { s.currentTurn = 1; s.lastDiscard = { tile: s.players[1].hand[0], from: 1 }; s.pendingActions = { discardFrom: 1, potentialActors: [2, 3], passedActors: [] }; });
  const r0 = await post(leaveRequest, { roomId: T1, playerId: "p0" });
  const st = await status(T1, "p1");
  const v1 = await post(leaveVote, { roomId: T1, playerId: "p1", approve: true });
  eq([r0.body.needed, idleNames(st.body), v1.body.result, alive(T1)], [1, ["玩家3", "玩家4"], "granted", false],
    "T1 等吃碰槓胡的窗口兩家（玩家3、玩家4）都卡住：扣兩位，剩下玩家2 同意就解散");
  // T2 一局結束，玩家3、玩家4 4 分鐘沒按下一局
  const T2 = room(STUCK, (s) => { s.status = "finished"; s.nextGameReady = ["p0", "p1"]; s.settlement = { deltas: [0, 0, 0, 0], reason: "draw", fanTotal: 0, paymentPerPlayer: 0 }; });
  const r2 = await post(leaveRequest, { roomId: T2, playerId: "p0" });
  const v2 = await post(leaveVote, { roomId: T2, playerId: "p1", approve: true });
  eq([r2.body.needed, v2.body.result, alive(T2)], [1, "granted", false], "T2 一局結束、玩家3 玩家4 超過 3 分鐘沒按下一局：扣兩位，玩家2 同意就解散");
}

// ---------- R 卡住的人做牌局動作就恢復 ----------
{
  const R = room(STUCK);
  await post(leaveRequest, { roomId: R, playerId: "p0" });
  const before = (await status(R, "p0")).body.needed;
  const d = await post(draw, { roomId: R, playerId: "p3" }); // 玩家4 摸牌（真的牌局動作）
  const after = (await status(R, "p0")).body;
  await post(leaveVote, { roomId: R, playerId: "p1", approve: true });
  const v2 = await post(leaveVote, { roomId: R, playerId: "p2", approve: true });
  eq([before, d.status, after.needed, after.idleSeats.length, v2.body.result, alive(R)], [2, 200, 3, 0, "vote", true],
    "R 玩家4 回來摸牌：馬上恢復投票權（需要 3 人），兩家同意不會解散");
  const v3 = await post(leaveVote, { roomId: R, playerId: "p3", approve: true });
  eq([v3.body.result, alive(R)], ["granted", false], "R 玩家4 也同意才解散");
}

// ---------- X 判斷之後卡住的人剛好出牌 ----------
{
  /** 關房交易開始前（判斷已經做完），玩家4 剛好摸了牌：牌局版本 +1、最後動作時間更新、輪到誰不變 */
  const actsJustNow = (roomId: string) => {
    let once = true;
    recOpts.beforeClose = (_g, id) => {
      if (id !== roomId || !once) return;
      once = false;
      const s = rooms[id].game_state;
      s.stateVersion = (s.stateVersion ?? 0) + 1;
      s.lastActive = { ...(s.lastActive ?? {}), p3: Date.now() };
      s.hasDrawn = true;
    };
  };
  const g0 = grantedEvents();
  // 發起：一局結束，只有發起者玩家1 按了下一局，其他三家卡住 → 本來發起當下就會解散
  const X1b = room(STUCK, (s) => { s.status = "finished"; s.nextGameReady = ["p0"]; s.settlement = { deltas: [0, 0, 0, 0], reason: "draw", fanTotal: 0, paymentPerPlayer: 0 }; });
  actsJustNow(X1b);
  const x1 = await post(leaveRequest, { roomId: X1b, playerId: "p0" });
  recOpts.beforeClose = undefined;

  const X2 = room(STUCK);
  await post(leaveRequest, { roomId: X2, playerId: "p0" });
  await post(leaveVote, { roomId: X2, playerId: "p1", approve: true });
  actsJustNow(X2);
  const x2 = await post(leaveVote, { roomId: X2, playerId: "p2", approve: true });
  recOpts.beforeClose = undefined;

  const X3 = room(10_000);
  await post(leaveRequest, { roomId: X3, playerId: "p0" });
  await post(leaveVote, { roomId: X3, playerId: "p1", approve: true });
  await post(leaveVote, { roomId: X3, playerId: "p2", approve: true });
  rooms[X3].game_state.lastActive = { p2: ago(STUCK) }; // 等待中玩家4 卡住超過 3 分鐘
  actsJustNow(X3);
  const x3 = await post(leaveVote, { roomId: X3, playerId: "p0", check: true });
  recOpts.beforeClose = undefined;

  eq([[x1.body.result, x2.body.result, x3.body.result], [alive(X1b), alive(X2), alive(X3)], [rec(X1b) ?? null, rec(X2) ?? null, rec(X3) ?? null], grantedEvents() - g0],
    [["vote", "vote", "vote"], [true, true, true], [null, null, null], 0],
    "X 判斷之後、關房交易前卡住的人剛好做了牌局動作（版本變了）：發起、最後一票、重新確認三條路都不解散、不寫紀錄、不廣播解散，重判後他恢復投票權");
  const after = (await status(X2, "p0")).body;
  eq([after.needed, after.idleSeats.length, rooms[X2].game_state.leaveRequest?.approvedBy], [3, 0, ["p1", "p2"]], "X 重判後玩家4 要同意（需要 3 人），已同意的兩票保留");
}

// ---------- C 聊天、互動、投票類請求都不算牌局動作 ----------
{
  const C = room(STUCK);
  await post(leaveRequest, { roomId: C, playerId: "p0" });
  const fx = await post(effectApi, { roomId: C, playerId: "p3", effect: "heart", to: "p1" });
  const ch = await post(chatApi, { roomId: C, playerId: "p3", text: "我還在喔" });
  await status(C, "p3");
  const no = await post(leaveVote, { roomId: C, playerId: "p3", approve: false }); // 卡住的人按不同意：不計
  const st = (await status(C, "p1")).body;
  eq([fx.status, ch.status, st.needed, idleNames(st), no.body.result, alive(C)], [200, 200, 2, ["玩家4"], "vote", true],
    "C 卡住的玩家4 聊天、丟互動、看投票狀態、按不同意：都不是牌局動作，他還是不計票，不同意也不計（不會取消）");
  await post(leaveVote, { roomId: C, playerId: "p1", approve: true });
  const v2 = await post(leaveVote, { roomId: C, playerId: "p2", approve: true });
  eq([v2.body.result, alive(C)], ["granted", false], "C 另外兩家同意就解散");
  // 發起、投票不會讓卡住的人重新起算：玩家2 發起後玩家4 照樣卡住
  const C2 = room(STUCK);
  const t = rooms[C2].game_state.lastActive!.p2;
  await post(leaveRequest, { roomId: C2, playerId: "p1" });
  await post(leaveVote, { roomId: C2, playerId: "p0", approve: true });
  eq([rooms[C2].game_state.lastActive!.p2 === t, Object.keys(rooms[C2].game_state.lastActive!)], [true, ["p2"]], "C 發起、投票都不更新最後牌局動作時間");
}

// ---------- D 沒有有投票權的人同意就不解散 ----------
{
  // 一局結束，四家都 4 分鐘沒按下一局（發起者自己也卡住）
  const D = room(STUCK, (s) => { s.status = "finished"; s.nextGameReady = []; s.settlement = { deltas: [0, 0, 0, 0], reason: "draw", fanTotal: 0, paymentPerPlayer: 0 }; });
  const st0 = await status(D, "p1");
  const r0 = await post(leaveRequest, { roomId: D, playerId: "p0" });
  const chk = await post(leaveVote, { roomId: D, playerId: "p0", check: true });
  const v = await post(leaveVote, { roomId: D, playerId: "p1", approve: true }); // 卡住的人同意：不計
  eq([st0.body.active, r0.body.result, chk.body.result, v.body.result, alive(D)], [false, "vote", "vote", "vote", true],
    "D 四家都卡住（含發起者）：沒人發起不會解散；發起、重新確認、卡住的人按同意都不解散（至少要一位有投票權的人同意）");
}

// ---------- E 其他三家都卡住 ----------
{
  const E = room(STUCK, (s) => { s.status = "finished"; s.nextGameReady = ["p0"]; s.settlement = { deltas: [0, 0, 0, 0], reason: "draw", fanTotal: 0, paymentPerPlayer: 0 }; });
  const g = grantedEvents();
  const r0 = await post(leaveRequest, { roomId: E, playerId: "p0" });
  eq([r0.body.result, alive(E), shape(E)?.endReason, grantedEvents() - g], ["granted", false, "dissolved", 1],
    "E 一局結束，玩家1 已按下一局、其他三家 4 分鐘沒按：玩家1 發起當下就解散（記成中途解散）");
}

// ---------- H 上線當下正在打的房 ----------
{
  const H = room(STUCK);
  delete rooms[H].game_state.lastActive; delete rooms[H].game_state.activeSince;
  await post(leaveRequest, { roomId: H, playerId: "p0" });
  const st = (await status(H, "p1")).body;
  await post(leaveVote, { roomId: H, playerId: "p1", approve: true });
  const v2 = await post(leaveVote, { roomId: H, playerId: "p2", approve: true });
  eq([st.needed, st.activityUnknown, v2.body.result, alive(H)], [3, true, "vote", true], "H 舊房沒有任何牌局動作紀錄：判斷不了誰卡住，照舊要三家同意");
}

for (const r of results) console.log(r);
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
