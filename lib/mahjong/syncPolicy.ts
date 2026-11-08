// 省量（老馬 2026-11-01，老柯〈Vercel 請求量分析〉方案 2、5）：牌桌、觀戰畫面以即時推播為主，輪詢只當保險。
// 純邏輯、不碰 React（useMahjong、觀戰頁共用；測試見 tests/_sync-policy.ts）。
//   - 即時連線正常：多久沒拿過完整狀態才補抓一次（SAFETY_POLL_MS）；連線斷了、還沒重連上：照舊每 5 秒
//   - 分頁在背景：一律不抓（回前景時由呼叫端馬上抓一次）
//   - 事件帶版本號 sv（牌局狀態的 stateVersion）時，跳號＝中間漏了事件，呼叫端要馬上補抓
//   - 事件比看過的最新版本（任何頻道的事件、完整狀態）還舊＝亂序晚到：不套用，免得把畫面蓋回舊狀態（審伯 2026-11-01 複查 ⑨）。
//     同一版本不算舊（同一次存檔的公開事件和座位頻道的個人事件各自生效）。
//     丟掉的事件如果還沒被完整狀態涵蓋（例如座位頻道晚到的手牌），馬上補抓一次完整狀態，個人手牌不會因此遺失；
//     已經有一次補抓在路上（STALE_COVER_MS 內送出、送出時就看過這個版本）、或是已經套用過的同一個事件重送，就不重複抓
//   - 完整狀態回來時版本比看過的最新版本還舊（例如伺服器快取落後）：不套用、再抓一次；連續 MAX_STALE_STATE_REFETCH 次還是舊的就先停，等保險輪詢

/** 即時連線正常時，多久沒拿過完整狀態就補抓一次 */
export const SAFETY_POLL_MS = 25_000;
/** 即時連線斷了（還沒重新訂閱上）時的輪詢間隔：和改版前一樣 */
export const OFFLINE_POLL_MS = 5_000;
/** 本機多久檢查一次要不要補抓（只看時間，不打伺服器） */
export const POLL_TICK_MS = 2_500;
/** 丟掉舊事件時：這段時間內送出的完整狀態請求會涵蓋它，不再另外補抓 */
export const STALE_COVER_MS = 3_000;
const APPLIED_KEEP = 200;
/** 完整狀態連續回來都比畫面舊時，最多重抓幾次（避免一直打伺服器） */
export const MAX_STALE_STATE_REFETCH = 2;

export class SyncPolicy {
  private lastSent = -Infinity;
  private channels = new Map<string, boolean>();
  private sv: number | null = null;
  /** 已套用的完整狀態版本 */
  private stateSv: number | null = null;
  /** 最近一次送出完整狀態請求時，看過的最新版本和時間（回來的狀態至少是這一版） */
  private asked: { sv: number | null; at: number } | null = null;
  /** 最近套用過的帶版本事件（頻道＋事件名＋內容），認出重送的同一個事件用；只留最近 APPLIED_KEEP 個 */
  private applied = new Set<string>();
  /** 連續拿到比畫面舊的完整狀態、已經重抓幾次 */
  private staleStateStreak = 0;
  constructor(private safetyMs = SAFETY_POLL_MS, private offlineMs = OFFLINE_POLL_MS) {}

