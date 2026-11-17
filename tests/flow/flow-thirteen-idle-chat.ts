// 十三支：閒置不計票、聊天（老柯 2026-11-17）。和 flow-thirteen.ts 一樣，路由、流程、db 層、聊天 SQL 都是真的（PGlite 跑真 migration），
// 只有登入、廣播、觀戰同意名單用 tests/support 的替身。
//   I  閒置不計票（規則同麻將）：超過 3 分鐘沒做牌局動作（截止前送出、按下一局、房主開局）的人不計票
//   C  十三支聊天：同桌收發、觀戰者（被同意）只能讀、外人收不到也讀不到、關房清掉
//   M  共用的聊天 SQL：麻將房照舊（孤兒清除、房間不在擋下），而且麻將聊天的清除不會刪到十三支房間的聊天
//   B  20261117 回滾：兩個函式換回 20261113 原文（雜湊和正式庫一樣）
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setupThirteenDb, setTotalHands } from "../support/thirteen-pg";
import { tokens } from "../support/stub-auth";
import { sent } from "../support/stub-broadcast";
import { requestSpectate, respondSpectate } from "../support/stub-spectate-store";
import { POST as createRoute } from "../../app/api/thirteen/create/route";
import { POST as joinRoute } from "../../app/api/thirteen/join/route";
import { POST as startRoute } from "../../app/api/thirteen/start/route";
import { GET as stateRoute } from "../../app/api/thirteen/state/route";
import { POST as submitRoute } from "../../app/api/thirteen/submit/route";
import { POST as tickRoute } from "../../app/api/thirteen/tick/route";
import { POST as leaveReqRoute } from "../../app/api/thirteen/leave-request/route";
import { POST as leaveVoteRoute } from "../../app/api/thirteen/leave-vote/route";
import { POST as chatRoute } from "../../app/api/thirteen/chat/route";
import { GET as historyRoute } from "../../app/api/thirteen/chat/history/route";
import { clock, IDLE_VOTE_MS, NEXT_HAND_MAX_MS } from "../../lib/thirteen/flow";
import { privateChannel, publicChannel } from "../../lib/thirteen/server";
import { spectatorChannelName } from "../../lib/mahjong/access";
import type { Card } from "../../lib/thirteen/cards";
import { autoArrange } from "../../lib/thirteen/arrange";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
const db = await setupThirteenDb();
let NOW = Date.parse("2026-11-17T12:00:00Z");
clock.now = () => NOW;

