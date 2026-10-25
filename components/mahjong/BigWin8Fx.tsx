"use client";
/* eslint-disable @next/next/no-img-element -- 固定檔名素材，預載、解碼好再播；要用 Web Animations 和 screen 疊色，不換成 next/image（和 MeteorFx 一樣） */

// 大牌新版特效（老闆 2026-10-25 定案；預覽站試按台確認過，畫面、時間軸、音效照試按台）：八台 7 種（試按台 v1～v4）＋ 16 台以上 3 種
//（天胡、字一色、大四喜；16 台試按台，含大四喜四象天境背景、神獸 1.4 倍）。哪一手播哪一種見 lib/mahjong/bigWin.ts（BIG_WIN8），順序見 lib/mahjong/winShow.ts。
// 設計：小宜〈麻將八台大牌特效-7種動態分鏡與實作規格-2026-10-25〉；素材：老闆用 AI 生成（public/mahjong-fx/bigwin8/，老馬轉 WebP：
// 透明圖修紅邊、黑底圖壓純黑後整層 screen 去黑、八仙海境 normal 65%）；專屬音效：阿妍的推薦款（大三元乙、小四喜乙，其他甲）。
//   大三元｜三龍盤旋・三色爆心 2.20 秒：三色光球繞心收攏 → 0.32 三龍旋入 → 0.68/0.76/0.84 中發白升起 → 0.82 三色爆心＋重震 → 1.34 牌型名 → 收向勝者
//   小四喜｜四風聚眼・北隅留缺 2.18 秒：四片風紋聚向中心、風眼收緊、東南西三刻升起 → 0.74 北的一對最後補入＋中震 → 1.28 牌型名
//   清一色｜翠浪橫推・一門成列 2.16 秒：翠浪從右後方橫掃到中央 → 五張同一門的牌成列 → 0.78 浪頭爆開＋中震 → 1.30 牌型名
//   五暗刻｜五星點亮・暗刻翻面 2.22 秒：0.30／0.42／0.54／0.66 四顆紫晶依序點亮、各一下微震 → 0.76 第五顆＋魔法陣到位＋五組暗刻翻好＋中震 → 1.34 牌型名
//   八仙過海｜金潮開海・八花過門 2.36 秒：金潮由左鋪滿 → 天門落下 → 八花沿浪進場 → 0.72 天門開光＋重震 → 1.34 牌型名 → 海浪退場（花胡：不接浮層）
//   七搶一｜七花合環・第八花入陣 2.18 秒：七朵花旋入成環、七張花牌依序亮 → 0.72 第八張被吸進缺口＋金框一閃＋中震 → 1.26 牌型名（花胡：不接浮層）
//   MIGI｜碎地升柱・一牌封印 2.12 秒：0.22 地裂＋重震 → 金柱由下往上 → 0.66 胡的那張牌封印＋中震 → 1.18「MIGI」→ 金柱向上收光
// 16 台以上（小宜〈麻將16台以上大牌特效-3種動態分鏡與實作規格-2026-10-25〉；音效阿妍〈16台大牌音效-評估-2026-10-25〉天界開啟／墨韻成環／四象聚珠）：
//   天胡｜天門降世・龍鳳天啟 3.25 秒（全畫面接管，播完直接結算，隕石帳號也一樣）：牌桌熄光 → 0.18 仙宮全景鋪滿 → 0.42 天門降下 → 0.92 落定＋中震
//     → 龍鳳從左下、右上繞場 → 1.82 星門神光爆發（白閃 80ms 內、16px 主震＋5px、2px 餘震、70 顆金粒子）→ 2.18「天胡」＋勝者名字＋7 張代表牌 → 收束
//   字一色｜墨韻成環・七字歸一 2.48 秒：一滴墨落下 → 墨環沿圓周寫出、七張字牌從外圈被吸近 → 流光掃過 → 1.08 七牌落位＋8px 重震 → 1.36 牌型名
//   大四喜｜四象鎮位・靈珠歸心 2.56 秒：四象天境橫幅背景（範圍同八仙過海海境）展開、四色星雲旋入 → 青龍、白虎、朱雀、玄武依序鎮位（各一下輕震）
//     → 1.05 四組刻子成列、靈珠金環、背景四色提亮＋8px 重震 → 1.34 牌型名
// 每一個動作用 Web Animations 排在同一條時間軸上（從大牌段開始算 ms），閃光、衝擊波、粒子、牌桌震動（[data-mt-stage]）都排在重擊點。
// 點畫面任一處、Enter、Space＝跳過（聲音一起停，0.5 秒內補發的 click 吃掉）；減少動態：不動、不閃、不震，直接停在定格那一格，同樣長度後結束。
// 音效：從大牌段的時間零點起播、音量 1、不另外位移；觸控裝置手機加強版、其他一般版；走互動音效的音量和靜音（lib/mahjong/fx/engine.ts）。
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import MjTile from "@/components/mahjong/MjTile";
import { playBigWin8Sound, preloadBigWin8Sound } from "@/lib/mahjong/fx/engine";
import { BIG_WIN16_FONT_RANGE, BIG_WIN8, BIG_WIN8_DIR, bigWin8Files, type BigWin8Theme } from "@/lib/mahjong/bigWin";
import type { Tile, TileSuit } from "@/lib/mahjong/tiles";
import { holdStage, stepPlay, warmImg, type WarmMode } from "./fxWarmUp";
import "./bigWin8.css";

const ART = BIG_WIN8_DIR;
const device = () => (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches ? "mobile" : "pc");
const sfxUrl = (theme: BigWin8Theme) => bigWin8Files(theme, device()).sfx;

/** 先載好、解碼好這一種的圖、牌型名字型、專屬音效（八台約 0.3～0.6MB、16 台約 0.7～1.3MB）。只在這一手真的是這一種時才叫（頁面最多等 1.5 秒），一般牌局不下載 */
const keep: HTMLImageElement[] = []; // 留著參考，瀏覽器不會把解碼好的圖丟掉
const ready = new Map<BigWin8Theme, Promise<boolean>>();
let fontReady: Promise<boolean> | null = null;
let font16Ready: Promise<boolean> | null = null; // 16 台多用到的「天胡字」：同一個字型家族，unicode-range 只管這三個字
export function preloadBigWin8(theme: BigWin8Theme): Promise<boolean> {
  if (!ready.has(theme)) {
    const f = bigWin8Files(theme, device());
    fontReady ??= new FontFace("MjBigWin8", `url(${f.font})`, { weight: "900" }).load().then((ff) => { document.fonts.add(ff); return true; }, () => false);
    ready.set(theme, Promise.all([
      ...f.art.map((src) => { const i = new Image(); i.src = src; keep.push(i); return i.decode().then(() => true, () => false); }),
      fontReady,
      ...(f.font16 ? [font16Ready ??= new FontFace("MjBigWin8", `url(${f.font16})`, { weight: "900", unicodeRange: BIG_WIN16_FONT_RANGE }).load().then((ff) => { document.fonts.add(ff); return true; }, () => false)] : []),
      preloadBigWin8Sound(f.sfx).then((b) => !!b),
    ]).then((ok) => ok.every(Boolean)));
  }
  return ready.get(theme)!;
}

let nid = 7000;
const tile = (suit: TileSuit, rank: number): Tile => ({ id: nid++, suit, rank, display: "" });
const DRAGONS = [tile("z", 5), tile("z", 6), tile("z", 7)];
// 花牌照牌上印的數字排：春夏秋冬 1～4、梅蘭菊竹 1～4（遊戲裡 Flower7＝竹、Flower8＝菊）
const FLOWERS = [1, 2, 3, 4, 5, 6, 8, 7].map((r) => tile("f", r));
// v3 的牌組（都是遊戲內牌元件）：小四喜＝東南西三刻＋北一對；清一色＝同一門（萬）五張代表牌；五暗刻＝五組暗刻（222萬 555萬 777筒 333條 東東東）；
// 七搶一＝八張花（第八張最後被吸進來）
const XIAOSIXI = [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4].map((r) => tile("z", r));
// 16 台：天胡＝7 張代表牌（一手真的天胡 123 456萬 789筒 234條 東東東 白白：每一組各取一張＋東、白對）；字一色＝東南西北中發白七種字牌；
// 大四喜＝東南西北四組刻子
const TIANHU7 = [tile("m", 1), tile("m", 4), tile("p", 7), tile("s", 2), tile("z", 1), tile("z", 7), tile("z", 7)];
const ZI7 = [1, 2, 3, 4, 5, 6, 7].map((r) => tile("z", r));
const DASIXI = [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4].map((r) => tile("z", r));
const QING1SE = [1, 3, 5, 7, 9].map((r) => tile("m", r));
const WUANKE = [...[2, 2, 2, 5, 5, 5].map((r) => tile("m", r)), ...[7, 7, 7].map((r) => tile("p", r)), ...[3, 3, 3].map((r) => tile("s", r)), ...[1, 1, 1].map((r) => tile("z", r))];
/** 牌和牌之間多空一點（分組）：小四喜每一刻、五暗刻每一組 */
const GROUP_GAP: Partial<Record<BigWin8Theme, number[]>> = { xiaosixi: [3, 6, 9], wuanke: [3, 6, 9, 12], dasixi: [3, 6, 9] };
/** 五暗刻五顆紫晶在素材裡的位置（比例；依亮度找出來的），由上順時針依序點亮 */
const WAK_STARS = [[0.502, 0.158], [0.804, 0.352], [0.654, 0.676], [0.361, 0.673], [0.231, 0.395]];
const WAK_AT = [300, 420, 540, 660, 760];

