// 20261114_mahjong_idle_vote.sql（審伯 2026-11-13 必修 2：解散和聊天／互動記錄的原子保護），記憶體 PostgreSQL 跑真的 migration
//   1 活動先：被當成閒置的人先聊天（或丟互動）→ mj_leave_dissolve 回 activity，房間還在、沒寫紀錄
//   2 解散先：mj_leave_dissolve 寫紀錄＋刪房 → 之後的聊天、互動被擋下（不寫冷卻紀錄）
//   3 牌局版本變了：changed，什麼都沒改；房間不在：not_found
//   4 鎖：聊天、互動記錄會共享鎖住房間那一列（解散用排他鎖，兩者互斥）
//   5 原本的冷卻規則不變；rollback 把兩個函式換回原本的定義、刪掉 mj_leave_dissolve
// 註：PGlite 只有一條連線，沒辦法真的同時跑兩個交易；這裡用「兩種先後順序」＋「確認兩邊都拿房間列的鎖」來證明，
//     兩邊搶同一列（共享鎖 vs 排他鎖）是 PostgreSQL 保證互斥的，交錯時一定是其中一種先後順序。
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SUPABASE_SETUP } from "./support/pg-mj";

const SUPA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../supabase");
const sql = (f: string) => readFileSync(path.join(SUPA, f), "utf8");
const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`}`);
}
const d = new PGlite();
await d.exec(SUPABASE_SETUP);
for (const f of ["schema.sql", "mahjong-schema.sql", "migrations/20261016_match_records.sql", "migrations/20261017_mahjong_login.sql",
  "migrations/20261021_mahjong_effects.sql", "migrations/20261022_mahjong_prefs.sql", "migrations/20261023_mahjong_chat.sql"]) await d.exec(sql(f));
const fnDef = async (sig: string) => (await d.query<{ def: string }>(`select pg_get_functiondef('${sig}'::regprocedure) def`)).rows[0].def;
const CHAT = "public.mj_chat_take(text, text, text, int, int, int, int, boolean, timestamptz)";
const FX = "public.mj_effect_take(text, text, text, text, int, int, timestamptz)";
const before = [await fnDef(CHAT), await fnDef(FX)];
await d.exec(sql("migrations/20261114_mahjong_idle_vote.sql"));

let n = 0;
async function newRoom(): Promise<string> {
  n++;
  const r = await d.query<{ id: string }>("insert into mj_rooms (code, status, game_state) values ($1, 'playing', $2) returning id::text", [String(9000 + n), { stateVersion: 5, players: [] }]);
  return r.rows[0].id;
}
const REC = { room_code: "9001", started_at: "2026-11-13T10:00:00Z", end_reason: "dissolved", total_rounds: 1, base_points: 100, fan_points: 20, settings: {}, hands_played: 2,
  players: [0, 1, 2, 3].map((seat) => ({ seat, player_name: "P" + seat, player_id: "p" + seat, user_id: null, total_score: [120, -40, -60, -20][seat] })) };
const cutoff = "2026-11-13T12:00:00Z", after = "2026-11-13T12:00:30Z";
const chatTake = (room: string, user: string, at: string) => d.query<{ w: number }>("select mj_chat_take($1, $2, 'text', 2000, 5, 15000, 15000, true, $3) w", [room, user, at]).then((r) => r.rows[0].w);
const fxTake = (room: string, user: string, at: string) => d.query<{ r: { ok: boolean; reason?: string } }>("select mj_effect_take($1, $2, 'u:target', 'light', 5000, 0, $3) r", [room, user, at]).then((r) => r.rows[0].r);
const dissolve = (room: string, ver = 5) => d.query<{ r: string }>("select mj_leave_dissolve($1::uuid, $2, $3, $4, $5) r", [room, REC, ver, ["u:p3"], cutoff]).then((r) => r.rows[0].r);
const exists = async (room: string) => (await d.query("select 1 from mj_rooms where id::text = $1", [room])).rows.length === 1;
const recs = async (room: string) => (await d.query<{ n: number }>("select count(*)::int n from match_records where room_id::text = $1", [room])).rows[0].n;
const rateRows = async (room: string) => (await d.query<{ n: number }>("select (select count(*) from mj_chat_rate where room_id = $1) + (select count(*) from mj_effect_rate where room_id = $1) n", [room])).rows[0].n;

