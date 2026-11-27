// 十三支牌局流程（純函式：只改傳進來的牌局狀態，不碰資料庫、不送廣播；路由在 lib/thirteen/server.ts 的鎖和樂觀鎖裡呼叫）。
//   開局發牌 → 理牌（截止時間＝開局＋15～120 秒（每 15 秒一階），伺服器時間）→ 四家送出或截止時系統代排 → 亮牌結算 → 下一局 → … → 整場結束
// 時間一律由伺服器判定：送出要在截止「之前」才收，截止「之後」才代排，同一個時間點只會有一邊成立。
// 安全：給玩家的畫面（viewFor）亮牌前只有本人的手牌和三墩；別人只看得到「送出了沒」。
// 65 張發完剩下的 1 張：v4 的房是這一局的彩金牌（luckyCard，開局就公開）；舊規則房照舊不給。別人沒用到的牌（unusedCards）亮牌後才給。
import { deal, sortCards, type Card } from "./cards";
import { autoArrange, validateSubmission, type ArrangeError, type Arrangement } from "./arrange";
import { bonusOf, handRuleOf, homeRunPenaltyOf, isV4Family, revealOrder, ROWS, rowPoints, scoreRound, SCORING, type Row, type RoundResult, type ScoreRule } from "./score";
import { CAT, CAT_NAME, type HandRule } from "./hand";
import type { ThirteenGameState, ThirteenHandResult, ThirteenSettings, ThPlayer } from "./db";

/** 伺服器時間（毫秒）；測試會換掉 */
export const clock = { now: () => Date.now() };
/** 發牌（正式：計分引擎的安全洗牌）；測試會換成固定的牌 */
export const dealer = { deal: (): { hands: Card[][]; rest: Card[] } => deal() };
// ---- 亮牌 → 結算 → 下一局（阿哲 2026-11-18 拍板）----
// 亮牌時伺服器記三個時間（伺服器毫秒）：revealedAt 亮牌動畫起點（＝決定亮牌那一刻＋LEAD_MS）、settleAt 結算面板出現（＝revealedAt＋亮牌演出長度）、
// nextHandAt 自動開下一局（＝settleAt＋30 秒）。四家都按確認就馬上開；有人沒按（例如斷線）到 nextHandAt 自動開。
// 前端照 settleAt 顯示結算面板（用伺服器時間換算），和伺服器用同一個 revealDurationMs，兩邊不會對不上。
/** 結算面板出現後，等多久沒人按確認也自動開下一局 */
export const SETTLE_WAIT_MS = 30_000;
/**
 * 亮牌演出各段長度（毫秒）。老闆 2026-11-18 定案：照參考影片的節奏（阿妍量測〈十三支比牌節奏-參考影片對照與建議值〉）：
 *   START_MS 開始比牌 1.7；PLAY_MS 每家出一墩 1.5；ROW_WAIT_MS 一墩四家都出完後的等待 0（換墩不停，和同一墩一樣隔 1.5）；
 *   ROW_MS 一墩合計＝4×PLAY_MS＋ROW_WAIT_MS＝6.0（平手的兩家也各佔一格，照順序一家一家出）；
 *   SPECIAL_MS 每個大牌（衝三、中尾墩鐵支／同花順／五龍）另外多佔 0.3（特效和下一家出牌重疊，多出的留給中央顯示牌型名）；
 *   GUN_MS 每一槍 1.5；HOME_RUN_MS 全壘打 3.2；INSIDE_HR_MS 場內全壘打 5.0（老闆 2026-11-28：某一家被另外三家都打槍，悲情版全壘打，接在全壘打後面；老闆說「可以久一點」，3.2 拉長到 5.0）；
 *   SETTLE_PAUSE_MS 結算面板出現前的停頓 1.2。
 *   LEAD_MS 動畫起點排在決定亮牌之後 1.2 秒（老柯 2026-11-19，老闆回報「開始比牌只有 0.幾秒」）：存檔、廣播、瀏覽器收到再讀狀態，
 *     正式站實測要 0.5～1 秒；起點不往後排，這段會吃掉「開始比牌」大字（0.9 秒）和開頭音效。四家照樣同一個起點
 *   一般局＝1.7＋3×6.0＋1.2＝20.9 秒；整局＝20.9＋0.3×大牌＋1.5×槍＋3.2×全壘打＋5.0×場內全壘打。
 */
