"use client";
// 十三支音效（小宜 v8-B §6 S1～S13；檔案與授權見 public/tiles/thirteen/sfx/LICENSE.txt）。
//   每個音效有 a、b 兩個候選，SFX_PICK 改一個字就換；大牌（衝三、鐵支、同花順、五龍）共用一個，在特效測試頁選（BIG_SFX）；開關記在本機（設定 ⚙ 裡切）
import { useEffect, useRef } from "react";
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
  if (typeof window === "undefined" || (!opts.force && !sfxOn())) return;
  const src = opts.src ?? sfxSrc(k, opts.variant);
  let base = cache.get(src);
  if (!base) { base = new Audio(src); base.preload = "auto"; cache.set(src, base); }
  const a = base.cloneNode(true) as HTMLAudioElement; // 同一個音效可以疊（出牌一局 12 次、三槍）
  a.volume = opts.volume ?? 1;
  void a.play().catch(() => { /* 還沒點過畫面（瀏覽器擋自動播放）就不出聲 */ });
}
export function preloadSfx(): void {
  if (typeof window === "undefined") return;
  const big = bigSrc(loadBigSfx());
  for (const src of [...SFX_LIST.map(({ key }) => sfxSrc(key)), ...(big ? [big] : [])]) if (!cache.has(src)) { const a = new Audio(src); a.preload = "auto"; cache.set(src, a); }
}

/** 一段時間軸裡每個音效的時間點（毫秒，從開始比牌算）；bigId＝選了哪個大牌音效：衝三、鐵支、同花順、五龍都播那個檔（src） */
export function sfxEvents(steps: Step[], mySeat: number, bigId: string | null = null): { t: number; k: SfxKey; volume?: number; src?: string }[] {
  const out: { t: number; k: SfxKey; volume?: number }[] = [];
  for (const s of steps) {
    if (s.kind === "start") out.push({ t: s.t0, k: "start" });
    // 牌落定；衝三、鐵支、同花順、五龍那一墩由大牌音效取代出牌聲（老闆 2026-11-18：不用兩個都有）
    else if (s.kind === "flip") { if (!s.big) out.push({ t: s.t0 + MS.flip, k: "play" }); }
    else if (s.kind === "fx") out.push({ t: s.t0, k: s.fx });                      // 大字出現
    else if (s.kind === "gun") { out.push({ t: s.t0 + 180, k: "gunshot" }); out.push({ t: s.t0 + 260, k: "hit", volume: s.to === mySeat ? 1 : 0.6 }); } // 被打的人自己聽比較大聲
    else if (s.kind === "homerun") { out.push({ t: s.t0, k: "charge" }, { t: s.t0 + 550, k: "bat" }, { t: s.t0 + 1150, k: "homerun" }, { t: s.t0 + 1350, k: "fireworks" }); }
  }
  if (steps.some((x) => x.kind === "flip")) for (const w of scoreWindows({ steps, end: Infinity })) out.push({ t: w.from, k: "score" }); // 四家出完、看板出現加分
  const big = bigSrc(bigId);
  return out.map((e) => (big && BIG_KEYS.has(e.k) ? { ...e, src: big } : e))
    .filter((e) => !SFX_MUTED.has(e.k) || "src" in e).sort((a, b) => a.t - b.t);
}

/** 跟著時間軸播：每次 t 往前走，播 (上次 t, 這次 t] 之間的音效；重新整理接到中間時，過去超過 0.4 秒的不補播 */
export function useRevealSfx(steps: Step[], t: number, mySeat: number): void {
  const last = useRef<number | null>(null);
  useEffect(() => { preloadSfx(); }, []);
  useEffect(() => {
    const prev = last.current ?? t - 1;
    last.current = t;
    if (t <= prev) return;
    for (const e of sfxEvents(steps, mySeat, loadBigSfx())) if (e.t > prev && e.t <= t && t - e.t <= 400) playSfx(e.k, { volume: e.volume, src: e.src });
  }, [steps, t, mySeat]);
}
