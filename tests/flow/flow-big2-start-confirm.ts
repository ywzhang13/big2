// 大老二開局確認（老柯 2026-11-20，老闆定案，規則同十三支：房主按開始倒數 10 秒、四家都同意才發牌、沒按完不開局、房主要重新按開始）。
// 沿用大老二原本的「準備確認」API（ready-check 發起、ready 同意），補上倒數、版本檢查（同時按不漏人）、取消、失敗原因。
//   B1 房主按開始（ready-check）：不發牌；房主自己算同意、倒數 10 秒；狀態帶確認；三家依序同意 → 第四家同意才發牌、只開一次
//   B1 舊的「開始遊戲」（/api/game/deal）也不再直接發牌，改成發起確認
//   B2（v3 2026-11-26）10 秒到還有人沒按：不作廢、繼續等（狀態維持 ready_check、沒有取消廣播）；最後一人在倒數後按同意 → 發牌
//   B3 倒數後有人取消對戰 → 房主重新按開始：重新倒數 10 秒、失敗紀錄清掉；這次四家都同意 → 發牌
//   B4（v3b 2026-11-27）倒數中（剩 6 秒）非房主取消對戰 → 回到等人、不發牌、原因 timeout＋誰沒按；之後同意 409；房主倒數中也能取消
//   B15（v3c 補測）取消和最後一家同意同時送出，用掛鉤固定誰先寫入：取消先 → 回等人、不發牌；同意先 → 只開一次、每人只發一次牌、取消回 cancelled:false
//      （大老二本來就不扣房卡：lib/roomCard/rules.ts 寫明、大老二路由沒有呼叫扣卡，所以以「只開一次、只發一次牌」證明不重複開局）
//   B14（v3b）倒數中取消和最後一家同意同時送出：要嘛發牌（只發一次），要嘛取消（回等人、不發牌），不會開出半局
//   B5 三家同時按同意：都記到、只發一次牌
//   B6 不是房主不能發起；不在房裡不能同意；倒數中再按開始不重新計時；重複按只記一次
//   B7 確認期間有人退出：作廢、回到等人，失敗原因 seats_changed
import { POST as join } from "../../app/api/game/join/route";
import { GET as state } from "../../app/api/game/state/route";
import { POST as leave } from "../../app/api/game/leave/route";
import { POST as readyCheck } from "../../app/api/game/ready-check/route";
import { POST as ready } from "../../app/api/game/ready/route";
import { POST as deal } from "../../app/api/game/deal/route";
import { sent } from "../support/stub-broadcast";
import * as rs from "../support/stub-records-store";
import { extra } from "../support/stub-big2-leave-store";
import { confirmHooks } from "../support/stub-big2-start-confirm-store";
import { big2BroadcastHooks } from "../support/stub-broadcast";
import { dealHooks } from "../support/stub-big2-deal-store";

// 取消是新的路由：修改前沒有這支，其他項目照樣跑（才看得出修改前哪些是紅的）
const cancelMod = await import("../../app/api/game/ready-cancel/route").catch(() => null) as { POST: (r: Request) => Promise<Response> } | null;

import { big2ConfirmNote } from "../../hooks/big2StartConfirmView";
const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
let NOW = Date.parse("2026-11-20T08:00:00Z");
Date.now = () => NOW; // 大老二的時間一律看伺服器的 Date.now

