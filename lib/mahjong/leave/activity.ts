// 解散投票判斷用：把「帳號最後一次聊天、丟互動的時間」換成以 playerId 為鍵（給 lib/mahjong/leave/rules.ts）。
import type { MahjongGameState } from "@/lib/mahjong/gameState";
import { socialActivityByUser } from "@/lib/mahjong/leave/store";

/** 聊天、丟互動的最後時間（以 playerId 為鍵）；查不到不擋投票，只是不算這兩種操作 */
export async function socialActivity(roomId: string, s: MahjongGameState): Promise<Record<string, number>> {
  try {
    const byUser = await socialActivityByUser(roomId);
    const out: Record<string, number> = {};
    for (const p of s.players) if (p.userId && byUser[p.userId]) out[p.id] = byUser[p.userId];
    return out;
  } catch (err) {
    console.error("[mj-leave] 讀取聊天／互動時間失敗：", err instanceof Error ? err.message : err);
    return {};
  }
}

