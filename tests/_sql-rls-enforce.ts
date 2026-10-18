// 在記憶體 PostgreSQL（PGlite，不連任何資料庫）執行 20261019_mahjong_rls_enforce 和它的回滾：
//   S0 模擬正式庫現況（schema + 20261016 + 20261017_login，沒跑 lockdown），再故意加上 repo 裡沒有的設定：
//      不認識的 permissive policy、restrictive policy、PUBLIC 權限、欄位權限、WITH GRANT OPTION、FORCE RLS、關掉的 RLS，
//      以及非 postgres 授予的權限（grantor 鏈 postgres → zgrantor → auditor → reporter，含資料表、欄位、grant option）
//   之後 enforce → enforce（重跑）→ rollback → rollback（重跑）→ enforce → rollback
// 驗證：① S0 公開金鑰讀得到麻將牌局（重現 2026-10-19 的問題）
//       ② 套用後 anon、authenticated 讀不到、也寫不了（包括靠 PUBLIC、欄位權限拿到的）
//       ③ service_role 照常讀寫、關房寫紀錄
//       ④ 大老二和同庫的其他服務完全沒變
//       ⑤ 回滾把 policy（含 restrictive）、資料表與欄位權限（含 grantor、grant option）、RLS／FORCE RLS 精確還原成 S0
//         （grantor 也要一樣：收回、補回都用原本的 grantor 身分；改回「由執行者補」的寫法會失敗 5 項）
//       ⑥ enforce、rollback 都可以重跑：重跑 enforce 不會蓋掉原始備份；沒有備份、或執行者切換不到 grantor 時，
//         rollback 丟錯、什麼都不改
//       ⑦ 權限收不乾淨（別的 grantor 給的）時 enforce 丟錯、整份不生效
//       ⑧ 程式碼：碰四張麻將表的檔案都只用 service role
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SUPA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../supabase");
const sql = (f: string) => readFileSync(path.join(SUPA, f), "utf8");
const ENFORCE = "migrations/20261019_mahjong_rls_enforce.sql";
const ROLLBACK = "migrations/20261019_mahjong_rls_enforce_rollback.sql";
const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
type Row = Record<string, unknown>;

const MJ = ["mj_rooms", "mj_players", "match_records", "match_record_players"];
const OTHER = ["big2_rooms", "big2_players", "commercialbot_business_cards"];

