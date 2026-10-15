// iPhone 主畫面 App 的 LINE 登入交接 ③：主畫面 App 每 2 秒（以及切回 App 時）輪詢，最多 3 分鐘
// POST /api/auth/pairing/poll  { code, secret }
//   → { status: "pending", expiresAt } 或 { status: "ready", accessToken, refreshToken, expiresAt }（只拿得到一次）
import { pollPairing } from "@/lib/pairing/pairing";
import { failResponse, NO_STORE } from "@/lib/pairing/http";

export async function POST(request: Request) {
  let body: { code?: unknown; secret?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "缺少必要欄位" }, { status: 400 });
  }
  try {
    const r = await pollPairing(request, body.code, body.secret);
    if (!r.ok) return failResponse(r);
    if (r.status === "pending") return Response.json({ status: "pending", expiresAt: r.expiresAt }, { headers: NO_STORE });
    const s = r.session;
    return Response.json(
      { status: "ready", accessToken: s.accessToken, refreshToken: s.refreshToken, expiresAt: s.expiresAt },
      { headers: NO_STORE }
    );
  } catch {
    return Response.json({ error: "伺服器錯誤" }, { status: 500 });
  }
}
