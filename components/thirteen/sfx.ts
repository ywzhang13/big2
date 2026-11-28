"use client";
// 十三支音效（小宜 v8-B §6 S1～S13；檔案與授權見 public/tiles/thirteen/sfx/LICENSE.txt）。
//   每個音效有 a、b 兩個候選，SFX_PICK 改一個字就換；大牌（衝三、鐵支、同花順、五龍）共用一個，在特效測試頁選（BIG_SFX）。
//   音量、靜音是三款共用的設定（≡ →「設定」→ 聲音：互動音效），播放走 Web Audio（thAudio.ts）
import { useEffect, useRef } from "react";
import { CAT, type HandValue, type Row } from "@/lib/thirteen";
import { MS, scoreWindows, type PatternFx, type Step } from "./revealTimeline";
import { getPrefs, normalizePrefs, onPrefsChange, setPrefs } from "@/lib/mahjong/prefs";
import { mjFetch } from "@/lib/mahjong/clientAuth";
import { gameVibrate } from "@/components/gamePrefs/vibrate";
import { loadBuffer, playBuffer } from "./thAudio";

export type SfxKey = "start" | "play" | "score" | "chongsan" | "tiezhi" | "tonghuashun" | "wulong" | "gunshot" | "hit" | "charge" | "bat" | "homerun" | "fireworks"
  | "hrafter" | IhrSfxKey;
/** 場內全壘打的三個聲音（老闆 2026-11-28「要配聲音」）：0.55 換景悶雷、1.85 大字落地「咚」、2.3 走音小號（5 秒版；小號一度拔掉，老闆改口「小號 C 好了」加回來） */
export type IhrSfxKey = "ihrthunder" | "ihrthud" | "ihrtrumpet";
export const SFX_LIST: { key: SfxKey; name: string }[] = [
  { key: "start", name: "開始比牌" }, { key: "play", name: "出牌" }, { key: "score", name: "分數出現" }, { key: "chongsan", name: "衝三" },
  { key: "tiezhi", name: "鐵支" }, { key: "tonghuashun", name: "同花順" }, { key: "wulong", name: "五龍" }, { key: "gunshot", name: "槍聲" },
  { key: "hit", name: "中彈" }, { key: "charge", name: "集氣" }, { key: "bat", name: "揮棒擊球" }, { key: "homerun", name: "全壘打" }, { key: "fireworks", name: "煙火" },
  { key: "hrafter", name: "全壘打擊球後" },
  { key: "ihrthunder", name: "場內全壘打悶雷" }, { key: "ihrthud", name: "場內全壘打落地" }, { key: "ihrtrumpet", name: "場內全壘打小號" },
];
/** 用哪個候選（老闆試聽後要換就改這裡）；數字＝第二輪候選 r2-1／2／3。老闆 2026-11-18：槍聲選 1、中彈選 3 */
export const SFX_PICK: Record<SfxKey, SfxVariant> = {
  start: "a", play: "a", score: "a", chongsan: "a", tiezhi: "a", tonghuashun: "a", wulong: "b", gunshot: 1, hit: 3, charge: "a", bat: "a", homerun: "a", fireworks: "a",
  hrafter: "b", // 全壘打擊球後的候選檔名用（預設播不播看 HR_AFTER_DEFAULT）
  ihrthunder: "a", ihrthud: "b", ihrtrumpet: 1, // 場內全壘打：老闆 2026-11-28 試聽選定悶雷 A、咚 B、小號 C；特效測試頁仍可換（IHR_SFX，記在本機）
};
/** 老闆 2026-11-18 試聽定案：開始比牌 A、出牌 A、分數 A、五龍 B、揮棒 A、槍聲 r2-1、中彈 r2-3；衝三、鐵支、同花順都不滿意、先靜音等重找（測試頁可試聽第二輪）；
 *  集氣不留；全壘打只要打出去那一聲（揮棒擊球），之後的歡呼、煙火不要。選了大牌音效（BIG_SFX）後，衝三、鐵支、同花順、五龍都改播那一個 */
