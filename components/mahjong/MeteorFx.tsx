"use client";

// 帳號專屬胡牌特效「隕石自摸」（老闆 2026-10-25 定案；預覽站試看版 v1～v5 確認過，畫面、時間軸、音效照試看版）。
// 伺服器依帳號給公開代號（winner.winFx="meteor"），自摸時由 app/mahjong/page.tsx 掛上，取代一般的金色自摸浮層；
// 大牌自摸時接在大牌專屬段後面（大牌先播，2026-10-25；順序見 lib/mahjong/winShow.ts），底下墊著大牌段留下的暗幕。
// 時間軸 2.85 秒：0–.15 變暗 → .15–.75 隕石從畫面外斜衝進來（最後 0.1 秒加速、火尾＋殘影）→ .75 撞擊（白閃、爆炸、衝擊波、碎石、
// 整個牌桌震動 0.45 秒、鏡頭往後一震、手機震動）→ 隕石坑 → 1.05 坑中央浮出自摸的那張牌 → 1.25 畫面正中央「自摸」砸出、1.45 名字 →
// 1.35 一下餘震 → 2.85 秒 onDone(false)。點畫面任一處、Enter、Space＝跳過 onDone(true)；只會呼叫一次。
// 減少動態：不飛、不震、不閃、沒有碎石，隕石坑＋牌＋字直接出現，1.6 秒。
// 落點照勝者名牌（data-fx-seat，絕對座位）算；入場方向照「勝者在我的哪一邊」（相對座位）。
// 素材：/mahjong-fx/meteor/*.webp（老闆生成）、音效 s/meteor-*.mp3（阿妍，CC0；授權見 public/mahjong-fx/LICENSE.txt）、
// 「自摸」大字：老闆生成的大字圖 /mahjong-fx/meteor/meteor-title.webp（2026-10-31 取代字型；時間不變），定格後餘燼一直往上飄。
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type CSSProperties } from "react";
import MjTile from "@/components/mahjong/MjTile";
import type { Tile } from "@/lib/mahjong/tiles";
import { playMeteorSound, preloadMeteorSound } from "@/lib/mahjong/fx/engine";
import { holdStage, stepPlay, warmImg, type WarmMode } from "./fxWarmUp";
import { runParts, type Part, type Pose } from "./fxParts";
import "./meteorFx.css";

