// 自摸特效庫＋斗內後台：前端和伺服器的往來（老馬 2026-10-31）。
// 格式照老柯〈自摸特效庫與斗內-前後端對接格式-2026-10-31〉第 2 版（worktree .tmp/）。格式有變只改這個檔。
// 老闆 2026-10-31：畫面文字越少越好——到期時間 API 照樣回，前端不顯示；沒有匿名。
import { mjFetch } from "./clientAuth";

// 老闆 2026-10-31：烈焰（flame）和隕石太像，移除，只剩 6 種
export type ZimoFxCode = "meteor" | "thunder" | "storm" | "frost" | "blackhole" | "sakura";
/** 金色自摸是全帳號永久可選的回退效果，不出現在後台授權清單。 */
export type ZimoFxChoice = "golden" | ZimoFxCode;
export const ZIMO_FX_LIST: { code: ZimoFxCode; name: string }[] = [
  { code: "meteor", name: "隕石" },
  { code: "thunder", name: "雷霆" },
  { code: "storm", name: "風暴" },
  { code: "frost", name: "冰封" },
  { code: "blackhole", name: "黑洞" },
  { code: "sakura", name: "櫻花" },
];
export const fxName = (code: string) => ZIMO_FX_LIST.find((f) => f.code === code)?.name ?? code;

export type Res<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

async function call<T>(method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<Res<T>> {
  try {
    const r = await mjFetch(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) return { ok: false, status: r.status, error: typeof j.error === "string" ? j.error : "network" };
    return { ok: true, data: j as T };
  } catch {
    return { ok: false, status: 0, error: "network" };
  }
}

// ---- 玩家自己（設定頁）：第 4 節 ----
export interface MyZimoFx { serverNow: number; available: Partial<Record<ZimoFxChoice, number | null>>; selected: ZimoFxChoice | null }
export const getMyFx = () => call<MyZimoFx>("GET", "/api/mahjong/zimo-fx");
export const selectMyFx = (fx: ZimoFxChoice) => call<{ selected: ZimoFxChoice }>("POST", "/api/mahjong/zimo-fx", { fx });
/** 老闆帳號＝7 種都是永久（到期是 null，對接格式第 4 節）；只用來決定要不要顯示後台入口，真正的權限由後台 API 檢查 */
export const isPermanentAll = (d: MyZimoFx) => ZIMO_FX_LIST.every((f) => f.code in d.available && d.available[f.code] === null);

// ---- 公開排行榜：第 3 節（不用登入）；week＝本週榜，all＝總斗內（累計所有有效斗內） ----
export interface BoardRow { rank: number; name: string; avatarUrl: string | null; amount: number }
export async function getLeaderboard(scope: "week" | "all" = "week"): Promise<{ ok: true; rows: BoardRow[] } | { ok: false }> {
  try {
    const r = await fetch(`/api/mahjong/donations/leaderboard?range=${scope}`, { cache: "no-store" });
    if (!r.ok) return { ok: false };
    const j = (await r.json()) as { rows?: BoardRow[] };
    return { ok: true, rows: j.rows ?? [] };
  } catch {
    return { ok: false };
  }
}

// ---- 後台：第 2 節（只有老闆帳號；其他人 401／403） ----
export interface AdminPlayer { userId: string; name: string; avatarUrl: string | null; shortId: string }
export interface DonationRecord {
  id: string; userId: string; name: string; avatarUrl: string | null; amount: number; donatedAt: number;
  note: string; createdAt: number; voided: boolean; voidedAt: number | null; voidReason: string | null;
}
export interface PlayerFx { serverNow: number; permanent: boolean; active: Partial<Record<ZimoFxCode, number>>; selected: ZimoFxCode | null }
export interface AuditRecord { id: number; at: number; actorId: string; action: string; targetUserId: string; recordId: string | null; detail: Record<string, unknown> }

export const findPlayers = (q: string) => call<{ players: AdminPlayer[] }>("GET", `/api/mahjong/admin/players?q=${encodeURIComponent(q)}`);
export const getDonations = (scope: "week" | "all") => call<{ weekTotal: number; records: DonationRecord[] }>("GET", `/api/mahjong/admin/donations?scope=${scope}`);
export const addDonation = (userId: string, amount: number, donatedAt: string, note: string) =>
  call<{ id: string }>("POST", "/api/mahjong/admin/donations", { userId, amount, donatedAt, ...(note ? { note } : {}) });
export const voidDonation = (id: string, reason: string) => call<{ voided: true }>("POST", "/api/mahjong/admin/donations/void", { id, reason });
export const getPlayerFx = (userId: string) => call<PlayerFx>("GET", `/api/mahjong/admin/fx?userId=${encodeURIComponent(userId)}`);
export const grantFx = (userId: string, fx: ZimoFxCode[], active: ZimoFxCode) => call<{ granted: number }>("POST", "/api/mahjong/admin/fx", { userId, fx, active });
export const revokeFx = (userId: string, fx?: ZimoFxCode[]) => call<{ revoked: number }>("POST", "/api/mahjong/admin/fx/revoke", { userId, ...(fx ? { fx } : {}) });
export const getAudit = () => call<{ records: AuditRecord[] }>("GET", "/api/mahjong/admin/audit?limit=200");

/** 本機現在的台灣時間，給 datetime-local 預設值（YYYY-MM-DDTHH:mm） */
export function nowTaipeiLocal(): string {
  const d = new Date(Date.now() + 8 * 3600_000);
  return d.toISOString().slice(0, 16);
}
/** datetime-local（台灣時間）→ ISO 字串（+08:00） */
export const taipeiIso = (local: string) => `${local}:00+08:00`;
/** 伺服器毫秒 → 台灣時間 MM/DD HH:mm */
export function fmtTaipei(ms: number): string {
  const d = new Date(ms + 8 * 3600_000).toISOString();
  return `${d.slice(5, 7)}/${d.slice(8, 10)} ${d.slice(11, 16)}`;
}
