// 十三支牌局流程（純函式：只改傳進來的牌局狀態，不碰資料庫、不送廣播；路由在 lib/thirteen/server.ts 的鎖和樂觀鎖裡呼叫）。
//   開局發牌 → 理牌（截止時間＝開局＋15～120 秒（每 15 秒一階），伺服器時間）→ 四家送出或截止時系統代排 → 亮牌結算 → 下一局 → … → 整場結束
// 時間一律由伺服器判定：送出要在截止「之前」才收，截止「之後」才代排，同一個時間點只會有一邊成立。
// 安全：給玩家的畫面（viewFor）亮牌前只有本人的手牌和三墩；別人只看得到「送出了沒」；沒發出去的 13 張永遠不給。
import { deal, type Card } from "./cards";
import { autoArrange, validateSubmission, type ArrangeError, type Arrangement } from "./arrange";
import { bonusOf, revealOrder, ROWS, scoreRound, SCORING, type Row, type RoundResult } from "./score";
import { CAT_NAME } from "./hand";
import type { ThirteenGameState, ThPlayer } from "./db";

/** 伺服器時間（毫秒）；測試會換掉 */
export const clock = { now: () => Date.now() };
/** 發牌（正式：計分引擎的安全洗牌）；測試會換成固定的牌 */
export const dealer = { deal: (): { hands: Card[][]; rest: Card[] } => deal() };
// ---- 亮牌 → 結算 → 下一局（阿哲 2026-11-18 拍板）----
// 亮牌時伺服器記三個時間（伺服器毫秒）：revealedAt 亮牌、settleAt 結算面板出現（＝revealedAt＋亮牌演出長度）、
// nextHandAt 自動開下一局（＝settleAt＋30 秒）。四家都按確認就馬上開；有人沒按（例如斷線）到 nextHandAt 自動開。
// 前端照 settleAt 顯示結算面板（用伺服器時間換算），和伺服器用同一個 revealDurationMs，兩邊不會對不上。
/** 結算面板出現後，等多久沒人按確認也自動開下一局 */
export const SETTLE_WAIT_MS = 30_000;
/** 亮牌演出各段長度（毫秒），照小宜〈十三支畫面設計說明 v5 增補〉第 4 節時間軸 */
export const REVEAL_TIMING = { START_MS: 1200, ROW_MS: 2600, SPECIAL_MS: 900, GUN_MS: 1000, HOME_RUN_MS: 1900 } as const;
/** 從開始比牌到結算面板出現：開始比牌＋三墩＋每個特效牌型（衝三、中尾墩鐵支／同花順／五龍）＋每組打槍＋全壘打 */
export function revealDurationMs(result: RoundResult): number {
  const t = REVEAL_TIMING;
  const specials = result.values.reduce((n, v) => n + ROWS.filter((row) => bonusOf(row, v[row]) > 0).length, 0);
  const guns = result.pairs.filter((p) => p.gunner !== null).length;
  return t.START_MS + 3 * t.ROW_MS + specials * t.SPECIAL_MS + guns * t.GUN_MS + (result.homeRun !== null ? t.HOME_RUN_MS : 0);
}
/** 亮牌到自動開下一局最長要多久（四家三墩都是特效牌型、六組都打槍、全壘打，再加 30 秒）；測試推進時間用 */
export const NEXT_HAND_MAX_MS = REVEAL_TIMING.START_MS + 3 * REVEAL_TIMING.ROW_MS + 12 * REVEAL_TIMING.SPECIAL_MS + 6 * REVEAL_TIMING.GUN_MS
  + REVEAL_TIMING.HOME_RUN_MS + SETTLE_WAIT_MS;

