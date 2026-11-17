// 加一色「每人 16 張、挑 13 張理牌、3 張不用」的 API（老闆 2026-11-18）。路由、db 層、SQL 都是真的（PGlite 跑真 migration）。
//   F1 開局：每人讀到自己 16 張（座位頻道的 th_deal_hand 也是 16 張）；伺服器只留 1 張沒發；任何人的畫面、公開頻道都沒有那 1 張
//   F2 送出：13 張全來自自己的 16 張 200；混入別家的牌、沒發出去的那張 400 not_your_card；送 16 張 400 bad_size
//   F3 亮牌：每家公開的三墩剛好 13 張；四家不用的 3 張、沒發的那 1 張都不在亮牌（狀態、th_reveal 廣播）和別家的畫面裡
//   F4 時間到代排：沒送出的人由系統從他的 16 張挑 13 張排好、不倒水；他不用的 3 張一樣不公開
//   F5 紀錄：整場打完寫進對局紀錄的最後一局（finalHand）、關房後回的 410 紀錄，都沒有任何人不用的 3 張和沒發的那張
//   F6 觀戰（小測 2026-11-18 補驗）：被同意的觀戰者直接讀觀戰畫面 /api/thirteen/spectate/view——
//      亮牌前 65 張一張都沒有；亮牌後只有四家三墩的 52 張，四家不用的 3 張和沒發的那張都沒有
import { setupThirteenDb, setTotalHands } from "../support/thirteen-pg";
import { tokens } from "../support/stub-auth";
import { sent } from "../support/stub-broadcast";
import { POST as createRoute } from "../../app/api/thirteen/create/route";
import { POST as joinRoute } from "../../app/api/thirteen/join/route";
import { POST as startRoute } from "../../app/api/thirteen/start/route";
import { GET as stateRoute } from "../../app/api/thirteen/state/route";
import { POST as submitRoute } from "../../app/api/thirteen/submit/route";
import { POST as tickRoute } from "../../app/api/thirteen/tick/route";
import { GET as spViewRoute } from "../../app/api/thirteen/spectate/view/route";
import { requestSpectate, respondSpectate } from "../support/stub-spectate-store";
import { clock } from "../../lib/thirteen/flow";
import { privateChannel, publicChannel } from "../../lib/thirteen/server";
import { autoArrange, checkArrangement } from "../../lib/thirteen/arrange";
import type { Card } from "../../lib/thirteen/cards";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
const db = await setupThirteenDb();
let NOW = Date.parse("2026-11-18T12:00:00Z");
clock.now = () => NOW;
const PIDS = ["p0", "p1", "p2", "p3"];
const uid = (i: number) => `00000000-0000-4000-8000-0000000000d${i}`;
PIDS.forEach((p, i) => { tokens[`tk-${p}`] = { id: uid(i), displayName: null, pictureUrl: null, isGuest: false }; });
const auth = (as?: string): Record<string, string> => (as ? { authorization: `Bearer tk-${as}` } : {});
async function post(fn: (r: Request) => Promise<Response>, body: object, as?: string) {
  const r = await fn(new Request("http://x", { method: "POST", headers: { "content-type": "application/json", ...auth(as) }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
}
async function state(roomId: string, as: string, playerId: string | null = as) {
  const r = await stateRoute(new Request(`http://x/?roomId=${roomId}${playerId ? `&playerId=${playerId}` : ""}`, { headers: auth(as) }));
  return { status: r.status, body: await r.json() };
}
const ids = (cs: Card[]) => cs.map((c) => c.id);
const leaks = (x: unknown, idList: string[]) => idList.filter((id) => JSON.stringify(x).includes(`"${id}"`));
async function newMatch(totalHands: number) {
  const c = await post(createRoute, { hostId: "p0", arrangeSec: 30, totalHands: [8, 16, 32].includes(totalHands) ? totalHands : 8 }, "p0");
  if (![8, 16, 32].includes(totalHands)) await setTotalHands(db, c.body.roomId, totalHands); // 開房只能選 8／16／32；測試要短局就照舊房的方式直接改設定
  for (const [i, p] of PIDS.entries()) await post(joinRoute, { code: c.body.code, playerId: p, name: `玩家${i}` }, p);
  sent.length = 0;
  await post(startRoute, { roomId: c.body.roomId, playerId: "p0" }, "p0");
  return { roomId: c.body.roomId as string, code: c.body.code as string };
}
const subOf = (a: { front: Card[]; middle: Card[]; back: Card[] }) => ({ front: ids(a.front), middle: ids(a.middle), back: ids(a.back) });
const safeAuto = (h: Card[]) => { try { return autoArrange(h); } catch { return autoArrange(h.slice(0, 13)); } }; // 修正前 autoArrange 只收 13 張

const m = await newMatch(1);
const hands: Card[][] = [];
for (const p of PIDS) hands.push((await state(m.roomId, p)).body.me.hand);
const restRow = (await db.query<{ r: Card[] }>(`select game_state->'rest' r from th_rooms where id = $1`, [m.roomId])).rows[0].r;
const restIds = ids(restRow);
// F1
{
  const deals = sent.filter((e) => e.event === "th_deal_hand");
  const pub = sent.filter((e) => e.channel === publicChannel(m.code));
  const all = [...hands.flat().map((c) => c.id), ...restIds];
  eq([hands.map((h) => h.length), restIds.length, new Set(all).size, deals.map((e) => [e.channel === privateChannel(m.roomId, m.code, e.payload.playerId as string, uid(PIDS.indexOf(e.payload.playerId as string))), (e.payload.hand as Card[]).length]),
    leaks(pub, restIds).length, leaks((await state(m.roomId, "p1")).body, restIds).length],
    [[16, 16, 16, 16], 1, 65, PIDS.map(() => [true, 16]), 0, 0],
    "F1 開局：每人 16 張（只送到自己的座位頻道），伺服器留 1 張沒發；65 張不重複；那 1 張不在公開頻道、也不在玩家畫面");
}
// F2：p0、p1、p2 送出（p3 不送，等時間到代排）
const chosen: Card[][] = [];
{
  const bad1 = await post(submitRoute, { roomId: m.roomId, playerId: "p0", ...subOf(safeAuto([...hands[0].slice(0, 12), hands[1][0]])) }, "p0");
  const bad2 = await post(submitRoute, { roomId: m.roomId, playerId: "p0", ...subOf(safeAuto([...hands[0].slice(0, 12), ...restRow])) }, "p0");
  const bad3 = await post(submitRoute, { roomId: m.roomId, playerId: "p0", front: ids(hands[0].slice(0, 3)), middle: ids(hands[0].slice(3, 8)), back: ids(hands[0].slice(8, 16)) }, "p0");
  const oks = [];
  for (const i of [0, 1, 2]) {
    const a = safeAuto(hands[i]);
    chosen[i] = [...a.front, ...a.middle, ...a.back];
    oks.push((await post(submitRoute, { roomId: m.roomId, playerId: PIDS[i], ...subOf(a) }, PIDS[i])).status);
  }
  eq([bad1.status, bad1.body.error, bad2.status, bad2.body.error, bad3.status, bad3.body.error, oks],
    [400, "not_your_card", 400, "not_your_card", 400, "bad_size", [200, 200, 200]],
    "F2 送出：混入別家的牌、混入沒發出去的那張都 400 not_your_card；送 16 張 400 bad_size；挑自己 16 張裡的 13 張 200");
}
// F3、F4：時間到，p3 由系統代排，亮牌
NOW += 30_000;
sent.length = 0;
await post(tickRoute, { roomId: m.roomId, playerId: "p0" }, "p0");
const revealEv = sent.find((e) => e.event === "th_reveal");
const rv = revealEv?.payload as { arrangements: { front: Card[]; middle: Card[]; back: Card[] }[]; autoArranged: number[] } | undefined;
const unused = PIDS.map((_, i) => {
  const used = rv ? ids([...rv.arrangements[i].front, ...rv.arrangements[i].middle, ...rv.arrangements[i].back]) : [];
  return hands[i].map((c) => c.id).filter((id) => !used.includes(id));
});
const hidden = [...unused.flat(), ...restIds];
{
  const p0View = await state(m.roomId, "p0"); // 整場 1 局：亮牌後就關房，回 410 附紀錄
  const sizes = rv ? rv.arrangements.map((a) => a.front.length + a.middle.length + a.back.length) : [];
  eq([!!rv, sizes, unused.map((u) => u.length), leaks(rv, hidden).length, leaks(sent, hidden).length, leaks(p0View.body, [...unused.slice(1).flat(), ...restIds]).length],
    [true, [13, 13, 13, 13], [3, 3, 3, 3], 0, 0, 0],
    "F3 亮牌：每家公開剛好 13 張；四家不用的 3 張和沒發的那張，都不在 th_reveal、任何廣播、別家的畫面裡");
  const auto3 = rv ? rv.arrangements[3] : null;
  eq([rv?.autoArranged, auto3 ? checkArrangement(auto3).ok : null, auto3 ? [...auto3.front, ...auto3.middle, ...auto3.back].every((c) => hands[3].some((h) => h.id === c.id)) : null],
    [[3], true, true], "F4 時間到：p3 由系統從他的 16 張挑 13 張代排，不倒水，牌都是他自己的");
}
// F5：紀錄
{
  const rec = (await db.query<{ s: unknown }>(`select settings s from match_records where room_id = $1`, [m.roomId])).rows[0]?.s;
  const gone = await state(m.roomId, "p1");
  eq([!!rec, leaks(rec, hidden).length, gone.status, leaks(gone.body, hidden).length, !!(rec as { finalHand?: unknown } | undefined)?.finalHand],
    [true, 0, 410, 0, true], "F5 紀錄：寫進對局紀錄的最後一局、關房後回的 410 紀錄，都沒有任何人不用的 3 張和沒發的那張");
}

// F6：觀戰畫面（兩局的場，亮牌後房間還在）
{
  tokens["tk-watch"] = { id: "00000000-0000-4000-8000-0000000000f9", displayName: "觀戰員", pictureUrl: null, isGuest: false };
  const w = await newMatch(2);
  const hs: Card[][] = [];
  for (const p of PIDS) hs.push((await state(w.roomId, p)).body.me.hand);
  const wRest = ids((await db.query<{ r: Card[] }>(`select game_state->'rest' r from th_rooms where id = $1`, [w.roomId])).rows[0].r);
  const rq = await requestSpectate(w.roomId, tokens["tk-watch"].id, "p1", "觀戰員", null);
  if (rq.ok) await respondSpectate(w.roomId, "p1", rq.requestId, true);
  const view = async () => { const r = await spViewRoute(new Request(`http://x/?roomId=${w.roomId}&target=p1`, { headers: { authorization: "Bearer tk-watch" } })); return { status: r.status, body: await r.json() }; };
  const all65 = [...hs.flat().map((c) => c.id), ...wRest];
  const before = await view();
  // p0、p1 先送出（三墩在伺服器），再讓時間到：p2、p3 代排、亮牌
  for (const i of [0, 1]) await post(submitRoute, { roomId: w.roomId, playerId: PIDS[i], ...subOf(safeAuto(hs[i])) }, PIDS[i]);
  const mid = await view();
  NOW += 30_000;
  await post(tickRoute, { roomId: w.roomId, playerId: "p0" }, "p0");
  const after = await view();
  const arrs = (after.body.reveal?.arrangements ?? []) as { front: Card[]; middle: Card[]; back: Card[] }[];
  const usedBy = arrs.map((a) => ids([...a.front, ...a.middle, ...a.back]));
  const unusedW = hs.map((h, i) => ids(h).filter((id) => !(usedBy[i] ?? []).includes(id)));
  eq([rq.ok, before.status, leaks(before.body, all65).length, mid.status, leaks(mid.body, all65).length,
    after.status, after.body.phase, usedBy.map((u) => u.length), unusedW.map((u) => u.length), leaks(after.body, [...unusedW.flat(), ...wRest]).length, after.body.me],
    [true, 200, 0, 200, 0, 200, "revealed", [13, 13, 13, 13], [3, 3, 3, 3], 0, null],
    "F6 被同意的觀戰者讀 /api/thirteen/spectate/view：亮牌前（含兩家已送出時）65 張一張都沒有；亮牌後只有四家三墩各 13 張，四家不用的 3 張、沒發的那張都沒有");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
