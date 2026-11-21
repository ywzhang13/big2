// 三款共用的文字聊天前端狀態（小宜〈十三支共用聊天互動 v1〉§6：從麻將 lib/mahjong/chatClient.ts 抽出來，送出網址改成由遊戲傳進來）。
// 這一版只有文字和快捷短語（語音是第二階段）；麻將這次不換，繼續用自己的 chatClient。
// 送：POST <chatUrl>（{ roomId, phrase } 或 { roomId, text }）。收：遊戲把座位頻道的 mj_chat 交給 receiveSocialChat（發送者自己也會收到，用 id 去重）。
// 狀態綁「帳號＋房間＋座位」（bindSocialChat），一換就清空；舊的一場晚回來的 POST 回應、mj_chat 一律丟掉。冷卻以伺服器的 429 retryAfterMs 為準。
// 狀態放在模組裡（不放 React state）：畫面用 useSocialChat 訂閱；node 測試可以用假的 IO 和時鐘直接跑（tests/_social-chat-client.ts）。
import { useSyncExternalStore } from "react";
import type { ChatMessage } from "./events";
import { mjFetch } from "@/lib/mahjong/clientAuth";

/** 快捷短語（和麻將同一組；送 id，伺服器換成文字） */
export const PHRASES = [
  { id: "nice", text: "好牌" },
  { id: "wait", text: "等我一下" },
  { id: "hurry", text: "快點啦" },
  { id: "thanks", text: "謝謝" },
] as const;
export type PhraseId = (typeof PHRASES)[number]["id"];
export const TEXT_MAX = 40;
export const TEXT_TTL = 5000; // 文字泡泡 5 秒後淡出
export const MAX_PER_SEAT = 3;
const MIN_GAP_MS = 2000; // 每則至少間隔 2 秒（伺服器同樣規則）
const NOTE_MS = 1800;

export interface Bubble { id: string; seat: number; name: string; text: string; mine: boolean; until: number }

export interface SocialChatState {
  bubbles: Bubble[];
  sending: boolean;
  failed: { label: string } | null; // 「傳送失敗，點此重試」
  readyAt: number; // 這個時間之前短語、送出鍵 disabled（冷卻倒數）
  note: { text: string; until: number } | null;
  now: number;
}

