// 十三支文字聊天：POST { roomId, playerId?, text } 或 { roomId, phrase }。規則和麻將 /api/mahjong/chat 一樣：
//   ・只有這一桌、LINE 登入的玩家能送（訪客 403 guest_not_allowed）；發送者、名字、座位都用伺服器的；發太快 429
//   ・送到同桌四人各自的座位頻道（事件 mj_chat，格式見 lib/social/events.ts）＋已同意觀戰者各自的觀戰頻道；公開頻道 th-<房號> 收不到
//   ・不在這桌（含觀戰者）403 not_in_room；送出當下房間剛好關掉 410 room_closed；房間不在 404
import { getAuthUser } from "@/lib/auth";
import { cleanText, isPhrase, PHRASES } from "@/lib/mahjong/chat/rules";
import { approvedSpectators, buildMessage } from "@/lib/mahjong/chat/send";
import { postThirteenText, ROOM_CLOSED } from "@/lib/thirteen/chat";
import { chatMembers, fail, json, sendChat } from "@/lib/thirteen/server";

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length > 2000) return fail(413, "too_large");
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(); } catch { return fail(400, "bad_request"); }
    const user = await getAuthUser(request);
    if (!user) return fail(401, "not_logged_in");
    const room = await chatMembers(body.roomId);
    if (room instanceof Response) return room;
    const me = room.members.find((m) => m.userId && m.userId === user.id);
    if (!me) return fail(403, "not_in_room");
    if (body.playerId !== undefined && body.playerId !== me.playerId) return fail(403, "not_your_seat");
    if (user.isGuest) return fail(403, "guest_not_allowed");
    let text: string, phrase: keyof typeof PHRASES | undefined;
    if (body.phrase !== undefined) {
      if (body.text !== undefined || !isPhrase(body.phrase)) return fail(400, "unknown_phrase");
      phrase = body.phrase; text = PHRASES[phrase];
    } else {
      const t = cleanText(body.text);
      if ("error" in t) return fail(400, t.error);
      text = t.text;
    }
    const message = buildMessage(me, { kind: "text", text, ...(phrase && { phrase }) });
    const [wait, spectators] = await Promise.all([postThirteenText(room.id, user.id, message), approvedSpectators(room.id)]);
    if (wait === ROOM_CLOSED) return fail(410, "room_closed");
    if (wait > 0) return fail(429, "rate_limited", undefined, { retryAfterMs: wait, retryAfterSec: Math.ceil(wait / 1000) });
    await sendChat(room, spectators, message);
    return json({ ok: true, message });
  } catch (err) {
    console.error("[th-chat]", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}
