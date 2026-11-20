// 麻將開局確認（老柯 2026-11-20，老闆定案，規則同十三支、大老二）：房主按開始倒數 10 秒、四家都同意才發牌並扣房卡、沒按完不開局、
// 房主要重新按開始；房主可以取消；每一輪有確認編號；用受理時刻判斷逾時。走真的麻將路由，房卡帳是記憶體 PostgreSQL 跑真的 migration。
//   M1 房主按開始：不發牌、不扣卡；倒數 10 秒、房主自己算同意；等人狀態帶確認；三家依序同意 → 第四家同意才開局，每人扣 1 張
//   M2 10 秒到還有人沒按：不開局、不扣卡、回到等人；狀態看得到時間到、誰沒按；晚到的同意 409；房主重按 → 新一輪、重新倒數，四家同意才開
//   M3 房主取消：回到等人、不扣卡、原因 host；之後同意 409；不是房主（用自己的登入填房主 id）不能取消
//   M4 三家同時按同意：都記到、只開一局、每人只扣 1 張
//   M5 舊一輪的同意、取消重送不能動新一輪；沒帶編號 400；存檔衝突後重讀到新一輪也不能改綁
//   M6 最後一家同意之後、發牌之前（廣播期間）房主取消又重新開始 → 舊請求不能拿新一輪開局；有人退出 → 作廢
//   M7 受理時刻：deadline 前 1 毫秒照算、剛好 deadline 不算；處理途中跨過截止照受理時刻；作廢一直撞衝突 → 409、不開局
//   M8 暫停：房裡有人被暫停 → 房主按開始 403、不進確認；確認期間才被暫停 → 最後一家同意時 403、這次作廢、不發牌不扣卡
//   M9 不能替別人按同意（403）
import { tokens } from "../support/stub-auth";
import { lobbyHooks, rooms, seats } from "../support/stub-db";
import { mjBroadcastHooks, sent } from "../support/stub-broadcast";
import { addUser, db as cardDb, setSuspended } from "../support/stub-roomcard-store";
import { POST as start } from "../../app/api/mahjong/start/route";
import { GET as stateRoute } from "../../app/api/mahjong/state/route";
import { POST as leave } from "../../app/api/mahjong/leave/route";
import type { MahjongGameState } from "../../lib/mahjong/gameState";

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
const cancelWith = (r: R, confirmId: string | undefined, as = r.keys[0]) => post(cancelMod?.POST, { roomId: r.id, playerId: "m0", confirmId }, as);
const events = (name: string) => sent.filter((e) => e.event === name);
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
// M2
{
  const r = seated();
  await begin(r);
  await agree(r, 1); await agree(r, 2); // m3 沒按
  const id1 = cid(r);
  NOW += 10_000;
  sent.length = 0;
  const after = await state(r.id, "b", "m1");
  const late = await agreeWith(r, 3, id1);
  eq([after.body.status, after.body.startConfirm, after.body.lastStartConfirm, events("mj_start_cancelled").map((e) => e.payload), late.status, rooms[r.id].status, await charges(r.id)],
    ["waiting", null, { reason: "timeout", missingIds: ["m3"], at: NOW }, [{ reason: "timeout", missingIds: ["m3"] }], 409, "waiting", 0],
    "M2 10 秒到還有人沒按：不開局、不扣卡、回到等人；狀態看得到時間到、誰沒按；廣播 mj_start_cancelled；晚到的同意 409");
  const again = await begin(r);
  const fresh = await state(r.id, "c", "m2");
  for (const i of [1, 2, 3]) await agree(r, i);
  eq([again.body.confirm?.deadline - NOW, again.body.confirm?.id !== id1, fresh.body.lastStartConfirm, rooms[r.id].status, await charges(r.id)], [10_000, true, null, "playing", 4],
    "M2 房主重按：新一輪、重新倒數 10 秒、失敗紀錄清掉；這次四家同意 → 開局、每人扣 1 張");
}
// M3
{
  const r = seated();
  await begin(r);
  await agree(r, 1);
  sent.length = 0;
  const notHost = await cancelWith(r, cid(r), "b"); // b 用自己的登入填房主的 id
  const c = await cancelWith(r, cid(r));
  const st = await state(r.id, "b", "m1");
  const late = await agreeWith(r, 2, "whatever");
  eq([notHost.status, c.status, c.body.cancelled, st.body.status, st.body.lastStartConfirm?.reason, st.body.lastStartConfirm?.missingIds, late.status, events("mj_game_start").length, await charges(r.id)],
    [403, 200, true, "waiting", "host", ["m2", "m3"], 409, 0, 0], "M3 房主取消：回到等人、不扣卡、原因 host；之後同意 409；別人用自己的登入填房主 id 不能取消（403）");
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
  const last = await agree(r, 3);
  mjBroadcastHooks.after = undefined;
  const want = where === "廣播期間有人退出" ? [null] : [["m0"]];
  eq([done, last.body.started === true, rooms[r.id].status, lobby(r).startConfirm?.readyIds ?? null, events("mj_game_start").length, await charges(r.id)], [true, false, "waiting", ...want, 0, 0],
    `M6 最後一家同意後${where}：舊請求不開局、不扣卡、沒有 mj_game_start`);
}
// M7
for (const [label, offset, wantStart] of [["deadline 前 1 毫秒", -1, true], ["剛好 deadline", 0, false]] as const) {
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
{
  const r = seated();
  const s = await begin(r);
  await agree(r, 1); await agree(r, 2);
  NOW = (s.body.confirm?.deadline ?? NOW) + 1;
  let bumps = 0;
  lobbyHooks.beforeClaim = (roomId, l) => { // 每次「到期作廢」的寫入都被別人搶先
    if (roomId !== r.id || l.startConfirm !== null) return;
    bumps++;
    const gs = rooms[r.id].game_state as unknown as Record<string, unknown>;
    gs.stateVersion = ((gs.stateVersion as number) ?? 0) + 1;
  };
  const last = await agree(r, 3);
  lobbyHooks.beforeClaim = undefined;
  eq([bumps >= 5, last.status, rooms[r.id].status, await charges(r.id)], [true, 409, "waiting", 0], "M7 過了截止、作廢一直撞到衝突：回 409（可重試），不收逾時的同意、不開局、不扣卡");
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

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
