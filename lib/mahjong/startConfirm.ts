// 麻將開局確認（老柯 2026-11-20；規則同十三支、大老二，判斷用共用的 lib/lobby/startConfirm.ts）：
//   房主按開始 → 發起確認（房間還是 waiting，房主自己算同意），倒數 10 秒；四家都同意才發牌開局（lib/mahjong/startGame.ts，存檔成功後才扣房卡）；
//   2026-11-26 v3：倒數中誰都不能取消；倒數到了還有人沒按 → 繼續等，之後到齊就開局；這時四家任一人可以「取消對戰」→ 回到等人；
//   確認期間有人退出、被暫停 → 作廢。
//   確認狀態存在等人階段的 game_state.startConfirm；沒開成的原因、誰沒按記在 game_state.lastStartConfirm（房主重新按開始、開局時清掉）。
// 比照十三支、大老二修好的審伯 R1～R3：
//   R1 每一輪有自己的編號，同意、取消都要帶；對不上＝舊一輪晚到或重送，不能動這一輪（存檔衝突後重讀也一樣）
//   R2 寫入都是等人階段的條件寫入（版本 +1），開局存檔要版本對得上：中間有人取消、重新開始、退出，舊請求就開不了局
//   R3 同意用「受理時刻」判斷有沒有逾時，先確認還有效才加入；到期作廢一直撞到衝突 → retryOnConflict 用完回 409，不往下做
// 麻將有登入：同意、取消都驗座位本人，不用另外的憑證。
// 寫入衝突一律丟 StateConflictError，呼叫端用 retryOnConflict 重讀整個重做。
import { addStartReady, beginStartConfirm, isCurrentConfirm, START_CANCEL_ERRORS, startCancelBlock, startConfirmStatus, type StartConfirm } from "@/lib/lobby/startConfirm";
import { claimLobbyForLeave, type MjPlayer, type MjRoom } from "@/lib/mahjong/db";
import { mjBroadcast } from "@/lib/mahjong/broadcast";
import { startBlockedError } from "@/lib/roomCard/guard";
import { startMahjongGame } from "@/lib/mahjong/startGame";

export type MjCancelReason = "host" | "timeout" | "seats_changed" | "suspended" | "cancelled"; // "cancelled"＝有人按取消對戰（v3c，by＝誰）；"host"、"timeout" 是舊資料
export interface MjLastStartConfirm { reason: MjCancelReason; missingIds: string[]; at: number; by?: string }
type Lobby = Record<string, unknown> & { stateVersion?: number; startConfirm?: StartConfirm | null; lastStartConfirm?: MjLastStartConfirm | null };

const json = (body: unknown, status = 200) => Response.json(body, { status });
/** 等人階段的條件寫入（版本 +1；房間不是 waiting 或版本不對 → StateConflictError）。和退出用同一個函式 */
const saveLobby = (roomId: string, lobby: Lobby) => claimLobbyForLeave(roomId, lobby.stateVersion, lobby);
export const lobbyOf = (room: Pick<MjRoom, "game_state">): Lobby => ({ ...((room.game_state as unknown as Lobby | null) ?? {}) });
const seatIdsOf = (players: Pick<MjPlayer, "player_id" | "seat">[]) => [...players].sort((a, b) => a.seat - b.seat).map((p) => p.player_id);

/** 給前端的確認狀態（沒有確認＝null） */
export const confirmView = (c: StartConfirm | null | undefined, now: number) =>
  c ? { id: c.id, startedBy: c.startedBy, readyIds: c.readyIds, seatIds: c.seatIds, deadline: c.deadline, serverNow: now } : null;

/** 作廢這一輪：寫入（衝突就丟）、廣播 mj_start_cancelled */
async function cancelConfirm(room: MjRoom, lobby: Lobby, reason: MjCancelReason, now: number, extra: Record<string, unknown> = {}): Promise<void> {
  const c = lobby.startConfirm;
  const missingIds = c ? c.seatIds.filter((id) => !c.readyIds.includes(id)) : [];
  lobby.startConfirm = null;
  lobby.lastStartConfirm = { reason, missingIds, at: now, ...(typeof extra.by === "string" ? { by: extra.by } : {}) };
  await saveLobby(room.id, lobby);
  await mjBroadcast(room.code, "mj_start_cancelled", { reason, missingIds, ...extra });
}

/**
 * 確認在 now（受理時刻）座位變了就作廢（倒數結束還沒到齊不作廢，v3）。回傳處理後的等人狀態。
 * 寫入衝突丟 StateConflictError（呼叫端重讀再判斷，不能把沒處理掉的過期確認往下用）。
 */
export async function settleMjConfirm(room: MjRoom, players: Pick<MjPlayer, "player_id" | "seat">[], now: number): Promise<Lobby> {
  const lobby = lobbyOf(room);
  const c = lobby.startConfirm;
  if (room.status !== "waiting" || !c) return lobby;
  const st = startConfirmStatus(c, seatIdsOf(players), now);
  if (st === "seats_changed") await cancelConfirm(room, lobby, "seats_changed", now);
  return lobby;
}

