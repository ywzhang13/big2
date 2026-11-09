// 自摸特效庫＋斗內後台：前端和伺服器的往來（老馬 2026-10-31）。
// 格式照老柯〈自摸特效庫與斗內-前後端對接格式-2026-10-31〉第 2 版（worktree .tmp/）。格式有變只改這個檔。
// 老闆 2026-10-31：畫面文字越少越好——到期時間 API 照樣回，前端不顯示；沒有匿名。
import { mjFetch } from "./clientAuth";

// 老闆 2026-10-31：烈焰（flame）和隕石太像，移除，只剩 6 種
export type ZimoFxCode = "meteor" | "thunder" | "storm" | "frost" | "blackhole" | "sakura";
/** 金色自摸是全帳號永久可選的回退效果，不出現在後台授權清單。 */
export type ZimoFxChoice = "golden" | ZimoFxCode | "rulai"; // rulai 如來神掌：只有老闆能選，不在 ZIMO_FX_LIST（後台「開通全部」用那份清單）
export const ZIMO_FX_LIST: { code: ZimoFxCode; name: string }[] = [
  { code: "meteor", name: "隕石" },
  { code: "thunder", name: "雷霆" },
  { code: "storm", name: "風暴" },
  { code: "frost", name: "冰封" },
  { code: "blackhole", name: "黑洞" },
  { code: "sakura", name: "櫻花" },
];
export const fxName = (code: string) => (code === "rulai" ? "如來神掌" : ZIMO_FX_LIST.find((f) => f.code === code)?.name ?? code);

export type Res<T> = { ok: true; data: T } | { ok: false; status: number; error: string; body?: Record<string, unknown> };

