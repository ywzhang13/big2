// 房卡前端呼叫（老柯〈給老馬-房卡與斗內下架-API說明-2026-11-20〉）：全部帶登入 token（mjFetch），錯誤一律 { error, message? }
import { mjFetch } from "@/lib/mahjong/clientAuth";

export type Res<T> = { ok: true; data: T } | { ok: false; status: number; error: string };
async function call<T>(method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<Res<T>> {
  try {
    const res = await mjFetch(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, data: data as T } : { ok: false, status: res.status, error: (data as { error?: string }).error ?? "server_error" };
  } catch {
    return { ok: false, status: 0, error: "network" };
  }
}

/** 自己的房卡（1 節）：老闆、遊客 balance 是 null（不顯示房卡格） */
export interface MyCards { isOwner: boolean; balance: number | null; suspended: boolean; suspendedAt: number | null }
export const getMyCards = () => call<MyCards>("GET", "/api/cards/me");

/** 後台玩家一列（3-1） */
export interface CardPlayer {
  userId: string; shortId: string; name: string; avatarUrl: string | null; balance: number;
  suspended: boolean; suspendedAt: number | null; playing: { game: "mahjong" | "thirteen"; code: string } | null;
  lastTopupAt: number | null; lastChargeAt: number | null;
}
export interface CardStats { players: number; debtors: number; debtCards: number; suspended: number; chargedToday: number }
export const getCardPlayers = () => call<{ serverNow: number; stats: CardStats; players: CardPlayer[] }>("GET", "/api/admin/cards/players");

/** 流水帳一筆（3-2）：扣卡已經收成一場一列，hands＝扣了哪幾把／哪幾局 */
export interface CardEntry {
  kind: "topup" | "charge" | "reclaim" | "suspend" | "resume"; at: number; cards: number | null; balanceAfter: number | null; actor: string;
  game?: "mahjong" | "thirteen"; roomId?: string; roomCode?: string; hands?: number[];
}
export const getCardLedger = (userId: string) => call<{ player: CardPlayer; entries: CardEntry[] }>("GET", `/api/admin/cards/ledger?userId=${encodeURIComponent(userId)}`);

/** 寫入（3-3）：opId 由視窗打開時產生，重試用同一個 */
export type CardOp = "topup" | "reclaim" | "suspend" | "resume";
export const cardWrite = (op: CardOp, body: { userId: string; opId: string; cards?: number }) =>
  call<{ userId: string; balance?: number; suspended?: boolean; suspendedAt?: number | null; replay: boolean }>("POST", `/api/admin/cards/${op}`, body);

/** 全部流水帳（老柯〈房卡第二批 API〉第 1 節）：扣卡一把一筆、新到舊；stats 不受 kind 影響 */
export type LedgerKind = "topup" | "charge" | "reclaim" | "suspend" | "resume";
export type LedgerPeriod = "today" | "week" | "month" | "all";
export interface LedgerAllEntry {
  cursor: string; kind: LedgerKind; at: number; userId: string; shortId: string; name: string; avatarUrl: string | null;
  cards: number | null; balanceAfter: number | null; game: "mahjong" | "thirteen" | null; roomCode: string | null; handNo: number | null;
  actor: string; actorKind: "system" | "owner" | "donate_debt" | "other";
}
export interface LedgerAllPage {
  serverNow: number; period: LedgerPeriod; kind: LedgerKind | null;
  stats: { topup: number; charge: number; reclaim: number }; entries: LedgerAllEntry[]; nextCursor: string | null;
}
export function getLedgerAll(q: { kind: LedgerKind | null; period: LedgerPeriod; cursor: string | null }) {
  const qs = new URLSearchParams({ period: q.period, limit: "50" });
  if (q.kind) qs.set("kind", q.kind);
  if (q.cursor) qs.set("cursor", q.cursor);
  return call<LedgerAllPage>("GET", `/api/admin/cards/ledger/all?${qs}`);
}

/** 總大廳歷史紀錄（同上第 2 節）：只回自己入座的場次；沒有房卡欄位、沒有帳號 id */
export type RecordGame = "all" | "mahjong" | "thirteen" | "big2";
export interface HistoryItem {
  id: string; game: "mahjong" | "thirteen" | "big2"; roomCode: string; endedAt: string; endReason: "completed" | "dissolved";
  totalRounds: number | null; totalHands: number | null; handsPlayed: number | null; myScore: number;
  players: { seat: number; playerName: string; totalScore: number; isMe: boolean }[];
}
export interface HistoryPage {
  items: HistoryItem[]; nextCursor: string | null;
  counts: Record<RecordGame, number>; summary: { matches: number; totalScore: number | null };
}
export function getHistory(game: RecordGame, cursor: string | null) {
  const qs = new URLSearchParams({ game, limit: "20" });
  if (cursor) qs.set("cursor", cursor);
  return call<HistoryPage>("GET", `/api/records?${qs}`);
}

/** 開房、加入被擋（2-1）、開局被擋（2-2）：從 API 的錯誤回應認出來 */
export type Blocked = { kind: "suspended"; at: number | null } | { kind: "players"; code: string | null; players: { seat: number; name: string }[] };
export function blockedFrom(body: unknown, code: string | null = null): Blocked | null {
  const b = (body ?? {}) as { error?: string; suspendedAt?: number | null; players?: { seat: number; name: string }[] };
  if (b.error === "suspended") return { kind: "suspended", at: typeof b.suspendedAt === "number" ? b.suspendedAt : null };
  if (b.error === "player_suspended") return { kind: "players", code, players: Array.isArray(b.players) ? b.players : [] };
  return null;
}

/** 台北時間「11/19 10:30」 */
export function fmtAt(ms: number): string {
  const d = new Date(ms + 8 * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
/** 張數寫法：負數用「−」 */
export const fmtCards = (n: number) => (n < 0 ? `−${-n}` : String(n));
