// 前端和伺服器狀態對齊的小規則（純邏輯、不碰 React，useMahjong 用；測試見 tests/_state-sync.ts）。
//   StateRequestGate：輪詢／回前景的 state 請求，舊的回應不能蓋掉新的；本機狀態變過之後，變更前送出的回應不能蓋掉（改成重抓）；
//                     回前景事件連發只多送一次（大老二 useGame 也用同一個）
//   readyAfterNextGame：按「下一局」成功後，要不要先把自己標成已同意
import { compareGameKey, gameKeyOf, type GameKey } from "./flowerTracker";
import type { Meld, RoundInfo } from "./gameState";

/** 慢慢摸牌的排隊狀態：on＝排隊中，gen＝每次開始排隊就加 1 */
export type HoldSnapshot = { on: boolean; gen: number };

/** apply＝套用；drop＝丟掉；refetchAfterHold＝排隊結束後再抓一次；refetchNow＝馬上重抓 */
export type PollVerdict = "apply" | "drop" | "refetchAfterHold" | "refetchNow";

/** 本機變更後、連續幾次重抓都還是過時（廣播一直來）就先不抓，等下一次定時輪詢（廣播本身已經讓畫面是新的） */
export const MAX_STALE_REFETCH = 3;
/** 自己的動作在路上最多擋輪詢這麼久：請求卡住（沒回應也沒錯誤）時不會一直不更新畫面 */
export const LOCAL_PENDING_MAX_MS = 8000;

export class StateRequestGate {
  private seq = 0;
  private applied = 0;
  private lastResume = -Infinity;
  /** 本機狀態變更的編號：自己打牌、吃碰槓，或收到改變牌局的廣播都加 1（noteLocalChange） */
  private change = 0;
  /** 還沒回來的請求，送出當下的變更編號 */
  private sentAt = new Map<number, number>();
  /** 連續因為過時而重抓的次數 */
  private staleStreak = 0;
  /** 我送出、伺服器還沒回的動作數（打牌、吃碰槓過）；這段期間伺服器可能還沒處理到，state 回應不能信 */
  private pending = 0;
  /** 動作在路上時丟掉過 state 回應：動作回來後要重抓一次 */
  private refetchAfterLocal = false;
  /** 目前這批動作從什麼時候開始在路上 */
  private pendingSince = 0;

  /** 送出一個 state 請求：拿到它的編號（越新越大） */
  begin(): number {
    const id = ++this.seq;
    this.sentAt.set(id, this.change);
    // 失敗、沒回來的請求不會 settle：只留最近 50 個，不會一直變大
    if (this.sentAt.size > 50) for (const k of this.sentAt.keys()) if (k <= id - 50) this.sentAt.delete(k);
    return id;
  }

  /**
   * 本機狀態剛變過（老闆 2026-10-25「打出去畫面回朔」）：在這之前送出的 state 請求，伺服器回的是變更前的狀態，
   * 回來時不能整份蓋掉手牌、海底、最後打出的牌、輪到誰
   */
  noteLocalChange(): void {
    this.change++;
  }

  /** 送出自己的動作（打牌、吃碰槓過、大老二出牌）：本機狀態變了，而且在伺服器回應前，任何 state 回應都可能還是動作前的狀態 */
  beginLocal(now = Date.now()): void {
    if (this.pending === 0) this.pendingSince = now;
    this.pending++;
    this.change++;
  }

  /** 動作的回應到了（成功或失敗）：回傳 true＝動作在路上時丟掉過 state 回應，現在要重抓一次 */
  endLocal(): boolean {
    this.pending = Math.max(0, this.pending - 1);
    this.change++;
    if (this.pending > 0 || !this.refetchAfterLocal) return false;
    this.refetchAfterLocal = false;
    return true;
  }

