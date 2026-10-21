// 回滾 20261023_mahjong_chat.sql 的第一步：清空並刪掉語音 bucket mj-voice（Supabase 不允許用 SQL 刪 storage，只能走 Storage API）。
//
// 先列出（不改任何東西）：
//   node --env-file=<要清的那個環境的變數檔> --import ./scripts/ts-register.mjs scripts/mj-voice-purge.ts
//   ⚠️ .env.local 指向開發用的專案；清正式庫要用正式環境的變數（例如 vercel env pull --environment=production 下來的檔）。
//   腳本會先印出要清的 Supabase 專案網址，確認是對的再加 --yes。
// 確認後執行：
//   同上再加 --yes
// 會刪掉 mj-voice 裡所有語音檔（全部資料夾、自動翻頁；語音本來就是暫存的，房間關閉就會刪），再刪掉 bucket 本身。
// 可以重跑：bucket 不在就什麼都不做。任何一步出錯（列出、刪檔、刪 bucket、查 bucket）就停下來、結束碼 1，不會當成已清完。
import { getSupabaseAdmin } from "../lib/supabase-admin";
import { inventory, purgeAll, type VoiceBucket } from "../lib/mahjong/chat/storage-ops";

const BUCKET = "mj-voice";
const execute = process.argv.includes("--yes");
const storage = getSupabaseAdmin().storage;
const bucket = storage.from(BUCKET) as unknown as VoiceBucket; // 資料夾的 id 實際上是 null，見 storage-ops

console.log(`目標專案：${process.env.NEXT_PUBLIC_SUPABASE_URL ?? "（沒設定 NEXT_PUBLIC_SUPABASE_URL）"}`);
try {
  const got = await storage.getBucket(BUCKET);
  if (got.error) {
    // 只有「確定不存在」才當成不用清；權限、網路、金鑰錯誤一律停下來
    const status = (got.error as { status?: number; statusCode?: string }).status ?? Number((got.error as { statusCode?: string }).statusCode);
    if (status === 404 || /not found/i.test(got.error.message)) {
      console.log(`bucket ${BUCKET} 不存在，不用清。接著跑 supabase/migrations/20261023_mahjong_chat_rollback.sql`);
      process.exit(0);
    }
    throw new Error(`查詢 bucket 失敗：${got.error.message}`);
  }
  const inv = await inventory(bucket);
  console.log(`bucket ${BUCKET}：${inv.folders} 個房間資料夾、共 ${inv.files} 個檔案`);
  if (!execute) {
    console.log("（只列出，沒有改任何東西。確認後加 --yes 執行）");
    process.exit(0);
  }
  const removed = await purgeAll(bucket);
  const left = await inventory(bucket);
  if (left.files > 0) throw new Error(`刪完還剩 ${left.files} 個檔案（可能有人同時在傳語音），請確認沒人在打牌後重跑`);
  const del = await storage.deleteBucket(BUCKET);
  if (del.error) throw new Error(`刪除 bucket 失敗：${del.error.message}`);
  console.log(`已刪除 ${removed} 個檔案和 bucket ${BUCKET}。接著跑 supabase/migrations/20261023_mahjong_chat_rollback.sql`);
} catch (err) {
  console.error("清除失敗，bucket 沒有刪：", err instanceof Error ? err.message : err);
  process.exit(1);
}
