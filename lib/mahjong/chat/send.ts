// 把一則聊天或語音送給同桌每個人和觀戰者：
//   ・同桌四人：各自的座位頻道（mj_chat 是私人事件），發送者自己也會收到一份（含伺服器給的 id）
//   ・觀戰者：每位已同意觀戰的人各自的觀戰頻道（綁這一場＋帳號，見 access.ts spectatorChannelName）
// 知道房號的外人訂閱公開頻道 mj-<房號> 收不到。訊息格式見 lib/social/events.ts。
import { randomUUID } from "node:crypto";
import { SPECTATORS, spectatorChannelName } from "@/lib/mahjong/access";
import { loadRoomSpectate } from "@/lib/mahjong/spectate/store";
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

/** 這房目前「已同意觀戰」的帳號（同一人同意了好幾家只算一次）；每次送都重新查，收回同意的下一則就不送 */
export async function approvedSpectators(roomId: string): Promise<string[]> {
  return [...new Set((await loadRoomSpectate(roomId)).filter((r) => r.status === "approved").map((r) => r.spectatorId))];
}

/** 同桌四人的座位頻道各一份＋每位已同意觀戰者自己的觀戰頻道各一份 */
export function socialEvents(
  roomCode: string, roomId: string, members: Member[], spectators: string[],
  event: string, body: Record<string, unknown>,
): { event: string; payload: Record<string, unknown>; channel?: string }[] {
  return [
    ...members.map((m) => ({ event, payload: { playerId: m.playerId, ...body } })),
    ...spectators.map((u) => ({ event, payload: { playerId: SPECTATORS, ...body }, channel: spectatorChannelName(roomCode, roomId, u) })),
  ];
}

export async function broadcastMessage(roomCode: string, roomId: string, members: Member[], spectators: string[], message: ChatMessage): Promise<void> {
  await mjBroadcastBatch(roomCode, socialEvents(roomCode, roomId, members, spectators, "mj_chat", { message }));
}
