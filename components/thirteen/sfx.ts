"use client";
// 十三支音效（小宜 v8-B §6 S1～S13；檔案與授權見 public/tiles/thirteen/sfx/LICENSE.txt）。
//   每個音效有 a、b 兩個候選，SFX_PICK 改一個字就換；大牌（衝三、鐵支、同花順、五龍）共用一個，在特效測試頁選（BIG_SFX）；開關記在本機（設定 ⚙ 裡切）
import { useEffect, useRef } from "react";
import { CAT, type HandValue, type Row } from "@/lib/thirteen";
import { MS, scoreWindows, type Step } from "./revealTimeline";

export type SfxKey = "start" | "play" | "score" | "chongsan" | "tiezhi" | "tonghuashun" | "wulong" | "gunshot" | "hit" | "charge" | "bat" | "homerun" | "fireworks";
export const SFX_LIST: { key: SfxKey; name: string }[] = [
  { key: "start", name: "開始比牌" }, { key: "play", name: "出牌" }, { key: "score", name: "分數出現" }, { key: "chongsan", name: "衝三" },
  { key: "tiezhi", name: "鐵支" }, { key: "tonghuashun", name: "同花順" }, { key: "wulong", name: "五龍" }, { key: "gunshot", name: "槍聲" },
  { key: "hit", name: "中彈" }, { key: "charge", name: "集氣" }, { key: "bat", name: "揮棒擊球" }, { key: "homerun", name: "全壘打" }, { key: "fireworks", name: "煙火" },
];
/** 用哪個候選（老闆試聽後要換就改這裡）；數字＝第二輪候選 r2-1／2／3。老闆 2026-11-18：槍聲選 1、中彈選 3 */
export const SFX_PICK: Record<SfxKey, SfxVariant> = {
  start: "a", play: "a", score: "a", chongsan: "a", tiezhi: "a", tonghuashun: "a", wulong: "b", gunshot: 1, hit: 3, charge: "a", bat: "a", homerun: "a", fireworks: "a",
};
/** 老闆 2026-11-18 試聽定案：開始比牌 A、出牌 A、分數 A、五龍 B、揮棒 A、槍聲 r2-1、中彈 r2-3；衝三、鐵支、同花順都不滿意、先靜音等重找（測試頁可試聽第二輪）；
 *  集氣不留；全壘打只要打出去那一聲（揮棒擊球），之後的歡呼、煙火不要。選了大牌音效（BIG_SFX）後，衝三、鐵支、同花順、五龍都改播那一個 */
export const SFX_MUTED: ReadonlySet<SfxKey> = new Set<SfxKey>(["chongsan", "tiezhi", "tonghuashun", "charge", "homerun", "fireworks"]);
/** 數字＝第二輪候選 r2-1／2／3（目前只有槍聲、中彈用到，已定案） */
export type SfxR2 = 1 | 2 | 3;
export type SfxVariant = "a" | "b" | SfxR2;
export const sfxSrc = (k: SfxKey, v: SfxVariant = SFX_PICK[k]) =>
  typeof v === "number" ? `/tiles/thirteen/sfx/th-sfx-${k}-r2-${v}.v1.mp3` : `/tiles/thirteen/sfx/th-sfx-${k}-${v}.v1.mp3`;

/** 大牌共用音效候選（老闆 2026-11-18 第 10 輪：衝三、鐵支、同花順、五龍共用同一個，在特效測試頁試聽選定）。
 *  下一批候選：檔案放 public/tiles/thirteen/sfx/、登記雜湊、LICENSE.txt 補來源，再往這裡加一行（batch 寫新的批次名，測試頁自動多一組按鈕） */
export const BIG_SFX: { id: string; batch: string; label: string; name: string; src: string }[] = [
  { id: "r3-a", batch: "第三輪", label: "A", name: "賭場中大獎", src: "/tiles/thirteen/sfx/th-sfx-big-r3-a.v1.mp3" },
  { id: "r3-b", batch: "第三輪", label: "B", name: "重低音爆擊加金屬亮音", src: "/tiles/thirteen/sfx/th-sfx-big-r3-b.v1.mp3" },
  { id: "r3-c", batch: "第三輪", label: "C", name: "遊戲大招升級", src: "/tiles/thirteen/sfx/th-sfx-big-r3-c.v1.mp3" },
  { id: "r3-d", batch: "第三輪", label: "D", name: "收銀機叮鈴", src: "/tiles/thirteen/sfx/th-sfx-big-r3-d.v1.mp3" },
  { id: "r3-e", batch: "第三輪", label: "E", name: "拔刀亮音", src: "/tiles/thirteen/sfx/th-sfx-big-r3-e.v1.mp3" },
];
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

const KEY = "th_sfx";
export const sfxOn = (): boolean => { try { return localStorage.getItem(KEY) !== "0"; } catch { return true; } };
export const setSfxOn = (on: boolean): void => { try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* 存不了就只是這次 */ } };