// ---- 每局統計（阿哲 2026-11-18：打槍、全壘打等改由後端每局記錄，前端不再自己累計）----
/** 一家這一局的明細（v5 本局結算的左欄）：墩分＋各特殊加分＋打槍分＋全壘打分＝total（這局總分） */
export interface HandStat {
  rows: number;                                  // 墩分：三道兩兩比，贏 +1、輸 −1
  bonuses: { name: string; points: number }[];   // 特殊加分：衝三、中墩鐵支、尾墩五龍…；自己拿到的正、付給別人的負（同名合併）
  guns: number; gunned: number; gunPoints: number;  // 打槍幾家、被幾家打槍、打槍的分數
  homeRun: boolean; homeRunned: boolean; homeRunPoints: number; // 全壘打、被全壘打、全壘打的分數
  total: number;
}
const ROW_LABEL: Record<Row, string> = { front: "頭墩", middle: "中墩", back: "尾墩" };
const bonusName = (row: Row, cat: number) => (row === "front" ? "衝三" : ROW_LABEL[row] + CAT_NAME[cat]);
/** 這局每家的明細（依座位） */
export function handStats(result: RoundResult): HandStat[] {
  return [0, 1, 2, 3].map((seat) => {
    let rows = 0;
    const bonus = new Map<string, number>();
    for (const p of result.pairs) {
      if (p.a !== seat && p.b !== seat) continue;
      for (const row of ROWS) {
        const w = p.rows[row].winner;
        if (w === null) continue;
        rows += w === seat ? 1 : -1;
        if (p.rows[row].bonus > 0) {
          const name = bonusName(row, result.values[w][row].cat);
          bonus.set(name, (bonus.get(name) ?? 0) + (w === seat ? p.rows[row].bonus : -p.rows[row].bonus));
        }
      }
    }
    const guns = result.pairs.filter((p) => p.gunner === seat).length;
    const gunned = result.pairs.filter((p) => p.gunner !== null && p.gunner !== seat && (p.a === seat || p.b === seat)).length;
    const homeRun = result.homeRun === seat, homeRunned = result.homeRun !== null && !homeRun;
    const bonuses = [...bonus].filter(([, v]) => v !== 0).map(([name, points]) => ({ name, points }));
    const gunPoints = (guns - gunned) * SCORING.GUN_PENALTY;
    const homeRunPoints = homeRun ? 3 * SCORING.HOME_RUN_PENALTY : homeRunned ? -SCORING.HOME_RUN_PENALTY : 0;
    return { rows, bonuses, guns, gunned, gunPoints, homeRun, homeRunned, homeRunPoints, total: result.totals[seat] };
  });
}
/** 整場累計（v5 總結算的右欄）：每家打槍、被打槍、全壘打、被全壘打次數和總分（依座位） */
export function matchStats(s: ThirteenGameState): { guns: number; gunned: number; homeRuns: number; homeRunned: number; total: number }[] {
  return [0, 1, 2, 3].map((seat) => {
    const per = s.hands.map((h) => (h.stats ?? handStats(h.result))[seat]);
    return { guns: per.reduce((n, x) => n + x.guns, 0), gunned: per.reduce((n, x) => n + x.gunned, 0),
      homeRuns: per.filter((x) => x.homeRun).length, homeRunned: per.filter((x) => x.homeRunned).length, total: s.playerScores[seat] ?? 0 };
  });
}

// ---- 閒置不計票（精神同麻將 lib/mahjong/leave/rules.ts：超過 3 分鐘沒做牌局動作的人不計票，剩下的人都同意就解散）----
// 和麻將刻意不同的兩點（審伯 2026-11-17 建議寫明，前端請照十三支的規則做，不要照麻將）：
//   ① 閒置的判定：麻將看「現在輪到他、卻卡住超過 3 分鐘」；十三支沒有輪流（四家同時理牌、截止自動代排），改看「這個人最後一次牌局動作」
//      ——所以十三支在等別人的人也可能被判閒置，只要他 3 分鐘沒自己送牌、沒按下一局
//   ② 判定的時機：麻將只在發起、投票、發起者重新確認時判定；十三支每次讀狀態、tick、送出、投票都判定，
//      投票途中有人變成閒置，下一次讀狀態就可能成立並解散（不必有人再投票）；有人的不同意恢復算數時也立刻取消投票
// 每人只留最後一票（改投會換掉先前的票）。
// 十三支的「牌局動作」：截止前自己送出三墩、亮牌後按「下一局」、房主開局。被系統代排（截止前沒送出）、讀狀態、發起或投票都不算。
// 計時起點：這位玩家最後一次牌局動作；還沒做過就從這場開局時間算。斷線的人每局都被代排、不會按下一局，3 分鐘後就不計票，
// 投票不會因為他卡住。每次讀狀態、tick、投票都重新判定（時間一到不必有人再投票）。
/** 超過多久沒做牌局動作就不計票（毫秒）：3 分鐘，和麻將 IDLE_VOTE_MS 一樣 */
export const IDLE_VOTE_MS = 3 * 60 * 1000;

/** 這位玩家剛做了牌局動作 */
export function touch(s: ThirteenGameState, playerId: string, now: number): void {
  s.lastActive = { ...(s.lastActive ?? {}), [playerId]: now };
}
const lastActionAt = (s: ThirteenGameState, playerId: string) =>
  s.lastActive?.[playerId] ?? (s.startedAt ? Date.parse(s.startedAt) : null);
/** 超過 3 分鐘沒做牌局動作（還沒開局的房間沒有人算閒置） */
export const isIdle = (s: ThirteenGameState, playerId: string, now: number) => {
  const at = lastActionAt(s, playerId);
  return at !== null && now - at > IDLE_VOTE_MS;
};