const PIDS = ["p0", "p1", "p2", "p3"];
const uid = (i: number) => `00000000-0000-4000-8000-0000000000b${i}`;
PIDS.forEach((p, i) => { tokens[`tk-${p}`] = { id: uid(i), displayName: null, pictureUrl: null, isGuest: false }; });
tokens["tk-watch"] = { id: "00000000-0000-4000-8000-0000000000c9", displayName: null, pictureUrl: null, isGuest: false };
tokens["tk-guest"] = { id: "00000000-0000-4000-8000-0000000000e1", displayName: null, pictureUrl: null, isGuest: true };
const auth = (as?: string): Record<string, string> => (as ? { authorization: `Bearer tk-${as}` } : {});
async function post(fn: (r: Request) => Promise<Response>, body: object, as?: string) {
  const r = await fn(new Request("http://x", { method: "POST", headers: { "content-type": "application/json", ...auth(as) }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
}
async function get(fn: (r: Request) => Promise<Response>, q: string, as?: string) {
  const r = await fn(new Request(`http://x/?${q}`, { headers: auth(as) }));
  return { status: r.status, body: await r.json() };
}
const state = (roomId: string, as: string) => get(stateRoute, `roomId=${roomId}&playerId=${as}`, as);
const ids = (cs: Card[]) => cs.map((c) => c.id);
async function newMatch(seats: string[] = PIDS, totalHands = 16) {
  const c = await post(createRoute, { hostId: seats[0], arrangeSec: 30, totalHands: [8, 16, 32].includes(totalHands) ? totalHands : 8 }, seats[0]);
  if (![8, 16, 32].includes(totalHands)) await setTotalHands(db, c.body.roomId, totalHands); // 開房只能選 8／16／32；測試要短局就照舊房的方式直接改設定
  for (const [i, p] of seats.entries()) await post(joinRoute, { code: c.body.code, playerId: p, name: `玩家${i}` }, p);
  await post(startRoute, { roomId: c.body.roomId, playerId: seats[0] }, seats[0]);
  return { roomId: c.body.roomId as string, code: c.body.code as string };
}
/** 這一局：active 裡的人在現在自己送出（牌局動作），其他人不動；時間跳到截止讓系統代排，再跳到自動開下一局 */
async function playHand(roomId: string, active: string[]) {
  for (const p of active) {
    const hand = (await state(roomId, p)).body.me.hand as Card[];
    const a = autoArrange(hand);
    await post(submitRoute, { roomId, playerId: p, front: ids(a.front), middle: ids(a.middle), back: ids(a.back) }, p);
  }
  NOW += 30_000; await post(tickRoute, { roomId, playerId: active[0] }, active[0]);       // 截止：沒送出的人代排、亮牌
  NOW += NEXT_HAND_MAX_MS; await post(tickRoute, { roomId, playerId: active[0] }, active[0]);  // 自動開下一局
}
const roomN = async (id: string) => (await db.query<{ n: number }>(`select count(*)::int n from th_rooms where id = $1`, [id])).rows[0].n;
const recOf = async (id: string) => (await db.query<{ end_reason: string }>(`select end_reason from match_records where room_id = $1`, [id])).rows[0] ?? null;

// ---------- I 閒置不計票 ----------
{
  eq(IDLE_VOTE_MS, 180_000, "I0 閒置門檻 3 分鐘，和麻將一樣");
  // p3 斷線：每局都被代排、從沒做過牌局動作；p0～p2 每局都自己送出
  const m = await newMatch();
  const t0 = NOW;
  while (NOW - t0 <= IDLE_VOTE_MS) await playHand(m.roomId, ["p0", "p1", "p2"]);
  const req = await post(leaveReqRoute, { roomId: m.roomId, playerId: "p0" }, "p0");
  const view = (await state(m.roomId, "p1")).body.leaveRequest;
  const v3 = await post(leaveVoteRoute, { roomId: m.roomId, playerId: "p3", approve: false }, "p3");
  const v1 = await post(leaveVoteRoute, { roomId: m.roomId, playerId: "p1", approve: true }, "p1");
  const still = await roomN(m.roomId);
  const v2 = await post(leaveVoteRoute, { roomId: m.roomId, playerId: "p2", approve: true }, "p2");
  eq([req.body.result, req.body.needed, req.body.idleSeats, view.needed, view.idleSeats, v3.body.result, v3.body.counted, v1.body.result, v1.body.approvedCount, still,
    v2.body.result, await roomN(m.roomId), await recOf(m.roomId)],
    ["vote", 2, [3], 2, [3], "vote", false, "vote", 1, 1, "granted", 0, { end_reason: "dissolved" }],
    "I1 斷線的 3 號超過 3 分鐘沒做牌局動作 → 不計票（他按不同意也不算）；發起人以外沒閒置的 1、2 號都同意就解散，寫中途解散紀錄");

  // 沒閒置的人反對 → 取消
  const m2 = await newMatch();
  const t2 = NOW;
  while (NOW - t2 <= IDLE_VOTE_MS) await playHand(m2.roomId, ["p0", "p1", "p2"]);
  await post(leaveReqRoute, { roomId: m2.roomId, playerId: "p0" }, "p0");
  const no = await post(leaveVoteRoute, { roomId: m2.roomId, playerId: "p1", approve: false }, "p1");
  const after = (await state(m2.roomId, "p0")).body.leaveRequest;
  eq([no.body.result, after, await roomN(m2.roomId)], ["denied", null, 1], "I2 沒閒置的 1 號按不同意 → 投票取消，房間照常（閒置的人才不計票）");

  // 投票途中有人變成閒置：不用再有人投票，下一次讀狀態就成立、關房（斷線不會卡住投票）
  const m3 = await newMatch();
  await playHand(m3.roomId, ["p0", "p1", "p2"]);
  const r3 = await post(leaveReqRoute, { roomId: m3.roomId, playerId: "p0" }, "p0");
  for (const p of ["p1", "p2"]) await post(leaveVoteRoute, { roomId: m3.roomId, playerId: p, approve: true }, p);
  const waiting = (await state(m3.roomId, "p0")).body.leaveRequest;
  const t3 = NOW;
  let closedAt: number | null = null;
  for (let i = 0; i < 10 && closedAt === null; i++) {
    await playHand(m3.roomId, ["p0", "p1", "p2"]).catch(() => {});
    if ((await state(m3.roomId, "p0")).status === 410) closedAt = NOW;
  }
  eq([r3.body.needed, waiting.needed, waiting.approvedCount, waiting.idleSeats, closedAt !== null, await recOf(m3.roomId)],
    [3, 3, 2, [], true, { end_reason: "dissolved" }],
    "I3 發起時 3 號還沒閒置（要 3 人），1、2 號同意後等 3 號；3 號超過 3 分鐘沒動作 → 下一次讀狀態就成立並解散（不用 3 號投票）");
  eq(closedAt !== null && closedAt - t3 > 0 && closedAt - Date.parse((await db.query<{ s: string }>(`select started_at s from match_records where room_id = $1`, [m3.roomId])).rows[0].s) > IDLE_VOTE_MS, true,
    "I3 解散的時間點在 3 號最後一次動作（開局）的 3 分鐘之後");

  // 截止前送出才算牌局動作：被代排不算
  const m4 = await newMatch();
  const t4 = NOW;
  while (NOW - t4 <= IDLE_VOTE_MS) await playHand(m4.roomId, ["p0", "p1"]); // 2、3 號都靠代排
  const r4 = await post(leaveReqRoute, { roomId: m4.roomId, playerId: "p0" }, "p0");
  eq([r4.body.needed, r4.body.idleSeats], [1, [2, 3]], "I4 理牌階段只看「截止前有沒有自己送出」：每局都被系統代排的 2、3 號都算閒置");
  // 其他三家都閒置時，發起人發起當下就成立（不用等）
  const m5 = await newMatch();
  const t5 = NOW;
  while (NOW - t5 <= IDLE_VOTE_MS) await playHand(m5.roomId, ["p0"]);
  const r5 = await post(leaveReqRoute, { roomId: m5.roomId, playerId: "p0" }, "p0");
  eq([r5.body.result, r5.body.needed, await roomN(m5.roomId)], ["granted", 0, 0], "I5 其他三家都閒置：發起人發起當下就解散");
}

// ---------- I6～I8 閒置時按的不同意：恢復投票權那一刻要算數，投票立刻取消（審伯 2026-11-17 必修） ----------
{
  const { POST: nextRoute } = await import("../../app/api/thirteen/next-game/route");
  const submitMine = async (roomId: string, p: string) => {
    const a = autoArrange((await state(roomId, p)).body.me.hand as Card[]);
    return post(submitRoute, { roomId, playerId: p, front: ids(a.front), middle: ids(a.middle), back: ids(a.back) }, p);
  };
  /** 開一場、讓 3 號斷線超過 3 分鐘；0 號發起解散，閒置的 3 號按不同意（不算）、1 號同意 */
  async function setup() {
    const m = await newMatch();
    const t = NOW;
    while (NOW - t <= IDLE_VOTE_MS) await playHand(m.roomId, ["p0", "p1", "p2"]);
    const req = await post(leaveReqRoute, { roomId: m.roomId, playerId: "p0" }, "p0");
    const no = await post(leaveVoteRoute, { roomId: m.roomId, playerId: "p3", approve: false }, "p3");
    const yes = await post(leaveVoteRoute, { roomId: m.roomId, playerId: "p1", approve: true }, "p1");
    return { m, pre: [req.body.idleSeats, no.body.result, no.body.counted, yes.body.result, yes.body.approvedCount, yes.body.needed] };
  }
  const PRE = [[3], "vote", false, "vote", 1, 2]; // 3 號閒置：他的不同意不算，1 號同意後還差 2 號
  const after = async (roomId: string, from: number) => {
    const lr = (await state(roomId, "p0")).body.leaveRequest;
    const ev = sent.slice(from).filter((e) => e.event === "th_leave_vote").map((e) => e.payload.result);
    const late = await post(leaveVoteRoute, { roomId, playerId: "p2", approve: true }, "p2"); // 原本這一票會讓投票成立、解散
    return [lr, ev, late.status, late.body.error, await roomN(roomId), await recOf(roomId)];
  };
  const POST_CANCEL = [null, ["denied"], 409, "no_request", 1, null];

  // I6 截止前自己送出牌 → 恢復投票權
  {
    const { m, pre } = await setup();
    const from = sent.length;
    const sub = await submitMine(m.roomId, "p3");
    eq([pre, sub.status, sub.body.leaveCancelled, ...(await after(m.roomId, from))], [PRE, 200, true, ...POST_CANCEL],
      "I6 閒置的 3 號按過不同意，之後自己送出牌（恢復投票權）→ 他的不同意立刻算數，投票取消並廣播 denied；2 號再同意也不會解散、不寫紀錄");
  }
  // I7 亮牌後按下一局 → 恢復投票權
  {
    const m = await newMatch();
    const t = NOW;
    while (NOW - t <= IDLE_VOTE_MS) await playHand(m.roomId, ["p0", "p1", "p2"]);
    for (const p of ["p0", "p1", "p2"]) await submitMine(m.roomId, p);
    NOW += 30_000; await post(tickRoute, { roomId: m.roomId, playerId: "p0" }, "p0"); // 3 號被代排、亮牌
    await post(leaveReqRoute, { roomId: m.roomId, playerId: "p0" }, "p0");
    const no = await post(leaveVoteRoute, { roomId: m.roomId, playerId: "p3", approve: false }, "p3");
    const yes = await post(leaveVoteRoute, { roomId: m.roomId, playerId: "p1", approve: true }, "p1");
    const from = sent.length;
    const nx = await post(nextRoute, { roomId: m.roomId, playerId: "p3" }, "p3");
    eq([no.body.counted, yes.body.result, nx.status, nx.body.leaveCancelled, ...(await after(m.roomId, from))], [false, "vote", 200, true, ...POST_CANCEL],
      "I7 閒置的 3 號按過不同意，之後亮牌時按「下一局」（恢復投票權）→ 一樣立刻取消投票，2 號再同意也不會解散");
  }
  // I8 取消後重新發起：舊的不同意、同意都不沿用
  {
    const { m } = await setup();
    await submitMine(m.roomId, "p3");
    const again = await post(leaveReqRoute, { roomId: m.roomId, playerId: "p0" }, "p0");
    const v1 = await post(leaveVoteRoute, { roomId: m.roomId, playerId: "p1", approve: true }, "p1");
    const v2 = await post(leaveVoteRoute, { roomId: m.roomId, playerId: "p2", approve: true }, "p2");
    const v3 = await post(leaveVoteRoute, { roomId: m.roomId, playerId: "p3", approve: true }, "p3");
    eq([again.body.result, again.body.needed, again.body.idleSeats, v1.body.approvedCount, v2.body.result, v3.body.result, await roomN(m.roomId), await recOf(m.roomId)],
      ["vote", 3, [], 1, "vote", "granted", 0, { end_reason: "dissolved" }],
      "I8 取消後重新發起：3 號已經恢復，要 3 人；舊的不同意不沿用（不會一發起就被否決），三家都同意才解散");
  }
}

// ---------- I9 換票：閒置時先按不同意、再改按同意 → 舊的不同意被換掉，恢復後不會變成否決（審伯 2026-11-17 必修：不能留下撤不掉的否決） ----------
{
  const m = await newMatch();
  const t = NOW;
  while (NOW - t <= IDLE_VOTE_MS) await playHand(m.roomId, ["p0", "p1", "p2"]);
  await post(leaveReqRoute, { roomId: m.roomId, playerId: "p0" }, "p0");
  const no = await post(leaveVoteRoute, { roomId: m.roomId, playerId: "p3", approve: false }, "p3");
  const yes3 = await post(leaveVoteRoute, { roomId: m.roomId, playerId: "p3", approve: true }, "p3"); // 改投同意（還在閒置）
  const a = autoArrange((await state(m.roomId, "p3")).body.me.hand as Card[]);
  const back = await post(submitRoute, { roomId: m.roomId, playerId: "p3", front: ids(a.front), middle: ids(a.middle), back: ids(a.back) }, "p3"); // 恢復投票權
  const mid = (await state(m.roomId, "p0")).body.leaveRequest;
  const v1 = await post(leaveVoteRoute, { roomId: m.roomId, playerId: "p1", approve: true }, "p1");
  const v2 = await post(leaveVoteRoute, { roomId: m.roomId, playerId: "p2", approve: true }, "p2");
  const recs = (await db.query<{ n: number }>(`select count(*)::int n from match_records where room_id = $1`, [m.roomId])).rows[0].n;
  eq([no.body.counted, yes3.body.counted, back.body.leaveCancelled, mid?.result, mid?.needed, mid?.approvedCount, v1.body.result, v2.body.result, await roomN(m.roomId), recs],
    [false, false, false, "vote", 3, 1, "vote", "granted", 0, 1],
    "I9 閒置的 3 號先按不同意、再改按同意（舊票被換掉）；恢復投票權後投票照常（他的同意算數），1、2 號也同意 → 正常解散、只寫一筆紀錄");
}

// ---------- I3b 投票成立是「讀狀態那一次請求」觸發的（小測 2026-11-17：排除 tick 先關房） ----------
{
  const m = await newMatch();
  const t = NOW; // 3 號的計時起點＝開局
  await playHand(m.roomId, ["p0", "p1", "p2"]);
  await post(leaveReqRoute, { roomId: m.roomId, playerId: "p0" }, "p0");
  for (const p of ["p1", "p2"]) await post(leaveVoteRoute, { roomId: m.roomId, playerId: p, approve: true }, p);
  while (NOW + 30_000 + NEXT_HAND_MAX_MS - t <= IDLE_VOTE_MS) await playHand(m.roomId, ["p0", "p1", "p2"]); // 跑到 3 號還差一點才滿 3 分鐘
  const beforeView = (await state(m.roomId, "p0")).body.leaveRequest;
  const alive = await roomN(m.roomId);
  NOW = t + IDLE_VOTE_MS + 1; // 只讓時間走到 3 號剛好超過 3 分鐘；這段期間沒有任何 tick、送出、投票
  const reqLog: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => { reqLog.push(`${init?.method ?? "GET"} ${String(input).split("/rest/v1/")[1]?.split("?")[0]}`); return realFetch(input, init); }) as typeof fetch;
  const read = await state(m.roomId, "p0"); // 唯一的一次請求
  globalThis.fetch = realFetch;
  eq([beforeView.result, beforeView.needed, beforeView.approvedCount, alive, read.status, read.body.record?.endReason, await roomN(m.roomId), reqLog.includes("POST rpc/close_room_with_record")],
    ["vote", 3, 2, 1, 410, "dissolved", 0, true],
    "I3b 時間跨過 3 號的 3 分鐘之前投票還在（要 3 人、已 2 人同意、房間在）；之後只發一次「讀狀態」，就是這個請求呼叫關房、回 410 中途解散");
}

// ---------- I4b 截止時間的兩側（小測 2026-11-17）：截止前 1 毫秒送出算牌局動作；剛好截止時送出被拒（系統代排），不算 ----------
{
  const m = await newMatch();
  const t = NOW;
  const marks: string[] = [];
  while (NOW - t <= IDLE_VOTE_MS) {
    const v = (await state(m.roomId, "p0")).body;
    const sub = async (p: string) => { const a = autoArrange((await state(m.roomId, p)).body.me.hand as Card[]); return post(submitRoute, { roomId: m.roomId, playerId: p, front: ids(a.front), middle: ids(a.middle), back: ids(a.back) }, p); };
    for (const p of ["p0", "p1"]) await sub(p);
    NOW = v.arrangeDeadline - 1; const s2 = await sub("p2");   // 截止前 1 毫秒
    NOW = v.arrangeDeadline; const s3 = await sub("p3");       // 剛好截止
    const rv = (await state(m.roomId, "p0")).body.reveal;       // 亮牌內容：誰是系統代排的
    marks.push(`${s2.status}/${s3.status}:${s3.body.error}/代排${JSON.stringify(rv?.autoArranged)}`);
    NOW += NEXT_HAND_MAX_MS; await post(tickRoute, { roomId: m.roomId, playerId: "p0" }, "p0");
  }
  const r = await post(leaveReqRoute, { roomId: m.roomId, playerId: "p0" }, "p0");
  eq([marks.length > 1, [...new Set(marks)], r.body.needed, r.body.idleSeats], [true, ["200/409:time_up/代排[3]"], 2, [3]],
    "I4b 每局 2 號都在截止前 1 毫秒送出（200，算牌局動作）、3 號都在剛好截止時送出（409 time_up）；每局亮牌的代排名單都只有 3 號（他確實由系統代排、2 號不是）→ 3 分鐘後只有 3 號不計票，2 號照樣要同意");
}

// ---------- C 十三支聊天 ----------
const mc = await newMatch(PIDS, 4);
{
  const before = sent.length;
  const ok = await post(chatRoute, { roomId: mc.roomId, text: "大家好" }, "p0");
  const evs = sent.slice(before).filter((e) => e.event === "mj_chat");
  eq([ok.status, ok.body.message?.text, ok.body.message?.fromSeat, evs.length,
    evs.every((e) => PIDS.some((p, i) => e.channel === privateChannel(mc.roomId, mc.code, p, uid(i)))), evs.some((e) => e.channel === publicChannel(mc.code)),
    evs.some((e) => (e.channel ?? "").startsWith("mj-"))],
    [200, "大家好", 0, 4, true, false, false],
    "C1 玩家送出聊天：存起來，送到同桌四人各自的十三支座位頻道；公開頻道、麻將頻道都收不到");
  const ph = await post(chatRoute, { roomId: mc.roomId, phrase: "hurry" }, "p1");
  const fast = await post(chatRoute, { roomId: mc.roomId, text: "連發" }, "p1");
  const hist = await get(historyRoute, `roomId=${mc.roomId}`, "p2");
  eq([ph.body.message?.text, fast.status, fast.body.error, hist.status, hist.body.role, (hist.body.messages ?? []).map((m: { text: string }) => m.text)],
    ["快點啦", 429, "rate_limited", 200, "player", ["大家好", "快點啦"]],
    "C2 快捷短語、發太快 429（冷卻和麻將同一套）；同桌其他玩家讀得到聊天紀錄（舊到新）");
  const outRead = await get(historyRoute, `roomId=${mc.roomId}`, "watch");
  const outPost = await post(chatRoute, { roomId: mc.roomId, text: "我是外人" }, "watch");
  const noLogin = await get(historyRoute, `roomId=${mc.roomId}`);
  const fake = await post(chatRoute, { roomId: mc.roomId, playerId: "p1", text: "冒充" }, "p2");
  eq([outRead.status, outRead.body.error, outPost.status, outPost.body.error, noLogin.status, fake.body.error],
    [403, "not_allowed", 403, "not_in_room", 401, "not_your_seat"], "C3 不在這桌的人讀不到也送不出；沒登入 401；不能冒用別人的座位");
  // 觀戰者：被這房的玩家同意後才讀得到、收得到；不能發言
  const rr = await requestSpectate(mc.roomId, tokens["tk-watch"].id, "p1", "觀戰員", null);
  if (rr.ok) await respondSpectate(mc.roomId, "p1", rr.requestId, true);
  const spRead = await get(historyRoute, `roomId=${mc.roomId}`, "watch");
  const spPost = await post(chatRoute, { roomId: mc.roomId, text: "觀戰說話" }, "watch");
  const b2 = sent.length;
  await post(chatRoute, { roomId: mc.roomId, text: "第三則" }, "p3");
  const toSp = sent.slice(b2).filter((e) => e.channel === spectatorChannelName(mc.code, mc.roomId, tokens["tk-watch"].id));
  eq([rr.ok, spRead.status, spRead.body.role, spRead.body.spectatorChannel === spectatorChannelName(mc.code, mc.roomId, tokens["tk-watch"].id), spPost.body.error, toSp.length],
    [true, 200, "spectator", true, "not_in_room", 1], "C4 觀戰者被同意後：讀得到紀錄、拿到自己的觀戰頻道、收得到新訊息；不能發言（和麻將一樣）");
}
{
  // 訪客坐在桌上：讀得到、不能送
  const c = await post(createRoute, { hostId: "p0", arrangeSec: 30, totalHands: 8 }, "p0");
  await setTotalHands(db, c.body.roomId, 2); // 開房只能選 8／16／32；這裡照舊房的方式改成 2 局
  await post(joinRoute, { code: c.body.code, playerId: "p0", name: "玩家0" }, "p0");
  await post(joinRoute, { code: c.body.code, playerId: "g1", name: "訪客" }, "guest");
  const gRead = await get(historyRoute, `roomId=${c.body.roomId}`, "guest");
  const gPost = await post(chatRoute, { roomId: c.body.roomId, text: "訪客說話" }, "guest");
  const lobby = await post(chatRoute, { roomId: c.body.roomId, text: "還沒開局也能聊" }, "p0");
  eq([gRead.status, gPost.body.error, lobby.status], [200, "guest_not_allowed", 200], "C5 訪客玩家讀得到、不能發言；還沒開局（等人中）也能聊天，和麻將一樣");
}

// ---------- M 共用聊天 SQL：麻將照舊、互不誤刪 ----------
{
  const chatRows = async (room: string) => (await db.query<{ n: number }>(`select count(*)::int n from mj_chat_messages where room_id = $1`, [room])).rows[0].n;
  const mjLive = (await db.query<{ id: string }>(`insert into mj_rooms (code, status) values ('8801', 'playing') returning id::text id`)).rows[0].id;
  const orphan = "00000000-0000-4000-8000-00000000beef"; // 麻將房已經不在的孤兒聊天
  await db.query(`insert into mj_chat_messages (room_id, msg) values ($1, '{"text":"孤兒"}')`, [orphan]);
  const thBefore = await chatRows(mc.roomId);
  const post1 = (await db.query<{ w: number }>(`select mj_chat_post($1, 'u-mj', 'text', 2000, 5, 15000, 15000, '{"text":"麻將"}'::jsonb, 200) w`, [mjLive])).rows[0].w;
  const closedMj = (await db.query<{ w: number }>(`select mj_chat_post($1, 'u-mj', 'text', 2000, 5, 15000, 15000, '{"text":"已關"}'::jsonb, 200) w`, [orphan])).rows[0].w;
  eq([post1, await chatRows(mjLive), closedMj, await chatRows(orphan), await chatRows(mc.roomId), thBefore > 0],
    [0, 1, -1, 0, thBefore, true],
    "M1 麻將房照舊：還在的房寫得進去；不在的房回 -1、什麼都不寫；孤兒聊天被清掉——但十三支房間的聊天一則都沒被刪");
  // 十三支關房：聊天跟著刪；之後讀紀錄 410／404，寫入擋下
  await post(leaveReqRoute, { roomId: mc.roomId, playerId: "p0" }, "p0");
  for (const p of ["p1", "p2", "p3"]) await post(leaveVoteRoute, { roomId: mc.roomId, playerId: p, approve: true }, p);
  const gone = await get(historyRoute, `roomId=${mc.roomId}`, "p0");
  const late = await post(chatRoute, { roomId: mc.roomId, text: "晚到" }, "p1");
  const sqlLate = (await db.query<{ w: number }>(`select mj_chat_post($1, 'u', 'text', 0, 99, 1, 0, '{"text":"晚到"}'::jsonb, 200) w`, [mc.roomId])).rows[0].w;
  eq([await roomN(mc.roomId), await chatRows(mc.roomId), gone.status, late.status, sqlLate],
    [0, 0, 404, 404, -1], "M2 十三支關房：這房的聊天紀錄一起刪掉；之後讀不到、送不出，SQL 層晚到的寫入也擋下（-1）");
}

// ---------- B 20261117 回滾 ----------
{
  const SUPA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations");
  const md5 = async () => (await db.query<{ proname: string; h: string }>(`select proname, md5(prosrc) h from pg_proc where proname in ('mj_chat_lock_room','mj_chat_append','mj_chat_post') order by 1`)).rows.map((r) => [r.proname, r.h]);
  const now = await md5();
  await db.exec(readFileSync(path.join(SUPA, "20261117_thirteen_chat_rollback.sql"), "utf8"));
  const back = await md5();
  await db.exec(readFileSync(path.join(SUPA, "20261117_thirteen_chat.sql"), "utf8"));
  const again = await md5();
  // 正式庫 2026-11-17 唯讀查詢的雜湊（＝20261113 原文）
  const PROD = [["mj_chat_append", "c1e83e2a3dc3e69af1268549c9625a59"], ["mj_chat_lock_room", "f6d20773e4132af869acb190d514a3d5"], ["mj_chat_post", "b1d8cf1aa47c8c489e75879e40117f04"]];
  eq([back, now[2], JSON.stringify(again) === JSON.stringify(now), now[0][1] !== PROD[0][1], now[1][1] !== PROD[1][1]], [PROD, PROD[2], true, true, true],
    "B1 回滾後三個聊天函式和正式庫現在的版本一模一樣（mj_chat_post 這次本來就沒改）；可以再套一次");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
