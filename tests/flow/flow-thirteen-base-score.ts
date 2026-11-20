// 十三支底分（老闆 2026-11-19）：路由、db 層、SQL 都是真的（PGlite 跑真 migration）。
//   F1 開房 baseScore 30、50、100、200 和自訂 10、100000 都能開，存進牌局設定；沒帶＝100
//   F2 9、100001、12.5、字串 "100"、null、0、-100 都 400 bad_base_score，附中文提示
//   F7 大頭照：等人畫面的 seats 和開局後的 players 每家都帶 avatarUrl（LINE 頭像網址；沒有＝null）
//   F3 等人畫面（state 的 waiting 回應）帶 baseScore
//   F4 開 baseScore=200 的房打完 8 局：每局亮牌 scores＝墩數 × 200；打完關房後 410 回應的總分、對局紀錄、
//      「我的十三支紀錄」都是乘過 200 的累計，紀錄帶 baseScore 200；重新整理（再讀一次）結果一樣
//   F5 舊房（上線前開的，設定裡沒有 baseScore）：等人畫面回 baseScore 1，分數＝墩數（和改之前一樣），紀錄記 baseScore 1
//   F6 migration 20261119 可以退回：跑 rollback 後 th_my_matches 換回 20261118（不回 baseScore、分數照舊）、權限不變、資料筆數不變；
//      再套一次 20261119 又回來
import { setupThirteenDb, setTotalHands } from "../support/thirteen-pg";
import { tokens } from "../support/stub-auth";
import { POST as createRoute } from "../../app/api/thirteen/create/route";
import { POST as joinRoute } from "../../app/api/thirteen/join/route";
import { POST as startRoute } from "../../app/api/thirteen/start/route";
import { GET as stateRoute } from "../../app/api/thirteen/state/route";
import { POST as submitRoute } from "../../app/api/thirteen/submit/route";
import { POST as nextRoute } from "../../app/api/thirteen/next-game/route";
import { GET as recordsRoute } from "../../app/api/thirteen/records/route";
import { clock } from "../../lib/thirteen/flow";
import { autoArrange } from "../../lib/thirteen/arrange";
import type { Card } from "../../lib/thirteen/cards";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
const db = await setupThirteenDb();
const NOW = Date.parse("2026-11-19T12:00:00Z");
clock.now = () => NOW;
const PIDS = ["p0", "p1", "p2", "p3"];
const PIC = (i: number) => (i < 2 ? `https://profile.line-scdn.net/p${i}` : null); // p0、p1 有 LINE 頭像，p2、p3 沒有
PIDS.forEach((p, i) => { tokens[`tk-${p}`] = { id: `00000000-0000-4000-8000-0000000000d${i}`, displayName: null, pictureUrl: PIC(i), isGuest: false }; });
async function post(fn: (r: Request) => Promise<Response>, body: object, as: string) {
  const r = await fn(new Request("http://x", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer tk-${as}` }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
}
async function state(roomId: string, as: string, seat = true) {
  const r = await stateRoute(new Request(`http://x/?roomId=${roomId}${seat ? `&playerId=${as}` : ""}`, { headers: { authorization: `Bearer tk-${as}` } }));
  return { status: r.status, body: await r.json() };
}
const MSG = "底分要是 10～100000 的整數";
const create = (extra: object) => post(createRoute, { hostId: "p0", arrangeSec: 30, totalHands: 8, ...extra }, "p0");
const savedBase = async (id: string) => (await db.query<{ b: unknown }>(`select game_state->'settings'->'baseScore' b from th_rooms where id = $1`, [id])).rows[0]?.b;
async function seatAll(code: string) {
  for (const [i, p] of PIDS.entries()) await post(joinRoute, { code, playerId: p, name: `玩家${i}` }, p);
}
/** 打一局：四家用推薦排法送出；回傳這局的墩數和分數（最後一局亮牌就關房，從 410 回應的 finalHand 拿） */
async function playHand(roomId: string): Promise<{ totals: number[]; scores: number[] } | null> {
  for (const p of PIDS) {
    const v = (await state(roomId, p)).body;
    if (!v.me) return null;
    const a = autoArrange(v.me.hand as Card[], (v.scoreRule === "v4" || v.scoreRule === "v5") ? { lucky: v.luckyCard?.rank ?? null } : "legacy"); // 舊房照舊牌型排（v4 的排法在舊房可能倒水）
    await post(submitRoute, { roomId, playerId: p, front: a.front.map((c) => c.id), middle: a.middle.map((c) => c.id), back: a.back.map((c) => c.id) }, p);
  }
  const after = await state(roomId, "p0");
  const rv = after.status === 200 ? after.body.reveal : after.body.record?.finalHand;
  if (after.status === 200) for (const p of PIDS) await post(nextRoute, { roomId, playerId: p }, p);
  return rv ? { totals: rv.result.totals, scores: rv.scores } : null;
}

// F1
{
  const got = [];
  for (const b of [30, 50, 100, 200, 10, 100000]) { const r = await create({ baseScore: b }); got.push([r.status, await savedBase(r.body.roomId)]); }
  const none = await create({});
  got.push([none.status, await savedBase(none.body.roomId)]);
  eq(got, [[200, 30], [200, 50], [200, 100], [200, 200], [200, 10], [200, 100000], [200, 100]], "F1 底分 30、50、100、200、自訂 10、100000 都能開房並存進設定；沒帶＝100");
}
// F2
{
  const bad: unknown[] = [9, 100001, 12.5, "100", null, 0, -100];
  const got = [];
  for (const b of bad) { const r = await create({ baseScore: b }); got.push([r.status, r.body.error, r.body.message]); }
  eq(got, bad.map(() => [400, "bad_base_score", MSG]), `F2 其他底分值都 400 bad_base_score，附「${MSG}」`);
}
// F3、F4
{
  const c = await create({ baseScore: 200 });
  await seatAll(c.body.code);
  const w = await state(c.body.roomId, "p0");
  eq([w.body.status, w.body.baseScore, w.body.settings?.baseScore, w.body.settings?.scoreRule], ["waiting", 200, 200, "v5"],
    "F3 等人畫面帶 baseScore 200（settings 裡也有）；新開的房記 scoreRule v5（2026-11-20 打槍新規則；之前是 v4、jia）");
  await post(startRoute, { roomId: c.body.roomId, playerId: "p0" }, "p0");
  const inGame = await state(c.body.roomId, "p0");
  eq(inGame.body.baseScore, 200, "F4 開局後的牌局狀態帶 baseScore 200");
  const hands: { totals: number[]; scores: number[] }[] = [];
  for (let i = 0; i < 8; i++) { const h = await playHand(c.body.roomId); if (h) hands.push(h); }
  eq(hands.length, 8, "F4 打完 8 局");
  eq(hands.map((h) => h.scores), hands.map((h) => h.totals.map((x) => x * 200)), "F4 每局亮牌的 scores＝墩數 × 200");
  eq(hands.every((h) => (h.scores ?? [1]).reduce((a, b) => a + b, 0) === 0), true, "F4 每局四家分數總和 0");
  const expect = [0, 1, 2, 3].map((seat) => hands.reduce((n, h) => n + h.totals[seat] * 200, 0));
  const gone1 = await state(c.body.roomId, "p0");
  const gone2 = await state(c.body.roomId, "p0");
  const recTotals = (g: typeof gone1) => (g.body.record?.players ?? []).map((p: { totalScore: number }) => p.totalScore);
  eq([gone1.status, recTotals(gone1)], [410, expect], "F4 打完關房：410 回應的四家總分＝8 局（墩數 × 200）加總");
  eq(recTotals(gone2), recTotals(gone1), "F4 重新整理（再讀一次）總分一樣");
  const row = (await db.query<{ base: number; scores: number[] }>(
    `select (m.settings->>'baseScore')::int base, array_agg(p.total_score order by p.seat) scores
       from match_records m join match_record_players p on p.match_id = m.id where m.game = 'thirteen' and m.room_id = $1 group by m.id`, [c.body.roomId])).rows[0];
  eq([row?.base, row?.scores], [200, expect], "F4 對局紀錄（match_records）存 baseScore 200、四家總分是乘過 200 的值");
  const rr = await recordsRoute(new Request("http://x/?limit=5", { headers: { authorization: "Bearer tk-p1" } }));
  const items = (await rr.json()).items as { roomCode: string; baseScore: number; myScore: number; players: { totalScore: number }[] }[];
  const mine = items.find((x) => x.roomCode === c.body.code);
  eq([mine?.baseScore, mine?.myScore, mine?.players.map((p) => p.totalScore)], [200, expect[1], expect], "F4「我的十三支紀錄」帶 baseScore 200，我的分數和四家分數都是乘過 200 的值");
}
// F5：舊房（設定裡沒有 baseScore）
{
  const c = await create({});
  await db.query(`update th_rooms set game_state = (game_state #- '{settings,baseScore}') #- '{settings,scoreRule}' where id = $1`, [c.body.roomId]); // 上線前開的房：兩個欄位都沒有
  await setTotalHands(db, c.body.roomId, 1);
  await seatAll(c.body.code);
  const w = await state(c.body.roomId, "p0");
  eq([w.body.baseScore, w.body.settings?.scoreRule], [1, undefined], "F5 舊房的等人畫面回 baseScore 1，設定裡沒有 scoreRule（照舊規則）");
  await post(startRoute, { roomId: c.body.roomId, playerId: "p0" }, "p0");
  const h = await playHand(c.body.roomId);
  const gone = await state(c.body.roomId, "p0");
  const base = (await db.query<{ base: number }>(`select (settings->>'baseScore')::int base from match_records where game = 'thirteen' and room_id = $1`, [c.body.roomId])).rows[0]?.base;
  eq([h?.scores, gone.body.record?.players?.map((p: { totalScore: number }) => p.totalScore), base], [h?.totals, h?.totals, 1],
    "F5 舊房打一局：分數＝墩數（和改之前一樣），紀錄記 baseScore 1");
}

// F7：大頭照
{
  const c = await create({ baseScore: 30 });
  await seatAll(c.body.code);
  const w = await state(c.body.roomId, "p0");
  const want = PIDS.map((_, i) => PIC(i));
  eq(w.body.seats?.map((x: { avatarUrl?: string | null }) => x.avatarUrl), want, "F7 等人畫面 seats 每家都帶 avatarUrl（有頭像的給網址、沒有的給 null）");
  await post(startRoute, { roomId: c.body.roomId, playerId: "p0" }, "p0");
  const g = await state(c.body.roomId, "p2");
  const spec = await state(c.body.roomId, "p3", false);
  eq([g.body.players?.map((x: { avatarUrl?: string | null }) => x.avatarUrl), spec.body.players?.map((x: { avatarUrl?: string | null }) => x.avatarUrl)], [want, want],
    "F7 開局後牌局狀態的 players 每家都帶 avatarUrl（玩家畫面、不在桌上的畫面都一樣）");
}

// F6：rollback
{
  const SQL = (f: string) => readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations", f), "utf8");
  const snap = async () => {
    const fn = (await db.query<{ tag: string; anon: boolean; svc: boolean }>(`select obj_description(oid,'pg_proc') tag,
      has_function_privilege('anon', oid, 'execute') anon, has_function_privilege('service_role', oid, 'execute') svc from pg_proc where proname = 'th_my_matches'`)).rows[0];
    const n = (await db.query<{ m: number; p: number }>(`select (select count(*)::int from match_records) m, (select count(*)::int from match_record_players) p`)).rows[0];
    const item = (await db.query<{ j: { items: Record<string, unknown>[] } }>(`select th_my_matches('00000000-0000-4000-8000-0000000000d1', 1) j`)).rows[0].j.items[0];
    return { ...fn, ...n, hasBase: "baseScore" in item, myScore: item.myScore };
  };
  const before = await snap();
  await db.exec(SQL("20261119_thirteen_base_score_rollback.sql"));
  const rolled = await snap();
  await db.exec(SQL("20261119_thirteen_base_score.sql"));
  const again = await snap();
  eq([before.tag, before.hasBase, rolled.tag, rolled.hasBase, again.tag, again.hasBase], ["th_my_matches:20261119", true, "th_my_matches:20261118", false, "th_my_matches:20261119", true],
    "F6 rollback 後 th_my_matches 換回 20261118（不回 baseScore），再套一次又回來");
  eq([rolled.anon, rolled.svc, rolled.m, rolled.p, rolled.myScore], [false, true, before.m, before.p, before.myScore], "F6 rollback 後權限不變（anon 不能執行、service_role 可以）、紀錄筆數和分數不變");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
