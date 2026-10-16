// 前端和伺服器狀態對齊的小規則（純邏輯、不碰 React，useMahjong 用；測試見 tests/_state-sync.ts）。
//   StateRequestGate：輪詢／回前景的 state 請求，舊的回應不能蓋掉新的；回前景事件連發只多送一次
//   readyAfterNextGame：按「下一局」成功後，要不要先把自己標成已同意
import { compareGameKey, gameKeyOf, type GameKey } from "./flowerTracker";
import type { RoundInfo } from "./gameState";

/** 慢慢摸牌的排隊狀態：on＝排隊中，gen＝每次開始排隊就加 1 */
export type HoldSnapshot = { on: boolean; gen: number };

/** apply＝套用；drop＝丟掉；refetchAfterHold＝排隊結束後再抓一次；refetchNow＝馬上重抓 */
export type PollVerdict = "apply" | "drop" | "refetchAfterHold" | "refetchNow";

export class StateRequestGate {
  private seq = 0;
  private applied = 0;
  private lastResume = -Infinity;

  /** 送出一個 state 請求：拿到它的編號（越新越大） */
  begin(): number {
    return ++this.seq;
  }

  /**
   * 回應回來時怎麼處理。holdGen 是送出時的排隊編號。
   *   - 送出後開始過慢慢摸牌：這份是過時的。還在排隊就等結束再抓；已結束就由最新的那個請求負責重抓一次（其他丟掉）
   *   - 比已經套用的回應舊（後送先回）：丟掉，不能把畫面蓋回舊狀態
   */
  settle(id: number, holdGen: number, hold: HoldSnapshot): PollVerdict {
    if (hold.gen !== holdGen) {
      if (hold.on) return "refetchAfterHold";
      return id === this.seq ? "refetchNow" : "drop";
    }
    if (id <= this.applied) return "drop";
    this.applied = id;
    return "apply";
  }

  /** 回到前景：visibilitychange 和 pageshow 會連發，windowMs 內只放行第一個 */
  allowResume(now: number, windowMs = 1000): boolean {
    if (now - this.lastResume < windowMs) return false;
    this.lastResume = now;
    return true;
  }
}

type ReadyView = { status: string; roundInfo?: RoundInfo | null; nextGameReady?: string[] };

/**
 * 按「下一局」HTTP 成功後的已同意名單；null＝不要動畫面。
 *   - started：我是第 4 個，伺服器已經開新局，新局（和之後的結算）不能殘留自己
 *   - 回應到之前畫面已經換局（收到 mj_game_start，或已是別局的結算）：這份成功屬於上一局，不動
 *   - 其他：第 1～3 個按的人馬上顯示已同意，不用等 mj_next_game_ready 廣播
 */
export function readyAfterNextGame(
  prev: ReadyView,
  myId: string,
  res: { started?: boolean } | null | undefined,
  pressedGame: GameKey | null
): string[] | null {
  if (res?.started) return null;
  if (prev.status !== "finished") return null;
  const now = gameKeyOf(prev.roundInfo);
  if (pressedGame && now && compareGameKey(now, pressedGame) !== 0) return null;
  if (prev.nextGameReady?.includes(myId)) return null;
  return [...(prev.nextGameReady ?? []), myId];
}
