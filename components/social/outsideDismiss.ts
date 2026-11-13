// 點聊天室以外的地方就關閉（老闆 2026-11-13：像 LINE 聊天室，不要大大的「收起」鈕）。
// 關閉的那一下（同一個手勢）要整個吃掉：按下、放開、相容滑鼠事件、click 都不往下傳，牌桌收不到（不會誤打出牌、誤按吃碰）。
// 掛在 window 的捕獲階段，比 React（掛在根節點）和其他 document 監聽都早拿到事件。
//
// 依「手勢」追蹤，不靠固定秒數（審伯 2026-11-13 必修①）：
//   ・按下（pointerdown，記下 pointerId）→ 按住多久都算同一下 → 同一個 pointer 放開（pointerup）→ 緊接著的 mouseup／click 也吃掉，吃到 click 就結束
//   ・同一個 pointer 被取消（pointercancel，例如變成捲動）：馬上結束，之後的點擊一律照常
//   ・放開後 CLICK_GAP 內沒等到 click（例如拖曳不會產生 click）：結束，之後的點擊照常
//   ・click 帶了別的 pointerId（不是同一個手勢）：不吃
// 聊天室關掉後元件會拆監聽，但「那一下」還沒結束：吃事件的監聽留到手勢結束才拆；放開一直沒來的保底 MAX_HOLD_MS 後拆。

type Target = Pick<Window, "addEventListener" | "removeEventListener">;

export interface OutsideDismissOptions {
  /** 這個目標算不算聊天室裡面（輸入面板、聊天鈕也算） */
  isInside: (target: EventTarget | null) => boolean;
  onClose: () => void;
  /** true 時不處理（例如正在按住錄音） */
  ignore?: () => boolean;
  now?: () => number;
  setTimer?: (f: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

/** 放開後多久內的 click 算同一個手勢（手機瀏覽器 click 最晚約 350ms 後才到） */
export const CLICK_GAP_MS = 600;
/** 按下後一直沒放開（例如手指移出視窗）：保底這麼久後拆掉監聽 */
export const MAX_HOLD_MS = 30000;
const FOLLOW = ["pointerup", "pointercancel", "mousedown", "mouseup", "click"] as const;

type Gesture = { id: number | null; up: number | null };
const pidOf = (e: Event): number | null => {
  const id = (e as PointerEvent).pointerId;
  return typeof id === "number" && id >= 0 ? id : null;
};

export function attachOutsideDismiss(target: Target, opts: OutsideDismissOptions): () => void {
  const now = opts.now ?? (() => Date.now());
  const setTimer = opts.setTimer ?? ((f: () => void, ms: number) => setTimeout(f, ms));
  const clearTimer = opts.clearTimer ?? ((t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>));
  let g: Gesture | null = null;
  let attached = true;
  let following = false;
  let timer: unknown = null;

  const kill = (e: Event) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.(); };
  const startFollow = () => {
    if (following) return;
    following = true;
    FOLLOW.forEach((t) => target.addEventListener(t, follow, true));
  };
  const stopFollow = () => {
    if (!following) return;
    following = false;
    FOLLOW.forEach((t) => target.removeEventListener(t, follow, true));
  };
  const arm = (ms: number) => { if (timer != null) clearTimer(timer); timer = setTimer(end, ms); };
  function end() {
    g = null;
    if (timer != null) { clearTimer(timer); timer = null; }
    if (!attached) stopFollow();
  }
  function follow(e: Event) {
    if (!g) return;
    const pid = pidOf(e);
    const samePointer = g.id == null || pid == null || pid === g.id;
    if (e.type === "pointercancel") { if (samePointer) end(); return; }
    if (e.type === "pointerup") {
      if (!samePointer || g.up != null) return;
      kill(e);
      g.up = now();
      arm(CLICK_GAP_MS);
      return;
    }
    // mousedown／mouseup／click：按住中（滑鼠的 mousedown 緊跟在 pointerdown 後）或剛放開
    if (g.up != null && now() - g.up > CLICK_GAP_MS) { end(); return; }
    if (e.type === "click" && !samePointer) return; // 別的手勢的 click
    kill(e);
    if (e.type === "click") end();
  }
  const down = (e: Event) => {
    if (opts.ignore?.() || opts.isInside(e.target)) return;
    kill(e);
    g = { id: pidOf(e), up: null };
    arm(MAX_HOLD_MS);
    startFollow();
    opts.onClose();
  };
  const key = (e: Event) => { if ((e as KeyboardEvent).key === "Escape") opts.onClose(); };
  target.addEventListener("pointerdown", down, true);
  target.addEventListener("keydown", key);
  return () => {
    attached = false;
    target.removeEventListener("pointerdown", down, true);
    target.removeEventListener("keydown", key);
    if (!g) stopFollow(); // 手勢進行中：等它結束（end）再拆
  };
}

/** 目標是不是在任一個選擇器裡（Element.closest） */
export function insideAny(target: EventTarget | null, selectors: string): boolean {
  const el = target as Element | null;
  return !!el && typeof el.closest === "function" && !!el.closest(selectors);
}