/** 全壘打揮棒擊球的時間點（從全壘打開始算）：老闆 2026-11-28 預備也要集氣、總長拉到 5.0 秒；集氣太久再縮短，揮棒 0.55 → 1.4 → 1.0（thReveal.css 同一個時間點） */
export const HR_SWING_MS = 1000;
/** 球從球棒飛出去的時間點（換景亮光退掉那一刻，thReveal.css .th-hr9-ballpath 25%）：擊球後音效從這裡開始 */
export const HR_LAUNCH_MS = 1250;
export const SFX_MUTED: ReadonlySet<SfxKey> = new Set<SfxKey>(["chongsan", "tiezhi", "tonghuashun", "charge", "homerun", "fireworks"]);
/** 數字＝第二輪候選 r2-1／2／3（目前只有槍聲、中彈用到，已定案） */
export type SfxR2 = 1 | 2 | 3;
export type SfxVariant = "a" | "b" | SfxR2;
/** 檔案版本：同檔名不能換內容（長期快取），重剪就升版本 */
const SFX_VER: Partial<Record<SfxKey, string>> = { ihrtrumpet: "v2" };
export const sfxSrc = (k: SfxKey, v: SfxVariant = SFX_PICK[k]) =>
  `/tiles/thirteen/sfx/th-sfx-${k}-${typeof v === "number" ? `r2-${v}` : v}.${SFX_VER[k] ?? "v1"}.mp3`;

/** 大牌共用音效候選（老闆 2026-11-18 第 10 輪：衝三、鐵支、同花順、五龍共用同一個，在特效測試頁試聽選定）。
 *  下一批候選：檔案放 public/tiles/thirteen/sfx/、登記雜湊、LICENSE.txt 補來源，再往這裡加一行（batch 寫新的批次名，測試頁自動多一組按鈕） */
export const BIG_SFX: { id: string; batch: string; label: string; name: string; src: string }[] = [
  { id: "r3-a", batch: "第三輪", label: "A", name: "賭場中大獎", src: "/tiles/thirteen/sfx/th-sfx-big-r3-a.v1.mp3" },
  { id: "r3-b", batch: "第三輪", label: "B", name: "重低音爆擊加金屬亮音", src: "/tiles/thirteen/sfx/th-sfx-big-r3-b.v1.mp3" },
  { id: "r3-c", batch: "第三輪", label: "C", name: "遊戲大招升級", src: "/tiles/thirteen/sfx/th-sfx-big-r3-c.v1.mp3" },
  { id: "r3-d", batch: "第三輪", label: "D", name: "收銀機叮鈴", src: "/tiles/thirteen/sfx/th-sfx-big-r3-d.v1.mp3" },
  { id: "r3-e", batch: "第三輪", label: "E", name: "拔刀亮音", src: "/tiles/thirteen/sfx/th-sfx-big-r3-e.v1.mp3" },
];
/** 場內全壘打三個聲音的候選（老馬 2026-11-28；來源見 public/tiles/thirteen/sfx/LICENSE-insidehr.v2.txt）：at＝從場內全壘打開始算的毫秒（照分鏡）。
 *  特效測試頁按了就試聽並選用，記在本機 th_sfx_ihr，只在測試頁播（審伯 R2：正式牌局一律 SFX_PICK）；定案＝SFX_PICK（老闆選定：悶雷 A、咚 B、小號 C） */
