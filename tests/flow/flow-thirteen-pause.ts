// 十三支「暫停開新局」開關（老柯 2026-11-20，第三批上線總審必修：退回 957329f 之前要先擋住新開 v4 房和開打，讓現有 v4 房照 v4 打完或安全解散）。
// 環境變數 THIRTEEN_PAUSE_NEW=1 時：
//   K1 開房一律 503 paused（不用登入就擋，退回時用 curl 就能確認開關生效），資料庫沒有新增房間
//   K2 已經開好、還在等人的房按「開始」也 503 paused，房間維持 waiting
//   K3 暫停前已經開打的 v4 房照常打：送出、亮牌、下一局都照 v4 規則（luckyCard、scoreRule v4）
//   K4 已經開打的房可以照常投票解散：寫中途解散紀錄（打完的局都在、分數照 v4），關房
//   K5 關掉開關（不是 "1"）就恢復開房
import { setupThirteenDb } from "../support/thirteen-pg";
import { tokens } from "../support/stub-auth";
import { POST as createRoute } from "../../app/api/thirteen/create/route";
import { POST as joinRoute } from "../../app/api/thirteen/join/route";
import { POST as startRoute } from "../../app/api/thirteen/start/route";
import { GET as stateRoute } from "../../app/api/thirteen/state/route";
import { POST as submitRoute } from "../../app/api/thirteen/submit/route";
import { POST as nextRoute } from "../../app/api/thirteen/next-game/route";
import { POST as leaveReqRoute } from "../../app/api/thirteen/leave-request/route";
import { POST as leaveVoteRoute } from "../../app/api/thirteen/leave-vote/route";
import { clock } from "../../lib/thirteen/flow";
import { autoArrange } from "../../lib/thirteen/arrange";
import type { Card } from "../../lib/thirteen/cards";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
const db = await setupThirteenDb();
const NOW = Date.parse("2026-11-20T12:00:00Z");
clock.now = () => NOW;
const PIDS = ["p0", "p1", "p2", "p3"];
PIDS.forEach((p, i) => { tokens[`tk-${p}`] = { id: `00000000-0000-4000-8000-0000000000e${i}`, displayName: null, pictureUrl: null, isGuest: false }; });
async function post(fn: (r: Request) => Promise<Response>, body: object, as: string | null) {
  const r = await fn(new Request("http://x", { method: "POST", headers: { "content-type": "application/json", ...(as ? { authorization: `Bearer tk-${as}` } : {}) }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
}
async function state(roomId: string, as: string) {
  const r = await stateRoute(new Request(`http://x/?roomId=${roomId}&playerId=${as}`, { headers: { authorization: `Bearer tk-${as}` } }));
  return { status: r.status, body: await r.json() };
}
const roomCount = async () => (await db.query<{ n: number }>(`select count(*)::int n from th_rooms`)).rows[0].n;
async function seated() {
  const c = (await post(createRoute, { hostId: "p0", arrangeSec: 30, totalHands: 8 }, "p0")).body as { roomId: string; code: string };
  for (const [i, p] of PIDS.entries()) await post(joinRoute, { code: c.code, playerId: p, name: `玩家${i}` }, p);
  return c;
}
async function playHand(roomId: string) {
  for (const p of PIDS) {
    const v = (await state(roomId, p)).body;
    const a = autoArrange(v.me.hand as Card[], { lucky: v.luckyCard?.rank ?? null });
    await post(submitRoute, { roomId, playerId: p, front: a.front.map((x) => x.id), middle: a.middle.map((x) => x.id), back: a.back.map((x) => x.id) }, p);
  }
  return (await state(roomId, "p0")).body;
}

// 暫停前：一間已經開打的 v4 房（playing）、一間坐滿還沒開始的房（waiting）
const playing = await seated();
await post(startRoute, { roomId: playing.roomId, playerId: "p0" }, "p0");
const waiting = await seated();
const before = await roomCount();

process.env.THIRTEEN_PAUSE_NEW = "1";
// K1
{
  const anon = await post(createRoute, { hostId: "p9", arrangeSec: 30, totalHands: 8 }, null);
  const user = await post(createRoute, { hostId: "p9", arrangeSec: 30, totalHands: 8 }, "p1");
  eq([anon.status, anon.body.error, user.status, user.body.error, typeof user.body.message, await roomCount()], [503, "paused", 503, "paused", "string", before],
    "K1 暫停中開房：沒登入、有登入都 503 paused（附中文提示），資料庫沒有新增房間");
}
// K2
{
  const r = await post(startRoute, { roomId: waiting.roomId, playerId: "p0" }, "p0");
  const v = (await state(waiting.roomId, "p0")).body;
  eq([r.status, r.body.error, v.status], [503, "paused", "waiting"], "K2 暫停中，已坐滿的房按開始也 503 paused，房間維持等人");
}
// K3
{
  const rv1 = await playHand(playing.roomId);
  for (const p of PIDS) await post(nextRoute, { roomId: playing.roomId, playerId: p }, p);
  const v2 = (await state(playing.roomId, "p0")).body;
  eq([rv1.phase, rv1.reveal?.scoreRule, !!rv1.reveal?.luckyCard, v2.phase, v2.handNo, v2.scoreRule, !!v2.luckyCard], ["revealed", "v4", true, "arranging", 2, "v4", true],
    "K3 暫停前開打的房照常打：第 1 局照 v4 亮牌（有彩金牌）、四家確認後開第 2 局，仍是 v4");
}
// K4
{
  const rv2 = await playHand(playing.roomId); // 第 2 局也打完，解散時要有 2 局
  const req = await post(leaveReqRoute, { roomId: playing.roomId, playerId: "p0" }, "p0");
  for (const p of PIDS.slice(1)) await post(leaveVoteRoute, { roomId: playing.roomId, playerId: p, approve: true }, p);
  const rec = (await db.query<{ end_reason: string; hands_played: number; rule: string; n: number }>(
    `select end_reason, hands_played, settings->'finalHand'->>'scoreRule' rule, (select count(*)::int from match_record_players p where p.match_id = r.id) n from match_records r where room_id = $1`, [playing.roomId])).rows[0];
  const players = (await db.query<{ total_score: number }>(`select p.total_score from match_record_players p join match_records r on r.id = p.match_id where r.room_id = $1 order by p.seat`, [playing.roomId])).rows.map((x) => x.total_score);
  const gone = (await db.query<{ n: number }>(`select count(*)::int n from th_rooms where id = $1`, [playing.roomId])).rows[0].n;
  eq([req.status, rec?.end_reason, rec?.hands_played, rec?.rule, rec?.n, players, gone], [200, "dissolved", 2, "v4", 4, rv2.playerScores, 0],
    "K4 暫停中照常投票解散：寫中途解散紀錄（打完的 2 局、scoreRule v4、四家總分＝亮牌時的累計），房間關掉");
}
// K5
{
  process.env.THIRTEEN_PAUSE_NEW = "0";
  const r = await post(createRoute, { hostId: "p9", arrangeSec: 30, totalHands: 8 }, "p1");
  delete process.env.THIRTEEN_PAUSE_NEW;
  const r2 = await post(createRoute, { hostId: "p8", arrangeSec: 30, totalHands: 8 }, "p2");
  eq([r.status, r2.status], [200, 200], "K5 開關不是 \"1\"（或沒設）就照常開房");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
