// 遊戲內文字聊天：POST { roomId, text } 或 { roomId, phrase: "nice"|"wait"|"hurry"|"thanks" }（快捷短語）
// 只有同一桌、LINE 登入的玩家能送；訪客 403 guest_not_allowed（照樣收得到別人的訊息）。
// 發送者由登入帳號認定，名字、座位都用伺服器的；不過濾髒話；發太快 429（retryAfterMs）。
// 確認後走同桌四人各自的座位頻道和觀戰頻道廣播 mj_chat（公開頻道 mj-<房號> 收不到）。
// 2026-11-13 起存進這房的聊天紀錄（最多最近 CHAT_HISTORY_LIMIT 則，關房就刪）；冷卻檢查和存檔是同一次資料庫呼叫。
// 觀戰者不在這桌 → 403 not_in_room（只能讀，不能發言）。房間在送出當下已經關掉 → 410 room_closed（什麼都不存、不送）。
import { fail, resolveMember } from "@/lib/mahjong/effects/members";
import { cleanText, isPhrase, PHRASES } from "@/lib/mahjong/chat/rules";
import { approvedSpectators, broadcastMessage, buildMessage } from "@/lib/mahjong/chat/send";
import { postText, ROOM_CLOSED } from "@/lib/mahjong/chat/store";

export async function POST(request: Request) {
  try {
    return await handle(request);
  } catch (err) {
    console.error("[mj-chat]", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}

async function handle(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 2000) return fail(413, "too_large");
    body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
  } catch {
    return fail(400, "bad_request");
  }

  const who = await resolveMember(request, body.roomId, body.playerId);
  if (who instanceof Response) return who;
  const { roomCode, roomId, me, members, user } = who;
  if (user.isGuest) return fail(403, "guest_not_allowed");

  let text: string;
  let phrase: keyof typeof PHRASES | undefined;
  if (body.phrase !== undefined) {
    if (body.text !== undefined || !isPhrase(body.phrase)) return fail(400, "unknown_phrase");
    phrase = body.phrase;
    text = PHRASES[phrase];
  } else {
    const t = cleanText(body.text);
    if ("error" in t) return fail(400, t.error);
    text = t.text;
  }

  const message = buildMessage(me, { kind: "text", text, ...(phrase && { phrase }) });
  // 存檔（含冷卻）和查觀戰者同時送，不多等
  const [wait, spectators] = await Promise.all([postText(roomId, user.id, message), approvedSpectators(roomId)]);
  if (wait === ROOM_CLOSED) return fail(410, "room_closed");
  if (wait > 0) return fail(429, "rate_limited", { retryAfterMs: wait, retryAfterSec: Math.ceil(wait / 1000) });
  await broadcastMessage(roomCode, roomId, members, spectators, message);
  return Response.json({ ok: true, message });
}