/** 房主按開始（身分、4 人、暫停已在路由檢查過）：發起確認；已經有一個還在倒數的就回那一個，不重新計時 */
export async function beginMjConfirm(room: MjRoom, players: MjPlayer[], hostId: string): Promise<Response> {
  const now = Date.now();
  const lobby = await settleMjConfirm(room, players, now);
  if (lobby.startConfirm) return json({ success: true, ok: true, confirm: confirmView(lobby.startConfirm, now) });
  const c = beginStartConfirm(hostId, seatIdsOf(players), now);
  lobby.startConfirm = c;
  lobby.lastStartConfirm = null;
  await saveLobby(room.id, lobby);
  await mjBroadcast(room.code, "mj_start_confirm", confirmView(c, now)!);
  return json({ success: true, ok: true, confirm: confirmView(c, now) });
}

/** 有人按同意（座位本人已在路由驗過；acceptedAt＝受理時刻）：四家都同意 → 再檢查一次暫停，沒問題才發牌開局 */
export async function agreeMj(room: MjRoom, players: MjPlayer[], playerId: string, confirmId: unknown, acceptedAt: number): Promise<Response> {
  if (room.status !== "waiting") return json({ error: "started", message: "已經開局了" }, 409);
  const lobby = await settleMjConfirm(room, players, acceptedAt);
  const c = lobby.startConfirm;
  if (!c) {
    const expired = lobby.lastStartConfirm?.reason === "timeout";
    return json({ error: expired ? "expired" : "no_confirm", message: "這次開始已經取消，請房主重新按開始" }, 409);
  }
  if (typeof confirmId !== "string" || !confirmId) return json({ error: "confirm_id_required", message: "請重新整理後再按" }, 400);
  if (!isCurrentConfirm(c, confirmId)) return json({ error: "stale_confirm", message: "這是上一次的開始，請看目前的確認" }, 409);
  const next = addStartReady(c, playerId);
  if (next !== c) {
    lobby.startConfirm = next;
    await saveLobby(room.id, lobby); // 衝突 → 重讀再加，不會蓋掉別人、也不會加進新一輪
    await mjBroadcast(room.code, "mj_start_ready", { playerId, readyIds: next.readyIds, confirmId: next.id, deadline: next.deadline, serverNow: acceptedAt });
  }
  if (startConfirmStatus(next, seatIdsOf(players), acceptedAt) !== "go") return json({ ok: true, confirm: confirmView(next, acceptedAt) });
  // 四家都同意：發牌前再檢查一次有沒有人被暫停（確認期間老闆剛好暫停了誰也擋得住）
  const blocked = await startBlockedError(players.map((p) => ({ userId: p.user_id ?? null, name: p.name, seat: p.seat })));
  if (blocked) {
    const body = await blocked.clone().json() as { players?: unknown };
    await cancelConfirm(room, lobby, "suspended", acceptedAt, { players: body.players ?? [] });
    return blocked;
  }
  lobby.startConfirm = null;
  lobby.lastStartConfirm = null;
  // 開局存檔的版本＝上面這次同意寫入後的版本：中間有人取消、重新開始、退出，版本就變了 → 衝突、重讀（R2）
  await startMahjongGame({ ...room, game_state: lobby as unknown as MjRoom["game_state"] }, room.id, players);
  return json({ ok: true, started: true });
}

/**
 * 取消對戰（座位本人已在路由驗過；v3b）：倒數中、倒數後，這次確認座位裡任何一家都可以；
 * 不在座位裡 403 not_in_confirm。取消後 lastStartConfirm 記 "cancelled"＋by（提示「X 取消了對戰」，v3c）
 */
export async function cancelMj(room: MjRoom, players: MjPlayer[], playerId: string, confirmId: unknown): Promise<Response> {
  if (room.status !== "waiting") return json({ error: "started", message: "已經開局了" }, 400);
  const now = Date.now();
  const lobby = await settleMjConfirm(room, players, now);
  const c = lobby.startConfirm;
  if (!c) return json({ ok: true, cancelled: false });
  if (typeof confirmId !== "string" || !confirmId) return json({ error: "confirm_id_required", message: "請重新整理後再按" }, 400);
  if (!isCurrentConfirm(c, confirmId)) return json({ error: "stale_confirm", message: "這是上一次的開始，請看目前的確認" }, 409);
  const block = startCancelBlock(c, playerId);
  if (block) { const e = START_CANCEL_ERRORS[block]; return json({ error: e.error, message: e.message }, e.status); }
  await cancelConfirm(room, lobby, "cancelled", now, { by: playerId });
  return json({ ok: true, cancelled: true });
}
