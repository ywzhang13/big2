// GET /api/thirteen/my-room：登入的帳號目前坐著的十三支房間（斷線、關掉網頁後重新進站找回房間；比照麻將 /api/mahjong/my-room）。
// 只看登入身分，不收任何參數（查不到別人的房間）。回 { room: { roomId, code, status, seat, playerId } | null }；
// 前端拿房號照常呼叫 join：同一個帳號會認回原座位（rejoined: true）和座位頻道。遊客不提供（每個分頁是不同的人），回 null。
import { getAuthUser } from "@/lib/auth";
import { loadSeatsByUser } from "@/lib/thirteen/db";
import { fail, json } from "@/lib/thirteen/server";

export async function GET(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return fail(401, "not_logged_in");
  if (user.isGuest) return json({ room: null });
  try {
    const [latest] = await loadSeatsByUser(user.id);
    return json({ room: latest ?? null });
  } catch (err) {
    return fail(500, "server_error", err instanceof Error ? err.message : "伺服器錯誤");
  }
}
