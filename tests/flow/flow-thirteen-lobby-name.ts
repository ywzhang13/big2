// 十三支入座的名字（老柯 2026-11-19，配合共用開房流程；小宜設計說明 v1.1 第 4-3 節）。路由、db 層、SQL 都是真的（PGlite 跑真 migration）。
//   N1 名字去掉前後空白後 1～8 個字（用 Array.from 算，表情符號算 1 個字）：8 個字可以、9 個字 400；
//      只有一般空白、全形空白也是 400；8 個表情符號可以、9 個 400；前後空白去掉後存
//   N2 等人階段同一個人重新加入、換了名字：回 rejoined、座位不變；同桌讀狀態看到新名字；有發 th_player_joined（帶新名字）；牌局版本 +1
//      名字沒換就重新加入：什麼都不改、不發事件
//   N3 已經開打後重新加入：名字不變（牌局狀態、座位表都不變），還是認回原座位
//   N4 migration 回滾後回到 20261118 的行為（等人階段重新加入不改名）；再套一次又會改名
import { setupThirteenDb } from "../support/thirteen-pg";
import { tokens } from "../support/stub-auth";
import { sent } from "../support/stub-broadcast";
import { POST as createRoute } from "../../app/api/thirteen/create/route";
import { POST as joinRoute } from "../../app/api/thirteen/join/route";
import { POST as startRoute } from "../../app/api/thirteen/start/route";
import { GET as stateRoute } from "../../app/api/thirteen/state/route";
import { clock } from "../../lib/thirteen/flow";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
const db = await setupThirteenDb();
clock.now = () => Date.parse("2026-11-19T12:00:00Z");
const PIDS = ["p0", "p1", "p2", "p3", "p4"];
PIDS.forEach((p, i) => { tokens[`tk-${p}`] = { id: `00000000-0000-4000-8000-0000000000e${i}`, displayName: null, pictureUrl: null, isGuest: false }; });
async function post(fn: (r: Request) => Promise<Response>, body: object, as: string) {
  const r = await fn(new Request("http://x", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer tk-${as}` }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
}
async function state(roomId: string, as: string) {
  const r = await stateRoute(new Request(`http://x/?roomId=${roomId}&playerId=${as}`, { headers: { authorization: `Bearer tk-${as}` } }));
  return { status: r.status, body: await r.json() };
}
const create = async () => (await post(createRoute, { hostId: "p0", arrangeSec: 30, totalHands: 8 }, "p0")).body as { roomId: string; code: string };
const join = (code: string, p: string, name: string) => post(joinRoute, { code, playerId: p, name }, p);
const names = async (roomId: string) => (await db.query<{ seat: number; name: string }>(`select seat, name from th_players where room_id = $1 order by seat`, [roomId])).rows.map((r) => r.name);
const ver = async (roomId: string) => Number((await db.query<{ v: string }>(`select game_state->>'stateVersion' v from th_rooms where id = $1`, [roomId])).rows[0].v);

// N1
{
  const c = await create();
  const cases: [string, string, unknown][] = [
    ["p0", "一二三四五六七八", 200], ["p1", "一二三四五六七八九", 400], ["p1", "    ", 400], ["p1", "　　 　", 400],
    ["p1", "😀😀😀😀😀😀😀😀", 200], ["p2", "😀😀😀😀😀😀😀😀😀", 400], ["p2", "  　阿瑋  ", 200],
  ];
  const got = [];
  for (const [p, name] of cases) { const r = await join(c.code, p, name); got.push([name, r.status, r.status === 400 ? r.body.error : "ok"]); }
  eq([got, await names(c.roomId)],
    [cases.map(([, name, st]) => [name, st, st === 400 ? "bad_name" : "ok"]), ["一二三四五六七八", "😀😀😀😀😀😀😀😀", "阿瑋"]],
    "N1 8 個字可以、9 個字 400；只有空白（含全形）400；8 個表情符號可以、9 個 400；前後空白去掉後存");
}

// N2
{
  const c = await create();
  await join(c.code, "p0", "房主");
  await join(c.code, "p1", "老王");
  const v0 = await ver(c.roomId);
  sent.length = 0;
  const r = await join(c.code, "p1", "小王");
  const seen = (await state(c.roomId, "p0")).body.seats?.map((s: { name: string }) => s.name);
  const ev = sent.filter((e) => e.event === "th_player_joined").map((e) => { const rest = { ...(e.payload as Record<string, unknown>) }; delete rest.sv; return rest; }); // sv 是 send 統一加的牌局版本
  const v1 = await ver(c.roomId);
  sent.length = 0;
  const same = await join(c.code, "p1", "小王");
  eq([r.status, r.body.rejoined, r.body.seat, seen, ev, v1 - v0, same.body.rejoined, sent.length, await ver(c.roomId) - v1],
    [200, true, 1, ["房主", "小王"], [{ seat: 1, name: "小王", renamed: true }], 1, true, 0, 0],
    "N2 等人階段重新加入改名：認回原座位、同桌讀狀態看到新名字、發 th_player_joined（帶新名字）、版本 +1；名字沒換就什麼都不改");
}

// N3
{
  const c = await create();
  for (const [i, p] of PIDS.slice(0, 4).entries()) await join(c.code, p, `玩家${i}`);
  await post(startRoute, { roomId: c.roomId, playerId: "p0" }, "p0");
  const v0 = await ver(c.roomId);
  sent.length = 0;
  const r = await join(c.code, "p2", "改名了");
  const game = (await state(c.roomId, "p2")).body.players?.map((p: { name: string }) => p.name);
  eq([r.status, r.body.rejoined, r.body.seat, await names(c.roomId), game, sent.length, await ver(c.roomId) - v0],
    [200, true, 2, ["玩家0", "玩家1", "玩家2", "玩家3"], ["玩家0", "玩家1", "玩家2", "玩家3"], 0, 0],
    "N3 開打後重新加入：認回原座位，名字不變（座位表、牌局狀態都不變），不發事件、版本不變");
}

// N4
{
  const MIG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations");
  const tag = async () => (await db.query<{ t: string }>(`select obj_description(oid,'pg_proc') t from pg_proc where proname = 'th_lobby_join'`)).rows[0].t;
  await db.exec(readFileSync(path.join(MIG, "20261119_thirteen_lobby_rename_rollback.sql"), "utf8"));
  const c = await create();
  await join(c.code, "p0", "房主"); await join(c.code, "p1", "甲");
  await join(c.code, "p1", "乙");
  const rolled = [await tag(), (await names(c.roomId))[1]];
  await db.exec(readFileSync(path.join(MIG, "20261119_thirteen_lobby_rename.sql"), "utf8"));
  await join(c.code, "p1", "丙");
  eq([rolled, [await tag(), (await names(c.roomId))[1]]], [["th_lobby:20261118", "甲"], ["th_lobby:20261119", "丙"]],
    "N4 回滾後回到 20261118（重新加入不改名）；再套一次又會改名");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
