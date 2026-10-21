// 聊天、語音的資料庫／Storage 存取（只在伺服器用 service role）。
// 測試時整個檔案會被換成 tests/support/stub-chat-store.ts（冷卻照樣跑真的 SQL 函式，Storage 用記憶體模擬）。
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { existingRoomIds } from "@/lib/mahjong/db";
import { RATE, VOICE_MAX_AGE_MS, VOICE_URL_TTL_S, type ChatKind } from "./rules";
import { removeFolder, sweep, type VoiceBucket } from "./storage-ops";

export const VOICE_BUCKET = "mj-voice";

/**
 * 檢查冷卻。回 0＝可以送，> 0＝還要等幾毫秒。
 * commit = true 且可以送時才記下這次；false 只檢查、什麼都不寫（語音轉檔前先擋洗版，轉檔成功才真的扣）。
 */
export async function checkRate(roomId: string, userId: string, kind: ChatKind, commit: boolean): Promise<number> {
  const r = RATE[kind];
  const { data, error } = await getSupabaseAdmin().rpc("mj_chat_take", {
    p_room_id: roomId,
    p_user_id: userId,
    p_kind: kind,
    p_cooldown_ms: r.cooldownMs,
    p_burst_count: r.burstCount,
    p_burst_window_ms: r.burstWindowMs,
    p_burst_cooldown_ms: r.burstCooldownMs,
    p_commit: commit,
  });
  if (error) throw new Error(`檢查聊天冷卻失敗：${error.message}`);
  return Number(data) || 0;
}

/** 存一則語音（已轉成 m4a），回傳 1 小時有效的播放網址。路徑 <roomId>/<voiceId>.m4a */
export async function saveVoice(roomId: string, voiceId: string, data: Buffer): Promise<string> {
  const bucket = getSupabaseAdmin().storage.from(VOICE_BUCKET);
  const key = `${roomId}/${voiceId}.m4a`;
  const up = await bucket.upload(key, data, { contentType: "audio/mp4", upsert: false });
  if (up.error) throw new Error(`上傳語音失敗：${up.error.message}`);
  const signed = await bucket.createSignedUrl(key, VOICE_URL_TTL_S);
  if (signed.error || !signed.data) throw new Error(`簽發語音網址失敗：${signed.error?.message}`);
  return signed.data.signedUrl;
}

// supabase-js 的 FileObject 型別把 id 寫成 string，實際上資料夾的 id 是 null，所以轉成 storage-ops 的介面
const voiceBucket = (): VoiceBucket => getSupabaseAdmin().storage.from(VOICE_BUCKET) as unknown as VoiceBucket;

/** 房間關閉：刪掉這房的語音檔和冷卻紀錄。回傳刪掉幾個語音檔 */
export async function deleteRoomChat(roomId: string): Promise<number> {
  const removed = await removeFolder(voiceBucket(), roomId);
  const del = await getSupabaseAdmin().from("mj_chat_rate").delete().eq("room_id", roomId);
  if (del.error) throw new Error(`刪除聊天冷卻紀錄失敗：${del.error.message}`);
  return removed;
}

/**
 * 定期清除（關房時漏刪的保底）：房間已經不在的資料夾整個刪；房間還在的，刪超過 24 小時的檔。
 * 全部資料夾都會掃到（自動翻頁）。回傳刪掉幾個檔。
 */
export async function sweepVoices(nowMs = Date.now()): Promise<number> {
  return sweep(voiceBucket(), existingRoomIds, nowMs, VOICE_MAX_AGE_MS);
}
