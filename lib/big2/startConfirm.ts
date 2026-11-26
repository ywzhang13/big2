// 大老二開局確認（老柯 2026-11-20；規則同十三支，判斷用共用的 lib/lobby/startConfirm.ts）：
//   房主按開始 → 發起確認（房間狀態 ready_check，房主自己算同意），倒數 10 秒；四家都同意才發牌（lib/deal-and-start.ts）；
//   2026-11-26 v3：倒數中誰都不能取消；倒數到了還有人沒按 → 繼續等（狀態維持 ready_check），之後到齊就開局；
//   這時四家任一人可以「取消對戰」→ 回到等人（waiting）；確認期間有人退出 → 作廢。
//   沒開成的原因、誰沒按記在 last_start_confirm，等人狀態看得到；房主重新按開始、開局時清掉。
// 大老二沒有 tick：座位變了由讀狀態（保底輪詢、前端倒數到 0 時讀一次）和任何一次同意、發起觸發作廢。
// 寫入都帶 row_version 條件，輸的重讀再做：同時按同意不會漏人、同時到期不會重複作廢。大老二不扣房卡。
// 審伯 2026-11-20 初審四項必修：
//   R1 每一輪確認有自己的編號（id），同意、取消都要帶；對不上＝舊一輪晚到或重送，不能動這一輪（存檔衝突後重讀也一樣）
//   R2 發牌綁定「四家都同意那次寫入之後的版本」，中間有人取消、重新開始、退出，就不開
//   R3 時間一律看「受理時刻」（請求進來那一刻）。v3 起倒數結束後的同意也收；作廢一直撞到衝突 → 回 409 busy，不往下做
//   R4 發起要房主本人、取消要按的那一家本人的入座憑證（seatKey：入座時只回給本人，資料庫只存 sha256），
//      只知道公開的玩家 id、或用別人的憑證，都不能發起或取消。房主退出換人時，新房主用自己入座時的憑證
import { createHash, randomBytes } from "node:crypto";
import { broadcast } from "@/lib/broadcast";
import { dealAndStart } from "@/lib/deal-and-start";
import { addStartReady, beginStartConfirm, isCurrentConfirm, START_CANCEL_ERRORS, startCancelBlock, startConfirmStatus, type StartConfirm } from "@/lib/lobby/startConfirm";
import { loadConfirmRoom, loadSeatIds, loadSeatKeyHash, updateRoomIf, type Big2CancelReason, type Big2ConfirmRoom, type Big2StartConfirm } from "@/lib/big2/startConfirmStore";

const MAX_ATTEMPTS = 8;
const res = (body: unknown, status = 200) => Response.json(body, { status });
const busy = () => res({ error: "busy", message: "同時有太多動作，請再試一次" }, 409);
const staleConfirm = () => res({ error: "stale_confirm", message: "這是上一次的開始，請看目前的確認" }, 409);
const confirmIdRequired = () => res({ error: "confirm_id_required", message: "請重新整理後再按" }, 400);
/** 入座憑證：入座時產生、只回給本人；資料庫只存 sha256 */
export const newSeatKey = () => randomBytes(24).toString("base64url");
export const hashSeatKey = (k: string) => createHash("sha256").update(k).digest("hex");
const notHost = (verb: string) => res({ error: "not_host", message: `只有房主可以${verb}` }, 403);
/** 是不是這個座位本人：帶的憑證對得上 playerId 的座位（沒有憑證、上線前入座沒有雜湊的都不算）。
 *  讀狀態拿手牌、出牌、過也用這個（2026-11-27 手牌不外流：只知道房號、玩家 id 的人拿不到也動不了別人的牌） */
export async function isSeatInPerson(roomId: string, playerId: string, seatKey: unknown): Promise<boolean> {
  if (typeof seatKey !== "string" || !seatKey) return false;
  const h = await loadSeatKeyHash(roomId, playerId);
  return !!h && h === hashSeatKey(seatKey);
}
/** 是不是房主本人：playerId 是房主、而且是這個座位本人 */
const isHostInPerson = async (roomId: string, hostId: string | null, playerId: string, seatKey: unknown) =>
  !!hostId && hostId === playerId && (await isSeatInPerson(roomId, playerId, seatKey));

