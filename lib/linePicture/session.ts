// 這個請求是「哪一次登入」：登出撤銷授權要分得出是同一次登入還是重新登入（審伯 2026-11-19 必修 1）。
// Supabase 的 access token 裡有 session_id（每次登入一個，換 token 不變）；拿不到就用 token 本身的雜湊（測試、怪 token）。
// 只在 getAuthUser 驗過 token 之後才呼叫，這裡不驗簽。
import { createHash } from "node:crypto";

export function sessionKeyOf(request: Request): string {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { session_id?: unknown };
    if (typeof payload.session_id === "string" && payload.session_id) return `sid:${payload.session_id}`;
  } catch {
    // 不是 JWT：用雜湊
  }
  return `tok:${createHash("sha256").update(token).digest("hex").slice(0, 32)}`;
}
