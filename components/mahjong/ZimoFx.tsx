"use client";

// 自摸特效庫的 5 種新特效（老闆 2026-10-31：雷霆、風暴、冰封、黑洞、櫻花；隕石是另一支 MeteorFx）。
// 伺服器依帳號給公開代號（winner.winFx），自摸時由 hooks/useWinShow.tsx 掛上：特效 → 結算；大牌自摸＝大牌專屬段 → 特效 → 結算（lib/mahjong/winShow.ts）。
// 播完不卸下，只留暗幕墊在後面那一段底下，等整串結束一起收（交接時牌桌不會先亮一下）。每種的動作、方向都不同：
//   雷霆：雲層壓下 → 細雷試探 → 一道主雷從正上方垂直劈在牌上 → 地面電網擴散 → 電弧淡出
//   冰封：四邊結霜往落點收 → 冰槍從勝者那一側刺進來 → 整桌瞬凍、冰晶炸開 → 冰面碎裂、牌彈出 → 寒霧
//   風暴、黑洞、櫻花（v4，照小宜〈局部運動實作規格 v4〉，老闆 2026-10-31 補細素材）：拆成很多零件各自動，不轉整張圖——
//     風暴：8 條氣流帶從勝者那一側分三批吹進來 → 4 層漏斗帶各自不同速度擺動 → 風眼壓縮、主擊回彈、衝擊環 → 12 顆碎石各走拋物線、地面煙塵 4 幀
//     黑洞：10 條光流＋碎片沿弧線被吸向落點 → 吸積盤前後兩層反向弧移、暗核不轉 → 縮成白點、近黑停頓 70ms → 超新星反爆、4 組能量絲錯開 → 碎片反爆
//     櫻花：12 群花瓣分遠中近沿 S 曲線飄入、包住落下的花苞，上家、下家視角同時樹枝從畫面邊長到落點、花開在枝頭上（自己、對家視角不長樹枝，原地開花加金色光環、花瓣環繞）→ 花苞壓縮回彈 → 6 幀局部開花＋光陣 → 8 束花瓣噴流
// 素材：/mahjong-fx/zimo/<代號>/*.webp（老闆生成，檔名照阿哲 v4、細素材照阿哲〈13 張細素材 GPT 指令〉）；黑底的（-flash、-blast、-pinpoint、-nova、-halo、-nova-filaments）用 screen 疊加去黑。
// 視角（老闆 2026-10-31，比照隕石）：落點照勝者名牌（data-fx-seat，絕對座位）算，方向照「勝者在我的哪一邊」（rel＝(seat−mySeat)：0 自己、1 下家、2 對家、3 上家）——
//   雷霆劈在勝者位置；風暴、櫻花從勝者那一側吹進來；冰封從勝者那一側刺進來；黑洞以勝者位置為中心吸入、反爆。四家各自看到不同的畫面。
//   零件的方向依視角固定轉一次，之後只做位移、縮放、透明度（碎石、碎片小幅自轉）。
// 5 種都是完整版（比照隕石）：主擊時牌不在畫面上，主擊後才從落點炸出來、停在那裡；接著畫面中央出現這一種專屬的「自摸」大字＋名字
//   （components/mahjong/ZimoTitle.tsx），取代金色自摸浮層，播完直接結算。
// 音效：阿妍的專屬音效（lib/mahjong/fx/engine.ts 的 playZimoFxSound；檔案 0 秒＝特效開始，從頭放就對準）。點畫面任一處、Enter、Space＝跳過 onDone(true)；只會呼叫一次。
// 減少動態：不動、不震、不閃，1.6 秒（暗幕＋殘留、牌、字淡入）。
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import MjTile from "@/components/mahjong/MjTile";
import type { Tile } from "@/lib/mahjong/tiles";
import type { ZimoFxNew } from "@/lib/mahjong/winShow";
import { playZimoFxSound, preloadZimoFxSound } from "@/lib/mahjong/fx/engine";
import { holdStage, stepPlay, warmImg, type WarmMode } from "./fxWarmUp";
import ZimoTitle, { ZIMO_TITLE_AR, ZIMO_TITLE_EM } from "./ZimoTitle";
import { cellPos, runParts, type Part, type Pose } from "./fxParts";
import "./zimoFx.css";

const ART = "/mahjong-fx/zimo";
/** 主擊（ms）：雷霆、冰封的 zimoFx.css 百分比以 1.8 秒算（1.12 秒＝62.22%） */
const HIT = 1120;
/**
 * 時間軸（ms，從特效開始算；阿妍照這個對音效）：
 *   雷霆：0 暗幕、雷雲壓下 → 0.36 細雷試探 → 1.12 主雷劈在勝者位置（主擊）→ 地面電網擴散 → 1.42 牌從劈中的地方炸出來、停在那裡
 *         → 1.66「自摸」→ 1.86 名字 → 3.22 結束（同隕石：撞擊後 0.3 秒出牌、2.1 秒結束）
 *   冰封（小宜 v3 規格 4.2）：0 四邊結霜往落點收 → 0.52 冰槍從勝者那一側畫面外刺進來 → 1.08 刺中、整桌 90ms 內瞬凍、冰晶炸開（主擊）
 *         → 1.30 冰面像玻璃碎掉、牌隨碎冰彈出 → 1.56「自摸」→ 1.76 名字 → 2.90 結束
 *   風暴、黑洞、櫻花照小宜 v4 規格 4（共通時間節點）；黑洞 1.12 縮成白點、近黑停頓 70ms，1.19 才反爆（boom：牌桌震、白閃、手機震動在這一刻）
 */
export const ZFX_TL: Record<ZimoFxNew, { hit: number; tile: number; zimo: number; name: number; total: number; boom?: number }> = {
  thunder: { hit: 1120, tile: 1420, zimo: 1660, name: 1860, total: 3220 },
  frost: { hit: 1080, tile: 1300, zimo: 1560, name: 1760, total: 2900 },
  storm: { hit: 1120, tile: 1400, zimo: 1860, name: 2080, total: 2680 },
  blackhole: { hit: 1120, boom: 1190, tile: 1420, zimo: 1860, name: 2100, total: 2600 },
  sakura: { hit: 1120, tile: 1420, zimo: 1880, name: 2120, total: 2640 },
};
export const isOwnTitleFx = (fx: string): fx is ZimoFxNew => fx in ZFX_TL;
const hitOf = (fx: ZimoFxNew) => ZFX_TL[fx].hit;
const boomOf = (fx: ZimoFxNew) => ZFX_TL[fx].boom ?? ZFX_TL[fx].hit;
export const zfxTotal = (fx: ZimoFxNew) => ZFX_TL[fx].total;
const OWN_RM = 1600;
const STAGE_SHADOW = "0 0 0 200px #05080b";

/** 每種的素材（檔名照阿哲 v4；風暴、黑洞、櫻花的細素材照〈13 張細素材 GPT 指令〉；<代號>-title＝老闆生成的「自摸」大字圖） */
export const ZFX_ART: Record<ZimoFxNew, string[]> = {
  thunder: ["thunder-title", "thunder-clouds", "thunder-bolt", "thunder-forks", "thunder-flash", "thunder-web", "thunder-cloud-crawl", "thunder-side-forks",
    "thunder-plasma-sparks", "thunder-ground-arcs", "thunder-residual-current"],
  storm: ["storm-title", "storm-blast", "storm-air-ribbons", "storm-funnel-bands", "storm-rocks-single", "storm-v5-wind-wall", "storm-v5-rain-debris",
    "storm-v5-funnel-shells", "storm-v5-ground-spray", "storm-v5-speed-lines"],
  frost: ["frost-title", "frost-edges", "frost-mist", "frost-spear", "frost-sheet", "frost-spikes", "frost-shards", "frost-veins-branches", "frost-spear-splinters",
    "frost-crack-junctions", "frost-cold-mist-puffs"],
  blackhole: ["blackhole-title", "blackhole-core", "blackhole-pinpoint", "blackhole-nova", "blackhole-stardust", "blackhole-light-streams", "blackhole-accretion-back",
    "blackhole-accretion-front", "blackhole-debris-single", "blackhole-nova-filaments"],
  sakura: ["sakura-title", "sakura-bud", "sakura-halo", "sakura-petal-clusters", "sakura-bud-opening", "sakura-impact-petal-burst", "sakura-branch-growth"],
};

