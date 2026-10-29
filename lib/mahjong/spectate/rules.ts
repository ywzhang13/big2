// 麻將觀戰的規則（純資料，不連任何服務）。規格：小宜〈麻將觀戰模式-UIUX完整規格-2026-10-30〉，規則依老闆 2026-10-30 定案。
//   ・申請 30 秒沒回應就失效；同一位觀戰者對同一位玩家，從上一次申請起 30 秒內不能再申請（伺服器擋）
//   ・approved 有效到房間結束；被觀戰者可以隨時收回
export const SPECTATE_WINDOW_MS = 30_000;

export type SpectateRowStatus = "pending" | "approved" | "rejected" | "revoked";
/** 資料庫裡的一列（spectatorId 是登入帳號 id：只在伺服器用，不能放進回應或廣播） */
export interface SpectateRow {
  spectatorId: string;
  targetPlayerId: string;
  requestId: string;
  status: SpectateRowStatus;
  name: string;
  avatarUrl: string | null;
  requestedAt: number;
}

export type RequestResult =
  | { ok: true; requestId: string; expiresAt: number }
  | { ok: false; reason: "already_approved" }
  | { ok: false; reason: "already_pending" | "cooldown"; until: number };

/** SQL 回的 jsonb → RequestResult（測試的 stub 也用這個） */
export function toRequestResult(data: unknown): RequestResult {
  const d = (data ?? {}) as { ok?: boolean; reason?: string; request_id?: string; expires_at?: string; until?: string };
  if (d.ok && d.request_id && d.expires_at) return { ok: true, requestId: d.request_id, expiresAt: Date.parse(d.expires_at) };
  if (d.reason === "already_approved") return { ok: false, reason: d.reason };
  if ((d.reason === "already_pending" || d.reason === "cooldown") && d.until) return { ok: false, reason: d.reason, until: Date.parse(d.until) };
  throw new Error(`觀戰申請回傳格式不對：${JSON.stringify(data)}`);
}

/** 觀戰者看到的單一玩家狀態（小宜 7.1；cooldown 不單獨回，看 cooldownUntil、canRequest） */
export type SpectateStatus = "available" | "pending" | "approved" | "rejected" | "revoked" | "expired";
export function spectateStatus(row: SpectateRow | undefined, now: number): {
  status: SpectateStatus; expiresAt: number | null; cooldownUntil: number | null; canRequest: boolean;
} {
  if (!row) return { status: "available", expiresAt: null, cooldownUntil: null, canRequest: true };
  const until = row.requestedAt + SPECTATE_WINDOW_MS;
  const cooling = until > now;
  if (row.status === "approved") return { status: "approved", expiresAt: null, cooldownUntil: null, canRequest: false };
  if (row.status === "pending") {
    return cooling
      ? { status: "pending", expiresAt: until, cooldownUntil: null, canRequest: false }
      : { status: "expired", expiresAt: null, cooldownUntil: null, canRequest: true };
  }
  if (row.status === "rejected" && !cooling) return { status: "available", expiresAt: null, cooldownUntil: null, canRequest: true };
  return { status: row.status, expiresAt: null, cooldownUntil: cooling ? until : null, canRequest: !cooling };
}

/** 每位玩家目前 approved 的觀戰人數（沒有的補 0） */
export function viewerCounts(rows: SpectateRow[], playerIds: string[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(playerIds.map((id) => [id, 0]));
  for (const r of rows) if (r.status === "approved" && r.targetPlayerId in out) out[r.targetPlayerId]++;
  return out;
}

export const isUuid = (x: unknown): x is string => typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);

/** 觀戰資料保留 7 天：關房時順手刪掉更早的列（房間不會開這麼久，留下的都是關房時漏刪的） */
export const SPECTATE_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

/** view 限流：同一位觀戰者、同一房，每秒最多 10 次（前端把 150ms 內的事件合併成一次，正常用不到）。
 *  記在伺服器行程的記憶體：多台伺服器各算各的，是「最小」的保護，擋的是單一連線狂打 */
export const VIEW_LIMIT = 10;
export const VIEW_WINDOW_MS = 1000;
const viewHits = new Map<string, number[]>();
/** 放行回 0；超過回還要等幾毫秒 */
export function takeView(roomId: string, spectatorId: string, now: number): number {
  const key = `${roomId}:${spectatorId}`;
  const recent = (viewHits.get(key) ?? []).filter((t) => t > now - VIEW_WINDOW_MS);
  if (recent.length >= VIEW_LIMIT) {
    viewHits.set(key, recent);
    return recent[0] + VIEW_WINDOW_MS - now;
  }
  recent.push(now);
  if (viewHits.size > 5000) viewHits.clear(); // 只是限流，清掉頂多讓人多打一秒
  viewHits.set(key, recent);
  return 0;
}
