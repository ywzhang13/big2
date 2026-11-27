// 大老二資料表鎖權限（老柯 2026-11-27，20261127_big2_rls_enforce.sql）：記憶體 PostgreSQL（PGlite）跑正式站現況的 schema＋真的 migration，
// 大老二的路由和 lib/big2/*Store.ts 都是真程式碼（真的 supabase-js），透過 tests/support/thirteen-postgrest.ts 打進資料庫；
// 只有廣播、對局紀錄、after() 用 tests/support 的替身。
//   L0 套用前（正式站現況）：拿網站公開金鑰直接查資料庫，讀得到四家手牌、改得了牌局——這就是要修的洞
//   L1 套用後：公開金鑰（anon）和登入後的金鑰（authenticated）對 big2_rooms、big2_players 讀、新增、修改、刪除全部被擋
//   L2 套用後一般流程照常：開房 → 四家入座 → 開局確認 → 發牌 → 出牌 → 結束 → 下一局（再出牌、過）；等人階段退出也照常
//   L3 回滾：policy、資料表與欄位權限、RLS 完整回到套用前；公開金鑰又讀得到（確認回滾真的生效）；再套一次照樣鎖住
// npm test 用一般設定跑每個檔案；這支要讓大老二 store 走真程式碼，所以自己用 TEST_BIG2_REAL_DB=1 重開一個行程跑。
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

if (process.env.TEST_BIG2_REAL_DB !== "1") {
  const register = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../support/register.mjs")).href;
  const r = spawnSync(process.execPath, ["--import", register, fileURLToPath(import.meta.url)], {
    encoding: "utf8",
    env: { ...process.env, TEST_BIG2_REAL_DB: "1" },
  });
  process.stdout.write((r.stdout ?? "") + (r.stderr ?? ""));
  process.exit(r.status ?? 1);
}

const { PGlite } = await import("@electric-sql/pglite");
const { readFileSync } = await import("node:fs");
const { createClient } = await import("@supabase/supabase-js");
const { installPostgrest } = await import("../support/thirteen-postgrest");
const { SUPABASE_SETUP } = await import("../support/pg-mj");

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}

const SUPA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase");
const MIG = "migrations/20261127_big2_rls_enforce.sql", RB = "migrations/20261127_big2_rls_enforce_rollback.sql";
const db = new PGlite();
const run = (f: string) => db.exec(readFileSync(path.join(SUPA, f), "utf8"));
await db.exec(SUPABASE_SETUP);
for (const f of ["schema.sql", "mahjong-schema.sql", "migrations/20261016_match_records.sql", "migrations/20261017_mahjong_login.sql",
  "migrations/20261019_mahjong_rls_enforce.sql", "migrations/20261120_big2_start_confirm.sql"]) await run(f);

