// 十三支開房局數只能選 8、16、32（老闆 2026-11-18）。路由、db 層、SQL 都是真的（PGlite 跑真 migration）。
//   T1 8、16、32 局都能開房，局數存進牌局設定
//   T2 1、4、12、20、33、字串 "16"、16.5、0、-8、null、沒帶：都 400 bad_total_hands，附中文提示
//   T3 32 局完整打完：第 32 局亮牌後自動寫對局紀錄（completed、hands_played 32、整場累計 stats 每家五個欄位）並關房；
//      之後讀狀態回 410，紀錄的每家總分＝32 局分數加總
//   T4 舊房（開房時是 3 局）照原設定打完：第 3 局亮牌就結束（「已開的舊房照原設定打完」）
//   T5 32 局的房間閒置太久也照常清掉（記成中途解散，打了幾局就記幾局）
import { setupThirteenDb, setTotalHands } from "../support/thirteen-pg";
import { tokens } from "../support/stub-auth";
import { POST as createRoute } from "../../app/api/thirteen/create/route";
import { POST as joinRoute } from "../../app/api/thirteen/join/route";
import { POST as startRoute } from "../../app/api/thirteen/start/route";
import { GET as stateRoute } from "../../app/api/thirteen/state/route";
import { POST as submitRoute } from "../../app/api/thirteen/submit/route";
import { POST as nextRoute } from "../../app/api/thirteen/next-game/route";
import { clock } from "../../lib/thirteen/flow";
import { autoArrange } from "../../lib/thirteen/arrange";
import { closeIdleRoom } from "../../lib/thirteen/server";
import { listIdleThirteenRooms } from "../../lib/thirteen/db";
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
PIDS.forEach((p, i) => { tokens[`tk-${p}`] = { id: `00000000-0000-4000-8000-0000000000c${i}`, displayName: null, pictureUrl: null, isGuest: false }; });
async function post(fn: (r: Request) => Promise<Response>, body: object, as: string) {
  const r = await fn(new Request("http://x", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer tk-${as}` }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
}
async function state(roomId: string, as: string) {
  const r = await stateRoute(new Request(`http://x/?roomId=${roomId}&playerId=${as}`, { headers: { authorization: `Bearer tk-${as}` } }));
  return { status: r.status, body: await r.json() };
}
const MSG = "局數只能選 8、16 或 32 局";
const create = (totalHands: unknown) => post(createRoute, { hostId: "p0", arrangeSec: 30, totalHands }, "p0");
const savedHands = async (id: string) => (await db.query<{ n: number }>(`select (game_state->'settings'->>'totalHands')::int n from th_rooms where id = $1`, [id])).rows[0]?.n;
async function seatAndStart(c: { body: { roomId: string; code: string } }) {
  for (const [i, p] of PIDS.entries()) await post(joinRoute, { code: c.body.code, playerId: p, name: `玩家${i}` }, p);
  await post(startRoute, { roomId: c.body.roomId, playerId: "p0" }, "p0");
}
/** 打一局：四家用推薦排法送出、亮牌後四家都按確認（最後一局亮牌就關房） */
async function playHand(roomId: string): Promise<number[] | null> {
  for (const p of PIDS) {
    const v = (await state(roomId, p)).body;
    if (!v.me) return null;
    const a = autoArrange(v.me.hand as Card[]);
    await post(submitRoute, { roomId, playerId: p, front: a.front.map((c) => c.id), middle: a.middle.map((c) => c.id), back: a.back.map((c) => c.id) }, p);
  }
  const after = await state(roomId, "p0");
  // 最後一局亮牌就關房：分數從關房後 410 回應的紀錄（最後一局 finalHand）拿
  // 2026-11-19 起本局分數是 scores（墩數 × 底分；這裡開房沒帶底分＝100）
  const totals = after.status === 200 ? after.body.reveal?.scores ?? null : after.body.record?.finalHand?.scores ?? null;
  if (after.status === 200) for (const p of PIDS) await post(nextRoute, { roomId, playerId: p }, p);
  return totals;
}

// T1
{
  const got = [];
  for (const n of [8, 16, 32]) { const r = await create(n); got.push([r.status, r.status === 200 ? await savedHands(r.body.roomId) : r.body.error]); }
  eq(got, [[200, 8], [200, 16], [200, 32]], "T1 8、16、32 局都能開房，局數存進牌局設定");
}
// T2
{
  const bad: unknown[] = [1, 4, 12, 20, 33, "16", 16.5, 0, -8, null];
  const got = [];
  for (const n of bad) { const r = await create(n); got.push([r.status, r.body.error, r.body.message]); }
  const none = await post(createRoute, { hostId: "p0", arrangeSec: 30 }, "p0");
  eq([...got, [none.status, none.body.error, none.body.message]], [...bad, "沒帶"].map(() => [400, "bad_total_hands", MSG]),
    "T2 1、4、12、20、33、字串 \"16\"、16.5、0、-8、null、沒帶：都 400 bad_total_hands，附中文提示「局數只能選 8、16 或 32 局」");
}
// T3：32 局完整打完
{
  const c = await create(32);
  await seatAndStart(c);
  const sum = [0, 0, 0, 0];
  let played = 0;
  for (let i = 0; i < 32; i++) {
    const t = await playHand(c.body.roomId);
    if (!t) break;
    played++; t.forEach((x, s) => (sum[s] += x));
    NOW += 1000;
  }
  const rec = (await db.query<{ end_reason: string; hands_played: number; settings: { totalHands: number; stats: { guns: number; gunned: number; homeRuns: number; homeRunned: number; total: number }[] } }>(
    `select end_reason, hands_played, settings from match_records where room_id = $1`, [c.body.roomId])).rows[0];
  const players = (await db.query<{ total_score: number }>(`select p.total_score from match_record_players p join match_records r on r.id = p.match_id where r.room_id = $1 order by p.seat`, [c.body.roomId])).rows.map((r) => r.total_score);
  const gone = await state(c.body.roomId, "p0");
  eq([played, rec?.end_reason, rec?.hands_played, rec?.settings.totalHands, rec?.settings.stats?.length, rec?.settings.stats?.map((s) => s.total), players, gone.status],
    [32, "completed", 32, 32, 4, sum, sum, 410], "T3 32 局完整打完：第 32 局亮牌後寫對局紀錄（completed、32 局、四家整場累計）並關房；每家總分＝32 局分數加總；之後讀狀態 410");
}
// T4：舊房照原設定（3 局）打完
{
  const c = await create(8);
  await setTotalHands(db, c.body.roomId, 3); // 模擬改規則前開的 3 局舊房
  await seatAndStart(c);
  let played = 0;
  for (let i = 0; i < 8; i++) { const t = await playHand(c.body.roomId); if (!t) break; played++; NOW += 1000; if ((await state(c.body.roomId, "p0")).status === 410) break; }
  const rec = (await db.query<{ hands_played: number }>(`select hands_played from match_records where room_id = $1`, [c.body.roomId])).rows[0];
  eq([played, rec?.hands_played], [3, 3], "T4 改規則前開的 3 局舊房：照原設定打 3 局就結束、寫紀錄（3 局）");
}
// T5：32 局的房間閒置 13 小時也照常清
{
  const c = await create(32);
  await seatAndStart(c);
  await playHand(c.body.roomId); await playHand(c.body.roomId);
  await db.exec(`alter table th_rooms disable trigger trg_th_rooms_updated_at`);
  await db.query(`update th_rooms set updated_at = now() - interval '13 hours' where id = $1`, [c.body.roomId]);
  await db.exec(`alter table th_rooms enable trigger trg_th_rooms_updated_at`);
  const picked = (await listIdleThirteenRooms(new Date(Date.now() - 2 * 3600_000).toISOString(), new Date(Date.now() - 12 * 3600_000).toISOString(), 50)).find((r) => r.id === c.body.roomId);
  const res = picked ? await closeIdleRoom(picked) : "沒選到";
  const rec = (await db.query<{ end_reason: string; hands_played: number }>(`select end_reason, hands_played from match_records where room_id = $1`, [c.body.roomId])).rows[0];
  eq([res, rec?.end_reason, rec?.hands_played], ["closed", "dissolved", 2], "T5 32 局的房間打了 2 局後閒置 13 小時：閒置清除照常關房，記成中途解散、2 局");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
