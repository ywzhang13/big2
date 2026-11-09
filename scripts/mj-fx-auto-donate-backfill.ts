// 試算「有斗內就自動開通特效」上線時要補開的名單（老闆 2026-11-09；20261109_mahjong_fx_auto_donate.sql）。
// 只讀，不寫任何資料庫：列出「有效斗內（未作廢）至少 1 筆、但目前沒有任何有效開通」的帳號，
//   和 20261109 migration 回填 mj_fx_auto_block 同一條規則（只看真人手動的 fx_grant／fx_revoke，最後一次是 fx_revoke 就算被擋著）判斷會不會被③擋下。
// 老闆帳號（OWNER_USER_ID）不列入。
//
// 跑法（只列出，不會寫入任何東西；沒有 --execute、本來就不執行補開）：
//   node --env-file=.env.local --import ./scripts/ts-register.mjs scripts/mj-fx-auto-donate-backfill.ts
//   ⚠️ 要列正式站的名單，env 檔要指向正式環境（例如 vercel env pull --environment=production 下來的檔）。
// 輸出：印到終端機，同時寫一份 .tmp/斗內自動開通-補開試算.md。不寫資料庫，可以重跑。
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
console.log(`\n已寫入 ${out}（只是試算，沒有寫入任何資料庫；確認名單後再決定要不要執行補開）`);
