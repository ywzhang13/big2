// 十三支開局確認（老柯 2026-11-20，老闆定案：房主按開始倒數 10 秒、四家都同意才開局、沒按完就不開、房主要重新按開始），走真的路由；
// 十三支和房卡帳都是記憶體 PostgreSQL 跑真的 migration。
//   S1 房主按開始：不發牌、不扣卡；房主自己算同意，倒數 10 秒；等人畫面（state）帶確認狀態；四家都同意 → 開局、每人扣 1 張（房主也扣，老闆帳號才不扣）
//   S2 房主取消：回到等人、不發牌、不扣卡；之後再按同意 409 no_confirm；不是房主不能取消
//   S3 時間到還有人沒按：不開局（不是自動同意），讀狀態／tick 時作廢、廣播 th_start_cancelled timeout；晚到的同意 409；
//      房主重新按開始 → 新的 10 秒；這次四家都按 → 開局
//   S4 三家同時按同意：都有記到、只開一次局（第 1 局）、每人只扣 1 張
//   S5 暫停：有人被暫停時房主按開始 403 player_suspended（不進入確認）；確認期間才被暫停 → 最後一家同意時 403、這次確認作廢、不發牌不扣卡
//   S6 確認期間有人離開 → 這次確認作廢，等人畫面沒有確認狀態；別人再按同意 409
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
// S2
{
  const r = await seated(["a", "b", "c", "d"]);
  await post(startRoute, { roomId: r.roomId, playerId: r.pids[0] }, "a");
  await post(confirmRoute, { roomId: r.roomId, playerId: r.pids[1], confirmId: await cid(r.roomId) }, "b");
  const notHost = await post(cancelRoute, { roomId: r.roomId, playerId: r.pids[1], confirmId: await cid(r.roomId) }, "b");
  sent.length = 0;
  const cc = await post(cancelRoute, { roomId: r.roomId, playerId: r.pids[0], confirmId: await cid(r.roomId) }, "a");
  const late = await post(confirmRoute, { roomId: r.roomId, playerId: r.pids[2], confirmId: await cid(r.roomId) }, "c");
  const w = await state(r.roomId, "a", r.pids[0]);
  eq([notHost.status, notHost.body.error, cc.body.cancelled, events("th_start_cancelled").map((e) => e.payload.reason), late.status, late.body.error, w.body.status, w.body.startConfirm, await charges(r.roomId)],
    [403, "not_host", true, ["host"], 409, "no_confirm", "waiting", null, 0], "S2 房主取消：回到等人、廣播取消（host）、不扣卡；之後的同意 409 no_confirm；不是房主不能取消");
}
// S3
{
  const r = await seated(["a", "b", "c", "d"]);
  await post(startRoute, { roomId: r.roomId, playerId: r.pids[0] }, "a");
  await post(confirmRoute, { roomId: r.roomId, playerId: r.pids[1], confirmId: await cid(r.roomId) }, "b");
  await post(confirmRoute, { roomId: r.roomId, playerId: r.pids[2], confirmId: await cid(r.roomId) }, "c"); // d 沒按
  NOW += 9_999;
  const before = await state(r.roomId, "a", r.pids[0]);
  NOW += 1;
  sent.length = 0;
  const tick = await post(tickRoute, { roomId: r.roomId, playerId: r.pids[0] }, "a");
  const after = await state(r.roomId, "a", r.pids[0]);
  const late = await post(confirmRoute, { roomId: r.roomId, playerId: r.pids[3], confirmId: await cid(r.roomId) }, "d");
  eq([before.body.startConfirm?.readyIds.length, tick.body.startConfirm, events("th_start_cancelled").map((e) => e.payload.reason), after.body.status, after.body.startConfirm, late.status, (await status(r.roomId)).status, await charges(r.roomId)],
    [3, false, ["timeout"], "waiting", null, 409, "waiting", 0], "S3 10 秒到還有人沒按：不開局、作廢（timeout），回到等人；晚到的同意 409；沒扣卡");
  // 狀態裡看得到「上一次為什麼沒開成、誰沒按」（漏收廣播、重新整理的人也看得到）；廣播也帶沒按的人
  const seen = await state(r.roomId, "b", r.pids[1]);
  eq([seen.body.lastStartConfirm, events("th_start_cancelled")[0]?.payload.missingIds],
    [{ at: NOW, reason: "timeout", missingIds: [r.pids[3]] }, [r.pids[3]]], "S3 時間到作廢後：等人狀態 lastStartConfirm＝{ reason timeout、沒按的人、時間 }，th_start_cancelled 也帶 missingIds");
  const again = await post(startRoute, { roomId: r.roomId, playerId: r.pids[0] }, "a");
  const fresh = await state(r.roomId, "b", r.pids[1]);
  eq(fresh.body.lastStartConfirm, null, "S3 房主重新按開始後，上一次失敗的紀錄清掉（lastStartConfirm null）");
  for (const i of [1, 2, 3]) await post(confirmRoute, { roomId: r.roomId, playerId: r.pids[i], confirmId: await cid(r.roomId) }, r.keys[i]);
  eq([again.body.confirm?.deadline - NOW, again.body.confirm?.readyIds, (await status(r.roomId)).status, await charges(r.roomId)], [10_000, [r.pids[0]], "playing", 4],
    "S3 房主重新按開始：重新倒數 10 秒；這次四家都同意 → 開局、每人扣 1 張");
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

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