const RM_Q = "(prefers-reduced-motion: reduce)";
function useReducedMotion() {
  return useSyncExternalStore(
    (cb) => { const m = matchMedia(RM_Q); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => matchMedia(RM_Q).matches,
    () => false,
  );
}

/** 先載好、解碼好這一種的圖和佔位音效（房間裡有這個帳號、或這一手真的要播時才叫；一般牌局不下載） */
const artImgs: HTMLImageElement[] = [];
const ready = new Map<ZimoFxNew, Promise<boolean>>();
export function preloadZimoFx(fx: ZimoFxNew): Promise<boolean> {
  let p = ready.get(fx);
  if (!p) {
    p = Promise.all([
      ...ZFX_ART[fx].map((f) => {
        const i = new Image();
        i.src = `${ART}/${fx}/${f}.webp`;
        artImgs.push(i);
        return i.decode().then(() => true, () => false);
      }),
      preloadZimoFxSound(fx).then((b) => !!b),
    ]).then((ok) => ok.every(Boolean));
    ready.set(fx, p);
  }
  return p;
}

/**
 * 風暴的主風向（老闆 2026-10-31：自己看右上往左下、對家看左上往右下，都偏橫向；上家、下家照「從勝者那一側吹過來」對齊）：
 * 自己、下家看＝往左下（風從右邊來）；對家、上家看＝往右下（風從左邊來）。往下斜 25 度
 */
const stormWind = (rel: number) => ({ x: (rel === 0 || rel === 1 ? -1 : 1) * Math.cos((25 * Math.PI) / 180), y: Math.sin((25 * Math.PI) / 180) });
/** 勝者在我的哪一邊：從桌心指向勝者的方向（0 自己＝下方、1 下家＝右、2 對家＝上、3 上家＝左） */
const SIDE = [[0, 1], [1, 0], [0, -1], [-1, 0]] as const;

/** 碎片：方向、距離、轉速固定（不用亂數，每次播都一樣）。f＝精靈表第幾格 */
const BITS = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2 + ((i * 7) % 5) * 0.21;
  return { a, r: 0.55 + ((i * 37) % 10) / 22, s: 0.65 + ((i * 53) % 10) / 22, spin: (i % 2 ? 1 : -1) * (90 + ((i * 71) % 5) * 40), f: i % 8 };
});

/** 主擊時牌桌震一下（比隕石輕：手機最大 12px、電腦 16px，0.35 秒）；櫻花不震 */
function shakeStage(stage: HTMLElement, mobile: boolean, strong: boolean, at: number) {
  const A = (mobile ? 12 : 16) * (strong ? 1 : 0.6);
  const frames: Keyframe[] = [{ offset: 0, transform: "none" }];
  for (let i = 1; i <= 6; i++) {
    const e = Math.exp(-i * 0.55), sg = i % 2 ? 1 : -1;
    frames.push({ offset: i / 7, transform: `translate(${(sg * A * e).toFixed(1)}px, ${(-sg * A * 0.4 * e).toFixed(1)}px) scale(${(1 - (A * e * 2.4) / innerWidth).toFixed(4)})` });
  }
  frames.push({ offset: 1, transform: "none" });
  stage.style.transformOrigin = "50% 50%";
  return [stage.animate(frames, { duration: 350, delay: at, easing: "linear" })];
}

/**
 * 風暴、黑洞、櫻花 v4（小宜〈局部運動實作規格 v4〉5～7）：算出每個零件的大小和整條時間軸的位移。
 * 零件在 JSX 裡用 data-zp＝種類、data-i＝第幾個；都放在落點（--px／--py）正中央，位移相對落點。
 * 數字都是固定的（照第幾個算，不用亂數），重播、重繪都一樣。
 */
