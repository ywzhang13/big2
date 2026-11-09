// 試算／執行「有斗內就自動開通特效」上線時要補開的名單（老闆 2026-11-09；20261109_mahjong_fx_auto_donate.sql；
//   阿哲 2026-11-09 拍板：補開是獨立、要明確下指令才寫入的步驟，不放進 migration 自動套用）。
// 預設只讀，不寫任何資料庫：列出「有效斗內（未作廢）至少 1 筆、但目前沒有任何有效開通」的帳號，
//   和 20261109 migration 回填 mj_fx_auto_block 同一條規則（只看真人手動的 fx_grant／fx_revoke，最後一次是 fx_revoke 就算被擋著）判斷會不會被③擋下。
// 老闆帳號（OWNER_USER_ID）不列入。
//
// 跑法：
//   列出名單（只讀，不寫任何東西）：
//     node --env-file=.env.local --import ./scripts/ts-register.mjs scripts/mj-fx-auto-donate-backfill.ts
//   確認名單沒問題後執行補開（加 --apply）：
//     同上再加 --apply
//     對每個「會被補開」的帳號呼叫資料庫的 mj_fx_auto_sync（和玩家自己斗內時觸發的自動開通同一支函式、同一條規則），
//     由那支函式自己決定要不要開通——所以這裡的本地試算只是給老闆看的預覽，實際寫不寫以資料庫當下的狀態為準，
//     已經有開通、被③擋著的人 mj_fx_auto_sync 會自己跳過，不會因為試算算錯而多開。可以重跑：已經開通的人再跑一次不會多寫。
//   ⚠️ 要處理正式站，env 檔要指向正式環境（例如 vercel env pull --environment=production 下來的檔）。
// 輸出：印到終端機，同時寫一份 .tmp/斗內自動開通-補開試算.md（試算的名單，不是執行後的結果）。
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSupabaseAdmin } from "../lib/supabase-admin";
import { OWNER_USER_ID } from "../lib/mahjong/zimoFx/rules";

const sb = getSupabaseAdmin();

type Donation = { user_id: string; amount: number; voided_at: string | null };
type Grant = { user_id: string; revoked_at: string | null; expires_at: string };
type Audit = { target_user_id: string; action: string; actor_id: string; at: string };

