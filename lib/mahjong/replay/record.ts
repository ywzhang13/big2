// 存檔掛鉤：lib/mahjong/db.ts 的兩個存檔函式（測試是 tests/support/stub-db.ts）存牌局狀態前後各呼叫一次。
//   beforeSave：更新牌局狀態裡進行中的回放紀錄（跟著同一次存檔寫進去，不多請求）；這局剛結算就回傳整局紀錄
//   afterSave：存檔成功後把整局紀錄寫進 mj_hand_replays（一局只有結算那一次）。失敗只記 log，不能讓牌局存檔失敗
import type { MahjongGameState } from "@/lib/mahjong/gameState";
import { stepReplay, summaryOf, type ReplayRecord } from "@/lib/mahjong/replay/log";
import { saveReplay } from "@/lib/mahjong/replay/store";

export function beforeSave(state: MahjongGameState): ReplayRecord | null {
  try {
    return stepReplay(state);
  } catch (err) {
    // 回放紀錄出錯不能擋住打牌：丟掉這局的紀錄，下一局重新開始
    console.error("[mj-replay] 回放紀錄更新失敗：", err instanceof Error ? err.message : err);
    delete state.replayLog;
    return null;
  }
}

export async function afterSave(roomId: string, rec: ReplayRecord | null): Promise<void> {
  if (!rec) return;
  try {
    await saveReplay(roomId, rec.hand, summaryOf(rec), rec);
  } catch (err) {
    console.error(`[mj-replay] 房 ${roomId} 第 ${rec.hand} 局的回放沒有存到：`, err instanceof Error ? err.message : err);
  }
}
