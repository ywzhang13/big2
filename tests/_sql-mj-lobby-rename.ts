// mj_lobby_rename（20261120_mj_lobby_rename.sql）：PGlite 跑真的 SQL（老柯 2026-11-20，審伯複核麻將共用開房 R1）
//   L1 等人時改名：座位名字換新、等人階段版本 +1（沒有 game_state 的房從 1 開始）；同名再呼叫回 same、版本不動
//   L2 改名之後，開局拿「改名前的版本」做條件寫入 → 寫不進去（0 筆），開局要重讀才看得到新名字
//   L3 已經開局（不是 waiting）→ 回 started，座位名字不改、版本不動；不在這間房 not_seated、房間不在 not_found
//   L4 只有伺服器（service_role）能呼叫，anon、一般登入不行
//   L5 migration 套用、重套、回滾、回滾後再套都可以，房間和座位資料保留
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MIGRATIONS, SUPABASE_SETUP } from "./support/pg-mj";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
const up = readFileSync(path.join(MIGRATIONS, "20261120_mj_lobby_rename.sql"), "utf8");
const down = readFileSync(path.join(MIGRATIONS, "20261120_mj_lobby_rename_rollback.sql"), "utf8");
const db = new PGlite();
await db.exec(SUPABASE_SETUP);
await db.exec(readFileSync(path.join(MIGRATIONS, "../mahjong-schema.sql"), "utf8"));
await db.exec(up);
const room = async (gs: object | null, status = "waiting") => {
  const id = (await db.query<{ id: string }>(`insert into mj_rooms (code, status, host_id, game_state) values (lpad((floor(random()*9999))::text, 4, '0'), $1, 'm0', $2) returning id`, [status, gs ? JSON.stringify(gs) : null])).rows[0].id;
  await db.query(`insert into mj_players (room_id, player_id, name, seat) values ($1, 'm0', '阿華', 0), ($1, 'm1', '阿明', 1)`, [id]);
  return id;
};
const rename = async (id: string, pid: string, name: string) => (await db.query<{ r: { result: string; game_state?: { stateVersion: number } } }>(`select public.mj_lobby_rename($1, $2, $3) r`, [id, pid, name])).rows[0].r;
const nameOf = async (id: string, pid: string) => (await db.query<{ name: string }>(`select name from mj_players where room_id = $1 and player_id = $2`, [id, pid])).rows[0]?.name;
const ver = async (id: string) => (await db.query<{ v: string | null }>(`select game_state->>'stateVersion' v from mj_rooms where id = $1`, [id])).rows[0].v;

// L1
{
  const a = await room({ roomSettings: { totalRounds: 1 }, stateVersion: 3 });
  const r1 = await rename(a, "m1", "明仔");
  const r2 = await rename(a, "m1", "明仔");
  const b = await room(null);
  const r3 = await rename(b, "m1", "明仔");
  eq([r1.result, r1.game_state?.stateVersion, await nameOf(a, "m1"), r2.result, await ver(a), r3.result, await ver(b)], ["renamed", 4, "明仔", "same", "4", "renamed", "1"],
    "L1 等人時改名：名字換新、版本 +1（沒有 game_state 的房從 1 開始）；同名再呼叫 same、版本不動");
}
// L2
{
  const a = await room({ stateVersion: 7 });
  await rename(a, "m1", "明仔");
  const startWithOld = await db.query(`update mj_rooms set status = 'playing', game_state = '{"stateVersion":8,"players":[]}' where id = $1 and game_state->>'stateVersion' = '7' returning id`, [a]);
  const startWithNew = await db.query(`update mj_rooms set status = 'playing', game_state = '{"stateVersion":9,"players":[]}' where id = $1 and game_state->>'stateVersion' = '8' returning id`, [a]);
  eq([startWithOld.rows.length, startWithNew.rows.length], [0, 1], "L2 改名後，開局拿改名前的版本寫不進去（要重讀，看到新名字）；用新版本才寫得進去");
}
// L3
{
  const a = await room({ stateVersion: 2, players: [] }, "playing");
  const r = await rename(a, "m1", "明仔");
  eq([r.result, await nameOf(a, "m1"), await ver(a), (await rename(a, "nobody", "x")).result, (await rename("00000000-0000-4000-8000-000000000000", "m1", "x")).result],
    ["started", "阿明", "2", "started", "not_found"], "L3 已經開局回 started，名字和版本都不動；房間不在 not_found");
  const w = await room({ stateVersion: 1 });
  eq((await rename(w, "nobody", "x")).result, "not_seated", "L3 等人中但不在這間房 not_seated");
}
// L4
{
  const a = await room({ stateVersion: 1 });
  const tryAs = async (role: string) => { try { await db.exec(`set role ${role}`); await db.query(`select public.mj_lobby_rename($1, 'm1', '偷改')`, [a]); return "ok"; } catch { return "擋下"; } finally { await db.exec("reset role"); } };
  eq([await tryAs("anon"), await tryAs("authenticated"), await tryAs("service_role"), await nameOf(a, "m1")], ["擋下", "擋下", "ok", "偷改"], "L4 只有 service_role 能呼叫");
}
// L5
{
  const count = async () => (await db.query<{ r: number; p: number }>(`select (select count(*)::int from mj_rooms) r, (select count(*)::int from mj_players) p`)).rows[0];
  const before = await count();
  const has = async () => (await db.query<{ f: string | null }>(`select to_regprocedure('public.mj_lobby_rename(uuid,text,text)')::text f`)).rows[0].f !== null;
  await db.exec(up); const again = await has();
  await db.exec(down); const gone = !(await has());
  await db.exec(up); const back = await has();
  eq([again, gone, back, JSON.stringify(await count()) === JSON.stringify(before)], [true, true, true, true], "L5 migration 重套、回滾、再套都可以，房間和座位筆數不變");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
