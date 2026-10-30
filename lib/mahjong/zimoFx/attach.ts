// 胡牌前：查資料庫，把四個座位「這一刻」的自摸特效填進牌局狀態（players[i].zimoFx），declareWin 就照這個判斷。
// 開局、下一局、每次打牌／摸牌／動作都會查（同一個請求裡就會決定胡牌，所以等於「胡牌那一刻」）。
// 不能讓一般打牌多等一次往返（審伯 2026-10-31 必修 1）：讀完房間就先 prefetchZimoFx 發出查詢，
// 和登入檢查、等特效時間同時進行，到要跑遊戲邏輯前才 applyZimoFx(state, await …)。
// 查不到（資料庫錯誤）：老闆帳號照舊隕石，其他人一律一般浮層，不擋牌局。
import type { MahjongGameState } from "../gameState";
import { resolveZimoFx } from "./rules";
import { zimoFxFor } from "@/lib/mahjong/zimoFx/store";

type Prefs = Map<string, { fx: string; until: number | null }>;

/** 立刻發出查詢，回傳的 promise 不會 reject（失敗就是空的＝預設）；請求提早結束沒等它也沒關係 */
export function prefetchZimoFx(state: Partial<Pick<MahjongGameState, "players">> | null | undefined): Promise<Prefs> {
  const ids = (state?.players ?? []).map((p) => p.userId).filter((x): x is string => !!x);
  return zimoFxFor(ids).catch((err) => {
    console.error("[mj-zimo-fx] 查自摸特效失敗，這次用預設：", err instanceof Error ? err.message : err);
    return new Map() as Prefs;
  });
}

/** 把查到的結果填進牌局狀態 */
export function applyZimoFx(state: MahjongGameState, prefs: Prefs): void {
  for (const p of state.players) p.zimoFx = resolveZimoFx(p.userId, p.userId ? prefs.get(p.userId) : undefined) ?? null;
}
