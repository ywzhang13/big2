// 每局結算存檔成功後，記下這局自摸胡的帳號（斗內卡的自摸次數用）。
// 由 lib/mahjong/db.ts 的兩個存檔函式呼叫；同一個結算狀態存好幾次也只記一筆（資料庫主鍵擋重複）。
// 遊客不記：開局後的牌局狀態分不出誰是遊客，所以由資料庫函式 mj_zimo_record 以 auth.users 的 app_metadata.guest 為準排除。
// 記錄失敗只寫 log、不丟錯：不能因為斗內計數讓牌局存檔失敗。
// 2026-11-02 起同時記下每一把的胡牌者和放槍者（mj_hand_results，用座位記，遊客也記；流局記一列 winnerSeat=-1），對戰紀錄的胡牌／放槍數用。
import { isSelfDrawWin, settledWinners } from "@/lib/mahjong/gameLogic";
import type { MahjongGameState } from "@/lib/mahjong/gameState";
import { recordHandResults, recordZimo, type HandResult } from "@/lib/mahjong/donate/store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 這局自摸胡的帳號 id（沒綁帳號的舊座位略過）；不是已結算的局回 null */
export function zimoUserIds(s: MahjongGameState): { handNo: number; userIds: string[] } | null {
  if (s.status !== "finished" || !s.settlement || !s.handsCompleted || s.handsCompleted < 1) return null;
  const userIds = settledWinners(s)
    .filter(isSelfDrawWin)
    .map((w) => s.players[w.seat]?.userId)
    .filter((u): u is string => typeof u === "string" && UUID.test(u));
  return { handNo: s.handsCompleted, userIds };
}

/** 這局每個胡牌的座位、放槍的座位（自摸 null）；流局一列 winnerSeat=-1。不是已結算的局回 null */
export function handResults(s: MahjongGameState): { handNo: number; rows: HandResult[] } | null {
  if (s.status !== "finished" || !s.settlement || !s.handsCompleted || s.handsCompleted < 1) return null;
  const winners = settledWinners(s);
  const rows: HandResult[] = winners.length === 0
    ? [{ winnerSeat: -1, fromSeat: null, selfDraw: false }]
    : winners.map((w) => ({ winnerSeat: w.seat, fromSeat: isSelfDrawWin(w) ? null : (w.from ?? null), selfDraw: isSelfDrawWin(w) }));
  return { handNo: s.handsCompleted, rows };
}

export async function recordZimoWins(roomId: string, s: MahjongGameState): Promise<void> {
  const h = handResults(s);
  if (h) {
    try {
      await recordHandResults(roomId, h.handNo, h.rows);
    } catch (err) {
      console.error(`[mj-hands] 房 ${roomId} 第 ${h.handNo} 局的胡牌／放槍沒有記到：`, err instanceof Error ? err.message : err);
    }
  }
  const z = zimoUserIds(s);
  if (!z || z.userIds.length === 0) return;
  try {
    await recordZimo(roomId, z.handNo, z.userIds);
  } catch (err) {
    console.error(`[mj-donate] 房 ${roomId} 第 ${z.handNo} 局的自摸沒有記到：`, err instanceof Error ? err.message : err);
  }
}
