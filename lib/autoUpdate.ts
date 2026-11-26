"use client";
// 自動換新版（老馬 2026-11-26；阿妍〈十三支五龍鈕消失-調查報告〉建議 A，老闆同意）
//
// 問題：網站沒有「發現新版就換」的機制。十三支、麻將、大老二從大廳到下一局都在同一頁切換，不會重新載入；
//   iPhone 主畫面捷徑切到背景再回來也沿用記憶體裡的舊頁面。上線後玩家常停在舊版（五龍鈕不見、倒水提示和伺服器不一致）。
// 做法：建置時把版本號寫進頁面（next.config 的 NEXT_PUBLIC_BUILD_VERSION），/api/version 回伺服器現在的版本（不快取）。
//   定時（畫面看得到時每 5 分鐘）、回到前景、頁面重新顯示時問一次；版本不同就記著，等到「安全時機」才重新整理一次。
//   安全時機由各頁用 useAutoUpdate(safe) 回報：大廳、等人（還沒按開始）、整場結束＝true；牌局中、理牌、亮牌、結算＝false；
//   不負責判斷的元件傳 null。所有回報都是 true（而且至少一個）才重新整理。不加任何提示文字。
//   查詢失敗、離線：當作沒查到，不重整、不報錯。同一個新版本這個分頁只重整一次（sessionStorage 記著），不會一直重整。
import { useEffect, useState } from "react";

export const CHECK_EVERY_MS = 5 * 60 * 1000;
const TRIED_KEY = "au:tried";

type Store = Pick<Storage, "getItem" | "setItem">;
export type UpdaterOpts = {
  /** 這個頁面建置時的版本號；空字串＝不知道（開發環境沒設定）→ 整個功能不動 */
  current: string;
  /** 問伺服器現在的版本；失敗回 null 或丟錯都可以 */
  fetchVersion: () => Promise<string | null>;
  reload: () => void;
  store: Store | null;
};

export function createUpdater(o: UpdaterOpts) {
  let latest: string | null = null;
  let reloaded = false;
  const safe = new Map<number, boolean>();

  const canReload = () => {
    if (safe.size === 0) return false;
    for (const v of safe.values()) if (!v) return false;
    return true;
  };
  const maybeReload = () => {
    if (reloaded || !o.current || !latest || latest === o.current || !canReload()) return;
    // 「這版已經重整過」一定要能跨載入記住才重整（審伯 R3）：拿不到 storage、讀寫丟錯、寫了讀不回來 → 都不自動重整，
    // 不然重整後拿到的如果還是舊頁面，記憶體裡的 reloaded 歸零，就會一直重整
    if (!o.store) return;
    try {
      if (o.store.getItem(TRIED_KEY) === latest) return; // 這個版本已經重整過一次（例如拿到的頁面還是舊的）：不再重整
      o.store.setItem(TRIED_KEY, latest);
      if (o.store.getItem(TRIED_KEY) !== latest) return;
    } catch { return; }
    reloaded = true;
    o.reload();
  };

  return {
    /** 問一次伺服器版本；不同就在安全時機重整（現在安全就馬上） */
    async check(): Promise<void> {
      if (!o.current) return;
      let v: string | null = null;
      try { v = await o.fetchVersion(); } catch { return; } // 離線、逾時、伺服器錯：不動
      if (!v) return;
      latest = v;
      maybeReload();
    },
    /** 各頁回報現在安不安全；null＝這個元件不表態（卸載時也用 null） */
    setSafe(id: number, s: boolean | null): void {
      if (s === null) safe.delete(id); else safe.set(id, s);
      maybeReload();
    },
    /** 測試用 */
    get pending() { return !!latest && latest !== o.current && !reloaded; },
  };
}

/** 麻將房間（RoomView）的安全時機（審伯 R2、R4）：
 *  ・還沒拿到房間資料（hook 的預設是 waiting、玩家名單裡沒有自己）、邀請取名中、開局確認中、打牌中 → 不安全
 *  ・確定等人且沒有開局確認 → 安全
 *  ・整場結束：總結算真的看得到才安全；末局胡／自摸、大牌、隕石演出還在擋著結算（holdResult）→ 不安全，
 *    伺服器已經以 completed 關房也一樣（關房訊息比演出早到）
 *  ・其他關房（解散、重新整理時早已打完）顯示「這場已結束」→ 安全 */
export function mjRoomSafe(s: { nameReady: boolean; inRoom: boolean; status: string; confirming: boolean; finalOverlayShown: boolean; holdResult: boolean; closedReason: string | null }): boolean {
  const finalVisible = s.finalOverlayShown && !s.holdResult;
  if (s.closedReason !== null) return s.closedReason === "completed" && s.finalOverlayShown ? finalVisible : true; // 同 RoomView：completed＋末局結算才留在牌桌，其他顯示「這場已結束」
  if (!s.nameReady || !s.inRoom) return false;
  if (s.status === "waiting") return !s.confirming;
  return finalVisible;
}

/** 大老二房間（RoomView）的安全時機（審伯 R2）：房間已關（顯示「這場已結束」）安全；還沒拿到房間資料、取名中不安全；確定等人且沒有開局確認、這局結束安全 */
export function big2RoomSafe(s: { nameReady: boolean; inRoom: boolean; status: string; confirming: boolean; closed: boolean }): boolean {
  if (s.closed) return true;
  if (!s.nameReady || !s.inRoom) return false;
  return (s.status === "waiting" && !s.confirming) || s.status === "finished";
}

export const BUILD_VERSION = process.env.NEXT_PUBLIC_BUILD_VERSION ?? "";

let shared: ReturnType<typeof createUpdater> | null = null;
function getShared() {
  if (shared || typeof window === "undefined" || !BUILD_VERSION) return shared;
  let store: Store | null = null;
  try { store = window.sessionStorage; } catch { store = null; }
  const u = createUpdater({
    current: BUILD_VERSION,
    fetchVersion: async () => {
      const r = await fetch(`/api/version?t=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) return null;
      const body = (await r.json()) as { v?: unknown };
      return typeof body.v === "string" && body.v ? body.v : null;
    },
    reload: () => window.location.reload(),
    store,
  });
  shared = u;
  const visible = () => document.visibilityState === "visible";
  // 每 5 分鐘（只在畫面看得到時問）＋回到前景＋頁面重新顯示（主畫面捷徑從背景回來、上一頁回來）
  window.setInterval(() => { if (visible()) void u.check(); }, CHECK_EVERY_MS);
  document.addEventListener("visibilitychange", () => { if (visible()) void u.check(); });
  window.addEventListener("pageshow", (e) => { if ((e as PageTransitionEvent).persisted) void u.check(); });
  return u;
}

let nextId = 1;
/** 頁面回報現在是不是安全時機：true＝大廳、等人、整場結束；false＝打牌中；null＝不表態 */
export function useAutoUpdate(safe: boolean | null): void {
  const [id] = useState(() => nextId++);
  useEffect(() => { getShared()?.setSafe(id, safe); }, [id, safe]);
  useEffect(() => () => getShared()?.setSafe(id, null), [id]);
}
