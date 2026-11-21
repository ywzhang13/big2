// 十三支理牌時間：最少 15 秒、15 秒一階、最多 120 秒（老闆 2026-11-18：最少 15 秒，可以手打，也可以按＋，每按一次加 15 秒）
//   A1 15、30、45、60、75、90、105、120 秒都能開房，存進牌局設定
//   A2 0、10、14、20、121、135 秒（還有字串、小數、負數、沒帶）都擋下：400 bad_arrange_sec，附中文提示
//   A3 15 秒、120 秒的房間開局：理牌截止時間＝開局時間＋15 秒／＋120 秒（伺服器時間）
//   A4 既有的 30／45／60 秒照常（舊房間的設定不受影響）；db 層 insertRoom 也擋不合法的秒數
import { setupThirteenDb } from "../support/thirteen-pg";
import { tokens } from "../support/stub-auth";
import { POST as createRoute } from "../../app/api/thirteen/create/route";
import { POST as joinRoute } from "../../app/api/thirteen/join/route";
import { POST as startRoute } from "../support/thirteen-start-all"; // 開始＝房主發起＋其他三家同意（2026-11-20 起；確認本身見 flow-thirteen-start-confirm）
import { clock } from "../../lib/thirteen/flow";
import { insertRoom } from "../../lib/thirteen/db";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
const db = await setupThirteenDb();
const NOW = Date.parse("2026-11-18T12:00:00Z");
clock.now = () => NOW;
const PIDS = ["p0", "p1", "p2", "p3"];
PIDS.forEach((p, i) => { tokens[`tk-${p}`] = { id: `00000000-0000-4000-8000-0000000000e${i}`, displayName: null, pictureUrl: null, isGuest: false }; });
async function post(fn: (r: Request) => Promise<Response>, body: object, as: string) {
  const r = await fn(new Request("http://x", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer tk-${as}` }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
}
const create = (arrangeSec: unknown) => post(createRoute, { hostId: "p0", arrangeSec, totalHands: 8 }, "p0");
const savedSec = async (roomId: string) => (await db.query<{ s: number }>(`select (game_state->'settings'->>'arrangeSec')::int s from th_rooms where id = $1`, [roomId])).rows[0]?.s;
const MSG = "理牌時間要是 15～120 秒，每 15 秒一階（15、30、45、60、75、90、105、120）";

// A1
{
  const ok = [15, 30, 45, 60, 75, 90, 105, 120];
  const got = [];
  for (const s of ok) { const r = await create(s); got.push([r.status, r.status === 200 ? await savedSec(r.body.roomId) : r.body.error]); }
  eq(got, ok.map((s) => [200, s]), "A1 15、30、45、60、75、90、105、120 秒都能開房，秒數存進牌局設定");
}
// A2
{
  const bad: unknown[] = [0, 10, 14, 20, 121, 135, "30", 15.5, -15, null];
  const got = [];
  for (const s of bad) { const r = await create(s); got.push([r.status, r.body.error, r.body.message]); }
  const noField = await post(createRoute, { hostId: "p0", totalHands: 8 }, "p0");
  eq([...got, [noField.status, noField.body.error, noField.body.message]], [...bad, "沒帶"].map(() => [400, "bad_arrange_sec", MSG]),
    "A2 0、10、14、20、121、135 秒、字串 \"30\"、15.5、-15、null、沒帶：都是 400 bad_arrange_sec，附中文提示");
}
// A3
{
  const dl = [];
  for (const s of [15, 120]) {
    const c = await create(s);
    for (const [i, p] of PIDS.entries()) await post(joinRoute, { code: c.body.code, playerId: p, name: `玩家${i}` }, p);
    const st = await post(startRoute, { roomId: c.body.roomId, playerId: "p0" }, "p0");
    dl.push([st.status, st.body.arrangeDeadline - NOW]);
  }
  eq(dl, [[200, 15_000], [200, 120_000]], "A3 15 秒、120 秒的房間開局：理牌截止時間＝開局時間＋15 秒／＋120 秒");
}
// A4
{
  const c = await create(45);
  for (const [i, p] of PIDS.entries()) await post(joinRoute, { code: c.body.code, playerId: p, name: `玩家${i}` }, p);
  const st = await post(startRoute, { roomId: c.body.roomId, playerId: "p0" }, "p0");
  let dbErr = "";
  try { await insertRoom({ code: "8888", host_id: "p0", host_user_id: tokens["tk-p0"].id, settings: { arrangeSec: 20 as 15, totalHands: 2 } }); } catch (e) { dbErr = (e as Error).message; }
  eq([st.status, st.body.arrangeDeadline - NOW, dbErr], [200, 45_000, MSG], "A4 原本的 45 秒照常開局（截止＋45 秒）；db 層 insertRoom 也擋 20 秒，訊息相同");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
