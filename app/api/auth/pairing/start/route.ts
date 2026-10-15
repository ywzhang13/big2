// iPhone 主畫面 App 的 LINE 登入交接 ①：主畫面 App（獨立模式）按 LINE 登入前先發起
// POST /api/auth/pairing/start → { code, secret, expiresAt }
//   code 放進 LINE 登入的 redirectTo（/mahjong?pairing=<code>）；secret 只留在這個 App 的 sessionStorage，不能放進網址
import { startPairing } from "@/lib/pairing/pairing";
import { failResponse, NO_STORE } from "@/lib/pairing/http";

export async function POST(request: Request) {
  try {
    const r = await startPairing(request);
    if (!r.ok) return failResponse(r);
    return Response.json({ code: r.code, secret: r.secret, expiresAt: r.expiresAt }, { headers: NO_STORE });
  } catch {
    return Response.json({ error: "伺服器錯誤" }, { status: 500 });
  }
}
