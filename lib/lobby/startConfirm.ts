// 開局確認（三款共用的規則，純函式；老柯 2026-11-20，老闆定案；2026-11-26 v3 老闆改規則）：
//   ・房主按「開始遊戲」＝發起開局確認（房主自己算同意），倒數 START_CONFIRM_MS（10 秒）
//   ・四家都按同意 → 發牌開局（真的發牌之後才扣房卡）
//   ・從倒數第一秒起，這次確認座位裡的任何一家都可以按「取消對戰」→ 回到等人（lastStartConfirm 記 "timeout"＋誰沒按）（v3b 2026-11-27 老闆：取消一開始就留著）
//   ・倒數到了還有人沒按 → **視窗不關、繼續等**還沒按的人（"overtime"），之後最後一人按同意就開局
//   ・確認期間座位變了（有人離開、換人）→ 這次確認作廢，回到等人狀態
// 時間一律看伺服器（now 由呼叫端給）；前端的倒數只是提示。十三支先用（lib/thirteen），大老二、麻將之後接同一套。
export const START_CONFIRM_MS = 10_000;

export interface StartConfirm {
  id: string;          // 這一輪確認的編號（每次發起都是新的）：同意、取消都要帶，舊一輪晚到或重送的請求對不上就不算（審伯 2026-11-20 R1）
  startedBy: string;   // 發起的房主（玩家 id）
  seatIds: string[];   // 發起當下坐著的四家玩家 id（依座位）；之後座位變了這次確認就作廢
  readyIds: string[];  // 已經同意的玩家 id（房主發起時自己算同意）
  deadline: number;    // 截止時間（伺服器毫秒）
}

/** 房主發起：房主自己算同意；id 不給就產生一個新的 */
export function beginStartConfirm(hostId: string, seatIds: string[], now: number, id: string = globalThis.crypto.randomUUID()): StartConfirm {
  return { id, startedBy: hostId, seatIds: [...seatIds], readyIds: [hostId], deadline: now + START_CONFIRM_MS };
}

/** 請求帶的確認編號是不是這一輪的（沒帶、或對不上＝舊一輪的請求，不能動這一輪） */
export const isCurrentConfirm = (c: StartConfirm | null | undefined, confirmId: unknown): c is StartConfirm =>
  !!c && typeof confirmId === "string" && confirmId.length > 0 && c.id === confirmId;

/** 同意（重複按不重複記；不在這次確認的座位裡的人不算） */
export function addStartReady(c: StartConfirm, playerId: string): StartConfirm {
  if (!c.seatIds.includes(playerId) || c.readyIds.includes(playerId)) return c;
  return { ...c, readyIds: [...c.readyIds, playerId] };
}

const sameSeats = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("\u0000") === [...b].sort().join("\u0000");

/**
 * 這次確認現在的狀態（先看座位、再看全員、最後看時間）：
 *   "seats_changed"：座位跟發起時不一樣（有人離開、換人）→ 作廢
 *   "go"：發起時的四家都同意了 → 發牌（倒數結束後才到齊也開）
 *   "overtime"：倒數結束、還有人沒同意 → 不作廢、繼續等（v3）
 *   "waiting"：還在倒數
 */
export function startConfirmStatus(c: StartConfirm, currentSeatIds: string[], now: number): "seats_changed" | "go" | "overtime" | "waiting" {
  if (!sameSeats(c.seatIds, currentSeatIds)) return "seats_changed";
  if (c.seatIds.every((id) => c.readyIds.includes(id))) return "go";
  if (now >= c.deadline) return "overtime";
  return "waiting";
}

/**
 * 這個人能不能「取消對戰」（v3b：倒數中、倒數後都可以）：null＝可以。
 *   "not_in_confirm"：不在這次確認的座位裡
 */
export function startCancelBlock(c: StartConfirm, playerId: string): "not_in_confirm" | null {
  if (!c.seatIds.includes(playerId)) return "not_in_confirm";
  return null;
}
/** 取消被擋時回給前端的錯誤（三款共用） */
export const START_CANCEL_ERRORS = {
  not_in_confirm: { status: 403, error: "not_in_confirm", message: "你不在這次開局的座位裡" },
} as const;