/** 分頁讀完一張表（每頁 1000），人數一旦超過上限不能被截掉 */
async function listDonations(): Promise<Donation[]> {
  const out: Donation[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await sb.from("mj_donations").select("user_id, amount, voided_at").range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(`讀取 mj_donations 失敗：${error.message}`);
    out.push(...((data ?? []) as Donation[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}
async function listGrants(): Promise<Grant[]> {
  const out: Grant[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await sb.from("mj_fx_grants").select("user_id, revoked_at, expires_at").range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(`讀取 mj_fx_grants 失敗：${error.message}`);
    out.push(...((data ?? []) as Grant[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}
async function listAudit(): Promise<Audit[]> {
  const out: Audit[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await sb.from("mj_fx_audit").select("target_user_id, action, actor_id, at").in("action", ["fx_grant", "fx_revoke"]).range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(`讀取 mj_fx_audit 失敗：${error.message}`);
    out.push(...((data ?? []) as Audit[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

console.log(`目標專案：${process.env.NEXT_PUBLIC_SUPABASE_URL ?? "（沒設定 NEXT_PUBLIC_SUPABASE_URL）"}`);

const now = new Date();
const donations = await listDonations();
const grants = await listGrants();
const audits = await listAudit();

// 有效斗內（未作廢）依帳號加總筆數、金額
const valid = new Map<string, { count: number; amount: number }>();
for (const d of donations) {
  if (d.voided_at || d.user_id === OWNER_USER_ID) continue;
  const g = valid.get(d.user_id) ?? { count: 0, amount: 0 };
  g.count++; g.amount += Number(d.amount) || 0;
  valid.set(d.user_id, g);
}

// 目前有任何有效開通的帳號（不分系統／手動）
const hasActiveGrant = new Set<string>();
for (const g of grants) {
  if (g.revoked_at) continue;
  if (g.expires_at === "infinity" || new Date(g.expires_at).getTime() > now.getTime()) hasActiveGrant.add(g.user_id);
}

// 每個帳號最後一次「真人手動」的 fx_grant／fx_revoke，和 migration 的回填規則一樣（actor_id <> 'system' 才算）
const lastManual = new Map<string, { action: string; at: number }>();
for (const a of audits) {
  if (a.actor_id === "system") continue;
  const at = Date.parse(a.at);
  const cur = lastManual.get(a.target_user_id);
  if (!cur || at > cur.at) lastManual.set(a.target_user_id, { action: a.action, at });
}
const blocked = (userId: string) => lastManual.get(userId)?.action === "fx_revoke";

const candidates = [...valid.entries()].filter(([u]) => u !== OWNER_USER_ID).sort(([, a], [, b]) => b.amount - a.amount);

// 補名稱：auth.users（遊客、沒有名字的排除／用預設字）
const names = new Map<string, string>();
for (let page = 1; page <= 10; page++) {
  const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw new Error(`讀取玩家資料失敗：${error.message}`);
  for (const u of data.users) {
    const m = (u.user_metadata ?? {}) as Record<string, unknown>;
    const name = [m.name, m.full_name, m.nickname].find((v): v is string => typeof v === "string" && !!v);
    names.set(u.id, name ?? "LINE 使用者");
  }
  if (data.users.length < 1000) break;
}

const rows = candidates.map(([userId, v]) => {
  const willGrant = !hasActiveGrant.has(userId);
  const excluded = willGrant && blocked(userId);
  return { userId, name: names.get(userId) ?? `#${userId.slice(-4)}`, count: v.count, amount: v.amount, willGrant: willGrant && !excluded, excluded };
});
const toGrant = rows.filter((r) => r.willGrant);
const skippedActive = rows.filter((r) => !r.willGrant && !r.excluded);
const skippedBlocked = rows.filter((r) => r.excluded);

const lines: string[] = [];
lines.push("# 斗內自動開通上線時的補開試算（唯讀，沒有套用任何東西）");
lines.push("");
lines.push(`產出時間：${now.toISOString()}`);
lines.push("");
lines.push(`會被補開：${toGrant.length} 人；已經有開通不用補：${skippedActive.length} 人；老闆手動收回過、擋著不補：${skippedBlocked.length} 人`);
lines.push("");
lines.push("## 會被補開（有效斗內 ≥ 1 筆、目前沒有任何有效開通、沒有被③擋著）");
lines.push("");
lines.push("| 名稱 | 帳號末 4 碼 | 有效斗內筆數 | 有效斗內金額 | 為什麼符合 |");
lines.push("| --- | --- | --- | --- | --- |");
for (const r of toGrant) lines.push(`| ${r.name} | ${r.userId.slice(-4)} | ${r.count} | NT$${r.amount} | 有 ${r.count} 筆未作廢的斗內、目前沒有任何有效開通 |`);
lines.push("");
lines.push("## 有效斗內、但老闆手動收回過、③擋著不會補開（要老闆自己到後台重新開通）");
lines.push("");
lines.push("| 名稱 | 帳號末 4 碼 | 有效斗內筆數 | 有效斗內金額 |");
lines.push("| --- | --- | --- | --- |");
for (const r of skippedBlocked) lines.push(`| ${r.name} | ${r.userId.slice(-4)} | ${r.count} | NT$${r.amount} |`);
lines.push("");
lines.push("## 有效斗內、但已經有開通了，不用補開");
lines.push("");
lines.push(`${skippedActive.length} 人（略，不是這次要處理的對象）`);
lines.push("");

const md = lines.join("\n");
console.log(md);
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.tmp/斗內自動開通-補開試算.md");
writeFileSync(out, md, "utf8");
console.log(`\n已寫入 ${out}（這份是試算的名單，不是執行結果）`);

if (!process.argv.includes("--apply")) {
  console.log("\n（只列出，沒有寫入任何東西。確認名單後加 --apply 執行補開）");
  process.exit(0);
}

console.log(`\n--apply：開始對 ${candidates.length} 個有效斗內的帳號呼叫 mj_fx_auto_sync……`);
let granted = 0, skipped = 0;
for (const [userId] of candidates) {
  const { data, error } = await sb.rpc("mj_fx_auto_sync", { p_user: userId });
  if (error) throw new Error(`補開 ${userId} 失敗：${error.message}`);
  if ((data as { granted?: boolean } | null)?.granted) granted++; else skipped++;
}
console.log(`✅ 補開完成：${granted} 人新開通、${skipped} 人沒有變化（已經開通、被③擋著，或重跑時已經補過）`);
