// 測試用（老柯 2026-11-16，十三支 db 層）：攔下 supabase-js 送出的 PostgREST 請求，翻成 SQL 在記憶體 PostgreSQL（PGlite）執行。
// 目的：lib/thirteen/db.ts、lib/records/store.ts 的真程式碼（真的 supabase-js 組出來的請求）直接打在跑過真 migration 的資料庫上，
// 驗到資料表結構、限制、權限、trigger 和 close_room_with_record，而不是只驗一個假的記憶體版本。
// 只支援十三支 db 層用到的那一小部分：select／insert／update／delete、eq／neq／lt／is／in 篩選、order、limit、single／maybeSingle、rpc。
// 遇到不認得的參數直接丟錯（測試會變紅），不會默默當成沒篩選。每個請求都以 service_role 身分執行（和正式站伺服器一樣）。
import type { PGlite } from "@electric-sql/pglite";

const IDENT = /^[a-z_][a-z0-9_]*$/;
/** 欄位寫法 → SQL：id、game_state->>stateVersion、game_state->stateVersion */
function col(expr: string): string {
  const m = expr.match(/^([a-z_][a-z0-9_]*)((?:->>?[A-Za-z0-9_]+)*)$/);
  if (!m) throw new Error(`假 PostgREST：看不懂的欄位 ${expr}`);
  const path = [...m[2].matchAll(/(->>?)([A-Za-z0-9_]+)/g)].map(([, op, k]) => `${op}'${k}'`).join("");
  return `"${m[1]}"${path}`;
}
const toParam = (v: unknown) => (v !== null && typeof v === "object" ? JSON.stringify(v) : v);

export interface PostgrestLog { method: string; path: string }

/** 把 baseUrl 開頭的 fetch 導到 PGlite；回傳請求紀錄（測試可以看實際送了什麼）。
 *  anonKey：帶這把 apikey 的請求改用 anon 身分執行（模擬有人拿網站公開金鑰直接查資料庫；大老二鎖權限測試用，2026-11-27） */
export function installPostgrest(db: PGlite, baseUrl: string, opts: { anonKey?: string } = {}): PostgrestLog[] {
  const log: PostgrestLog[] = [];
  const realFetch = globalThis.fetch;
  let queue: Promise<unknown> = Promise.resolve();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (!url.href.startsWith(baseUrl)) return realFetch(input, init);
    const run = queue.then(() => handle(db, url, init ?? {}, log, opts.anonKey));
    queue = run.catch(() => {});
    return run;
  }) as typeof fetch;
  return log;
}