const ART = "/mahjong-fx/meteor";
/** 隕石圖裡岩石中心的位置（換圖後岩石不在這裡，改這兩個數字） */
const ROCK_AT = { x: 0.28, y: 0.74 };
/** 隕石圖顯示大小＝畫面高度 × 這個數字（整張圖含火尾；燃燒的岩石約佔圖的 45%） */
const METEOR_H = 1.0;
export const METEOR_MS = 2850;
const TOTAL_RM = 1600, IMPACT = 750;
/** 隕石段（飛行＋撞擊）CSS 時間軸的長度：meteorFx.css 的百分比都以 1.8 秒算 */
const SEG = 1800;
/** 主震長度、撞擊後的餘震（從特效開始算，ms） */
const SHAKE_MS = 450;
const AFTERSHOCKS = [1350];
/** 震動時牌桌外露那一圈的補色（牌桌根節點的陰影） */
const METEOR_STAGE_SHADOW = "0 0 0 200px #120d09";
const RM_Q = "(prefers-reduced-motion: reduce)";
function useReducedMotion() {
  return useSyncExternalStore(
    (cb) => { const m = matchMedia(RM_Q); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => matchMedia(RM_Q).matches,
    () => false,
  );
}

/** 先載好、解碼好四張圖、「自摸」大字圖和音效（房間裡有這個帳號時就叫；第一次播也不會閃空白） */
const artImgs: HTMLImageElement[] = []; // 留著參考，瀏覽器不會把解碼好的圖丟掉
let artReady: Promise<boolean> | null = null;
export function preloadMeteorFx(): Promise<boolean> {
  artReady ??= Promise.all([
    ...["meteor.webp", "explosion.webp", "crater.webp", "debris.webp", "meteor-title.webp", ...DETAIL_ART].map((f) => {
      const i = new Image();
      i.src = `${ART}/${f}`;
      artImgs.push(i);
      return i.decode().then(() => true, () => false);
    }),
    preloadMeteorSound().then((b) => !!b),
  ]).then((ok) => ok.every(Boolean));
  return artReady;
}

/** 補細節層的素材（老闆 2026-10-31 補充特效2，照小宜〈隕石冰封雷霆-補細節素材清單 v1〉；只加層，原本的畫面、時間、音效對位不動） */
const DETAIL_ART = ["meteor-impact-rocks-single.webp", "meteor-ground-dust-rings.webp", "meteor-heat-smoke.webp", "meteor-embers-single.webp"];
const cellAt = (k: number, cols: number, rows: number) => `${cols > 1 ? ((k % cols) / (cols - 1)) * 100 : 0}% ${rows > 1 ? (Math.floor(k / cols) / (rows - 1)) * 100 : 0}%`;

/**
 * 隕石補細節層的時間軸（相對落點，ms 從特效開始算）：撞擊 0.75 秒、牌 1.05、「自摸」1.25 都不動。
 *   熔岩碎石：撞擊後各沿拋物線飛出去（近大遠小、自轉速度各不同），1.6 秒前落地淡掉
 *   塵浪：撞擊後 4 段不完整的弧從落點往外擴散（錯開 30ms，貼地壓扁）
 *   熱浪煙：0.9～1.8 秒在落點上方淡淡往上冒
 *   餘燼（黑底，screen）：撞擊後一群群往上飄，「自摸」出來以後越來越少，2.3 秒前散光
 * 高速尾流（八款火焰流星）2026-10-31 老闆覺得加上去怪，已拿掉。
 */
function meteorDetail(root: HTMLElement, g: { u: number }): Part[] {
  const { u } = g;
  const els = (kind: string) => [...root.querySelectorAll<HTMLElement>(`[data-md="${kind}"]`)].map((el) => ({ el, i: Number(el.dataset.i) }));
  const out: Part[] = [];
  const rk = els("rock");
  rk.forEach(({ el, i }) => {
    const a = (i / rk.length) * Math.PI * 2 + 0.35, R = u * (0.45 + 0.1 * (i % 4)), w = u * (0.07 + 0.025 * (i % 3)), spin = (i % 2 ? 1 : -1) * (160 + (i % 5) * 50);
    const ex = Math.cos(a) * R, ey = Math.sin(a) * R * 0.6;
    out.push({ el, w, h: w * 0.96, keys: [[0, { x: 0, y: 0, s: 0.5, o: 0 }], [755, { x: 0, y: 0, s: 0.5, o: 0 }], [775, { x: ex * 0.08, y: ey * 0.08, s: 1, o: 1, r: 0, e: "cubic-bezier(.15,.7,.35,1)" }],
      [980, { x: ex * 0.55, y: ey * 0.55 - u * 0.2, s: 1, o: 1, r: spin * 0.4 }], [1250, { x: ex * 0.85, y: ey * 0.85 - u * 0.05, s: 0.95, o: 0.9, r: spin * 0.8 }],
      [1550 + (i % 3) * 50, { x: ex, y: ey + u * 0.12, s: 0.9, o: 0, r: spin }]] });
  });
  els("dust").forEach(({ el, i }) => {
    const a = ((i * 90 + 45) * Math.PI) / 180, t = 760 + i * 30, w = u * 0.5;
    const at = (f: number, s: number, o: number): Pose => ({ x: Math.cos(a) * u * f, y: Math.sin(a) * u * f * 0.45, s, sy: s * 0.55, o });
    out.push({ el, w, h: w * 0.83, rot: (a * 180) / Math.PI - 90, keys: [[0, at(0.08, 0.4, 0)], [t, at(0.08, 0.4, 0)], [t + 40, { ...at(0.14, 0.7, 0.85), e: "cubic-bezier(.15,.7,.35,1)" }],
      [t + 520, at(0.42, 1.15, 0.4)], [t + 800, at(0.5, 1.25, 0)]] });
  });
  els("smoke").forEach(({ el, i }) => {
    const x = (i - 1) * u * 0.2, w = u * 0.36;
    out.push({ el, w, h: w * 0.93, keys: [[0, { x, y: -u * 0.1, s: 0.8, o: 0 }], [880 + i * 60, { x, y: -u * 0.1, s: 0.8, o: 0 }], [1100 + i * 60, { x, y: -u * 0.2, s: 1, o: 0.3 }],
      [1800, { x: x * 1.2, y: -u * 0.45, s: 1.2, o: 0 }]] });
  });
  const em = els("ember");
  em.forEach(({ el, i }) => {
    const a = (i / em.length) * Math.PI * 2, r0 = u * 0.06, r1 = u * (0.3 + 0.08 * (i % 4)), t = 760 + (i % 4) * 80, end = i % 2 ? 1600 : 2250, w = u * 0.2;
    out.push({ el, w, h: w * 0.75, keys: [[0, { x: Math.cos(a) * r0, y: Math.sin(a) * r0, s: 0.6, o: 0 }], [t, { x: Math.cos(a) * r0, y: Math.sin(a) * r0, s: 0.6, o: 0 }],
      [t + 60, { x: Math.cos(a) * r0 * 2, y: Math.sin(a) * r0 * 2 - u * 0.03, s: 0.9, o: 1 }],
      [end, { x: Math.cos(a) * r1, y: Math.sin(a) * r1 * 0.6 - u * 0.4, s: 1, o: 0 }]] });
  });
  return out;
}

/** 「自摸」定格後的餘燼：從字的下半部往上飄（橫向位置、延遲、大小固定） */
const EMBERS = Array.from({ length: 10 }, (_, i) => ({ x: 8 + ((i * 37) % 85), d: i * 230, s: 0.7 + (i % 3) * 0.3 }));

// 碎石：手機 10、電腦 14 塊；方向、距離、轉速固定。
// 碎石圖的頭朝左下（135 度）、火尾朝右上：轉 (飛行角度 − 135) 度，火尾就在飛行方向的反方向；飛行中再小幅轉動
const DEBRIS = Array.from({ length: 14 }, (_, i) => {
  const a = (i / 14) * Math.PI * 2 + ((i * 7) % 5) * 0.17;
  return { x: Math.cos(a), y: Math.sin(a), r: 0.6 + ((i * 37) % 10) / 25, s: 0.7 + ((i * 53) % 10) / 25, pa: (a * 180) / Math.PI - 135, spin: (i % 2 ? 1 : -1) * (25 + ((i * 71) % 5) * 8), f: i % 8, d: (i % 4) * 15 };
});

/**
 * 整個牌桌震動（主震 0.45 秒由強到弱，手機最大 22px、電腦 30px；之後 1 下 0.15 秒的小餘震）。
 * 撞擊那一下鏡頭往後一震（牌桌縮到 0.96 倍），邊震邊把牌桌縮小一點點（縮多少依當下位移算），名牌、手牌都還在畫面內；
 * 牌桌外露出的那一圈用深色補（stage 的 box-shadow），不會看到底色破圖。陰影和「牌桌升成獨立合成層」在隕石一掛上就做（holdStage），
 * 撞擊那一刻不用整張牌桌重畫；隕石收掉時才還原（陰影在畫面外，提早加、晚點拿掉都看不到）
 */
function shakeStage(stage: HTMLElement, mobile: boolean) {
  const W = innerWidth, H = innerHeight;
  const AX = mobile ? 22 : 30, AY = mobile ? 10 : 16, R = mobile ? 0.25 : 0.35; // 最大位移 px、旋轉度
  const fit = (x: number, y: number, r: number) => {
    const rr = (Math.abs(r) * Math.PI) / 180;
    const mx = Math.abs(x) + (H / 2) * rr + 1, my = Math.abs(y) + (W / 2) * rr + 1;
    return Math.min(1 - (2 * mx) / W, 1 - (2 * my) / H);
  };
  const frames: Keyframe[] = [{ offset: 0, transform: "none" }, { offset: 0.06, transform: "scale(0.96)" }];
  const N = 8;
  for (let i = 0; i < N; i++) {
    const t = 0.13 + (0.8 * i) / (N - 1);
    const e = Math.exp((-2.6 * (t - 0.13)) / 0.8);
    const sg = i % 2 ? -1 : 1;
    const x = sg * AX * e * (i % 3 === 1 ? 0.85 : 1), y = -sg * AY * e * (i % 4 === 2 ? 0.7 : 1), r = sg * R * e;
    frames.push({ offset: t, transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${r.toFixed(3)}deg) scale(${fit(x, y, r).toFixed(4)})` });
  }
  frames.push({ offset: 1, transform: "none" });
  stage.style.transformOrigin = "50% 50%";
  const anims = [stage.animate(frames, { duration: SHAKE_MS, delay: IMPACT, easing: "linear" })];
  const a = mobile ? 6 : 8;
  AFTERSHOCKS.forEach((at, i) => {
    const k = a * (1 - i * 0.25);
    anims.push(stage.animate([
      { offset: 0, transform: "none" },
      { offset: 0.3, transform: `translate(${k}px, ${-k * 0.3}px) scale(${fit(k, k * 0.3, 0).toFixed(4)})` },
      { offset: 0.65, transform: `translate(${-k * 0.6}px, ${k * 0.2}px) scale(${fit(k * 0.6, k * 0.2, 0).toFixed(4)})` },
      { offset: 1, transform: "none" },
    ], { duration: 150, delay: at, easing: "linear" }));
  });
  return anims;
}

/**
 * seat：自摸的人（絕對座位）；mySeat：我的座位（決定隕石從哪邊來）；tile：自摸的那張牌；name：自摸者名字。
 * font、sfxUrl：預覽站試按台切換候選用，正式牌局不用給（厚重黑體、A 呼嘯＋C 撞擊）
 * warm：預熱（components/mahjong/fxWarmUp.tsx）：不出聲音、不震動牌桌、不攔點擊，在看不見的狀態把整條時間軸一格一格走一遍，走完 onDone(false)
 */
export default function MeteorFx({ seat, mySeat, mobile, tile, name, onDone, font, sfxUrl, warm, embedded = false, sound = true }: {
  seat: number; mySeat: number; mobile: boolean; tile: Tile | null | undefined; name: string; onDone: (skipped: boolean) => void;
  font?: string; sfxUrl?: string; warm?: WarmMode; embedded?: boolean; sound?: boolean;
}) {
  const rm = useReducedMotion();
  // 預熱（warm）時圖換成同尺寸的內嵌占位圖：開局背景預熱不下載任何素材
  const art = (f: string) => (warm ? warmImg(f) : `${ART}/${f}`);
  const ref = useRef<HTMLDivElement>(null);
  const doneRef = useRef(onDone);
  useLayoutEffect(() => { doneRef.current = onDone; });
  const ended = useRef(false);
  const stopRef = useRef(() => {});
  const rel = (((seat - mySeat) % 4) + 4) % 4; // 0 自己、1 下家、2 對家、3 上家

  // 畫面出來前量好落點、入場位置；同一刻排好牌桌震動（CSS 動畫和震動同一格開始）
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const box = embedded ? root.getBoundingClientRect() : null;
    const W = box?.width || innerWidth, H = box?.height || innerHeight;
    const crater = Math.round(H * (mobile ? 0.42 : 0.4));
    // 落點：名牌朝桌心那一邊再往內偏（加上半個隕石坑，坑不會整個蓋住名牌）；量不到名牌就用桌面中央偏向該座位
    const off = (mobile ? 20 : 32) + crater * 0.3;
    const scope = embedded ? root.parentElement : document;
    const plate = scope?.querySelector(`[data-fx-seat="${seat}"]`)?.getBoundingClientRect();
    let lx: number, ly: number;
    if (plate && plate.width > 0) {
      const origin = box ?? { left: 0, top: 0 };
      const cx = plate.left + plate.width / 2 - origin.left, cy = plate.top + plate.height / 2 - origin.top;
      const hand = rel === 0 ? scope?.querySelector("[data-mj-myhand]")?.getBoundingClientRect() : undefined;
      [lx, ly] = rel === 2 ? [cx, plate.bottom - origin.top + off] : rel === 3 ? [plate.right - origin.left + off, cy] : rel === 1 ? [plate.left - origin.left - off, cy]
        : hand && hand.width > 0 ? [hand.left - origin.left + hand.width / 2, hand.top - origin.top - off * 0.5] : [cx, plate.top - origin.top - off];
      const a = root.querySelector<HTMLElement>(".mt-plate");
      if (a && !embedded) Object.assign(a.style, { display: "block", left: `${plate.left - 4}px`, top: `${plate.top - 3}px`, width: `${plate.width + 8}px`, height: `${plate.height + 6}px` });
      root.style.setProperty("--ax", `${cx}px`);
      root.style.setProperty("--ay", `${cy}px`);
      root.style.setProperty("--arx", `${plate.width * 0.75 + 12}px`);
      root.style.setProperty("--ary", `${plate.height * 0.75 + 12}px`);
    } else {
      const d = [[0, 0.22], [0.22, 0], [0, -0.22], [-0.22, 0]][rel] ?? [0, 0];
      lx = W / 2 + d[0] * W; ly = H / 2 + d[1] * H;
    }
    // 隕石圖：右上往左下（45 度）；下家從左上來（左右翻轉）；對家、上家的落點靠上或靠左，斜度放平一點（多轉 30／15 度），
    // 才看得到它飛過畫面。起點＝沿反方向剛好出畫面再多 0.3 張圖（岩石整顆在畫面外）
    const size = Math.round(H * METEOR_H);
    const mirror = rel === 1;
    const rot = [0, 0, 30, 15][rel] ?? 0;
    const th = ((mirror ? 45 - rot : 135 + rot) * Math.PI) / 180; // 飛行方向（0＝往右，順時針）
    const ux = -Math.cos(th), uy = -Math.sin(th);
    const exit = Math.min(ux > 0 ? (W - lx) / ux : ux < 0 ? lx / -ux : Infinity, uy < 0 ? ly / -uy : uy > 0 ? (H - ly) / uy : Infinity);
    const far = exit + size * 0.3;
    const set = (k: string, v: number) => root.style.setProperty(k, `${Math.round(v)}px`);
    set("--lx", lx); set("--ly", ly);
    set("--ms", size); set("--mox", -ROCK_AT.x * size); set("--moy", -ROCK_AT.y * size);
    set("--sx", ux * far); set("--sy", uy * far);
    root.style.setProperty("--rot", `${rot}deg`);
    set("--cs", crater);
    set("--es", Math.max(H * 0.75, W * 0.45)); // 爆炸圖放到 1.6 倍時寬度約畫面 70% 以上
    set("--sw", Math.max(W, H) * 1.3);
    set("--ds", H * (mobile ? 0.22 : 0.17));
    // 收尾：自摸牌在坑正中央；「自摸／名字」放在畫面正中央（大字圖高 14vw×1.2、寬照圖的長寬比 596:347；名字 24px），
    // 會擋到坑裡的牌就往上或往下讓開（牌在中線下面就往上，反之往下）
    const tileW = mobile ? 50 : 84, tileH = Math.round(tileW * 1.36);
    set("--tw", tileW); set("--th", tileH);
    const textH = W * 0.14 * 1.2 + 16 + 34, textW = W * 0.14 * 1.2 * (596 / 347), gap = mobile ? 10 : 16, edge = mobile ? 4 : 16;
    let top = H / 2 - textH / 2;
    const tTop = ly - tileH / 2 - gap, tBot = ly + tileH / 2 + gap;
    const hitsTile = top < tBot && top + textH > tTop && Math.abs(lx - W / 2) < textW / 2 + tileW / 2 + gap;
    let place = "center";
    if (hitsTile) {
      if (ly >= H / 2) { top = tTop - textH; place = "up"; } else { top = tBot; place = "down"; }
      top = Math.min(Math.max(top, edge), H - textH - edge);
    }
    set("--zx", W / 2); set("--zy", top); set("--zh", textH);
    root.dataset.mtText = place;
    root.style.setProperty("--mir", mirror ? "-1" : "1");
    root.style.setProperty("--skx", mirror ? "10%" : "90%");
    if (rm) return;
    const stage = warm || embedded ? null : document.querySelector<HTMLElement>("[data-mt-stage]");
    const release = stage ? holdStage(stage, METEOR_STAGE_SHADOW) : null;
    const anims = stage ? shakeStage(stage, mobile) : [];
    // 碎石用 Web Animations 直接給算好的數字（CSS 關鍵影格裡用 calc(var()) 時，Chrome 合成層偶爾有一顆停在原地不動）
    const dr = H * (mobile ? 1.0 : 0.85);
    // 補細節層（只加層，用自己的 Web Animations，原本的 CSS 動畫不動）
    anims.push(...runParts(meteorDetail(root, { u: Math.min(H, W * 0.62) }), METEOR_MS, false));
    root.querySelectorAll<HTMLElement>(".mt-rock").forEach((el, i) => {
      const d = DEBRIS[i];
      const x = d.x * d.r * dr, y = d.y * d.r * dr;
      const at = (k: number, r: number, sc: number) => `translate(${(x * k).toFixed(1)}px, ${(y * k).toFixed(1)}px) rotate(${r.toFixed(1)}deg) scale(${sc.toFixed(3)})`;
      anims.push(el.animate([
        { offset: 0, opacity: 0, transform: at(0, d.pa, 0.4) },
        { offset: IMPACT / SEG, opacity: 0, transform: at(0, d.pa, 0.4) },
        { offset: 0.423, opacity: 1, transform: at(0.08, d.pa, d.s * 1.35), easing: "cubic-bezier(.15, .7, .35, 1)" },
        { offset: 0.77, opacity: 0, transform: at(1, d.pa + d.spin, d.s * 0.35) },
        { offset: 1, opacity: 0, transform: at(1, d.pa + d.spin, 0) },
      ], { duration: SEG, delay: d.d, fill: "both" }));
    });
    return () => { anims.forEach((a) => a.cancel()); release?.(); };
  }, [seat, rel, mobile, rm, warm, embedded]);

  // 跳過：點畫面任一處、Enter、Space。手機點一下之後瀏覽器還會補一個 click，0.5 秒內的 click 吃掉，不會按到結算浮層的按鈕
  useEffect(() => {
    if (warm || embedded) return;
    const skip = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Enter" && e.key !== " ") return;
      if (ended.current) return;
      ended.current = true;
      e.preventDefault();
      const swallow = (c: Event) => { c.stopPropagation(); c.preventDefault(); };
      document.addEventListener("click", swallow, true);
      setTimeout(() => document.removeEventListener("click", swallow, true), 500);
      stopRef.current();
      const stage = document.querySelector<HTMLElement>("[data-mt-stage]");
      stage?.getAnimations().forEach((a) => a.cancel());
      doneRef.current(true);
    };
    document.addEventListener("pointerdown", skip, true);
    document.addEventListener("keydown", skip, true);
    return () => { document.removeEventListener("pointerdown", skip, true); document.removeEventListener("keydown", skip, true); };
  }, [warm, embedded]);

  // 播放：聲音對齊動畫真正開始的那一刻（白閃的 CSS 動畫和整條時間軸同一刻開始）；手機震動在撞擊那一刻；時間到 onDone(false)
  useEffect(() => {
    let alive = true;
    if (warm) {
      // 預熱：整段（飛行、撞擊、爆炸、碎石、坑、牌、「自摸」字）一格一格走一遍
      const root = ref.current;
      if (root) void stepPlay(root, METEOR_MS, { alive: () => alive, stageShadow: METEOR_STAGE_SHADOW }).then(() => { if (alive) doneRef.current(false); });
      return () => { alive = false; };
    }
    const anim = ref.current?.querySelector(".mt-flash")?.getAnimations()[0];
    const go = (z: number | null) => { if (alive && !ended.current) stopRef.current = playMeteorSound(rm ? null : z, IMPACT, sfxUrl); };
    if (sound) {
      if (anim && !rm) void anim.ready.then(() => go(typeof anim.startTime === "number" ? anim.startTime : null), () => go(null));
      else go(null);
    }
    const ts = [setTimeout(() => { if (!ended.current) { ended.current = true; doneRef.current(false); } }, rm ? TOTAL_RM : METEOR_MS)];
    // 手機真的震動：重、停、輕（Android Chrome 等支援的瀏覽器；iPhone Safari 不支援，會直接略過）
    if (!rm && !embedded) ts.push(setTimeout(() => { if (typeof navigator.vibrate === "function") navigator.vibrate([150, 60, 50]); }, IMPACT));
    return () => { alive = false; ts.forEach(clearTimeout); stopRef.current(); };
  }, [rm, sfxUrl, warm, embedded, sound]);

  const n = mobile ? 10 : 14;
  const detail = (kind: string, f: string, cols: number, rows: number, i: number, c: number) => (
    <span key={`${kind}${i}`} className="mt-dz" data-md={kind} data-i={i}
      style={{ backgroundImage: `url("${art(f)}")`, backgroundSize: `${cols * 100}% ${rows * 100}%`, backgroundPosition: cellAt(c, cols, rows) }} />
  );
  const mover = (
    <div className="mt-mover">
      {/* eslint-disable-next-line @next/next/no-img-element -- 固定檔名素材，預載好再播 */}
      <img src={art("meteor.webp")} alt="" draggable={false} />
    </div>
  );
  // 三層（同一個 z，照順序疊）：①暗幕、隕石坑、隕石 ②爆炸（自己一層用 screen 和底下整個牌桌疊，黑底自動消失）
  // ③衝擊波、碎石、坑中央的牌、白閃；「自摸／名字」在第三層最上面。外面那層 display: contents 只是用來放座標變數和狀態 class
  return (
    <div ref={ref} className={`mtw ${embedded ? "embed" : ""} ${mobile ? "m" : "d"} ${rm ? "rm" : ""} ${font ? `f-${font}` : ""}`} data-mt-seat={seat} aria-hidden>
      <div className="mt">
        <div className="mt-dim" />
        <div className="mt-sky" />
        <div className="mt-plate" />
        <div className="mt-at">
          <div className="mt-crater" />
          <div className="mt-glow" />
          <div className="mt-smoke s1" />
          <div className="mt-smoke s2" />
          <div className="mt-ghost g2"><div className="mt-path">{mover}</div></div>
          <div className="mt-ghost g1"><div className="mt-path">{mover}</div></div>
          <div className="mt-main"><div className="mt-path">{mover}</div></div>
        </div>
      </div>
      <div className="mt mt-blend"><div className="mt-at"><div className="mt-boom" />
        {/* 補細節層：餘燼（黑底，screen） */}
        {Array.from({ length: mobile ? 10 : 16 }, (_, i) => detail("ember", "meteor-embers-single.webp", 4, 4, i, i % 16))}
      </div></div>
      <div className="mt"><div className="mt-at">
        <div className="mt-wave" />
        {/* 補細節層：塵浪、熱浪煙、熔岩碎石 */}
        {[0, 1, 2, 3].map((i) => detail("dust", "meteor-ground-dust-rings.webp", 4, 1, i, i))}
        {[0, 1, 2].map((i) => detail("smoke", "meteor-heat-smoke.webp", 3, 1, i, i))}
        {Array.from({ length: mobile ? 10 : 12 }, (_, i) => detail("rock", "meteor-impact-rocks-single.webp", 4, 3, i, i % 12))}
        {DEBRIS.slice(0, n).map((d, i) => (
          <span key={i} className="mt-rock" style={{ backgroundPosition: `${(d.f % 4) * 33.333}% ${Math.floor(d.f / 4) * 100}%` }} />
        ))}
        {/* 坑正中央浮出自摸的那張牌（現有的麻將牌元件），帶熔岩光 */}
        {tile && (
          <div className="mt-tile" data-mt-tile>
            <div className="mt-tile-aura" />
            <MjTile tile={tile} width="var(--tw)" height="var(--th)" />
          </div>
        )}
      </div>
      {/* 「自摸」＋名字：畫面正中央，程式排字；縮放加光爆砸出 */}
      <div className="mt-zimo" data-mt-zimo>
        <i className="mt-burst" />
        <b role="img" aria-label="自摸" style={{ backgroundImage: `url("${art("meteor-title.webp")}")` }} />
        {/* 定格後的餘燼：一直從字往上飄 */}
        {EMBERS.map((e, k) => <em key={k} className="mt-ember" style={{ "--ex": `${e.x}%`, "--ed": `${e.d}ms`, "--es": e.s } as CSSProperties} />)}
        <span>{name}</span>
      </div>
      <div className="mt-flash" /></div>
    </div>
  );
}