const RM_Q = "(prefers-reduced-motion: reduce)";
function useReducedMotion() {
  return useSyncExternalStore(
    (cb) => { const m = matchMedia(RM_Q); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => matchMedia(RM_Q).matches,
    () => false,
  );
}

// ---------------- 時間軸 ----------------
type Frame = [number, Keyframe]; // [從大牌段開始幾 ms, 樣式]
type Track = { k: string; f: Frame[] };
type Shake = { at: number; px: number; ms: number; after?: boolean };
type Spec = {
  hit: number; title: number; tracks: Track[]; shakes: Shake[];
  /** 重擊點的粒子：顏色、數量（手機會少 1/3）、何時噴 */
  sparks: { at: number; colors: string[]; n: number; dist: [number, number] }[];
  /** 減少動態停在哪一格 */
  freeze: number;
  /** 閃光的時間軸（不給就用共用的：重擊點前 50ms 起、後 30ms 最亮、380ms 退完） */
  flash?: Frame[];
};
const E_OUT = "cubic-bezier(.2,.8,.3,1)", E_LAND = "cubic-bezier(.3,1.35,.5,1)", E_IN = "cubic-bezier(.6,0,.9,.5)";
const op = (o: number, t: string, extra: Keyframe = {}): Keyframe => ({ opacity: o, transform: t, ...extra });

/** slots：每張牌最後落定的位置（離畫面中心多少 px；字一色的牌從墨環外圈飛到這裡） */
function specOf(theme: BigWin8Theme, T: number, orbR = 150, slots: { x: number; y: number }[] = []): Spec {
  const H = BIG_WIN8[theme].hit; // 畫面最重那一下（音效的重擊點對在這裡，lib/mahjong/bigWin.ts）
  const out = T - 420; // 收尾（收向勝者名牌）從這裡開始
  // 主畫面群組（素材、牌型名、牌）收尾時縮小淡出
  // 圖層不能再包一層一起動（包起來會變成獨立的混色群組，screen 層就去不了黑）：底圖、亮光、字三層各自淡出
  const exitF: Frame[] = [[0, op(1, "none")], [out, op(1, "none", { easing: E_IN })], [T, op(0, "scale(.9)")]];
  const exits: Track[] = ["L2", "L3", "L4"].map((k) => ({ k, f: exitF }));
  const title = (at: number): Track => ({ k: "title", f: [[0, op(0, "scale(.72)")], [at - 10, op(0, "scale(.72)", { easing: E_LAND })], [at + 300, op(1, "none")], [T, op(1, "none")]] });
  switch (theme) {
    case "dasanyuan": {
      const hit = H;
      return {
        hit, title: 1340, freeze: 1500,
        tracks: [
          ...exits, title(1340),
          // 三色光球（紅、綠、白）從三個方向繞著中心收攏，重擊點合成一點
          ...[0, 1, 2].map((i): Track => ({ k: `orb${i}`, f: [
            [0, op(0, `rotate(${i * 120}deg) translateX(${orbR}px) scale(.6)`)],
            [180, op(1, `rotate(${i * 120 + 90}deg) translateX(${orbR}px) scale(1)`)],
            [hit - 40, op(1, `rotate(${i * 120 + 300}deg) translateX(0px) scale(1.4)`, { easing: E_OUT })],
            [hit + 200, op(0, `rotate(${i * 120 + 330}deg) translateX(0px) scale(2.6)`)], [T, op(0, "none")],
          ] })),
          // 三龍：逆時針旋入、放大到 108%，爆心時一震，定格降亮度讓字壓得住
          { k: "dragons", f: [
            [0, op(0, "rotate(-28deg) scale(.6)", { filter: "brightness(1.4)", easing: E_OUT })],
            [320, op(1, "rotate(-3deg) scale(1.08)", { filter: "brightness(1.1)" })],
            [hit - 20, op(1, "rotate(0deg) scale(1.0)", { filter: "brightness(1)", easing: E_LAND })],
            [hit + 90, op(1, "rotate(1deg) scale(1.1)", { filter: "brightness(1.5)" })],
            [1340, op(1, "rotate(0deg) scale(1)", { filter: "brightness(.72)" })],
            [T, op(1, "rotate(4deg) scale(1.02)", { filter: "brightness(.72)" })],
          ] },
          // 三色爆心（黑底 screen）：0.62 秒從 20% 炸到 115%，0.82 秒最亮，之後降到 45%
          { k: "burst", f: [
            [0, op(0, "rotate(0deg) scale(.2)")], [620, op(0, "rotate(0deg) scale(.2)", { easing: E_OUT })],
            [hit, op(1, "rotate(20deg) scale(1.15)", { filter: "brightness(1.12)" })],
            [1340, op(.45, "rotate(40deg) scale(1)", { filter: "brightness(1)" })], [T, op(.38, "rotate(55deg) scale(1.02)", { filter: "brightness(1)" })],
          ] },
          // 中、發、白依序由中心下方升起
          ...[0, 1, 2].map((i): Track => ({ k: `t${i}`, f: [
            [0, op(0, "translateY(70px) scale(.5)")], [480 + i * 80, op(0, "translateY(70px) scale(.5)", { easing: E_LAND })],
            [680 + i * 80, op(1, "none")], [T, op(1, "none")],
          ] })),
        ],
        shakes: [{ at: 680, px: 2, ms: 100 }, { at: 760, px: 2, ms: 100 }, { at: hit, px: 6, ms: 220, after: true }],
        sparks: [{ at: hit, colors: ["#ff5a3c", "#36d68a", "#fff3d0", "#ffd36a"], n: 30, dist: [0.32, 0.62] }],
      };
    }
    case "baxian": {
      const hit = H;
      return {
        hit, title: 1340, freeze: 1500,
        tracks: [
          ...exits, title(1340),
          // 金潮：由左往右鋪滿（遮罩揭開），一路緩推 104%→112%；收尾往右退場
          { k: "sea", f: [
            [0, op(.65, "translateX(-3%) scale(1.04)", { clipPath: "inset(0 100% 0 0)", easing: E_OUT })],
            [300, op(.65, "translateX(-1.5%) scale(1.06)", { clipPath: "inset(0 0% 0 0)" })],
            [hit, op(.78, "translateX(0%) scale(1.08)", { clipPath: "inset(0 0% 0 0)" })],
            [out, op(.65, "translateX(1%) scale(1.11)", { clipPath: "inset(0 0% 0 0)", easing: E_IN })],
            [T, op(0, "translateX(7%) scale(1.12)", { clipPath: "inset(0 0% 0 0)" })],
          ] },
          // 天門：從上緣落下 28px、78%→100%；0.72 秒門內白金光打開
          { k: "gate", f: [
            [0, op(0, "translateY(-28px) scale(.78)")], [120, op(0, "translateY(-28px) scale(.78)", { easing: E_LAND })],
            [hit - 40, op(1, "translateY(0) scale(1)")], [hit + 80, op(1, "translateY(0) scale(1.04)", { filter: "brightness(1.35)" })],
            [1340, op(1, "translateY(0) scale(1)", { filter: "brightness(.9)" })], [T, op(1, "none", { filter: "brightness(.9)" })],
          ] },
          { k: "door", f: [
            [0, op(0, "scale(.1)")], [hit - 60, op(0, "scale(.1)", { easing: E_OUT })], [hit + 60, op(1, "scale(1.25)")],
            [1340, op(.55, "scale(1)")], [T, op(.45, "scale(1)")],
          ] },
          // 八花：左右各四張沿浪線（先低後高的弧）進場，0.72 秒全部落位
          ...FLOWERS.map((_, i): Track => {
            const left = i < 4, d = left ? -1 : 1;
            return { k: `t${i}`, f: [
              [0, op(0, `translate(${d * 70}vw, 40px) rotate(${d * 25}deg)`)], [220 + (left ? 3 - i : i - 4) * 40, op(0, `translate(${d * 70}vw, 40px) rotate(${d * 25}deg)`, { easing: E_OUT })],
              [520 + (left ? 3 - i : i - 4) * 40, op(1, `translate(${d * 12}vw, -14px) rotate(${d * 6}deg)`, { easing: E_LAND })],
              [hit, op(1, "none")], [T, op(1, "none")],
            ] };
          }),
          // 浪頭的金色水霧（從左右兩側往中間推）
          { k: "mist", f: [[0, op(0, "scaleX(.4)")], [200, op(.9, "scaleX(.8)", { easing: E_OUT })], [hit + 100, op(.7, "scaleX(1.1)")], [T, op(0, "scaleX(1.2)")]] },
        ],
        shakes: [{ at: hit, px: 6, ms: 220, after: true }],
        sparks: [{ at: hit, colors: ["#fff3d0", "#ffd36a", "#5fe0c8", "#e8c46a"], n: 28, dist: [0.28, 0.55] }],
      };
    }
    case "xiaosixi": {
      const hit = H, R = orbR;
      // 四片風紋：從上、右、下、左聚到風眼四周（北＝左邊那片最後才到）
      const ends = [[0, -0.8 * R], [1.35 * R, -0.35 * R], [0, 0.8 * R], [-1.35 * R, -0.35 * R]];
      return {
        hit, title: 1280, freeze: 1440,
        tracks: [
          ...exits, title(1280),
          { k: "eye", f: [
            [0, op(0, "rotate(18deg) scale(1.35)")], [260, op(.9, "rotate(12deg) scale(1.2)", { filter: "brightness(1)" })],
            [hit, op(1, "rotate(0deg) scale(.92)", { filter: "brightness(1.35)" })], [hit + 160, op(1, "rotate(-2deg) scale(.97)", { filter: "brightness(1.1)" })],
            [1280, op(.6, "rotate(-6deg) scale(.95)", { filter: "brightness(1)" })], [T, op(.5, "rotate(-10deg) scale(.95)", { filter: "brightness(1)" })],
          ] },
          ...ends.map(([x, y], i): Track => {
            const late = i === 3, a0 = late ? hit - 260 : 120 + i * 50, a1 = late ? hit - 20 : hit - 120;
            return { k: `c${i}`, f: [
              [0, op(0, `translate(${(x * 2.6).toFixed(0)}px, ${(y * 3).toFixed(0)}px) scale(.7)`)], [a0, op(0, `translate(${(x * 2.6).toFixed(0)}px, ${(y * 3).toFixed(0)}px) scale(.7)`, { easing: E_OUT })],
              [a1, op(1, `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px) scale(1)`)], [hit + 120, op(1, `translate(${(x * .9).toFixed(0)}px, ${(y * .9).toFixed(0)}px) scale(1.08)`)],
              [1280, op(.9, `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px) scale(1)`)], [T, op(.85, `translate(${(x * 1.05).toFixed(0)}px, ${(y * 1.05).toFixed(0)}px) rotate(4deg) scale(1)`)],
            ] };
          }),
          // 東、南、西三刻依序升起；北的一對最後從左上方被吸進來（重擊點；不從牌列上面橫過去）
          ...XIAOSIXI.map((_, i): Track => i < 9
            ? { k: `t${i}`, f: [[0, op(0, "translateY(50px) scale(.6)")], [300 + Math.floor(i / 3) * 90, op(0, "translateY(50px) scale(.6)", { easing: E_LAND })], [500 + Math.floor(i / 3) * 90, op(1, "none")], [T, op(1, "none")]] }
            : { k: `t${i}`, f: [[0, op(0, "translate(-22vw, -55vh) rotate(-20deg)")], [hit - 221, op(0, "translate(-22vw, -55vh) rotate(-20deg)")], [hit - 220, op(1, "translate(-22vw, -55vh) rotate(-20deg)", { easing: E_IN })], [hit, op(1, "none")], [T, op(1, "none")]] }),
        ],
        shakes: [{ at: 500, px: 2, ms: 100 }, { at: hit, px: 4, ms: 190, after: true }],
        sparks: [{ at: hit, colors: ["#7fe7ff", "#fff6dc", "#ffd36a", "#7be3a0"], n: 30, dist: [0.28, 0.58] }],
      };
    }
    case "qing1se": {
      const hit = H;
      return {
        hit, title: 1300, freeze: 1460,
        tracks: [
          ...exits, title(1300),
          // 翠浪：從右後方 112% 橫掃到中央，旋轉 8°→0°；浪頭到中央＝重擊點
          { k: "wave", f: [
            [0, op(0, "translateX(62%) rotate(8deg) scale(1.12)", { filter: "brightness(1.1)" })], [280, op(1, "translateX(34%) rotate(6deg) scale(1.1)", { filter: "brightness(1.1)" })],
            [hit, op(1, "translateX(0%) rotate(0deg) scale(1.02)", { filter: "brightness(1.25)" })], [hit + 150, op(1, "translateX(-3%) rotate(-1deg) scale(1.06)", { filter: "brightness(1.15)" })],
            [1300, op(1, "translateX(-1%) rotate(0deg) scale(1)", { filter: "brightness(.75)" })], [T, op(1, "translateX(-3%) rotate(0deg) scale(1)", { filter: "brightness(.75)" })],
          ] },
          // 浪頭爆開（黑底 screen）：120%→96%，亮度 100%→34%
          { k: "splash", f: [
            [0, op(0, "scale(.4)")], [hit - 40, op(0, "scale(.5)", { easing: E_OUT })], [hit + 60, op(1, "scale(1.2)", { filter: "brightness(1.12)" })],
            [1300, op(.34, "scale(.96)", { filter: "brightness(1)" })], [T, op(.3, "scale(.98)", { filter: "brightness(1)" })],
          ] },
          // 五張同一門的牌跟著浪頭由左到右成列，最後一張落在重擊點
          ...QING1SE.map((_, i): Track => {
            const land = hit - (4 - i) * 40;
            return { k: `t${i}`, f: [[0, op(0, "translateX(60px) translateY(20px) scale(.6)")], [land - 180, op(0, "translateX(60px) translateY(20px) scale(.6)", { easing: E_LAND })], [land, op(1, "none")], [T, op(1, "none")]] };
          }),
        ],
        shakes: [{ at: hit, px: 4, ms: 200, after: true }],
        sparks: [{ at: hit, colors: ["#4fe0a0", "#f0fff6", "#ffd36a", "#1fb87a"], n: 32, dist: [0.3, 0.62] }],
      };
    }
    case "wuanke": {
      const hit = H;
      return {
        hit, title: 1340, freeze: 1500,
        tracks: [
          ...exits, title(1340),
          // 紫金魔法陣：0.30 秒起由 45% 放到 100%，逆時針 24°→0°；定格降到 65% 亮度
          { k: "circle", f: [
            [0, op(0, "rotate(-24deg) scale(.45)")], [300, op(0, "rotate(-24deg) scale(.45)", { easing: E_OUT })], [hit - 40, op(1, "rotate(-3deg) scale(1)")],
            [hit + 80, op(1, "rotate(0deg) scale(1.04)", { filter: "brightness(1.3)" })], [1340, op(1, "rotate(0deg) scale(1)", { filter: "brightness(.65)" })], [T, op(1, "rotate(4deg) scale(1)", { filter: "brightness(.65)" })],
          ] },
          // 紫晶漩渦（黑底 screen）：88%～100%，一開始偏暗，五顆依序點亮後全亮
          { k: "orbs", f: [
            [0, op(0, "scale(.88)", { filter: "brightness(.5)" })], [220, op(.85, "scale(.91)", { filter: "brightness(.55)" })], [hit, op(1, "scale(1)", { filter: "brightness(1.1)" })],
            [1340, op(.7, "scale(1)", { filter: "brightness(.8)" })], [T, op(.6, "scale(1)", { filter: "brightness(.8)" })],
          ] },
          ...WAK_AT.map((at, i): Track => ({ k: `s${i}`, f: [
            [0, op(0, "scale(.2)")], [at - 20, op(0, "scale(.2)", { easing: E_OUT })], [at + 60, op(1, "scale(1.35)")], [at + 220, op(.85, "scale(1)")],
            [1340, op(.5, "scale(1)")], [T, op(.4, "scale(1)")],
          ] })),
          // 五組暗刻先蓋著（牌背）浮出 → 第五顆紫晶亮起那一刻同步翻面
          ...WUANKE.flatMap((_, i): Track[] => {
            const g = Math.floor(i / 3);
            return [
              // 翻面在重擊點「完成」：牌面和第五顆紫晶、閃光同一刻亮出來
              { k: `b${i}`, f: [[0, op(0, "translateY(24px) rotateY(0deg)")], [180 + g * 50, op(0, "translateY(24px) rotateY(0deg)", { easing: E_OUT })], [380 + g * 50, op(1, "rotateY(0deg)")],
                [hit - 100, op(1, "rotateY(0deg)", { easing: E_IN })], [hit - 50, op(1, "rotateY(90deg)")], [hit - 49, op(0, "rotateY(90deg)")], [T, op(0, "rotateY(90deg)")]] },
              { k: `t${i}`, f: [[0, op(0, "rotateY(-90deg)")], [hit - 50, op(1, "rotateY(-90deg)", { easing: E_OUT })], [hit, op(1, "rotateY(0deg)")], [T, op(1, "none")]] },
            ];
          }),
        ],
        shakes: [...WAK_AT.slice(0, 4).map((at) => ({ at, px: 1, ms: 90 })), { at: hit, px: 4, ms: 200, after: true }],
        sparks: [
          ...WAK_AT.slice(0, 4).map((at) => ({ at, colors: ["#e0b8ff", "#fff3d0"], n: 6, dist: [0.08, 0.18] as [number, number] })),
          { at: hit, colors: ["#c48bff", "#fff3d0", "#ffd36a", "#9b5cff"], n: 30, dist: [0.3, 0.6] },
        ],
      };
    }
    case "qiqiang1": {
      const hit = H, R = orbR;
      return {
        hit, title: 1260, freeze: 1420,
        tracks: [
          ...exits, title(1260),
          // 花瓣金色漩渦（黑底 screen）：0.28 秒 65%→105%，0.72 秒閉合成環，之後降到 55%
          { k: "swirl", f: [
            [0, op(0, "rotate(0deg) scale(.65)")], [280, op(1, "rotate(30deg) scale(.85)")], [hit, op(1, "rotate(80deg) scale(1.05)", { filter: "brightness(1.25)" })],
            [1260, op(.55, "rotate(110deg) scale(1)", { filter: "brightness(1)" })], [T, op(.5, "rotate(130deg) scale(1)", { filter: "brightness(1)" })],
          ] },
          // 七朵花沿不同的弧線旋入，圍成一圈（每朵最多轉 18°）
          ...[0, 1, 2, 3, 4, 5, 6].map((i): Track => {
            const a = -90 + i * (360 / 7), spin = (i % 2 ? 1 : -1) * 18;
            const at = (deg: number, r: number, extra: string) => `rotate(${deg.toFixed(0)}deg) translateX(${r.toFixed(0)}px) rotate(${(-deg).toFixed(0)}deg) ${extra}`;
            return { k: `f${i}`, f: [
              [0, op(0, at(a + 80, 2.4 * R, `rotate(${spin}deg) scale(.6)`))], [100 + i * 35, op(0, at(a + 80, 2.4 * R, `rotate(${spin}deg) scale(.6)`), { easing: E_OUT })],
              [hit - 60, op(1, at(a, 1.2 * R, "rotate(0deg) scale(1)"))], [hit + 120, op(1, at(a - 4, 1.3 * R, "rotate(0deg) scale(1.08)"))],
              [1260, op(.95, at(a - 8, 1.25 * R, "rotate(0deg) scale(1)"))], [T, op(.9, at(a - 14, 1.3 * R, "rotate(0deg) scale(1)"))],
            ] };
          }),
          // 前七張花牌依序亮起；第八張從右上被吸進最後的缺口（重擊點），金框一閃
          ...FLOWERS.map((_, i): Track => i < 7
            ? { k: `t${i}`, f: [[0, op(0, "translateY(26px) scale(.7)")], [280 + i * 45, op(0, "translateY(26px) scale(.7)", { easing: E_LAND })], [440 + i * 45, op(1, "none")], [T, op(1, "none")]] }
            : { k: `t${i}`, f: [
              [0, op(0, "translate(38vw, -42vh) rotate(30deg) scale(1.3)")], [hit - 240, op(1, "translate(38vw, -42vh) rotate(30deg) scale(1.3)", { easing: E_IN })],
              [hit, op(1, "none", { filter: "drop-shadow(0 0 16px #ffd36a) brightness(1.35)" })], [hit + 320, op(1, "none", { filter: "drop-shadow(0 0 8px rgba(255,214,120,.75))" })],
              [T, op(1, "none", { filter: "drop-shadow(0 0 8px rgba(255,214,120,.75))" })],
            ] }),
        ],
        shakes: [{ at: hit, px: 4, ms: 200, after: true }],
        sparks: [{ at: hit, colors: ["#ff8fb3", "#ffd36a", "#fff3e6", "#7fcf6a"], n: 30, dist: [0.28, 0.58] }],
      };
    }
    case "tianhu": {
      const hit = H;
      const mv = (a: string, b: string, sc: number, r: number) => `translate(${a}, ${b}) rotate(${r}deg) scale(${sc})`;
      return {
        hit, title: 2180, freeze: 2400,
        flash: [[0, { opacity: 0 }], [hit - 40, { opacity: 0 }], [hit, { opacity: 1 }], [hit + 80, { opacity: 0 }], [T, { opacity: 0 }]], // 白閃峰值 80ms 內（規格）
        tracks: [
          ...exits, title(2180),
          // 牌桌熄光時中心一線金光
          { k: "thline", f: [[0, op(0, "scaleY(.2)")], [120, op(1, "scaleY(1)")], [360, op(.6, "scaleY(1.2)")], [520, op(0, "scaleY(1.4)")], [T, op(0, "none")]] },
          // 仙宮全景：0.18 鋪滿、106%→101%、亮度 35%→100%；龍鳳繞場時再推近 4%；定格微幅呼吸；收束往中央推
          { k: "palace", f: [
            [0, op(0, "scale(1.06)", { filter: "brightness(.35)" })], [180, op(1, "scale(1.06)", { filter: "brightness(.35)", easing: E_OUT })],
            [420, op(1, "scale(1.01)", { filter: "brightness(1)" })], [920, op(1, "scale(1.01)", { filter: "brightness(1)" })],
            [1620, op(1, "scale(1.05)", { filter: "brightness(1.05)" })], [hit, op(1, "scale(1.06)", { filter: "brightness(1.35)" })],
            [2180, op(1, "scale(1.035)", { filter: "brightness(.8)" })], [2880, op(1, "scale(1.05)", { filter: "brightness(.8)" })], [T, op(1, "scale(1.12)", { filter: "brightness(1.4)" })],
          ] },
          // 天門：0.42 從上方 -18vh 降下、72%→104%→100%，0.92 落定；收束時關上
          { k: "gate", f: [
            [0, op(0, "translateY(-18vh) scale(.72)")], [420, op(0, "translateY(-18vh) scale(.72)", { easing: E_OUT })], [760, op(1, "translateY(0) scale(1.04)")],
            [920, op(1, "translateY(0) scale(1)", { filter: "brightness(1.15)" })], [1620, op(1, "translateY(0) scale(1.02)", { filter: "brightness(1.05)" })],
            [2180, op(.85, "translateY(0) scale(1)", { filter: "brightness(.85)" })], [2880, op(.85, "translateY(0) scale(1)", { filter: "brightness(.85)", easing: E_IN })], [T, op(0, "translateY(0) scale(.92)")],
          ] },
          { k: "thdoor", f: [[0, op(0, "scale(.2)")], [860, op(0, "scale(.2)", { easing: E_OUT })], [960, op(1, "scale(1)")], [1620, op(.7, "scale(1.1)")], [hit, op(1, "scale(1.7)")], [2180, op(.4, "scale(1.2)")], [T, op(.3, "scale(1.2)")]] },
          // 龍由左下、鳳由右上進場，繞一圈（沿弧線經過畫面另一側）後各據一邊
          { k: "dragon", f: [
            [0, op(0, mv("-70vw", "30vh", .78, -8))], [920, op(0, mv("-70vw", "30vh", .78, -8), { easing: "cubic-bezier(.3,.6,.4,1)" })],
            [1180, op(1, mv("-16vw", "-20vh", .95, -3))], [1420, op(1, mv("10vw", "-10vh", 1.08, 2))], [1620, op(1, mv("-4vw", "2vh", 1, 0))],
            [hit, op(1, mv("-5vw", "2vh", 1.04, 0), { filter: "brightness(1.4)" })], [2180, op(1, mv("-4vw", "2vh", 1, 0), { filter: "brightness(.85)" })], [T, op(1, mv("-4vw", "2vh", 1.01, 0), { filter: "brightness(.85)" })],
          ] },
          { k: "phoenix", f: [
            [0, op(0, mv("70vw", "-30vh", .78, 8))], [920, op(0, mv("70vw", "-30vh", .78, 8), { easing: "cubic-bezier(.3,.6,.4,1)" })],
            [1180, op(1, mv("16vw", "20vh", .95, 3))], [1420, op(1, mv("-10vw", "10vh", 1.08, -2))], [1620, op(1, mv("4vw", "-2vh", 1, 0))],
            [hit, op(1, mv("5vw", "-2vh", 1.04, 0), { filter: "brightness(1.4)" })], [2180, op(1, mv("4vw", "-2vh", 1, 0), { filter: "brightness(.85)" })], [T, op(1, mv("4vw", "-2vh", 1.01, 0), { filter: "brightness(.85)" })],
          ] },
          // 星門神光（黑底 screen，全畫面）：1.62 從 28% 瞬放，1.82 最亮 132%，2.04 降到 38%
          { k: "starburst", f: [
            [0, op(0, "scale(.28)")], [1620, op(0, "scale(.28)", { easing: "cubic-bezier(.2,.9,.3,1)" })], [hit, op(1, "scale(1.32)", { filter: "brightness(1.4)" })],
            [2040, op(.38, "scale(1.12)", { filter: "brightness(1)" })], [2880, op(.3, "scale(1.1)")], [T, op(.55, "scale(1.3)")],
          ] },
          // 2.05 秒後 18 顆金粒子慢慢落下
          ...Array.from({ length: 18 }, (_, i): Track => { const a = 2050 + (i % 6) * 40; return { k: `mo${i}`, f: [[0, op(0, "translateY(-6vh)")], [a, op(0, "translateY(-6vh)")], [a + 120, op(1, "translateY(0vh)")], [Math.min(T, a + 1150), op(0, "translateY(42vh)")], [T, op(0, "none")]] }; }),
          // 7 張代表牌：定格時由下往上浮出
          ...TIANHU7.map((_, i): Track => ({ k: `t${i}`, f: [[0, op(0, "translateY(30px) scale(.7)")], [2180 + i * 40, op(0, "translateY(30px) scale(.7)", { easing: E_LAND })], [2380 + i * 40, op(1, "none")], [T, op(1, "none")]] })),
          { k: "thsub", f: [[0, op(0, "translateY(6px)")], [2300, op(0, "translateY(6px)", { easing: E_OUT })], [2500, op(1, "none")], [T, op(1, "none")]] },
        ],
        shakes: [{ at: 920, px: 6, ms: 200 }, { at: hit, px: 16, ms: 120 }, { at: hit + 140, px: 5, ms: 180 }, { at: hit + 340, px: 2, ms: 140 }],
        sparks: [
          { at: 920, colors: ["#fff3d0", "#ffd36a", "#a8f0d8"], n: 18, dist: [0.15, 0.35] },
          { at: hit, colors: ["#fffbe8", "#ffe9a8", "#ffd36a", "#ffbf3a", "#a8f0d8"], n: 70, dist: [0.35, 1.0] },
        ],
      };
    }
    case "zi1se": {
      const hit = H, R = orbR;
      // 七張字牌：東南西北中發白依序從墨環外圈（不同角度）被吸近，1.08 一起落到中央排好
      const ring = (i: number, k: number) => { const a = (-90 + i * 360 / 7) * Math.PI / 180; return { x: Math.cos(a) * R * 1.7 * k, y: Math.sin(a) * R * 1.0 * k }; };
      return {
        hit, title: 1360, freeze: 1500,
        tracks: [
          ...exits, title(1360),
          { k: "inkdrop", f: [[0, op(0, "scale(.2)")], [60, op(1, "scale(.6)")], [220, op(1, "scale(1)")], [420, op(0, "scale(1.6)")], [T, op(0, "none")]] },
          // 墨環：0.22 起 42%→104%、−26°→0°，沿圓周用遮罩寫出（不是整張淡入）
          { k: "ink", f: [
            [0, op(0, "rotate(-26deg) scale(.42)", { "--b8a": "0deg" })], [220, op(1, "rotate(-26deg) scale(.42)", { "--b8a": "0deg", easing: E_OUT })],
            [720, op(1, "rotate(-4deg) scale(1.04)", { "--b8a": "360deg" })], [hit, op(1, "rotate(0deg) scale(.97)", { "--b8a": "360deg", filter: "brightness(1.2)" })],
            [hit + 150, op(1, "rotate(0deg) scale(1)", { "--b8a": "360deg", filter: "brightness(1)" })], [1360, op(1, "rotate(1deg) scale(1)", { "--b8a": "360deg", filter: "brightness(.8)" })],
            [2060, op(1, "rotate(-1deg) scale(1.01)", { "--b8a": "360deg", filter: "brightness(.8)" })], [T, op(1, "rotate(0deg) scale(1)", { "--b8a": "360deg", filter: "brightness(.8)" })],
          ] },
          // 流光（黑底 screen）：0.72 由左至右掃開（柔邊遮罩往右推），82%→112%→100%，主擊後降到 46%
          { k: "flow", f: [
            [0, op(0, "scale(.82)", { "--b8x": "0%" })], [720, op(0, "scale(.82)", { "--b8x": "0%", easing: E_OUT })],
            [760, op(1, "scale(.9)", { "--b8x": "14%" })], [hit, op(1, "scale(1.12)", { "--b8x": "130%", filter: "brightness(1.25)" })],
            [1300, op(.46, "scale(1)", { "--b8x": "130%" })], [T, op(.46, "scale(1)", { "--b8x": "130%" })],
          ] },
          ...ZI7.map((_, i): Track => {
            const s = slots[i] ?? { x: 0, y: 0 }, far = ring(i, 2.2), near = ring(i, 1);
            const at = 220 + i * 70;
            const tr = (p: { x: number; y: number }, sc: number, rot: number) => `translate(${(p.x - s.x).toFixed(0)}px, ${(p.y - s.y).toFixed(0)}px) rotate(${rot}deg) scale(${sc})`;
            return { k: `t${i}`, f: [
              [0, op(0, tr(far, .6, i % 2 ? 18 : -18))], [at, op(0, tr(far, .6, i % 2 ? 18 : -18), { easing: E_OUT })], [at + 180, op(1, tr(near, .85, i % 2 ? 8 : -8), { easing: E_IN })],
              [hit, op(1, "none")], [T, op(1, "none")],
            ] };
          }),
        ],
        shakes: [{ at: hit, px: 8, ms: 150, after: true }],
        sparks: [{ at: hit, colors: ["#1a1206", "#ffd36a", "#fff0c0", "#2a1a08", "#e8b84a"], n: 36, dist: [0.3, 0.62] }],
      };
    }
    case "dasixi": {
      const hit = H;
      // 四象：青龍（左上）、白虎（左下）、朱雀（右上）、玄武（右下）依序鎮位；同一張圖切四個象限各自進場
      // 四片都以整張圖中心縮放（只縮不平移），切口一直落在中線上、不會露出方塊邊
      const Q: [number, number, number][] = [[-1, -1, 580], [1, -1, 800], [-1, 1, 690], [1, 1, 910]]; // q0 左上 q1 右上 q2 左下 q3 右下
      // 東南西北四組刻子：東＝青龍方（左上）、南＝朱雀方（右上）、西＝白虎方（左下）、北＝玄武方（右下），0.92～1.05 從四方進場
      const GD = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
      return {
        hit, title: 1340, freeze: 1500,
        tracks: [
          ...exits, title(1340),
          // 四象天境橫幅背景（老闆給的圖，範圍和八仙過海的海境一樣）：由中央往兩側展開；1.05 爆開時四色（藍、紅、金、青）一起提亮、加飽和
          { k: "dsxsky", f: [
            [0, op(0, "scale(1.04)", { clipPath: "inset(0 50% 0 50%)", filter: "brightness(.7) saturate(1)" })],
            [160, op(.72, "scale(1.04)", { clipPath: "inset(0 50% 0 50%)", filter: "brightness(.7) saturate(1)", easing: E_OUT })],
            [520, op(.72, "scale(1.05)", { clipPath: "inset(0 0% 0 0%)", filter: "brightness(.75) saturate(1.05)" })],
            [hit - 60, op(.8, "scale(1.06)", { clipPath: "inset(0 0% 0 0%)", filter: "brightness(.85) saturate(1.1)" })],
            [hit, op(1, "scale(1.08)", { clipPath: "inset(0 0% 0 0%)", filter: "brightness(1.6) saturate(1.6)" })],
            [hit + 380, op(.85, "scale(1.08)", { clipPath: "inset(0 0% 0 0%)", filter: "brightness(1) saturate(1.25)" })],
            [T, op(.8, "scale(1.1)", { clipPath: "inset(0 0% 0 0%)", filter: "brightness(.9) saturate(1.2)" })],
          ] },
          // 四色星雲（黑底 screen）：0.18 沿圓周揭開、12°→0°，亮度最高 78%，主擊後 40%
          { k: "nebula", f: [
            [0, op(0, "rotate(12deg) scale(.9)", { "--b8a": "0deg" })], [180, op(.78, "rotate(12deg) scale(.9)", { "--b8a": "0deg", easing: E_OUT })],
            [580, op(.78, "rotate(3deg) scale(1)", { "--b8a": "360deg" })], [hit, op(.9, "rotate(0deg) scale(1.04)", { "--b8a": "360deg", filter: "brightness(1.3)" })],
            [1340, op(.4, "rotate(0deg) scale(1)", { "--b8a": "360deg", filter: "brightness(1)" })], [T, op(.4, "rotate(-2deg) scale(1)", { "--b8a": "360deg", filter: "brightness(1)" })],
          ] },
          ...Q.map(([, , at], i): Track => ({ k: `q${i}`, f: [
            [0, op(0, "scale(1.25)")], [at - 120, op(0, "scale(1.25)", { filter: "brightness(1.6)", easing: E_OUT })],
            [at + 60, op(1, "scale(1)", { filter: "brightness(1)" })], [hit - 40, op(1, "scale(.98)")], [hit, op(1, "scale(.92)", { filter: "brightness(1.25)" })],
            [1340, op(1, "scale(.96)", { filter: "brightness(.75)" })], [T, op(1, "scale(.97)", { filter: "brightness(.75)" })],
          ] })),
          { k: "dsxorb", f: [[0, op(.5, "scale(.3)")], [180, op(1, "scale(.4)")], [920, op(1, "scale(.6)")], [hit, op(1, "scale(1.9)")], [hit + 300, op(.6, "scale(1)")], [T, op(.5, "scale(1)")]] },
          ...DASIXI.map((_, i): Track => {
            const [gx, gy] = GD[Math.floor(i / 3)];
            return { k: `t${i}`, f: [[0, op(0, `translate(${gx * 40}vw, ${gy * 40}vh) scale(.7)`)], [920, op(0, `translate(${gx * 40}vw, ${gy * 40}vh) scale(.7)`, { easing: E_IN })], [hit, op(1, "none")], [T, op(1, "none")]] };
          }),
        ],
        shakes: [...Q.map(([, , at]) => ({ at, px: 2, ms: 100 })), { at: hit, px: 8, ms: 170 }, { at: hit + 190, px: 3, ms: 140 }],
        sparks: [{ at: hit, colors: ["#4aa8ff", "#ff5a3c", "#f4f4ff", "#2fd4b0", "#ffd36a"], n: 40, dist: [0.3, 0.68] }],
      };
    }
    case "migi": {
      const hit = H, seal = 660;
      return {
        hit, title: 1180, freeze: 1340,
        tracks: [
          ...exits, title(1180),
          // 地裂：62% 瞬放到 108%（0.22 秒），之後穩住；碎石 0.66 秒停住
          { k: "ground", f: [
            [0, op(0, "scale(.62)", { filter: "brightness(1.6)", easing: E_OUT })], [hit, op(1, "scale(1.08)", { filter: "brightness(1.5)" })],
            [seal, op(1, "scale(1.0)", { filter: "brightness(1)" })], [1180, op(1, "scale(1)", { filter: "brightness(.7)" })], [T, op(1, "scale(1.01)", { filter: "brightness(.7)" })],
          ] },
          // 金柱（黑底 screen）：由下往上揭開，0.66 秒到全高；收尾往上收光
          { k: "pillar", f: [
            [0, op(1, "none", { clipPath: "inset(100% 0 0 0)" })], [hit - 20, op(1, "none", { clipPath: "inset(100% 0 0 0)", easing: "cubic-bezier(.4,0,.2,1)" })],
            [seal, op(1, "none", { clipPath: "inset(0% 0 0 0)", filter: "brightness(1.4)" })],
            [out, op(1, "none", { clipPath: "inset(0% 0 0 0)", filter: "brightness(1.05)", easing: E_IN })],
            [T, op(.6, "translateY(-6%)", { clipPath: "inset(0 0 100% 0)", filter: "brightness(1.6)" })],
          ] },
          // 胡的那張牌：0.66 秒在柱心封印（72%→112%→100%）
          { k: "t0", f: [[0, op(0, "scale(.72)")], [seal - 80, op(0, "scale(.72)", { easing: E_OUT })], [seal + 60, op(1, "scale(1.12)")], [seal + 260, op(1, "none")], [T, op(1, "none")]] },
          { k: "sealring", f: [[0, op(0, "scale(.4)")], [seal - 20, op(0, "scale(.4)", { easing: E_OUT })], [seal + 40, op(1, "scale(1)")], [seal + 520, op(0, "scale(2.2)")], [T, op(0, "none")]] },
        ],
        shakes: [{ at: hit, px: 6, ms: 220, after: true }, { at: seal, px: 4, ms: 180 }],
        sparks: [
          { at: hit, colors: ["#ffd36a", "#ffb43a", "#fff3d0", "#c8823a"], n: 30, dist: [0.3, 0.6] },
          { at: seal, colors: ["#fff3d0", "#ffd36a"], n: 16, dist: [0.12, 0.3] },
        ],
      };
    }
  }
}

/** 震動時牌桌外露那一圈的補色（牌桌根節點的陰影） */
const BIG8_STAGE_SHADOW = "0 0 0 40px #07140c";
/** 牌桌震動（照小宜規格的輕／中／重三級；最多 6px，遠小於隕石的 22px）：牌桌外露的那一圈用深色補 */
function shakeStage(stage: HTMLElement, s: Shake) {
  const k = s.px, f: Keyframe[] = [{ transform: "none" }];
  [[1, -.4], [-.8, .5], [.6, -.3], [-.35, .2], [.15, -.1]].forEach(([x, y]) => f.push({ transform: `translate(${(x * k).toFixed(1)}px, ${(y * k).toFixed(1)}px)` }));
  f.push({ transform: "none" });
  const a = [stage.animate(f, { duration: s.ms, delay: s.at, easing: "linear" })];
  if (s.after) a.push(stage.animate([{ transform: "none" }, { transform: "translate(2px,-1px)" }, { transform: "translate(-1.5px,.8px)" }, { transform: "none" }], { duration: 120, delay: s.at + s.ms + 40 }));
  return a;
}

/**
 * 大牌專屬段（新版 10 種）。theme：牌型；title、fan：牌型名（MIGI 只寫「MIGI」）和台數；seat：勝者（絕對座位，飛向 data-fx-seat 名牌）；
 * winTile：MIGI 封印的那張牌（沒有就不擺）；name：勝者名字（天胡寫在台數後面）。onDone(skipped) 只呼叫一次。
 * warm：預熱（components/mahjong/fxWarmUp.tsx）：不出聲音、不震動牌桌、不攔點擊，在看不見的狀態把整條時間軸一格一格走一遍，走完 onDone(false)
 * 播完（onDone(false)）後頁面會繼續掛著它到整串結束：只剩暗幕（.b8.done），後面的自摸／胡浮層或隕石從暗幕上淡入，牌桌不會先亮一下
 */
/** 預熱用的花牌替身：和牌同尺寸的圓角方塊（花牌牌面圖不在一般牌桌上預先載入，預熱不能為它多下載） */
function WarmTile() {
  return <span style={{ display: "block", width: "var(--tw)", height: "var(--th)", borderRadius: 6, background: "#f4efe2" }} />;
}

export default function BigWin8Fx({ theme, title, fan, seat, mobile, winTile, name, onDone, warm, realArt }: {
  theme: BigWin8Theme; title: string; fan: number; seat: number; mobile: boolean; winTile?: Tile | null; name?: string; onDone: (skipped: boolean) => void; warm?: WarmMode;
  /** 預熱時也用真圖（天胡：素材已經在背景下載好，真圖第一次上傳 GPU 的成本也要先做掉） */
  realArt?: boolean;
}) {
  const T = BIG_WIN8[theme].ms;
  const rm = useReducedMotion();
  // 預熱（warm）時圖換成同尺寸的內嵌占位圖：開局背景預熱不下載任何素材
  const art = (f: string) => (warm && !realArt ? warmImg(f) : `${ART}/${f}`);
  const ref = useRef<HTMLDivElement>(null);
  const doneRef = useRef(onDone);
  useLayoutEffect(() => { doneRef.current = onDone; });
  const ended = useRef(false);
  const stopRef = useRef(() => {});

  // 跳過（點一下、Enter、Space；跳過後 0.5 秒內補發的 click 吃掉，不會按到結算的按鈕）
  useEffect(() => {
    if (warm) return;
    const skip = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Enter" && e.key !== " ") return;
      if (ended.current) return;
      ended.current = true;
      e.preventDefault();
      const swallow = (c: Event) => { c.stopPropagation(); c.preventDefault(); };
      document.addEventListener("click", swallow, true);
      setTimeout(() => document.removeEventListener("click", swallow, true), 500);
      stopRef.current();
      doneRef.current(true);
    };
    document.addEventListener("pointerdown", skip, true);
    document.addEventListener("keydown", skip, true);
    return () => { document.removeEventListener("pointerdown", skip, true); document.removeEventListener("keydown", skip, true); };
  }, [warm]);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    // 勝者名牌：暗幕在那一塊挖空、收尾的光點飛過去
    const plate = document.querySelector(`[data-fx-seat="${seat}"]`)?.getBoundingClientRect();
    let dx = 0, dy = 0;
    if (plate) {
      const box = root.querySelector(".b8-vig")!.getBoundingClientRect();
      const px = plate.left + plate.width / 2, py = plate.top + plate.height / 2;
      root.style.setProperty("--ax", `${px - box.left}px`);
      root.style.setProperty("--ay", `${py - box.top}px`);
      root.style.setProperty("--arx", `${plate.width * 0.75 + 12}px`);
      root.style.setProperty("--ary", `${plate.height * 0.75 + 12}px`);
      dx = px - (box.left + box.width / 2); dy = py - (box.top + box.height / 2);
      const a = root.querySelector<HTMLElement>("[data-b8-anchor]");
      if (a) Object.assign(a.style, { display: "block", left: `${plate.left - 4}px`, top: `${plate.top - 3}px`, width: `${plate.width + 8}px`, height: `${plate.height + 6}px` });
    }
    // 每張牌最後落定的位置（離畫面中心）：動畫開始前量（字一色的牌從墨環外圈飛到這裡）
    const vb = root.querySelector(".b8-vig")!.getBoundingClientRect();
    const slots = [...root.querySelectorAll<HTMLElement>('.b8-t[data-k^="t"]')].map((el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2 - (vb.left + vb.width / 2), y: r.top + r.height / 2 - (vb.top + vb.height / 2) }; });
    const spec = specOf(theme, T, mobile ? 150 : 320, slots);
    const anims: Animation[] = [];
    const run = (el: Element | null, frames: Frame[]) => {
      if (!el) return;
      anims.push(el.animate(frames.map(([ms, s]) => ({ ...s, offset: Math.min(1, Math.max(0, ms / T)) })), { duration: T, fill: "both" }));
    };
    // 時鐘：整段的零點（聲音對齊用）＋暗幕（大牌段排第一，160ms 變暗）
    run(root.querySelector(".b8-vig"), [[0, { opacity: 0 }], [160, { opacity: 1 }], [T, { opacity: 1 }]]);
    spec.tracks.forEach((tr) => run(root.querySelector(`[data-k="${tr.k}"]`), tr.f));
    const h = spec.hit;
    run(root.querySelector(".b8-flash"), spec.flash ?? [[0, { opacity: 0 }], [h - 50, { opacity: 0 }], [h + 30, { opacity: 1 }], [h + 380, { opacity: 0 }], [T, { opacity: 0 }]]);
    run(root.querySelector(".b8-wave"), [[0, op(0, "scale(.15)")], [h - 10, op(0, "scale(.15)", { easing: E_OUT })], [h + 40, op(1, "scale(.4)")], [h + 600, op(0, "scale(2.6)")], [T, op(0, "none")]]);
    // 粒子：每一顆沿自己的角度往外噴、邊飛邊淡
    const W = innerWidth, H = innerHeight, R = Math.min(W, H * 1.6);
    root.querySelectorAll<HTMLElement>("[data-b8-spark]").forEach((el) => {
      const at = Number(el.dataset.at), ang = Number(el.dataset.a), d = Number(el.dataset.d) * R, du = Number(el.dataset.du);
      run(el, [[0, op(0, `rotate(${ang}deg) translateY(0px) scaleY(.3)`)], [at, op(0, `rotate(${ang}deg) translateY(-8px) scaleY(.3)`, { easing: E_OUT })],
        [at + 40, op(1, `rotate(${ang}deg) translateY(-${(d * .25).toFixed(0)}px) scaleY(1.2)`, { easing: E_OUT })], [Math.min(T, at + du), op(0, `rotate(${ang}deg) translateY(-${d.toFixed(0)}px) scaleY(.5)`)], [T, op(0, "none")]]);
    });
    // 收尾：一顆光點從中央飛進勝者名牌，名牌亮一下
    run(root.querySelector(".b8-orb"), [[0, op(0, "translate(0,0) scale(.6)")], [T - 420, op(0, "translate(0,0) scale(1.4)", { easing: E_IN })], [T - 380, op(1, "translate(0,0) scale(1.4)", { easing: E_IN })], [T - 30, op(1, `translate(${dx.toFixed(0)}px, ${dy.toFixed(0)}px) scale(.35)`)], [T, op(0, `translate(${dx.toFixed(0)}px, ${dy.toFixed(0)}px) scale(.3)`)]]);
    run(root.querySelector("[data-b8-anchor]"), [[0, { opacity: 0 }], [spec.title, { opacity: .55 }], [T - 60, { opacity: 1, transform: "scale(1.1)" }], [T, { opacity: 1, transform: "none" }]]);

    if (warm) {
      // 預熱：整段一格一格走一遍就結束（不出聲、不震真的牌桌）
      let alive = true;
      void stepPlay(root, T, { alive: () => alive, stageShadow: BIG8_STAGE_SHADOW }).then(() => { if (alive) doneRef.current(false); });
      return () => { alive = false; anims.forEach((a) => a.cancel()); };
    }
    let t: ReturnType<typeof setTimeout> | undefined;
    const finish = () => { if (!ended.current) { ended.current = true; root.classList.add("done"); doneRef.current(false); } };
    if (rm) {
      // 減少動態：全部停在定格那一格（不動、不閃、不震），整段淡入，同樣長度後結束；聲音從頭放
      anims.forEach((a) => { a.pause(); a.currentTime = spec.freeze; });
      root.classList.add("rm"); // 外層是 display: contents，淡入由各圖層自己做
      stopRef.current = playBigWin8Sound(sfxUrl(theme), null);
      t = setTimeout(finish, T);
      return () => { clearTimeout(t); anims.forEach((a) => a.cancel()); };
    }
    const stage = document.querySelector<HTMLElement>("[data-mt-stage]");
    // 牌桌外露那一圈的補色＋升成獨立合成層：一掛上就做，重擊震動那一刻不用整張牌桌重畫（components/mahjong/fxWarmUp.tsx 的 holdStage）
    const release = stage ? holdStage(stage, BIG8_STAGE_SHADOW) : null;
    const shakes = stage ? spec.shakes.flatMap((s) => shakeStage(stage, s)) : [];
    // 聲音：對準大牌段開頭（動畫真正開始那一刻），重擊點照音效檔
    const clock = anims[0];
    void clock?.ready.then(() => { if (!ended.current) stopRef.current = playBigWin8Sound(sfxUrl(theme), typeof clock.startTime === "number" ? clock.startTime : null); });
    t = setTimeout(finish, T);
    return () => {
      clearTimeout(t);
      anims.forEach((a) => a.cancel());
      shakes.forEach((a) => a.cancel());
      release?.();
      stopRef.current();
    };
    // 一次播放只排一次時間軸（finish 透過 ref 呼叫最新的 onDone）
  }, [theme, seat, T, rm, mobile, warm]);

  const spec = specOf(theme, T);
  const sparks = spec.sparks.flatMap((g, gi) => Array.from({ length: mobile ? Math.round(g.n * 2 / 3) : g.n }, (_, i) => ({
    key: `${gi}-${i}`, at: g.at, color: g.colors[i % g.colors.length],
    a: Math.round((i / (mobile ? Math.round(g.n * 2 / 3) : g.n)) * 360 + ((i * 37) % 13) - 6),
    d: g.dist[0] + (((i * 53) % 10) / 10) * (g.dist[1] - g.dist[0]), du: 520 + ((i * 29) % 5) * 70,
  })));
  const tiles: Tile[] = { tianhu: TIANHU7, zi1se: ZI7, dasixi: DASIXI, dasanyuan: DRAGONS, baxian: FLOWERS, qiqiang1: FLOWERS, xiaosixi: XIAOSIXI, qing1se: QING1SE, wuanke: WUANKE, migi: winTile ? [winTile] : [] }[theme];
  const gaps = GROUP_GAP[theme] ?? [];

  return (
    <div ref={ref} className={`b8 ${theme} ${mobile ? "m" : "d"}`} data-b8={theme} aria-hidden>
      <div className="b8L b8-vig" />
      {/* 底圖（正常疊）：三龍、海境、天門、碎地 */}
      <div className="b8L" data-k="L2">
        {theme === "dasanyuan" && <img className="b8-art dragons" data-k="dragons" src={art("dsy-dragons.webp")} alt="" draggable={false} />}
        {theme === "baxian" && (
          <>
            <img className="b8-art sea" data-k="sea" src={art("bx-sea.webp")} alt="" draggable={false} />
            <img className="b8-art gate" data-k="gate" src={art("bx-gate.webp")} alt="" draggable={false} />
          </>
        )}
        {theme === "migi" && <img className="b8-art ground" data-k="ground" src={art("migi-ground.webp")} alt="" draggable={false} />}
        {theme === "qing1se" && <img className="b8-art wave" data-k="wave" src={art("qys-wave.webp")} alt="" draggable={false} />}
        {theme === "wuanke" && <img className="b8-art circle" data-k="circle" src={art("wak-circle.webp")} alt="" draggable={false} />}
        {theme === "tianhu" && (
          <>
            <img className="b8-art full" data-k="palace" src={art("th-palace.webp")} alt="" draggable={false} />
            <img className="b8-art thgate" data-k="gate" src={art("th-gate.webp")} alt="" draggable={false} />
            <img className="b8-art thdragon" data-k="dragon" src={art("th-dragon.webp")} alt="" draggable={false} />
            <img className="b8-art thphoenix" data-k="phoenix" src={art("th-phoenix.webp")} alt="" draggable={false} />
          </>
        )}
        {theme === "zi1se" && (
          <>
            <div className="b8-inkdrop" data-k="inkdrop" />
            <img className="b8-art ink" data-k="ink" src={art("zi-ink.webp")} alt="" draggable={false} />
          </>
        )}
        {theme === "dasixi" && <img className="b8-art sea" data-k="dsxsky" src={art("dsx-sky.webp")} alt="" draggable={false} />}
        {theme === "dasixi" && [0, 1, 2, 3].map((i) => <img key={i} className={`b8-art beasts q${i}`} data-k={`q${i}`} src={art("dsx-beasts.webp")} alt="" draggable={false} />)}
      </div>
      {/* 亮光層（整層 screen 疊在牌桌上，黑色＝不變）：三色爆心、金柱、光球、門內光、水霧、衝擊波、粒子、閃光 */}
      <div className="b8L b8-blend" data-k="L3">
        {theme === "dasanyuan" && (
          <>
            {[0, 1, 2].map((i) => <div key={i} className={`b8-orb3 o${i}`}><i data-k={`orb${i}`} /></div>)}
            <img className="b8-art burst" data-k="burst" src={art("dsy-burst.webp")} alt="" draggable={false} />
          </>
        )}
        {theme === "baxian" && (
          <>
            <div className="b8-mist" data-k="mist" />
            <div className="b8-door" data-k="door" />
          </>
        )}
        {theme === "migi" && <img className="b8-art pillar" data-k="pillar" src={art("migi-pillar.webp")} alt="" draggable={false} />}
        {theme === "xiaosixi" && <img className="b8-art eye" data-k="eye" src={art("xsx-eye.webp")} alt="" draggable={false} />}
        {theme === "qing1se" && <img className="b8-art splash" data-k="splash" src={art("qys-splash.webp")} alt="" draggable={false} />}
        {theme === "wuanke" && (
          <div className="b8-orbs" data-k="orbs">
            <img src={art("wak-orbs.webp")} alt="" draggable={false} />
            {WAK_STARS.map(([x, y], i) => <i key={i} className="b8-star" data-k={`s${i}`} style={{ left: `${x * 100}%`, top: `${y * 100}%` }} />)}
          </div>
        )}
        {theme === "qiqiang1" && <img className="b8-art swirl" data-k="swirl" src={art("qq1-swirl.webp")} alt="" draggable={false} />}
        {theme === "tianhu" && (
          <>
            <div className="b8-thline" data-k="thline" />
            <div className="b8-thdoor" data-k="thdoor" />
            <img className="b8-art full" data-k="starburst" src={art("th-starburst.webp")} alt="" draggable={false} />
            {Array.from({ length: 18 }, (_, i) => <i key={i} className="b8-mote" data-k={`mo${i}`} style={{ left: `${4 + ((i * 53) % 92)}%`, top: `${6 + ((i * 29) % 30)}%` }} />)}
          </>
        )}
        {theme === "zi1se" && <img className="b8-art flow" data-k="flow" src={art("zi-flow.webp")} alt="" draggable={false} />}
        {theme === "dasixi" && (
          <>
            <img className="b8-art nebula" data-k="nebula" src={art("dsx-nebula.webp")} alt="" draggable={false} />
            <div className="b8-dsxorb" data-k="dsxorb" />
          </>
        )}
        <div className="b8-wave" />
        <div className="b8-sparks">
          {sparks.map((s) => <i key={s.key} data-b8-spark data-at={s.at} data-a={s.a} data-d={s.d} data-du={s.du} style={{ ["--c" as string]: s.color }} />)}
        </div>
        <div className="b8-flash" />
      </div>
      {/* 字和牌（最上層） */}
      <div className="b8L" data-k="L4">
        {/* 小四喜四片風紋、七搶一七朵花（透明貼紙，切好的格子）：從中心往外排，在牌型名和牌底下 */}
        {theme === "xiaosixi" && <div className="b8-center">{[0, 1, 2, 3].map((i) => <i key={i} className="b8-cloud" data-k={`c${i}`} style={{ backgroundPosition: `${i * 33.333}% 0` }} />)}</div>}
        {theme === "qiqiang1" && <div className="b8-center">{[0, 1, 2, 3, 4, 5, 6].map((i) => <i key={i} className="b8-flower" data-k={`f${i}`} style={{ backgroundPosition: `${(i % 4) * 33.333}% ${Math.floor(i / 4) * 100}%` }} />)}</div>}
        <div className="b8-col">
          <div className="b8-title" data-k="title">
            <div className="b8-name">{title}</div>
            <div className="b8-fan">{fan} 台{theme === "tianhu" && name && <span className="b8-sub" data-k="thsub">・{name}</span>}</div>
          </div>
          <div className="b8-tiles">
            {theme === "migi" && <div className="b8-sealring" data-k="sealring" />}
            {tiles.map((t, i) => theme === "wuanke" ? (
              // 五暗刻：牌背、牌面疊在同一格，重擊點同步翻面
              <div key={t.id} className={`b8-flip ${gaps.includes(i) ? "g" : ""}`}>
                <div className="b8-t bk" data-k={`b${i}`}><MjTile tile={t} faceDown width="var(--tw)" height="var(--th)" /></div>
                <div className="b8-t fc" data-k={`t${i}`}>{warm && t.suit === "f" ? <WarmTile /> : <MjTile tile={t} width="var(--tw)" height="var(--th)" />}</div>
              </div>
            ) : (
              <div key={t.id} className={`b8-t ${gaps.includes(i) ? "g" : ""}`} data-k={`t${i}`}>{warm && t.suit === "f" ? <WarmTile /> : <MjTile tile={t} width="var(--tw)" height="var(--th)" />}</div>
            ))}
          </div>
        </div>
      </div>
      <div className="b8L b8-top">
        <div className="b8-orb" />
        <div className="b8-anchor" data-b8-anchor style={{ display: "none" }} />
        <div className="b8-skip"><i /><i /></div>
      </div>
    </div>
  );
}