const cache = new Map<string, HTMLAudioElement>();
/** src：直接指定檔案（大牌候選）；沒給就照 k＋variant */
export function playSfx(k: SfxKey, opts: { variant?: SfxVariant; src?: string; force?: boolean; volume?: number } = {}): void {
  playSrc(opts.src ?? sfxSrc(k, opts.variant), opts);
}
/** 播一個檔案（受 ⚙ 音效開關控制；force＝測試頁試聽） */
export function playSrc(src: string, opts: { force?: boolean; volume?: number; stopAtSec?: number } = {}): void {
  if (typeof window === "undefined" || (!opts.force && !sfxOn())) return;
  let base = cache.get(src);
  if (!base) { base = new Audio(src); base.preload = "auto"; cache.set(src, base); }
  const a = base.cloneNode(true) as HTMLAudioElement; // 同一個音效可以疊（出牌一局 12 次、三槍）
  a.volume = opts.volume ?? 1;
  const played = a.play();
  if (opts.stopAtSec) stopAtPosition(a, played, opts.stopAtSec); // 只播前面一段（提醒聲的單聲）
  else void played.catch(() => { /* 還沒點過畫面（瀏覽器擋自動播放）就不出聲 */ });
}

/** 只播到檔案的第 stopAt 秒（審伯 2026-11-18 必修：照「實際播放進度」停，不從呼叫 play() 起算——起播延遲時才不會切掉第一聲）。
 *  play() 成功（真的開始播）才開始每 10ms 看一次 currentTime，到了就暫停；播放失敗、提前播完、被別人暫停都立刻收掉計時器；
 *  2 秒還沒播到（例如分頁在背景、播放卡住）就直接暫停收掉，不留下還在播的 Audio */
const CLIP_POLL_MS = 10, CLIP_GIVE_UP_MS = 2000;
function stopAtPosition(a: HTMLAudioElement, played: Promise<void>, stopAt: number): void {
  let timer: ReturnType<typeof setInterval> | null = null, over = false;
  const finish = () => {
    if (over) return;
    over = true;
    if (timer !== null) clearInterval(timer);
    timer = null;
    a.removeEventListener("ended", finish); a.removeEventListener("error", finish); a.removeEventListener("pause", finish);
  };
  const stop = () => { finish(); try { if (!a.paused) a.pause(); } catch { /* 已經停了 */ } };
  a.addEventListener("ended", finish); a.addEventListener("error", finish); a.addEventListener("pause", finish);
  played.then(() => {
    if (over) return;
    if (a.paused || a.ended) { finish(); return; }
    const giveUp = Date.now() + CLIP_GIVE_UP_MS;
    timer = setInterval(() => { if (a.currentTime >= stopAt || Date.now() >= giveUp) stop(); }, CLIP_POLL_MS);
  }, () => { stop(); /* 還沒點過畫面（瀏覽器擋自動播放）就不出聲，也不留計時器 */ });
}
export function preloadSfx(): void {
  if (typeof window === "undefined") return;
  const big = bigSrc(loadBigSfx());
  for (const src of [...SFX_LIST.map(({ key }) => sfxSrc(key)), ...(big ? [big] : [])]) if (!cache.has(src)) { const a = new Audio(src); a.preload = "auto"; cache.set(src, a); }
}

/** 牌型配音（老闆 2026-11-18 用 ElevenLabs 錄的 13 段，來源見 public/tiles/thirteen/voice/SOURCE.txt）：
 *  檔名照計分程式的 CAT（同花一對、同花兩對照實唸）；頭墩三條唸「衝三」 */
export const voiceSrc = (row: Row, v: HandValue) =>
  `/tiles/thirteen/voice/th-voice-${row === "front" && v.cat === CAT.THREE_KIND ? "chongsan" : `cat${v.cat}`}.v1.mp3`;
export type SfxEvent = { t: number; k: SfxKey | "voice"; volume?: number; src?: string };

/** 一段時間軸裡每個音效的時間點（毫秒，從開始比牌算）；bigId＝選了哪個大牌音效：衝三、鐵支、同花順、五龍都播那個檔（src）。
 *  values＝每家每墩的牌型（伺服器的 result.values）：有給就在每一墩牌落定時唸那一家的牌型；大牌和大字同時開始唸 */