const BASE = "http://big2-rls.test", ANON = "test-anon-key";
process.env.NEXT_PUBLIC_SUPABASE_URL = BASE;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON;
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
installPostgrest(db, BASE, { anonKey: ANON });
const anon = createClient(BASE, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

/** 權限現況（policy、資料表與欄位權限、RLS）：回滾後要和套用前一字不差 */
async function perms() {
  const q = async (sql: string) => (await db.query<Record<string, unknown>>(sql)).rows;
  return {
    policies: await q(`select tablename, policyname, permissive, roles::text, cmd, qual, with_check from pg_policies
      where schemaname = 'public' and tablename in ('big2_rooms', 'big2_players') order by 1, 2`),
    grants: await q(`select c.relname, null::text as attname, a.grantee::regrole::text as grantee, a.grantor::regrole::text as grantor, a.privilege_type, a.is_grantable
      from pg_class c, lateral aclexplode(c.relacl) a where c.relnamespace = 'public'::regnamespace and c.relname in ('big2_rooms', 'big2_players')
      union all
      select c.relname, att.attname::text, a.grantee::regrole::text, a.grantor::regrole::text, a.privilege_type, a.is_grantable
      from pg_class c join pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and att.attacl is not null, lateral aclexplode(att.attacl) a
      where c.relnamespace = 'public'::regnamespace and c.relname in ('big2_rooms', 'big2_players') order by 1, 2 nulls first, 3, 5`),
    rls: await q(`select relname, relrowsecurity, relforcerowsecurity from pg_class
      where relnamespace = 'public'::regnamespace and relname in ('big2_rooms', 'big2_players') order by 1`),
  };
}

/** 公開金鑰直接查資料庫（攻擊者會做的事）：讀手牌、改牌局、新增、刪除，各回成功或錯誤代碼 */
async function anonAttack(roomId: string) {
  const read = await anon.from("big2_players").select("player_id, hand").eq("room_id", roomId);
  const readRoom = await anon.from("big2_rooms").select("id, status").eq("id", roomId);
  const upd = await anon.from("big2_rooms").update({ status: "finished" }).eq("id", roomId).select("id");
  const ins = await anon.from("big2_rooms").insert({ code: "9999", status: "waiting" }).select("id");
  const insP = await anon.from("big2_players").insert({ room_id: roomId, player_id: "evil", name: "x", seat: 0 }).select("id");
  const del = await anon.from("big2_players").delete().eq("room_id", roomId).eq("player_id", "evil").select("id");
  const r = (x: { error: { code?: string } | null; data: unknown }) => (x.error ? `擋下:${x.error.code}` : `成功:${(x.data as unknown[] | null)?.length ?? 0}筆`);
  return {
    readHands: read.error ? `擋下:${read.error.code}` : (read.data ?? []).filter((p) => (p.hand as unknown[]).length > 0).length + "家有手牌",
    readRoom: r(readRoom), update: r(upd), insertRoom: r(ins), insertPlayer: r(insP), delete: r(del),
  };
}
/** 用 SQL 直接切成某個角色試讀寫（authenticated 也要擋） */
async function asRole(role: string) {
  const one = async (sql: string) => {
    try { return await db.transaction(async (tx) => { await tx.exec(`set local role ${role}`); await tx.query(sql); return "成功"; }); }
    catch (e) { return `擋下:${(e as { code?: string }).code}`; }
  };
  return [
    await one(`select hand from public.big2_players limit 1`), await one(`select id from public.big2_rooms limit 1`),
    await one(`update public.big2_rooms set pass_count = 0 where false`), await one(`delete from public.big2_players where false`),
    await one(`insert into public.big2_rooms (code) values ('8888')`),
  ];
}

// ── 路由（真程式碼） ──
const { POST: create } = await import("../../app/api/game/create/route");
const { POST: join } = await import("../../app/api/game/join/route");
const { GET: state } = await import("../../app/api/game/state/route");
const { POST: readyCheck } = await import("../../app/api/game/ready-check/route");
const { POST: ready } = await import("../../app/api/game/ready/route");
const { POST: play } = await import("../../app/api/game/play/route");
const { POST: pass } = await import("../../app/api/game/pass/route");
const { POST: cont } = await import("../../app/api/game/continue/route");
const { POST: leave } = await import("../../app/api/game/leave/route");

type Res = { status: number; body: Record<string, unknown> };
const post = (fn: (r: Request) => Promise<Response>, url: string, body: unknown): Promise<Res> =>
  fn(new Request(`http://x${url}`, { method: "POST", body: JSON.stringify(body) })).then(async (r) => ({ status: r.status, body: await r.json() }));
const getState = async (roomId: string, playerId: string, seatKey?: string): Promise<Res> => {
  const url = `http://x/api/game/state?roomId=${roomId}&playerId=${playerId}`;
  const req = new Request(url, { headers: seatKey ? { "x-big2-seat-key": seatKey } : {} });
  const r = await state(Object.assign(req, { nextUrl: new URL(url) }) as unknown as Parameters<typeof state>[0]);
  return { status: r.status, body: await r.json() };
};
const roomRow = async (id: string) => (await db.query<{ status: string; current_turn: number; start_confirm: { id: string } | null }>(
  `select status, current_turn, start_confirm from big2_rooms where id = $1`, [id])).rows[0];

/** 開房 → 四家入座 → 房主按開始 → 三家同意（發牌）；回房間與四家憑證 */
async function startedRoom(tag: string) {
  const ps = ["a", "b", "c", "d"].map((x) => `${x}-${tag}`);
  const c = await post(create, "/api/game/create", { hostId: ps[0] });
  const { code, roomId } = c.body as { code: string; roomId: string };
  const keys: Record<string, string> = {};
  const joins: number[] = [];
  for (const p of ps) {
    const j = await post(join, "/api/game/join", { code, playerId: p, name: "N" + p });
    joins.push(j.status); keys[p] = j.body.seatKey as string;
  }
  const rc = await post(readyCheck, "/api/game/ready-check", { roomId, playerId: ps[0], seatKey: keys[ps[0]], proto: 2 });
  const cid = (await roomRow(roomId)).start_confirm?.id;
  const rd: number[] = [];
  for (const p of ps.slice(1)) rd.push((await post(ready, "/api/game/ready", { roomId, playerId: p, confirmId: cid, proto: 2 })).status);
  return { roomId, code, ps, keys, steps: { create: c.status, joins, readyCheck: rc.status, ready: rd } };
}
/** 四家各自帶憑證讀狀態：每家拿到的手牌張數 */
const handCounts = async (r: { roomId: string; ps: string[]; keys: Record<string, string> }) =>
  Promise.all(r.ps.map(async (p) => ((await getState(r.roomId, p, r.keys[p])).body.myHand as unknown[]).length));

// ═══ L0 套用前 ═══
const before = await perms();
const pre = await startedRoom("pre");
eq((await anonAttack(pre.roomId)).readHands, "4家有手牌", "L0 套用前（正式站現況）：公開金鑰直接查 big2_players，讀得到四家手牌");

// ═══ 套用 migration ═══
await run(MIG);
const after1 = await perms();
eq([after1.policies.length, after1.grants.some((g) => ["anon", "authenticated", "-"].includes(String(g.grantee))), after1.rls.map((x) => x.relrowsecurity)],
  [0, false, [true, true]], "L1 套用後：兩張表沒有 policy、anon／authenticated／PUBLIC 沒有任何權限、RLS 開著");
eq(await anonAttack(pre.roomId),
  { readHands: "擋下:42501", readRoom: "擋下:42501", update: "擋下:42501", insertRoom: "擋下:42501", insertPlayer: "擋下:42501", delete: "擋下:42501" },
  "L1 公開金鑰（anon）：讀手牌、讀房間、改牌局、開房、塞座位、刪座位全部被擋");
eq(await asRole("authenticated"), ["擋下:42501", "擋下:42501", "擋下:42501", "擋下:42501", "擋下:42501"],
  "L1 登入後的金鑰（authenticated）一樣讀寫不了");
eq((await db.query(`select count(*)::int as n from big2_players where room_id = $1`, [pre.roomId])).rows[0], { n: 4 }, "L1 套用前開好的房間資料原封不動（service role 看得到 4 個座位）");

// ═══ L2 套用後一般流程（真路由＋真 store，service role）═══
// 中途丟錯（例如舊程式用公開金鑰、建房就失敗）記成 ❌，不讓整支當掉
const l2 = async (fn: () => Promise<void>) => { try { await fn(); } catch (e) { results.push(`❌ L2 流程中斷：${(e as Error).message}`); } };
await l2(async () => {
  const r = await startedRoom("g1");
  eq(r.steps, { create: 200, joins: [200, 200, 200, 200], readyCheck: 200, ready: [200, 200, 200] }, "L2 開房、四家入座、房主按開始、三家同意都成功");
  const room = await roomRow(r.roomId);
  eq([room.status, await handCounts(r)], ["playing", [13, 13, 13, 13]], "L2 第一局：發牌開局，四家帶自己的憑證各拿到 13 張");
  eq(((await getState(r.roomId, r.ps[1])).body.myHand as unknown[]).length, 0, "L2 讀狀態沒帶憑證還是拿不到手牌（手牌修正照常）");

  // 出牌：輪到的人手上只剩梅花 3（測試直接改存檔，讓一手就打完），出掉就結束
  const starter = r.ps[room.current_turn];
  await db.query(`update big2_players set hand = '["3C"]', card_count = 1 where room_id = $1 and seat = $2`, [r.roomId, room.current_turn]);
  const p1 = await post(play, "/api/game/play", { roomId: r.roomId, playerId: starter, seatKey: r.keys[starter], cards: ["3C"] });
  eq([p1.status, p1.body.gameOver, (await roomRow(r.roomId)).status], [200, true, "finished"], "L2 出牌：輪到的人打出最後一張，這局結束（finished）");

  // 下一局：四家按繼續 → 重新發牌
  const cs: number[] = [];
  for (const p of r.ps) cs.push((await post(cont, "/api/game/continue", { roomId: r.roomId, playerId: p, seatKey: r.keys[p] })).status);
  const room2 = await roomRow(r.roomId);
  eq([cs, room2.status, await handCounts(r)], [[200, 200, 200, 200], "playing", [13, 13, 13, 13]], "L2 下一局：四家按繼續後重新發牌，各拿到新的 13 張");
  const scores = (await db.query<{ scores: Record<string, number> }>(`select scores from big2_rooms where id = $1`, [r.roomId])).rows[0].scores;
  eq(Object.keys(scores).length, 4, "L2 下一局：上一局的分數有記進房間");

  // 第二局：輪到的人出一張（有梅花 3 就出梅花 3），下一家過
  const s2 = r.ps[room2.current_turn];
  const h2 = (await getState(r.roomId, s2, r.keys[s2])).body.myHand as string[];
  const card = h2.includes("3C") ? "3C" : h2[0];
  const p2 = await post(play, "/api/game/play", { roomId: r.roomId, playerId: s2, seatKey: r.keys[s2], cards: [card] });
  const nextP = r.ps[(await roomRow(r.roomId)).current_turn];
  const ps2 = await post(pass, "/api/game/pass", { roomId: r.roomId, playerId: nextP, seatKey: r.keys[nextP] });
  const left = (await db.query<{ card_count: number }>(`select card_count from big2_players where room_id = $1 and player_id = $2`, [r.roomId, s2])).rows[0].card_count;
  eq([p2.status, ps2.status, left], [200, 200, 12], "L2 第二局：出一張、下一家過都成功，存檔剩 12 張");
});
await l2(async () => {
  // 等人階段退出
  const c = await post(create, "/api/game/create", { hostId: "h-lv" });
  const { code, roomId } = c.body as { code: string; roomId: string };
  await post(join, "/api/game/join", { code, playerId: "h-lv", name: "H" });
  await post(join, "/api/game/join", { code, playerId: "g-lv", name: "G" });
  const lv = await post(leave, "/api/game/leave", { roomId, playerId: "g-lv" });
  const n = (await db.query<{ n: number }>(`select count(*)::int as n from big2_players where room_id = $1`, [roomId])).rows[0].n;
  eq([lv.status, n], [200, 1], "L2 等人階段退出：成功，座位剩 1 個");
});

// ═══ L3 回滾 ═══
await run(RB);
eq(await perms(), before, "L3 回滾：policy、資料表與欄位權限（含 grantor）、RLS 和套用前一字不差");
eq((await anonAttack(pre.roomId)).readHands, "4家有手牌", "L3 回滾後公開金鑰又讀得到（確認回滾真的把權限還回去）");
await run(MIG);
eq(await perms(), after1, "L3 回滾後再套一次：和第一次套用後一樣（備份沒被蓋掉）");
await run(RB);
eq(await perms(), before, "L3 第二次回滾一樣回到套用前");

console.log(results.join("\n"));
if (results.some((x) => x.startsWith("❌"))) process.exit(1);
