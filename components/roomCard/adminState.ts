// 房卡後台的兩個規則（審伯 2026-11-20 前端初審必修）：
//   一、張數輸入：照原樣保留打進來的字，只有 1～100000 的整數才能送；小數、正負號、科學記號、夾雜字元、超長數字一律不能送，
//       不會偷偷刪字或截斷變成另一個數字（原本 12.5 → 125、-5 → 5、1e3 → 13、1000000 → 100000 都會送出）
//   二、後台資料綁定讀它的那個帳號：名單、統計、明細、視窗、提示都記下屬於哪個帳號，畫面只顯示「現在登入的這個人」的；
//       登出、換帳號的那一次畫面就看不到前一個人的；舊帳號還在路上的回應晚到也不會寫回畫面（取消＋比對帳號兩道）
import type { CardPlayer, CardStats, Res } from "./client";

export const CARD_MAX = 100000;
export type CardInput = { ok: true; n: number } | { ok: false; reason: "empty" | "format" | "range" };
/** 張數欄位：整串只能是半形數字（空白、全形也不收），1～100000 */
export function parseCardInput(s: string): CardInput {
  if (s === "") return { ok: false, reason: "empty" };
  if (!/^[0-9]+$/.test(s)) return { ok: false, reason: "format" };
  if (s.length > 6) return { ok: false, reason: "range" };
  const n = Number(s);
  return n >= 1 && n <= CARD_MAX ? { ok: true, n } : { ok: false, reason: "range" };
}
/** 欄位下面的紅字：為什麼不能送 */
export const cardInputHint = (r: CardInput): string | null =>
  r.ok || r.reason === "empty" ? null : r.reason === "format" ? "只能填整數（不能有小數點、正負號或其他字）" : `要在 1～${CARD_MAX} 之間`;

/** 屬於某個帳號的畫面資料 */
export type Owned<T> = { owner: string; value: T };
/** 只回現在登入的這個人的；換人、登出（authId＝null）就是 null */
export const mine = <T>(x: Owned<T> | null, authId: string | null): T | null => (x && authId && x.owner === authId ? x.value : null);

export type AdminView = { api: "ok"; stats: CardStats; players: CardPlayer[] } | { api: "denied" } | { api: "error" };
export const viewFrom = (r: Res<{ stats: CardStats; players: CardPlayer[] }>): AdminView =>
  r.ok ? { api: "ok", stats: r.data.stats, players: r.data.players } : r.status === 401 || r.status === 403 ? { api: "denied" } : { api: "error" };

/** 讀名單（effect 用）：回應寫成「這個帳號的」；回傳取消函式（換帳號、離開頁面時呼叫，晚到的回應丟掉） */
export function loadAdmin(authId: string, fetch: () => Promise<Res<{ stats: CardStats; players: CardPlayer[] }>>,
  set: (v: Owned<AdminView>) => void): () => void {
  let alive = true;
  void fetch().then((r) => { if (alive) set({ owner: authId, value: viewFrom(r) }); }, () => { if (alive) set({ owner: authId, value: { api: "error" } }); });
  return () => { alive = false; };
}

/** 頁面要畫哪一種：登入確認中／沒登入／還沒讀到這個人的（含剛換人）／讀到了 */
export function adminAccess(authBusy: boolean, authId: string | null, view: Owned<AdminView> | null): "checking" | "denied" | "error" | "ok" {
  if (authBusy) return "checking";
  if (!authId) return "denied";
  const v = mine(view, authId);
  return v ? v.api : "checking";
}
