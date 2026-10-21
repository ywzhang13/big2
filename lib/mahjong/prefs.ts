// 麻將偏好設定（小宜〈偏好設定面板-設計規格-2026-10-20〉＋粉紅牌背 3 款＋〈麻將聊天與語音訊息〉的「聲音訊息」）：
// 牌背、桌布、收到語音時自動播放、語音音量。
// 牌面一律白底（老闆 2026-10-22：牌面顏色只留原本的白色），MjTile 不跟偏好設定。
// 只影響自己的畫面。顏色收斂成 CSS 變數掛在 <html>：改色只改變數，不重畫牌桌。
// 存哪裡（誰的設定）由 bindPrefsAccount 決定：
//   ・LINE 帳號：跟著帳號存在伺服器（GET/PUT /api/mahjong/prefs，老柯〈userPrefs〉），這台另外留一份該帳號的快取（重整時先套用）
//   ・訪客、沒登入：只存這台（localStorage "mj.prefs.v3"）
//   格式 { v: 3, back, felt, autoVoice, voiceVol }；讀到舊的 v2（沒有語音兩項）、v1（多一個 face）照樣讀 back、felt，
//   語音兩項補預設（自動播放開、音量一般），face 忽略
// 換帳號、登出時（審伯 2026-10-20 退回的跨帳號殘留）：
//   ・立刻換成新主人的設定，不沿用上一個帳號的顏色
//   ・上一個帳號還沒送出的修改先送出（帶上一個帳號的 id；伺服器 session 已經換人就回 409，不會寫進新帳號）
//   ・上一個帳號晚回來的 GET 一律作廢（版本號＋回應裡的 account 都要對得上）
import { useSyncExternalStore } from "react";
import { mjFetch } from "./clientAuth";

export const BACKS = {
  jade: { name: "翡翠綠", c: ["#4A8A5A", "#2A6038", "#1A4828"] },
  vermilion: { name: "硃砂紅", c: ["#B4553F", "#8E2F22", "#6A1F14"] },
  indigo: { name: "靛青藍", c: ["#4A6A9A", "#2A4470", "#1A2C4C"] },
  ink: { name: "墨玉灰", c: ["#5A5F66", "#353A40", "#22262B"] },
  rose: { name: "紫檀", c: ["#8A6A9A", "#5A3F70", "#3C2A4C"] },
  brass: { name: "金棕", c: ["#C0A063", "#8A6A2E", "#5F4718"] },
  sakura: { name: "櫻花粉", c: ["#F6B8CB", "#E58FAA", "#C96D8C"] },
  rosepink: { name: "玫瑰粉", c: ["#E07298", "#C2456E", "#93294F"] },
  coral: { name: "珊瑚粉", c: ["#F79A8C", "#E8705F", "#C04E40"] },
} as const;
export const FELTS = {
  green: { name: "翠綠", table: ["#1E4A2E", "#153A22", "#0F2A1A"], amb: ["#1A3F25", "#0F2A1A", "#091A10"] },
  night: { name: "靜夜藍", table: ["#1B3A5C", "#142C46", "#0C1C2E"], amb: ["#17334F", "#0D2036", "#071220"] },
  wine: { name: "硃砂暗紅", table: ["#5A2420", "#431A17", "#2A0F0D"], amb: ["#4A1E1A", "#2C100E", "#190809"] },
  black: { name: "墨黑", table: ["#2A2D30", "#1E2022", "#121314"], amb: ["#24272A", "#141617", "#0A0B0C"] },
} as const;
export type BackId = keyof typeof BACKS;
export type FeltId = keyof typeof FELTS;

/** 快速主題：只換牌背和桌布 */
export const THEMES: { id: string; name: string; back: BackId; felt: FeltId }[] = [
  { id: "classic", name: "經典翠綠", back: "jade", felt: "green" },
  { id: "night", name: "靜夜藍", back: "indigo", felt: "night" },
  { id: "cinnabar", name: "硃砂紅", back: "vermilion", felt: "wine" },
  { id: "inkgold", name: "墨黑金", back: "brass", felt: "black" },
  { id: "sakuranight", name: "櫻花夜", back: "sakura", felt: "night" },
];

