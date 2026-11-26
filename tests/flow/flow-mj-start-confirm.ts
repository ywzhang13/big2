// 麻將開局確認（老柯 2026-11-20，老闆定案，規則同十三支、大老二）：房主按開始倒數 10 秒、四家都同意才發牌並扣房卡、沒按完不開局、
// 房主要重新按開始；房主可以取消；每一輪有確認編號；用受理時刻判斷逾時。走真的麻將路由，房卡帳是記憶體 PostgreSQL 跑真的 migration。
//   M1 房主按開始：不發牌、不扣卡；倒數 10 秒、房主自己算同意；等人狀態帶確認；三家依序同意 → 第四家同意才開局，每人扣 1 張
//   M2（v3 2026-11-26）10 秒到還有人沒按：不作廢、繼續等（讀狀態不取消、沒有取消廣播、不扣卡）；倒數後最後一人按同意 → 開局、每人扣 1 張
//   M3（v3b 2026-11-27）倒數中（剩 6 秒）非房主「取消對戰」→ 回到等人、不扣卡、原因 timeout＋誰沒按；房主倒數中也能取消；
//      之後同意 409；用自己的登入填別人的座位不能取消（403）；房主重按 → 新一輪、四家同意才開
//   M4 三家同時按同意：都記到、只開一局、每人只扣 1 張
//   M5 舊一輪的同意、取消重送不能動新一輪；沒帶編號 400；存檔衝突後重讀到新一輪也不能改綁
//   M6 最後一家同意之後、發牌之前（廣播期間）房主取消又重新開始 → 舊請求不能拿新一輪開局；有人退出 → 作廢
//   M7（v3）倒數結束後的同意也算：deadline 前 1 毫秒、剛好 deadline、30 秒後受理最後一家同意都開局；處理途中跨過截止照樣開局
//   M8 暫停：房裡有人被暫停 → 房主按開始 403、不進確認；確認期間才被暫停 → 最後一家同意時 403、這次作廢、不發牌不扣卡
//   M9 不能替別人按同意（403）
//   M11（v3c 補測）沒入座的帳號直接送取消：403，確認還在、同意名單和截止時間不變、沒有取消廣播
//   M10（v3b）倒數中取消和最後一家同意同時送出：要嘛開局（只開一次、每人扣 1 張），要嘛取消（回等人、0 張），不會開出半局
import { tokens } from "../support/stub-auth";
import { lobbyHooks, rooms, seats } from "../support/stub-db";
import { mjBroadcastHooks, sent } from "../support/stub-broadcast";
import { addUser, db as cardDb, setSuspended } from "../support/stub-roomcard-store";
import { POST as start } from "../../app/api/mahjong/start/route";
import { GET as stateRoute } from "../../app/api/mahjong/state/route";
import { POST as leave } from "../../app/api/mahjong/leave/route";
import type { MahjongGameState } from "../../lib/mahjong/gameState";
import { mjConfirmNote } from "../../components/mahjong/mjStartConfirmView";

// 同意、取消是新的路由：修改前沒有這兩支，其他項目照樣跑（才看得出修改前哪些是紅的）
type Route = { POST: (r: Request) => Promise<Response> } | null;
const confirmMod = await import("../../app/api/mahjong/start-confirm/route").catch(() => null) as Route;
const cancelMod = await import("../../app/api/mahjong/start-cancel/route").catch(() => null) as Route;

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
let NOW = Date.parse("2026-11-20T09:00:00Z");
Date.now = () => NOW; // 開局確認的時間看伺服器的 Date.now
const cards = await cardDb();
const KEYS = ["a", "b", "c", "d", "e"];
const U = Object.fromEntries(KEYS.map((k, i) => [k, `00000000-0000-4000-8000-0000000001${(0xa1 + i).toString(16)}`]));
for (const k of KEYS) { tokens[`mk-${k}`] = { id: U[k], displayName: k, pictureUrl: null, isGuest: false }; await addUser(U[k], `玩家${k}`); }

