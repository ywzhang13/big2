// 三個遊戲（麻將、十三支、大老二）共用的聊天框狀態（老闆 2026-11-13：聊天、互動拉成共用；聊天只保存在這一場）。
// 只管「這一場的訊息清單、未讀、載入狀態」，不管怎麼送、怎麼收：各遊戲把收到的訊息（ChatMessage）和互動（effect）丟進來，
// 歷史由各遊戲提供讀取函式（麻將：GET /api/mahjong/chat/history）。格式見 lib/social/events.ts。
// 狀態放模組裡（不放 React state），畫面用 useChatLog 訂閱；node 測試可以直接呼叫（tests/_social-chat-log.ts）。
import { useSyncExternalStore } from "react";
import type { ChatMessage } from "@/lib/social/events";

/** 聊天框裡的一列：聊天訊息，或一次互動的紀錄（「阿德 對 老王 使用了 拍手」；互動不存伺服器，只有這次在場收到的） */
export type LogEntry =
  | { type: "msg"; id: string; ts: number; msg: ChatMessage }
  | { type: "fx"; id: string; ts: number; fromName: string; toName?: string; label: string };

export type LogStatus = "idle" | "loading" | "ready" | "error" | "closed";

export interface ChatLogState {
  key: string | null; // 這一場（例如「房間｜玩家」）；換了就清空
  me: string | null;  // 自己的 playerId（自己說的不算未讀）；觀戰者 null
  entries: LogEntry[]; // 由舊到新
  status: LogStatus;
  unread: number;
  open: boolean;
}

/** 歷史讀取結果：ok＝這一場到目前的訊息（由舊到新）；closed＝房間不在了（聊天已清除）；failed＝其他錯誤 */
export type HistoryResult = { ok: true; messages: ChatMessage[] } | { ok: false; reason: "closed" | "failed" };

const blank = (): ChatLogState => ({ key: null, me: null, entries: [], status: "idle", unread: 0, open: false });
let state: ChatLogState = blank();
let gen = 0; // 換場就加 1：舊的一場晚回來的歷史丟掉
const listeners = new Set<() => void>();
const emit = (patch: Partial<ChatLogState>) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };

const sortKey = (a: LogEntry, b: LogEntry) => a.ts - b.ts;

/** 加進清單：同一個 id 只留一則（即時事件和歷史可能各收到一次）；回傳有沒有真的加 */
function add(list: LogEntry[], items: LogEntry[]): LogEntry[] | null {
  const ids = new Set(list.map((e) => e.id));
  const fresh = items.filter((e) => !ids.has(e.id) && (ids.add(e.id), true));
  if (fresh.length === 0) return null;
  return [...list, ...fresh].sort(sortKey); // 每房最多幾百則，直接排序（依伺服器時間由舊到新）
}

/** 開始一場（key＝null：離開、房間關了）。同一場重複呼叫不會清空 */
export function bindChatLog(key: string | null, me: string | null = null): void {
  if (key === state.key && me === state.me) return;
  gen++;
  state = { ...blank(), key, me, open: state.open };
  listeners.forEach((l) => l());
}

/** 讀這一場的歷史並合併進來（進房、重新整理、斷線重連、開始觀戰時各呼叫一次）。歷史裡的訊息不算未讀 */
export async function loadChatHistory(load: () => Promise<HistoryResult>): Promise<void> {
  if (!state.key || state.status === "closed") return; // 這一場已經關了：不再讀（換新的一場由 bindChatLog 重設）
  const mine = gen;
  emit({ status: state.status === "ready" ? "ready" : "loading" });
  let r: HistoryResult;
  try { r = await load(); } catch { r = { ok: false, reason: "failed" }; }
  // 讀的時候換場了、或這一場已經關了（markChatLogClosed 或另一個請求回報關房都會讓 gen 加 1）：結果丟掉
  if (mine !== gen) return;
  if (!r.ok) {
    if (r.reason === "closed") { markChatLogClosed(); return; } // 也作廢其他還沒回來的請求
    emit({ status: state.entries.length ? "ready" : "error" });
    return;
  }
  // 已經在清單裡的同一則：用歷史這份換掉語音資料（播放網址會重新簽發、檔案清掉時是 null；審伯 2026-11-13 必修②）。
  // 位置（ts）、則數、未讀都不變
  const hist = new Map(r.messages.map((m) => [m.id, m]));
  let refreshed = false;
  const current = state.entries.map((e) => {
    const h = e.type === "msg" ? hist.get(e.id) : undefined;
    if (!h || e.type !== "msg" || (h.url === e.msg.url && h.durationMs === e.msg.durationMs)) return e;
    refreshed = true;
    return { ...e, msg: { ...e.msg, url: h.url ?? null, durationMs: h.durationMs } };
  });
  const merged = add(current, r.messages.map((m) => ({ type: "msg" as const, id: m.id, ts: m.ts, msg: m }))) ?? (refreshed ? current : null);
  emit({ status: "ready", ...(merged ? { entries: merged } : {}) });
}

/** 遊戲得知房間已關閉（例如送出時回 410 room_closed）：清掉這一場的內容，顯示「房間已關閉，本場聊天已清除」 */
export function markChatLogClosed(): void {
  if (!state.key) return;
  gen++; // 還沒回來的歷史請求全部作廢：成功、失敗都不能蓋掉「已關閉」（審伯 2026-11-13 必修）
  emit({ status: "closed", entries: [], unread: 0 });
}

/** 即時收到一則聊天（別人或自己的）。沒開著時別人的訊息算未讀 */
export function addChatMessage(m: ChatMessage): void {
  if (!state.key || state.status === "closed" || !m?.id) return; // 關房後晚到的不收
  const merged = add(state.entries, [{ type: "msg", id: m.id, ts: m.ts, msg: m }]);
  if (!merged) return;
  const unread = !state.open && m.from !== state.me ? state.unread + 1 : state.unread;
  emit({ entries: merged, unread });
}

/** 即時收到一次互動（只放清單，不算未讀；現場動畫各遊戲自己播） */
export function addChatEffect(e: { id: string; ts: number; fromName: string; toName?: string; label: string }): void {
  if (!state.key || state.status === "closed" || !e?.id) return; // 關房後晚到的不收
  const merged = add(state.entries, [{ type: "fx", ...e }]);
  if (merged) emit({ entries: merged });
}

/** 聊天框開關（開著時未讀歸零） */
export function setChatLogOpen(open: boolean): void {
  if (open === state.open) return;
  emit({ open, ...(open ? { unread: 0 } : {}) });
}

function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
const get = () => state;
// 伺服器端也回模組裡的狀態：伺服器上永遠是空的（只有瀏覽器會呼叫 bind／add），水合前後一致；測試用 renderToStaticMarkup 才看得到內容
export function useChatLog(): ChatLogState { return useSyncExternalStore(subscribe, get, get); }

/** 測試用 */
export const __peekChatLog = () => state;
export function __resetChatLog() { gen++; state = blank(); listeners.forEach((l) => l()); }
