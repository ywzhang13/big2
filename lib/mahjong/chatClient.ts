// 打字聊天與語音訊息的前端（小宜〈麻將聊天與語音訊息-UIUX設計規格-2026-10-21〉、老柯〈聊天與語音訊息-後端API說明-給老馬-2026-10-23〉）。
// 送：POST /api/mahjong/chat（快捷短語 phrase、自由文字 text）、/api/mahjong/voice（語音，multipart）。
// 收：自己座位頻道的 mj_chat（useMahjong 收到後呼叫 receiveChat）。發送者自己也會收到，和 POST 回應同一個 id，用 id 去重。
// 泡泡貼哪個名牌一律看 fromSeat；冷卻以伺服器的 429 retryAfterMs 為準。
// 跨帳號殘留（審伯退回第 4 項，後端說明第 5 節）：狀態綁在「帳號＋房間＋座位」上（bindChatSession），
//   mj_chat 另外帶「收到它的頻道屬於哪個房號」，不是目前綁定的房號就丟（換房後才送達的舊房事件；審伯 2026-10-21 退回②），
//   一換就把泡泡、播放佇列、送出中、失敗、冷卻全部清掉，計時器、聲音都停；舊的那一場晚回來的 POST 回應、mj_chat 一律丟掉。
// 狀態放在這個模組（不放 React state）：畫面用 useChatState 訂閱；node 測試可以用假的 IO 和時鐘直接跑（tests/_chat-client.ts）。
import { useSyncExternalStore } from "react";
import { authHeaders, mjFetch } from "./clientAuth";
import { getPrefs, onPrefsChange, voiceGain } from "./prefs";

/** 快捷短語（老闆 2026-10-22 定案；送 id，伺服器換成文字） */
export const PHRASES = [
  { id: "nice", text: "好牌" },
  { id: "wait", text: "等我一下" },
  { id: "hurry", text: "快點啦" },
  { id: "thanks", text: "謝謝" },
] as const;
export type PhraseId = (typeof PHRASES)[number]["id"];
export const TEXT_MAX = 40;
export const VOICE_MAX_MS = 10000;
export const VOICE_MIN_MS = 500; // 規格：少於 0.5 秒不送
const TEXT_TTL = 5000; // 文字泡泡 5 秒後淡出
const VOICE_TTL = 12000; // 語音泡泡沒播：留 12 秒讓人按
const AFTER_PLAY = 2000; // 播完 2 秒後淡出
const MINE_AFTER = 3000; // 自己的語音：播完（或自動播放關閉時、語音長度過後）3 秒淡出（老闆 2026-10-21）
const MAX_PER_SEAT = 3;
const MIN_GAP_MS = 2000; // 每則至少間隔 2 秒（伺服器同樣規則）
const NOTE_MS = 1800;

/** 伺服器送來的訊息（mj_chat 的 message，也是 POST 回應裡的 message） */
export interface ChatMessage {
  id: string;
  kind: "text" | "voice";
  from: string;
  fromName: string;
  fromSeat: number;
  text?: string;
  phrase?: string;
  url?: string;
  durationMs?: number;
  ts: number;
}

export interface Bubble {
  id: string;
  seat: number;
  name: string;
  kind: "text" | "voice";
  text?: string;
  url?: string;
  durationMs?: number;
  mine: boolean;
  until: number; // 這個時間之後淡出
  blocked?: boolean; // 瀏覽器擋了自動播放：泡泡顯示「點一下播放」
}

export interface ChatState {
  bubbles: Bubble[];
  playing: { id: string; startedAt: number; durationMs: number } | null;
  sending: boolean;
  failed: { label: string } | null; // 「傳送失敗，點此重試」
  readyAt: number; // 這個時間之前錄音鍵、送出鍵 disabled（冷卻倒數）
  note: { text: string; until: number } | null; // 小提示：已取消、回合開始錄音已取消、登入 LINE 後…
  autoOffNotice: { seat: number; until: number } | null; // 首次收到語音而自動播放關閉：名牌上方提示一次
  open: boolean; // 聊天底板開著
  now: number;
}