async function handle(db: PGlite, url: URL, init: RequestInit, log: PostgrestLog[], anonKey?: string): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  const path = url.pathname.replace(/^\/rest\/v1\//, "");
  log.push({ method, path: path + url.search });
  const body = init.body ? JSON.parse(String(init.body)) : undefined;
  const params: unknown[] = [];
  const p = (v: unknown) => (params.push(toParam(v)), `$${params.length}`);
  try {
    await db.exec(anonKey && headers.get("apikey") === anonKey ? "set role anon" : "set role service_role");
    let sql: string;
    if (path.startsWith("rpc/")) {
      const fn = path.slice(4);
      if (!IDENT.test(fn) || method !== "POST") throw new Error(`假 PostgREST：不支援的 rpc ${method} ${fn}`);
      const args = Object.entries(body ?? {}).map(([k, v]) => { if (!IDENT.test(k)) throw new Error(`參數名 ${k}`); return `${k} => ${p(v)}`; });
      // 回傳多列的函式（returns table／setof）PostgREST 回陣列；單一值的回那個值
      const set = (await db.query<{ s: boolean }>(`select bool_or(proretset) s from pg_proc where proname = $1`, [fn])).rows[0]?.s === true;
      if (set) return json(200, (await db.query(`select * from ${fn}(${args.join(", ")})`, params)).rows);
      const r = await db.query<{ r: unknown }>(`select ${fn}(${args.join(", ")}) as r`, params);
      return json(200, r.rows[0].r);
    }
    if (!IDENT.test(path)) throw new Error(`假 PostgREST：不支援的路徑 ${path}`);
    const table = `public."${path}"`;
    let select = "*", order = "", limit = "", onConflict: string[] | null = null;
    const where: string[] = [];
    for (const [k, v] of url.searchParams) {
      if (k === "select") select = v.split(",").map((c) => col(c.trim())).join(", ");
      else if (k === "order") order = " order by " + v.split(",").map((o) => { const [c, dir] = o.split("."); return `${col(c)} ${dir === "desc" ? "desc" : "asc"}`; }).join(", ");
      else if (k === "columns") continue;
      else if (k === "on_conflict") onConflict = v.split(",").map((c) => col(c.trim())); // upsert（大老二入座憑證用）
      else if (k === "limit") { if (!/^\d+$/.test(v)) throw new Error(`假 PostgREST：limit ${v}`); limit = ` limit ${v}`; }
      else {
        const m = v.match(/^(eq|neq|lt|is|in)\.([\s\S]*)$/);
        if (!m) throw new Error(`假 PostgREST：不支援的篩選 ${k}=${v}`);
        if (m[1] === "eq") where.push(`${col(k)} = ${p(m[2])}`);
        else if (m[1] === "neq") where.push(`${col(k)} <> ${p(m[2])}`);
        else if (m[1] === "lt") where.push(`${col(k)} < ${p(m[2])}`);
        else if (m[1] === "is" && m[2] === "null") where.push(`${col(k)} is null`);
        else if (m[1] === "in") { // 陣列直接當參數（toParam 會把陣列轉成 JSON 字串，Postgres 認不得）
          params.push(m[2].replace(/^\(|\)$/g, "").split(",").map((s) => s.replace(/^"|"$/g, "")));
          where.push(`${col(k)}::text = any($${params.length}::text[])`);
        }
        else throw new Error(`假 PostgREST：不支援的篩選 ${k}=${v}`);
      }
    }
    const cond = where.length ? ` where ${where.join(" and ")}` : "";
    const wantRows = (headers.get("Prefer") ?? "").includes("return=representation") || method === "GET";
    if (method === "GET") sql = `select ${select} from ${table}${cond}${order}${limit}`;
    else if (method === "POST") {
      const rows: Record<string, unknown>[] = Array.isArray(body) ? body : [body];
      const cols = Object.keys(rows[0]);
      if (!cols.every((c) => IDENT.test(c))) throw new Error("假 PostgREST：欄位名不合法");
      const values = rows.map((r) => `(${cols.map((c) => p(r[c])).join(", ")})`).join(", ");
      const upsert = onConflict
        ? ` on conflict (${onConflict.join(", ")}) do update set ${cols.filter((c) => !onConflict!.includes(`"${c}"`)).map((c) => `"${c}" = excluded."${c}"`).join(", ")}`
        : "";
      sql = `insert into ${table} (${cols.map((c) => `"${c}"`).join(", ")}) values ${values}${upsert}${wantRows ? ` returning ${select}` : ""}`;
    } else if (method === "PATCH") {
      const sets = Object.entries(body).map(([c, v]) => { if (!IDENT.test(c)) throw new Error("欄位名"); return `"${c}" = ${p(v)}`; });
      sql = `update ${table} set ${sets.join(", ")}${cond}${wantRows ? ` returning ${select}` : ""}`;
    } else if (method === "DELETE") {
      if (!where.length) throw new Error("假 PostgREST：DELETE 一定要有篩選條件");
      sql = `delete from ${table}${cond}${wantRows ? ` returning ${select}` : ""}`;
    } else throw new Error(`假 PostgREST：不支援的方法 ${method}`);
    const r = await db.query<Record<string, unknown>>(sql, params);
    if (!wantRows) return new Response(null, { status: 201 });
    if ((headers.get("Accept") ?? "").includes("vnd.pgrst.object")) {
      if (r.rows.length !== 1) return json(406, { code: "PGRST116", message: `JSON object requested, multiple (or no) rows returned (${r.rows.length})`, details: null, hint: null });
      return json(200, r.rows[0]);
    }
    return json(method === "POST" ? 201 : 200, r.rows);
  } catch (e) {
    const err = e as { code?: string; message: string };
    const status = err.code === "23505" ? 409 : err.code === "42501" ? 403 : 400;
    return json(status, { code: err.code ?? "TEST", message: err.message, details: null, hint: null });
  } finally {
    await db.exec("reset role");
  }
}

const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
