// 把一則聊天或語音送給同桌每個人：走每個座位的專屬頻道（mj_chat 是私人事件），
// 知道房號的外人訂閱公開頻道 mj-<房號> 也收不到。發送者自己也會收到一份（含伺服器給的 id）。
import { randomUUID } from "node:crypto";
import { mjBroadcastBatch } from "@/lib/mahjong/broadcast";
import type { Member } from "@/lib/mahjong/effects/members";
import type { PhraseId } from "./rules";

export interface ChatMessage {
  id: string;
  kind: "text" | "voice";
  from: string; // 發送者 playerId（伺服器認的）
  fromName: string;
  fromSeat: number;
  text?: string; // 文字（快捷短語也是放這裡，另外帶 phrase）
  phrase?: PhraseId;
  url?: string; // 語音：1 小時有效的播放網址
  durationMs?: number;
  ts: number;
}

export async function sendToTable(
  roomCode: string,
  members: Member[],
  from: Member,
  body: Pick<ChatMessage, "kind" | "text" | "phrase" | "url" | "durationMs"> & { id?: string }
): Promise<ChatMessage> {
  const full: ChatMessage = {
    id: body.id ?? randomUUID(),
    kind: body.kind,
    from: from.playerId, fromName: from.name, fromSeat: from.seat,
    ...(body.text !== undefined && { text: body.text }),
    ...(body.phrase !== undefined && { phrase: body.phrase }),
    ...(body.url !== undefined && { url: body.url, durationMs: body.durationMs }),
    ts: Date.now(),
  };
  await mjBroadcastBatch(roomCode, members.map((m) => ({ event: "mj_chat", payload: { playerId: m.playerId, message: full } })));
  return full;
}
