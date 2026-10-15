// 在記憶體 PostgreSQL（PGlite，不連任何資料庫）直接讀取並執行專案裡的 20261017 四份 SQL：
//   S0 正式站現況（schema + 20261016）→ S1 login → S2 lockdown → S3 lockdown 回滾 → S4 login 回滾
// 驗證：① S1 後 f85aa16（現在正式站）的程式照常讀寫、關房 ② login 回滾恢復 migration 前的結構與函式行為
//       ③ lockdown 只移除兩個麻將 policy、回滾只恢復這兩個 ④ 模擬的 commercialbot 定義與行為四階段都不變
//       ⑤ 大老二的資料表、權限、行為四階段都不變
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SUPA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../supabase");
const results: string[] = [];
const db = new PGlite();
/** 執行專案裡的 SQL 檔；出錯就記一筆 ❌（附錯誤訊息）並結束，不讓後面的檢查在壞掉的狀態上繼續 */
async function runFile(f: string) {
  try {
    await db.exec(readFileSync(path.join(SUPA, f), "utf8"));
  } catch (e) {
    results.push(`❌ 執行 ${f} 失敗：${(e as Error).message}`);
    console.log(results.join("\n"));
    process.exit(1);
  }
}
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}

type Row = Record<string, unknown>;
const rows = async (q: string, args?: unknown[]) => (await db.query<Row>(q, args)).rows;
const one = async (q: string, args?: unknown[]) => (await rows(q, args))[0];
/** 用某個角色執行（模擬公開金鑰 anon、伺服器 service_role）；出錯回 "ERR ..." */
async function as<T>(role: string, fn: () => Promise<T>): Promise<T | string> {
  await db.exec(`set role ${role}`);
  try { return await fn(); } catch (e) { return "ERR " + (e as Error).message; } finally { await db.exec("reset role"); }
}

// ---------- Supabase 的角色與預設權限 ----------
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`);

// ---------- 模擬 commercialbot（同一個資料庫裡的別的服務）：先建，跟正式站一樣 ----------
await db.exec(`
  create function set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
  create table commercialbot_business_cards (id serial primary key, owner text not null, title text, updated_at timestamptz not null default '2000-01-01');
  create table commercialbot_user_state (owner text primary key, state jsonb not null default '{}', updated_at timestamptz not null default '2000-01-01');
  create trigger trg_cb_cards_updated before update on commercialbot_business_cards for each row execute function set_updated_at();
  create trigger trg_cb_state_updated before update on commercialbot_user_state for each row execute function set_updated_at();
  alter table commercialbot_business_cards enable row level security;
  alter table commercialbot_user_state enable row level security;
  create policy "cb cards readable" on commercialbot_business_cards for select to anon using (true);
  create policy "cb state service only" on commercialbot_user_state for all to service_role using (true) with check (true);
  revoke insert, update, delete on commercialbot_business_cards from anon;
  insert into commercialbot_business_cards (owner, title) values ('o1', 'card');
  insert into commercialbot_user_state (owner) values ('o1');