export const IHR_SFX: { key: IhrSfxKey; name: string; at: number; options: { v: SfxVariant; label: string; name: string }[] }[] = [
  { key: "ihrthunder", name: "悶雷", at: 550, options: [{ v: "a", label: "A", name: "麻將雷霆自摸的雷聲" }, { v: "b", label: "B", name: "遠方滾雷（Freesound CC0）" }] },
  { key: "ihrthud", name: "咚", at: 1850, options: [{ v: "a", label: "A", name: "麻將 thud 降調加重" }, { v: "b", label: "B", name: "低沉悶響（Freesound CC0）" }] },
  { key: "ihrtrumpet", name: "小號", at: 2300, options: [{ v: "a", label: "A", name: "wah wah 悲情長號" }, { v: "b", label: "B", name: "失敗號角 wahwah" }, { v: 1, label: "C", name: "失敗小樂句" }] },
];
/** 全壘打擊球後音效的候選（老馬 2026-11-28；來源見 public/tiles/thirteen/sfx/LICENSE-hrafter.v1.txt）：球飛出去那一刻（HR_LAUNCH_MS）播，約 2.2 秒、4.5 秒前收尾。
 *  特效測試頁選了記在本機 th_sfx_hrafter（"none"＝不播），只在測試頁播；正式牌局一律 HR_AFTER_DEFAULT（不播） */
export type HrAfterPick = SfxVariant | "none";
/** 老闆 2026-11-28 試聽三個都不喜歡 → 正式遊戲預設不播（全壘打只有原本的揮棒擊球聲）；測試頁那一排留著，選了只影響那支手機 */
export const HR_AFTER_DEFAULT: HrAfterPick = "none";
export const HR_AFTER: { v: HrAfterPick; label: string; name: string }[] = [
  { v: "a", label: "A", name: "觀眾歡呼（Freesound CC0）" }, { v: "b", label: "B", name: "球劃破天空的咻聲（Freesound CC0）" },
  { v: 1, label: "C", name: "重低音爆擊加回音（Freesound CC0）" }, { v: "none", label: "無", name: "不播" },
];
const HR_AFTER_KEY = "th_sfx_hrafter";
export function loadHrAfter(): HrAfterPick {
  try { const raw = JSON.parse(localStorage.getItem(HR_AFTER_KEY) ?? "null") as unknown; return HR_AFTER.find((o) => o.v === raw)?.v ?? HR_AFTER_DEFAULT; } catch { return HR_AFTER_DEFAULT; }
}
export function saveHrAfter(v: HrAfterPick): void {
  try { localStorage.setItem(HR_AFTER_KEY, JSON.stringify(v)); } catch { /* 存不了就只是這次 */ }
}
const IHR_KEY = "th_sfx_ihr";
/** 本機記住的場內全壘打候選（只給特效測試頁用；不在候選清單裡的不算） */
export function loadIhrSfx(): Partial<Record<IhrSfxKey, SfxVariant>> {
  try {
    const raw = JSON.parse(localStorage.getItem(IHR_KEY) ?? "{}") as Record<string, unknown>;
    const out: Partial<Record<IhrSfxKey, SfxVariant>> = {};
    for (const x of IHR_SFX) { const o = x.options.find((o) => o.v === raw[x.key]); if (o) out[x.key] = o.v; }
    return out;
  } catch { return {}; }
}
export function saveIhrSfx(key: IhrSfxKey, v: SfxVariant): void {
  try { localStorage.setItem(IHR_KEY, JSON.stringify({ ...loadIhrSfx(), [key]: v })); } catch { /* 存不了就只是這次 */ }
}

/** 大牌：四種特效牌型都用選中的那一個 */
export const BIG_KEYS: ReadonlySet<SfxKey> = new Set<SfxKey>(["chongsan", "tiezhi", "tonghuashun", "wulong"]);
const BIG_KEY = "th_sfx_big";
const bigSrc = (id: string | null) => BIG_SFX.find((x) => x.id === id)?.src ?? null;
/** 本機記住的大牌選擇（不在候選清單裡的當沒選） */
export function loadBigSfx(): string | null {
  try { const id = localStorage.getItem(BIG_KEY); return bigSrc(id) ? id : null; } catch { return null; }
}
export function saveBigSfx(id: string | null): void {
  try { if (id) localStorage.setItem(BIG_KEY, id); else localStorage.removeItem(BIG_KEY); } catch { /* 存不了就只是這次 */ }
}