  /** 送出一次完整狀態請求（不管是定時、事件觸發還是回前景） */
  markSent(now: number) { this.lastSent = now; this.asked = { sv: this.sv, at: now }; }
  /** 頻道訂閱狀態：SUBSCRIBED＝true；TIMED_OUT／CLOSED／CHANNEL_ERROR＝false；頻道拿掉時 remove */
  setChannel(name: string, ok: boolean) { this.channels.set(name, ok); }
  removeChannel(name: string) { this.channels.delete(name); }
  /** 所有頻道都訂閱上了 */
  get live(): boolean { return this.channels.size > 0 && [...this.channels.values()].every(Boolean); }
  /** 定時檢查：現在要不要補抓 */
  due(now: number, hidden: boolean): boolean {
    if (hidden) return false;
    return now - this.lastSent >= (this.live ? this.safetyMs : this.offlineMs);
  }
  /** 換房間：版本號重新算 */
  resetVersion() { this.sv = null; this.stateSv = null; this.asked = null; this.applied.clear(); this.staleStateStreak = 0; }
  /**
   * 完整狀態回來、套用前先問：apply＝照常套用（之後呼叫 noteVersion fromState）；
   * refetch＝版本比看過的最新版本舊，不套用、再抓一次；drop＝連續重抓 MAX_STALE_STATE_REFETCH 次還是舊的，先不抓，等保險輪詢。
   * 沒帶版本號（舊伺服器、大廳）一律 apply
   */
  checkState(sv: unknown): "apply" | "refetch" | "drop" {
    if (!this.isStale(sv)) { this.staleStateStreak = 0; return "apply"; }
    if (this.staleStateStreak >= MAX_STALE_STATE_REFETCH) { this.staleStateStreak = 0; return "drop"; }
    this.staleStateStreak++;
    return "refetch";
  }
  /** 完整狀態的版本剛好等於已經套用過的最新版本：這份快照沒有任何事件還沒收到的新資訊，可以放心
   *  保留純靠事件推出來、快照本身判斷不出來的欄位（例如誰剛摸牌還沒打出；吃碰槓不算摸牌，不受影響）。
   *  一定要在 checkState 判定 apply 之後、noteVersion(sv,{fromState:true}) 更新 this.sv 之前呼叫，
   *  不然這次快照自己的版本會把 this.sv 蓋過去，兩邊永遠相等、比不出有沒有漏事件
   *  （老闆 2026-11-08：自己打牌後排隊中的完整狀態比下一家 mj_draw 晚回來，會把剛設好的欄位誤判成要清掉） */
  isAtLatest(sv: unknown): boolean {
    return typeof sv === "number" && Number.isFinite(sv) && this.sv !== null && sv === this.sv;
  }
  /** 記下套用過的帶版本事件 */
  markApplied(key: string) {
    this.applied.add(key);
    if (this.applied.size > APPLIED_KEEP) this.applied.delete(this.applied.values().next().value as string);
  }
  /** 這個舊事件是不是已經套用過的同一個事件重送（內容一模一樣） */
  wasApplied(key: string): boolean { return this.applied.has(key); }
  /** 亂序晚到的舊事件（true＝不要套用）：比看過的最新版本還舊。同版本不算舊；沒帶版本號（舊伺服器、聊天等）一律 false */
  isStale(sv: unknown): boolean {
    return typeof sv === "number" && Number.isFinite(sv) && this.sv !== null && sv < this.sv;
  }
  /** 丟掉舊事件後要不要馬上補抓：這一版還沒被已套用的完整狀態、或路上的完整狀態請求涵蓋 */
  needsRefetchAfterStale(sv: number, now: number): boolean {
    if (this.stateSv !== null && this.stateSv >= sv) return false;
    const a = this.asked;
    if (a && a.sv !== null && a.sv >= sv && now - a.at < STALE_COVER_MS) return false;
    return true;
  }
  /**
   * 慢慢摸牌期間排隊的事件，真正執行前再比一次（排隊時是新的，等待期間可能已經有更新的事件或狀態套用了）：
   * run＝照常套用；skip＝已經比畫面舊、不套用，完整狀態已經涵蓋或補抓已在路上；refetch＝不套用，補抓一次完整狀態
   */
  checkQueued(sv: unknown, now: number): "run" | "skip" | "refetch" {
    if (typeof sv !== "number" || !this.isStale(sv)) return "run";
    return this.needsRefetchAfterStale(sv, now) ? "refetch" : "skip";
  }
  /** 收到帶版本號的事件或完整狀態：回傳 true＝跳號（中間漏了），要馬上補抓。沒帶版本號（舊伺服器）一律 false */
  noteVersion(sv: unknown, { fromState = false } = {}): boolean {
    if (typeof sv !== "number" || !Number.isFinite(sv)) return false;
    const prev = this.sv;
    if (prev === null || sv > prev) this.sv = sv;
    if (fromState && (this.stateSv === null || sv > this.stateSv)) this.stateSv = sv;
    return !fromState && prev !== null && sv > prev + 1;
  }
}