/** 語音音量三段（規格：低、一般、高，預設一般＝70%） */
export const VOICE_VOLS = {
  low: { name: "低", gain: 0.4 },
  mid: { name: "一般", gain: 0.7 },
  high: { name: "高", gain: 1 },
} as const;
export type VoiceVol = keyof typeof VOICE_VOLS;

/** 和伺服器存的格式一樣（lib/mahjong/userPrefs/rules.ts）：牌背、桌布、自動播放語音、語音音量 */
export interface MjPrefs {
  v: 3;
  back: BackId;
  felt: FeltId;
  autoVoice: boolean;
  voiceVol: VoiceVol;
}

export const DEFAULT_PREFS: MjPrefs = { v: 3, back: "jade", felt: "green", autoVoice: true, voiceVol: "mid" };

/** 讀到的東西不合格就回 null；個別欄位不認得就用預設。舊的 v2、v1 照樣讀 back、felt，語音兩項用預設，face 忽略 */
export function normalizePrefs(raw: unknown): MjPrefs | null {
  const v = raw && typeof raw === "object" ? (raw as { v?: unknown }).v : undefined;
  if (v !== 3 && v !== 2 && v !== 1) return null;
  const r = raw as Record<string, unknown>;
  const d = DEFAULT_PREFS;
  return {
    v: 3,
    back: typeof r.back === "string" && r.back in BACKS ? (r.back as BackId) : d.back,
    felt: typeof r.felt === "string" && r.felt in FELTS ? (r.felt as FeltId) : d.felt,
    autoVoice: typeof r.autoVoice === "boolean" ? r.autoVoice : d.autoVoice,
    voiceVol: typeof r.voiceVol === "string" && r.voiceVol in VOICE_VOLS ? (r.voiceVol as VoiceVol) : d.voiceVol,
  };
}

/** 和伺服器溝通的兩個動作（測試會換成假的） */
export type PrefsIO = {
  get(): Promise<{ account: string; persisted: boolean; prefs: unknown } | null>;
  put(account: string, prefs: MjPrefs): Promise<void>;
};
const httpIO: PrefsIO = {
  async get() {
    const r = await mjFetch("/api/mahjong/prefs", { method: "GET" });
    return r.ok ? ((await r.json()) as { account: string; persisted: boolean; prefs: unknown }) : null;
  },
  async put(account, prefs) {
    await mjFetch("/api/mahjong/prefs", { method: "PUT", body: JSON.stringify({ account, prefs }) });
  },
};

const DEVICE_KEY = "mj.prefs.v3"; // 訪客、沒登入
const accountKey = (id: string) => `mj.prefs.v3:${id}`; // LINE 帳號在這台的快取
const OLD_VERSIONS = ["mj.prefs.v2", "mj.prefs.v1"]; // 改格式前存的（v2 沒有語音兩項、v1 多一個 face）
const PUT_DELAY_MS = 1000; // 停手約 1 秒再存到帳號

let current: MjPrefs = DEFAULT_PREFS;
let owner: { account: string | null } = { account: null }; // null＝這台（訪客、沒登入）
let ownerBound = false;
let epoch = 0; // 每次換主人加一：舊主人晚回來的結果作廢
let editedSinceBind = false; // 綁定後使用者自己改過：伺服器晚回來的舊值不蓋掉
let putTimer: ReturnType<typeof setTimeout> | undefined;
let pendingPut: { account: string; prefs: MjPrefs } | null = null;
let io: PrefsIO = httpIO;
let started = false;
const listeners = new Set<() => void>();

function readKey(key: string): MjPrefs | null {
  try {
    const raw = [key, ...OLD_VERSIONS.map((old) => key.replace("mj.prefs.v3", old))].map((k) => localStorage.getItem(k)).find((x) => x != null);
    return normalizePrefs(JSON.parse(raw ?? "null"));
  } catch {
    return null;
  }
}
function writeKey(key: string, p: MjPrefs) {
  try { localStorage.setItem(key, JSON.stringify(p)); } catch { /* 無痕模式存不了：這次照樣生效 */ }
}
const ownKey = () => (owner.account ? accountKey(owner.account) : DEVICE_KEY);