type Res = { status: number; body: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
const post = (fn: (r: Request) => Promise<Response>, url: string, body: unknown): Promise<Res> =>
  fn(new Request(`http://x${url}`, { method: "POST", body: JSON.stringify(body) })).then(async (r) => ({ status: r.status, body: await r.json() }));
const getState = async (roomId: string, playerId: string): Promise<Res> => {
  const url = `http://x/api/game/state?roomId=${roomId}&playerId=${playerId}`;
  const r = await state(Object.assign(new Request(url), { nextUrl: new URL(url) }) as unknown as Parameters<typeof state>[0]);
  return { status: r.status, body: await r.json() };
};
/** 入座時伺服器只回給本人的入座憑證（依玩家 id 記著；發起、取消要帶房主本人的，審伯 R4） */
const seatKeys: Record<string, string | undefined> = {};
const startWith = (roomId: string, p: string, seatKey: string | undefined) => post(readyCheck, "/api/game/ready-check", { roomId, playerId: p, seatKey });
const start = (roomId: string, p: string) => startWith(roomId, p, seatKeys[p]);
/** 這間房目前這一輪確認的編號（前端從開始的回應、廣播或狀態拿到；審伯 R1） */
const cid = (roomId: string) => (extra[roomId]?.start_confirm as { id?: string } | null | undefined)?.id;
const agreeWith = (roomId: string, p: string, confirmId: string | undefined) => post(ready, "/api/game/ready", { roomId, playerId: p, confirmId });
const agree = (roomId: string, p: string) => agreeWith(roomId, p, cid(roomId));
const cancelWith = (roomId: string, p: string, body: Record<string, unknown>): Promise<Res> =>
  cancelMod ? post(cancelMod.POST, "/api/game/ready-cancel", { roomId, playerId: p, ...body }) : Promise.resolve({ status: 404, body: { error: "no_route" } });
const cancel = (roomId: string, p: string) => cancelWith(roomId, p, { confirmId: cid(roomId), seatKey: seatKeys[p] });
const events = (name: string) => sent.filter((e) => e.event === name);
/** 某一家在等人畫面看到的提示（照伺服器狀態、跟畫面同一個函式；v3c） */
const noteOf = async (r: { id: string; ps: string[] }, p: string) => {
  const b = (await getState(r.id, p)).body;
  return big2ConfirmNote(b.lastStartConfirm, !!b.startConfirm, b.players, p, p === r.ps[0]);
};
const status = (id: string) => rs.big2Rooms[id].room.status;

let n = 0;
async function seated(): Promise<{ id: string; code: string; ps: string[] }> {
  const id = "SC" + ++n, code = String(7100 + n);
  const ps = ["a", "b", "c", "d"].map((x) => `${x}${n}`);
  rs.big2Rooms[id] = { room: { id, code, status: "waiting", created_at: "2026-11-20T08:00:00Z", records_enabled: true, scores: null, updated_at: "2026-11-20T08:00:00Z", row_version: 1 }, players: [] };
  extra[id] = { host_id: ps[0], ready_players: [] };
  for (const p of ps) seatKeys[p] = (await post(join, "/api/game/join", { code, playerId: p, name: "N" + p })).body.seatKey;
  return { id, code, ps };
}

// B1
{
  const r = await seated();
  sent.length = 0;
  const s = await start(r.id, r.ps[0]);
  const st = await getState(r.id, r.ps[1]);
  const dealtEarly = events("game_start").length > 0 ? "已發牌" : "沒發牌";
  const a1 = await agree(r.id, r.ps[1]);
  const a2 = await agree(r.id, r.ps[2]);
  const mid = status(r.id);
  const a3 = await agree(r.id, r.ps[3]);
  eq([s.status, s.body.confirm?.deadline - NOW, s.body.confirm?.readyIds, st.body.status, st.body.startConfirm?.readyIds, st.body.startConfirm?.deadline - NOW, dealtEarly],
    [200, 10_000, [r.ps[0]], "ready_check", [r.ps[0]], 10_000, "沒發牌"],
    "B1 房主按開始：不發牌；房主自己算同意、倒數 10 秒；狀態（別人看）帶確認：誰已同意、截止時間");
  eq([a1.body.allReady, a2.body.allReady, mid, a3.status, a3.body.allReady, status(r.id), events("game_start").length, events("deal_hand").length],
    [false, false, "ready_check", 200, true, "playing", 1, 4], "B1 三家依序同意：前兩家還在等，第四家同意才發牌（只開一次、每人一份手牌）");
  const r2 = await seated();
  sent.length = 0;
  const d = await post(deal, "/api/game/deal", { roomId: r2.id, playerId: r2.ps[0], seatKey: seatKeys[r2.ps[0]] });
  eq([d.status, status(r2.id), events("game_start").length, d.body.confirm?.deadline - NOW], [200, "ready_check", 0, 10_000],
    "B1 舊的「開始遊戲」（/api/game/deal）也不直接發牌，改成發起確認（倒數 10 秒）");
}
// B2、B3（v3）
{
  const r = await seated();
  await start(r.id, r.ps[0]);
  await agree(r.id, r.ps[1]);
  await agree(r.id, r.ps[2]); // d 沒按
  NOW += 10_000;
  sent.length = 0;
  const after = await getState(r.id, r.ps[1]);
  NOW += 30_000;
  const after2 = await getState(r.id, r.ps[2]);
  const mid = [status(r.id), events("ready_check_cancelled").length, events("game_start").length];
  const last = await agree(r.id, r.ps[3]);
  eq([after.body.status, after.body.startConfirm?.readyIds?.length, after2.body.status, after2.body.lastStartConfirm ?? null, mid, last.status, last.body.allReady, status(r.id), events("game_start").length],
    ["ready_check", 3, "ready_check", null, ["ready_check", 0, 0], 200, true, "playing", 1],
    "B2 10 秒到還有人沒按：不作廢、繼續等（40 秒後還在、沒有取消廣播）；最後一人在倒數後按同意 → 發牌");
  const r2 = await seated();
  await start(r2.id, r2.ps[0]);
  await agree(r2.id, r2.ps[1]);
  NOW += 10_000;
  await cancel(r2.id, r2.ps[2]);
  const again = await start(r2.id, r2.ps[0]);
  const fresh = await getState(r2.id, r2.ps[2]);
  for (const i of [1, 2, 3]) await agree(r2.id, r2.ps[i]);
  eq([again.body.confirm?.deadline - NOW, again.body.confirm?.readyIds, fresh.body.lastStartConfirm, status(r2.id)], [10_000, [r2.ps[0]], null, "playing"],
    "B3 倒數後有人取消對戰、房主重新按開始：重新倒數 10 秒、失敗紀錄清掉；這次四家都同意 → 發牌");
}
// B4（v3b）
{
  const r = await seated();
  await start(r.id, r.ps[0]);
  await agree(r.id, r.ps[1]);
  NOW += 4_000;                                     // 還剩 6 秒
  sent.length = 0;
  const c = await cancel(r.id, r.ps[1]);
  const st = await getState(r.id, r.ps[1]);
  const late = await agree(r.id, r.ps[2]);
  eq([c.status, c.body.cancelled, st.body.status, st.body.lastStartConfirm?.reason, st.body.lastStartConfirm?.missingIds,
    [events("ready_check_cancelled")[0]?.payload.reason, events("ready_check_cancelled")[0]?.payload.by], late.status, events("game_start").length],
    [200, true, "waiting", "cancelled", [r.ps[2], r.ps[3]], ["cancelled", r.ps[1]], 409, 0],
    "B4 倒數中（剩 6 秒）非房主取消對戰 → 回到等人、不發牌、原因 cancelled＋誰沒按；之後同意 409");
  const nb = `N${r.ps[1]} 取消了對戰`;
  eq([await noteOf(r, r.ps[0]), await noteOf(r, r.ps[2]), await noteOf(r, r.ps[3]), await noteOf(r, r.ps[1])], [nb, nb, nb, "你 取消了對戰"],
    "B4 提示（v3c）：倒數中取消，其他三家看到「N（按的人）取消了對戰」，按的人看到「你 取消了對戰」");
  await start(r.id, r.ps[0]);
  NOW += 1_000;
  const hc = await cancel(r.id, r.ps[0]);
  eq([hc.status, hc.body.cancelled, status(r.id), events("game_start").length], [200, true, "waiting", 0], "B4 房主倒數中也能取消對戰");
  const na = `N${r.ps[0]} 取消了對戰`;
  eq([await noteOf(r, r.ps[1]), await noteOf(r, r.ps[2]), await noteOf(r, r.ps[3])], [na, na, na], "B4 提示（v3c）：房主取消，其他三家看到「N（房主）取消了對戰」");
}
// B4b（v3c）倒數結束後非房主取消對戰：提示
{
  const r = await seated();
  await start(r.id, r.ps[0]);
  await agree(r.id, r.ps[1]);
  NOW += 15_000;                                    // 倒數已結束 5 秒
  const c = await cancel(r.id, r.ps[3]);
  const nd = `N${r.ps[3]} 取消了對戰`;
  eq([c.status, c.body.cancelled, await noteOf(r, r.ps[0]), await noteOf(r, r.ps[1]), await noteOf(r, r.ps[2]), await noteOf(r, r.ps[3]), events("game_start").length],
    [200, true, nd, nd, nd, "你 取消了對戰", 0], "B4b 倒數結束後非房主取消對戰：其他三家看到「N（按的人）取消了對戰」、按的人看到「你 取消了對戰」、不發牌（v3c）");
}
// B5
{
  const r = await seated();
  await start(r.id, r.ps[0]);
  sent.length = 0;
  const id5 = cid(r.id);
  const all = await Promise.all([1, 2, 3].map((i) => agreeWith(r.id, r.ps[i], id5)));
  eq([all.map((x) => x.status), all.filter((x) => x.body.allReady).length >= 1, status(r.id), events("game_start").length, events("deal_hand").length],
    [[200, 200, 200], true, "playing", 1, 4], "B5 三家同時按同意：都記到、發牌，而且只發一次");
}
// B6
{
  const r = await seated();
  const notHost = await start(r.id, r.ps[1]);
  const s1 = await start(r.id, r.ps[0]);
  NOW += 3_000;
  const s2 = await start(r.id, r.ps[0]);
  const stranger = await agree(r.id, "zz");
  await agree(r.id, r.ps[1]);
  const dup = await agree(r.id, r.ps[1]);
  eq([notHost.status, s2.body.confirm?.deadline === s1.body.confirm?.deadline, stranger.status, dup.status, dup.body.confirm?.readyIds, status(r.id)],
    [403, true, 403, 200, [r.ps[0], r.ps[1]], "ready_check"], "B6 不是房主不能發起；倒數中再按開始不重新計時；不在房裡不能同意；重複按只記一次");
}
// B7
{
  const r = await seated();
  await start(r.id, r.ps[0]);
  await agree(r.id, r.ps[1]);
  const lv = await post(leave, "/api/game/leave", { roomId: r.id, playerId: r.ps[3] });
  const st = await getState(r.id, r.ps[1]);
  const late = await agree(r.id, r.ps[2]);
  eq([lv.status, st.body.status, st.body.startConfirm, st.body.lastStartConfirm?.reason, late.status], [200, "waiting", null, "seats_changed", 409],
    "B7 確認期間有人退出：作廢、回到等人，失敗原因 seats_changed；之後同意 409");
  eq([await noteOf(r, r.ps[0]), await noteOf(r, r.ps[1])], ["有人離開了，這次開局取消", "有人離開了，這次開局取消"], "B7 提示不變（v3c）：有人退出 →「有人離開了，這次開局取消」");
}

// B8（審伯 R1）：舊一輪的同意、取消晚到或重送，不能動到新一輪；沒帶編號的不算；存檔衝突後重讀到新一輪也不能改綁
{
  const r = await seated();
  const s1 = await start(r.id, r.ps[0]);
  const id1 = s1.body.confirm?.id as string, tk1 = seatKeys[r.ps[0]];
  await agreeWith(r.id, r.ps[1], id1);
  NOW += 10_000; // v3：倒數結束後才能取消
  await cancelWith(r.id, r.ps[0], { confirmId: id1, seatKey: tk1 });
  const s2 = await start(r.id, r.ps[0]);
  const id2 = s2.body.confirm?.id as string;
  sent.length = 0;
  const replayAgree = await agreeWith(r.id, r.ps[1], id1);
  const replayCancel = await cancelWith(r.id, r.ps[0], { confirmId: id1, seatKey: tk1 });
  const noId = await agreeWith(r.id, r.ps[2], undefined);
  eq([typeof id1, id1 !== id2, replayAgree.status, replayAgree.body.error, replayCancel.status, noId.status, noId.body.error, cid(r.id) === id2, extra[r.id].ready_players, events("player_ready").length, events("ready_check_cancelled").length],
    ["string", true, 409, "stale_confirm", 409, 400, "confirm_id_required", true, [r.ps[0]], 0, 0],
    "B8 取消後重新開始：第一輪的同意、取消重送都 409（舊編號不能用在新一輪）；新一輪名單不變、不廣播；沒帶編號 400");
  // 存檔衝突：c 帶第二輪的編號同意，存檔那一刻另一台伺服器剛好取消又開了第三輪（版本 +1）→ 重讀後編號對不上，不能加進第三輪
  let injected = false;
  confirmHooks.beforeUpdate = (roomId, patch) => {
    if (injected || roomId !== r.id || !Array.isArray(patch.ready_players) || !(patch.ready_players as string[]).includes(r.ps[2])) return;
    injected = true;
    const b = rs.big2Rooms[r.id];
    extra[r.id].start_confirm = { id: "round-3", startedBy: r.ps[0], seatIds: r.ps, readyIds: [r.ps[0]], deadline: NOW + 10_000 };
    extra[r.id].ready_players = [r.ps[0]];
    b.room.row_version = (b.room.row_version ?? 0) + 1;
  };
  const cross = await agreeWith(r.id, r.ps[2], id2);
  confirmHooks.beforeUpdate = undefined;
  eq([injected, cross.status, cross.body.error, cid(r.id), extra[r.id].ready_players, status(r.id)], [true, 409, "stale_confirm", "round-3", [r.ps[0]], "ready_check"],
    "B8 存檔衝突後重讀到新一輪：舊一輪的同意回 409 stale_confirm，沒加進新一輪");
}
// B9（審伯 R2）：最後一家同意之後、發牌之前，房主取消又重新開始 → 舊請求不能拿新一輪（只有房主同意）去開局
for (const where of ["廣播期間", "發牌前", "有人退出"] as const) {
  const r = await seated();
  await start(r.id, r.ps[0]);
  await agree(r.id, r.ps[1]);
  await agree(r.id, r.ps[2]);
  sent.length = 0;
  let done = false;
  const interfere = async () => {
    if (done) return; done = true;
    if (where === "有人退出") { await post(leave, "/api/game/leave", { roomId: r.id, playerId: r.ps[3] }); return; }
    await cancel(r.id, r.ps[0]);
    await start(r.id, r.ps[0]); // 新一輪：只有房主同意
  };
  if (where === "廣播期間") big2BroadcastHooks.after = async (ev, pl) => { if (ev === "player_ready" && pl.playerId === r.ps[3]) await interfere(); };
  else dealHooks.beforeStart = async (id) => { if (id === r.id) await interfere(); };
  NOW += 10_000; // v3：倒數結束後才取消得了（最後一家在倒數後按同意也照收）
  const last = await agree(r.id, r.ps[3]);
  big2BroadcastHooks.after = undefined; dealHooks.beforeStart = undefined;
  const want = where === "有人退出" ? ["waiting", []] : ["ready_check", [r.ps[0]]];
  eq([done, last.body.allReady === true, status(r.id), extra[r.id].ready_players, events("game_start").length], [true, false, ...want, 0],
    `B9 最後一家同意後「${where}」${where === "有人退出" ? "有人退出" : "房主取消又重新開始"}：舊請求不開局（不是 allReady）、資料庫${where === "有人退出" ? "回到等人" : "新一輪只有房主同意"}、沒有 game_start`);
}
{
  const r = await seated();
  await start(r.id, r.ps[0]);
  for (const i of [1, 2, 3]) await agree(r.id, r.ps[i]);
  const id = cid(r.id);
  const replay = await agreeWith(r.id, r.ps[3], id);
  eq([status(r.id), events("game_start").length, replay.status], ["playing", 1, 409], "B9 正常四家同意只開一次；開局後重送最後一家的同意不會再開（409）");
}
// B10（審伯 R3；v3 改）：倒數結束後的同意也算——deadline 前 1 毫秒、剛好 deadline、之後受理最後一家同意都開局；處理途中跨過截止也開局
for (const [label, offset, wantStart] of [["deadline 前 1 毫秒", -1, true], ["剛好 deadline", 0, true], ["deadline 後 30 秒", 30_000, true]] as const) {
  const r = await seated();
  const s = await start(r.id, r.ps[0]);
  await agree(r.id, r.ps[1]); await agree(r.id, r.ps[2]);
  const id = cid(r.id);
  sent.length = 0;
  NOW = s.body.confirm.deadline + offset;
  const last = await agreeWith(r.id, r.ps[3], id);
  eq([status(r.id) === "playing", events("game_start").length, last.status], [wantStart, wantStart ? 1 : 0, wantStart ? 200 : 409], `B10 ${label}受理最後一家同意：${wantStart ? "開局" : "不開局（409）"}`);
}
{
  const r = await seated();
  const s = await start(r.id, r.ps[0]);
  await agree(r.id, r.ps[1]); await agree(r.id, r.ps[2]);
  sent.length = 0;
  NOW = s.body.confirm.deadline - 1;
  confirmHooks.beforeUpdate = () => { NOW = s.body.confirm.deadline + 50; }; // 受理之後查座位、存檔時已經過了截止時間
  const last = await agree(r.id, r.ps[3]);
  confirmHooks.beforeUpdate = undefined;
  eq([last.body.allReady, status(r.id), events("game_start").length], [true, "playing", 1], "B10 截止前受理、處理途中（查座位、存檔）跨過截止：照受理時刻算，開局");
}
// B11（審伯 R4；v3 改）：取消要按的那一家本人的入座憑證；沒有、錯的、別人的憑證都不行；倒數後非房主用自己的憑證可以
{
  const r = await seated();
  const s1 = await start(r.id, r.ps[0]);
  const id = s1.body.confirm?.id as string, hostKey = seatKeys[r.ps[0]];
  NOW = s1.body.confirm.deadline; // 倒數結束（取消要倒數後）
  const tries = [
    await cancelWith(r.id, r.ps[1], { confirmId: id }),                             // 一般玩家填自己、沒有憑證
    await cancelWith(r.id, r.ps[0], { confirmId: id }),                             // 任何人填房主 id、沒有憑證
    await cancelWith(r.id, r.ps[0], { confirmId: id, seatKey: "猜的" }),           // 錯的憑證
    await cancelWith(r.id, r.ps[0], { confirmId: id, seatKey: seatKeys[r.ps[1]] }), // 一般玩家用自己的憑證填房主 id
    await cancelWith(r.id, r.ps[1], { confirmId: id, seatKey: hostKey }),           // 房主的憑證配別人的 id
  ];
  const still = status(r.id);
  const ok = await cancelWith(r.id, r.ps[1], { confirmId: id, seatKey: seatKeys[r.ps[1]] });
  eq([typeof hostKey, tries.map((t) => t.status), still, ok.status, ok.body.cancelled, status(r.id)], ["string", [403, 403, 403, 403, 403], "ready_check", 200, true, "waiting"],
    "B11 沒有憑證、錯的憑證、別人的憑證、別人的 id 都不能取消（403）；倒數後非房主帶自己的入座憑證可以取消對戰");
}
// B12（審伯複審 R4）：發起也要房主本人的入座憑證；只填公開的房主 id 不能發起、拿不到任何憑證（新舊兩個入口都一樣）
{
  const r = await seated();
  sent.length = 0;
  const tries = [
    await startWith(r.id, r.ps[0], undefined),                                                 // 沒入座、沒有憑證，只填房主 id
    await startWith(r.id, r.ps[0], "猜的"),                                                     // 錯的憑證
    await startWith(r.id, r.ps[0], seatKeys[r.ps[1]]),                                          // 一般玩家用自己的憑證填房主 id
    await startWith(r.id, r.ps[1], seatKeys[r.ps[1]]),                                          // 一般玩家用自己的身分發起
    await post(deal, "/api/game/deal", { roomId: r.id, playerId: r.ps[0] }),                    // 舊入口，只填房主 id
    await post(deal, "/api/game/deal", { roomId: r.id, playerId: r.ps[0], seatKey: "猜的" }),  // 舊入口，錯的憑證
  ];
  const leaked = tries.some((t) => t.body.cancelToken !== undefined || t.body.seatKey !== undefined || t.body.confirm !== undefined);
  const before = [status(r.id), events("ready_check").length];
  const ok = await start(r.id, r.ps[0]);
  NOW = ok.body.confirm.deadline; // v3：倒數結束後才能取消
  const c = await cancel(r.id, r.ps[0]);
  eq([tries.map((t) => t.status), leaked, before, ok.status, ok.body.confirm?.readyIds, c.status, c.body.cancelled, status(r.id)],
    [[403, 403, 403, 403, 403, 403], false, ["waiting", 0], 200, [r.ps[0]], 200, true, "waiting"],
    "B12 只填公開房主 id、錯的憑證、別人的憑證、不是房主（新舊入口）發起都 403，拿不到任何憑證或確認、房間不動；真房主帶自己的憑證照常發起、取消");
}
// B13：房主退出換人當房主：新房主用自己入座時拿到的憑證就能發起
{
  const r = await seated();
  await post(leave, "/api/game/leave", { roomId: r.id, playerId: r.ps[0] });
  const newHost = extra[r.id].host_id as string;
  seatKeys["x" + r.id] = (await post(join, "/api/game/join", { code: r.code, playerId: "x" + r.id, name: "補位" })).body.seatKey;
  const old = await startWith(r.id, r.ps[0], seatKeys[r.ps[0]]);
  const ok = await start(r.id, newHost);
  eq([newHost, old.status, ok.status], [r.ps[1], 403, 200], "B13 房主退出、換人當房主：舊房主的憑證不能發起；新房主用自己入座時的憑證照常發起");
}

// B14（v3b）
for (let round = 0; round < 4; round++) {
  const r = await seated();
  await start(r.id, r.ps[0]);
  for (const i of [1, 2]) await agree(r.id, r.ps[i]);
  NOW += 2_000;
  sent.length = 0;
  const id = cid(r.id);
  const reqs = [() => agreeWith(r.id, r.ps[3], id), () => cancelWith(r.id, r.ps[1], { confirmId: id, seatKey: seatKeys[r.ps[1]] })];
  const out = await Promise.all((round % 2 ? [...reqs].reverse() : reqs).map((f) => f()));  // 單雙輪換誰先送
  const [ag, cn] = round % 2 ? [out[1], out[0]] : out;
  const started = status(r.id) === "playing";
  eq([started ? [events("game_start").length, events("deal_hand").length, cn.body.cancelled === true] : [status(r.id), events("game_start").length, events("deal_hand").length, ag.body.allReady === true],
    ag.status < 500 && cn.status < 500],
    [started ? [1, 4, false] : ["waiting", 0, 0, false], true],
    `B14 第 ${round + 1} 次：倒數中取消和最後一家同意同時送出 → ${started ? "發牌（只發一次、取消沒生效）" : "取消（回等人、不發牌、同意沒開局）"}，沒有 5xx`);
}

// B15（v3c 補測：小測標準４）
for (const first of ["cancel", "agree", "cancel", "agree"] as const) {
  const r = await seated();
  await start(r.id, r.ps[0]);
  for (const i of [1, 2]) await agree(r.id, r.ps[i]);
  NOW += 2_000;
  sent.length = 0;
  const id = cid(r.id);
  // 慢的那一邊在條件寫入前多等 30ms：另一邊一定先寫入（取消的寫入帶 last_start_confirm，同意的沒有）
  confirmHooks.beforeUpdate = async (roomId, patch) => {
    if (roomId !== r.id) return;
    const isCancel = !!patch.last_start_confirm;
    if ((first === "agree") === isCancel) await new Promise((res) => setTimeout(res, 30));
  };
  const [ag, cn] = await Promise.all([agreeWith(r.id, r.ps[3], id), cancelWith(r.id, r.ps[1], { confirmId: id, seatKey: seatKeys[r.ps[1]] })]);
  confirmHooks.beforeUpdate = undefined;
  const st = await getState(r.id, r.ps[0]);
  const dealtTo = events("deal_hand").map((e) => (e as { payload?: { playerId?: string } }).payload?.playerId ?? "?");
  if (first === "cancel") {
    eq([cn.status, cn.body.cancelled, ag.status < 500, ag.body.allReady === true, status(r.id), st.body.lastStartConfirm?.reason, events("game_start").length, events("deal_hand").length],
      [200, true, true, false, "waiting", "cancelled", 0, 0],
      "B15 取消先寫入：取消成功、同意沒開局（沒有 5xx）、回到等人、原因 cancelled、沒有開局也沒發牌（大老二不扣房卡）");
  } else {
    eq([ag.status, ag.body.allReady, cn.status < 500, cn.body.cancelled === true, status(r.id), events("game_start").length, events("deal_hand").length, new Set(dealtTo).size],
      [200, true, true, false, "playing", 1, 4, 4],
      "B15 同意先寫入：開局只一次（game_start 1）、四家各發一次牌（deal_hand 4、4 個不同的人）、取消沒生效（沒有 5xx）");
  }
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