/** src：直接指定檔案（大牌候選）；沒給就照 k＋variant */
export function playSfx(k: SfxKey, opts: { variant?: SfxVariant; src?: string; force?: boolean; volume?: number } = {}): void {
  playSrc(opts.src ?? sfxSrc(k, opts.variant), opts);
}
/** 播一個檔（Web Audio，見 thAudio.ts）：跟著共用設定的互動音效音量走、靜音就不播；force＝測試頁試聽。
 *  duration＝只播檔案前面幾秒（提醒聲的單聲）：照檔案裡的位置切，起播晚也不會切到第一聲 */
export function playSrc(src: string, opts: { force?: boolean; volume?: number; duration?: number } = {}): void {
  if (typeof window === "undefined") return;
  void playBuffer(src, opts);
}
/** 正式牌局預載：場內全壘打、擊球後都用定案值（審伯 R2：測試頁的候選不預載、也不播；測試頁自己會預載全部候選） */
export function preloadSfx(): void {
  if (typeof window === "undefined") return;
  const big = bigSrc(loadBigSfx());
  for (const src of [...SFX_LIST.map(({ key }) => (key === "hrafter" ? (HR_AFTER_DEFAULT === "none" ? null : sfxSrc(key, HR_AFTER_DEFAULT)) : sfxSrc(key))), ...(big ? [big] : [])]) if (src) void loadBuffer(src);
}

/** 舊的十三支「音效」開關（localStorage th_sfx，"0"＝關）：第一次載入時轉成共用設定的互動音效靜音，然後刪掉（小宜〈共用設定面板 v1〉§8）。
 *  只改「互動音效靜音」這一項（setPrefs({ fxMuted })）；有登入 LINE 時（審伯 2026-11-19 必修）：
 *    自己問一次這個帳號的設定，確認畫面上的設定已經是帳號的那一份（或帳號從沒存過），才轉；
 *    逾時（timeoutMs）、請求失敗、回來的不是這個帳號、或等待中被取消（登出、換帳號、頁面卸載）→ 什麼都不寫，th_sfx 留著下次再轉。
 *  同一時間只跑一個（重複呼叫拿到同一個結果），轉完刪掉 th_sfx，所以只會生效一次 */
export const OLD_SFX_KEY = "th_sfx";
export type OldSfxResult = "muted" | "kept-on" | "none" | "skipped" | "aborted";
type PrefsGet = { get(): Promise<{ account: string; persisted: boolean; prefs: unknown } | null> };
const prefsHttp: PrefsGet = {
  async get() { const r = await mjFetch("/api/mahjong/prefs", { method: "GET" }); return r.ok ? r.json() : null; },
};
let migrating: { account: string | null; signal?: AbortSignal; job: Promise<OldSfxResult> } | null = null;

export function migrateOldSfxSwitch(opts: { account: string | null; signal?: AbortSignal; timeoutMs?: number; io?: PrefsGet }): Promise<OldSfxResult> {
  // 同一個帳號正在轉（而且沒被取消）：共用那一次；被取消的（例如開發模式 effect 跑兩次的第一次）不共用，重新來
  if (migrating && migrating.account === opts.account && !migrating.signal?.aborted) return migrating.job;
  const job = runMigration(opts).finally(() => { if (migrating?.job === job) migrating = null; });
  migrating = { account: opts.account, signal: opts.signal, job };
  return job;
}

