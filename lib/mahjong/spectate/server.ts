// 觀戰 API 共用的檢查（只在伺服器用）。錯誤碼見〈觀戰模式-前後端對接格式-2026-10-30.md〉第 2 節。
import { getAuthUser, type AuthUser } from "@/lib/auth";
import { loadSeats } from "@/lib/mahjong/db";
import type { MjRoom } from "@/lib/mahjong/db";
import type { MahjongGameState } from "@/lib/mahjong/gameState";

export const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => Response.json({ error, ...extra }, { status });

/** 觀戰者：要登入、而且不能是遊客 */
export async function spectatorUser(request: Request): Promise<AuthUser | Response> {
  const user = await getAuthUser(request);
  if (!user) return fail(401, "not_logged_in");
  if (user.isGuest) return fail(403, "guest_not_allowed");
  return user;
}

/** 房間要存在、已開局、整場還沒打完 */
export function startedState(room: MjRoom | null): MahjongGameState | Response {
  if (!room) return fail(404, "room_not_found");
  const s = room.game_state;
  if (!s || !s.status || !Array.isArray(s.players) || s.players.length !== 4) return fail(409, "not_started");
  if (s.gameOver) return fail(410, "room_ended");
  return s;
}

/** 這位登入使用者在這桌有沒有座位（牌局座位或 mj_players 任一個綁著他就算） */
export async function atTable(roomId: string, s: MahjongGameState, userId: string): Promise<boolean> {
  if (s.players.some((p) => p.userId === userId)) return true;
  return (await loadSeats(roomId)).some((p) => p.user_id === userId);
}
