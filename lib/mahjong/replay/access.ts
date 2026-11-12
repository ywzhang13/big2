// 回放 API 共用的權限檢查（GET /api/mahjong/replay、/api/mahjong/replay/hand）。
// 順序：沒登入 401 → 參數錯 400 → 這一場還沒結束（沒有對戰紀錄）：本人在那桌 409、其他人 403 → 不是那場上桌的 4 人 403 → 過期 410。
// 觀戰者不在 match_record_players 裡，所以一律 403。
import { getAuthUser } from "@/lib/auth";
import { notLoggedIn } from "@/lib/mahjong/access";
import { findReplayMatch, type ReplayMatch } from "@/lib/mahjong/replay/store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const err = (status: number, error: string, extra: Record<string, unknown> = {}) => Response.json({ error, ...extra }, { status });

export async function replayAccess(request: Request): Promise<{ match: ReplayMatch; matchId: string; params: URLSearchParams } | Response> {
  const user = await getAuthUser(request);
  if (!user) return notLoggedIn();
  const params = new URL(request.url).searchParams;
  const matchId = params.get("matchId") ?? "";
  if (!UUID.test(matchId)) return err(400, "bad_match_id");
  let match: ReplayMatch | null;
  try {
    match = await findReplayMatch(matchId, user.id);
  } catch (e) {
    console.error("[mj-replay] 查詢場次失敗：", e instanceof Error ? e.message : e);
    return err(500, "server_error");
  }
  // 沒有這一場的對戰紀錄：還在打（或 id 不存在）。不分辨，避免拿 id 試探別人的牌局
  if (!match) return err(403, "not_finished");
  if (match.mySeat === null) return err(403, "not_player");
  if (match.expired) return err(410, "expired", { expiresAt: match.expiresAt });
  return { match, matchId, params };
}