export function sfxEvents(steps: Step[], mySeat: number, bigId: string | null = null, values?: Record<Row, HandValue>[]): SfxEvent[] {
  const out: SfxEvent[] = [];
  for (const s of steps) {
    if (s.kind === "start") out.push({ t: s.t0, k: "start" });
    // 牌落定；衝三、鐵支、同花順、五龍那一墩由大牌音效取代出牌聲（老闆 2026-11-18：不用兩個都有）
    else if (s.kind === "flip") {
      if (!s.big) out.push({ t: s.t0 + MS.flip, k: "play" });
      if (values && !s.big) for (const seat of s.seats) out.push({ t: s.t0 + MS.flip, k: "voice", src: voiceSrc(s.row, values[seat][s.row]) });
    }
    else if (s.kind === "fx") {                                                     // 大字出現
      out.push({ t: s.t0, k: s.fx });
      if (values) out.push({ t: s.t0, k: "voice", src: voiceSrc(s.row, values[s.seat][s.row]) });
    }
    else if (s.kind === "gun") { out.push({ t: s.t0 + 180, k: "gunshot" }); out.push({ t: s.t0 + 260, k: "hit", volume: s.to === mySeat ? 1 : 0.6 }); } // 被打的人自己聽比較大聲
    else if (s.kind === "homerun") { out.push({ t: s.t0, k: "charge" }, { t: s.t0 + 550, k: "bat" }, { t: s.t0 + 1150, k: "homerun" }, { t: s.t0 + 1350, k: "fireworks" }); }
  }
  if (steps.some((x) => x.kind === "flip")) for (const w of scoreWindows({ steps, end: Infinity })) out.push({ t: w.from, k: "score" }); // 四家出完、看板出現加分
  const big = bigSrc(bigId);
  return out.map((e) => (big && e.k !== "voice" && BIG_KEYS.has(e.k) ? { ...e, src: big } : e))
    .filter((e) => e.k === "voice" || !SFX_MUTED.has(e.k) || "src" in e).sort((a, b) => a.t - b.t);
}

/** 跟著時間軸播：每次 t 往前走，播 (上次 t, 這次 t] 之間的音效；重新整理接到中間時，過去超過 0.4 秒的不補播 */
export function useRevealSfx(steps: Step[], t: number, mySeat: number, values?: Record<Row, HandValue>[]): void {
  const last = useRef<number | null>(null);
  useEffect(() => { preloadSfx(); }, []);
  useEffect(() => {
    if (!values) return;
    for (const src of new Set(values.flatMap((v) => (["front", "middle", "back"] as Row[]).map((row) => voiceSrc(row, v[row]))))) preloadSrc(src);
  }, [values]);
  useEffect(() => {
    const prev = last.current ?? t - 1;
    last.current = t;
    if (t <= prev) return;
    for (const e of sfxEvents(steps, mySeat, loadBigSfx(), values)) if (e.t > prev && e.t <= t && t - e.t <= 400) {
      if (e.k === "voice") playSrc(e.src!, { volume: e.volume });
      else playSfx(e.k, { volume: e.volume, src: e.src });
    }
  }, [steps, t, mySeat, values]);
}

function preloadSrc(src: string): void {
  if (typeof window === "undefined" || cache.has(src)) return;
  const a = new Audio(src); a.preload = "auto"; cache.set(src, a);
}

/** 理牌最後 10 秒提醒（老闆 2026-11-18）：照麻將「太久沒出牌」——提醒聲共用麻將的 turn-remind.mp3、震動同麻將 navigator.vibrate(200)。
 *  麻將的做法（lib/mahjong/tableSound.ts、fx/engine.ts playTableSound）：那個檔案本身就是「滴滴」——0.25 秒、兩個短音（0～60ms、160～220ms，間隔 100ms），一次播放就是快速兩聲。
 *  老闆 2026-11-18：剩 10 秒像麻將那樣快速兩聲（整個檔案播一次），剩 3、2、1 秒各一聲（只播前面第一個短音：照實際播放進度播到 90ms，停在兩音之間的靜音，不會有破音）；
 *  9～4 秒安靜；送出後就停；聲音受 ⚙ 音效開關控制，震動照麻將不受影響；不支援震動的裝置（iPhone 瀏覽器）只有聲音 */
export const REMIND_SRC = "/mahjong-fx/s/turn-remind.mp3", REMIND_AT: readonly number[] = [10, 3, 2, 1], REMIND_DOUBLE_AT = 10, REMIND_SINGLE_AT = 0.09, REMIND_VIBRATE_MS = 200;
export const remindAt = (left: number, submitted: boolean) => !submitted && REMIND_AT.includes(left);
/** 剩 10 秒＝滴滴（整個檔案）；剩 3、2、1 秒＝滴（只播第一個短音） */
export const remindIsDouble = (left: number) => left === REMIND_DOUBLE_AT;
export function arrangeRemind(double = true): void {
  playSrc(REMIND_SRC, double ? {} : { stopAtSec: REMIND_SINGLE_AT });
  try { if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(REMIND_VIBRATE_MS); } catch { /* 不支援就只有聲音 */ }
}
/** 理牌畫面：倒數秒數變成 10、3、2、1 時提醒一次 */
export function useArrangeRemind(left: number, submitted: boolean): void {
  useEffect(() => { preloadSrc(REMIND_SRC); }, []);
  useEffect(() => { if (remindAt(left, submitted)) arrangeRemind(remindIsDouble(left)); }, [left, submitted]);
}
