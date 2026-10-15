// 遊客登入（只給老闆自己測試用，一般大廳沒有入口）
// POST   /api/auth/guest  { password, name? }  → 建立一個新的遊客並回傳 session（每次都是新的遊客）
// DELETE /api/auth/guest  （Authorization: Bearer 遊客的 token）→ 刪掉自己這個遊客
import { after } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { deleteUser } from "@/lib/guest/store";
import { loginGuest, sweepExpiredGuests } from "@/lib/guest/guest";

export async function POST(request: Request) {
  let body: { password?: unknown; name?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "缺少必要欄位" }, { status: 400 });
  }
  try {
    const r = await loginGuest(request, body.password, body.name);
    if (!r.ok) {
      return Response.json(
        { error: r.error, ...(r.retryAfter ? { retryAfter: r.retryAfter } : {}) },
        { status: r.status, headers: r.retryAfter ? { "Retry-After": String(r.retryAfter) } : undefined }
      );
    }
    // 回應送出後順便清掉過期的遊客
    after(() => sweepExpiredGuests().then(() => undefined).catch(() => undefined));
    return Response.json({
      accessToken: r.session.accessToken,
      refreshToken: r.session.refreshToken,
      expiresAt: r.session.expiresAt,
      user: { displayName: r.displayName, isGuest: true, guestExpiresAt: r.expiresAt },
    });
  } catch {
    return Response.json({ error: "伺服器錯誤" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return Response.json({ error: "not_logged_in" }, { status: 401 });
  if (!user.isGuest) return Response.json({ error: "not_guest" }, { status: 403 }); // 不能用這支刪 LINE 帳號
  try {
    await deleteUser(user.id);
    return new Response(null, { status: 204 });
  } catch {
    return Response.json({ error: "伺服器錯誤" }, { status: 500 });
  }
}