async function runMigration({ account, signal, timeoutMs = 4000, io = prefsHttp }: { account: string | null; signal?: AbortSignal; timeoutMs?: number; io?: PrefsGet }): Promise<OldSfxResult> {
  let old: string | null;
  try { old = localStorage.getItem(OLD_SFX_KEY); } catch { return "skipped"; }
  if (old === null) return "none";
  const apply = (): OldSfxResult => {
    if (old === "0") setPrefs({ fxMuted: true });
    try { localStorage.removeItem(OLD_SFX_KEY); } catch { /* 刪不掉：下次再轉一次，結果一樣 */ }
    return old === "0" ? "muted" : "kept-on";
  };
  if (!account) return apply(); // 訪客、沒登入：設定就在這台
  const deadline = Date.now() + timeoutMs;
  // 1) 問這個帳號存了什麼（逾時、失敗、被取消都放棄）
  const res = await race(io.get().catch(() => null), deadline, signal);
  if (signal?.aborted) return "aborted";
  if (!res || res === TIMEOUT || res.account !== account) return "skipped";
  // 2) 帳號有存過：等畫面上的設定變成帳號那一份（prefs 的綁定把伺服器的值套上去）才轉；帳號從沒存過：畫面上的就是這個帳號的
  if (res.persisted) {
    const want = normalizePrefs(res.prefs);
    if (!want) return "skipped";
    const same = () => JSON.stringify(getPrefs()) === JSON.stringify(want);
    if (!same()) {
      const loaded = await race(new Promise<true>((done) => { const off = onPrefsChange(() => { if (same()) { off(); done(true); } }); signal?.addEventListener("abort", off); setTimeout(off, Math.max(0, deadline - Date.now())); }), deadline, signal);
      if (signal?.aborted) return "aborted";
      if (loaded !== true) return "skipped";
    }
  }
  if (signal?.aborted) return "aborted";
  return apply();
}

const TIMEOUT = Symbol("timeout");
/** 等 p，最晚到 deadline；被取消也立刻結束（回 TIMEOUT，由呼叫的人看 signal.aborted） */
function race<T>(p: Promise<T>, deadline: number, signal?: AbortSignal): Promise<T | typeof TIMEOUT> {
  return new Promise((done) => {
    const t = setTimeout(() => done(TIMEOUT), Math.max(0, deadline - Date.now()));
    const stop = () => { clearTimeout(t); done(TIMEOUT); };
    if (signal?.aborted) return stop();
    signal?.addEventListener("abort", stop, { once: true });
    p.then((v) => { clearTimeout(t); signal?.removeEventListener("abort", stop); done(v); });
  });
}

/** 牌型配音（老闆 2026-11-18 用 ElevenLabs 錄的 13 段＋2026-11-19 彩金 3 段，來源見 public/tiles/thirteen/voice/SOURCE.txt）：
 *  檔名照計分程式的 CAT（同花一對、同花兩對照實唸）；頭墩三條唸「衝三」、彩金三條唸「彩金衝三」。
 *  v4：黑桃同花順唸「同花順」（老闆：沿用）；中尾墩的彩金三條沒有錄，唸「三條」 */
const VOICE_ALIAS: Partial<Record<number, number>> = { [CAT.SPADE_STRAIGHT_FLUSH]: CAT.STRAIGHT_FLUSH, [CAT.LUCKY_THREE]: CAT.THREE_KIND };
export const voiceSrc = (row: Row, v: HandValue) => {
  const name = row === "front" && v.cat === CAT.THREE_KIND ? "chongsan" : row === "front" && v.cat === CAT.LUCKY_THREE ? "luckychongsan" : `cat${VOICE_ALIAS[v.cat] ?? v.cat}`;
  return `/tiles/thirteen/voice/th-voice-${name}.v1.mp3`;
};
export type SfxEvent = { t: number; k: SfxKey | "voice"; volume?: number; src?: string };
/** 大字特效對應的大牌音效：彩金三種沿用對應一般牌型的音效（老闆沒有另外給彩金音效；彩金葫蘆用衝三那個） */
const FX_SFX: Record<PatternFx, SfxKey> = { chongsan: "chongsan", tiezhi: "tiezhi", tonghuashun: "tonghuashun", wulong: "wulong", jpchongsan: "chongsan", jphulu: "chongsan", jptiezhi: "tiezhi" };

