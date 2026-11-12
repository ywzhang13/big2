// 核彈（nuke，專屬 jeff 門清一摸三，老闆 2026-11-10；20261110_mahjong_fx_nuke.sql），走真的 API 和 migration（PGlite）。
// 和如來神掌（rulai）同一條「專屬特效」的路，差別是擁有者不是老闆——所以這支特別驗「老闆自己也選不到」。
//   K1 GET：只有被指定的那個帳號帶 ownerFx=[nuke]、available 有 nuke（永久）；老闆的 ownerFx 只有 rulai、沒有 nuke；
//      永久開通的玩家和沒開通的玩家都沒有 ownerFx；遊客 403、沒登入 401
//   K2 POST：那個帳號選 nuke 成功並寫 1 筆操作紀錄；老闆選 nuke 403 not_granted（他有 rulai 也不行）；
//      永久開通的玩家 403；被拒的都不會改到原本的選用、沒有操作紀錄
//   K3 不能開通：開通全部只有 6 種、不含 nuke；後台指定 nuke 400；資料庫直接寫開通被檢查限制擋下
//   K4 牌局：那個帳號自摸用 nuke（永久，until=null）；別人的列就算被直接寫成 nuke 也回金色
//   K5 回滾：選了 nuke 的改回金色並留 system 紀錄（標 rollback），rulai 的選用和開通完全不變；再套一次又能選
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GET as fxGet, POST as fxPost } from "../../app/api/mahjong/admin/fx/route";
import { GET as myGet, POST as mySet } from "../../app/api/mahjong/zimo-fx/route";
import { applyZimoFx, prefetchZimoFx } from "../../lib/mahjong/zimoFx/attach";
import { EXCLUSIVE_FX, OWNER_USER_ID } from "../../lib/mahjong/zimoFx/rules";
import { tokens } from "../support/stub-auth";
import { addUser } from "../support/stub-donate-store";
import { clock, db, users } from "../support/stub-zimofx-store";
import type { MahjongGameState } from "../../lib/mahjong/gameState";

