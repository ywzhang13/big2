// 省量（老馬 2026-11-01，老柯〈Vercel 請求量分析〉方案 2、5）：牌桌、觀戰畫面以即時推播為主，輪詢只當保險。
// 純邏輯、不碰 React（useMahjong、觀戰頁共用；測試見 tests/_sync-policy.ts）。
//   - 即時連線正常：多久沒拿過完整狀態才補抓一次（SAFETY_POLL_MS）；連線斷了、還沒重連上：照舊每 5 秒
//   - 分頁在背景：一律不抓（回前景時由呼叫端馬上抓一次）
//   - 事件帶版本號 sv（牌局狀態的 stateVersion）時，跳號＝中間漏了事件，呼叫端要馬上補抓

/** 即時連線正常時，多久沒拿過完整狀態就補抓一次 */
export const SAFETY_POLL_MS = 25_000;
/** 即時連線斷了（還沒重新訂閱上）時的輪詢間隔：和改版前一樣 */
export const OFFLINE_POLL_MS = 5_000;
/** 本機多久檢查一次要不要補抓（只看時間，不打伺服器） */
export const POLL_TICK_MS = 2_500;

export class SyncPolicy {
  private lastSent = -Infinity;
  private channels = new Map<string, boolean>();
  private sv: number | null = null;
  constructor(private safetyMs = SAFETY_POLL_MS, private offlineMs = OFFLINE_POLL_MS) {}

  /** 送出一次完整狀態請求（不管是定時、事件觸發還是回前景） */
  markSent(now: number) { this.lastSent = now; }
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
  resetVersion() { this.sv = null; }
  /** 收到帶版本號的事件或完整狀態：回傳 true＝跳號（中間漏了），要馬上補抓。沒帶版本號（舊伺服器）一律 false */
  noteVersion(sv: unknown, { fromState = false } = {}): boolean {
    if (typeof sv !== "number" || !Number.isFinite(sv)) return false;
    const prev = this.sv;
    if (prev === null || sv > prev) this.sv = sv;
    return !fromState && prev !== null && sv > prev + 1;
  }
}
