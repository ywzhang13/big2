// 誰在這一桌：伺服器用登入帳號認人，不信任前端送來的 playerId／名字。
// 開局後以牌局狀態的座位為準（座位打亂後也對），開局前用 mj_players。
import { getAuthUser } from "@/lib/auth";
import { loadPlayers, loadRoom } from "@/lib/mahjong/db";
import type { MahjongGameState } from "@/lib/mahjong/gameState";

export interface Member {
  playerId: string;
  name: string;
  seat: number;
  userId: string | null;
}
export const fail = (status: number, error: string, extra: Record<string, unknown> = {}) =>
  Response.json({ error, ...extra }, { status });

/** 確認請求的人是這一桌的玩家；不是就回錯誤 Response */
export async function resolveMember(
  request: Request,
  roomId: unknown,
  claimedPlayerId?: unknown
): Promise<{ roomCode: string; roomId: string; me: Member; members: Member[] } | Response> {
  if (typeof roomId !== "string" || !roomId) return fail(400, "bad_request");
  const user = await getAuthUser(request);
  if (!user) return fail(401, "not_logged_in");
  const room = await loadRoom(roomId);
  if (!room) return fail(404, "room_not_found");
  const gs = room.game_state as Partial<MahjongGameState> | null;
  const members: Member[] = gs?.players?.length
    ? gs.players.map((p) => ({ playerId: p.id, name: p.name, seat: p.seat, userId: p.userId ?? null }))
    : ((await loadPlayers(roomId)) ?? []).map((p) => ({ playerId: p.player_id, name: p.name, seat: p.seat, userId: p.user_id ?? null }));
  const me = members.find((m) => m.userId && m.userId === user.id);
  if (!me) return fail(403, "not_in_room");
  // 前端可以帶自己的 playerId，但必須是本人；名字、座位一律用伺服器的
  if (claimedPlayerId !== undefined && claimedPlayerId !== me.playerId) return fail(403, "not_your_seat");
  return { roomCode: room.code, roomId, me, members };
}
