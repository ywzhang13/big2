// LINE 長期授權（只用來在大頭照網址失效時換新照片，老闆 2026-11-19 乙案）
// POST   /api/auth/line-token { refreshToken }  → 剛用 LINE 登入時，前端把 Supabase 給的 provider_refresh_token 交給伺服器；
//                                               加密（綁帳號）後存進 line_tokens。回 { ok: true }，或 { ok: false, reason }：
//                                               guest 遊客｜disabled 伺服器沒設定（前端要留著之後補存）｜revoked 這次登入已經登出（不存）
// DELETE /api/auth/line-token                   → 登出：這次登入記成已登出、刪掉這次登入存的授權（重新登入後的新授權不動）。回 { ok: true }
// 「這次登入」看 access token 的 session_id（lib/linePicture/session.ts）。
// 都要登入（Authorization: Bearer），只動自己的帳號；body 裡帶的任何帳號 id 都不看。
// 存失敗、沒設定加密金鑰都不擋登入：前端是在背景送的，失敗只是少了自動換照片。
import { getAuthUser } from "@/lib/auth";
import { sealToken, tokenKey } from "@/lib/linePicture/crypto";
import { lineConfigured } from "@/lib/linePicture/line";
import { deleteSealed, saveSealed } from "@/lib/linePicture/store";
import { sessionKeyOf } from "@/lib/linePicture/session";

const MAX_LEN = 2048;

export async function POST(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return Response.json({ error: "not_logged_in" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { refreshToken?: unknown } | null;
  const rt = body?.refreshToken;
  if (typeof rt !== "string" || !rt || rt.length > MAX_LEN) return Response.json({ error: "bad_request" }, { status: 400 });
  if (user.isGuest) return Response.json({ ok: false, reason: "guest" });
  const key = tokenKey();
  if (!key || !lineConfigured()) return Response.json({ ok: false, reason: "disabled" });
  try {
    return Response.json(await saveSealed(user.id, sealToken(rt, user.id, key), sessionKeyOf(request)));
  } catch (err) {
    console.error("[line-token] 存授權失敗：", err instanceof Error ? err.message : err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return Response.json({ error: "not_logged_in" }, { status: 401 });
  try {
    await deleteSealed(user.id, sessionKeyOf(request));
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[line-token] 刪授權失敗：", err instanceof Error ? err.message : err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