  /**
   * 回應回來時怎麼處理。holdGen 是送出時的排隊編號。
   *   - 送出後開始過慢慢摸牌：這份是過時的。還在排隊就等結束再抓；已結束就由最新的那個請求負責重抓一次（其他丟掉）
   *   - 比已經套用的回應舊（後送先回）：丟掉，不能把畫面蓋回舊狀態
   *   - 自己的動作還在路上（beginLocal 之後、endLocal 之前，最多 LOCAL_PENDING_MAX_MS）：丟掉，動作回來後 endLocal 會要求重抓
   *   - 送出之後本機狀態變過（noteLocalChange、beginLocal、endLocal）：最新的請求馬上重抓、其他丟掉（連續重抓 MAX_STALE_REFETCH 次後先停）
   */
  settle(id: number, holdGen: number, hold: HoldSnapshot, now = Date.now()): PollVerdict {
    const changeAtSend = this.sentAt.get(id);
    this.sentAt.delete(id);
    if (hold.gen !== holdGen) {
      if (hold.on) return "refetchAfterHold";
      return id === this.seq ? "refetchNow" : "drop";
    }
    if (id <= this.applied) return "drop";
    // 自己的動作還在路上：伺服器可能還沒處理到（例如打出後馬上送出的請求比打牌請求先到），丟掉，動作回來後再重抓
    if (this.pending > 0 && now - this.pendingSince < LOCAL_PENDING_MAX_MS) {
      this.refetchAfterLocal = true;
      return "drop";
    }
    // 送出之後本機狀態變過：這份是變更前的狀態。最新的請求負責馬上重抓一次（收斂到伺服器），其他丟掉；
    // 連續重抓太多次（廣播一直來）就先停，等下一次定時輪詢
    if (changeAtSend !== undefined && changeAtSend !== this.change) {
      if (id !== this.seq || this.staleStreak >= MAX_STALE_REFETCH) {
        if (id === this.seq) this.staleStreak = 0;
        return "drop";
      }
      this.staleStreak++;
      return "refetchNow";
    }
    this.staleStreak = 0;
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

/**
 * 眼牌者的一次摸牌：摸到的牌會從兩個地方來——摸牌 API 的回應、座位頻道的 mj_draw_tile（不同頻道，先後不保證）。
 * 同一次摸牌只能處理一次：先到的那個開始翻牌，後到的整個略過（不加回手牌、不改 hasDrawn／drawnTileId、不重播、不重新計時）。
 * 綁定的是「這一次摸牌」（start() 拿到的 token），不是永久記牌 id：下一次摸牌（含下一局用到同一個牌 id）一律重新開始。
 */
export class EyeDrawGate {
  private current: { tileId?: number } | null = null;

  /** 送出摸牌：眼牌者開新的一次（回傳 token 給 API 回應用）；不是眼牌者就清掉，私人事件照常處理 */
  start(eye: boolean): object | null {
    this.current = eye ? {} : null;
    return this.current;
  }

  /** 換局：上一局沒處理完的摸牌一律作廢 */
  reset(): void {
    this.current = null;
  }

  /** 摸牌 API 回應：token 還是目前這一次、而且事件還沒處理過，才由 API 處理 */
  claimResponse(token: object | null, tileId: number): boolean {
    const c = this.current;
    if (!token || c !== token || c.tileId !== undefined) return false;
    c.tileId = tileId;
    return true;
  }

  /** 座位頻道的 mj_draw_tile：同一次摸牌、同一張已經由 API 處理過就略過；其他（沒有進行中的眼牌摸牌、槓後補牌等別張）照常處理 */
  claimEvent(tileId: number): boolean {
    const c = this.current;
    if (!c) return true;
    if (c.tileId === undefined) { c.tileId = tileId; return true; }
    return c.tileId !== tileId;
  }
}

/** 自己暗槓（審伯退件 2026-10-29）：座位頻道 mj_hand_update 帶的 myRevealed（有牌面），要剛好比畫面上自己的吃碰槓多一副才是這一次暗槓的；
 *  沒收到、上一局或上一次槓留下的（副數相同或更少）、或已經被 mj_hand_update 套用過（畫面已是新的）→ null，不採用 */
export function ownConcealedKongMelds(current: Meld[], myRevealed: Meld[] | null): Meld[] | null {
  return myRevealed && myRevealed.length === current.length + 1 ? myRevealed : null;
}
