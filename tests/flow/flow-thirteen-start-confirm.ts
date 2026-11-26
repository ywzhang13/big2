// 十三支開局確認（老柯 2026-11-20，老闆定案：房主按開始倒數 10 秒、四家都同意才開局、沒按完就不開、房主要重新按開始），走真的路由；
// 十三支和房卡帳都是記憶體 PostgreSQL 跑真的 migration。
//   S1 房主按開始：不發牌、不扣卡；房主自己算同意，倒數 10 秒；等人畫面（state）帶確認狀態；四家都同意 → 開局、每人扣 1 張（房主也扣，老闆帳號才不扣）
//   S2（v3b 2026-11-27）倒數中（剩 6 秒）非房主按「取消對戰」→ 回到等人、不發牌、不扣卡、廣播 th_start_cancelled（timeout、by）、
//      lastStartConfirm 記誰沒按；之後再按同意 409 no_confirm；房主倒數中也能取消；房主重新按開始、四家同意 → 開局
//   S3（v3）時間到還有人沒按：不作廢、繼續等（讀狀態／tick 都不取消、沒有 th_start_cancelled）；倒數後最後一人按同意 → 開局、每人扣 1 張
//   S4 三家同時按同意：都有記到、只開一次局（第 1 局）、每人只扣 1 張
//   S5 暫停：有人被暫停時房主按開始 403 player_suspended（不進入確認）；確認期間才被暫停 → 最後一家同意時 403、這次確認作廢、不發牌不扣卡
//   S6 確認期間有人離開 → 這次確認作廢，等人畫面沒有確認狀態；別人再按同意 409
//   S10（v3b）倒數中取消和最後一家同意同時送出：要嘛開局（每人扣 1 張、只開一次），要嘛取消（回等人、0 張），不會開出半局
//   S11（v3c 補測）沒入座的帳號直接送取消：403，確認還在、同意名單和截止時間不變、沒有取消廣播
//   S7 重複按：房主倒數中再按開始不會重新計時；同一個人重複按同意只記一次；不是本人座位 403；倒數中不能偷開（沒同意的人不能讓牌局開始）
import { setupThirteenDb } from "../support/thirteen-pg";
import { tokens } from "../support/stub-auth";
import { sent } from "../support/stub-broadcast";
import { addUser, db as cardDb, setSuspended } from "../support/stub-roomcard-store";
import { POST as createRoute } from "../../app/api/thirteen/create/route";
import { POST as joinRoute } from "../../app/api/thirteen/join/route";
import { POST as startRoute } from "../../app/api/thirteen/start/route";
import { POST as confirmRoute } from "../../app/api/thirteen/start-confirm/route";
import { POST as cancelRoute } from "../../app/api/thirteen/start-cancel/route";
import { POST as leaveRoute } from "../../app/api/thirteen/leave/route";
import { POST as tickRoute } from "../../app/api/thirteen/tick/route";
import { GET as stateRoute } from "../../app/api/thirteen/state/route";
import { clock } from "../../lib/thirteen/flow";
import { START_CONFIRM_MS } from "../../lib/lobby/startConfirm";
import { lastConfirmNote } from "../../components/thirteen/ThWaiting";
import type { ThWaitingView } from "../../components/thirteen/useThirteenRoom";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
const th = await setupThirteenDb();
const cards = await cardDb();
let NOW = Date.parse("2026-11-20T12:00:00Z");
clock.now = () => NOW;
const KEYS = ["a", "b", "c", "d", "e"];
const U = Object.fromEntries(KEYS.map((k, i) => [k, `00000000-0000-4000-8000-0000000000${(0xa1 + i).toString(16)}`]));
for (const k of KEYS) { tokens[`tk-${k}`] = { id: U[k], displayName: k, pictureUrl: null, isGuest: false }; await addUser(U[k], `玩家${k}`); }
type Res = { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
async function post(fn: (r: Request) => Promise<Response>, body: object, as: string): Promise<Res> {
  const r = await fn(new Request("http://x", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer tk-${as}` }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
}
async function state(roomId: string, as: string, pid: string): Promise<Res> {
  const r = await stateRoute(new Request(`http://x/?roomId=${roomId}&playerId=${pid}`, { headers: { authorization: `Bearer tk-${as}` } }));
  return { status: r.status, body: await r.json() };
}
/** 開一間坐滿的房：keys[0] 是房主 */
async function seated(keys: string[]) {
  const c = (await post(createRoute, { hostId: `h-${keys[0]}`, arrangeSec: 30, totalHands: 8 }, keys[0])).body as { roomId: string; code: string };
  const pids = keys.map((k, i) => (i === 0 ? `h-${k}` : `x-${k}`));
  for (const [i, k] of keys.entries()) await post(joinRoute, { code: c.code, playerId: pids[i], name: `玩家${k}` }, k);
  return { ...c, pids, keys };
}
const status = async (roomId: string) => (await th.query<{ status: string; hand: number }>(`select status, (game_state->>'handNo')::int hand from th_rooms where id = $1`, [roomId])).rows[0];
const charges = async (roomId: string) => Number((await cards.query<{ n: number }>(`select count(*)::int n from room_card_ledger where kind = 'charge' and room_id = $1`, [roomId])).rows[0].n);
const events = (name: string) => sent.filter((e) => e.event === name);
/** 某一家（座位 i）在等人畫面看到的提示（照伺服器狀態算，跟畫面同一個函式；v3c） */
const noteOf = async (r: { roomId: string; pids: string[]; keys: string[] }, i: number) => lastConfirmNote((await state(r.roomId, r.keys[i], r.pids[i])).body as ThWaitingView, r.pids[i]);
/** 這間房目前這一輪確認的編號（前端從開始的回應、廣播或狀態拿到；沒有確認＝undefined） */
const cid = async (roomId: string): Promise<string | undefined> =>
  (await th.query<{ id: string | null }>(`select game_state->'startConfirm'->>'id' id from th_rooms where id = $1`, [roomId])).rows[0]?.id ?? undefined;

// S1
{
  const r = await seated(["a", "b", "c", "d"]);
  const st = await post(startRoute, { roomId: r.roomId, playerId: r.pids[0] }, "a");
  const w = await state(r.roomId, "b", r.pids[1]);
  const s0 = await status(r.roomId);
  eq([st.status, st.body.confirm?.readyIds, st.body.confirm?.deadline - NOW, s0.status, await charges(r.roomId), w.body.startConfirm?.readyIds, w.body.startConfirm?.deadline],
    [200, [r.pids[0]], START_CONFIRM_MS, "waiting", 0, [r.pids[0]], NOW + 10_000], "S1 房主按開始：倒數 10 秒、房主自己算同意；還沒發牌、沒扣卡；等人畫面帶確認狀態");
  const a1 = await post(confirmRoute, { roomId: r.roomId, playerId: r.pids[1], confirmId: await cid(r.roomId) }, "b");
  const a2 = await post(confirmRoute, { roomId: r.roomId, playerId: r.pids[2], confirmId: await cid(r.roomId) }, "c");
  const mid = await status(r.roomId);
  const a3 = await post(confirmRoute, { roomId: r.roomId, playerId: r.pids[3], confirmId: await cid(r.roomId) }, "d");
  const s1 = await status(r.roomId);
  eq([a1.body.confirm?.readyIds.length, a2.body.confirm?.readyIds.length, mid.status, a3.status, a3.body.started, s1.status, s1.hand, await charges(r.roomId)],
    [2, 3, "waiting", 200, true, "playing", 1, 4], "S1 三家依序同意：前兩家還在等，第四家同意 → 開局（第 1 局），四人各扣 1 張");
}
// S2（v3b）
{
  const r = await seated(["a", "b", "c", "d"]);
  await post(startRoute, { roomId: r.roomId, playerId: r.pids[0] }, "a");
  await post(confirmRoute, { roomId: r.roomId, playerId: r.pids[1], confirmId: await cid(r.roomId) }, "b");
  NOW += 4_000;                                                                                           // 還剩 6 秒
  sent.length = 0;
  const cc = await post(cancelRoute, { roomId: r.roomId, playerId: r.pids[2], confirmId: await cid(r.roomId) }, "c");   // 非房主、自己也沒按
  const late = await post(confirmRoute, { roomId: r.roomId, playerId: r.pids[3], confirmId: await cid(r.roomId) }, "d");
  const w = await state(r.roomId, "b", r.pids[1]);
  eq([cc.status, cc.body.cancelled, events("th_start_cancelled").map((e) => [e.payload.reason, e.payload.by]), late.status, late.body.error,
    w.body.status, w.body.startConfirm, w.body.lastStartConfirm?.reason, w.body.lastStartConfirm?.missingIds, (await status(r.roomId)).status, await charges(r.roomId)],
    [200, true, [["cancelled", r.pids[2]]], 409, "no_confirm",
      "waiting", null, "cancelled", [r.pids[2], r.pids[3]], "waiting", 0],
    "S2 倒數中（剩 6 秒）非房主取消對戰 → 回到等人、廣播 cancelled＋誰按的、記下誰沒按、不扣卡；之後同意 409 no_confirm");
  eq([await noteOf(r, 0), await noteOf(r, 1), await noteOf(r, 3), await noteOf(r, 2)], ["玩家c 取消了對戰", "玩家c 取消了對戰", "玩家c 取消了對戰", "你 取消了對戰"],
    "S2 提示（v3c）：倒數中取消，其他三家看到「玩家c 取消了對戰」，按的人自己看到「你 取消了對戰」");
  await post(startRoute, { roomId: r.roomId, playerId: r.pids[0] }, "a");
  NOW += 1_000;
  const hc = await post(cancelRoute, { roomId: r.roomId, playerId: r.pids[0], confirmId: await cid(r.roomId) }, "a");
  eq([hc.status, hc.body.cancelled, (await state(r.roomId, "a", r.pids[0])).body.startConfirm, await charges(r.roomId)], [200, true, null, 0], "S2 房主倒數中也能取消對戰");
  eq([await noteOf(r, 1), await noteOf(r, 2), await noteOf(r, 3)], ["玩家a 取消了對戰", "玩家a 取消了對戰", "玩家a 取消了對戰"], "S2 提示（v3c）：房主取消，其他三家看到「玩家a 取消了對戰」");
  const again = await post(startRoute, { roomId: r.roomId, playerId: r.pids[0] }, "a");
  for (const i of [1, 2, 3]) await post(confirmRoute, { roomId: r.roomId, playerId: r.pids[i], confirmId: await cid(r.roomId) }, r.keys[i]);
  eq([again.body.confirm?.deadline - NOW, (await state(r.roomId, "b", r.pids[1])).body.lastStartConfirm ?? null, (await status(r.roomId)).status, await charges(r.roomId)], [10_000, null, "playing", 4],
    "S2 取消對戰後房主重新按開始：重新倒數 10 秒、上一次紀錄清掉；四家同意 → 開局、每人扣 1 張");
}
// S10（v3b）
for (let round = 0; round < 5; round++) {
  const r = await seated(["a", "b", "c", "d"]);
  await post(startRoute, { roomId: r.roomId, playerId: r.pids[0] }, "a");
  for (const i of [1, 2]) await post(confirmRoute, { roomId: r.roomId, playerId: r.pids[i], confirmId: await cid(r.roomId) }, r.keys[i]);
  NOW += 2_000;
  sent.length = 0;
  const id8 = await cid(r.roomId);
  const reqs = [() => post(confirmRoute, { roomId: r.roomId, playerId: r.pids[3], confirmId: id8 }, "d"), () => post(cancelRoute, { roomId: r.roomId, playerId: r.pids[1], confirmId: id8 }, "b")];
  const out = await Promise.all((round % 2 ? [...reqs].reverse() : reqs).map((f) => f()));  // 單雙輪換誰先送
  const [ag, cn] = round % 2 ? [out[1], out[0]] : out;
  const s = await status(r.roomId);
  const started = s.status === "playing";
  eq([started ? [s.hand, events("th_hand_start").length, await charges(r.roomId), cn.body.cancelled === true] : [s.status, events("th_hand_start").length, await charges(r.roomId), ag.body.started === true],
    ag.status < 500 && cn.status < 500],
    [started ? [1, 1, 4, false] : ["waiting", 0, 0, false], true],
    `S10 第 ${round + 1} 次：倒數中取消和最後一家同意同時送出 → ${started ? "開局（只開一次、每人扣 1 張、取消沒生效）" : "取消（回等人、不發牌、0 張、同意沒開局）"}，沒有 5xx`);
}
// S2b（v3c）倒數結束後還沒到齊，非房主取消對戰 → 其他三家看到「名字 取消了對戰」
{
  const r = await seated(["a", "b", "c", "d"]);
  await post(startRoute, { roomId: r.roomId, playerId: r.pids[0] }, "a");
  await post(confirmRoute, { roomId: r.roomId, playerId: r.pids[1], confirmId: await cid(r.roomId) }, "b");
  NOW += 15_000;                                                                                          // 倒數已結束 5 秒
  const cc = await post(cancelRoute, { roomId: r.roomId, playerId: r.pids[3], confirmId: await cid(r.roomId) }, "d");
  eq([cc.status, cc.body.cancelled, await noteOf(r, 0), await noteOf(r, 1), await noteOf(r, 2), await noteOf(r, 3), await charges(r.roomId)],
    [200, true, "玩家d 取消了對戰", "玩家d 取消了對戰", "玩家d 取消了對戰", "你 取消了對戰", 0],
    "S2b 倒數結束後非房主取消對戰：其他三家看到「玩家d 取消了對戰」、按的人看到「你 取消了對戰」、不扣卡（v3c）");
}
// S3（v3）
{
  const r = await seated(["a", "b", "c", "d"]);
  await post(startRoute, { roomId: r.roomId, playerId: r.pids[0] }, "a");
  await post(confirmRoute, { roomId: r.roomId, playerId: r.pids[1], confirmId: await cid(r.roomId) }, "b");
  await post(confirmRoute, { roomId: r.roomId, playerId: r.pids[2], confirmId: await cid(r.roomId) }, "c"); // d 沒按
  NOW += 10_000;
  sent.length = 0;
  const tick = await post(tickRoute, { roomId: r.roomId, playerId: r.pids[0] }, "a");
  const after = await state(r.roomId, "d", r.pids[3]);
  NOW += 30_000;                                                                                          // 倒數結束後又過了 30 秒
  const after2 = await state(r.roomId, "a", r.pids[0]);
  const mid = [(await status(r.roomId)).status, await charges(r.roomId)];
  const last = await post(confirmRoute, { roomId: r.roomId, playerId: r.pids[3], confirmId: await cid(r.roomId) }, "d");
  eq([tick.status, events("th_start_cancelled").length, after.body.startConfirm?.readyIds?.length, after2.body.startConfirm?.readyIds?.length, after2.body.lastStartConfirm ?? null, mid,
    last.status, last.body.started, (await status(r.roomId)).status, await charges(r.roomId)],
    [200, 0, 3, 3, null, ["waiting", 0], 200, true, "playing", 4],
    "S3 10 秒到還有人沒按：不作廢、繼續等（tick、讀狀態都不取消，沒有取消廣播，40 秒後還在）；最後一人在倒數後按同意 → 開局、每人扣 1 張");
}
// S4
{
  const r = await seated(["a", "b", "c", "d"]);
  await post(startRoute, { roomId: r.roomId, playerId: r.pids[0] }, "a");
  sent.length = 0;
  const id4 = await cid(r.roomId);
  const all = await Promise.all([1, 2, 3].map((i) => post(confirmRoute, { roomId: r.roomId, playerId: r.pids[i], confirmId: id4 }, r.keys[i])));
  const s = await status(r.roomId);
  eq([all.map((x) => x.status), all.filter((x) => x.body.started).length >= 1, s.status, s.hand, events("th_hand_start").length, await charges(r.roomId)], [[200, 200, 200], true, "playing", 1, 1, 4],
    "S4 三家同時按同意：都記到、只開一次局（第 1 局、只廣播一次開局）、每人只扣 1 張");
}
// S5
{
  const r = await seated(["a", "b", "c", "e"]);
  await setSuspended(U.a, U.e, true, "00000000-0000-4000-9000-000000000501");
  const st = await post(startRoute, { roomId: r.roomId, playerId: r.pids[0] }, "a");
  eq([st.status, st.body.error, st.body.players, (await state(r.roomId, "a", r.pids[0])).body.startConfirm], [403, "player_suspended", [{ seat: 3, name: "玩家e" }], null],
    "S5 有人被暫停時房主按開始：403 player_suspended，不進入確認");
  await setSuspended(U.a, U.e, false, "00000000-0000-4000-9000-000000000502");
  await post(startRoute, { roomId: r.roomId, playerId: r.pids[0] }, "a");
  await post(confirmRoute, { roomId: r.roomId, playerId: r.pids[1], confirmId: await cid(r.roomId) }, "b");
  await post(confirmRoute, { roomId: r.roomId, playerId: r.pids[2], confirmId: await cid(r.roomId) }, "c");
  await setSuspended(U.a, U.e, true, "00000000-0000-4000-9000-000000000503"); // 確認期間才被暫停
  sent.length = 0;
  const last = await post(confirmRoute, { roomId: r.roomId, playerId: r.pids[3], confirmId: await cid(r.roomId) }, "e");
  eq([last.status, last.body.error, events("th_start_cancelled").map((e) => e.payload.reason), (await status(r.roomId)).status, (await state(r.roomId, "a", r.pids[0])).body.startConfirm, await charges(r.roomId)],
    [403, "player_suspended", ["suspended"], "waiting", null, 0], "S5 確認期間才被暫停：最後一家同意時再檢查一次 → 403、這次確認作廢（suspended），不發牌、不扣卡");
  await setSuspended(U.a, U.e, false, "00000000-0000-4000-9000-000000000504");
}
// S6
{
  const r = await seated(["a", "b", "c", "d"]);
  await post(startRoute, { roomId: r.roomId, playerId: r.pids[0] }, "a");
  sent.length = 0;
  const lv = await post(leaveRoute, { roomId: r.roomId }, "d");
  const w = await state(r.roomId, "a", r.pids[0]);
  const late = await post(confirmRoute, { roomId: r.roomId, playerId: r.pids[1], confirmId: await cid(r.roomId) }, "b");
  eq([lv.status, events("th_start_cancelled").map((e) => e.payload.reason), w.body.startConfirm, w.body.seats.length, late.status, (await status(r.roomId)).status], [200, ["seats_changed"], null, 3, 409, "waiting"],
    "S6 確認期間有人離開：這次確認作廢（seats_changed），等人畫面沒有確認狀態；別人再按同意 409");
  eq([await noteOf(r, 0), await noteOf(r, 1)], ["有人離開了，這次開局取消", "有人離開了，這次開局取消"], "S6 提示不變（v3c）：有人離開 →「有人離開了，這次開局取消」");
}
// S7
{
  const r = await seated(["a", "b", "c", "d"]);
  const first = await post(startRoute, { roomId: r.roomId, playerId: r.pids[0] }, "a");
  NOW += 3000;
  const second = await post(startRoute, { roomId: r.roomId, playerId: r.pids[0] }, "a");
  const b1 = await post(confirmRoute, { roomId: r.roomId, playerId: r.pids[1], confirmId: await cid(r.roomId) }, "b");
  const b2 = await post(confirmRoute, { roomId: r.roomId, playerId: r.pids[1], confirmId: await cid(r.roomId) }, "b");
  const wrong = await post(confirmRoute, { roomId: r.roomId, playerId: r.pids[2], confirmId: await cid(r.roomId) }, "b"); // b 冒充 c
  const stillWaiting = (await status(r.roomId)).status;
  eq([second.body.confirm?.deadline === first.body.confirm?.deadline, b1.body.confirm?.readyIds.length, b2.body.confirm?.readyIds.length, wrong.status, wrong.body.error, stillWaiting],
    [true, 2, 2, 403, "not_your_seat", "waiting"], "S7 倒數中再按開始不重新計時；重複按同意只記一次；不能幫別人按（403）；沒同意完不會開局");
}

// S8（審伯 R1）：舊一輪的同意、取消晚到或重送，不能動到新一輪；沒帶編號的不算
{
  const r = await seated(["a", "b", "c", "d"]);
  const s1 = await post(startRoute, { roomId: r.roomId, playerId: r.pids[0] }, "a");
  const id1 = s1.body.confirm?.id as string;
  const oldAgree = { roomId: r.roomId, playerId: r.pids[1], confirmId: id1 };
  const oldCancel = { roomId: r.roomId, playerId: r.pids[0], confirmId: id1 };
  await post(confirmRoute, oldAgree, "b");
  NOW += 10_000; // v3：倒數結束後才能取消
  await post(cancelRoute, oldCancel, "a");
  const s2 = await post(startRoute, { roomId: r.roomId, playerId: r.pids[0] }, "a");
  const id2 = s2.body.confirm?.id as string;
  sent.length = 0;
  const replayAgree = await post(confirmRoute, oldAgree, "b");
  const replayCancel = await post(cancelRoute, oldCancel, "a");
  const noId = await post(confirmRoute, { roomId: r.roomId, playerId: r.pids[2] }, "c");
  const st = await state(r.roomId, "a", r.pids[0]);
  eq([typeof id1, id1 !== id2, replayAgree.status, replayAgree.body.error, replayCancel.status, replayCancel.body.error, noId.status, noId.body.error,
    st.body.startConfirm?.id === id2, st.body.startConfirm?.readyIds, events("th_start_ready").length, events("th_start_cancelled").length],
    ["string", true, 409, "stale_confirm", 409, "stale_confirm", 400, "confirm_id_required", true, [r.pids[0]], 0, 0],
    "S8 取消後重新開始：第一輪的同意、取消重送都回 409 stale_confirm，新一輪的名單和確認都不變、不廣播；沒帶確認編號回 400");
  for (const i of [1, 2, 3]) await post(confirmRoute, { roomId: r.roomId, playerId: r.pids[i], confirmId: id2 }, r.keys[i]);
  eq([(await status(r.roomId)).status, await charges(r.roomId)], ["playing", 4], "S8 新一輪帶自己的編號照常：四家同意 → 開局、每人扣 1 張");
}
// S9（審伯 R1）：同意存檔撞到版本衝突、重讀時已經是新一輪 → 不能改綁到新一輪
{
  const r = await seated(["a", "b", "c", "d"]);
  const s1 = await post(startRoute, { roomId: r.roomId, playerId: r.pids[0] }, "a");
  const id1 = s1.body.confirm?.id as string;
  await post(confirmRoute, { roomId: r.roomId, playerId: r.pids[1], confirmId: id1 }, "b");
  // c 的同意要存檔的那一刻，另一台伺服器剛好讓房主取消又重新開始（新編號、只有房主同意、版本 +1）→ c 的存檔版本對不上、重讀再做
  const orig = th.query.bind(th);
  let injected = false;
  (th as { query: typeof th.query }).query = (async (sql: string, params?: unknown[]) => {
    if (!injected && /^\s*update\s+\S*th_rooms\b/i.test(sql) && JSON.stringify(params ?? []).includes(r.pids[2])) {
      injected = true;
      await orig(`update th_rooms set game_state = jsonb_set(jsonb_set(game_state, '{startConfirm}',
        jsonb_build_object('id', 'round-2', 'startedBy', $2::text, 'seatIds', game_state->'startConfirm'->'seatIds', 'readyIds', jsonb_build_array($2::text), 'deadline', (game_state->'startConfirm'->>'deadline')::bigint)),
        '{stateVersion}', to_jsonb((game_state->>'stateVersion')::int + 1)) where id = $1`, [r.roomId, r.pids[0]]);
    }
    return orig(sql, params);
  }) as typeof th.query;
  const res = await post(confirmRoute, { roomId: r.roomId, playerId: r.pids[2], confirmId: id1 }, "c");
  (th as { query: typeof th.query }).query = orig;
  const st = await state(r.roomId, "a", r.pids[0]);
  eq([injected, res.status, res.body.error, st.body.startConfirm?.id, st.body.startConfirm?.readyIds, (await status(r.roomId)).status, await charges(r.roomId)],
    [true, 409, "stale_confirm", "round-2", [r.pids[0]], "waiting", 0], "S9 存檔衝突後重讀到新一輪：舊一輪的同意回 409 stale_confirm，沒有加進新一輪、沒開局、沒扣卡");
}

// S11（v3c 補測：小測標準２）
{
  const r = await seated(["a", "b", "c", "d"]);                                                         // e 沒入座
  await post(startRoute, { roomId: r.roomId, playerId: r.pids[0] }, "a");
  await post(confirmRoute, { roomId: r.roomId, playerId: r.pids[1], confirmId: await cid(r.roomId) }, "b");
  NOW += 3_000;
  const snap = async () => { const c = (await state(r.roomId, "a", r.pids[0])).body.startConfirm; return c && [c.id, c.readyIds, c.seatIds, c.deadline]; };
  const before = await snap();
  sent.length = 0;
  const own = await post(cancelRoute, { roomId: r.roomId, playerId: "x-e", confirmId: await cid(r.roomId) }, "e");       // 填自己（不存在的座位）
  const fake = await post(cancelRoute, { roomId: r.roomId, playerId: r.pids[2], confirmId: await cid(r.roomId) }, "e");  // 填別人的座位
  const after = await snap();
  eq([own.status, fake.status, before !== null, JSON.stringify(after) === JSON.stringify(before), events("th_start_cancelled").length, (await status(r.roomId)).status, await charges(r.roomId)],
    [403, 403, true, true, 0, "waiting", 0],
    "S11 沒入座的帳號送取消（填自己、填別人的座位）都 403；確認還在、編號／同意名單／截止時間都不變、沒有取消廣播、不扣卡");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
