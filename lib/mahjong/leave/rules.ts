// 解散投票（老闆 2026-11-13 定案：只看打牌）：輪到某位玩家做牌局動作，從輪到他開始超過 IDLE_VOTE_MS 還沒做，
// 他就失去解散投票權；一位卡住扣一位、兩位扣兩位，以此類推。剩下有投票權的在場玩家全部同意，就照中途解散流程關房。純函式，前後端都能用。
//   ・「輪到他的牌局動作」：
//       打牌中、沒有等待窗口 → 輪到的那家要摸牌或打牌
//       有人打出牌、等吃碰槓胡的窗口（含搶槓） → 還沒決定（沒按過）的每一家
//       七搶一等待 → 可以搶的那家
//       一局結束、整場還沒打完 → 還沒按「下一局」的每一家
//     正在等別人的玩家本來就輪不到，不算卡住。聊天、丟互動、發起或投票都不算牌局動作。
//   ・「從輪到他開始」：用牌局最後一次動作的時間（lastActive 裡最晚的那個；每次牌局動作由 lib/mahjong/access.ts seatOwnerError 記下，
//     跟著那次動作的存檔寫進去）。輪到他之後牌局就停在等他，所以最後一次動作的時間就是輪到他的時間；
//     有好幾家同時要決定時，任何一家先動作都會重新起算（只會更晚判卡住，不會提早）。
//   ・卡住的人一做牌局動作，最後動作時間就更新、輪到誰也變了，立刻恢復投票權。
//   ・只有在發起、投票、發起者重新確認時才判斷；時間到了不會自己解散。至少要有一位有投票權的人同意（發起者本人有投票權就算）。
//   ・沒有卡住的人可以投票；卡住的人投的同意或不同意都不計。
//   ・這房還沒有任何牌局動作紀錄（上線前就在打的舊房）：判斷不了誰卡住，一律不排除任何人，照舊要全員同意。
import type { MahjongGameState } from "../gameState";

/** 輪到他超過多久沒動作就不計票（毫秒）：3 分鐘 */
export const IDLE_VOTE_MS = 3 * 60 * 1000;

export interface LeaveEval {
  result: "granted" | "denied" | "vote";
  needed: number;            // 需要同意的人數（有投票權的其他玩家）
  approvedCount: number;     // 其中已經同意的
  deniedCount: number;       // 有投票權的人裡按不同意的
  idle: { playerId: string; seat: number; name: string; idleMs: number }[]; // 輪到他超過時間沒動作、不計票的其他玩家
  requesterIdle: boolean;
  activityUnknown: boolean;  // 這房還沒有牌局動作紀錄：判斷不了，一律要全員同意
}

/** 牌局最後一次動作的時間；沒有紀錄回 null */
export function lastGameActionAt(s: Pick<MahjongGameState, "lastActive" | "activeSince">): number | null {
  const times = Object.values(s.lastActive ?? {});
  if (times.length === 0) return s.activeSince ?? null;
  return Math.max(...times);
}

/** 現在輪到這位玩家做牌局動作嗎 */
export function owesAction(s: MahjongGameState, playerId: string): boolean {
  const p = s.players.find((x) => x.id === playerId);
  if (!p) return false;
  if (s.status === "finished") return !s.gameOver && !(s.nextGameReady ?? []).includes(playerId);
  if (s.status !== "playing") return false;
  if (s.pendingFlowerRob) return s.pendingFlowerRob.robberSeat === p.seat;
  if (s.pendingActions) return s.pendingActions.potentialActors.includes(p.seat) && !s.pendingActions.passedActors.includes(p.seat);
  return s.currentTurn === p.seat;
}

export function evaluateLeave(s: MahjongGameState, now: number): LeaveEval | null {
  const lr = s.leaveRequest;
  if (!lr) return null;
  const last = lastGameActionAt(s);
  const waited = last === null ? 0 : now - last;
  const stuck = (pid: string) => last !== null && waited > IDLE_VOTE_MS && owesAction(s, pid);
  const others = s.players.filter((p) => p.id !== lr.requesterId);
  const idle = others.filter((p) => stuck(p.id)).map((p) => ({ playerId: p.id, seat: p.seat, name: p.name, idleMs: waited }));
  const eligible = others.filter((p) => !stuck(p.id));
  const approved = eligible.filter((p) => lr.approvedBy.includes(p.id));
  const deniedCount = eligible.filter((p) => lr.deniedBy.includes(p.id)).length;
  const requesterIdle = stuck(lr.requesterId);
  let result: LeaveEval["result"] = "vote";
  if (deniedCount > 0) result = "denied";
  else if (approved.length === eligible.length && (!requesterIdle || approved.length > 0)) result = "granted";
  return { result, needed: eligible.length, approvedCount: approved.length, deniedCount, idle, requesterIdle, activityUnknown: last === null };
}

/** 這位玩家剛做了一個牌局動作：記下時間（直接改傳進來的牌局狀態，跟著這次動作的存檔一起寫） */
export function touchActive(s: Partial<Pick<MahjongGameState, "lastActive" | "activeSince">>, playerId: string, now: number = Date.now()): void {
  s.activeSince ??= now;
  s.lastActive = { ...(s.lastActive ?? {}), [playerId]: now };
}

/** 還原 touchActive 前的值（發起、投票、看狀態、重新確認這些不是牌局動作的請求用） */
export function restoreActive(s: Partial<Pick<MahjongGameState, "lastActive" | "activeSince">>, playerId: string, before: { at: number | undefined; since: number | undefined }): void {
  if (s.lastActive) {
    if (before.at === undefined) delete s.lastActive[playerId];
    else s.lastActive[playerId] = before.at;
    if (Object.keys(s.lastActive).length === 0) delete s.lastActive;
  }
  if (before.since === undefined) delete s.activeSince;
  else s.activeSince = before.since;
}

/** 讀出 touchActive 前的值（給 restoreActive） */
export const activeBefore = (s: Partial<Pick<MahjongGameState, "lastActive" | "activeSince">>, playerId: string) =>
  ({ at: s.lastActive?.[playerId], since: s.activeSince });