export type SocialChatIO = {
  now(): number;
  setTimer(f: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimer(t: ReturnType<typeof setTimeout>): void;
  postJSON(url: string, body: object): Promise<{ status: number; body: Record<string, unknown> }>;
};
const browserIO: SocialChatIO = {
  now: () => Date.now(),
  setTimer: (f, ms) => setTimeout(f, ms),
  clearTimer: (t) => clearTimeout(t),
  async postJSON(url, body) {
    const r = await mjFetch(url, { method: "POST", body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  },
};

/** 一場：帳號、房間、座位，加上送出網址（例：/api/thirteen/chat） */
export type SocialChatSession = { account: string; roomId: string; roomCode: string; myId: string; mySeat: number; chatUrl: string };
let io: SocialChatIO = browserIO;
let session: SocialChatSession | null = null;
let epoch = 0;
let state: SocialChatState = fresh();
const listeners = new Set<() => void>();
const seen = new Set<string>();
let tick: ReturnType<typeof setTimeout> | undefined;
let lastFailed: (() => Promise<void>) | null = null;

function fresh(): SocialChatState {
  return { bubbles: [], sending: false, failed: null, readyAt: 0, note: null, now: io?.now() ?? 0 };
}
function emit(patch: Partial<SocialChatState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
  schedule();
}
/** 有東西會隨時間改變（泡泡淡出、冷卻倒數、提示）才跑計時器 */
function schedule() {
  const busy = state.bubbles.length > 0 || state.readyAt > state.now || state.note;
  if (!busy) { if (tick !== undefined) { io.clearTimer(tick); tick = undefined; } return; }
  if (tick !== undefined) return;
  tick = io.setTimer(() => { tick = undefined; step(); }, 250);
}
function step() {
  const now = io.now();
  emit({ now, bubbles: state.bubbles.filter((b) => b.until > now), note: state.note && state.note.until > now ? state.note : null });
}

/** 換場：全部清空 */
function clearAll() {
  epoch++;
  seen.clear();
  lastFailed = null;
  if (tick !== undefined) { io.clearTimer(tick); tick = undefined; }
  state = fresh();
  listeners.forEach((l) => l());
}

const sameSession = (a: SocialChatSession, b: SocialChatSession) =>
  a.account === b.account && a.roomId === b.roomId && a.roomCode === b.roomCode && a.myId === b.myId && a.mySeat === b.mySeat && a.chatUrl === b.chatUrl;
/** 告訴聊天「現在是誰、在哪一桌」：任何一個變了就清空；null＝離開房間、登出 */
export function bindSocialChat(s: SocialChatSession | null): void {
  if ((s && session && sameSession(s, session)) || (!s && !session)) return;
  session = s;
  clearAll();
}
export const socialChatSession = () => session;

// ---- 收 ----
function addBubble(m: ChatMessage) {
  const now = io.now();
  const b: Bubble = { id: m.id, seat: m.fromSeat, name: m.fromName, text: m.text ?? "", mine: !!session && m.from === session.myId, until: now + TEXT_TTL };
  // 每個座位最多三則（新的貼名牌、舊的往外推）；超過的從最舊的拿掉
  const sameSeat = state.bubbles.filter((x) => x.seat === b.seat);
  const drop = new Set(sameSeat.slice(0, Math.max(0, sameSeat.length - (MAX_PER_SEAT - 1))).map((x) => x.id));
  emit({ now, bubbles: [...state.bubbles.filter((x) => !drop.has(x.id)), b] });
}

const taps = new Set<(m: ChatMessage) => void>();
/** 收到（通過這一場的檢查、去重後）的每一則都通知：聊天室清單用（components/social/chatLog.ts） */
export function subscribeSocialChat(l: (m: ChatMessage) => void): () => void {
  taps.add(l);
  return () => { taps.delete(l); };
}

/** 遊戲收到 mj_chat、或自己 POST 成功時呼叫。forPlayer＝這一則送給哪個座位、roomCode＝收到它的頻道屬於哪一房（不是目前這一場就丟）。
 *  語音（第二階段）這一版不顯示泡泡，只進聊天室清單 */
export function receiveSocialChat(m: ChatMessage, forPlayer?: string, roomCode?: string): void {
  if (!session || !m?.id || (forPlayer && forPlayer !== session.myId)) return;
  if (roomCode !== undefined && roomCode !== session.roomCode) return;
  if (seen.has(m.id)) return;
  seen.add(m.id);
  if (m.kind === "text") addBubble(m);
  taps.forEach((l) => l(m));
}

// ---- 送 ----
export type SendError = "cooldown" | "guest" | "not_in_room" | "room_closed" | "failed" | "busy" | "empty" | null;

const closedTaps = new Set<() => void>();
/** 送出時房間剛好關掉（410 room_closed）：通知聊天室顯示「房間已關閉」 */
export function subscribeSocialChatClosed(l: () => void): () => void {
  closedTaps.add(l);
  return () => { closedTaps.delete(l); };
}

async function send(body: Record<string, unknown>, label: string): Promise<SendError> {
  const s = session;
  if (!s) return "not_in_room";
  if (state.sending) return "busy";
  const now = io.now();
  if (state.readyAt > now) return "cooldown";
  const mine = epoch;
  emit({ sending: true, failed: null, now });
  let res: { status: number; body: Record<string, unknown> };
  try { res = await io.postJSON(s.chatUrl, { roomId: s.roomId, ...body }); } catch { res = { status: 0, body: {} }; }
  if (mine !== epoch) return null; // 送出途中換帳號、換房間：結果作廢
  const t = io.now();
  const msg = res.body.message as ChatMessage | undefined;
  if (res.status === 200 && msg) {
    lastFailed = null;
    emit({ sending: false, failed: null, readyAt: t + MIN_GAP_MS, now: t });
    receiveSocialChat(msg);
    return null;
  }
  if (res.status === 429) {
    const ms = typeof res.body.retryAfterMs === "number" ? res.body.retryAfterMs : MIN_GAP_MS;
    emit({ sending: false, readyAt: t + ms, now: t }); // 「請等 N 秒再傳」由畫面照 readyAt 倒數
    return "cooldown";
  }
  if (res.status === 403 && res.body.error === "guest_not_allowed") {
    emit({ sending: false });
    noteText("登入 LINE 後就能聊天。", 2500);
    return "guest";
  }
  if (res.status === 410 && res.body.error === "room_closed") {
    lastFailed = null;
    emit({ sending: false, failed: null });
    noteText("房間已關閉，訊息沒有送出", 2500);
    closedTaps.forEach((l) => l());
    return "room_closed";
  }
  if (res.status === 403 || res.status === 404) { emit({ sending: false }); return "not_in_room"; }
  // 伺服器錯、網路：「傳送失敗，點此重試」（不扣冷卻）
  lastFailed = async () => { await send(body, label); };
  emit({ sending: false, failed: { label } });
  return "failed";
}

export const sendSocialPhrase = (id: PhraseId): Promise<SendError> => send({ phrase: id }, "短語");
export function sendSocialText(text: string): Promise<SendError> {
  const t = text.trim();
  if (!t) return Promise.resolve("empty");
  return send({ text: [...t].slice(0, TEXT_MAX).join("") }, "文字");
}

export function retrySocialFailed(): void {
  const f = lastFailed;
  lastFailed = null;
  if (f) void f();
}
export function dismissSocialFailed(): void { lastFailed = null; emit({ failed: null }); }
export function noteText(text: string, ms = NOTE_MS): void { emit({ note: { text, until: io.now() + ms }, now: io.now() }); }

// ---- 畫面 ----
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
const getState = () => state;
const SERVER_STATE = fresh();
export function useSocialChat(): SocialChatState {
  return useSyncExternalStore(subscribe, getState, () => SERVER_STATE);
}

/** 測試用 */
export const __peekSocialChat = () => state;
export function __testSocialChat(fake: SocialChatIO): void { io = fake; session = null; clearAll(); }
