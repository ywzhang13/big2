// 斗內後台共用：只有老闆帳號（LINE 登入、不是遊客）能用，伺服器端檢查；其他人 401／403，不回任何資料。
import { getAuthUser, type AuthUser } from "@/lib/auth";
import { isOwner } from "./rules";

export const fail = (status: number, error: string, extra: Record<string, unknown> = {}) =>
  Response.json({ error, ...extra }, { status, headers: { "cache-control": "no-store" } });
export const ok = (body: object) => Response.json(body, { headers: { "cache-control": "no-store" } });

export async function requireOwner(request: Request): Promise<AuthUser | Response> {
  const user = await getAuthUser(request);
  if (!user) return fail(401, "not_logged_in");
  if (user.isGuest || !isOwner(user.id)) return fail(403, "forbidden");
  return user;
}

/** 讀 JSON body（太大或格式錯回 null） */
export async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const raw = await request.text();
    if (raw.length > 4000) return null;
    const b = JSON.parse(raw);
    return b && typeof b === "object" && !Array.isArray(b) ? b : null;
  } catch {
    return null;
  }
}