// 1 活動先
{
  const R1 = await newRoom(), R2 = await newRoom();
  const w = await chatTake(R1, "u:p3", after);
  const r1 = await dissolve(R1);
  const fx = await fxTake(R2, "u:p3", after);
  const r2 = await dissolve(R2);
  eq([w, r1, await exists(R1), await recs(R1), fx.ok, r2, await exists(R2), await recs(R2)], [0, "activity", true, 0, true, "activity", true, 0],
    "1 活動先：被當成閒置的玩家4 在判斷時間之後先聊天（或丟互動）→ 解散回 activity，房間還在、沒有寫紀錄");
  const old = await newRoom();
  await chatTake(old, "u:p3", "2026-11-13T11:50:00Z"); // 判斷時間之前的聊天：本來就算閒置
  eq([await dissolve(old), await exists(old), await recs(old)], ["closed", false, 1], "1 判斷時間之前的聊天不影響：照常解散（寫一筆紀錄、刪房）");
}

// 2 解散先
{
  const R = await newRoom();
  const r = await dissolve(R);
  const w = await chatTake(R, "u:p3", after);
  const fx = await fxTake(R, "u:p3", after);
  eq([r, await exists(R), await recs(R), w, fx, await rateRows(R)], ["closed", false, 1, 60000, { ok: false, reason: "cooldown", retry_after_ms: 60000 }, 0],
    "2 解散先：寫紀錄＋刪房在同一個交易；之後晚到的聊天、互動都被擋下（回 60 秒冷卻），冷卻紀錄一筆都沒寫");
}

// 3 版本、房間不在
{
  const R = await newRoom();
  eq([await dissolve(R, 4), await exists(R), await recs(R), await dissolve("00000000-0000-4000-8000-000000000999")], ["changed", true, 0, "not_found"],
    "3 牌局版本變了（有人剛動作）：changed，房間和紀錄都沒動；房間不在：not_found");
}

// 4 鎖
{
  const R = await newRoom();
  await d.exec("begin");
  await chatTake(R, "u:p1", after);
  const chatLock = (await d.query<{ n: number }>("select count(*)::int n from pg_locks where relation = 'mj_rooms'::regclass and mode = 'RowShareLock' and pid = pg_backend_pid()")).rows[0].n;
  await d.exec("rollback; begin");
  await fxTake(R, "u:p1", after);
  const fxLock = (await d.query<{ n: number }>("select count(*)::int n from pg_locks where relation = 'mj_rooms'::regclass and mode = 'RowShareLock' and pid = pg_backend_pid()")).rows[0].n;
  await d.exec("rollback");
  const body = (await d.query<{ src: string }>("select prosrc src from pg_proc where proname = 'mj_leave_dissolve'")).rows[0].src;
  eq([chatLock > 0, fxLock > 0, /for update/.test(body)], [true, true, true],
    "4 聊天、互動記錄時鎖住房間那一列（FOR SHARE）；解散用 FOR UPDATE 鎖同一列 → 兩者互斥，交錯時一定是「活動先」或「解散先」其中一種");
}

// 5 原本的冷卻規則不變、權限、rollback
{
  const R = await newRoom();
  const a = await chatTake(R, "u:p1", "2026-11-13T13:00:00Z");
  const b = await chatTake(R, "u:p1", "2026-11-13T13:00:01Z");
  eq([a, b], [0, 1000], "5 房間在的時候，聊天冷卻照舊（1 秒後再送要等 1000 毫秒）");
  let denied = 0;
  for (const role of ["anon", "authenticated"]) {
    try { await d.exec(`set role ${role}; select mj_leave_dissolve('${R}'::uuid, null, 5, '{}', now()); reset role;`); } catch { denied++; }
    await d.exec("reset role");
  }
  eq(denied, 2, "5 公開金鑰（anon、authenticated）不能呼叫 mj_leave_dissolve");
  await d.exec(sql("migrations/20261114_mahjong_idle_vote_rollback.sql"));
  const back = [await fnDef(CHAT), await fnDef(FX)];
  const gone = (await d.query<{ f: boolean }>("select to_regprocedure('public.mj_leave_dissolve(uuid, jsonb, int, text[], timestamptz)') is null f")).rows[0].f;
  const marks = (await d.query<{ c: string }>(`select obj_description('${CHAT}'::regprocedure, 'pg_proc') c`)).rows[0].c;
  eq([back[0] === before[0], back[1] === before[1], gone, marks], [true, true, true, "mj_chat:20261023"],
    "5 rollback：mj_chat_take、mj_effect_take 換回和原本一模一樣的定義（含原本的標記註解），mj_leave_dissolve 刪掉");
}

for (const r of results) console.log(r);
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
