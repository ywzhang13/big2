// 解散投票（老闆 2026-11-13）：超過 IDLE_VOTE_MS 沒有任何操作的玩家，解散投票不需要他同意；
// 其餘沒閒置的人全部同意就解散（照原本的中途解散流程記分）。純函式，前後端都能用。
//   ・「操作」：出牌、摸牌、吃碰槓胡、按下一局、發起／投票、聊天、丟互動（不論是不是輪到他）。
//     遊戲操作的時間記在牌局狀態 lastActive（第一次記的時間記在 activeSince）（lib/mahjong/access.ts seatOwnerError 順手記，跟著那次動作的存檔寫進去）；
//     聊天、互動的時間在投票判斷當下從冷卻紀錄讀（lib/mahjong/leave/store.ts），平常不多寫任何東西。
//   ・閒置的人一有操作（包括投票本身）就立刻恢復投票權。
//   ・只有在有人發起、投票、或發起者按「重新確認」時才判斷；時間到了不會自己解散。
//   ・至少要有一位沒閒置的人同意（發起者本人算）：大家都閒置時不會解散。
import type { MahjongGameState } from "../gameState";

/** 多久沒操作就不計票（毫秒）：3 分鐘 */
export const IDLE_VOTE_MS = 3 * 60 * 1000;

export interface LeaveEval {
  result: "granted" | "denied" | "vote";
  needed: number;            // 需要同意的人數（沒閒置的其他玩家）
  approvedCount: number;     // 其中已經同意的
  deniedCount: number;
  idle: { playerId: string; seat: number; name: string; idleMs: number }[]; // 超過時間沒操作、不計票的其他玩家
  requesterIdle: boolean;
}

/**
 * 某位玩家最後一次操作的時間：牌局操作和聊天／互動取較晚的。
 * 這房從沒記到他：用「這房開始記錄的時間」activeSince（上線時正在打的房，開始記錄滿 3 分鐘他還沒動才算閒置）；
 * 這房完全沒有記錄（舊房、測試資料）：當成有在操作，維持原本「要大家同意」的規則。
 */
export function lastActiveAt(s: Pick<MahjongGameState, "lastActive" | "activeSince">, playerId: string, social: Record<string, number> = {}): number {
  const own = s.lastActive?.[playerId] ?? s.activeSince ?? Number.POSITIVE_INFINITY;
  return Math.max(own, social[playerId] ?? 0);
}

export function evaluateLeave(s: MahjongGameState, now: number, social: Record<string, number> = {}): LeaveEval | null {
  const lr = s.leaveRequest;
  if (!lr) return null;
  const idleOf = (pid: string) => now - lastActiveAt(s, pid, social);
  const others = s.players.filter((p) => p.id !== lr.requesterId);
  const idle = others.filter((p) => idleOf(p.id) > IDLE_VOTE_MS).map((p) => ({ playerId: p.id, seat: p.seat, name: p.name, idleMs: idleOf(p.id) }));
  const active = others.filter((p) => idleOf(p.id) <= IDLE_VOTE_MS);
  const approvedActive = active.filter((p) => lr.approvedBy.includes(p.id));
  const requesterIdle = idleOf(lr.requesterId) > IDLE_VOTE_MS;
  const deniedCount = lr.deniedBy.length;
  let result: LeaveEval["result"] = "vote";
  if (deniedCount > 0) result = "denied";
  else if (approvedActive.length === active.length && (!requesterIdle || approvedActive.length > 0)) result = "granted";
  return { result, needed: active.length, approvedCount: approvedActive.length, deniedCount, idle, requesterIdle };
}

/** 這位玩家剛做了一個操作：記下時間（直接改傳進來的牌局狀態，跟著這次動作的存檔一起寫） */
export function touchActive(s: Partial<Pick<MahjongGameState, "lastActive" | "activeSince">>, playerId: string, now: number = Date.now()): void {
  s.activeSince ??= now;
  s.lastActive = { ...(s.lastActive ?? {}), [playerId]: now };
}

/** 還原 touchActive 前的值（「看狀態」「重新確認」這種不算操作的請求用） */
export function restoreActive(s: Partial<Pick<MahjongGameState, "lastActive">>, playerId: string, before: number | undefined): void {
  if (!s.lastActive) return;
  if (before === undefined) delete s.lastActive[playerId];
  else s.lastActive[playerId] = before;
}
