// 十三支的開局確認（老柯 2026-11-20；規則見 lib/lobby/startConfirm.ts。2026-11-26 v3：倒數中不能取消；倒數完還沒到齊就繼續等，四家任一人可以取消對戰）。
// 房間還是 status "waiting"，確認狀態存在 game_state.startConfirm；存檔一律走條件寫入（版本對不上就重讀重做），
// 入座、離開（th_lobby_join／leave）會把版本 +1，所以和確認不會交錯。
// 廣播：th_start_confirm（發起）、th_start_ready（有人同意）、th_start_cancelled（倒數後有人取消對戰、座位變了、有人被暫停）；開局照舊 th_hand_start。
import { getPictureUrls } from "@/lib/auth";
import { addStartReady, beginStartConfirm, isCurrentConfirm, START_CANCEL_ERRORS, startCancelBlock, startConfirmStatus, type StartConfirm } from "@/lib/lobby/startConfirm";
import { startBlockedError } from "@/lib/roomCard/guard";
import { loadPlayers, saveGameStateIfUnchanged, type ThirteenGameState, type ThPlayer, type ThRoom } from "./db";
import { clock, seatPlayers, startHand, touch } from "./flow";
import { json, saveAndAnnounce, send } from "./server";

type Room = ThRoom & { game_state: ThirteenGameState };
export type CancelReason = "host" | "timeout" | "seats_changed" | "suspended" | "cancelled"; // "cancelled"＝有人按取消對戰（v3c，by＝誰）

const seatIdsOf = (seats: ThPlayer[]) => [...seats].sort((a, b) => a.seat - b.seat).map((p) => p.player_id);
/** 給前端的確認狀態（沒有確認＝null） */
export const confirmView = (c: StartConfirm | null | undefined, now: number) =>
  c ? { id: c.id, startedBy: c.startedBy, readyIds: c.readyIds, seatIds: c.seatIds, deadline: c.deadline, serverNow: now } : null;

/** 清掉確認、存檔、廣播 th_start_cancelled。回傳存好的版本號 */
async function cancel(room: Room, reason: CancelReason, extra: Record<string, unknown> = {}): Promise<number> {
  const s = room.game_state;
  const base = s.stateVersion;
  const c = s.startConfirm;
  const missingIds = c ? c.seatIds.filter((id) => !c.readyIds.includes(id)) : []; // 這次還沒按同意的人（依座位）
  s.startConfirm = null;
  s.lastStartConfirm = { reason, missingIds, at: clock.now(), ...(typeof extra.by === "string" ? { by: extra.by } : {}) }; // 等人狀態看得到上一次為什麼沒開成；房主重新按開始時清掉
  const sv = await saveGameStateIfUnchanged(room.id, base, s, "waiting");
  await send(room, [{ event: "th_start_cancelled", payload: { reason, missingIds, ...extra } }], sv);
  return sv;
}

/**
 * 等人階段每次讀狀態、tick、有人離開之後都呼叫：座位變了就作廢（回到等人、要房主重新按開始）。
 * 倒數結束還沒到齊不作廢（v3：繼續等，可以取消對戰）。回傳處理後的確認（作廢＝null）。
 */
export async function settleStartConfirm(room: Room, seats?: ThPlayer[]): Promise<StartConfirm | null> {
  const c = room.game_state.startConfirm;
  if (!c || room.status !== "waiting") return c ?? null;
  const st = startConfirmStatus(c, seatIdsOf(seats ?? (await loadPlayers(room.id))), clock.now());
  if (st === "seats_changed") { await cancel(room, "seats_changed"); return null; }
  return c;
}

/** 房主按開始：發起確認（已經有一個還在倒數的就回那一個，不重新計時） */
export async function beginConfirm(room: Room, seats: ThPlayer[], hostId: string): Promise<Response> {
  const now = clock.now();
  const current = await settleStartConfirm(room, seats);
  if (current) return json({ ok: true, confirm: confirmView(current, now) });
  const s = room.game_state;
  const base = s.stateVersion;
  s.startConfirm = beginStartConfirm(hostId, seatIdsOf(seats), now);
  s.lastStartConfirm = null;
  const sv = await saveGameStateIfUnchanged(room.id, base, s, "waiting");
  await send(room, [{ event: "th_start_confirm", payload: confirmView(s.startConfirm, now)! }], sv);
  return json({ ok: true, confirm: confirmView(s.startConfirm, now), sv });
}

