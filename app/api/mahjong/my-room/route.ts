// GET /api/mahjong/my-room：登入的 LINE 帳號目前坐著的麻將房（重開頁面、換 Safari／主畫面 App 後找回房間）。
// 只回房號，前端拿房號照常呼叫 join：join 會用帳號認出原本的座位、回傳原本的玩家 id（rejoined: true），
// 圈數、局數、連莊、已同意下一局都存在牌局狀態裡，不受影響。遊客不提供（遊客每個分頁是不同的人）。
import { getAuthUser } from "@/lib/auth";
import { notLoggedIn } from "@/lib/mahjong/access";
import { loadSeatsByUser } from "@/lib/mahjong/db";

export async function GET(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return notLoggedIn();
  if (user.isGuest) return Response.json({ room: null });
  try {
    const [latest] = await loadSeatsByUser(user.id);
    return Response.json({ room: latest ? { code: latest.code, status: latest.status, seat: latest.seat } : null });
  } catch {
    return Response.json({ error: "伺服器錯誤" }, { status: 500 });
  }
}