function apply(p: MjPrefs) {
  const s = document.documentElement.style;
  BACKS[p.back].c.forEach((c, i) => s.setProperty(`--mj-back-${i + 1}`, c));
  FELTS[p.felt].table.forEach((c, i) => s.setProperty(`--mj-felt-${i + 1}`, c));
  FELTS[p.felt].amb.forEach((c, i) => s.setProperty(`--mj-amb-${i + 1}`, c));
}

function show(p: MjPrefs) {
  current = p;
  apply(p);
  listeners.forEach((l) => l());
}

/** 第一次用到時套用這台的設定（還不知道是誰登入前，只用「這台」的，不猜上一個帳號） */
function ensureStarted() {
  if (started || typeof window === "undefined") return;
  started = true;
  show(readKey(DEVICE_KEY) ?? DEFAULT_PREFS);
}

function flushPut() {
  clearTimeout(putTimer);
  putTimer = undefined;
  const job = pendingPut;
  pendingPut = null;
  if (job) void io.put(job.account, job.prefs).catch(() => {});
}

/**
 * 告訴偏好設定「現在是誰」：登入狀態一變就呼叫（null＝沒登入）。訪客＝只用這台。
 * 同一個人重複呼叫不做事。
 */
export function bindPrefsAccount(user: { id: string; isGuest?: boolean } | null) {
  ensureStarted();
  const account = user && !user.isGuest ? user.id : null;
  if (ownerBound && owner.account === account) return;
  flushPut(); // 上一個帳號還沒送出的修改：帶它自己的 id 送出（伺服器 session 已經換人會回 409，不會寫錯帳號）
  epoch++;
  owner = { account };
  ownerBound = true;
  editedSinceBind = false;
  // 立刻換成新主人的設定：帳號用它在這台的快取（沒有就預設），不沿用上一個帳號的
  show(readKey(ownKey()) ?? DEFAULT_PREFS);
  if (!account) return;
  const mine = epoch;
  void io.get().then((res) => {
    if (mine !== epoch || !res || res.account !== account) return; // 換人了，或回來的不是這個帳號的
    if (!res.persisted || editedSinceBind) return;
    const fromServer = normalizePrefs(res.prefs);
    if (!fromServer) return; // 帳號還沒存過：沿用這台的快取
    writeKey(accountKey(account), fromServer);
    show(fromServer);
  }).catch(() => { /* 網路不通：照用這台的快取 */ });
}

export function getPrefs(): MjPrefs {
  ensureStarted();
  return current;
}

export function setPrefs(patch: Partial<Omit<MjPrefs, "v">>) {
  ensureStarted();
  const next: MjPrefs = { ...current, ...patch, v: 3 };
  editedSinceBind = true;
  writeKey(ownKey(), next);
  show(next);
  if (owner.account) {
    pendingPut = { account: owner.account, prefs: next };
    clearTimeout(putTimer);
    putTimer = setTimeout(flushPut, PUT_DELAY_MS);
  }
}

function subscribe(l: () => void) {
  ensureStarted();
  listeners.add(l);
  return () => listeners.delete(l);
}

export function usePrefs(): MjPrefs {
  return useSyncExternalStore(subscribe, getPrefs, () => DEFAULT_PREFS);
}

/** 任何入口（牌桌 ☰、齒輪、大廳）打開同一個偏好設定面板（MjPrefsPanel 掛一次、聽這個事件） */
export function openPrefs() {
  window.dispatchEvent(new Event("mj-open-prefs"));
}

/** 測試用：換掉和伺服器溝通的方式、回到初始狀態 */
export function __testPrefs(fake: PrefsIO) {
  io = fake;
  clearTimeout(putTimer);
  putTimer = undefined;
  pendingPut = null;
  current = DEFAULT_PREFS;
  owner = { account: null };
  ownerBound = false;
  editedSinceBind = false;
  started = false;
  epoch++;
}
