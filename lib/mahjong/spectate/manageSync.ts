// 觀戰管理清單（GET /api/mahjong/spectate/manage）什麼時候去拿（2026-11-01 省量：拿掉每 5 秒的保險輪詢）。
//   ・進牌桌時拿一次
//   ・之後只在有事件時拿：有人申請（私人頻道 mj_spectate_request）、同意／拒絕／收回（公開頻道 mj_spectators）——
//     這兩個事件會讓 spectateTick +1，hook 依賴 tick 重新呼叫這裡，等於「有事件就拿一次」
//   ・分頁從背景回到前景時拿一次（背景期間漏掉的事件補回來）
//   申請 30 秒逾時由前端照伺服器時間倒數，不用靠輪詢。計時器和事件都由 env 注入，測試可以用假的
export interface ManageSyncEnv {
  setTimeout(f: () => void, ms: number): unknown;
  clearTimeout(t: unknown): void;
  /** 分頁回到前景時呼叫 cb；回傳取消訂閱 */
  onVisible(cb: () => void): () => void;
}

/** 開始同步：馬上（下一輪事件迴圈）拿一次，之後只在回前景時再拿。回傳停止函式 */
export function startManageSync(load: () => void, env: ManageSyncEnv): () => void {
  const first = env.setTimeout(load, 0);
  const off = env.onVisible(load);
  return () => { env.clearTimeout(first); off(); };
}

export const browserManageSyncEnv: ManageSyncEnv = {
  setTimeout: (f, ms) => setTimeout(f, ms),
  clearTimeout: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
  onVisible: (cb) => {
    const h = () => { if (document.visibilityState === "visible") cb(); };
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  },
};