/** 給前端的確認狀態（沒有確認＝null；不含取消憑證的雜湊） */
export const confirmView = (c: StartConfirm | null | undefined, now: number) =>
  c ? { id: c.id, startedBy: c.startedBy, readyIds: c.readyIds, seatIds: c.seatIds, deadline: c.deadline, serverNow: now } : null;

const cancelPatch = (c: StartConfirm | null, reason: Big2CancelReason, now: number, by?: string) => ({
  status: "waiting", ready_players: [], start_confirm: null,
  last_start_confirm: { reason, missingIds: c ? c.seatIds.filter((id) => !c.readyIds.includes(id)) : [], at: now, ...(by ? { by } : {}) },
});

/**
 * 確認在 now（受理時刻）座位變了就作廢（回到等人、廣播 ready_check_cancelled）；倒數結束還沒到齊不作廢（v3）。
 * 回傳處理後的房間；房間不見了回 null；作廢一直撞到別人的寫入、重試用完回 "busy"（呼叫端不能把沒處理掉的過期確認往下用）。
 */
export async function settleBig2Confirm(roomId: string, now: number = Date.now()): Promise<Big2ConfirmRoom | null | "busy"> {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const room = await loadConfirmRoom(roomId);
    const c = room?.start_confirm;
    if (!room || room.status !== "ready_check" || !c) return room;
    const st = startConfirmStatus(c, await loadSeatIds(roomId), now);
    if (st !== "seats_changed") return room;
    const reason: Big2CancelReason = "seats_changed";
    const patch = cancelPatch(c, reason, now);
    const rv = await updateRoomIf(roomId, room.row_version, ["ready_check"], patch);
    if (rv === null) continue; // 別人先動了：重讀
    await broadcast(room.code, "ready_check_cancelled", { reason, missingIds: patch.last_start_confirm.missingIds });
    return { ...room, status: "waiting", start_confirm: null, last_start_confirm: patch.last_start_confirm, row_version: rv };
  }
  return "busy";
}

/** 房主按開始（要帶房主本人的入座憑證）：發起確認；已經有一個還在倒數的就回那一個，不重新計時 */
export async function beginBig2Confirm(roomId: string, playerId: string, seatKey: unknown): Promise<Response> {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const now = Date.now();
    const room = await settleBig2Confirm(roomId, now);
    if (room === "busy") return busy();
    if (!room) return res({ error: "找不到房間" }, 404);
    if (!(await isHostInPerson(roomId, room.host_id, playerId, seatKey))) return notHost("開始");
    if (room.status === "ready_check" && room.start_confirm) return res({ ok: true, success: true, confirm: confirmView(room.start_confirm, now) });
    if (room.status !== "waiting" && room.status !== "ready_check") return res({ error: "started", message: "已經開始了" }, 400);
    const seats = await loadSeatIds(roomId);
    if (seats.length < 4) return res({ error: "not_full", message: "需要4位玩家才能開始" }, 400);
    const c: Big2StartConfirm = beginStartConfirm(playerId, seats, now);
    const rv = await updateRoomIf(roomId, room.row_version, ["waiting", "ready_check"],
      { status: "ready_check", ready_players: c.readyIds, start_confirm: c, last_start_confirm: null });
    if (rv === null) continue;
    await broadcast(room.code, "ready_check", { hostId: playerId, ...confirmView(c, now) });
    return res({ ok: true, success: true, confirm: confirmView(c, now) });
  }
  return busy();
}

