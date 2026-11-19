// 三款共用的暱稱規則（小宜〈共用開房流程 v1.1〉§4-2，老闆 2026-11-19 定案）：
//   最多 8 個字（一個中文字、英文字母、表情符號都算 1 個：Array.from）；送出前去掉前後空白，空的不能送
//   存在這台裝置的 game_name（三款共用；麻將、十三支的遊客分頁由呼叫端傳 sessionStorage）
//   第一次讀而且是空的：搬舊名字——mj_name_source 是 manual 搬 mj_name，否則有 big2_name 搬 big2_name（超過 8 個字取前 8 個，舊 key 不刪）
//   欄位預設值：game_name → 有登入用 LINE 名稱前 8 個字 → 空白
// 這個檔不能引用任何登入程式（大老二頁面不能有 LINE 登入入口）

export const NAME_MAX = 8;
export const GAME_NAME_KEY = "game_name";

export const nameLength = (s: string) => Array.from(s).length;
/** 只留前 8 個字（輸入時就擋住第 9 個字） */
export const cutName = (s: string) => Array.from(s).slice(0, NAME_MAX).join("");
/** 送出用的名字：去掉前後空白後 1～8 個字才合法，不合法回 null */
export function validName(s: string): string | null {
  const t = s.trim();
  return t && nameLength(t) <= NAME_MAX ? t : null;
}

type Store = Pick<Storage, "getItem" | "setItem">;

// 瀏覽器存不了（儲存空間滿了 QuotaExceededError、隱私模式擋住讀寫）時不能擋住大廳和入座（審伯 2026-11-19 必修）：
// 讀不到當成沒有；寫不進去就記在這一頁的記憶體（每個儲存區各記一份），這一頁之後照樣用這個名字
const pageMemory = new WeakMap<Store, string>();
const safeGet = (store: Store | null, key: string): string | null => { try { return store?.getItem(key) ?? null; } catch { return null; } };
function safeSave(store: Store, name: string): void {
  pageMemory.set(store, name);
  try { store.setItem(GAME_NAME_KEY, name); } catch { /* 存不進去：這一頁用 pageMemory 的 */ }
}

/** 讀這台存的名字；沒有就照規則搬一次舊名字（搬到了就存成 game_name）。都沒有回 "" */
export function loadGameName(store: Store, legacy: { mj: Store | null; big2: Store | null }): string {
  const cur = pageMemory.get(store) || safeGet(store, GAME_NAME_KEY); // 這一頁送出過的優先（存不進去時儲存區裡還是舊的）
  if (cur) return cur;
  const mj = safeGet(legacy.mj, "mj_name_source") === "manual" ? safeGet(legacy.mj, "mj_name") : null;
  const old = validName(cutName((mj || safeGet(legacy.big2, "big2_name") || "").trim()));
  if (!old) return "";
  safeSave(store, old);
  return old;
}

/** 按下建立房間／加入，成功送出時存（去掉前後空白後的名字）；存不進去不丟錯 */
export function saveGameName(store: Store, name: string): void {
  const n = validName(name);
  if (n) safeSave(store, n);
}

/** 暱稱欄的預設值，以及是不是 LINE 帶入的（欄位右邊顯示「● LINE 名稱」） */
export function initialName(stored: string, lineName: string | null): { name: string; fromLine: boolean } {
  if (stored) return { name: stored, fromLine: false };
  const line = cutName((lineName ?? "").trim()).trim(); // 切完前 8 個字可能剛好停在空白上
  return line ? { name: line, fromLine: true } : { name: "", fromLine: false };
}

/** 點邀請連結進來：這台還沒存過名字（第一次）才問名字，有名字就直接入座（三款都一樣，§6） */
export const inviteNeedsName = (stored: string) => !stored;
