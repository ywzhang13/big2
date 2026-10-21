// 偏好設定跟著 LINE 帳號：GET 讀、PUT 存。格式 v4：牌背、桌布、語音和互動音效的音量／靜音、語音自動播放（見 lib/mahjong/userPrefs/rules.ts）。
// 帳號一律由登入 session 決定，讀寫不到別人的設定。回應都帶 account（這份設定屬於哪個帳號），
// PUT 也要帶 account：和 session 不符就 409，前端切換帳號後晚到的舊請求不會寫進新帳號。
// 訪客不存：回 persisted:false，前端照樣只用本機設定。
import { getAuthUser } from "@/lib/auth";
import { parseAccountPrefs, readStoredPrefs } from "@/lib/mahjong/userPrefs/rules";
import { loadAccountPrefs, saveAccountPrefs } from "@/lib/mahjong/userPrefs/store";

const fail = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
const ok = (body: object) => Response.json(body, { headers: { "cache-control": "no-store" } });

export async function GET(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return fail(401, "not_logged_in");
  if (user.isGuest) return ok({ account: user.id, persisted: false, prefs: null });
  try {
    // 之前存的 v2、v3 轉成 v4；格式萬一對不上（例如之後白名單改了），就當沒存：前端套本機或預設
    return ok({ account: user.id, persisted: true, prefs: readStoredPrefs(await loadAccountPrefs(user.id)) });
  } catch (err) {
    console.error("[mj-prefs]", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}

export async function PUT(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return fail(401, "not_logged_in");
  let body: { account?: unknown; prefs?: unknown };
  try {
    const raw = await request.text();
    if (raw.length > 1000) return fail(413, "too_large");
    body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
  } catch {
    return fail(400, "bad_request");
  }
  if (typeof body.account !== "string") return fail(400, "account_required");
  if (body.account !== user.id) return fail(409, "account_mismatch");
  const prefs = parseAccountPrefs(body.prefs);
  if (!prefs) return fail(400, "invalid_prefs");
  if (user.isGuest) return ok({ account: user.id, persisted: false, prefs });
  try {
    await saveAccountPrefs(user.id, prefs);
    return ok({ account: user.id, persisted: true, prefs });
  } catch (err) {
    console.error("[mj-prefs]", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}
