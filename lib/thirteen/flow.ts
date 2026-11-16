// 十三支牌局流程（純函式：只改傳進來的牌局狀態，不碰資料庫、不送廣播；路由在 lib/thirteen/server.ts 的鎖和樂觀鎖裡呼叫）。
//   開局發牌 → 理牌（截止時間＝開局＋30／45／60 秒，伺服器時間）→ 四家送出或截止時系統代排 → 亮牌結算 → 下一局 → … → 整場結束
// 時間一律由伺服器判定：送出要在截止「之前」才收，截止「之後」才代排，同一個時間點只會有一邊成立。
// 安全：給玩家的畫面（viewFor）亮牌前只有本人的手牌和三墩；別人只看得到「送出了沒」；沒發出去的 13 張永遠不給。
import { deal, type Card } from "./cards";
import { autoArrange, validateSubmission, type ArrangeError, type Arrangement } from "./arrange";
import { revealOrder, scoreRound, type Row, type RoundResult } from "./score";
import type { ThirteenGameState, ThPlayer } from "./db";

/** 伺服器時間（毫秒）；測試會換掉 */
export const clock = { now: () => Date.now() };
/** 發牌（正式：計分引擎的安全洗牌）；測試會換成固定的牌 */
export const dealer = { deal: (): { hands: Card[][]; rest: Card[] } => deal() };
/** 亮牌後多久沒人按「下一局」也自動開（斷線的人不會卡住牌局） */
export const NEXT_HAND_MS = 20_000;

/** 開局：把入座的四家放進牌局狀態（依座位） */
export function seatPlayers(s: ThirteenGameState, seats: ThPlayer[]): void {
  s.players = [...seats].sort((a, b) => a.seat - b.seat)
    .map((p) => ({ id: p.player_id, name: p.name, seat: p.seat, userId: p.user_id, hand: [], arrangement: null, autoArranged: false }));
  s.playerScores = [0, 0, 0, 0];
}

/** 發這一局的牌、設理牌截止時間 */
export function startHand(s: ThirteenGameState, now: number): void {
  const { hands, rest } = dealer.deal();
  s.handNo += 1;
  s.phase = "arranging";
  s.startedAt ??= new Date(now).toISOString();
  s.arrangeDeadline = now + s.settings.arrangeSec * 1000;
  s.rest = rest;
  for (const p of s.players) { p.hand = hands[p.seat]; p.arrangement = null; p.autoArranged = false; }
  s.nextReady = [];
  s.nextHandAt = null;
}

export type SubmitError = ArrangeError | "not_arranging" | "time_up" | "already_submitted";
const SUBMIT_MESSAGES: Record<"not_arranging" | "time_up" | "already_submitted", string> = {
  not_arranging: "現在不是理牌時間",
  time_up: "理牌時間已到，系統已經幫你排好",
  already_submitted: "已經送出，不能再改",
};

/** 送出三墩：只收截止前、還沒送出過的；排法交給引擎檢查（張數、重複、非本人牌、倒水） */
export function submit(s: ThirteenGameState, seat: number, ids: unknown, now: number):
  { ok: true } | { ok: false; error: SubmitError; message: string } {
  const fail = (error: keyof typeof SUBMIT_MESSAGES) => ({ ok: false as const, error, message: SUBMIT_MESSAGES[error] });
  const p = s.players[seat];
  if (p.autoArranged) return fail("time_up"); // 截止時間已過、系統代排了（這一局已經亮牌也是）
  if (p.arrangement) return fail("already_submitted");
  if (s.phase !== "arranging") return fail("not_arranging");
  if (s.arrangeDeadline === null || now >= s.arrangeDeadline) return fail("time_up");
  const v = validateSubmission(p.hand, ids);
  if (!v.ok) return v;
  p.arrangement = v.arrangement;
  return { ok: true };
}