async function call<T>(method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<Res<T>> {
  try {
    const r = await mjFetch(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) return { ok: false, status: r.status, error: typeof j.error === "string" ? j.error : "network", body: j };
    return { ok: true, data: j as T };
  } catch {
    return { ok: false, status: 0, error: "network" };
  }
}

// ---- 玩家自己（設定頁）：第 4 節 ----
export interface MyZimoFx { serverNow: number; displayName: string; isOwner: boolean; /** 只有老闆的回應才有：老闆專屬的特效（第 8 張卡看它） */ ownerFx?: "rulai"[]; available: Partial<Record<ZimoFxChoice, number | null>>; selected: ZimoFxChoice | null }
export const getMyFx = () => call<MyZimoFx>("GET", "/api/mahjong/zimo-fx");
export const selectMyFx = (fx: ZimoFxChoice) => call<{ selected: ZimoFxChoice }>("POST", "/api/mahjong/zimo-fx", { fx });
/** 選用被拒（403 not_granted：沒開通、過期、被收回）時，伺服器帶回目前實際套用的那一種（老柯 2026-10-31） */
export const rejectedSelected = (r: Res<unknown>): ZimoFxChoice | null =>
  !r.ok && r.status === 403 && typeof r.body?.selected === "string" ? (r.body.selected as ZimoFxChoice) : null;

// ---- 公開排行榜：第 3 節（不用登入）；week＝本週榜，all＝總斗內（累計所有有效斗內） ----
// 有登入就帶 token：伺服器判斷哪一列是自己（me），前端不比對名字（可能同名）。沒登入照樣能看
export interface BoardRow { rank: number; name: string; avatarUrl: string | null; amount: number; me?: boolean }
async function board<T>(path: string): Promise<{ ok: true; rows: T[] } | { ok: false }> {
  try {
    const r = await mjFetch(path, { cache: "no-store" });
    if (!r.ok) return { ok: false };
    const j = (await r.json()) as { rows?: T[] };
    return { ok: true, rows: j.rows ?? [] };
  } catch {
    return { ok: false };
  }
}
export const getLeaderboard = (scope: "week" | "all" = "week") => board<BoardRow>(`/api/mahjong/donations/leaderboard?range=${scope}`);
/** 輸贏榜（老柯〈輸贏排行榜-API格式〉）：score＝期間內打完（含中途解散）的場次淨輸贏加總，和歷史紀錄的「累計」同一個算法；rank 同分同名次由後端算 */
export interface ScoreRow { rank: number; name: string; avatarUrl: string | null; score: number; me?: boolean }
export const getScoreBoard = (scope: "week" | "all" = "week") => board<ScoreRow>(`/api/mahjong/ranks/score?range=${scope}`);

// ---- 後台：第 2 節（只有老闆帳號；其他人 401／403） ----
export interface AdminPlayer { userId: string; name: string; avatarUrl: string | null; shortId: string }
export interface DonationRecord {
  id: string; userId: string; name: string; avatarUrl: string | null; amount: number; donatedAt: number;
  note: string; createdAt: number; voided: boolean; voidedAt: number | null; voidReason: string | null;
}
/** active：代號→到期時間，null＝永久（老闆 2026-11-04 起新開通都是永久）；有列出＝有開通 */
export interface PlayerFx { serverNow: number; permanent: boolean; active: Partial<Record<ZimoFxCode, number | null>>; selected: ZimoFxCode | null }
export interface AuditRecord { id: number; at: number; actorId: string; action: string; targetUserId: string; recordId: string | null; detail: Record<string, unknown> }

export const findPlayers = (q: string) => call<{ players: AdminPlayer[] }>("GET", `/api/mahjong/admin/players?q=${encodeURIComponent(q)}`);
export const getDonations = (scope: "week" | "all") => call<{ weekTotal: number; records: DonationRecord[] }>("GET", `/api/mahjong/admin/donations?scope=${scope}`);
export const addDonation = (userId: string, amount: number, donatedAt: string, note: string) =>
  call<{ id: string; tip: number }>("POST", "/api/mahjong/admin/donations", { userId, amount, donatedAt, ...(note ? { note } : {}) }); // 2026-11-02 起只記打賞，不抵扣

// ---- 自摸次數與自動抵扣（老柯〈斗內卡與自摸次數-API格式〉、小宜規格 v2 3.9；老闆 2026-10-31 定案）----
/** 自摸一次 NT$10（和後端 MJ_ZIMO_UNIT 一樣；後台清單的金額以伺服器回的 owed 為準） */
export const ZIMO_UNIT = 10;
export interface Deduction { deducted: number; remaining: number; tip: number }
/** 記一筆的抵扣預覽（和後端同一個公式）：抵 min(次數, ⌊金額÷10⌋) 次，沒抵完的繼續欠，超過應斗的部分和零頭算打賞 */
export function deductPreview(count: number, amount: number): Deduction {
  const deducted = Math.min(Math.max(0, count), Math.floor(Math.max(0, amount) / ZIMO_UNIT));
  return { deducted, remaining: count - deducted, tip: amount - deducted * ZIMO_UNIT };
}
export interface ZimoCountRow {
  userId: string; shortId: string; name: string; avatarUrl: string | null; count: number; owed: number;
  lastResetAt: number | null; lastResetSource: "donation" | "clear" | "system" | null; lastResetCleared: number | null;
}
export const getZimoCounts = () => call<{ price: number; players: ZimoCountRow[] }>("GET", "/api/mahjong/admin/zimo-counts");
export const voidDonation = (id: string, reason: string) => call<{ voided: true }>("POST", "/api/mahjong/admin/donations/void", { id, reason });
export const getPlayerFx = (userId: string) => call<PlayerFx>("GET", `/api/mahjong/admin/fx?userId=${encodeURIComponent(userId)}`);
/** 開通：一律一次開全部 6 種（老闆 2026-11-02），永久、沒有到期日（2026-11-04）；active 選填，不送就不改玩家目前的選擇 */
export const grantFx = (userId: string, fx: ZimoFxCode[], active?: ZimoFxCode) => call<{ granted: number }>("POST", "/api/mahjong/admin/fx", { userId, fx, ...(active ? { active } : {}) });
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

// ---- 斗內以場結清（老柯 app/api/mahjong/admin/settlements；小宜〈斗內改版〉規格 C）----
// 老闆 2026-11-02：按「已收」要有金額欄，預設帶入應給金額（多場就是合計），可以改；多給的算打賞（和應給記成同一筆斗內），少給不能送出
/** 依人列表的一列：只列還有已打完、未結清場次的人（金額多的在前，同額看最早的場次）；myTableCount＝其中幾場老闆也在桌（老闆 2026-11-09） */
export interface UnsettledPlayer { userId: string; name: string; avatarUrl: string | null; matches: number; zimo: number; amount: number; myTableCount: number }
/** 一場：zimo＝這場 11/1 之後的自摸次數、due＝應給；時間是毫秒；myTable＝老闆帳號是不是也坐在這桌（只是標記，不影響金額／結清流程） */
export interface SettleMatch { roomId: string; roomCode: string | null; startedAt: number | null; endedAt: number | null; zimo: number; due: number; myTable: boolean }
/** 已結清的一場：batchId＝那筆斗內 id（同一批結清共用，撤回整批）；amount／tip＝那批的實收和打賞 */
export interface SettledMatch {
  settlementId: string; roomId: string; roomCode: string | null; endedAt: number | null; zimo: number; due: number;
  batchId: string; amount: number; tip: number; settledAt: number; source: "settle" | "migrate"; myTable: boolean;
}
export interface SettleRoom { roomId: string; roomCode: string | null; zimo: number; due: number }
export const getUnsettled = () => call<{ price: number; total: number; players: UnsettledPlayer[] }>("GET", "/api/mahjong/admin/settlements");
/** 一個人的場次：unpaid＝打完、未結清；playing＝還在打（不能結清）；paid＝最近 30 天結清的 */
export const getPlayerMatches = (userId: string) =>
  call<{ price: number; unpaid: SettleMatch[]; playing: SettleMatch[]; paid: SettledMatch[]; totalDue: number }>("GET", `/api/mahjong/admin/settlements?userId=${encodeURIComponent(userId)}`);
// ---- 玩家斗內總覽（老闆 2026-11-08，接續〈斗內次數調查報告〉建議②）：查單一帳號，不用自己比對對戰紀錄 ----
export interface DonateOverview { totalHands: number; afterCutoffMatches: number; settledMatches: number; unsettledMatches: number; due: number; isOwner: boolean }
export const getDonateOverview = (userId: string) => call<DonateOverview>("GET", `/api/mahjong/admin/donate-overview?userId=${encodeURIComponent(userId)}`);
/** 結清：amount＝老闆實收（≥ 這幾場應給合計）；409 short 附 { due, amount, shortBy } */
export const settleMatches = (userId: string, roomIds: string[], amount: number) =>
  call<{ batchId: string; due: number; amount: number; tip: number; rooms: SettleRoom[] }>("POST", "/api/mahjong/admin/settlements", { userId, roomIds, amount });
/** 撤回一批結清：這批場次全部回到未結清，那筆斗內（含打賞）整筆作廢 */
export const revokeBatch = (batchId: string, reason: string) =>
  call<{ batchId: string; amount: number | null; rooms: SettleRoom[] }>("POST", "/api/mahjong/admin/settlements/revoke", { batchId, reason });
/** 實收和應給比：多給＝打賞、少給＝還差多少（少給不能送出） */
export function payCheck(due: number, paid: number): { ok: boolean; tip: number; short: number } {
  const p = Number.isFinite(paid) ? paid : 0;
  return { ok: p >= due && due > 0, tip: Math.max(0, p - due), short: Math.max(0, due - p) };
}
