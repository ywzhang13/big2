// POST /api/auth/refresh-picture：自己的大頭照載不出來時，前端呼叫這支，伺服器用存著的 LINE 授權跟 LINE 換一次最新照片（老闆 2026-11-19 乙案）。
// 要登入，只動自己的帳號（body 不看）。回 200 { pictureUrl, updated, reason? }：
//   updated: true          照片換了，已寫回帳號 user_metadata.picture
//   pictureUrl＋updated:false  LINE 上的照片和帳號存的一樣，沒寫
//   pictureUrl: null＋reason   沒換到，帳號的舊照片保留不動：
//     guest 遊客｜disabled 伺服器沒設定金鑰｜no_token 沒存授權（例如上線前登入、已登出）｜cooldown 10 分鐘內換過｜
//     token_invalid 授權失效或被撤銷（已刪掉，下次 LINE 登入會再存）｜line_error LINE 回錯或逾時｜mismatch 授權不是這個帳號的 LINE｜no_picture LINE 沒設大頭照
import { getAuthUser } from "@/lib/auth";
import { openToken, sealToken, tokenKey } from "@/lib/linePicture/crypto";
import { fetchLineProfile, lineConfigured, refreshLineToken } from "@/lib/linePicture/line";
import { claimSealed, invalidateSealed, loadAccount, rotateSealed, savePicture } from "@/lib/linePicture/store";

/** 同一個人多久才會再跟 LINE 換一次（成功、失敗都算） */
const REFRESH_COOLDOWN_SECONDS = 600;

const miss = (reason: string) => Response.json({ pictureUrl: null, updated: false, reason });

export async function POST(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return Response.json({ error: "not_logged_in" }, { status: 401 });
  if (user.isGuest) return miss("guest");
  const key = tokenKey();
  if (!key || !lineConfigured()) return miss("disabled");
  try {
    const claim = await claimSealed(user.id, REFRESH_COOLDOWN_SECONDS);
    if (claim.status !== "ok") return miss(claim.status === "cooldown" ? "cooldown" : "no_token");
    let plain: string;
    try {
      plain = openToken(claim.sealed, user.id, key);
    } catch {
      await invalidateSealed(user.id, claim.gen); // 解不開（換過金鑰、資料被改過）：當成失效，只刪這一筆
      return miss("token_invalid");
    }
    const t = await refreshLineToken(plain);
    if (!t.ok) {
      if (t.invalid) await invalidateSealed(user.id, claim.gen); // 只刪 claim 時那一筆：中間重新登入存的新授權不動
      return miss(t.invalid ? "token_invalid" : "line_error");
    }
    // LINE 換發新的就換存：只有授權還是 claim 時那一筆才寫（中間登出、重新登入過就不寫回）
    if (t.value.refreshToken && t.value.refreshToken !== plain) await rotateSealed(user.id, sealToken(t.value.refreshToken, user.id, key), claim.gen);
    const p = await fetchLineProfile(t.value.accessToken);
    if (!p.ok) return miss("line_error");
    const acct = await loadAccount(user.id);
    if (!acct) return miss("line_error");
    if (!acct.lineSub || acct.lineSub !== p.value.userId) return miss("mismatch");
    if (!p.value.pictureUrl) return miss("no_picture");
    if (p.value.pictureUrl === acct.picture) return Response.json({ pictureUrl: p.value.pictureUrl, updated: false });
    await savePicture(user.id, acct.meta, p.value.pictureUrl);
    return Response.json({ pictureUrl: p.value.pictureUrl, updated: true });
  } catch (err) {
    console.error("[refresh-picture]", err instanceof Error ? err.message : err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