export const REVEAL_TIMING = {
  START_MS: 1700, PLAY_MS: 1500, ROW_WAIT_MS: 0, ROW_MS: 4 * 1500 + 0,
  SPECIAL_MS: 300, GUN_MS: 1500, HOME_RUN_MS: 3200, INSIDE_HR_MS: 5000, SETTLE_PAUSE_MS: 1200, LEAD_MS: 1200,
} as const;
/** 場內全壘打：被另外三家都打槍的那一家（只是動畫，不改計分；一局最多一家——兩家互相都被三家打，等於彼此三墩全贏對方，不可能）；沒有＝null */
export function insideHomeRunOf(result: Pick<RoundResult, "pairs">): number | null {
  const hit = [0, 0, 0, 0];
  for (const p of result.pairs) if (p.gunner !== null) hit[p.gunner === p.a ? p.b : p.a]++;
  const seat = hit.findIndex((n) => n === 3);
  return seat >= 0 ? seat : null;
}
/** 從開始比牌到結算面板出現：開始比牌＋三墩＋每個大牌（衝三、中尾墩鐵支／同花順／五龍）＋每一槍＋全壘打＋場內全壘打＋停頓 */
export function revealDurationMs(result: RoundResult): number {
  const t = REVEAL_TIMING;
  const specials = result.values.reduce((n, v) => n + ROWS.filter((row) => bonusOf(row, v[row]) > 0).length, 0);
  const guns = result.pairs.filter((p) => p.gunner !== null).length;
  return t.START_MS + 3 * t.ROW_MS + specials * t.SPECIAL_MS + guns * t.GUN_MS + (result.homeRun !== null ? t.HOME_RUN_MS : 0)
    + (insideHomeRunOf(result) !== null ? t.INSIDE_HR_MS : 0) + t.SETTLE_PAUSE_MS;
}
/** 亮牌到自動開下一局最長要多久（四家三墩都是特效牌型、六槍、全壘打、場內全壘打，再加 30 秒）；測試推進時間用 */
export const NEXT_HAND_MAX_MS = REVEAL_TIMING.LEAD_MS + REVEAL_TIMING.START_MS + 3 * REVEAL_TIMING.ROW_MS + 12 * REVEAL_TIMING.SPECIAL_MS + 6 * REVEAL_TIMING.GUN_MS
  + REVEAL_TIMING.HOME_RUN_MS + REVEAL_TIMING.INSIDE_HR_MS + REVEAL_TIMING.SETTLE_PAUSE_MS + SETTLE_WAIT_MS;

