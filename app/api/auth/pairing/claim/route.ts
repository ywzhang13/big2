// iPhone 主畫面 App 的 LINE 登入交接 ②：Safari 完成 LINE 登入、回到 /mahjong?pairing=<code> 後認領
// POST /api/auth/pairing/claim  Authorization: Bearer <Safari 這次登入的 access token>  { code, refreshToken }
// 成功後 Safari 要丟掉自己的登入（只清本機儲存，不要呼叫 signOut）
import { getAuthUser } from "@/lib/auth";
import { claimPairing } from "@/lib/pairing/pairing";
import { failResponse, NO_STORE } from "@/lib/pairing/http";

export async function POST(request: Request) {
  let body: { code?: unknown; refreshToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "缺少必要欄位" }, { status: 400 });
  }
  const user = await getAuthUser(request);
  if (!user) return Response.json({ error: "not_logged_in" }, { status: 401 });
  if (user.isGuest) return Response.json({ error: "guest_not_allowed" }, { status: 403 }); // 遊客登入不會跳到 Safari，用不到交接
  try {
    const r = await claimPairing(request, user.id, body.code, body.refreshToken);
    if (!r.ok) return failResponse(r);
    return Response.json({ success: true, displayName: user.displayName }, { headers: NO_STORE });
  } catch {
    return Response.json({ error: "伺服器錯誤" }, { status: 500 });
  }
}
