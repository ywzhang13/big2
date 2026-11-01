// 以場結清（老闆 2026-11-02）的型別和資料庫回傳轉換（純函式；正式的 store 和測試的 stub 共用）。
// 一場＝一間房（room_id）；應給＝這場 11/1 00:00（台灣時間）之後的自摸次數 × 10。
const ms = (v: string | Date | null) => (v ? new Date(v).getTime() : null);

/** 未結清的一場；endedAt＝null 表示還在打（不能結清） */
export interface UnsettledMatch { userId: string; roomId: string; roomCode: string | null; startedAt: number | null; endedAt: number | null; zimo: number; due: number }
export interface SettledMatch { settlementId: string; roomId: string; roomCode: string | null; endedAt: number | null; zimo: number; due: number; batchId: string; amount: number; tip: number; settledAt: number; source: "settle" | "migrate" }
export interface SettleRoom { roomId: string; roomCode: string | null; zimo: number; due: number }
export type SettleResult =
  | { ok: true; batchId: string; due: number; amount: number; tip: number; rooms: SettleRoom[] }
  | { ok: false; error: "no_rooms" | "duplicate_room" | "not_finished" | "already_settled" | "nothing_due" | "bad_amount" | "short"; roomId?: string; due?: number; amount?: number; shortBy?: number };
export type UnsettleResult = { ok: true; batchId: string; amount: number | null; rooms: SettleRoom[] } | { ok: false; error: "not_found" };

export type UnsettledRow = { user_id: string; room_id: string; room_code: string | null; started_at: string | Date | null; ended_at: string | Date | null; zimo: number; due: number };
export const toUnsettled = (r: UnsettledRow): UnsettledMatch => ({ userId: String(r.user_id), roomId: String(r.room_id), roomCode: r.room_code?.trim() ?? null,
  startedAt: ms(r.started_at), endedAt: ms(r.ended_at), zimo: Number(r.zimo), due: Number(r.due) });
export type SettledRow = { settlement_id: string; room_id: string; room_code: string | null; ended_at: string | Date | null; zimo: number; due: number; donation_id: string; amount: number; tip: number; settled_at: string | Date; source: string };
export const toSettled = (r: SettledRow): SettledMatch => ({ settlementId: String(r.settlement_id), roomId: String(r.room_id), roomCode: r.room_code?.trim() ?? null, endedAt: ms(r.ended_at),
  zimo: Number(r.zimo), due: Number(r.due), batchId: String(r.donation_id), amount: Number(r.amount), tip: Number(r.tip), settledAt: new Date(r.settled_at).getTime(), source: r.source === "migrate" ? "migrate" : "settle" });
type RawRooms = { roomId: string; roomCode: string | null; zimo: number; due: number }[] | null;
const toRooms = (x: RawRooms): SettleRoom[] => (x ?? []).map((r) => ({ roomId: String(r.roomId), roomCode: r.roomCode?.trim() ?? null, zimo: Number(r.zimo), due: Number(r.due) }));
export function toSettleResult(r: Record<string, unknown>): SettleResult {
  if (typeof r.error === "string") return { ok: false, error: r.error as Extract<SettleResult, { ok: false }>["error"], ...(r.roomId ? { roomId: String(r.roomId) } : {}),
    ...(r.error === "short" ? { due: Number(r.due), amount: Number(r.amount), shortBy: Number(r.shortBy) } : {}) };
  return { ok: true, batchId: String(r.donationId), due: Number(r.due), amount: Number(r.amount), tip: Number(r.tip), rooms: toRooms(r.rooms as RawRooms) };
}
export function toUnsettleResult(r: Record<string, unknown>): UnsettleResult {
  if (typeof r.error === "string") return { ok: false, error: "not_found" };
  return { ok: true, batchId: String(r.donationId), amount: r.amount == null ? null : Number(r.amount), rooms: toRooms(r.rooms as RawRooms) };
}