const MIG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations");
const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
/** 核彈的擁有者就讀對應表，不在測試裡再抄一次帳號 id（換人只改 rules.ts） */
const JEFF = EXCLUSIVE_FX.nuke!;
const BOSS = OWNER_USER_ID;
const id = (n: number) => `ad000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const [A, B] = [1, 2].map(id);
tokens.boss = { id: BOSS, displayName: "張育瑋", pictureUrl: null, isGuest: false };
tokens.jeff = { id: JEFF, displayName: "jeff 門清一摸三", pictureUrl: null, isGuest: false };
tokens.a = { id: A, displayName: "阿明", pictureUrl: null, isGuest: false };
tokens.b = { id: B, displayName: "阿華", pictureUrl: null, isGuest: false };
tokens.guest = { id: "uid-guest", displayName: null, pictureUrl: null, isGuest: true };
for (const [u, n] of [[BOSS, "張育瑋"], [JEFF, "jeff 門清一摸三"], [A, "阿明"], [B, "阿華"]]) { users[u] = { name: n, avatarUrl: null }; await addUser(u); }
const d = await db();
clock.now = Date.parse("2026-11-10T12:00:00+08:00");
const auth = (tok?: string): Record<string, string> => (tok ? { authorization: `Bearer ${tok}` } : {});
const get = async (fn: (r: Request) => Promise<Response>, url: string, tok?: string) => { const r = await fn(new Request("http://x" + url, { headers: auth(tok) })); return { status: r.status, body: await r.json() }; };
const post = async (fn: (r: Request) => Promise<Response>, body: object, tok?: string) => { const r = await fn(new Request("http://x", { method: "POST", headers: { "content-type": "application/json", ...auth(tok) }, body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };
const pref = async (u: string) => (await d.query<{ fx: string }>("select fx from mj_fx_prefs where user_id = $1", [u])).rows[0]?.fx ?? null;
const auditN = async (u: string) => Number((await d.query<{ n: number }>("select count(*)::int n from mj_fx_audit where target_user_id = $1 and action = 'fx_select'", [u])).rows[0].n);
const SIX = { meteor: null, thunder: null, storm: null, frost: null, blackhole: null, sakura: null };

// ---- 先讓 A 永久開通並選風暴、老闆選如來神掌；B 什麼都沒開 ----
await post(fxPost, { userId: A }, "boss");
await post(mySet, { fx: "storm" }, "a");
await post(mySet, { fx: "rulai" }, "boss");

// ---- K1 GET ----
{
  const [jeff, boss, a, b, g, none] = [await get(myGet, "/", "jeff"), await get(myGet, "/", "boss"), await get(myGet, "/", "a"), await get(myGet, "/", "b"), await get(myGet, "/", "guest"), await get(myGet, "/")];
  eq([jeff.body.ownerFx, jeff.body.available, jeff.body.isOwner, boss.body.ownerFx, "nuke" in boss.body.available, "ownerFx" in a.body, "nuke" in a.body.available, "ownerFx" in b.body, b.body.available, g.status, none.status],
    [["nuke"], { golden: null, nuke: null }, false, ["rulai"], false, false, false, false, { golden: null }, 403, 401],
    "K1 GET：jeff 的回應帶 ownerFx=[nuke]、available 只有金色＋核彈（永久）且不是老闆；老闆的 ownerFx 只有 rulai、沒有核彈；永久開通的玩家和沒開通的玩家都沒有 ownerFx、沒有核彈；遊客 403、沒登入 401");
}

// ---- K2 POST ----
{
  const [auditJeff, auditBoss, auditA] = [await auditN(JEFF), await auditN(BOSS), await auditN(A)];
  const set = await post(mySet, { fx: "nuke" }, "jeff");
  const mine = await get(myGet, "/", "jeff");
  const admin = await get(fxGet, `/?userId=${JEFF}`, "boss");
  eq([set.status, set.body, await pref(JEFF), await auditN(JEFF) - auditJeff, mine.body.selected, admin.body.selected],
    [200, { selected: "nuke" }, "nuke", 1, "nuke", "nuke"],
    "K2 jeff 選核彈成功、寫 1 筆操作紀錄；玩家 API 和後台都讀到 nuke（不會被打回金色）");
  const [boss, a] = [await post(mySet, { fx: "nuke" }, "boss"), await post(mySet, { fx: "nuke" }, "a")];
  eq([boss.status, boss.body.error, boss.body.selected, await pref(BOSS), await auditN(BOSS) - auditBoss, a.status, a.body.error, a.body.selected, await pref(A), await auditN(A) - auditA],
    [403, "not_granted", "rulai", "rulai", 0, 403, "not_granted", "storm", "storm", 0],
    "K2 老闆選核彈 403 not_granted（他只有神掌）、永久開通的玩家也 403：都回目前實際的選用，資料庫沒變、沒有操作紀錄");
}

// ---- K3 不能開通 ----
{
  const fxOf = async (u: string) => (await d.query<{ fx: string }>("select distinct fx from mj_fx_grants where user_id = $1 order by fx", [u])).rows.map((r) => r.fx);
  const g = await post(fxPost, { userId: B }, "boss");
  const [act, list] = [await post(fxPost, { userId: B, active: "nuke" }, "boss"), await post(fxPost, { userId: B, fx: ["nuke"], active: "nuke" }, "boss")];
  let direct = "沒擋";
  try { await d.exec(`insert into mj_fx_grants (user_id, fx, granted_by, granted_at, expires_at) values ('${B}', 'nuke', 'x', now(), 'infinity')`); } catch { direct = "擋下"; }
  eq([g.body.granted, await fxOf(B), act.status, list.status, direct, (await get(fxGet, `/?userId=${B}`, "boss")).body.active],
    [6, ["blackhole", "frost", "meteor", "sakura", "storm", "thunder"], 400, 400, "擋下", SIX],
    "K3 開通全部只有 6 種、不含核彈；後台指定核彈 400；資料庫直接寫開通被檢查限制擋下");
}

// ---- K4 牌局 ----
{
  await d.query("insert into mj_fx_prefs (user_id, fx, updated_at) values ($1, 'nuke', now()) on conflict (user_id) do update set fx = 'nuke'", [B]);
  const st = { players: [{ userId: JEFF }, { userId: B }, { userId: BOSS }] } as unknown as MahjongGameState;
  applyZimoFx(st, await prefetchZimoFx(st));
  eq([st.players[0].zimoFx, st.players[1].zimoFx, st.players[2].zimoFx, (await get(myGet, "/", "b")).body.selected],
    [{ code: "nuke", until: null }, { code: "golden", until: null }, { code: "rulai", until: null }, "golden"],
    "K4 牌局：jeff 是核彈（永久）；B 的列被直接寫成 nuke 也回金色（API 和牌局都是）；老闆照舊是神掌");
  await d.query("delete from mj_fx_prefs where user_id = $1", [B]);
}

// ---- K5 回滾 ----
{
  const others = async () => JSON.stringify([
    (await d.query("select user_id, fx from mj_fx_prefs where user_id <> $1 order by user_id", [JEFF])).rows,
    (await d.query("select id, user_id, fx, expires_at, revoked_at from mj_fx_grants order by id")).rows]);
  const before = await others();
  const auditJeff = await auditN(JEFF);
  await d.exec(readFileSync(path.join(MIG, "20261110_mahjong_fx_nuke_rollback.sql"), "utf8"));
  const row = (await d.query<{ actor_id: string; detail: { fx: string; from: string; rollback: boolean } }>("select actor_id, detail from mj_fx_audit where target_user_id = $1 and action = 'fx_select' order by id desc limit 1", [JEFF])).rows[0];
  let direct = "沒擋";
  try { await d.exec(`insert into mj_fx_prefs (user_id, fx, updated_at) values ('${B}', 'nuke', now())`); } catch { direct = "擋下"; }
  eq([await pref(JEFF), await auditN(JEFF) - auditJeff, row.actor_id, row.detail, direct, await pref(BOSS), await others() === before],
    ["golden", 1, "system", { fx: "golden", from: "nuke", rollback: true }, "擋下", "rulai", true],
    "K5 回滾：選了核彈的改回金色、留 1 筆 system 操作紀錄（標 rollback）；檢查限制收回（直接寫 nuke 被擋）；老闆的神掌和所有人的開通完全不變");
  await d.exec(readFileSync(path.join(MIG, "20261110_mahjong_fx_nuke.sql"), "utf8"));
  const again = await post(mySet, { fx: "nuke" }, "jeff");
  eq([again.status, await pref(JEFF), await pref(BOSS), await pref(A)], [200, "nuke", "rulai", "storm"], "K5 再套一次 migration：jeff 又能選核彈；老闆和其他人的選用不變");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