/** 一段時間軸裡每個音效的時間點（毫秒，從開始比牌算）；bigId＝選了哪個大牌音效：衝三、鐵支、同花順、五龍都播那個檔（src）。
 *  values＝每家每墩的牌型（伺服器的 result.values）：有給就在每一墩牌落定時唸那一家的牌型；大牌和大字同時開始唸 */
export function sfxEvents(steps: Step[], mySeat: number, bigId: string | null = null, values?: Record<Row, HandValue>[], ihrPick: Partial<Record<IhrSfxKey, SfxVariant>> = {}, hrAfter: HrAfterPick = HR_AFTER_DEFAULT): SfxEvent[] {
  const out: SfxEvent[] = [];
  for (const s of steps) {
    if (s.kind === "start") out.push({ t: s.t0, k: "start" });
    // 牌落定；衝三、鐵支、同花順、五龍那一墩由大牌音效取代出牌聲（老闆 2026-11-18：不用兩個都有）
    else if (s.kind === "flip") {
      if (!s.fx) out.push({ t: s.t0 + MS.flip, k: "play" });                       // 沒有大字的大牌（彩金葫蘆）照一般牌：落定出牌聲＋配音
      if (values && !s.fx) for (const seat of s.seats) out.push({ t: s.t0 + MS.flip, k: "voice", src: voiceSrc(s.row, values[seat][s.row]) });
    }
    else if (s.kind === "fx") {                                                     // 大字出現
      out.push({ t: s.t0, k: FX_SFX[s.fx] });
      if (values) out.push({ t: s.t0, k: "voice", src: voiceSrc(s.row, values[s.seat][s.row]) });
    }
    else if (s.kind === "gun") { out.push({ t: s.t0 + 180, k: "gunshot" }); out.push({ t: s.t0 + 260, k: "hit", volume: s.to === mySeat ? 1 : 0.6 }); } // 被打的人自己聽比較大聲
    else if (s.kind === "homerun") { out.push({ t: s.t0, k: "charge" }, { t: s.t0 + HR_SWING_MS, k: "bat" }, { t: s.t0 + HR_SWING_MS + 600, k: "homerun" }, { t: s.t0 + HR_SWING_MS + 800, k: "fireworks" });
      if (hrAfter !== "none") out.push({ t: s.t0 + HR_LAUNCH_MS, k: "hrafter", src: sfxSrc("hrafter", hrAfter) }); } // 5 秒版：1.0 揮棒、1.25 球飛出去（擊球後音效）
    // 場內全壘打：0.55 悶雷（換景閃光）、1.85 咚（大字落地）、2.3 小號（燈熄掉）；四家都一樣大聲
    else if (s.kind === "insidehr") for (const x of IHR_SFX) out.push({ t: s.t0 + x.at, k: x.key, src: sfxSrc(x.key, ihrPick[x.key] ?? SFX_PICK[x.key]) });
  }
  if (steps.some((x) => x.kind === "flip")) for (const w of scoreWindows({ steps, end: Infinity })) out.push({ t: w.from, k: "score" }); // 四家出完、看板出現加分
  const big = bigSrc(bigId);
  return out.map((e) => (big && e.k !== "voice" && BIG_KEYS.has(e.k) ? { ...e, src: big } : e))
    .filter((e) => e.k === "voice" || !SFX_MUTED.has(e.k) || "src" in e).sort((a, b) => a.t - b.t);
}

/** 特效測試頁的試聽選擇（只有 ThFxLab 傳）：場內全壘打三個聲音的候選、全壘打擊球後音效 */
export type LabSfx = { ihr: Partial<Record<IhrSfxKey, SfxVariant>>; hrAfter: HrAfterPick };
/** 實際要播的音效清單：場內全壘打、擊球後只看 lab 參數（測試頁才傳），不讀本機存的試聽選擇（審伯 R2，tests/_thirteen-inside-hr I10 鎖住）。
 *  大牌音效（BIG_SFX）照 2026-11-18 的設計仍讀本機選擇（老闆在測試頁選了要用在正式牌局），不在這次範圍 */
