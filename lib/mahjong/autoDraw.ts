// 自動摸牌（老闆 2026-11-04：偶爾輪到某人摸牌卻沒摸到，牌局卡住）。純邏輯、不碰 React，useMahjong 用；測試見 tests/_auto-draw.ts
// 原本只在「該摸牌」這個條件變動時送一次：請求失敗後條件沒變，就再也不會送，輪詢拿回一樣的狀態也救不回來。
// 這裡改成該摸牌的期間一直負責到底：失敗退避重試、拿到過時的錯誤就重抓狀態、回前景和重連馬上補。
// 不會多摸：同時只有一個請求在路上；就算回應遺失後重送，伺服器也會回「已經摸過牌了」，不會再發牌。

/** ok＝伺服器收了；wait＝還有人在決定吃碰；stale＝本機狀態過時；fatal＝沒有權限，重試也沒用；retry＝網路或伺服器問題 */
export type DrawOutcome = "ok" | "wait" | "stale" | "fatal" | "retry";

/** 條件成立後等多久才送第一次（等吃碰槓的事件先到） */
export const DRAW_FIRST_MS = 250;
/** 伺服器收了但畫面過這麼久還是「該摸牌」（事件掉了）：重抓狀態 */
export const DRAW_CONFIRM_MS = 3000;
/** 還有人在決定吃碰、或狀態過時：隔多久再問 */
export const DRAW_WAIT_MS = 3000;
/** 網路或伺服器失敗的退避（最後一項是上限） */
export const DRAW_BACKOFF_MS = [1000, 2000, 4000, 8000, 10000];
/** 請求卡住（沒回應也沒錯誤）最多等多久就重送；伺服器補花、眼牌特效最多會讓請求等 4 秒 */
export const DRAW_IN_FLIGHT_MAX_MS = 20000;
/** 回前景、重連時，請求已經在路上超過這麼久就不等它，直接補送 */
export const DRAW_KICK_OVERRIDE_MS = 5000;

export function classifyDrawError(err: unknown): DrawOutcome {
  const status = (err as { status?: number } | null)?.status;
  if (status === 401 || status === 403) return "fatal";
  if (status === 404) return "stale"; // 找不到遊戲（房間關了、被刪）：重抓狀態，由關房處理停下，不一直重送
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("等待其他玩家動作中")) return "wait";
  if (msg.includes("已經摸過牌了") || msg.includes("還沒輪到你") || msg.includes("遊戲未在進行中")) return "stale";
  return "retry";
}

export type AutoDrawDeps<T = unknown> = {
  draw: () => Promise<DrawOutcome>;
  /** 重抓完整狀態 */
  sync: () => void;
  isHidden: () => boolean;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => T;
  clearTimer: (t: T) => void;
};

export class AutoDrawer<T = unknown> {
  private active = false;
  private timer: T | null = null;
  private failures = 0;
  private attempted = false;
  /** 最新一次請求的編號和送出時間；舊請求晚回來不算數 */
  private seq = 0;
  private inFlightSince: number | null = null;

  constructor(private deps: AutoDrawDeps<T>) {}

  /** 該摸牌了 */
  start() {
    if (this.active) return;
    this.active = true;
    this.failures = 0;
    this.attempted = false;
    this.schedule(DRAW_FIRST_MS);
  }

  /** 不該摸了（摸到了、換人了、有吃碰按鈕、牌局結束） */
  stop() {
    this.active = false;
    this.clear();
  }

  /** 回前景、網路恢復、即時連線重連：不等退避，馬上補 */
  kick() {
    if (!this.active || this.deps.isHidden()) return;
    if (this.inFlightSince !== null && this.deps.now() - this.inFlightSince < DRAW_KICK_OVERRIDE_MS) return;
    this.failures = 0;
    this.inFlightSince = null;
    this.schedule(0);
  }

  private clear() {
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
  }

  private schedule(ms: number, then: () => void = () => this.fire()) {
    this.clear();
    this.timer = this.deps.setTimer(() => { this.timer = null; then(); }, ms);
  }

  private fire() {
    if (!this.active) return;
    if (this.inFlightSince !== null) {
      const age = this.deps.now() - this.inFlightSince;
      if (age < DRAW_IN_FLIGHT_MAX_MS) { this.schedule(DRAW_IN_FLIGHT_MAX_MS - age); return; }
    }
    // 第一次照舊不管在不在背景都送；之後在背景就先停手，回前景由 kick 接手（計時器和網路在背景本來就不可靠）
    if (this.attempted && this.deps.isHidden()) return;
    this.attempted = true;
    const id = ++this.seq;
    this.inFlightSince = this.deps.now();
    this.schedule(DRAW_IN_FLIGHT_MAX_MS); // 請求卡住、一直沒回來時的保險
    this.deps.draw().then((o) => this.settle(id, o), () => this.settle(id, "retry"));
  }

  private settle(id: number, outcome: DrawOutcome) {
    if (id !== this.seq) return;
    this.inFlightSince = null;
    if (!this.active) return;
    if (outcome === "fatal") { this.clear(); return; }
    if (outcome === "ok") {
      this.schedule(DRAW_CONFIRM_MS, () => { this.deps.sync(); this.fire(); });
      return;
    }
    if (outcome === "stale") this.deps.sync();
    const backoff = DRAW_BACKOFF_MS[Math.min(this.failures++, DRAW_BACKOFF_MS.length - 1)];
    this.schedule(outcome === "retry" ? backoff : Math.max(DRAW_WAIT_MS, backoff));
  }
}