// ---- 每局統計（阿哲 2026-11-18：打槍、全壘打等改由後端每局記錄，前端不再自己累計）----
/** 一家這一局的明細（v5 本局結算的左欄）：墩分＋各特殊加分＋打槍分＋全壘打分＝total（這局總分） */
export interface HandStat {
  rows: number;                                  // 墩分：一般牌型的道兩兩比，贏 +1、輸 −1（甲案：特殊牌型那一道不算在這裡，算在 bonuses；v4：一道的輸贏不算分，永遠 0）
  bonuses: { name: string; points: number }[];   // 特殊加分：衝三、中墩鐵支、尾墩五龍…；自己拿到的正、付給別人的負（同名合併）
  guns: number; gunned: number; gunPoints: number;  // 打槍幾家、被幾家打槍、打槍的分數
  homeRun: boolean; homeRunned: boolean; homeRunPoints: number; // 全壘打、被全壘打、全壘打的分數
  luckyPoints?: number;                          // 彩金分（v5）：一道擺 3 張以上彩金點數 +3，別家擺了各 −1；其他規則 0（舊局存的明細沒有這個欄位＝0）
  total: number;
}
const ROW_LABEL: Record<Row, string> = { front: "頭墩", middle: "中墩", back: "尾墩" };
const bonusName = (row: Row, cat: number) => (row === "front" ? (cat === CAT.LUCKY_THREE ? "彩金衝三" : "衝三") : ROW_LABEL[row] + CAT_NAME[cat]);
/** 這局每家的明細（依座位） */
export function handStats(result: RoundResult, rule: ScoreRule = "v4"): HandStat[] {
  return [0, 1, 2, 3].map((seat) => {
    let rows = 0;
    const bonus = new Map<string, number>();
    for (const p of result.pairs) {
      if (p.a !== seat && p.b !== seat) continue;
      for (const row of ROWS) {
        const w = p.rows[row].winner;
        if (w === null) continue;
        // 甲案：墩分只算一般墩，特殊牌型那一道整個算在下面那一行；舊規則（v1）：每一道的 ±1 都算墩分，特殊牌型另列加分；v4：沒有墩分
        if (rule === "v1" || (rule === "jia" && p.rows[row].bonus === 0)) rows += w === seat ? 1 : -1;
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
    const pen = homeRunPenaltyOf(rule);
    const homeRunPoints = homeRun ? 3 * pen : homeRunned ? -pen : 0;
    const luckyPoints = result.luckyPoints?.[seat] ?? 0; // 舊局存的結果沒有 luckyPoints
    return { rows, bonuses, guns, gunned, gunPoints, homeRun, homeRunned, homeRunPoints, luckyPoints, total: result.totals[seat] };
  });
}
/** 整場累計（v5 總結算的右欄）：每家打槍、被打槍、全壘打、被全壘打次數和總分（依座位） */
export function matchStats(s: ThirteenGameState): { guns: number; gunned: number; homeRuns: number; homeRunned: number; total: number }[] {
  return [0, 1, 2, 3].map((seat) => {
    const per = s.hands.map((h) => (h.stats ?? handStats(h.result, scoreRuleOf(s.settings)))[seat]);
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

/** 開局：把入座的四家放進牌局狀態（依座位）；avatarUrls 和 seats 同順序（LINE 大頭照，開局時查一次，同麻將） */
export function seatPlayers(s: ThirteenGameState, seats: ThPlayer[], avatarUrls: (string | null)[] = []): void {
  s.players = seats.map((p, i) => ({ p, avatarUrl: avatarUrls[i] ?? null })).sort((a, b) => a.p.seat - b.p.seat)
    .map(({ p, avatarUrl }) => ({ id: p.player_id, name: p.name, seat: p.seat, userId: p.user_id, avatarUrl, hand: [], arrangement: null, autoArranged: false }));
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
  for (const p of s.players) { p.hand = sortCards(hands[p.seat]); p.arrangement = null; p.autoArranged = false; } // 手牌照 A、2…K 排（老闆 2026-11-19）
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
  const v = validateSubmission(p.hand, ids, handRuleFor(s)); // 倒水照這房的牌型規則（v4 含這一局的彩金牌）
  if (!v.ok) return v;
  p.arrangement = v.arrangement;
  return { ok: true };
}

/** 截止時間到了：還沒送出的人由系統代排（斷線的人也是這樣）。回傳代排的座位 */
export function autoArrangeLate(s: ThirteenGameState, now: number): number[] {
  if (s.phase !== "arranging" || s.arrangeDeadline === null || now < s.arrangeDeadline) return [];
  const seats: number[] = [];
  const rule = handRuleFor(s);
  for (const p of s.players) if (!p.arrangement) { p.arrangement = autoArrange(p.hand, rule); p.autoArranged = true; seats.push(p.seat); }
  return seats;
}

/** 這房的底分（老闆 2026-11-19）：上線前開的舊房設定裡沒有 baseScore，一律當 1（分數和改之前一樣） */
export const baseScoreOf = (settings: ThirteenSettings): number => settings.baseScore ?? 1;
/** 這房的計分規則（審伯 2026-11-19 必修）：開房時記了 scoreRule "jia" 才是甲案；上線前開的房沒有這個欄位，整場照舊規則 v1 */
export const scoreRuleOf = (settings: ThirteenSettings): ScoreRule =>
  settings.scoreRule === "v5" ? "v5" : settings.scoreRule === "v4" ? "v4" : settings.scoreRule === "jia" ? "jia" : "v1"; // v5：2026-11-20 起開的房（打槍新規則）；v4：11-19 定案後開的房
/** 這一局的彩金牌（v4 的房：65 張發完剩下的那 1 張，開局就公開）；舊規則房沒有彩金牌（剩下的那張照舊不給）＝null */
export const luckyCardOf = (s: ThirteenGameState): Card | null => (isV4Family(scoreRuleOf(s.settings)) ? s.rest?.[0] ?? null : null);
/** 這一局的牌型判斷規則（v4 含彩金點數） */
export const handRuleFor = (s: ThirteenGameState): HandRule => handRuleOf(scoreRuleOf(s.settings), luckyCardOf(s)?.rank ?? null);
/** 一局四家的分數＝墩數 × 底分；更早存的局沒有 scores 欄位就照當時的底分補算 */
export const handScores = (h: ThirteenHandResult, settings: ThirteenSettings): number[] =>
  h.scores ?? h.result.totals.map((x) => x * baseScoreOf(settings));

/**
 * 每墩四家的分數（中央看板每墩加分用，老馬 2026-11-19）：該墩六組兩兩比，贏的拿、輸的付這一道的墩數（一般 1、特殊牌型照表，甲案），再 × 底分。
 * 三墩加總＋打槍分＋全壘打分（都 × 底分）＝這局的 scores
 */
export function rowDeltas(result: RoundResult, base: number, rule: ScoreRule = "v4"): Record<Row, number[]> {
  const out = { front: [0, 0, 0, 0], middle: [0, 0, 0, 0], back: [0, 0, 0, 0] } as Record<Row, number[]>;
  for (const p of result.pairs) for (const row of ROWS) {
    const { winner, bonus } = p.rows[row];
    if (winner === null) continue;
    const loser = winner === p.a ? p.b : p.a;
    const pts = rowPoints(bonus, rule) * base;
    out[row][winner] += pts;
    out[row][loser] -= pts;
  }
  return out;
}

/** 本局結算左欄明細的乘好版本（老柯 2026-11-19）：HandStat 每一項 × 底分，打槍另外拆成打槍拿到、被打槍付出兩項 */
export interface ScoredStat {
  rows: number;                                 // 墩分 × 底分
  bonuses: { name: string; points: number }[];  // 每個特殊牌型加分 × 底分（名稱同 HandStat.bonuses）
  gunPoints: number;                            // 打槍淨分 × 底分＝shotPoints＋shotByPoints
  shotPoints: number;                           // 打槍拿到的分（≥ 0）＝guns × GUN_PENALTY × 底分
  shotByPoints: number;                         // 被打槍付出的分（≤ 0）＝−gunned × GUN_PENALTY × 底分
  homeRunPoints: number;                        // 全壘打分 × 底分
  luckyPoints: number;                          // 彩金分 × 底分（v5；其他規則 0）
  total: number;                                // ＝rows＋bonuses 合計＋gunPoints＋homeRunPoints＋luckyPoints＝這局的 scores[seat]
}
export function scoredStat(st: HandStat, base: number): ScoredStat {
  return { rows: st.rows * base, bonuses: st.bonuses.map((b) => ({ name: b.name, points: b.points * base })), gunPoints: st.gunPoints * base,
    shotPoints: st.guns * SCORING.GUN_PENALTY * base, shotByPoints: -st.gunned * SCORING.GUN_PENALTY * base,
    homeRunPoints: st.homeRunPoints * base, luckyPoints: (st.luckyPoints ?? 0) * base, total: st.total * base };
}

/** 四家都有三墩了就亮牌結算：本局結果（result 是墩數）存進 hands，分數＝墩數 × 底分，累計加進 playerScores */
export function revealIfReady(s: ThirteenGameState, now: number): boolean {
  if (s.phase !== "arranging" || s.players.some((p) => !p.arrangement)) return false;
  const rule = scoreRuleOf(s.settings);
  const result = scoreRound(s.players.map((p) => p.arrangement!), rule, luckyCardOf(s)?.rank ?? null);
  const scores = result.totals.map((x) => x * baseScoreOf(s.settings));
  s.hands.push({ handNo: s.handNo, result, stats: handStats(result, rule), scores });
  s.playerScores = s.playerScores.map((x, i) => x + scores[i]);
  s.phase = "revealed";
  s.nextReady = [];
  s.revealedAt = now + REVEAL_TIMING.LEAD_MS; // 動畫起點往後排，瀏覽器收到時「開始比牌」還沒開始（見 REVEAL_TIMING.LEAD_MS）
  s.settleAt = s.revealedAt + revealDurationMs(result);
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
  handNo: number; order: Record<Row, number[][]>; arrangements: Arrangement[]; unusedCards: Card[][]; luckyCard: Card | null; autoArranged: number[];
  result: RoundResult; stats: (HandStat & { gunEach: number; scored: ScoredStat })[]; scoreRule: ScoreRule; baseScore: number; scores: number[];
  rowDeltas: Record<Row, number[]>; playerScores: number[]; over: boolean;
  revealedAt: number | null; settleAt: number | null; nextHandAt: number | null;
} {
  const arrangements = s.players.map((p) => p.arrangement!);
  const last = s.hands[s.hands.length - 1];
  const base = baseScoreOf(s.settings);
  const rule = scoreRuleOf(s.settings);
  return {
    handNo: s.handNo,
    order: revealOrder(arrangements, rule, luckyCardOf(s)?.rank ?? null),
    // 每墩的牌照 A、2…K 排（老闆 2026-11-19；只是顯示順序，比大小不受影響）
    arrangements: arrangements.map((a) => ({ front: sortCards(a.front), middle: sortCards(a.middle), back: sortCards(a.back) })),
    // 每家沒用到的牌（加一色每人發 16 張、排 13 張，剩 3 張；老闆 2026-11-19 要在結算畫面列出）。
    // 只放在亮牌內容裡：亮牌前任何 API 都拿不到別人的牌
    unusedCards: s.players.map((p) => { const used = new Set([...p.arrangement!.front, ...p.arrangement!.middle, ...p.arrangement!.back].map((c) => c.id)); return sortCards(p.hand.filter((c) => !used.has(c.id))); }),
    luckyCard: luckyCardOf(s),
    autoArranged: s.players.filter((p) => p.autoArranged).map((p) => p.seat),
    result: last.result,
    // stats 是墩數（不乘，給出牌動畫）；gunEach＝每一槍的分數（GUN_PENALTY × 底分）；scored＝左欄明細的乘好版本
    stats: (last.stats ?? handStats(last.result, rule)).map((st) => ({ ...st, gunEach: SCORING.GUN_PENALTY * base, scored: scoredStat(st, base) })),
    scoreRule: rule,
    baseScore: base,
    scores: handScores(last, s.settings),
    rowDeltas: rowDeltas(last.result, base, rule),
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
    baseScore: baseScoreOf(s.settings),
    scoreRule: scoreRuleOf(s.settings),
    luckyCard: s.phase === "waiting" ? null : luckyCardOf(s), // v4：開局就公開；舊規則房 null
    serverNow: now,
    arrangeDeadline: s.arrangeDeadline,
    nextHandAt: s.nextHandAt ?? null,
    nextReady: s.nextReady ?? [],
    playerScores: s.playerScores,
    history: s.hands.map((h) => ({ handNo: h.handNo, totals: h.result.totals, scores: handScores(h, s.settings) })),
    stats: matchStats(s),
    players: s.players.map((p) => ({ id: p.id, name: p.name, seat: p.seat, avatarUrl: p.avatarUrl ?? null, submitted: p.arrangement !== null })),
    me: me ? { seat: me.seat, hand: me.hand, arrangement: me.arrangement } : null,
    reveal: revealed ? revealPayload(s) : null,
    leaveRequest: s.leaveRequest ? { requesterId: s.leaveRequest.requesterId, approvedBy: s.leaveRequest.approvedBy, ...evaluateLeave(s, now)! } : null,
  };
}