/** 和伺服器、播放器、時鐘溝通的部分（測試會換成假的） */
export type ChatIO = {
  now(): number;
  setTimer(f: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimer(t: ReturnType<typeof setTimeout>): void;
  postJSON(body: object): Promise<{ status: number; body: Record<string, unknown> }>;
  postVoice(roomId: string, blob: Blob): Promise<{ status: number; body: Record<string, unknown> }>;
  /** 播一段語音；回傳停止函式。onEnd 播完（或失敗）時呼叫；blocked＝瀏覽器擋了自動播放 */
  play(url: string, volume: number, onEnd: (r: { blocked?: boolean }) => void): () => void;
  /** 正在播的那一段改音量（設定裡拉語音拉霸時，播放中的也馬上跟著變） */
  setVolume?(volume: number): void;
};
let playingAudio: HTMLAudioElement | null = null;

const browserIO: ChatIO = {
  now: () => Date.now(),
  setTimer: (f, ms) => setTimeout(f, ms),
  clearTimer: (t) => clearTimeout(t),
  async postJSON(body) {
    const r = await mjFetch("/api/mahjong/chat", { method: "POST", body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  },
  async postVoice(roomId, blob) {
    const fd = new FormData();
    fd.set("roomId", roomId);
    fd.set("audio", blob, "rec");
    // multipart 要讓瀏覽器自己帶 boundary，不能用 mjFetch（它會設成 JSON）
    const r = await fetch("/api/mahjong/voice", { method: "POST", headers: await authHeaders(), body: fd });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  },
  play(url, volume, onEnd) {
    const a = new Audio(url);
    a.volume = volume;
    playingAudio = a;
    let done = false;
    const end = (r: { blocked?: boolean } = {}) => { if (!done) { done = true; if (playingAudio === a) playingAudio = null; onEnd(r); } };
    a.onended = () => end();
    a.onerror = () => end();
    a.play().catch((e: { name?: string }) => end({ blocked: e?.name === "NotAllowedError" }));
    return () => { done = true; if (playingAudio === a) playingAudio = null; a.pause(); a.src = ""; };
  },
  setVolume(volume) { if (playingAudio) playingAudio.volume = volume; },
};

// ---- 一場（帳號＋房間＋座位） ----
type Session = { account: string; roomId: string; roomCode: string; myId: string; mySeat: number };
let io: ChatIO = browserIO;
let session: Session | null = null;
let epoch = 0;
let state: ChatState = fresh();
const listeners = new Set<() => void>();
const seen = new Set<string>();
let queue: string[] = []; // 等著自動播放的語音（依到達順序，不重疊）
let stopAudio: (() => void) | null = null;
let tick: ReturnType<typeof setTimeout> | undefined;
let autoOffShown = false;
let lastFailed: (() => Promise<void>) | null = null;

function fresh(): ChatState {
  return { bubbles: [], playing: null, sending: false, failed: null, readyAt: 0, note: null, autoOffNotice: null, open: false, now: io?.now() ?? 0 };
}
function emit(patch: Partial<ChatState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
  schedule();
}

/** 有東西會隨時間改變（泡泡淡出、冷卻倒數、播放進度、提示）才跑計時器；沒有就停 */
function schedule() {
  const busy = state.bubbles.length > 0 || state.readyAt > state.now || state.note || state.autoOffNotice || state.playing;
  if (!busy) { if (tick !== undefined) { io.clearTimer(tick); tick = undefined; } return; }
  if (tick !== undefined) return;
  tick = io.setTimer(() => { tick = undefined; step(); }, 250);
}
function step() {
  const now = io.now();
  emit({
    now,
    bubbles: state.bubbles.filter((b) => b.until > now || state.playing?.id === b.id),
    note: state.note && state.note.until > now ? state.note : null,
    autoOffNotice: state.autoOffNotice && state.autoOffNotice.until > now ? state.autoOffNotice : null,
  });
}

/** 換場：全部清空（泡泡、佇列、聲音、送出中、失敗、冷卻、提示、計時器） */
function clearAll() {
  epoch++;
  stopAudio?.();
  stopAudio = null;
  queue = [];
  seen.clear();
  autoOffShown = false;
  lastFailed = null;
  if (tick !== undefined) { io.clearTimer(tick); tick = undefined; }
  state = fresh();
  listeners.forEach((l) => l());
}

/** 告訴聊天「現在是誰、在哪一桌」：帳號、房間、座位任何一個變了就清空；null＝離開房間、登出 */
export function bindChatSession(s: Session | null) {
  const same = s && session && s.account === session.account && s.roomId === session.roomId && s.roomCode === session.roomCode && s.myId === session.myId && s.mySeat === session.mySeat;
  if (same || (!s && !session)) return;
  session = s;
  clearAll();
}

// ---- 收 ----
function addBubble(m: ChatMessage) {
  const now = io.now();
  const mine = !!session && m.from === session.myId;
  const b: Bubble = {
    id: m.id, seat: m.fromSeat, name: m.fromName, kind: m.kind, mine,
    ...(m.kind === "text" ? { text: m.text ?? "" } : { url: m.url, durationMs: m.durationMs ?? 0 }),
    until: now + (m.kind === "text" ? TEXT_TTL : VOICE_TTL),
  };
  // 這台會不會自動播：自動播放開、語音沒靜音
  const auto = getPrefs().autoVoice && !getPrefs().voiceMuted;
  // 自己的語音、不會自動播：語音長度過後 3 秒淡出（不用留著等人按）
  if (m.kind === "voice" && mine && !auto) b.until = now + (m.durationMs ?? 0) + MINE_AFTER;
  // 每個座位最多三則（新的貼名牌、舊的往外推）；超過的從最舊的拿掉
  const sameSeat = state.bubbles.filter((x) => x.seat === b.seat);
  const drop = new Set(sameSeat.slice(0, Math.max(0, sameSeat.length - (MAX_PER_SEAT - 1))).map((x) => x.id));
  emit({ now, bubbles: [...state.bubbles.filter((x) => !drop.has(x.id)), b] });
  if (m.kind !== "voice") return;
  if (getPrefs().voiceMuted) return; // 語音靜音：不播、也不提示「自動播放已關閉」
  if (!auto) {
    if (mine) return; // 自己的：不播、也不提示
    if (!autoOffShown) { autoOffShown = true; emit({ autoOffNotice: { seat: b.seat, until: now + 2000 } }); }
    return;
  }
  queue.push(b.id);
  if (!state.playing) playNext();
}

/** useMahjong 收到 mj_chat、或自己 POST 成功時呼叫。forPlayer＝這一則是送給哪個座位的、roomCode＝收到它的頻道屬於哪一房
 *  （任一個不是目前綁定的就丟掉）；自己 POST 的回應已經用 epoch 擋過換場，不帶 */
export function receiveChat(m: ChatMessage, forPlayer?: string, roomCode?: string) {
  if (!session || !m?.id || (forPlayer && forPlayer !== session.myId)) return;
  if (roomCode !== undefined && roomCode !== session.roomCode) return;
  if (seen.has(m.id)) return;
  seen.add(m.id);
  addBubble(m);
}

// ---- 播放 ----
function playNext() {
  while (queue.length) {
    const id = queue.shift()!;
    const b = state.bubbles.find((x) => x.id === id);
    if (b?.url) { play(b); return; }
  }
}

/** 按泡泡：沒在播就播（自動播放關閉、被瀏覽器擋了也能按）；正在播這一則就停。語音靜音時不播 */
export function toggleVoice(id: string) {
  if (state.playing?.id === id) { stopPlaying(); return; }
  if (getPrefs().voiceMuted) { noteText("語音已靜音", NOTE_MS); return; }
  const b = state.bubbles.find((x) => x.id === id);
  if (b?.url) { stopPlaying(false); play(b); }
}

// 設定改了：播放中的語音馬上跟著改音量；按了語音靜音就停掉，排隊的也不播
let prefsHooked = false;
function onPrefs() {
  if (!state.playing) return;
  if (getPrefs().voiceMuted) { queue = []; stopPlaying(false); return; }
  io.setVolume?.(voiceGain(getPrefs()));
}

function play(b: Bubble) {
  if (!prefsHooked) { prefsHooked = true; onPrefsChange(onPrefs); }
  const mine = epoch;
  const now = io.now();
  const vol = voiceGain(getPrefs());
  emit({ playing: { id: b.id, startedAt: now, durationMs: b.durationMs ?? 0 }, bubbles: state.bubbles.map((x) => (x.id === b.id ? { ...x, blocked: false } : x)) });
  stopAudio = io.play(b.url!, vol, (r) => {
    if (mine !== epoch) return;
    stopAudio = null;
    const end = io.now();
    emit({
      playing: null,
      bubbles: state.bubbles.map((x) => (x.id === b.id ? { ...x, blocked: !!r.blocked, until: r.blocked ? Math.max(x.until, end + VOICE_TTL) : end + (x.mine ? MINE_AFTER : AFTER_PLAY) } : x)),
    });
    if (!r.blocked) playNext(); else queue = []; // 被擋了：之後的也會被擋，改成等人按
  });
}

function stopPlaying(next = true) {
  stopAudio?.();
  stopAudio = null;
  const id = state.playing?.id;
  if (!id) return;
  const now = io.now();
  emit({ playing: null, bubbles: state.bubbles.map((x) => (x.id === id ? { ...x, until: now + AFTER_PLAY } : x)) });
  if (next) playNext();
}

// ---- 送 ----
export type SendError = "cooldown" | "guest" | "not_in_room" | "failed" | "busy" | "too_short" | "empty" | null;

async function send(run: () => Promise<{ status: number; body: Record<string, unknown> }>, label: string): Promise<SendError> {
  if (!session) return "not_in_room";
  if (state.sending) return "busy";
  const now = io.now();
  if (state.readyAt > now) return "cooldown";
  const mine = epoch;
  emit({ sending: true, failed: null, now });
  let res: { status: number; body: Record<string, unknown> };
  try {
    res = await run();
  } catch {
    res = { status: 0, body: {} };
  }
  if (mine !== epoch) return null; // 送出途中換帳號、換房間：結果作廢
  const t = io.now();
  const msg = res.body.message as ChatMessage | undefined;
  if (res.status === 200 && msg) {
    lastFailed = null;
    emit({ sending: false, failed: null, readyAt: t + MIN_GAP_MS, now: t });
    receiveChat(msg);
    return null;
  }
  if (res.status === 429) {
    const ms = typeof res.body.retryAfterMs === "number" ? res.body.retryAfterMs : MIN_GAP_MS;
    emit({ sending: false, readyAt: t + ms, now: t });
    return "cooldown";
  }
  if (res.status === 403 && res.body.error === "guest_not_allowed") {
    emit({ sending: false });
    noteText("登入 LINE 後就能聊天與傳語音。", 2500);
    return "guest";
  }
  if (res.status === 400 && res.body.error === "too_short") {
    emit({ sending: false });
    noteText("太短了，按住久一點再放開", NOTE_MS);
    return "too_short";
  }
  if (res.status === 403 || res.status === 404) {
    emit({ sending: false });
    return "not_in_room";
  }
  // 壞檔、伺服器錯、網路：顯示「傳送失敗，點此重試」（不扣冷卻，可以馬上重試）
  lastFailed = async () => { await send(run, label); };
  emit({ sending: false, failed: { label } });
  return "failed";
}

export function sendPhrase(id: PhraseId): Promise<SendError> {
  const roomId = session?.roomId;
  return send(() => io.postJSON({ roomId, phrase: id }), "短語");
}

export function sendText(text: string): Promise<SendError> {
  const t = text.trim();
  if (!t) return Promise.resolve("empty");
  const roomId = session?.roomId;
  return send(() => io.postJSON({ roomId, text: [...t].slice(0, TEXT_MAX).join("") }), "文字");
}

export function sendVoice(blob: Blob, ms: number): Promise<SendError> {
  if (ms < VOICE_MIN_MS) { noteText("太短了，按住久一點再放開", NOTE_MS); return Promise.resolve("too_short"); }
  const roomId = session?.roomId ?? "";
  return send(() => io.postVoice(roomId, blob), "語音");
}

/** 開關聊天底板（換場時一律關起來） */
export function setChatOpen(open: boolean) {
  if (state.open !== open) emit({ open, now: io.now() });
}

export function retryFailed() {
  const f = lastFailed;
  lastFailed = null;
  if (f) void f();
}
export function dismissFailed() { lastFailed = null; emit({ failed: null }); }

export function noteText(text: string, ms = NOTE_MS) {
  emit({ note: { text, until: io.now() + ms }, now: io.now() });
}

// ---- 畫面 ----
function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
const getState = () => state;
const SERVER_STATE = fresh();
export function useChatState(): ChatState {
  return useSyncExternalStore(subscribe, getState, () => SERVER_STATE);
}

// ---- 錄音（MediaRecorder；iPhone 錄 audio/mp4、Android 錄 audio/webm，伺服器統一轉 m4a） ----
export type MicError = "denied" | "unsupported" | "failed";
const MIME = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];

export function canRecord(): boolean {
  return typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}

/** 開始錄音；回傳 stop()（送出）和 cancel()。最長 10 秒，到了自動停並交給 onDone（blob＝null 代表取消或沒錄到） */
export async function startRecording(onDone: (blob: Blob | null, ms: number) => void): Promise<{ stop: () => void; cancel: () => void } | MicError> {
  if (!canRecord()) return "unsupported";
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    const name = (e as { name?: string })?.name;
    return name === "NotAllowedError" || name === "SecurityError" ? "denied" : "failed";
  }
  const mimeType = MIME.find((m) => MediaRecorder.isTypeSupported?.(m));
  let rec: MediaRecorder;
  try {
    rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    return "failed";
  }
  const chunks: Blob[] = [];
  const t0 = Date.now();
  let cancelled = false;
  rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  rec.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    clearTimeout(timer);
    onDone(cancelled || chunks.length === 0 ? null : new Blob(chunks, { type: rec.mimeType || mimeType || "audio/webm" }), Date.now() - t0);
  };
  rec.start();
  const timer = setTimeout(() => { if (rec.state === "recording") rec.stop(); }, VOICE_MAX_MS);
  return {
    stop: () => { if (rec.state === "recording") rec.stop(); },
    cancel: () => { cancelled = true; if (rec.state === "recording") rec.stop(); },
  };
}

/** 測試用：直接讀目前的狀態 */
export const __peekChat = () => state;

/** 測試用：換掉 IO、回到初始狀態 */
export function __testChat(fake: ChatIO) {
  io = fake;
  session = null;
  clearAll();
}