/** 建一個模擬正式庫的 PGlite，回傳操作工具 */
async function makeDb(extra = "") {
  const db = new PGlite();
  const rows = async (q: string, args?: unknown[]) => (await db.query<Row>(q, args)).rows;
  const one = async (q: string, args?: unknown[]) => (await rows(q, args))[0];
  async function as<T>(role: string, fn: () => Promise<T>): Promise<T | string> {
    await db.exec(`set role ${role}`);
    try { return await fn(); } catch (e) { return "ERR " + (e as Error).message; } finally { await db.exec("reset role"); }
  }
  /** 執行 SQL 檔；失敗時回傳錯誤訊息並把中斷的 transaction 收掉 */
  async function run(f: string): Promise<string | null> {
    try { await db.exec(sql(f)); return null; } catch (e) { await db.exec("rollback").catch(() => {}); return (e as Error).message; }
  }
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create role auditor nologin; create role zgrantor nologin; create role reporter nologin;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    create table commercialbot_business_cards (id serial primary key, owner text not null, title text);
    alter table commercialbot_business_cards enable row level security;
    create policy "cb cards readable" on commercialbot_business_cards for select to anon using (true);
    revoke insert, update, delete on commercialbot_business_cards from anon;
    insert into commercialbot_business_cards (owner, title) values ('o1', 'card');
  `);
  for (const f of ["schema.sql", "mahjong-schema.sql", "migrations/20261016_match_records.sql", "migrations/20261017_mahjong_login.sql"]) {
    const err = await run(f);
    if (err) throw new Error(`執行 ${f} 失敗：${err}`);
  }
  // 正式庫可能有、repo 裡沒有的設定
  await db.exec(`
    create policy "legacy anon read" on mj_players for select to anon using (true);
    create policy "only playing rooms" on mj_rooms as restrictive for select to anon, authenticated using (status <> 'deleted');
    create policy "svc insert check" on match_records for insert to service_role with check (game in ('big2', 'mahjong'));
    grant select on mj_rooms to public;
    grant select (name, seat) on mj_players to auditor;
    grant select (name, seat) on mj_players to anon;
    grant select on match_records to auditor with grant option;
    -- 非 postgres 授予的權限（grantor 鏈：postgres → zgrantor → auditor → reporter），含資料表、欄位、grant option
    grant select, update on mj_rooms to zgrantor with grant option;
    grant select (name) on mj_players to zgrantor with grant option;
    grant insert on match_record_players to zgrantor with grant option;
    set role zgrantor;
    grant select on mj_rooms to auditor;
    grant update on mj_rooms to auditor with grant option;
    grant select (name) on mj_players to auditor with grant option;
    grant insert on match_record_players to reporter;
    reset role;
    set role auditor;
    grant update on mj_rooms to reporter;
    grant select (name) on mj_players to reporter;
    reset role;
    alter table mj_rooms force row level security;
    alter table match_record_players disable row level security;
    insert into mj_rooms (code, status, game_state) values ('4746', 'playing', '{"wall":[{"id":20}],"players":[{"hand":[{"id":1}]}]}');
    insert into mj_players (room_id, player_id, name, seat, user_id) select id, 'p0', 'P0', 0, '11111111-0000-4000-8000-000000000000' from mj_rooms where code = '4746';
    insert into big2_rooms (code, status) values ('3001', 'playing');
    ${extra}
  `);

  /** policy（含 permissive）、資料表與欄位權限（含 grantor、grant option）、RLS／FORCE RLS 的完整快照 */
  async function snap(tables: string[]) {
    return {
      policies: await rows(`select tablename, policyname, permissive, cmd, roles::text, qual, with_check from pg_policies where tablename = any($1) order by 1, 2`, [tables]),
      tableAcl: await rows(`select c.relname, case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end g, a.grantor::regrole::text gr, a.privilege_type, a.is_grantable
        from pg_class c, lateral aclexplode(c.relacl) a where c.relname = any($1) order by 1, 2, 4, 3, 5`, [tables]),
      columnAcl: await rows(`select c.relname, att.attname, case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end g, a.grantor::regrole::text gr, a.privilege_type, a.is_grantable
        from pg_class c join pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and att.attacl is not null, lateral aclexplode(att.attacl) a
        where c.relname = any($1) order by 1, 2, 3, 5, 4, 6`, [tables]),
      rls: await rows(`select relname, relrowsecurity, relforcerowsecurity from pg_class where relname = any($1) order by 1`, [tables]),
    };
  }
  /** 公開金鑰對四張表能做什麼。寫入加 where false：權限照樣檢查，但有權限時也不會真的改到資料 */
  async function publicAccess(role: string) {
    return as(role, async () => {
      const r: Record<string, string | number> = {};
      for (const t of MJ) {
        try { r[`${t}.read`] = (await rows(`select * from ${t}`)).length; } catch { r[`${t}.read`] = "denied"; }
      }
      try { r["mj_players.readCols"] = (await rows(`select name, seat from mj_players`)).length; } catch { r["mj_players.readCols"] = "denied"; }
      try { r["mj_rooms.update"] = (await rows(`update mj_rooms set status = 'x' where false returning id`)).length; } catch { r["mj_rooms.update"] = "denied"; }
      try { r["mj_rooms.delete"] = (await rows(`delete from mj_rooms where false returning id`)).length; } catch { r["mj_rooms.delete"] = "denied"; }
      try { r["mj_rooms.insert"] = (await rows(`insert into mj_rooms (code) select '6666' where false returning id`)).length; } catch { r["mj_rooms.insert"] = "denied"; }
      return r;
    });
  }
  let seq = 0;
  /** 伺服器（service_role）：讀牌局、條件寫入、建房入座、關房寫紀錄 */
  async function serverWorks() {
    return as("service_role", async () => {
      const gs = (await one(`select game_state->'wall'->0->>'id' w from mj_rooms where code = '4746'`)).w;
      const upd = (await rows(`update mj_rooms set game_state = jsonb_set(game_state, '{stateVersion}', '1') where code = '4746' returning id`)).length;
      const code = String(7000 + ++seq);
      const id = (await one(`insert into mj_rooms (code, status) values ($1, 'finished') returning id`, [code])).id;
      await db.query(`insert into mj_players (room_id, player_id, name, seat) values ($1, 'n0', 'N0', 0)`, [id]);
      const players = [0, 1, 2, 3].map((s) => ({ seat: s, player_name: `P${s}`, player_id: `n${s}`, total_score: 0 }));
      const close = (await one(`select close_room_with_record('mahjong', $1, $2::jsonb) r`, [id, JSON.stringify({ room_code: code, end_reason: "completed", settings: {}, players })])).r;
      const rec = (await one(`select count(*)::int c from match_records where room_code = $1`, [code])).c;
      const gone = (await one(`select count(*)::int c from mj_rooms where id = $1`, [id])).c === 0;
      return { wall0: gs, updated: upd, close, recorded: rec, roomDeleted: gone };
    });
  }
  async function othersWork() {
    return as("anon", async () => ({
      big2Read: (await rows(`select * from big2_rooms`)).length > 0,
      big2Update: (await rows(`update big2_rooms set status = status returning id`)).length,
      cardRead: (await rows(`select * from commercialbot_business_cards`)).length,
    }));
  }
  const backup = async () => (to_s(await one(`select to_regclass('mj_rls_backup.meta') r`)) === "null" ? null : {
    meta: (await one(`select taken_at::text t from mj_rls_backup.meta`)).t,
    policies: await rows(`select * from mj_rls_backup.policies order by tablename, policyname`),
    grants: await rows(`select * from mj_rls_backup.grants order by tablename, attname nulls first, grantee, privilege_type`),
    rls: await rows(`select * from mj_rls_backup.rls order by tablename`),
  });
  return { db, rows, one, as, run, snap, publicAccess, serverWorks, othersWork, backup };
}
const to_s = (r: Row | undefined) => String(r?.r ?? "null");

const SERVER_OK = { wall0: "20", updated: 1, close: "closed", recorded: 1, roomDeleted: true };
const DENIED = Object.fromEntries([...MJ.map((t) => [`${t}.read`, "denied"]), ["mj_players.readCols", "denied"], ["mj_rooms.update", "denied"], ["mj_rooms.delete", "denied"], ["mj_rooms.insert", "denied"]]);

// ===================== 主流程 =====================
const D = await makeDb();
const S0 = { mj: await D.snap(MJ), other: await D.snap(OTHER) };
const a0 = await D.publicAccess("anon");
eq(typeof a0 === "string" ? a0 : [a0["mj_rooms.read"], a0["mj_players.read"]], [1, 1], "① S0 重現問題：公開金鑰讀得到 mj_rooms（含牌牆、手牌）和 mj_players（含 user_id）");
eq([S0.mj.policies.some((p) => p.permissive === "RESTRICTIVE"), S0.mj.tableAcl.some((g) => g.g === "PUBLIC"), S0.mj.columnAcl.length > 0,
  S0.mj.tableAcl.some((g) => g.is_grantable), S0.mj.rls.some((r) => r.relforcerowsecurity), S0.mj.rls.some((r) => !r.relrowsecurity)],
  [true, true, true, true, true, true], "S0 有 restrictive policy、PUBLIC 權限、欄位權限、grant option、FORCE RLS、關掉的 RLS（測試前提）");
eq([...new Set([...S0.mj.tableAcl, ...S0.mj.columnAcl].map((g) => String(g.gr)))].sort(), ["auditor", "postgres", "zgrantor"],
  "S0 有非 postgres 授予的資料表和欄位權限（zgrantor、auditor 當 grantor，含 grant option）（測試前提）");
const o0 = await D.othersWork();
eq(await D.run(ROLLBACK) !== null && JSON.stringify(await D.snap(MJ)) === JSON.stringify(S0.mj), true, "⑥ 還沒套用就回滾：丟錯、什麼都沒改");

// enforce
eq(await D.run(ENFORCE), null, "S1 enforce 執行成功");
const S1 = { mj: await D.snap(MJ), other: await D.snap(OTHER) };
const B1 = await D.backup();
eq(await D.publicAccess("anon"), DENIED, "② S1 anon：讀、讀欄位、改、刪、新增全部被拒（PUBLIC、欄位權限也收掉）");
eq(await D.publicAccess("authenticated"), DENIED, "② S1 authenticated：一樣全部被拒");
eq([S1.mj.policies, S1.mj.columnAcl.filter((g) => g.g === "anon" || g.g === "authenticated" || g.g === "PUBLIC"),
  S1.mj.tableAcl.filter((g) => g.g === "anon" || g.g === "authenticated" || g.g === "PUBLIC"), S1.mj.rls.map((r) => r.relrowsecurity)],
  [[], [], [], [true, true, true, true]], "② S1 policy 全部拿掉（含 restrictive）、公開金鑰沒有任何權限、RLS 四張都開");
eq(await D.serverWorks(), SERVER_OK, "③ S1 service_role 照常：讀牌局、更新、建房入座、關房寫紀錄並刪房");
eq([await D.othersWork(), S1.other], [o0, S0.other], "④ S1 大老二和其他服務的行為、policy、權限、RLS 完全沒變");
eq(await D.as("anon", async () => (await D.rows(`select * from mj_rls_backup.policies`)).length), "ERR permission denied for schema mj_rls_backup", "S1 備份 schema 公開金鑰讀不到");
eq([B1?.policies.length, B1?.rls.length, (B1?.grants.length ?? 0) > 0], [S0.mj.policies.length, 4, true], "S1 備份存下套用前的 policy、RLS、權限");

// enforce 重跑
eq(await D.run(ENFORCE), null, "⑥ enforce 重跑：執行成功");
eq([await D.snap(MJ), await D.backup()], [S1.mj, B1], "⑥ enforce 重跑：狀態和第一次一樣，原始備份沒有被蓋掉");

// rollback
eq(await D.run(ROLLBACK), null, "S2 rollback 執行成功");
eq(await D.snap(MJ), S0.mj, "⑤ S2 rollback 精確還原：policy（含 restrictive、不在 repo 的）、資料表與欄位權限（含 PUBLIC、grantor、grant option）、RLS／FORCE RLS 全部和 S0 一樣");
eq((await D.snap(OTHER)), S0.other, "⑤ S2 大老二和其他服務沒變");
eq(await D.serverWorks(), SERVER_OK, "⑤ S2 回滾後 service_role 照常");
eq(await D.run(ROLLBACK), null, "⑥ rollback 重跑：執行成功");
eq(await D.snap(MJ), S0.mj, "⑥ rollback 重跑：還是和 S0 一樣");

// 再鎖一次、再回滾一次
eq(await D.run(ENFORCE), null, "S3 再 enforce 一次");
eq([await D.snap(MJ), await D.publicAccess("anon"), await D.backup()], [S1.mj, DENIED, B1], "⑥ S3 再鎖：和 S1 一樣，用的還是原始備份");
eq(await D.run(ROLLBACK), null, "S4 再 rollback 一次");
eq(await D.snap(MJ), S0.mj, "⑥ S4 再回滾：和 S0 一樣");

// 套用後才多出來的權限，回滾時也收回（還原成備份那一刻）
await D.run(ENFORCE);
await D.db.exec(`grant select on mj_players to auditor;`);
await D.run(ROLLBACK);
eq(await D.snap(MJ), S0.mj, "⑤ 套用後才多給的權限（auditor 讀 mj_players），回滾時也收回，回到 S0");

// ===================== ⑥ 切換不到 grantor：回滾丟錯、什麼都不改 =====================
{
  const F = await makeDb();
  await F.run(ENFORCE);
  const locked = await F.snap(MJ);
  await F.db.exec(`create role opsadmin nologin; grant usage on schema mj_rls_backup to opsadmin; grant select on all tables in schema mj_rls_backup to opsadmin; set role opsadmin;`);
  const err = await F.run(ROLLBACK);
  await F.db.exec(`reset role;`);
  eq([err?.includes("不能切換成 grantor") ?? false, JSON.stringify(await F.snap(MJ)) === JSON.stringify(locked)], [true, true],
    "⑥ 執行者不能切換成備份裡的 grantor：回滾丟錯、什麼都不改（不會用別的 grantor 悄悄補）");
}

// ===================== ⑦ 權限收不乾淨：整份不生效 =====================
{
  // 別的角色（auditor 有 grant option）轉給 anon：postgres 的 REVOKE 收不掉這筆
  const E = await makeDb(`set role auditor; grant select on match_records to anon; reset role;`);
  const before = await E.snap(MJ);
  const err = await E.run(ENFORCE);
  eq([err?.includes("鎖表沒有完成") ?? false, JSON.stringify(await E.snap(MJ)) === JSON.stringify(before), await E.backup()], [true, true, null],
    "⑦ 公開金鑰的權限是別的 grantor 給的：enforce 丟錯、整份不生效（policy、權限、RLS 都沒變，也沒有留下備份）");
}

// ===================== ⑧ 程式碼：碰這四張表的檔案一律用 service role =====================
{
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = path.join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(f)) files.push(p);
    }
  };
  for (const d of ["app", "lib", "hooks", "components"]) walk(path.join(ROOT, d));
  const touching = files.filter((f) => /\.from\(\s*["'`](mj_rooms|mj_players|match_records|match_record_players)["'`]/.test(readFileSync(f, "utf8")));
  const bad = touching.filter((f) => {
    const src = readFileSync(f, "utf8");
    return !/getSupabaseAdmin/.test(src) || /getSupabase(Server)?\(\)/.test(src);
  }).map((f) => path.relative(ROOT, f).split(path.sep).join("/"));
  eq([touching.length, bad], [2, []], "⑧ 程式裡讀寫四張麻將表的檔案（lib/mahjong/db.ts、lib/records/store.ts）都只用 getSupabaseAdmin（service role）");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