function v4Parts(fx: ZimoFxNew, root: HTMLElement, g: { W: number; H: number; u: number; px: number; py: number; rel: number; mobile: boolean }): Part[] {
  const { W, H, u, px, py, rel, mobile } = g;
  const [sx, sy] = SIDE[rel], qx = -sy, qy = sx; // 勝者那一側（從桌心看）、和它垂直的方向
  const k = u / 390; // 規格的 px 數字以手機 390 高為準
  const els = (kind: string) => [...root.querySelectorAll<HTMLElement>(`[data-zp="${kind}"]`)].map((el) => ({ el, i: Number(el.dataset.i) }));
  const deg = (a: number) => (a * 180) / Math.PI;
  const out: Part[] = [];
  if (fx === "storm") {
    // 風暴 v5（小宜〈風暴自摸特效-v5-實作與素材規格〉）：風牆橫掃全場 → 巨型漏斗從勝者那一側壓進來 → 風眼壓縮 → 1.12 一記風核重擊 → 1.40 牌 → 殘風、斜雨退場。
    // 主風向（老闆 2026-10-31）：一律偏橫向、往下斜 25 度（d＝風、斜雨、速度線同一個方向）；所有零件只依方向轉一次，之後只有位移、縮放、透明度
    const d = stormWind(rel), rd = d, D = Math.hypot(W, H), cxo = W / 2 - px, cyo = H / 2 - py;
    const qx2 = -rd.y, qy2 = rd.x;
    const full = (along: number, side = 0, dir = d): { x: number; y: number } => ({ x: cxo + dir.x * along + -dir.y * side, y: cyo + dir.y * along + dir.x * side });
    // A 風牆：0.12～0.42 第一道橫掃全場（從畫面外一路穿過去），0.56～0.90 第二道較淡，1.40～1.84 殘風
    els("wall").forEach(({ el, i }) => {
      const w = D * (i === 0 ? 1.25 : 1.05), h = w * 0.667, flip = d.x < -0.01, rot = deg(Math.atan2(d.y, d.x)) + (flip ? 155 : 25);
      const [t0, t1, o] = [[120, 420, 0.95], [560, 900, 0.6], [1400, 1840, 0.35]][i];
      const at = (f: number, oo: number, s = 1): Pose => ({ ...full(-D * 0.95 + (D * 1.25) * f), s, o: oo });
      out.push({ el, w, h, rot, flip, keys: [[0, at(0, 0)], [t0, at(0, 0)], [t0 + 40, at(0.12, o)], [t1 - 40, at(0.88, o, 1.04)], [t1, at(1, 0, 1.06)]] });
    });
    // E 速度線（黑底，screen）：整段一直沿斜雨方向往下風處漂，邊界也有速度感
    els("lines").forEach(({ el, i }) => {
      const w = D * 1.3, h = w * 0.667, rot = deg(Math.atan2(rd.y, rd.x)) + 30, o = i === 0 ? 0.55 : 0.35;
      const at = (f: number, oo: number): Pose => ({ ...full(-D * 0.12 + D * 0.24 * f + i * D * 0.06, (i - 0.5) * D * 0.1, rd), s: 1, o: oo });
      out.push({ el, w, h, rot, keys: [[0, at(0, 0)], [180, at(0, 0)], [300, at(0.05, o)], [2580, at(0.95, o)], [2680, at(1, 0)]] });
    });
    // B 斜雨、細屑：遠／中／近三層，速度 1.0／1.45／2.1（一趟 900／620／430ms），每條各自一趟一趟斜斜穿過全場
    const rain = els("rain"), per = rain.length / 3;
    rain.forEach(({ el, i }) => {
      const layer = Math.floor(i / per), j = i % per, P = [900, 620, 430][layer], w = u * [0.45, 0.7, 1.1][layer], o = [0.45, 0.65, 0.85][layer];
      const lane = ((j + 0.5) / per - 0.5) * D * 0.85, L = D * 1.15, ph = (i * 137) % P;
      const at = (f: number, oo: number): Pose => ({ x: cxo + rd.x * L * (f - 0.5) + qx2 * lane, y: cyo + rd.y * L * (f - 0.5) + qy2 * lane, s: 1, o: oo });
      const keys: [number, Pose][] = [[0, at(0, 0)], [180, at(ph / P, 0)], [300, at((ph + 120) / P, o)]];
      // 大字出來（1.86）以後雨變淡（留白給大字），2.58 起收掉
      const oo = (t: number) => (t > 2580 ? 0 : t > 1840 ? o * 0.55 : o);
      for (let t = 180 - ph + P; t < 2680; t += P) keys.push([t - 1, at(1, oo(t))], [t, at(0, oo(t))]);
      keys.push([2680, at(((2680 - 180 + ph) % P) / P, 0)]);
      out.push({ el, w, h: w, rot: deg(Math.atan2(rd.y, rd.x)) - 45, keys: keys.sort((a, b) => a[0] - b[0]), rm: layer === 1 && j === 0 ? { ...at(0.5, 0.7) } : undefined });
    });
    // C 巨型漏斗外殼（桌機 74vw×90vh、手機 88vw×130vh；落點上方空間不夠時整個縮小，底部還在落點）：6 段由下往上、越上越寬，
    // 0.36～0.94 從上風處壓進來，各段左右擺（下慢上快）；0.94～1.12 往中線壓；主擊往外炸開，1.40～1.84 剝離、淡出
    const fw = W * (mobile ? 0.88 : 0.74), fh0 = H * (mobile ? 1.3 : 0.9), fh = fh0 * Math.min(1, Math.max(0.55, (py + H * 0.2) / fh0));
    els("shell").forEach(({ el, i }) => {
      const w = fw * (0.42 + 0.58 * (i / 5)), h = w * 0.871, y0 = -fh * (i + 0.5) / 6, t1 = 360 + i * 60, A = (10 + 6 * i) * k, P = 640 - 70 * i;
      const inX = -d.x * W * 0.6, inY = 0, sd = i % 2 ? 1 : -1; // 從上風處（風吹來的那一側）壓進來
      const sway: [number, Pose][] = [];
      for (let t = t1 + 150; t < 940; t += 80) sway.push([t, { x: A * Math.sin((2 * Math.PI * (t - t1)) / P), y: y0, s: 1 + 0.04 * Math.sin((2 * Math.PI * t) / (P * 1.3)), sy: 1, o: 0.85 }]);
      out.push({ el, w, h, flip: i % 2 === 1, keys: [[0, { x: inX, y: y0 + inY, s: 0.8, o: 0 }], [t1, { x: inX, y: y0 + inY, s: 0.8, o: 0 }],
        [t1 + 150, { x: 0, y: y0, s: 1, sy: 1, o: 0.85, e: "cubic-bezier(.2,.7,.3,1)" }], ...sway, [1100, { x: 0, y: y0, s: 0.8, sy: 1, o: 0.9 }],
        [1120, { x: 0, y: y0, s: 1.05, sy: 1, o: 0.9, e: "cubic-bezier(.15,.7,.35,1)" }], [1400, { x: sd * W * 0.12 + d.x * W * 0.08, y: y0 + d.y * H * 0.08, s: 1.2, sy: 1.05, o: 0.5 }],
        [1840, { x: sd * W * 0.2 + d.x * W * 0.3, y: y0 + d.y * H * 0.3, s: 1.3, sy: 1.1, o: 0 }]], rm: i === 2 ? { x: 0, y: y0, s: 1, o: 0.4 } : undefined });
    });
    // 漏斗內環（v4 的 4 層風帶放大 1.35 倍）：各自不同速度左右擺；0.94～1.12 內核縮到 0.42，主擊炸開後消失
    const uv = u * Math.min(1, Math.max(0.5, py / (u * 1.25))) * 1.35;
    const BAND = [[1, -0.1, 6, 640], [0.62, -0.38, 10, 460], [0.58, -0.62, 14, 340], [0.5, -0.86, 18, 260]];
    els("band").forEach(({ el, i }) => {
      const [bw, by, A, P] = BAND[i], w = uv * bw, h = w * 0.84, y0 = uv * by, t1 = 520 + i * 60;
      const sway: [number, Pose][] = [];
      for (let t = t1 + 90; t < 940; t += 90) sway.push([t, { x: A * k * Math.sin((2 * Math.PI * (t - t1)) / P), y: y0, s: 1, o: 0.8 }]);
      out.push({ el, w, h, keys: [[0, { x: 0, y: y0 + uv * 0.1, s: 0.6, o: 0 }], [300 + i * 60, { x: 0, y: y0 + uv * 0.1, s: 0.6, o: 0 }], [t1, { x: 0, y: y0, s: 1, o: 0.8 }], ...sway,
        [1110, { x: 0, y: y0 * 0.6, s: 0.42, o: 0.95 }], [1120, { x: 0, y: y0 * 0.6, s: 0.5, o: 1, e: "cubic-bezier(.15,.7,.35,1)" }], [1300, { x: 0, y: y0 * 0.6, s: 1.6, o: 0 }]] });
    });
    // 氣流帶（v4 的，亮度降 20%）：只當中層導流線，從勝者那一側一路吹過去
    els("ribbon").forEach(({ el, i }) => {
      const w = u * (0.4 + (i % 3) * 0.06), h = w * 0.865, flip = d.x < -0.01, t0 = 140 + i * 90, side = ((i % 3) - 1) * u * 0.35;
      const at = (f: number, o: number, s: number): Pose => ({ ...full(-D * 0.55 + D * 1.1 * f, side), s, sy: 1, o });
      out.push({ el, w, h, flip, rot: deg(Math.atan2(d.y, d.x)) + (flip ? 155 : 25), keys: [[0, at(0, 0, 0.5)], [t0, at(0, 0, 0.5)], [t0 + 120, at(0.15, 0.6, 1)],
        [t0 + 700, at(0.85, 0.6, 1.3)], [t0 + 800, at(1, 0, 1.3)], [2680, at(1, 0, 1.3)]] });
    });
    // 碎石（比 v4 少 45%，只當速度參照）：主擊前被捲起來，主擊時沿拋物線往下風處甩出去
    const rocks = els("rock");
    rocks.forEach(({ el, i }) => {
      const a = (i / rocks.length) * Math.PI * 2 + 0.4, w = u * 0.1 * (0.75 + (i % 3) * 0.2), spin = (i % 2 ? 1 : -1) * (160 + (i % 4) * 60);
      const fx0 = Math.cos(a) * u * 0.28, fy0 = Math.sin(a) * u * 0.08, ry = -u * (0.18 + 0.12 * (i % 3));
      const ex = fx0 + d.x * u * 0.9 + Math.cos(a) * u * 0.3, ey = fy0 + d.y * u * 0.6 + u * 0.2;
      out.push({ el, w, h: w * 0.955, keys: [[0, { x: fx0, y: fy0, s: 0.5, o: 0, r: 0 }], [600 + i * 50, { x: fx0, y: fy0, s: 0.6, o: 0, r: 0 }],
        [1060, { x: fx0 * 0.8, y: fy0 + ry, s: 0.9, o: 1, r: spin * 0.4 }], [1120, { x: fx0 * 0.7, y: fy0 + ry, s: 1, o: 1, r: spin * 0.45, e: "cubic-bezier(.15,.7,.35,1)" }],
        [1400, { x: (fx0 * 0.7 + ex) / 2, y: fy0 + ry - u * 0.15, s: 1.05, o: 0.9, r: spin * 0.9 }], [1700, { x: ex, y: ey, s: 0.9, o: 0, r: spin * 1.4 }]] });
    });
    // D 地面水霧 4 幀（一個元素換格）：主擊時從落點往下風處噴開（下緣貼著落點），1.80 前淡掉
    els("spray").forEach(({ el }) => {
      const w = u * 0.95, h = w * 0.535, y = -h / 2 + u * 0.05, flip = d.x < -0.01;
      const at = (f: number, ms: number, o: number): [number, Pose] => [ms, { x: 0, y, s: 0.9 + f * 0.05, o, bp: cellPos(f, 4, 1), e: "steps(1, end)" }];
      out.push({ el, w, h, flip, keys: [at(0, 0, 0), at(0, 1110, 0), at(0, 1120, 0.95), at(1, 1180, 0.95), at(2, 1260, 0.95), at(3, 1340, 0.95), at(3, 1600, 0.8),
        [1800, { x: 0, y, s: 1.1, o: 0, bp: cellPos(3, 4, 1) }]] });
    });
  } else if (fx === "blackhole") {
    // 後景星塵：一路被吸近（越來越快），反爆後慢慢往外飄
    const dust = els("stardust");
    dust.forEach(({ el, i }) => {
      const a = (i / dust.length) * Math.PI * 2 + 0.3, r0 = u * (0.9 + ((i * 13) % 5) * 0.1), w = u * 0.13 * (0.7 + ((i * 7) % 4) * 0.15);
      const at = (r: number, o: number, s = 1): Pose => ({ x: Math.cos(a) * r, y: Math.sin(a) * r * 0.7, s, o });
      out.push({ el, w, h: w, keys: [[0, at(r0, 0)], [300, at(r0 * 0.9, 0.55)], [1100, at(r0 * 0.25, 0.5, 0.7)], [1190, at(r0 * 0.33, 0.3, 0.6)], [1700, at(r0 * 1.1, 0.45)], [2600, at(r0 * 1.25, 0)]] });
    });
    // 光流：沿弧線（掃過約 70°）被拉向落點，越近越快、橫向拉長到 1.6 倍，到中心時縮掉
    // 光流（老闆 2026-10-31：吸進去的要多、要快，整個畫面都被吸過去）：從畫面四邊（對角線 55～75% 遠）沿弧線被拉向落點，
    // 每條吸兩趟（第一趟 0～0.65、第二趟接著出發、1.08 前吸完），一趟約 0.42 秒，越近越快、橫向拉長到 1.6 倍，到中心時縮掉
    const DG = Math.hypot(W, H), st = els("stream");
    st.forEach(({ el, i }) => {
      const th0 = (i / st.length) * Math.PI * 2 + (i % 3) * 0.2, R0 = DG * (0.55 + ((i * 7) % 5) * 0.05), w = u * 0.34;
      const trip = (ts: number, ta: number, rr: number): [number, Pose][] => [0, 0.4, 0.7, 0.88, 1].map((sp, n) => {
        const r = rr * (1 - sp ** 1.7), th = th0 + 1.1 * sp;
        return [ts + (ta - ts) * sp, { x: Math.cos(th) * r, y: Math.sin(th) * r * 0.62, s: n === 4 ? 0.3 : 1 + 0.6 * sp, sy: n === 4 ? 0.2 : 1 - 0.5 * sp, o: n === 0 || n === 4 ? 0 : 0.9 }];
      });
      const t1 = (i % 6) * 45, t2 = t1 + 460 + (i % 5) * 30; // 第二趟在第一趟吸完之後才出發（關鍵影格時間不能倒退）
      out.push({ el, w, h: w * 0.74, rot: deg(th0) + 110, keys: [[0, trip(t1, t1 + 420, R0)[0][1]], ...trip(t1, t1 + 420, R0), ...trip(t2, Math.min(1080, t2 + 420), R0 * 0.85)] });
    });
    // 碎片：從畫面四邊沿弧線被快速吸進去（邊轉，一趟約 0.5 秒，分批出發），1.19 從中心反爆出去（大的＝近景，飛得快），慢慢減速淡掉
    const deb = els("debris");
    deb.forEach(({ el, i }) => {
      const th0 = (i / deb.length) * Math.PI * 2 + 0.5, R0 = DG * (0.45 + ((i * 11) % 5) * 0.06), ts = (i % 7) * 75, ta = Math.min(1080, ts + 470 + (i % 3) * 40);
      const big = 0.75 + ((i * 5) % 4) * 0.18, w = u * 0.11 * big, spin = (i % 2 ? 1 : -1) * 140;
      const pin = (s: number, o: number): [number, Pose] => {
        const r = R0 * (1 - s ** 1.6), th = th0 + 1.5 * s;
        return [ts + (ta - ts) * s, { x: Math.cos(th) * r, y: Math.sin(th) * r * 0.62, s: 1 - 0.6 * s, o, r: spin * s }];
      };
      const th1 = th0 + Math.PI * 0.6, Ro = u * (0.5 + ((i * 7) % 6) * 0.1) * big, te = 1700 + (i % 4) * 150;
      const outAt = (f: number, o: number): Pose => ({ x: Math.cos(th1) * Ro * f, y: Math.sin(th1) * Ro * f * 0.7, s: 0.4 + 0.7 * Math.min(1, f), o, r: spin * (1 + f) });
      out.push({ el, w, h: w * 0.74, keys: [[0, pin(0, 0)[1]], pin(0, 0), pin(0.3, 1), pin(0.7, 1), [ta, { ...pin(1, 0)[1] }],
        [1190, outAt(0, 0)], [1200, { ...outAt(0.02, 1), e: "cubic-bezier(.1,.7,.3,1)" }], [te, outAt(1, 0.9)], [Math.min(2600, te + 500), outAt(1.08, 0)]] });
    });
    // 吸積盤：後層（上半弧）慢、前層（下半弧）快，往相反方向弧移，暗核不轉；主擊前一起縮進中心
    const disk = (kind: string, ar: number, y: number, A: number, P: number, dir: number) => els(kind).forEach(({ el }) => {
      const w = u * 1.05, h = w * ar, sway: [number, Pose][] = [];
      for (let t = 790; t < 1040; t += 90) sway.push([t, { x: dir * A * Math.sin((2 * Math.PI * (t - 700)) / P), y: h * y, s: 1, o: 0.95 }]);
      out.push({ el, w, h, keys: [[0, { x: 0, y: h * y, s: 0.7, o: 0 }], [540, { x: 0, y: h * y, s: 0.7, o: 0 }], [700, { x: 0, y: h * y, s: 1, o: 0.95 }], ...sway,
        [1040, { x: 0, y: h * y, s: 0.95, o: 0.95 }], [1120, { x: 0, y: h * y * 0.2, s: 0.06, o: 0.6 }], [1135, { x: 0, y: 0, s: 0.03, o: 0 }]] });
    });
    disk("disk-back", 0.463, -0.22, u * 0.03, 900, -1);
    els("core").forEach(({ el }) => out.push({ el, w: u * 0.5, h: u * 0.5 * 0.667, keys: [
      [0, { x: 0, y: 0, s: 0.25, o: 0 }], [540, { x: 0, y: 0, s: 0.25, o: 0 }], [700, { x: 0, y: 0, s: 1, o: 1 }], [1040, { x: 0, y: 0, s: 0.95, o: 1 }],
      [1120, { x: 0, y: 0, s: 0.04, o: 0.8 }], [1130, { x: 0, y: 0, s: 0.02, o: 0 }]] }));
    disk("disk-front", 0.494, 0.2, u * 0.04, 420, 1);
    // 1.12～1.19 近黑停頓：整個畫面壓暗，只剩中心一個白點
    els("void").forEach(({ el }) => out.push({ el, w: W * 3, h: H * 3, keys: [
      [0, { x: W / 2 - px, y: H / 2 - py, s: 1, o: 0 }], [1100, { x: W / 2 - px, y: H / 2 - py, s: 1, o: 0 }], [1125, { x: W / 2 - px, y: H / 2 - py, s: 1, o: 0.6 }],
      [1185, { x: W / 2 - px, y: H / 2 - py, s: 1, o: 0.6 }], [1260, { x: W / 2 - px, y: H / 2 - py, s: 1, o: 0 }]] }));
    els("pin").forEach(({ el }) => out.push({ el, w: u * 0.3, h: u * 0.3, keys: [
      [0, { x: 0, y: 0, s: 0.2, o: 0 }], [1100, { x: 0, y: 0, s: 0.2, o: 0 }], [1120, { x: 0, y: 0, s: 0.35, o: 1 }], [1185, { x: 0, y: 0, s: 0.3, o: 1 }],
      [1200, { x: 0, y: 0, s: 1.4, o: 1 }], [1260, { x: 0, y: 0, s: 2, o: 0 }]] }));
    // 超新星環 0.16→1.3、4 組不規則能量絲錯開 20ms 反爆（每組依視角固定一個方向）
    els("nova").forEach(({ el }) => out.push({ el, w: u * 1.45, h: u * 1.45, keys: [
      [0, { x: 0, y: 0, s: 0.16, o: 0 }], [1185, { x: 0, y: 0, s: 0.16, o: 0 }], [1200, { x: 0, y: 0, s: 0.2, o: 1, e: "cubic-bezier(.15,.7,.35,1)" }],
      [1700, { x: 0, y: 0, s: 1.3, o: 0.7 }], [1860, { x: 0, y: 0, s: 1.35, o: 0 }]] }));
    els("fila").forEach(({ el, i }) => {
      const w = u * 0.85, ts = 1190 + i * 20;
      out.push({ el, w, h: w * 1.334, rot: [0, 95, 190, 275][i] + rel * 25, keys: [
        [0, { x: 0, y: 0, s: 0.3, o: 0 }], [ts - 5, { x: 0, y: 0, s: 0.3, o: 0 }], [ts + 40, { x: 0, y: 0, s: 0.55, o: 1, e: "cubic-bezier(.15,.7,.35,1)" }],
        [ts + 450, { x: 0, y: 0, s: 1.15, o: 0.85 }], [ts + 700 + i * 120, { x: 0, y: 0, s: 1.25, o: 0 }]], rm: { x: 0, y: 0, s: 1, o: 0.8 } });
    });
  } else if (fx === "sakura") {
    const cy = -u * 0.12; // 花苞、花的中心（牌從花心浮出來）
    // 花瓣群：遠中近三層（近景大、快；遠景小、慢、淡；不加模糊，手機才不掉幀），從勝者那一側（偏上、左右散開，自己那一家也看得到）沿 S 曲線飄進來，分三批包住花苞；主擊後往外散、各自飄落
    const pet = els("petal");
    pet.forEach(({ el, i }) => {
      const d = i % 3, w = u * [0.17, 0.24, 0.33][d], o = [0.5, 0.8, 1][d], b = Math.floor(i / 3) % 3;
      const sp = (((i * 53) % 9) / 8 - 0.5) * u * 0.9, a = (i / pet.length) * Math.PI * 2, r = u * (0.22 + 0.1 * d);
      const S = { x: sx * u * 0.5 + qx * sp * 1.4, y: sy * u * 0.35 + qy * sp * 1.4 - u * 0.15 }, E = { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.7 + cy };
      const ta = [700, 870, 1040][b], ts = Math.max(0, ta - [900, 750, 600][d]);
      const mid = (f: number, side: number): Pose => ({ x: S.x + (E.x - S.x) * f + qx * side * u, y: S.y + (E.y - S.y) * f + qy * side * u, s: 1, o });
      const fall = 1700 + ((i * 37) % 6) * 150, last = i < 4;
      out.push({ el, w, h: w * 1.01, keys: [
        [0, { ...S, s: 1, o: 0 }], [ts, { ...S, s: 1, o: 0 }], [ts + (ta - ts) * 0.35, mid(0.35, 0.15)], [ts + (ta - ts) * 0.7, mid(0.7, -0.15)], [ta, { ...E, s: 1, o }],
        [1120, { ...E, s: 0.95, o }], [1300, { x: E.x * 1.6, y: E.y * 1.3, s: 1.05, o, e: "ease-out" }],
        [fall, { x: E.x * 1.8 + Math.sin(i) * u * 0.05, y: E.y * 1.3 + u * 0.3, s: 1, o: last ? o * 0.6 : 0 }],
        [2640, { x: E.x * 1.85 - Math.sin(i) * u * 0.05, y: E.y * 1.3 + u * 0.45, s: 1, o: 0 }]] });
    });
    // 花苞（老闆的璀璨鎏金魔法花苞）：從勝者那一側上方落下（只有位移、縮放），1.04～1.12 壓縮，主擊回彈 1.08 後換成開花序列
    els("bud").forEach(({ el }) => {
      const w = u * 0.36, s0 = { x: sx * u * 0.6, y: cy - u * 0.75 + sy * u * 0.15 };
      out.push({ el, w, h: w * 1.5, keys: [[0, { ...s0, s: 0.6, o: 0 }], [480, { ...s0, s: 0.6, o: 0 }], [560, { ...s0, s: 0.7, o: 1, e: "cubic-bezier(.5,0,.9,.6)" }],
        [1040, { x: 0, y: cy, s: 1, o: 1 }], [1120, { x: 0, y: cy, s: 1.04, sy: 0.92, o: 1 }], [1150, { x: 0, y: cy, s: 1.08, o: 1 }], [1175, { x: 0, y: cy, s: 1.06, o: 0 }]] });
    });
    // 開花 6 幀（一個元素一格一格換）：1.15 起由下層到上層一層層打開，1.425 開滿，留著當牌的底
    const cell = cellPos;
    els("bloom").forEach(({ el }) => {
      const w = u * 0.62, at = (k: number, o: number, s: number, ms: number): [number, Pose] => [ms, { x: 0, y: cy, s, o, bp: cell(k, 3, 2), e: "steps(1, end)" }];
      out.push({ el, w, h: w, keys: [at(0, 0, 1.08, 0), at(0, 0, 1.08, 1140), at(0, 1, 1.08, 1150), at(1, 1, 1, 1205), at(2, 1, 1, 1260), at(3, 1, 1, 1315),
        at(4, 1, 1, 1370), at(5, 1, 1, 1425), at(5, 1, 1, 1880), [2640, { x: 0, y: cy, s: 1.02, o: 0.8, bp: cell(5, 3, 2) }]], rm: { x: 0, y: cy, s: 1, o: 1, bp: cell(5, 3, 2) } });
    });
    // 撞擊光陣：俯視壓扁，只縮放、淡入淡出
    els("halo").forEach(({ el }) => out.push({ el, w: u, h: u, keys: [[0, { x: 0, y: 0, s: 0.4, sy: 0.17, o: 0 }], [1110, { x: 0, y: 0, s: 0.4, sy: 0.17, o: 0 }],
      [1200, { x: 0, y: 0, s: 1, sy: 0.42, o: 1 }], [1900, { x: 0, y: 0, s: 1.05, sy: 0.44, o: 0.9 }], [2640, { x: 0, y: 0, s: 1.1, sy: 0.46, o: 0 }]] }));
    // 花瓣噴流 8 束：各自朝一個方向（依視角固定轉一次）往外噴，分兩批
    els("burst").forEach(({ el, i }) => {
      const a = ((i * 45 + 22.5 + rel * 10) * Math.PI) / 180, w = u * 0.32, ts = 1260 + (i % 2) * 80;
      const at = (r: number, s: number, o: number): Pose => ({ x: Math.cos(a) * r * u, y: Math.sin(a) * r * u * 0.8 + cy, s, o });
      out.push({ el, w, h: w * 0.894, rot: deg(a) + 40, keys: [[0, at(0.06, 0.4, 0)], [ts - 10, at(0.06, 0.4, 0)], [ts + 60, { ...at(0.15, 0.8, 1), e: "ease-out" }],
        [ts + 420, at(0.5, 1.1, 0.85)], [ts + 620, at(0.6, 1.15, 0)]] });
    });
    // 自己、對家視角（老闆 2026-10-31：不要從畫面邊長樹枝）：花苞落地後原地開花，花後面立一圈金色光環（只縮放、呼吸），8 片花瓣沿橢圓繞著花轉（只有位移）
    els("ring").forEach(({ el }) => {
      const w = u * 0.95, at = (s: number, o: number): Pose => ({ x: 0, y: cy, s, o });
      out.push({ el, w, h: w, keys: [[0, at(0.3, 0)], [1140, at(0.3, 0)], [1320, { ...at(1, 0.9), e: "cubic-bezier(.2,.8,.3,1.1)" }], [1700, at(1.04, 0.8)], [2100, at(0.98, 0.9)],
        [2640, at(1.03, 0.75)]] });
    });
    const orb = els("orbit");
    orb.forEach(({ el, i }) => {
      const w = u * 0.12, rx = u * 0.44, ry = u * 0.15, ph = (i / orb.length) * Math.PI * 2, P = 1800, keys: [number, Pose][] = [];
      const at = (t: number, o: number): Pose => { const a = ph + ((t - 1250) / P) * Math.PI * 2; return { x: Math.cos(a) * rx, y: cy + u * 0.06 + Math.sin(a) * ry, s: 1, o: o * (Math.sin(a) > 0 ? 1 : 0.45) }; };
      keys.push([0, at(1250, 0)], [1250, at(1250, 0)]);
      for (let t = 1350; t <= 2640; t += 75) keys.push([t, at(t, t < 1450 ? (t - 1250) / 200 : 0.95)]);
      out.push({ el, w, h: w * 1.01, keys });
    });
    // 上家、下家視角：樹枝 5 幀（一個元素一格一格換）：花苞落下的同時（0.50～0.98）從畫面邊長出來，枝頭＝花苞落地、開花的位置（花的底座），花開在枝頭上。
    // 圖裡樹幹在左下、往右上長，枝頭取開滿那一幀樹冠中間（寬 66%、高 30%）；勝者在畫面右半邊就左右翻面，樹幹從右邊進來
    els("branch").forEach(({ el }) => {
      const w = u * 1.15, h = w * 0.805, flip = px > W / 2, ax = 0.66, ay = 0.3, baseY = cy + u * 0.62 * 0.42;
      const x = (flip ? -1 : 1) * (0.5 - ax) * w, y = baseY + (0.5 - ay) * h;
      const at = (k: number, o: number, ms: number): [number, Pose] => [ms, { x, y, s: 1, o, bp: cell(k, 5, 1), e: "steps(1, end)" }];
      out.push({ el, w, h, flip, keys: [at(0, 0, 0), at(0, 0, 470), [500, { x, y, s: 1, o: 0.95, bp: cell(0, 5, 1), e: "steps(1, end)" }], at(1, 0.95, 620),
        at(2, 0.95, 740), at(3, 0.95, 860), at(4, 0.95, 980), [2640, { x, y, s: 1, o: 0.95, bp: cell(4, 5, 1) }]] });
    });
  } else if (fx === "thunder") {
    // 雷霆補細節層（小宜〈隕石冰封雷霆-補細節素材清單 v1〉，老闆 2026-10-31 補充特效2）：主擊 1.12、牌 1.42、時間軸不動，只加層（全部黑底，screen）
    // 雲內爬電：雷雲那一帶（畫面上方）各處先後閃兩下（0.38～1.4 秒）
    const crawl = els("tcrawl");
    crawl.forEach(({ el, i }) => {
      const w = u * 0.5, x = (i / Math.max(1, crawl.length - 1) - 0.5) * W * 0.9 + (W / 2 - px), y = u * 0.12 - py, t = 380 + i * 110;
      const at = (ms: number, o: number, dx = 0): [number, Pose] => [ms, { x: x + dx, y, s: 1, o }];
      out.push({ el, w, h: w, flip: i % 2 === 1, keys: [at(0, 0), at(t - 1, 0), at(t, 0.9), at(t + 60, 0.2), at(t + 90, 0.8, 6 * k), at(t + 150, 0, 8 * k),
        at(t + 329, 0, 8 * k), at(t + 330, 0.85, 8 * k), at(t + 400, 0.15, 10 * k), at(t + 470, 0, 12 * k)] });
    });
    // 側邊分叉雷：主擊那一刻在落點兩側一起劈下（錯開 25ms），閃兩下就散
    els("tfork").forEach(({ el, i }) => {
      const sd = i % 2 ? 1 : -1, x = sd * (0.22 + 0.1 * (i % 3)) * u, y = -u * (0.15 + 0.08 * (i % 4)), t = 1120 + i * 25, w = u * 0.42;
      const at = (ms: number, o: number, s: number): [number, Pose] => [ms, { x, y, s, o }];
      out.push({ el, w, h: w, flip: sd < 0, keys: [at(0, 0, 0.9), at(t - 5, 0, 0.9), at(t, 1, 0.9), at(t + 50, 0.3, 0.95), at(t + 80, 0.9, 1), at(t + 170, 0, 1.05)] });
    });
    // 電漿火花：主擊從落點炸開一批、牌炸出來（1.42）再一批，往外飛、變大、淡掉
    const sp = els("tspark");
    sp.forEach(({ el, i }) => {
      const a = (i / sp.length) * Math.PI * 2 + 0.3, t = i % 2 ? 1420 : 1120, R = u * (0.3 + 0.1 * (i % 3)), w = u * 0.24;
      const at = (f: number, s: number, o: number): Pose => ({ x: Math.cos(a) * R * f, y: Math.sin(a) * R * f * 0.75, s, o });
      out.push({ el, w, h: w, rot: (a * 180) / Math.PI + 45, keys: [[0, at(0.05, 0.5, 0)], [t - 5, at(0.05, 0.5, 0)], [t + 30, { ...at(0.2, 0.8, 1), e: "cubic-bezier(.15,.7,.35,1)" }],
        [t + 380 + (i % 4) * 60, at(1, 1.1, 0)]] });
    });
    // 接地電弧：主擊後在落點周圍的地面一直劈啪（閃爍、慢慢往外爬），2.6 秒前淡掉
    const arcs = els("tarc");
    arcs.forEach(({ el, i }) => {
      const a = (i / arcs.length) * Math.PI * 2, r = u * (0.22 + 0.06 * (i % 3)), w = u * 0.36, t = 1140 + i * 40;
      const at = (f: number, o: number): Pose => ({ x: Math.cos(a) * r * f, y: Math.sin(a) * r * f * 0.42, s: 1, sy: 0.6, o });
      out.push({ el, w, h: w, flip: Math.cos(a) < 0, keys: [[0, at(1, 0)], [t - 5, at(1, 0)], [t, at(1, 0.9)], [t + 120, at(1.05, 0.3)], [t + 200, at(1.08, 0.85)],
        [t + 520, at(1.15, 0.5)], [t + 620, at(1.18, 0.8)], [2600, at(1.3, 0)]] });
    });
    // 殘留電流：大字出來以後，牌四周偶爾冒一下小電流（低密度，不擋大字和名字）
    els("tres").forEach(({ el, i }) => {
      const a = i * 2.4 + 0.5, r = u * (0.2 + 0.05 * (i % 3)), x = Math.cos(a) * r, y = Math.sin(a) * r * 0.6, w = u * 0.2, t = 1850 + i * 170;
      const at = (ms: number, o: number): [number, Pose] => [ms, { x, y, s: 1, o }];
      out.push({ el, w, h: w * 0.8, flip: i % 2 === 1, keys: [at(0, 0), at(t - 1, 0), at(t, 0.7), at(t + 80, 0), at(t + 600, 0), at(t + 601, 0.6), at(t + 680, 0), at(3220, 0)] });
    });
  } else if (fx === "frost") {
    // 冰封補細節層（同上清單）：主擊 1.08、碎裂＋牌 1.30、時間軸不動，只加層
    // 霜脈：主擊前從落點往桌面四周蔓延（0.4～1.0 秒），主擊後慢慢退掉。圖的根在左下、往右上長 → 依方向轉一次，根對著落點
    const vein = els("fvein");
    vein.forEach(({ el, i }) => {
      const a = (i / vein.length) * Math.PI * 2 + 0.2, r = u * (0.32 + 0.08 * (i % 3)), w = u * 0.34;
      const at = (f: number, s: number, o: number): Pose => ({ x: Math.cos(a) * r * 0.55 * f, y: Math.sin(a) * r * 0.55 * f * 0.75, s, o });
      out.push({ el, w, h: w * 1.03, rot: (a * 180) / Math.PI + 35, keys: [[0, at(0.3, 0.3, 0)], [400 + i * 40, at(0.3, 0.3, 0)], [1000, at(1, 1, 0.85)], [1080, at(1, 1.02, 1)],
        [1300, at(1.05, 1.04, 0.6)], [1600, at(1.1, 1.05, 0)]] });
    });
    // 冰槍碎屑：刺中那一刻（1.08）從槍尖往外爆
    const spl = els("fspl");
    spl.forEach(({ el, i }) => {
      const a = (i / spl.length) * Math.PI * 2 + 0.6, R = u * (0.3 + 0.08 * (i % 4)), w = u * 0.2;
      const at = (f: number, s: number, o: number): Pose => ({ x: Math.cos(a) * R * f, y: Math.sin(a) * R * f * 0.75, s, o });
      out.push({ el, w, h: w * 0.98, rot: (a * 180) / Math.PI + 45, keys: [[0, at(0.04, 0.4, 0)], [1075, at(0.04, 0.4, 0)], [1110, { ...at(0.25, 0.9, 1), e: "cubic-bezier(.15,.7,.35,1)" }],
        [1450, at(0.9, 1, 0.8)], [1650, at(1, 1, 0)]] });
    });
    // 裂紋節點：凍住以後、碎掉以前分批亮起（1.10～1.29），1.30 碎裂時一亮就散（黑底，screen）
    const cr = els("fcrack");
    cr.forEach(({ el, i }) => {
      const a = (i / cr.length) * Math.PI * 2 + 0.4, r = u * (0.15 + 0.07 * (i % 3)), x = Math.cos(a) * r, y = Math.sin(a) * r * 0.6, w = u * 0.3;
      const t = 1100 + Math.round((i * 140) / cr.length); // 分批亮起，全部在 1.24 秒前亮完（之後還要停在 1.29）
      out.push({ el, w, h: w, flip: i % 2 === 1, keys: [[0, { x, y, s: 0.6, o: 0 }], [t, { x, y, s: 0.6, o: 0 }], [t + 40, { x, y, s: 1, o: 0.9 }], [1290, { x, y, s: 1.02, o: 1 }],
        [1320, { x, y, s: 1.15, o: 1 }], [1480, { x, y, s: 1.25, o: 0 }]] });
    });
    // 近景冰晶：碎裂（1.30）時往鏡頭飛過來：越飛越大、往畫面邊散開
    const cry = els("fcry");
    cry.forEach(({ el, i }) => {
      const a = (i / cry.length) * Math.PI * 2 + 1.1, R = u * (0.55 + 0.1 * (i % 3)), w = u * 0.22;
      const at = (f: number, s: number, o: number): Pose => ({ x: Math.cos(a) * R * f, y: Math.sin(a) * R * f * 0.7, s, o });
      out.push({ el, w, h: w * 0.98, rot: (a * 180) / Math.PI + 45, keys: [[0, at(0.05, 0.6, 0)], [1295, at(0.05, 0.6, 0)], [1330, { ...at(0.15, 0.9, 1), e: "cubic-bezier(.3,.4,.6,1)" }],
        [1750, at(1, 2.2, 0)]] });
    });
    // 冷霧：主擊後地面一團團冷霧各自往旁邊飄，收尾時淡掉
    els("fmist").forEach(({ el, i }) => {
      const x0 = (i - 1.5) * u * 0.35, y = u * 0.12, w = u * 0.5, dx = (i % 2 ? 1 : -1) * u * 0.08;
      out.push({ el, w, h: w * 0.945, flip: i % 2 === 1, keys: [[0, { x: x0, y, s: 0.7, o: 0 }], [1080, { x: x0, y, s: 0.7, o: 0 }], [1300, { x: x0, y, s: 1, o: 0.6 }],
        [2400, { x: x0 + dx, y, s: 1.1, o: 0.45 }], [2900, { x: x0 + dx * 1.3, y, s: 1.15, o: 0 }]] });
    });
  }
  return out;
}
/**
 * fx：哪一種；seat：自摸的人（絕對座位）；name：自摸者名字（完整版的「自摸」大字下面）；mySeat：我的座位（決定視角；觀戰者傳目前視角的座位）；
 * tile：自摸的那張牌（完整版：主擊後才從落點炸出來，停在那裡）。
 * warm：預熱（components/mahjong/fxWarmUp.tsx）：不出聲、不震、不攔點擊，看不見的狀態把整條時間軸一格一格走一遍，走完 onDone(false)
 */
