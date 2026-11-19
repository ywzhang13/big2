// LINE refresh token 加密（伺服器專用）：AES-256-GCM，金鑰是環境變數 LINE_TOKEN_KEY（32 bytes 的 base64）。
// 密文綁帳號 id（當成 AAD）：把某個人的密文複製到別人那一列也解不開。資料庫裡只存密文，沒有明文。
// 格式："v1." + base64url(iv 12 bytes ‖ 驗證碼 16 bytes ‖ 密文)
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** 金鑰：沒設定或長度不對回 null（功能整個關掉，不擋登入） */
export function tokenKey(env: Record<string, string | undefined> = process.env): Buffer | null {
  const raw = env.LINE_TOKEN_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  return key.length === 32 ? key : null;
}

export function sealToken(plain: string, userId: string, key = tokenKey()): string {
  if (!key) throw new Error("LINE_TOKEN_KEY 未設定");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(userId, "utf8"));
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return "v1." + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url");
}

/** 解不開（金鑰不對、帳號不對、內容被改過）丟錯 */
export function openToken(sealed: string, userId: string, key = tokenKey()): string {
  if (!key) throw new Error("LINE_TOKEN_KEY 未設定");
  if (!sealed.startsWith("v1.")) throw new Error("不認得的密文格式");
  const buf = Buffer.from(sealed.slice(3), "base64url");
  const d = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  d.setAAD(Buffer.from(userId, "utf8"));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}
