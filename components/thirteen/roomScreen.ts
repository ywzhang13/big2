// 十三支頁面的幾個小判斷（抽出來才測得到；app/thirteen/page.tsx、ThWaiting 用）
//   恢復房間（審伯必修 1）：入座成功就把這間房的 id、座位存在分頁裡；重新整理時網址的房號跟存的一樣，就直接用存的房間 id 讀狀態，
//     不再呼叫 join——房間已經關了也讀得到 410 紀錄（末局亮牌、四家名字、總分），房號被別場重用也不會誤入新場
//   總結算看過了（必修 1）：重新整理後直接回總結算，不再重播末局亮牌
//   亮牌中被解散（必修 2）：房間關了、又不是「整場打完」的最後一局，就不再播亮牌或等確認，直接進關房總結算
//   等人畫面的按鈕（必修 3）：網路例外也要解除等待、顯示錯誤，網路回來可以再按
import type { ThJoin } from "./useThirteenRoom";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const JOIN_KEY = "th_last_join";
const finalKey = (roomId: string) => `th_final_seen_${roomId}`;
const safe = <T>(fn: () => T, fallback: T): T => { try { return fn(); } catch { return fallback; } };

export function saveLastJoin(store: Store, j: ThJoin): void {
  safe(() => store.setItem(JOIN_KEY, JSON.stringify(j)), undefined);
}
/** 網址的房號跟上次入座的一樣才回傳（換了房號＝要進別的房，照常 join） */
export function loadLastJoin(store: Store, code: string): ThJoin | null {
  const j = safe(() => JSON.parse(store.getItem(JOIN_KEY) ?? "null") as ThJoin | null, null);
  return j && j.code === code && typeof j.roomId === "string" && typeof j.seat === "number" ? j : null;
}
export function clearLastJoin(store: Store): void {
  safe(() => store.removeItem(JOIN_KEY), undefined);
}
export function markFinalSeen(store: Store, roomId: string): void {
  safe(() => store.setItem(finalKey(roomId), "1"), undefined);
}
export const finalSeen = (store: Store, roomId: string): boolean => safe(() => store.getItem(finalKey(roomId)) === "1", false);

/** 亮牌那一段要顯示什麼：reveal＝亮牌／本局結算；final＝整場打完的總結算；closed＝房間被關（解散）→ 關房總結算；none＝都不是 */
export function revealScreen(o: {
  hasShow: boolean;
  showFinal: boolean;
  confirmed: boolean;
  newHandStarted: boolean;
  /** 房間已關（410／404） */
  closed: boolean;
}): "reveal" | "final" | "closed" | "none" {
  if (o.hasShow && !o.newHandStarted) {
    if (o.closed && !o.showFinal) return "closed"; // 非末局亮牌、結算確認前或確認後被解散：不再等下一局
    return o.showFinal && o.confirmed ? "final" : "reveal";
  }
  return o.closed ? "closed" : "none";
}

/** 等人畫面的按鈕：等待中 → 呼叫 → 不管成功、被拒、網路例外都解除等待；被拒或例外顯示錯誤 */
export async function guarded(
  fn: () => Promise<{ ok: boolean; message?: string }>,
  setBusy: (b: boolean) => void,
  setMsg: (m: string) => void,
  failMsg: string,
): Promise<void> {
  setBusy(true);
  setMsg("");
  try {
    const r = await fn();
    if (!r.ok) setMsg(r.message ?? failMsg);
  } catch {
    setMsg("網路不穩，請再試一次");
  } finally {
    setBusy(false);
  }
}

// ---- 本局結算「確認」（審伯必修 1，2026-11-18）：只有伺服器收下（200）或伺服器快照的 nextReady 有自己，才算已確認 ----
export type ConfirmState = { key: string; status: "sending" | "done" | "error"; message?: string } | null;
/** 畫面要顯示的確認狀態：已確認＝這一局的請求成功，或伺服器說我按過了；失敗就顯示原因、按鈕可以再按 */
export function confirmView(st: ConfirmState, key: string, nextReady: readonly string[] | undefined, playerId: string) {
  const mine = st?.key === key ? st : null;
  return {
    confirmed: mine?.status === "done" || !!nextReady?.includes(playerId),
    sending: mine?.status === "sending",
    error: mine?.status === "error" ? (mine.message ?? "確認失敗，請再按一次") : null,
  };
}
/** 送出確認：送出中 → 成功（done）／被拒或斷線（error，帶原因；可以重按，倒數到了也會自己再試） */
export async function sendConfirm(next: () => Promise<{ ok: boolean; message?: string }>, key: string, set: (s: ConfirmState) => void): Promise<boolean> {
  set({ key, status: "sending" });
  try {
    const r = await next();
    set(r.ok ? { key, status: "done" } : { key, status: "error", message: r.message ?? "確認失敗，請再按一次" });
    return r.ok;
  } catch {
    set({ key, status: "error", message: "網路不穩，請再按一次" });
    return false;
  }
}
/** 倒數到了自動確認：還沒確認、不在送出中、距離上次自動送出超過 3 秒（失敗後會再試） */
export const shouldAutoConfirm = (o: { now: number; autoAt: number; confirmed: boolean; sending: boolean; lastAutoAt: number | null }) =>
  !o.confirmed && !o.sending && o.now >= o.autoAt && (o.lastAutoAt === null || o.now - o.lastAutoAt >= 3000);

// ---- 伺服器時差（審伯必修 2）：末局重新整理只拿得到 410（沒有 serverNow）也要知道伺服器現在幾點 ----
const SKEW_KEY = "th_clock_skew";
/** 伺服器時間 − 本機時間：這個分頁之前用 200 回應量過就記下來（重新整理還在） */
export function saveSkew(store: Store, skew: number): void { safe(() => store.setItem(SKEW_KEY, String(Math.round(skew))), undefined); }
export function loadSkew(store: Store): number | null {
  const v = safe(() => store.getItem(SKEW_KEY), null);
  return v !== null && Number.isFinite(Number(v)) ? Number(v) : null;
}
/** 從回應的 Date 標頭估時差（只到秒：取那一秒的中間，誤差 ±0.5 秒＋網路單程）；沒有標頭回 null */
export function skewFromDateHeader(date: string | null, sentAt: number, recvAt: number): number | null {
  const t = date ? Date.parse(date) : NaN;
  return Number.isFinite(t) ? t + 500 - (sentAt + recvAt) / 2 : null;
}
/** 關房（410）時用哪個時差：分頁記過的優先（毫秒級），沒有就用 Date 標頭，都沒有維持原值 */
export const skewOnClosed = (stored: number | null, fromHeader: number | null, current: number) => stored ?? fromHeader ?? current;
/** 亮牌演出照伺服器時間：起點＝revealedAt 換成本機時間；過了 settleAt 就直接顯示結算 */
export function revealClock(rv: { revealedAt: number | null; settleAt: number | null }, skew: number, now: number, fallbackStart: number) {
  const startAt = rv.revealedAt !== null ? rv.revealedAt - skew : fallbackStart;
  return { startAt, elapsed: now - startAt, pastSettle: rv.settleAt !== null && now + skew >= rv.settleAt };
}
