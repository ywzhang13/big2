// 聊天、語音的資料庫／Storage 存取（只在伺服器用 service role）。
// 測試時整個檔案會被換成 tests/support/stub-chat-store.ts（冷卻照樣跑真的 SQL 函式，Storage 用記憶體模擬）。
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { existingRoomIds } from "@/lib/mahjong/db";
import { CHAT_HISTORY_LIMIT, RATE, VOICE_MAX_AGE_MS, VOICE_URL_TTL_S, type ChatKind } from "./rules";
import { fromStored, toStored, voiceKeyOf, type StoredMessage } from "./history";
import type { ChatMessage } from "@/lib/social/events";
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
  const key = voiceKeyOf(roomId, voiceId);
  const up = await bucket.upload(key, data, { contentType: "audio/mp4", upsert: false });
  if (up.error) throw new Error(`上傳語音失敗：${up.error.message}`);
  const signed = await bucket.createSignedUrl(key, VOICE_URL_TTL_S);
  if (signed.error || !signed.data) throw new Error(`簽發語音網址失敗：${signed.error?.message}`);
  return signed.data.signedUrl;
}

// supabase-js 的 FileObject 型別把 id 寫成 string，實際上資料夾的 id 是 null，所以轉成 storage-ops 的介面
const voiceBucket = (): VoiceBucket => getSupabaseAdmin().storage.from(VOICE_BUCKET) as unknown as VoiceBucket;

/** postText 回傳：房間已經關掉（mj_rooms 沒有這一列），什麼都沒寫 */
export const ROOM_CLOSED = -1;

/**
 * 文字聊天：檢查冷卻、記下、存進這房的聊天紀錄，一次資料庫呼叫完成（mj_chat_post）。
 * 回 0＝已存，可以廣播；> 0＝冷卻中還要等幾毫秒（什麼都沒寫）；ROOM_CLOSED＝房間已關（什麼都沒寫）
 */
export async function postText(roomId: string, userId: string, message: ChatMessage): Promise<number> {
  const r = RATE.text;
  const { data, error } = await getSupabaseAdmin().rpc("mj_chat_post", {
    p_room: roomId, p_user: userId, p_kind: "text",
    p_cooldown_ms: r.cooldownMs, p_burst_count: r.burstCount, p_burst_window_ms: r.burstWindowMs, p_burst_cooldown_ms: r.burstCooldownMs,
    p_msg: toStored(message), p_keep: CHAT_HISTORY_LIMIT,
  });
  if (error) throw new Error(`送出聊天失敗：${error.message}`);
  return Number(data) || 0;
}

/** 語音：冷卻已經扣過、檔案已經存好，把這則存進聊天紀錄（存檔案路徑，不存會過期的網址）。房間已關回 false、什麼都沒寫 */
export async function appendVoice(roomId: string, message: ChatMessage): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin().rpc("mj_chat_append", {
    p_room: roomId, p_msg: toStored(message, voiceKeyOf(roomId, message.id)), p_keep: CHAT_HISTORY_LIMIT,
  });
  if (error) throw new Error(`儲存語音紀錄失敗：${error.message}`);
  return data === true;
}

/** 這房保存的聊天（舊到新，最多 CHAT_HISTORY_LIMIT 則）；語音重新簽發播放網址，檔案不在就給 null */
export async function loadHistory(roomId: string): Promise<ChatMessage[]> {
  const { data, error } = await getSupabaseAdmin().rpc("mj_chat_history", { p_room: roomId });
  if (error) throw new Error(`讀取聊天紀錄失敗：${error.message}`);
  const rows = ((data ?? []) as { msg: StoredMessage }[]).map((r) => r.msg);
  const keys = rows.map((m) => m.voiceKey).filter((k): k is string => !!k);
  const urls = new Map<string, string | null>();
  if (keys.length > 0) {
    const signed = await getSupabaseAdmin().storage.from(VOICE_BUCKET).createSignedUrls(keys, VOICE_URL_TTL_S);
    if (signed.error) throw new Error(`簽發語音網址失敗：${signed.error.message}`);
    for (const x of signed.data ?? []) if (x.path) urls.set(x.path, x.error ? null : x.signedUrl);
  }
  return rows.map((m) => fromStored(m, (k) => urls.get(k) ?? null));
}

/** 房間關閉：刪掉這房的語音檔、冷卻紀錄和聊天紀錄。回傳刪掉幾個語音檔 */
export async function deleteRoomChat(roomId: string): Promise<number> {
  const removed = await removeFolder(voiceBucket(), roomId);
  const del = await getSupabaseAdmin().from("mj_chat_rate").delete().eq("room_id", roomId);
  if (del.error) throw new Error(`刪除聊天冷卻紀錄失敗：${del.error.message}`);
  const msgs = await getSupabaseAdmin().from("mj_chat_messages").delete().eq("room_id", roomId);
  if (msgs.error) throw new Error(`刪除聊天紀錄失敗：${msgs.error.message}`);
  return removed;
}

/**
 * 定期清除（關房時漏刪的保底）：房間已經不在的資料夾整個刪；房間還在的，刪超過 24 小時的檔。
 * 全部資料夾都會掃到（自動翻頁）。回傳刪掉幾個檔。
 */
export async function sweepVoices(nowMs = Date.now()): Promise<number> {
  return sweep(voiceBucket(), existingRoomIds, nowMs, VOICE_MAX_AGE_MS);
}
