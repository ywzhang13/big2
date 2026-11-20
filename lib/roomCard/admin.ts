// 房卡後台共用（老柯 2026-11-20）：只有老闆帳號能用（沿用斗內後台的 requireOwner：沒登入 401、其他人 403）。
// 被操作的帳號要是 LINE 帳號；老闆自己不扣卡、不在名單裡，所以不能操作（400 owner_exempt）。
import { fail } from "@/lib/mahjong/zimoFx/admin";
import { isOwner } from "@/lib/mahjong/zimoFx/rules";
import { isUuid } from "./rules";
import { lineUser, type LineUser } from "@/lib/roomCard/store";

export { fail, ok, readBody, requireOwner } from "@/lib/mahjong/zimoFx/admin";

/** 被操作的帳號：格式不對 400 bad_request、老闆 400 owner_exempt、不是 LINE 帳號（遊客、不存在）400 unknown_player */
export async function targetUser(userId: unknown): Promise<LineUser | Response> {
  if (!isUuid(userId)) return fail(400, "bad_request");
  if (isOwner(userId)) return fail(400, "owner_exempt");
  return (await lineUser(userId)) ?? fail(400, "unknown_player");
}
