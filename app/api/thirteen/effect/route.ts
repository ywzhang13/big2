// 十三支互動道具：POST { roomId, effect: "heart"|"money"|"egg"|"water"|"punch"|"clap", to: <同桌另一位的 playerId> }（老柯 2026-11-20；
// 小宜〈十三支共用聊天互動 v1〉第 7 節）。照麻將 /api/mahjong/effect：
//   ・「這桌有誰」用十三支的 chatMembers；只有這一桌、LINE 登入的玩家能丟（沒登入 401、不在這桌含觀戰者 403 not_in_room、遊客 403 guest_not_allowed）
//   ・理牌中目標還沒送出 → 409 target_arranging（伺服器擋，不只靠前端不開選單）
//   ・冷卻表 mj_effect_take 直接共用（room_id 沒限定麻將房）：發送者同組冷卻中 429 cooldown、目標在重組保護期 429 target_protected（附 retryAfterMs）
//   ・成功 → 廣播 mj_effect 到同桌四人各自的座位頻道＋已同意觀戰者各自的觀戰頻道（和聊天一樣，公開頻道收不到）；回 { ok, effect, cooldownMs }。不入庫
//   ・「關閉互動」只記在收件人自己的分頁、不通知伺服器（設計如此），由前端收到時不播
import { randomUUID } from "node:crypto";
import { getAuthUser } from "@/lib/auth";
import { mjBroadcastBatch } from "@/lib/mahjong/broadcast";
import { SPECTATORS, spectatorChannelName } from "@/lib/mahjong/access";
import { approvedSpectators } from "@/lib/mahjong/chat/send";
import { EFFECT_GROUP, GROUP_COOLDOWN_MS, isEffect } from "@/lib/mahjong/effects/rules";
import { takeEffect } from "@/lib/mahjong/effects/store";
import { loadRoom } from "@/lib/thirteen/db";
import { chatMembers, fail, json, privateChannel } from "@/lib/thirteen/server";

export async function POST(request: Request) {
  try {
    return await handle(request);
  } catch (err) {
    console.error("[th-effect]", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}

async function handle(request: Request): Promise<Response> {
  const raw = await request.text();
  if (raw.length > 1000) return fail(413, "too_large");
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

  if (!isEffect(body.effect)) return fail(400, "unknown_effect");
  if (body.to === undefined || body.to === null) return fail(400, "target_required");
  const target = typeof body.to === "string" ? room.members.find((m) => m.playerId === body.to) : undefined;
  if (!target || !target.userId) return fail(400, "bad_target"); // 沒綁帳號的舊座位沒辦法記保護期，當成不在桌
  if (target.playerId === me.playerId) return fail(400, "cannot_target_self");

  // 理牌中：目標還沒送出三墩就不能丟（伺服器擋）
  const gs = (await loadRoom(room.id))?.game_state;
  if (gs?.phase === "arranging" && !gs.players?.find((p) => p.id === target.playerId)?.arrangement) {
    return fail(409, "target_arranging", undefined, { reason: "target_arranging" });
  }

  const took = await takeEffect(room.id, me.userId!, target.userId, body.effect);
  if (!took.ok) return fail(429, took.reason, undefined, { reason: took.reason, retryAfterMs: took.retryAfterMs, retryAfterSec: Math.ceil(took.retryAfterMs / 1000) });

  const effect = {
    id: randomUUID(),
    effect: body.effect,
    from: me.playerId, fromName: me.name, fromSeat: me.seat,
    to: target.playerId, toName: target.name, toSeat: target.seat,
    ts: Date.now(),
  };
  const spectators = await approvedSpectators(room.id);
  try {
    await mjBroadcastBatch(room.code, [
      ...room.members.map((m) => ({ event: "mj_effect", payload: { playerId: m.playerId, effect }, channel: privateChannel(room.id, room.code, m.playerId, m.userId) })),
      ...spectators.map((u) => ({ event: "mj_effect", payload: { playerId: SPECTATORS, effect }, channel: spectatorChannelName(room.code, room.id, u) })),
    ]);
  } catch (err) {
    console.error("[th-effect] 廣播失敗（冷卻已記，送的人照回應播）：", err instanceof Error ? err.message : err);
  }
  return json({ ok: true, effect, cooldownMs: GROUP_COOLDOWN_MS[EFFECT_GROUP[body.effect]] });
}