/** 截止時間到了：還沒送出的人由系統代排（斷線的人也是這樣）。回傳代排的座位 */
export function autoArrangeLate(s: ThirteenGameState, now: number): number[] {
  if (s.phase !== "arranging" || s.arrangeDeadline === null || now < s.arrangeDeadline) return [];
  const seats: number[] = [];
  for (const p of s.players) if (!p.arrangement) { p.arrangement = autoArrange(p.hand); p.autoArranged = true; seats.push(p.seat); }
  return seats;
}

/** 四家都有三墩了就亮牌結算：本局結果存進 hands、累計加進 playerScores */
export function revealIfReady(s: ThirteenGameState, now: number): boolean {
  if (s.phase !== "arranging" || s.players.some((p) => !p.arrangement)) return false;
  const result = scoreRound(s.players.map((p) => p.arrangement!));
  s.hands.push({ handNo: s.handNo, result });
  s.playerScores = s.playerScores.map((x, i) => x + result.totals[i]);
  s.phase = "revealed";
  s.nextReady = [];
  s.nextHandAt = now + NEXT_HAND_MS;
  return true;
}

export const isOver = (s: ThirteenGameState) => s.phase === "revealed" && s.hands.length >= s.settings.totalHands;

/** 亮牌後：四家都按了下一局，或時間到了（有人斷線）→ 可以開下一局（整場打完就不開） */
export const shouldStartNext = (s: ThirteenGameState, now: number) =>
  s.phase === "revealed" && !isOver(s) && ((s.nextReady?.length ?? 0) >= s.players.length || (s.nextHandAt != null && now >= s.nextHandAt));

/** 任何請求進來都先跑一次：截止代排 → 亮牌 → 該開下一局就開。回傳這次發生了什麼（給路由決定要不要存檔、廣播） */
export function advance(s: ThirteenGameState, now: number): { autoSeats: number[]; revealed: boolean; nextStarted: boolean } {
  const autoSeats = autoArrangeLate(s, now);
  const revealed = revealIfReady(s, now);
  const nextStarted = !revealed && shouldStartNext(s, now);
  if (nextStarted) startHand(s, now);
  return { autoSeats, revealed, nextStarted };
}

/** 這一局的亮牌內容（亮牌後才能給）：翻牌順序（每墩從最小到最大，同點數一組）、四家三墩、結算、累計 */
export function revealPayload(s: ThirteenGameState): {
  handNo: number; order: Record<Row, number[][]>; arrangements: Arrangement[]; autoArranged: number[];
  result: RoundResult; playerScores: number[]; over: boolean;
} {
  const arrangements = s.players.map((p) => p.arrangement!);
  return {
    handNo: s.handNo,
    order: revealOrder(arrangements),
    arrangements,
    autoArranged: s.players.filter((p) => p.autoArranged).map((p) => p.seat),
    result: s.hands[s.hands.length - 1].result,
    playerScores: s.playerScores,
    over: isOver(s),
  };
}

/** 給某位玩家（playerId＝null：不在桌上的人／觀戰）看的牌局狀態。亮牌前只有本人的手牌和三墩 */
export function viewFor(s: ThirteenGameState, playerId: string | null, now: number) {
  const revealed = s.phase === "revealed";
  const me = playerId ? s.players.find((p) => p.id === playerId) ?? null : null;
  return {
    phase: s.phase,
    handNo: s.handNo,
    settings: s.settings,
    serverNow: now,
    arrangeDeadline: s.arrangeDeadline,
    nextHandAt: s.nextHandAt ?? null,
    nextReady: s.nextReady ?? [],
    playerScores: s.playerScores,
    history: s.hands.map((h) => ({ handNo: h.handNo, totals: h.result.totals })),
    players: s.players.map((p) => ({ id: p.id, name: p.name, seat: p.seat, submitted: p.arrangement !== null })),
    me: me ? { seat: me.seat, hand: me.hand, arrangement: me.arrangement } : null,
    reveal: revealed ? revealPayload(s) : null,
    leaveRequest: s.leaveRequest ?? null,
  };
}