/** 有人按同意（confirmId＝這一輪的編號）：四家都同意 → 發牌開局 */
export async function agreeBig2(roomId: string, playerId: string, confirmId: unknown): Promise<Response> {
  const acceptedAt = Date.now(); // 受理時刻：之後查資料庫、重試花的時間不算（審伯 R3）
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const room = await settleBig2Confirm(roomId, acceptedAt);
    if (room === "busy") return busy();
    if (!room) return res({ error: "找不到房間" }, 404);
    const seats = await loadSeatIds(roomId);
    if (!seats.includes(playerId)) return res({ error: "not_in_room", message: "你不在這個房間" }, 403);
    if (room.status === "playing" || room.status === "finished") return res({ error: "started", message: "已經開局了" }, 409);
    const c = room.start_confirm;
    if (room.status !== "ready_check" || !c) {
      const expired = room.last_start_confirm?.reason === "timeout";
      return res({ error: expired ? "expired" : "no_confirm", message: "這次開始已經取消，請房主重新按開始" }, 409);
    }
    if (typeof confirmId !== "string" || !confirmId) return confirmIdRequired();
    if (!isCurrentConfirm(c, confirmId)) return staleConfirm(); // 舊一輪的同意（含存檔衝突後重讀到新一輪）
    // 先用受理時刻確認座位沒變，才加入同意（倒數結束後的同意也收，v3）
    if (startConfirmStatus(c, seats, acceptedAt) === "seats_changed") continue; // 下一圈 settle 會作廢
    const next = addStartReady(c, playerId);
    let boundVersion = room.row_version;
    if (next !== c) {
      const rv = await updateRoomIf(roomId, room.row_version, ["ready_check"], { ready_players: next.readyIds, start_confirm: next });
      if (rv === null) continue; // 同時有人按：重讀再加，不會蓋掉別人
      boundVersion = rv;
      await broadcast(room.code, "player_ready", { playerId, readyCount: next.readyIds.length, readyIds: next.readyIds, confirmId: next.id, deadline: next.deadline, serverNow: acceptedAt });
    }
    if (startConfirmStatus(next, seats, acceptedAt) !== "go") return res({ allReady: false, confirm: confirmView(next, acceptedAt) });
    // 發牌綁定「四家都同意的那個版本」：中間有人取消、重新開始、退出，版本變了就不開（審伯 R2）
    if (await dealAndStart(roomId, room.code, undefined, ["ready_check"], boundVersion)) return res({ allReady: true });
    const after = await loadConfirmRoom(roomId);
    if (after?.status === "playing") return res({ allReady: true }); // 同一輪另一個同意的請求先發了牌
    return res({ error: "room_changed", message: "這次開始已經取消或有人離開，請看目前的狀態" }, 409);
  }
  return busy();
}

/**
 * 取消對戰（v3b）：要這一輪的編號和按的那一家本人的入座憑證；倒數中、倒數後，這次確認座位裡任何一家都可以。
 * 不在座位裡 403 not_in_confirm、憑證不對 403 not_your_seat。取消後 last_start_confirm 記 "cancelled"＋by（提示「X 取消了對戰」，v3c）
 */
export async function cancelBig2Confirm(roomId: string, playerId: string, confirmId: unknown, seatKey: unknown): Promise<Response> {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const now = Date.now();
    const room = await settleBig2Confirm(roomId, now);
    if (room === "busy") return busy();
    if (!room) return res({ error: "找不到房間" }, 404);
    if (!(await isSeatInPerson(roomId, playerId, seatKey))) return res({ error: "not_your_seat", message: "請重新整理後再按" }, 403);
    const c = room.start_confirm;
    if (room.status !== "ready_check" || !c) return res({ ok: true, cancelled: false });
    if (!isCurrentConfirm(c, confirmId)) return staleConfirm(); // 編號對不上＝舊一輪的取消（R1）
    const block = startCancelBlock(c, playerId);
    if (block) { const e = START_CANCEL_ERRORS[block]; return res({ error: e.error, message: e.message }, e.status); }
    const patch = cancelPatch(c, "cancelled", now, playerId);
    if ((await updateRoomIf(roomId, room.row_version, ["ready_check"], patch)) === null) continue;
    await broadcast(room.code, "ready_check_cancelled", { reason: "cancelled", by: playerId, missingIds: patch.last_start_confirm.missingIds });
    return res({ ok: true, cancelled: true });
  }
  return busy();
}