type Res = { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
async function post(fn: ((r: Request) => Promise<Response>) | undefined, body: object, as: string): Promise<Res> {
  if (!fn) return { status: 404, body: { error: "no_route" } };
  const r = await fn(new Request("http://x", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer mk-${as}` }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
}
async function state(roomId: string, as: string, pid: string): Promise<Res> {
  const r = await stateRoute(new Request(`http://x/?roomId=${roomId}&playerId=${pid}`, { headers: { authorization: `Bearer mk-${as}` } }));
  return { status: r.status, body: await r.json() };
}
let n = 0;
/** 坐滿的等人房：座位 m0～m3 綁 keys 的帳號，m0 是房主 */
function seated(keys = ["a", "b", "c", "d"]) {
  const id = `SC${++n}`;
  rooms[id] = { id, code: `C${n}`, status: "waiting", host_id: "m0", game_state: { roomSettings: { totalRounds: 1, basePoints: 10, fanPoints: 10 } } as unknown as MahjongGameState };
  seats[id] = keys.map((k, i) => ({ player_id: `m${i}`, name: `玩家${k}`, seat: i, user_id: U[k] }));
  return { id, keys, pids: keys.map((_, i) => `m${i}`) };
}
type R = ReturnType<typeof seated>;
const lobby = (r: R) => rooms[r.id].game_state as unknown as { startConfirm?: { id: string; readyIds: string[]; deadline: number } | null };
const cid = (r: R) => lobby(r).startConfirm?.id;
const begin = (r: R) => post(start, { roomId: r.id, playerId: "m0" }, r.keys[0]);
const agreeWith = (r: R, i: number, confirmId: string | undefined, as = r.keys[i]) => post(confirmMod?.POST, { roomId: r.id, playerId: r.pids[i], confirmId }, as);
const agree = (r: R, i: number) => agreeWith(r, i, cid(r));
const cancelWith = (r: R, confirmId: string | undefined, as = r.keys[0], playerId = "m0") => post(cancelMod?.POST, { roomId: r.id, playerId, confirmId }, as);
const events = (name: string) => sent.filter((e) => e.event === name);
/** 座位 i 在等人畫面看到的提示（照伺服器狀態、跟畫面同一個函式；v3c） */
const noteOf = async (r: { id: string; keys: string[]; pids: string[] }, i: number) => {
  const b = (await state(r.id, r.keys[i], r.pids[i])).body;
  return mjConfirmNote(b.lastStartConfirm, !!b.startConfirm, b.lobbyPlayers, r.pids[i], b.hostId === r.pids[i]);
};
const charges = async (roomId: string) => Number((await cards.query<{ n: number }>(`select count(*)::int n from room_card_ledger where kind = 'charge' and room_id = $1`, [roomId])).rows[0].n);
let op = 0;
const opId = () => `00000000-0000-4000-9100-${String(++op).padStart(12, "0")}`;

// M1
{
  const r = seated();
  sent.length = 0;
  const s = await begin(r);
  const st = await state(r.id, "b", "m1");
  const early = [events("mj_game_start").length, rooms[r.id].status, await charges(r.id)];
  const a1 = await agree(r, 1), a2 = await agree(r, 2);
  const mid = rooms[r.id].status;
  const a3 = await agree(r, 3);
  eq([s.status, s.body.confirm?.deadline - NOW, s.body.confirm?.readyIds, typeof s.body.confirm?.id, st.body.startConfirm?.readyIds, st.body.startConfirm?.deadline - NOW, early],
    [200, 10_000, ["m0"], "string", ["m0"], 10_000, [0, "waiting", 0]], "M1 房主按開始：不發牌、不扣卡；倒數 10 秒、房主自己算同意；等人狀態（別人看）帶確認和編號");
  eq([a1.body.started ?? false, a2.body.started ?? false, mid, a3.status, rooms[r.id].status, events("mj_game_start").length, events("mj_deal_hand").length, await charges(r.id)],
    [false, false, "waiting", 200, "playing", 1, 4, 4], "M1 三家依序同意：前兩家還在等，第四家同意才開局；只開一次、每人一份手牌、每人扣 1 張");
}
// M2（v3）
{
  const r = seated();
  await begin(r);
  await agree(r, 1); await agree(r, 2); // m3 沒按
  const id1 = cid(r);
  NOW += 10_000;
  sent.length = 0;
  const after = await state(r.id, "b", "m1");
  NOW += 30_000;
  const after2 = await state(r.id, "c", "m2");
  const mid = [rooms[r.id].status, await charges(r.id), events("mj_start_cancelled").length];
  const last = await agreeWith(r, 3, id1);
  eq([after.body.startConfirm?.readyIds, after2.body.startConfirm?.id === id1, after2.body.lastStartConfirm ?? null, mid, last.status, last.body.started, rooms[r.id].status, await charges(r.id)],
    [["m0", "m1", "m2"], true, null, ["waiting", 0, 0], 200, true, "playing", 4],
    "M2 10 秒到還有人沒按：不作廢、繼續等（40 秒後還在、沒有取消廣播、不扣卡）；最後一人在倒數後按同意 → 開局、每人扣 1 張");
}
// M3（v3b）
{
  const r = seated();
  await begin(r);
  await agree(r, 1);
  NOW += 4_000;                                               // 還剩 6 秒
  sent.length = 0;
  const imposter = await cancelWith(r, cid(r), "b", "m2");   // b 用自己的登入填 c 的座位
  const c = await cancelWith(r, cid(r), "b", "m1");          // 非房主取消對戰
  const st = await state(r.id, "c", "m2");
  const late = await agreeWith(r, 2, "whatever");
  eq([imposter.status, c.status, c.body.cancelled, st.body.status, st.body.lastStartConfirm?.reason, st.body.lastStartConfirm?.missingIds,
    events("mj_start_cancelled").map((e) => [e.payload.reason, e.payload.by]), late.status, events("mj_game_start").length, await charges(r.id)],
    [403, 200, true, "waiting", "cancelled", ["m2", "m3"], [["cancelled", "m1"]], 409, 0, 0],
    "M3 倒數中（剩 6 秒）非房主取消對戰 → 回到等人、不扣卡、原因 cancelled＋誰沒按；之後同意 409；填別人的座位 403");
  eq([await noteOf(r, 0), await noteOf(r, 2), await noteOf(r, 3), await noteOf(r, 1)], ["玩家b 取消了對戰", "玩家b 取消了對戰", "玩家b 取消了對戰", "你 取消了對戰"],
    "M3 提示（v3c）：倒數中取消，其他三家看到「玩家b 取消了對戰」，按的人看到「你 取消了對戰」");
  await begin(r);
  NOW += 1_000;
  const hc = await cancelWith(r, cid(r));
  eq([hc.status, hc.body.cancelled, lobby(r).startConfirm ?? null, await charges(r.id)], [200, true, null, 0], "M3 房主倒數中也能取消對戰");
  eq([await noteOf(r, 1), await noteOf(r, 2), await noteOf(r, 3)], ["玩家a 取消了對戰", "玩家a 取消了對戰", "玩家a 取消了對戰"], "M3 提示（v3c）：房主取消，其他三家看到「玩家a 取消了對戰」");
  const again = await begin(r);
  for (const i of [1, 2, 3]) await agree(r, i);
  eq([again.body.confirm?.deadline - NOW, rooms[r.id].status, await charges(r.id)], [10_000, "playing", 4], "M3 取消對戰後房主重按：新一輪、重新倒數 10 秒；四家同意 → 開局、每人扣 1 張");
}
// M3b（v3c）倒數結束後非房主取消對戰、有人退出：提示
{
  const r = seated();
  await begin(r);
  await agree(r, 1);
  NOW += 15_000;                                              // 倒數已結束 5 秒
  const c = await cancelWith(r, cid(r), "d", "m3");
  eq([c.status, c.body.cancelled, await noteOf(r, 0), await noteOf(r, 1), await noteOf(r, 2), await noteOf(r, 3), await charges(r.id)],
    [200, true, "玩家d 取消了對戰", "玩家d 取消了對戰", "玩家d 取消了對戰", "你 取消了對戰", 0],
    "M3b 倒數結束後非房主取消對戰：其他三家看到「玩家d 取消了對戰」、按的人看到「你 取消了對戰」、不扣卡（v3c）");
  await begin(r);
  const lv = await post(leave, { roomId: r.id }, "c");
  eq([lv.status, await noteOf(r, 0), await noteOf(r, 1)], [200, "有人離開了，這次開局取消", "有人離開了，這次開局取消"], "M3b 提示不變（v3c）：確認中有人退出 →「有人離開了，這次開局取消」");
}
// M4
{
  const r = seated();
  await begin(r);
  const id = cid(r);
  sent.length = 0;
  const all = await Promise.all([1, 2, 3].map((i) => agreeWith(r, i, id)));
  eq([all.map((x) => x.status), rooms[r.id].status, events("mj_game_start").length, events("mj_deal_hand").length, await charges(r.id)], [[200, 200, 200], "playing", 1, 4, 4],
    "M4 三家同時按同意：都記到、只開一局、每人只扣 1 張");
}
// M5
{
  const r = seated();
  const s1 = await begin(r);
  const id1 = s1.body.confirm?.id as string;
  await agreeWith(r, 1, id1);
  NOW += 10_000; // v3：倒數結束後才能取消
  await cancelWith(r, id1);
  const s2 = await begin(r);
  const id2 = s2.body.confirm?.id as string;
  sent.length = 0;
  const replayAgree = await agreeWith(r, 1, id1);
  const replayCancel = await cancelWith(r, id1);
  const noId = await agreeWith(r, 2, undefined);
  eq([id1 !== id2, replayAgree.status, replayAgree.body.error, replayCancel.status, replayCancel.body.error, noId.status, noId.body.error, cid(r) === id2, lobby(r).startConfirm?.readyIds, events("mj_start_ready").length + events("mj_start_cancelled").length],
    [true, 409, "stale_confirm", 409, "stale_confirm", 400, "confirm_id_required", true, ["m0"], 0],
    "M5 取消後重新開始：第一輪的同意、取消重送都 409 stale_confirm，新一輪名單不變、不廣播；沒帶編號 400");
  let injected = false;
  lobbyHooks.beforeClaim = (roomId, l) => { // c 帶第二輪的編號同意，存檔那一刻另一台伺服器剛好取消又開了第三輪
    const sc = l.startConfirm as { readyIds?: string[] } | null | undefined;
    if (injected || roomId !== r.id || !sc?.readyIds?.includes("m2")) return;
    injected = true;
    const gs = rooms[r.id].game_state as unknown as Record<string, unknown>;
    gs.startConfirm = { id: "round-3", startedBy: "m0", seatIds: r.pids, readyIds: ["m0"], deadline: NOW + 10_000 };
    gs.stateVersion = ((gs.stateVersion as number) ?? 0) + 1;
  };
  const cross = await agreeWith(r, 2, id2);
  lobbyHooks.beforeClaim = undefined;
  eq([injected, cross.status, cross.body.error, cid(r), lobby(r).startConfirm?.readyIds], [true, 409, "stale_confirm", "round-3", ["m0"]],
    "M5 存檔衝突後重讀到新一輪：舊一輪的同意回 409 stale_confirm，沒加進新一輪");
}
// M6
for (const where of ["廣播期間房主取消又重新開始", "廣播期間有人退出"] as const) {
  const r = seated();
  await begin(r);
  await agree(r, 1); await agree(r, 2);
  sent.length = 0;
  let done = false;
  mjBroadcastHooks.after = async (ev, pl) => {
    if (done || ev !== "mj_start_ready" || pl.playerId !== "m3") return;
    done = true;
    if (where === "廣播期間有人退出") { await post(leave, { roomId: r.id }, "b"); return; }
    await cancelWith(r, cid(r));
    await begin(r);
  };
  NOW += 10_000; // v3：倒數結束後才取消得了（最後一家在倒數後按同意也照收）
  const last = await agree(r, 3);
  mjBroadcastHooks.after = undefined;
  const want = where === "廣播期間有人退出" ? [null] : [["m0"]];
  eq([done, last.body.started === true, rooms[r.id].status, lobby(r).startConfirm?.readyIds ?? null, events("mj_game_start").length, await charges(r.id)], [true, false, "waiting", ...want, 0, 0],
    `M6 最後一家同意後${where}：舊請求不開局、不扣卡、沒有 mj_game_start`);
}
// M7
for (const [label, offset, wantStart] of [["deadline 前 1 毫秒", -1, true], ["剛好 deadline", 0, true], ["deadline 後 30 秒", 30_000, true]] as const) {
  const r = seated();
  const s = await begin(r);
  await agree(r, 1); await agree(r, 2);
  const id = cid(r);
  NOW = (s.body.confirm?.deadline ?? NOW) + offset;
  const last = await agreeWith(r, 3, id);
  eq([rooms[r.id].status === "playing", last.status, await charges(r.id)], [wantStart, wantStart ? 200 : 409, wantStart ? 4 : 0], `M7 ${label}受理最後一家同意：${wantStart ? "開局、扣卡" : "不開局（409）、不扣卡"}`);
}
{
  const r = seated();
  const s = await begin(r);
  await agree(r, 1); await agree(r, 2);
  NOW = (s.body.confirm?.deadline ?? NOW) - 1;
  lobbyHooks.beforeClaim = () => { NOW = (s.body.confirm?.deadline ?? NOW) + 50; }; // 受理之後、存檔時已經過了截止時間
  const last = await agree(r, 3);
  lobbyHooks.beforeClaim = undefined;
  eq([last.body.started, rooms[r.id].status], [true, "playing"], "M7 截止前受理、處理途中跨過截止：照受理時刻算，開局");
}
// M8
{
  const r = seated(["a", "b", "c", "e"]);
  await setSuspended("boss", U.e, true, opId());
  const s = await begin(r);
  await setSuspended("boss", U.e, false, opId());
  const r2 = seated(["a", "b", "c", "e"]);
  await begin(r2);
  await agree(r2, 1); await agree(r2, 2);
  await setSuspended("boss", U.e, true, opId());
  sent.length = 0;
  const last = await agree(r2, 3);
  await setSuspended("boss", U.e, false, opId());
  const st = await state(r2.id, "a", "m0");
  eq([s.status, s.body.error, lobby(r).startConfirm ?? null, last.status, last.body.error, rooms[r2.id].status, st.body.lastStartConfirm?.reason, events("mj_game_start").length, await charges(r2.id)],
    [403, "player_suspended", null, 403, "player_suspended", "waiting", "suspended", 0, 0],
    "M8 有人被暫停：房主按開始 403、不進確認；確認期間才被暫停 → 最後一家同意 403、這次作廢（原因 suspended）、不發牌不扣卡");
}
// M9
{
  const r = seated();
  await begin(r);
  const wrong = await agreeWith(r, 2, cid(r), "b"); // b 冒充 c
  eq([wrong.status, lobby(r).startConfirm?.readyIds], [403, ["m0"]], "M9 不能替別人按同意（403），名單不變");
}

// M10（v3b）
for (let round = 0; round < 4; round++) {
  const r = seated();
  await begin(r);
  for (const i of [1, 2]) await agree(r, i);
  NOW += 2_000;
  sent.length = 0;
  const id = cid(r);
  const reqs = [() => agreeWith(r, 3, id), () => cancelWith(r, id, "b", "m1")];
  const out = await Promise.all((round % 2 ? [...reqs].reverse() : reqs).map((f) => f()));  // 單雙輪換誰先送
  const [ag, cn] = round % 2 ? [out[1], out[0]] : out;
  const started = rooms[r.id].status === "playing";
  eq([started ? [events("mj_game_start").length, await charges(r.id), cn.body.cancelled === true] : [rooms[r.id].status, events("mj_game_start").length, await charges(r.id), ag.body.started === true],
    ag.status < 500 && cn.status < 500],
    [started ? [1, 4, false] : ["waiting", 0, 0, false], true],
    `M10 第 ${round + 1} 次：倒數中取消和最後一家同意同時送出 → ${started ? "開局（只開一次、每人扣 1 張、取消沒生效）" : "取消（回等人、不發牌、0 張、同意沒開局）"}，沒有 5xx`);
}

// M11（v3c 補測：小測標準２）
{
  const r = seated();                                          // e 沒入座
  await begin(r);
  await agree(r, 1);
  NOW += 3_000;
  const snap = () => { const c = lobby(r).startConfirm; return c ? JSON.stringify([c.id, c.readyIds, c.deadline]) : null; };
  const before = snap();
  sent.length = 0;
  const own = await cancelWith(r, cid(r), "e", "m9");          // 填自己（不存在的座位）
  const fake = await cancelWith(r, cid(r), "e", "m2");         // 填別人的座位
  const st = await state(r.id, "a", "m0");
  eq([own.status, fake.status, before !== null, snap() === before, st.body.startConfirm?.readyIds, events("mj_start_cancelled").length, rooms[r.id].status, await charges(r.id)],
    [403, 403, true, true, ["m0", "m1"], 0, "waiting", 0],
    "M11 沒入座的帳號送取消（填自己、填別人的座位）都 403；確認還在、編號／同意名單／截止時間都不變、沒有取消廣播、不扣卡");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
