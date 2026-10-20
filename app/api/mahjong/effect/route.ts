// 遊戲內互動特效：POST { roomId, effect: "heart"|"money"|"egg"|"water"|"punch", to: <同桌另一位的 playerId> }
// 只有同一桌的玩家能送；發送者由登入帳號認定，目標必須是同桌的另一位。
// 冷卻在伺服器擋（429）：發送者同組冷卻中 reason="cooldown"、目標在重組保護期 reason="target_protected"。
// 確認後走同桌四人各自的座位頻道廣播 mj_effect（公開頻道 mj-<房號> 收不到）。不入庫。
import { randomUUID } from "node:crypto";
import { mjBroadcastBatch } from "@/lib/mahjong/broadcast";
import { fail, resolveMember } from "@/lib/mahjong/effects/members";
import { EFFECT_GROUP, GROUP_COOLDOWN_MS, isEffect } from "@/lib/mahjong/effects/rules";
import { takeEffect } from "@/lib/mahjong/effects/store";

export async function POST(request: Request) {
  try {
    return await handle(request);
  } catch (err) {
    console.error("[mj-effect]", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}

async function handle(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 1000) return fail(413, "too_large");
    body = JSON.parse(raw);
    if (!body || typeof body !== "object") throw new Error();
  } catch {
    return fail(400, "bad_request");
  }

  const who = await resolveMember(request, body.roomId, body.playerId);
  if (who instanceof Response) return who;
  const { roomCode, roomId, me, members } = who;

  if (!isEffect(body.effect)) return fail(400, "unknown_effect");
  if (body.to === undefined || body.to === null) return fail(400, "target_required");
  const target = typeof body.to === "string" ? members.find((m) => m.playerId === body.to) : undefined;
  if (!target) return fail(400, "bad_target");
  if (target.playerId === me.playerId) return fail(400, "cannot_target_self");

  // 目標一定是同桌、已綁帳號的玩家；沒綁帳號（上線前的舊座位）沒辦法記保護期，當成不在桌
  if (!target.userId) return fail(400, "bad_target");
  const took = await takeEffect(roomId, me.userId!, target.userId, body.effect);
  if (!took.ok) {
    return fail(429, took.reason, { reason: took.reason, retryAfterMs: took.retryAfterMs, retryAfterSec: Math.ceil(took.retryAfterMs / 1000) });
  }

  const effect = {
    id: randomUUID(),
    effect: body.effect,
    from: me.playerId, fromName: me.name, fromSeat: me.seat,
    to: target.playerId, toName: target.name, toSeat: target.seat,
    ts: Date.now(),
  };
  await mjBroadcastBatch(roomCode, members.map((m) => ({ event: "mj_effect", payload: { playerId: m.playerId, effect } })));
  return Response.json({ ok: true, effect, cooldownMs: GROUP_COOLDOWN_MS[EFFECT_GROUP[body.effect]] });
}
