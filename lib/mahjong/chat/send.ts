// 把一則聊天或語音送給同桌每個人和觀戰者：
//   ・同桌四人：各自的座位頻道（mj_chat 是私人事件），發送者自己也會收到一份（含伺服器給的 id）
//   ・觀戰者：這房的觀戰頻道（只有已同意觀戰的人拿得到頻道名稱，見 /api/mahjong/chat/history）
// 知道房號的外人訂閱公開頻道 mj-<房號> 收不到。訊息格式見 lib/social/events.ts。
import { randomUUID } from "node:crypto";
import { SPECTATORS } from "@/lib/mahjong/access";
import { mjBroadcastBatch } from "@/lib/mahjong/broadcast";
import type { Member } from "@/lib/mahjong/effects/members";
import type { ChatMessage } from "@/lib/social/events";

export type { ChatMessage } from "@/lib/social/events";

/** 組一則訊息（id、時間、發送者都由伺服器決定） */
export function buildMessage(
  from: Member,
  body: Pick<ChatMessage, "kind" | "text" | "phrase" | "url" | "durationMs"> & { id?: string },
  now: number = Date.now(),
): ChatMessage {
  return {
    id: body.id ?? randomUUID(),
    kind: body.kind,
    from: from.playerId, fromName: from.name, fromSeat: from.seat,
    ...(body.text !== undefined && { text: body.text }),
    ...(body.phrase !== undefined && { phrase: body.phrase }),
    ...(body.url !== undefined && { url: body.url, durationMs: body.durationMs }),
    ts: now,
  };
}

/** 廣播給同桌四人的座位頻道＋觀戰頻道 */
export async function broadcastMessage(roomCode: string, members: Member[], message: ChatMessage): Promise<void> {
  await mjBroadcastBatch(roomCode, [...members.map((m) => m.playerId), SPECTATORS].map((playerId) => ({ event: "mj_chat", payload: { playerId, message } })));
}