`);

// ---------- S0：正式站現況 ----------
await runFile("schema.sql");
await runFile("mahjong-schema.sql");
await runFile("migrations/20261016_match_records.sql");

// ---------- 結構快照 ----------
const MJ = ["mj_rooms", "mj_players", "match_records", "match_record_players"];
const B2 = ["big2_rooms", "big2_players"];
const CB = ["commercialbot_business_cards", "commercialbot_user_state"];
async function snapshot(tables: string[], fns: string[]) {
  const t = tables;
  return {
    columns: await rows(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name = any($1) order by 1, 2`, [t]),
    policies: await rows(`select tablename, policyname, cmd, roles::text, qual, with_check from pg_policies where tablename = any($1) order by 1, 2`, [t]),
    grants: await rows(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_name = any($1) order by 1, 2, 3`, [t]),
    rls: await rows(`select relname, relrowsecurity from pg_class where relname = any($1) order by 1`, [t]),
    triggers: await rows(`select tgname, pg_get_triggerdef(t.oid) d from pg_trigger t join pg_class c on c.oid = t.tgrelid where not tgisinternal and c.relname = any($1) order by 1`, [t]),
    indexes: await rows(`select tablename, indexname, indexdef from pg_indexes where tablename = any($1) order by 1, 2`, [t]),
    functions: await rows(`select proname, pg_get_functiondef(p.oid) d, proacl::text acl from pg_proc p where proname = any($1) order by 1`, [fns]),
  };
}
const snapMj = () => snapshot(MJ, ["close_room_with_record", "games_touch_room"]);
const snapB2 = () => snapshot(B2, []);
const snapCb = () => snapshot(CB, ["set_updated_at"]);

// ---------- 行為 ----------
let seq = 0;
/** commercialbot：公開金鑰讀得到名片、改不了；服務端更新時 trigger 照常更新 updated_at */
async function cbBehaviour() {
  const anonRead = await as("anon", async () => (await rows(`select title from commercialbot_business_cards`)).length);
  const anonWrite = await as("anon", async () => rows(`update commercialbot_business_cards set title = 'x'`));
  const svc = await as("service_role", async () => {
    await db.exec(`update commercialbot_business_cards set updated_at = '2000-01-01'; update commercialbot_user_state set updated_at = '2000-01-01'`);
    await db.exec(`update commercialbot_business_cards set title = title where owner = 'o1'; update commercialbot_user_state set state = state where owner = 'o1'`);
    return (await one(`select (select updated_at > '2001-01-01' from commercialbot_business_cards where owner='o1') a, (select updated_at > '2001-01-01' from commercialbot_user_state where owner='o1') b`));
  });
  return { anonRead, anonWriteBlocked: typeof anonWrite === "string" && anonWrite.startsWith("ERR"), svc };
}
/** 大老二：路由用公開金鑰（anon）建房、入座、改狀態、讀、刪；關房寫紀錄（沒有 user_id） */
async function big2Behaviour() {
  const code = String(3000 + ++seq);
  const viaAnon = await as("anon", async () => {
    const r = await one(`insert into big2_rooms (code) values ($1) returning id`, [code]);
    await db.query(`insert into big2_players (room_id, player_id, name, seat) values ($1, 'b0', '大0', 0)`, [r.id]);
    await db.query(`update big2_rooms set status = 'playing' where id = $1`, [r.id]);
    const read = await one(`select r.status, count(p.*)::int n from big2_rooms r join big2_players p on p.room_id = r.id where r.id = $1 group by r.status`, [r.id]);
    return { id: r.id as string, read };
  });
  if (typeof viaAnon === "string") return { error: viaAnon };
  const rowVersion = (await one(`select row_version from big2_rooms where id = $1`, [viaAnon.id])).row_version;
  const close = await as("service_role", async () => (await one(`select close_room_with_record('big2', $1, $2::jsonb) r`, [viaAnon.id,
    JSON.stringify({ room_code: code, started_at: null, end_reason: "dissolved", total_rounds: null, base_points: null, fan_points: null, settings: {}, hands_played: null,
      players: [{ seat: 0, player_name: "大0", player_id: "b0", total_score: 5 }] })])).r);
  const rec = await one(`select p.user_id from match_record_players p join match_records r on r.id = p.match_id where r.game = 'big2' and r.room_code = $1`, [code]);
  return { read: viaAnon.read, rowVersionBumped: Number(rowVersion) >= 1, close, userId: rec ? rec.user_id : "missing" };
}
/** f85aa16（現在正式站）的麻將：公開金鑰讀寫 mj_rooms／mj_players（不知道 user_id 欄位）；關房送的玩家沒有 user_id */
async function f85aa16Behaviour() {
  const code = String(5000 + ++seq);
  const crud = await as("anon", async () => {
    const r = await one(`insert into mj_rooms (code, status, host_id, game_state) values ($1, 'waiting', 'p0', '{"roomSettings":{"totalRounds":1}}') returning id`, [code]);
    for (let s = 0; s < 4; s++) await db.query(`insert into mj_players (room_id, player_id, name, seat) values ($1, $2, $3, $4)`, [r.id, `p${s}`, `P${s}`, s]);
    const upd = await rows(`update mj_rooms set game_state = '{"stateVersion":1,"status":"playing"}', status = 'playing' where id = $1 and game_state->>'stateVersion' is null returning id`, [r.id]);
    const read = await one(`select game_state->>'status' s, (select count(*)::int from mj_players where room_id = $1) n from mj_rooms where id = $1`, [r.id]);
    return { id: r.id as string, updated: upd.length, read };
  });
  if (typeof crud === "string") return { error: crud };
  // f85aa16 的 lib/records/store.ts closeRoom 送出的格式（玩家只有 seat、player_name、player_id、total_score）
  const payload = { room_code: code, started_at: "2026-10-16T09:00:00Z", end_reason: "completed", total_rounds: 1, base_points: 100, fan_points: 20, settings: {}, hands_played: 4,
    players: [0, 1, 2, 3].map((s) => ({ seat: s, player_name: `P${s}`, player_id: `p${s}`, total_score: [300, -100, -100, -100][s] })) };
  const close = await as("service_role", async () => (await one(`select close_room_with_record('mahjong', $1, $2::jsonb, null, 1) r`, [crud.id, JSON.stringify(payload)])).r);
  const rec = await rows(`select p.seat, p.total_score, p.user_id from match_record_players p join match_records r on r.id = p.match_id where r.room_code = $1 order by seat`, [code]);
  const gone = (await one(`select count(*)::int c from mj_rooms where id = $1`, [crud.id])).c;
  return { updated: crud.updated, read: crud.read, close, scores: rec.map((r) => r.total_score), userIds: rec.map((r) => r.user_id), roomDeleted: gone === 0 };
}
/** 新程式關房：玩家帶 user_id（有帳號、null、空字串、沒有欄位） */
async function closeWithUserIds() {
  const code = String(7000 + ++seq);
  const id = (await one(`insert into mj_rooms (code, status) values ($1, 'finished') returning id`, [code])).id;
  const U = "11111111-0000-4000-8000-000000000000";
  const players = [{ user_id: U }, { user_id: null }, {}, { user_id: "" }].map((x, s) => ({ seat: s, player_name: `P${s}`, player_id: `n${s}`, total_score: 0, ...x }));
  const close = await as("service_role", async () => (await one(`select close_room_with_record('mahjong', $1, $2::jsonb) r`, [id, JSON.stringify({ room_code: code, end_reason: "completed", settings: {}, players })])).r);
  const rec = await rows(`select p.user_id from match_record_players p join match_records r on r.id = p.match_id where r.room_code = $1 order by seat`, [code]);
  return { close, userIds: rec.map((r) => r.user_id) };
}
const anonCanReadMj = async () => as("anon", async () => (await rows(`select id from mj_rooms`)).length + (await rows(`select id from mj_players`)).length);
const svcCanReadMj = async () => as("service_role", async () => (await rows(`select id from mj_rooms`)).length);
const allMj = async () => (await one(`select count(*)::int c from mj_rooms`)).c as number;

// ---------- 階段 ----------
await db.exec(`insert into mj_rooms (code, status, game_state) values ('9001', 'playing', '{"players":[{"hand":[1,2,3]}]}')`);
const S0 = { mj: await snapMj(), b2: await snapB2(), cb: await snapCb() };
const cb0 = await cbBehaviour();
eq([cb0.anonRead, cb0.anonWriteBlocked, cb0.svc], [1, true, { a: true, b: true }], "S0 模擬 commercialbot 建好：公開金鑰讀得到名片、改不了；服務端更新會觸發 set_updated_at()");
const b20 = await big2Behaviour();
eq(b20, { read: { status: "playing", n: 1 }, rowVersionBumped: true, close: "closed", userId: null }, "S0 大老二基準：公開金鑰建房、入座、更新、讀取都可以；關房寫紀錄 user_id 為空");
const f0 = await f85aa16Behaviour();
const OLD_OK = { updated: 1, read: { s: "playing", n: 4 }, close: "closed", scores: [300, -100, -100, -100], userIds: [null, null, null, null], roomDeleted: true };
eq(f0, OLD_OK, "S0 f85aa16 基準：公開金鑰讀寫房間和座位、關房寫紀錄並刪房");
const closeBefore = await closeWithUserIds();

// S1 login
await runFile("migrations/20261017_mahjong_login.sql");
eq(await f85aa16Behaviour(), OLD_OK, "① login 跑完後，f85aa16（現在正式站）的程式照常：公開金鑰讀寫房間和座位（不帶 user_id）、用舊格式關房寫紀錄並刪房");
eq(await closeWithUserIds(), { close: "closed", userIds: ["11111111-0000-4000-8000-000000000000", null, null, null] }, "S1 新程式關房：有帳號的寫入 user_id；null、沒有欄位、空字串都寫空值");
const S1 = { mj: await snapMj(), b2: await snapB2(), cb: await snapCb(), cbB: await cbBehaviour(), b2B: await big2Behaviour() };
eq([S1.mj.columns.filter((c) => !S0.mj.columns.some((o) => JSON.stringify(o) === JSON.stringify(c))).map((c) => `${c.table_name}.${c.column_name}`),
  S1.mj.policies, S1.mj.grants, S1.mj.triggers, S1.mj.indexes], [["mj_players.user_id"], S0.mj.policies, S0.mj.grants, S0.mj.triggers, S0.mj.indexes],
  "S1 login 只新增 mj_players.user_id 一欄；policy、權限、trigger、索引都沒變");
eq(S1.mj.functions.find((f) => f.proname === "close_room_with_record")?.acl, S0.mj.functions.find((f) => f.proname === "close_room_with_record")?.acl,
  "S1 close_room_with_record 的執行權限沒變（anon 不能執行、service_role 可以）");

// S2 lockdown
const anonBefore = await anonCanReadMj();
await runFile("migrations/20261017_mahjong_lockdown.sql");
const S2 = { mj: await snapMj(), b2: await snapB2(), cb: await snapCb(), cbB: await cbBehaviour(), b2B: await big2Behaviour() };
const removed = S1.mj.policies.filter((p) => !S2.mj.policies.some((q) => JSON.stringify(q) === JSON.stringify(p))).map((p) => `${p.tablename}:${p.policyname}`);
const added = S2.mj.policies.filter((p) => !S1.mj.policies.some((q) => JSON.stringify(q) === JSON.stringify(p)));
eq([removed, added, { ...S2.mj, policies: null }], [["mj_players:Allow all on mj_players", "mj_rooms:Allow all on mj_rooms"], [], { ...S1.mj, policies: null }],
  "③ lockdown 只移除 mj_rooms、mj_players 那兩個「任何人可讀寫」的 policy；其他 policy、欄位、權限、RLS、trigger、函式都沒變");
eq([typeof anonBefore === "number" && anonBefore > 0, await anonCanReadMj(), await svcCanReadMj() === (await allMj()) && (await allMj()) > 0], [true, 0, true],
  "③ lockdown 後：公開金鑰讀不到麻將房間和座位（之前讀得到含手牌的牌局），service role（新程式）照常讀得到");
const anonWrite = await as("anon", async () => (await rows(`update mj_rooms set status = 'x' returning id`)).length);
eq(anonWrite, 0, "③ lockdown 後：公開金鑰改不了麻將房間");

// S3 lockdown 回滾
await runFile("migrations/20261017_mahjong_lockdown_rollback.sql");
const S3 = { mj: await snapMj(), b2: await snapB2(), cb: await snapCb(), cbB: await cbBehaviour(), b2B: await big2Behaviour() };
eq(S3.mj, S1.mj, "③ lockdown 回滾：只恢復那兩個 policy，麻將相關結構和 lockdown 前（S1）完全一樣");
eq(await f85aa16Behaviour(), OLD_OK, "③ lockdown 回滾後：f85aa16 的程式又可以用公開金鑰讀寫、關房");

// S4 login 回滾
await runFile("migrations/20261017_mahjong_login_rollback.sql");
const S4 = { mj: await snapMj(), b2: await snapB2(), cb: await snapCb(), cbB: await cbBehaviour(), b2B: await big2Behaviour() };
eq(S4.mj, S0.mj, "② login 回滾：欄位、policy、權限、RLS、trigger、索引、函式定義與權限都和 migration 前（S0）完全一樣");
const closeAfter = await closeWithUserIds();
eq([closeAfter.close, closeAfter.userIds], [closeBefore.close, closeBefore.userIds], "② login 回滾後的函式行為和 migration 前一樣：玩家帶 user_id 也不寫入（全部空值）");
eq(await f85aa16Behaviour(), OLD_OK, "② login 回滾後：f85aa16 的程式照常");
eq((await one(`select count(*)::int c from match_record_players where user_id is not null`)).c, 1, "② login 回滾不刪已寫入的紀錄（S1 寫入的 user_id 保留）");

// ④ ⑤ 四個階段都比對
for (const [name, S] of [["S1 login", S1], ["S2 lockdown", S2], ["S3 lockdown 回滾", S3], ["S4 login 回滾", S4]] as const) {
  eq(S.cb, S0.cb, `④ ${name} 後：commercialbot 的欄位、policy、權限、RLS、trigger、set_updated_at() 定義與權限都完全沒變`);
  eq(S.cbB, cb0, `④ ${name} 後：commercialbot 的行為不變（公開金鑰讀得到名片、改不了；更新時 updated_at 照常更新）`);
  eq(S.b2, S0.b2, `⑤ ${name} 後：大老二的欄位、policy、權限、RLS、trigger、索引都完全沒變`);
  eq(S.b2B, b20, `⑤ ${name} 後：大老二的行為不變（公開金鑰建房、入座、更新、讀取；關房寫紀錄）`);
}
// 行為：在最後再各驗一次（S4），中間階段也驗
await runFile("migrations/20261017_mahjong_login.sql");
await runFile("migrations/20261017_mahjong_lockdown.sql");
eq([await cbBehaviour(), await big2Behaviour()], [cb0, b20], "④⑤ login＋lockdown 都上線的狀態：commercialbot、大老二的行為和一開始一樣（公開金鑰照常讀寫大老二）");
await runFile("migrations/20261017_mahjong_lockdown_rollback.sql");
await runFile("migrations/20261017_mahjong_login_rollback.sql");
eq([await cbBehaviour(), await big2Behaviour()], [cb0, b20], "④⑤ 兩份都回滾後：commercialbot、大老二的行為和一開始一樣");
const S5 = { mj: await snapMj(), b2: await snapB2(), cb: await snapCb() };
eq(S5, S0, "重跑一輪（login → lockdown → 兩份回滾）後：三組結構都回到 S0");

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