export function revealSfxEvents(steps: Step[], mySeat: number, values?: Record<Row, HandValue>[], lab?: LabSfx): SfxEvent[] {
  return sfxEvents(steps, mySeat, loadBigSfx(), values, lab?.ihr ?? {}, lab?.hrAfter ?? HR_AFTER_DEFAULT);
}
/** 跟著時間軸播：每次 t 往前走，播 (上次 t, 這次 t] 之間的音效；重新整理接到中間時，過去超過 0.4 秒的不補播。
 *  lab：只有特效測試頁傳；正式牌局不傳＝定案（場內全壘打悶雷 A、咚 B、小號 C，擊球後無）——審伯 2026-11-28 R2：試聽存在本機的候選不能流進正式牌局 */
export function useRevealSfx(steps: Step[], t: number, mySeat: number, values?: Record<Row, HandValue>[], lab?: LabSfx): void {
  const last = useRef<number | null>(null);
  useEffect(() => { preloadSfx(); }, []);
  useEffect(() => {
    if (!values) return;
    for (const src of new Set(values.flatMap((v) => (["front", "middle", "back"] as Row[]).map((row) => voiceSrc(row, v[row]))))) void loadBuffer(src);
  }, [values]);
  useEffect(() => {
    const prev = last.current ?? t - 1;
    last.current = t;
    if (t <= prev) return;
    for (const e of revealSfxEvents(steps, mySeat, values, lab)) if (e.t > prev && e.t <= t && t - e.t <= 400) {
      if (e.k === "voice") playSrc(e.src!, { volume: e.volume });
      else playSfx(e.k, { volume: e.volume, src: e.src });
    }
  }, [steps, t, mySeat, values, lab]);
}

/** 理牌最後 10 秒提醒（老闆 2026-11-18）：照麻將「太久沒出牌」——提醒聲共用麻將的 turn-remind.mp3、震動同麻將 navigator.vibrate(200)。
 *  麻將的做法（lib/mahjong/tableSound.ts、fx/engine.ts playTableSound）：那個檔案本身就是「滴滴」——0.25 秒、兩個短音（0～60ms、160～220ms，間隔 100ms），一次播放就是快速兩聲。
 *  老闆 2026-11-18：剩 10 秒像麻將那樣快速兩聲（整個檔案播一次），剩 3、2、1 秒各一聲（Web Audio 只播檔案的前 90ms，停在兩音之間的靜音，不會有破音）；
 *  9～4 秒安靜；送出後就停；聲音跟著共用設定的互動音效，震動跟著共用設定的「震動」開關；不支援震動的裝置（iPhone 瀏覽器）只有聲音 */
export const REMIND_SRC = "/mahjong-fx/s/turn-remind.mp3", REMIND_AT: readonly number[] = [10, 3, 2, 1], REMIND_DOUBLE_AT = 10, REMIND_SINGLE_SEC = 0.09, REMIND_VIBRATE_MS = 200;
export const remindAt = (left: number, submitted: boolean) => !submitted && REMIND_AT.includes(left);
/** 剩 10 秒＝滴滴（整個檔案）；剩 3、2、1 秒＝滴（只播第一個短音） */
export const remindIsDouble = (left: number) => left === REMIND_DOUBLE_AT;
export function arrangeRemind(double = true): void {
  playSrc(REMIND_SRC, double ? {} : { duration: REMIND_SINGLE_SEC });
  gameVibrate(REMIND_VIBRATE_MS); // 共用設定的「震動」關掉就不震；不支援的裝置只有聲音
}
/** 理牌畫面：倒數秒數變成 10、3、2、1 時提醒一次 */
export function useArrangeRemind(left: number, submitted: boolean): void {
  useEffect(() => { void loadBuffer(REMIND_SRC); }, []);
  useEffect(() => { if (remindAt(left, submitted)) arrangeRemind(remindIsDouble(left)); }, [left, submitted]);
}
