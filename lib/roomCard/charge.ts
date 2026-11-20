// 開局扣卡（存檔成功之後呼叫）。規則見 rules.ts；同一人同一房同一把只扣一次，由資料庫唯一索引保證，
// 所以同一把重送、同時兩個請求、伺服器重試再呼叫一次都不會多扣。
// 扣卡失敗只寫 log、不丟錯：牌已經發了、存檔也成功了，不能因為記帳失敗讓這一把卡住（會漏扣這一把，log 有房號和第幾把可以補）。
import type { MahjongGameState } from "@/lib/mahjong/gameState";
import { chargeableUsers, thirteenChargesHand, type CardGame } from "./rules";
import { chargeHand } from "@/lib/roomCard/store";

async function charge(game: CardGame, roomId: string, roomCode: string, handNo: number, userIds: (string | null | undefined)[]): Promise<number> {
  const users = chargeableUsers(userIds);
  if (users.length === 0) return 0;
  try {
    return await chargeHand(game, roomId, roomCode, handNo, users);
  } catch (err) {
    console.error(`[room-card] ${game} 房 ${roomCode}（${roomId}）第 ${handNo} 把扣卡失敗：`, err instanceof Error ? err.message : err);
    return 0;
  }
}

/** 麻將：handNo 是 mahjongChargeHand 算的（連莊是 null，不扣） */
export async function chargeMahjongHand(roomId: string, roomCode: string, s: Pick<MahjongGameState, "players">, handNo: number | null): Promise<number> {
  if (handNo === null) return 0;
  return charge("mahjong", roomId, roomCode, handNo, s.players.map((p) => p.userId));
}

/** 十三支：剛開的第 handNo 局（奇數局才扣） */
export async function chargeThirteenHand(roomId: string, roomCode: string, s: { handNo: number; players: { userId: string | null }[] }): Promise<number> {
  if (!thirteenChargesHand(s.handNo)) return 0;
  return charge("thirteen", roomId, roomCode, s.handNo, s.players.map((p) => p.userId));
}
