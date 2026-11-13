// 聊天紀錄的存放格式（純函式，正式 store 和測試 stub 共用）。
// 存進 mj_chat_messages 的是 ChatMessage，但語音不存播放網址（網址 1 小時就過期），改存檔案路徑 voiceKey，
// 讀歷史時再重新簽發網址；檔案已經清掉（超過 24 小時）就給 null。
import type { ChatMessage } from "@/lib/social/events";

export type StoredMessage = Omit<ChatMessage, "url"> & { voiceKey?: string };

export const voiceKeyOf = (roomId: string, voiceId: string) => `${roomId}/${voiceId}.m4a`;

export function toStored(msg: ChatMessage, voiceKey?: string): StoredMessage {
  const { url: _url, ...rest } = msg;
  void _url;
  return msg.kind === "voice" && voiceKey ? { ...rest, voiceKey } : rest;
}

export function fromStored(s: StoredMessage, urlOf: (key: string) => string | null): ChatMessage {
  const { voiceKey, ...rest } = s;
  return s.kind === "voice" ? { ...rest, url: voiceKey ? urlOf(voiceKey) : null } : rest;
}
