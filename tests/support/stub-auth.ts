// 測試用：lib/auth.ts 的記憶體版本。Authorization: Bearer <token>，token 對到 tokens 裡的使用者。
// 不專門測登入的流程測試用 asSeat()：token「as:<玩家id>」＝以那個座位本人登入（帳號 id 為「u:<玩家id>」，
// 對應 stub-db 的 opts.autoBind 幫座位綁的帳號）。
import type { AuthUser } from "../../lib/auth";
export const tokens: Record<string, AuthUser> = {};
export async function getAuthUser(request: Request): Promise<AuthUser | null> {
  const m = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const token = m[1].trim();
  if (token.startsWith("as:")) return { id: `u:${token.slice(3)}`, displayName: null, pictureUrl: null };
  return tokens[token] ?? null;
}
/** 以 body.playerId 那個座位本人登入的 headers */
export function asSeat(body: object): Record<string, string> {
  const pid = (body as { playerId?: string }).playerId;
  return pid ? { authorization: `Bearer as:${pid}` } : {};
}