const staleConfirm = () => json({ error: "stale_confirm", message: "這是上一次的開始，請看目前的確認" }, 409);
const confirmIdRequired = () => json({ error: "confirm_id_required", message: "請重新整理後再按" }, 400);

/**
 * 有人按同意：confirmId 要是這一輪的（審伯 R1：舊一輪晚到、重送、存檔衝突後重讀到新一輪，都不能算進新一輪）；
 * 座位變了 → 作廢（409）；倒數結束後按的也算（v3）；四家都同意 → 再檢查一次暫停，沒問題才發牌開局（開局存檔後才扣房卡）
 */
export async function agree(room: Room, seats: ThPlayer[], playerId: string, confirmId: unknown): Promise<Response> {
  const now = clock.now();
  const c = room.game_state.startConfirm;
  if (!c) return json({ error: "no_confirm", message: "房主還沒按開始，或這次開始已經取消" }, 409);
  if (typeof confirmId !== "string" || !confirmId) return confirmIdRequired();
  if (!isCurrentConfirm(c, confirmId)) return staleConfirm();
  const st = startConfirmStatus(c, seatIdsOf(seats), now);
  if (st === "seats_changed") {
    await cancel(room, "seats_changed");
    return json({ error: "seats_changed", message: "這次開始已經取消，請房主重新按開始" }, 409);
  }
  const next = addStartReady(c, playerId);
  const s = room.game_state;
  if (startConfirmStatus(next, seatIdsOf(seats), now) !== "go") {
    if (next === c) return json({ ok: true, confirm: confirmView(c, now) }); // 重複按
    const base = s.stateVersion;
    s.startConfirm = next;
    const sv = await saveGameStateIfUnchanged(room.id, base, s, "waiting");
    await send(room, [{ event: "th_start_ready", payload: { readyIds: next.readyIds, deadline: next.deadline, serverNow: now } }], sv);
    return json({ ok: true, confirm: confirmView(next, now), sv });
  }
  // 四家都同意：發牌前再檢查一次有沒有人被暫停（確認期間老闆剛好暫停了誰也擋得住）
  const blocked = await startBlockedError(seats.map((p) => ({ userId: p.user_id, name: p.name, seat: p.seat })));
  if (blocked) {
    const body = await blocked.clone().json() as { players?: unknown };
    await cancel(room, "suspended", { players: body.players ?? [] });
    return blocked;
  }
  const base = s.stateVersion;
  s.startConfirm = null;
  s.lastStartConfirm = null;
  seatPlayers(s, seats, await getPictureUrls(seats.map((p) => p.user_id))); // 大頭照開局時查一次，查不到是 null、不擋開局
  startHand(s, now);
  touch(s, next.startedBy, now); // 開局＝房主的牌局動作；其他人從開局時間起算
  const sv = await saveAndAnnounce(room, s, base, { autoSeats: [], revealed: false, nextStarted: true }, [], "playing"); // 扣卡在這裡面（存檔成功之後）
  return json({ ok: true, started: true, handNo: s.handNo, arrangeDeadline: s.arrangeDeadline, sv });
}

/**
 * 取消對戰（v3b）：倒數中、倒數後，這次確認座位裡的任何一家都可以按；
 * 不在座位裡的不行（403 not_in_confirm）。confirmId 要是這一輪的（舊一輪的取消重送不能取消新一輪）。
 * 取消後回到等人，lastStartConfirm 記 "cancelled"＋by（提示「X 取消了對戰」，v3c）。
 */
export async function cancelByPlayer(room: Room, seats: ThPlayer[], playerId: string, confirmId: unknown): Promise<Response> {
  const c = await settleStartConfirm(room, seats);
  if (!c) return json({ ok: true, cancelled: false });
  if (typeof confirmId !== "string" || !confirmId) return confirmIdRequired();
  if (!isCurrentConfirm(c, confirmId)) return staleConfirm();
  const block = startCancelBlock(c, playerId);
  if (block) { const e = START_CANCEL_ERRORS[block]; return json({ error: e.error, message: e.message }, e.status); }
  const sv = await cancel(room, "cancelled", { by: playerId });
  return json({ ok: true, cancelled: true, sv });
}