export default function ZimoFx({ fx, seat, mySeat, mobile, tile, name = "", onDone, warm, embedded = false, sound = true }: {
  fx: ZimoFxNew; seat: number; mySeat: number; mobile: boolean; tile: Tile | null | undefined; name?: string; onDone: (skipped: boolean) => void; warm?: WarmMode;
  /** 設定頁預覽用：限制在自己的手機牌桌容器，不能影響正式牌桌。 */
  embedded?: boolean; sound?: boolean;
}) {
  const rm = useReducedMotion();
  const art = (f: string) => (warm ? warmImg(f) : `${ART}/${fx}/${f}.webp`);
  const bg = (f: string) => ({ backgroundImage: `url("${art(f)}")` });
  const ref = useRef<HTMLDivElement>(null);
  const doneRef = useRef(onDone);
  useLayoutEffect(() => { doneRef.current = onDone; });
  const ended = useRef(false);
  const stopRef = useRef(() => {});
  const rel = (((seat - mySeat) % 4) + 4) % 4; // 0 自己、1 下家、2 對家、3 上家

  // 畫面出來前量好主角位置和尺寸；碎片、花瓣的軌跡用 Web Animations 直接給算好的數字；同一刻排好牌桌震動
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const box = embedded ? root.getBoundingClientRect() : null;
    const W = box?.width || innerWidth, H = box?.height || innerHeight;
    const u = Math.min(H, W * 0.62);
    // 落點：勝者名牌朝桌心那一邊再往內偏一點（同隕石）；量不到名牌就用畫面中央偏向那一邊
    const off = (mobile ? 20 : 32) + H * 0.12;
    const scope = embedded ? root.parentElement : document;
    const plate = scope?.querySelector(`[data-fx-seat="${seat}"]`)?.getBoundingClientRect();
    let px: number, py: number;
    if (plate && plate.width > 0) {
      const origin = embedded ? root.getBoundingClientRect() : { left: 0, top: 0 };
      const cx = plate.left + plate.width / 2 - origin.left, cy = plate.top + plate.height / 2 - origin.top;
      const hand = rel === 0 ? scope?.querySelector("[data-mj-myhand]")?.getBoundingClientRect() : undefined;
      // 對家：名牌在那一家整列（名牌＋花＋手牌）的左邊，水平落點取整列的中心，才會落在對家正前方（老闆 2026-10-31：對家自摸偏左）
      const row = rel === 2 ? scope?.querySelector(`[data-fx-seat-row="${seat}"]`)?.getBoundingClientRect() : undefined;
      const topX = row && row.width > 0 ? row.left + row.width / 2 - origin.left : cx;
      [px, py] = rel === 2 ? [topX, plate.bottom - origin.top + off] : rel === 3 ? [plate.right - origin.left + off, cy] : rel === 1 ? [plate.left - origin.left - off, cy]
        : hand && hand.width > 0 ? [hand.left - origin.left + hand.width / 2, hand.top - origin.top - off * 0.5] : [cx, plate.top - origin.top - off];
    } else {
      [px, py] = [W / 2 + SIDE[rel][0] * W * 0.22, H / 2 + SIDE[rel][1] * H * 0.2];
    }
    px = Math.min(Math.max(px, W * 0.12), W * 0.88); py = Math.min(Math.max(py, H * 0.22), H * 0.82);
    const set = (k: string, v: number) => root.style.setProperty(k, `${Math.round(v)}px`);
    set("--W", W); set("--H", H); set("--u", u); set("--px", px); set("--py", py);
    const tileW = mobile ? 46 : 76, tileH = tileW * 1.36;
    set("--tw", tileW); set("--th", tileH);
    {
      root.style.setProperty("--tt", `${ZFX_TL[fx].tile}ms`);
      // 「自摸／名字」放畫面正中央；會擋到牌就讓開（小宜 v3 規格 2）：左右家先往反方向水平偏 min(5vw, 56px)，還擋到就和上下家一樣
      // 牌在中線下面就往上、反之往下；字和牌至少留手機 10px、桌機 16px
      // 大字圖高 1.2em（em＝字級，和原本字型版同一個字級）、寬照圖的長寬比；名字在下面
      const fs = Math.min(202, Math.max(92, W * 0.14)), artH = fs * ZIMO_TITLE_EM;
      const textH = artH + (mobile ? 6 + 29 : 10 + 37), textW = artH * ZIMO_TITLE_AR[fx], gap = mobile ? 10 : 16, edge = mobile ? 4 : 16;
      let zx = W / 2, zy = H / 2 - textH / 2;
      const tl = px - tileW / 2 - gap, tr = px + tileW / 2 + gap, tt = py - tileH / 2 - gap, tb = py + tileH / 2 + gap;
      const hits = (x: number, y: number) => y < tb && y + textH > tt && x - textW / 2 < tr && x + textW / 2 > tl;
      if (hits(zx, zy) && (rel === 1 || rel === 3)) zx += (px > W / 2 ? -1 : 1) * Math.min(W * 0.05, 56);
      if (hits(zx, zy)) zy = py >= H / 2 ? tt - textH : tb;
      zy = Math.min(Math.max(zy, edge), H - textH - edge);
      set("--zx", zx); set("--zy", zy);
    }
    // 冰封的冰槍：從勝者那一側的畫面外刺向落點，斜 30 度進來（勝者靠畫面邊時，落點到邊只剩一小段，正面刺進來只看得到槍尖）。
    // 圖本身是直的、槍尖朝下，依視角固定轉一次，動態只有沿槍身的位移；起點＝沿反方向剛好出畫面再多一整支槍長
    if (fx === "frost") {
      const sl = u * 1.15, sw = sl * (551 / 1200);
      set("--sl", sl); set("--sw", sw);
      const r = [180, 90, 0, -90][rel] + 30;
      root.style.setProperty("--sr", `${r}deg`);
      const rad = (r * Math.PI) / 180, tx = -Math.sin(rad), ty = Math.cos(rad); // 槍尖朝向（前進方向）
      const back = Math.min(tx > 0 ? px / tx : tx < 0 ? (W - px) / -tx : Infinity, ty > 0 ? py / ty : ty < 0 ? (H - py) / -ty : Infinity);
      set("--sd", back + sl * 1.05);
    }
    // 零件（風暴、黑洞、櫻花 v4；雷霆、冰封的補細節層）：先給尺寸；減少動態只留標 data-rmk 的那一個定格
    const total = zfxTotal(fx);
    const parts = v4Parts(fx, root, { W, H, u, px, py, rel, mobile });
    if (rm) { runParts(parts, total, true); return; }
    const anims: Animation[] = runParts(parts, total, false);
    const ease = "cubic-bezier(.15, .7, .35, 1)";
    // 冰封的碎冰（雷霆沒有碎片；風暴、黑洞、櫻花用上面的 v4 零件）
    root.querySelectorAll<HTMLElement>("[data-zf-bit]").forEach((el, i) => {
      const b = BITS[i % BITS.length];
      const R = u * b.r * 0.95;
      const x = Math.cos(b.a) * R, y = Math.sin(b.a) * R * 0.75;
      const at = (k: number, r: number, sc: number, dy = 0) => `translate(${(x * k).toFixed(1)}px, ${(y * k + dy).toFixed(1)}px) rotate(${r.toFixed(0)}deg) scale(${sc.toFixed(3)})`;
      // 冰封：冰面碎掉那一刻（1.30 秒）碎冰從落點彈開，飛出去後慢慢淡掉
      const T1 = ZFX_TL.frost.tile / total;
      const kf: Keyframe[] = [{ offset: 0, opacity: 0, transform: at(0, 0, 0.3) }, { offset: T1 - 0.005, opacity: 0, transform: at(0, 0, 0.3) },
        { offset: T1, opacity: 1, transform: at(0.08, 0, b.s * 1.3), easing: ease },
        { offset: T1 + 0.22, opacity: 0.9, transform: at(1, b.spin, b.s * 0.9) },
        { offset: Math.min(1, T1 + 0.36), opacity: 0, transform: at(1.12, b.spin * 1.2, b.s * 0.6) }, { offset: 1, opacity: 0, transform: at(1.12, b.spin * 1.2, b.s * 0.6) }];
      anims.push(el.animate(kf, { duration: total, fill: "both" }));
    });
    const stage = warm || embedded ? null : document.querySelector<HTMLElement>("[data-mt-stage]");
    const release = stage ? holdStage(stage, STAGE_SHADOW) : null;
    // 風暴 v5：主擊那一下畫面順著風被推一下（0 → 6px → -4px → 0，120ms，不旋轉）；其他照原本的震動（櫻花不震）
    const wd = stormWind(rel);
    if (stage && fx === "storm") anims.push(stage.animate([{ transform: "none" }, { transform: `translate(${(wd.x * 6).toFixed(1)}px, ${(wd.y * 6).toFixed(1)}px)` },
      { transform: `translate(${(-wd.x * 4).toFixed(1)}px, ${(-wd.y * 4).toFixed(1)}px)` }, { transform: "none" }], { duration: 120, delay: boomOf(fx), easing: "linear" }));
    else if (stage && fx !== "sakura") anims.push(...shakeStage(stage, mobile, true, boomOf(fx)));
    // 黑洞：主擊前整個牌桌被往落點吸過去（縮到 0.94）
    if (stage && fx === "blackhole") stage.style.transformOrigin = `${Math.round(px)}px ${Math.round(py)}px`;
    if (stage && fx === "blackhole") anims.push(stage.animate([{ transform: "none" }, { transform: "scale(0.94)", offset: 0.9 }, { transform: "none" }], { duration: HIT, easing: "ease-in" }));
    return () => { anims.forEach((a) => a.cancel()); release?.(); };
  }, [fx, mobile, rm, warm, embedded, seat, rel]);

  // 跳過：點畫面任一處、Enter、Space（同隕石：0.5 秒內補上的 click 吃掉，不會按到結算浮層的按鈕）
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
      document.querySelector<HTMLElement>("[data-mt-stage]")?.getAnimations().forEach((a) => a.cancel());
      doneRef.current(true);
    };
    document.addEventListener("pointerdown", skip, true);
    document.addEventListener("keydown", skip, true);
    return () => { document.removeEventListener("pointerdown", skip, true); document.removeEventListener("keydown", skip, true); };
  }, [warm, embedded]);

  // 播放：聲音對齊動畫真正開始那一刻；手機震動在主擊；時間到 onDone(false)（之後還掛著，只留暗幕）
  useEffect(() => {
    let alive = true;
    if (warm) {
      const root = ref.current;
      if (root) void stepPlay(root, zfxTotal(fx), { alive: () => alive, stageShadow: STAGE_SHADOW }).then(() => { if (alive) doneRef.current(false); });
      return () => { alive = false; };
    }
    const ts: ReturnType<typeof setTimeout>[] = [];
    const anim = ref.current?.querySelector(".zf-dim")?.getAnimations()[0];
    // 專屬音效（阿妍）：檔案 0 秒＝特效開始那一格，從動畫真正開始那一刻對齊放；跳過、換局、離開時（下面的清除）停掉
    const hit = hitOf(fx);
    const go = (z: number | null) => {
      if (!alive || ended.current) return;
      stopRef.current = playZimoFxSound(fx, z, hit);
    };
    if (sound) {
      if (anim && !rm) void anim.ready.then(() => go(typeof anim.startTime === "number" ? anim.startTime : null), () => go(null));
      else go(null);
    }
    ts.push(setTimeout(() => { if (!ended.current) { ended.current = true; doneRef.current(false); } }, rm ? OWN_RM : zfxTotal(fx)));
    if (!rm && fx !== "sakura") ts.push(setTimeout(() => { if (typeof navigator.vibrate === "function") navigator.vibrate([110, 50, 40]); }, boomOf(fx)));
    return () => { alive = false; ts.forEach(clearTimeout); stopRef.current(); };
  }, [fx, rm, warm, sound]);

  const sprite = (f: string, n: number, cols: number, rows: number) => Array.from({ length: n }, (_, i) => (
    <span key={i} className="zf-bit" data-zf-bit style={{ ...bg(f), backgroundSize: `${cols * 100}% ${rows * 100}%`,
      backgroundPosition: `${((BITS[i].f % cols) / (cols - 1)) * 100}% ${(Math.floor((BITS[i].f % (cols * rows)) / cols) / (rows - 1)) * 100}%` }} />
  ));
  const n = mobile ? 8 : 12;
  /** v4 零件：精靈表第 c 格；kind＋i 對到 v4Parts 的時間軸；rmk＝減少動態時留下來定格的那一個 */
  const part = (kind: string, f: string, cols: number, rows: number, i: number, c: number, rmk = false) => (
    <i key={`${kind}${i}`} className="zp" data-zp={kind} data-i={i} data-rmk={rmk || undefined} style={{ ...bg(f), backgroundSize: `${cols * 100}% ${rows * 100}%`,
      backgroundPosition: `${cols > 1 ? ((c % cols) / (cols - 1)) * 100 : 0}% ${rows > 1 ? (Math.floor(c / cols) / (rows - 1)) * 100 : 0}%` }} />
  );

  // 三層（同一個 z，照順序疊）：①暗幕＋一般圖層 ②黑底圖用 screen 和底下整個畫面疊 ③碎片、牌、白閃
  let base: React.ReactNode = null, blend: React.ReactNode = null, top: React.ReactNode = null, front: React.ReactNode = null;
  if (fx === "thunder") {
    base = <>
      <i className="zt-clouds" style={bg("thunder-clouds")} />
      {[0, 1, 2, 3].map((k) => <i key={k} className={`zt-fork f${k}`} style={{ ...bg("thunder-forks"), backgroundSize: "300% 200%", backgroundPosition: `${[0, 50, 100, 50][k]}% ${[0, 100, 0, 0][k]}%` }} />)}
      <i className="zt-web" style={bg("thunder-web")} />
      <i className="zt-bolt" style={bg("thunder-bolt")} />
    </>;
    blend = <>
      <i className="zt-flash" style={bg("thunder-flash")} />
      {/* 牌從劈中的地方炸出來那一下的電光（1.42 秒） */}
      <i className="zt-pop" style={bg("thunder-flash")} />
      {/* 補細節層（黑底，screen）：雲內爬電、側邊分叉雷、電漿火花、接地電弧、殘留電流 */}
      {Array.from({ length: mobile ? 5 : 6 }, (_, i) => part("tcrawl", "thunder-cloud-crawl", 3, 2, i, i % 6))}
      {Array.from({ length: mobile ? 6 : 9 }, (_, i) => part("tfork", "thunder-side-forks", 4, 3, i, i % 12))}
      {Array.from({ length: mobile ? 10 : 14 }, (_, i) => part("tspark", "thunder-plasma-sparks", 4, 4, i, i % 16))}
      {Array.from({ length: mobile ? 6 : 8 }, (_, i) => part("tarc", "thunder-ground-arcs", 4, 2, i, i % 8))}
      {Array.from({ length: mobile ? 5 : 8 }, (_, i) => part("tres", "thunder-residual-current", 5, 2, i, i % 10))}
    </>;
  } else if (fx === "storm") {
    // v5 零件（位置、時間軸在 v4Parts）：漏斗外殼、內環 → 中層氣流帶 → 地面水霧 → 風牆 → 斜雨；速度線、衝擊環用 screen；碎石在最上層
    const nr = mobile ? 3 : 4;
    base = <>
      {[0, 1, 2, 3, 4, 5].map((i) => part("shell", "storm-v5-funnel-shells", 3, 2, i, i, i === 2))}
      {[0, 2, 1, 3].map((c, i) => part("band", "storm-funnel-bands", 2, 2, i, c))}
      {Array.from({ length: mobile ? 3 : 6 }, (_, i) => part("ribbon", "storm-air-ribbons", 4, 2, i, (i * 3) % 8))}
      {part("spray", "storm-v5-ground-spray", 4, 1, 0, 0)}
      {[0, 1, 2].map((i) => <i key={`wall${i}`} className="zp" data-zp="wall" data-i={i} style={bg("storm-v5-wind-wall")} />)}
      {/* 斜雨：遠（淡的格子）、中、近（密的格子）三層，每層 nr 條 */}
      {Array.from({ length: nr * 3 }, (_, i) => part("rain", "storm-v5-rain-debris", 4, 2, i, Math.floor(i / nr) === 0 ? [1, 3, 5, 7][i % 4] : [0, 2, 4, 6][(i + Math.floor(i / nr)) % 4], Math.floor(i / nr) === 1 && i % nr === 0))}
    </>;
    blend = <>
      <i className="zs-floor b"><i className="zs-blast" style={bg("storm-blast")} /></i>
      {Array.from({ length: mobile ? 1 : 2 }, (_, i) => <i key={`lines${i}`} className="zp" data-zp="lines" data-i={i} style={bg("storm-v5-speed-lines")} />)}
    </>;
    front = Array.from({ length: mobile ? 5 : 8 }, (_, i) => part("rock", "storm-rocks-single", 4, 3, i, (i * 5) % 12));
  } else if (fx === "frost") {
    base = <>
      <i className="zr-edges" style={bg("frost-edges")} />
      <i className="zr-mist" style={bg("frost-mist")} />
      {/* 主擊那一刻整桌瞬凍：冰色罩＋從落點鋪開的冰面 */}
      <i className="zr-freeze" />
      <i className="zr-sheet-w"><i className="zr-sheet" style={bg("frost-sheet")} /></i>
      <i className="zr-spikes" style={bg("frost-spikes")} />
      <i className="zr-spear-w"><i className="zr-spear" style={bg("frost-spear")} /></i>
      {/* 補細節層：霜脈、冷霧、冰槍碎屑、近景冰晶 */}
      {Array.from({ length: mobile ? 8 : 10 }, (_, i) => part("fvein", "frost-veins-branches", 5, 2, i, i % 10))}
      {[0, 1, 2, 3].map((i) => part("fmist", "frost-cold-mist-puffs", 4, 1, i, i))}
      {Array.from({ length: mobile ? 8 : 12 }, (_, i) => part("fspl", "frost-spear-splinters", 5, 2, i, i % 10))}
      {Array.from({ length: mobile ? 4 : 6 }, (_, i) => part("fcry", "frost-spear-splinters", 5, 2, i, (i + 3) % 10))}
    </>;
    // 裂紋節點（黑底，screen）
    blend = <>{Array.from({ length: mobile ? 6 : 8 }, (_, i) => part("fcrack", "frost-crack-junctions", 4, 2, i, i % 8))}</>;
    top = sprite("frost-shards", n, 4, 2);
  } else if (fx === "blackhole") {
    // 分層照 v4 規格 6：後景星塵 → 吸積盤後層 → 暗核 → 吸積盤前層 → 光流、碎片 → 近黑停頓；黑底的白點、超新星、能量絲用 screen
    base = <>
      {Array.from({ length: mobile ? 10 : 16 }, (_, i) => part("stardust", "blackhole-stardust", 4, 2, i, i % 8))}
      <i className="zp" data-zp="disk-back" data-i={0} style={bg("blackhole-accretion-back")} />
      <i className="zp" data-zp="core" data-i={0} style={bg("blackhole-core")} />
      <i className="zp" data-zp="disk-front" data-i={0} style={bg("blackhole-accretion-front")} />
      {Array.from({ length: mobile ? 16 : 22 }, (_, i) => part("stream", "blackhole-light-streams", 5, 2, i, i % 10))}
      {Array.from({ length: mobile ? 20 : 28 }, (_, i) => part("debris", "blackhole-debris-single", 4, 4, i, i % 16))}
      <i className="zp zb-void" data-zp="void" data-i={0} />
    </>;
    blend = <>
      <i className="zp" data-zp="pin" data-i={0} style={bg("blackhole-pinpoint")} />
      <i className="zp" data-zp="nova" data-i={0} style={bg("blackhole-nova")} />
      {[0, 1, 2, 3].map((i) => part("fila", "blackhole-nova-filaments", 4, 1, i, i, i === 0))}
    </>;
  } else {
    // 樹枝 → 遠、中景花瓣 → 花苞、開花、噴流 → 近景花瓣；光陣用 screen
    const pet = Array.from({ length: mobile ? 8 : 12 }, (_, i) => i);
    base = <>
      {/* 上家、下家：樹枝從畫面邊長到落點；自己、對家：不長樹枝，原地開花加金色光環、花瓣環繞 */}
      {rel % 2 === 1 && part("branch", "sakura-branch-growth", 5, 1, 0, 0)}
      {pet.filter((i) => i % 3 < 2).map((i) => part("petal", "sakura-petal-clusters", 4, 3, i, i % 12))}
      <i className="zp" data-zp="bud" data-i={0} style={bg("sakura-bud")} />
      {part("bloom", "sakura-bud-opening", 3, 2, 0, 0, true)}
      {Array.from({ length: 8 }, (_, i) => part("burst", "sakura-impact-petal-burst", 4, 2, i, i))}
      {pet.filter((i) => i % 3 === 2).map((i) => part("petal", "sakura-petal-clusters", 4, 3, i, i % 12))}
      {rel % 2 === 0 && Array.from({ length: 8 }, (_, i) => part("orbit", "sakura-petal-clusters", 4, 3, i, (i * 5) % 12))}
    </>;
    blend = <>
      <i className="zp" data-zp="halo" data-i={0} style={bg("sakura-halo")} />
      {rel % 2 === 0 && <i className="zp" data-zp="ring" data-i={0} style={bg("sakura-halo")} />}
    </>;
  }

  return (
    <div ref={ref} className={`zfw ${embedded ? "embed" : ""} zf-${fx} side-${rel} own ${mobile ? "m" : "d"} ${rm ? "rm" : ""}`} data-zf={fx} data-zf-seat={seat} data-zf-rel={rel} aria-hidden>
      <div className="zf-l">
        <div className="zf-dim" />
        {base}
      </div>
      {blend && <div className="zf-l zf-blend">{blend}</div>}
      <div className="zf-l">
        {top && <div className="zf-at">{top}</div>}
        {front}
        {tile && (
          <div className="zf-tile" data-zf-tile>
            <div className="zf-tile-in">
              <i className="zf-aura" />
              <MjTile tile={tile} width="var(--tw)" height="var(--th)" />
            </div>
          </div>
        )}
        {/* 這一種專屬的「自摸」大字＋名字，取代金色自摸浮層 */}
        <ZimoTitle fx={fx} name={name} t={ZFX_TL[fx].zimo} n={ZFX_TL[fx].name} rm={rm} mobile={mobile} wind={fx === "storm" ? Math.sign(stormWind(rel).x) : SIDE[rel][0] > 0 ? -1 : 1} src={art(`${fx}-title`)} />
        <div className="zf-flash" />
      </div>
    </div>
  );
}