export interface LeaveEval {
  result: "granted" | "denied" | "vote";
  needed: number;          // 需要同意的人數（沒閒置的其他三家）
  approvedCount: number;   // 其中已經同意的
  idleSeats: number[];     // 不計票的座位（發起人除外）
  requesterIdle: boolean;
}
/** 解散投票現況：沒閒置的其他玩家都同意 → granted；其中有人不同意 → denied；閒置的人投什麼都不算。發起人自己閒置時，至少要有一位有投票權的人同意 */
export function evaluateLeave(s: ThirteenGameState, now: number): LeaveEval | null {
  const lr = s.leaveRequest;
  if (!lr) return null;
  const others = s.players.filter((p) => p.id !== lr.requesterId);
  const eligible = others.filter((p) => !isIdle(s, p.id, now));
  const approved = eligible.filter((p) => lr.approvedBy.includes(p.id)).length;
  const denied = eligible.some((p) => (lr.deniedBy ?? []).includes(p.id));
  const requesterIdle = isIdle(s, lr.requesterId, now);
  const result = denied ? "denied" : approved === eligible.length && (!requesterIdle || approved > 0) ? "granted" : "vote";
  return { result, needed: eligible.length, approvedCount: approved,
    idleSeats: others.filter((p) => isIdle(s, p.id, now)).map((p) => p.seat), requesterIdle };
}

/**
 * 投票已經被否決就取消（審伯 2026-11-17 必修）：閒置時按的不同意先記著不算，那個人一做牌局動作恢復投票權，
 * 他的不同意就算數——這時要立刻取消投票，不能讓投票停在「否決」卻沒人取消（之後別人再同意也不能解散、也不能重新發起）。
 * 每個可能讓人恢復投票權的地方（送出、按下一局）和每次推進牌局都要呼叫。回傳是否取消了
 */
export function cancelIfDenied(s: ThirteenGameState, now: number): boolean {
  if (evaluateLeave(s, now)?.result !== "denied") return false;
  s.leaveRequest = null;
  return true;
}

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
  s.revealedAt = null;
  s.settleAt = null;
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
  s.hands.push({ handNo: s.handNo, result, stats: handStats(result) });
  s.playerScores = s.playerScores.map((x, i) => x + result.totals[i]);
  s.phase = "revealed";
  s.nextReady = [];
  s.revealedAt = now;
  s.settleAt = now + revealDurationMs(result);
  s.nextHandAt = s.settleAt + SETTLE_WAIT_MS;
  return true;
}

export const isOver = (s: ThirteenGameState) => s.phase === "revealed" && s.hands.length >= s.settings.totalHands;

/** 亮牌後：四家都按了確認（下一局），或到了 nextHandAt（結算面板出現後 30 秒；有人沒按、斷線）→ 可以開下一局（整場打完就不開） */
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

/**
 * 這一局的亮牌內容（亮牌後才能給）：翻牌順序（每墩從最小到最大，同點數一組）、四家三墩、結算、每家明細、累計，
 * 和亮牌、結算面板出現、自動開下一局的伺服器時間
 */
export function revealPayload(s: ThirteenGameState): {
  handNo: number; order: Record<Row, number[][]>; arrangements: Arrangement[]; autoArranged: number[];
  result: RoundResult; stats: HandStat[]; playerScores: number[]; over: boolean;
  revealedAt: number | null; settleAt: number | null; nextHandAt: number | null;
} {
  const arrangements = s.players.map((p) => p.arrangement!);
  const last = s.hands[s.hands.length - 1];
  return {
    handNo: s.handNo,
    order: revealOrder(arrangements),
    arrangements,
    autoArranged: s.players.filter((p) => p.autoArranged).map((p) => p.seat),
    result: last.result,
    stats: last.stats ?? handStats(last.result),
    playerScores: s.playerScores,
    over: isOver(s),
    revealedAt: s.revealedAt ?? null,
    settleAt: s.settleAt ?? null,
    nextHandAt: isOver(s) ? null : s.nextHandAt ?? null,
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
    stats: matchStats(s),
    players: s.players.map((p) => ({ id: p.id, name: p.name, seat: p.seat, submitted: p.arrangement !== null })),
    me: me ? { seat: me.seat, hand: me.hand, arrangement: me.arrangement } : null,
    reveal: revealed ? revealPayload(s) : null,
    leaveRequest: s.leaveRequest ? { requesterId: s.leaveRequest.requesterId, approvedBy: s.leaveRequest.approvedBy, ...evaluateLeave(s, now)! } : null,
  };
}
