// 如來神掌 v4 斜角（小宜〈如來神掌 v4 斜角〉；老闆 2026-11-06：要看得出手從天上壓下來）。單一畫布，畫面只由時間決定（draw(ms)），沒有 Web Animation、CSS filter、每格 shadowBlur。
// 立體感都是 2D：手切成條帶，靠近鏡頭的條帶放得更大（warp）；牌桌只有一層 CSS 傾斜（特效本身不傾斜，落點用 rulaiProject 算）。手、雲是老闆 2026-11-06 生的圖，掌形凹陷由 scripts/gen-rulai-v4-assets.mjs 從手本體產生。
// 圖層（下到上）：影子／氣壓 → 裂縫 → 掌形凹陷 → 凹陷光 → 天光 → 手（殘影、本體、裂紋光） → 雲 → 噴光 → 塵雲 → 光波 → 碎片 → 飛牌 → 金屑 → 閃光。
import { clamp, frameGovernor, inC, lerp, outC, rng, seg, sm, type SakuraEls, type SakuraGeo, sakuraStillPose } from "./canvasFx";

export const RULAI_TL = { clouds: 350, part: 850, emerge: 700, rush: 1500, hit: 1700, tile: 2320, zimo: 2660, name: 2900, total: 4200 };
/** 這幾張依裝置選一組（順序固定，ZimoFx 照這個順序載） */
export const RULAI_ART = ["hand-v5", "clouds-v5", "crater-v5", "fissures-v5", "fis-glow-v5", "light-jets", "light-rays", "rubble", "dust"] as const; // 長期快取：換內容就換檔名（v5＝2026-11-06 統一換名，之前同名換過內容）
export type RulaiArt = (typeof RULAI_ART)[number];
/** 手的大小只調這個：砸中時手長＝u × 這個數字（u＝min(畫面高, 畫面寬×0.62)），老闆看了再調 */
export const RULAI_HAND_SCALE = 1.02;
/** 手機／電腦上限：畫布倍率、金屑、飛牌、碎石、塵雲、噴光（手機合計 110）、手的條帶數、暫代雲和凹陷的尺寸 */
export const RULAI_LIMIT = {
  mobile: { dpr: 1.5, gold: 64, fly: 14, rubble: 12, dust: 10, jets: 10, strips: 40 },
  desktop: { dpr: 2, gold: 150, fly: 20, rubble: 20, dust: 14, jets: 16, strips: 70 },
} as const;
/** 減少動態：畫這一刻的靜止畫面（手已化開，凹陷、裂縫都亮著，沒有閃光） */
export const RULAI_STILL_MS = 2600;
const STILL_END = 620;
const SQ = 0.54; // 地面效果壓扁，和牌桌傾斜一致
const DEPTH = [1, 0.88, 0.74, 0.88];
/**
 * 手照實際方向（老闆 2026-11-06）：胡牌的人往前拍下去，自己看指尖朝上；對家看指尖朝下；上家、下家看手是橫的、指尖指向畫面中間。
 * 左右家（老闆 2026-11-06：太橫）改成約 45° 斜下：手從胡牌者那一側的上角進場，指尖斜指向桌心和落點。
 * 自己、對家是 90° 的倍數，條帶邊界對齊像素；左右家斜放、透視幾乎為 0，所以整張手一次畫完，沒有條帶也就沒有接縫。
 * PERSP＝條帶透視的方向（自己看掌根近、對家看指尖近、左右家幾乎沒有）
 */
export const RULAI_SIDE_DEG = 45; // 左右家手的斜度（指尖往下偏離水平幾度），35～50 之間微調
const SIDE = (RULAI_SIDE_DEG * Math.PI) / 180;
const HAND_ROT = [0, -Math.PI / 2 - SIDE, Math.PI, Math.PI / 2 + SIDE];
const PERSP = [1, 0.05, -0.7, 0.05]; // 座位越遠，手和地面效果都越小（自己、下家、對家、上家）
const TILT_DEG = 15;
const perspOf = (W: number) => (W > 1000 ? 2200 : 1200);

/** 牌桌傾斜後，平面座標會落在畫面哪裡（落點、牌、大字都要用傾斜後的位置） */
export function rulaiProject(X: number, Y: number, W: number, H: number): [number, number] {
  const a = (TILT_DEG * Math.PI) / 180, yb = H - Y, d = perspOf(W), f = d / (d + yb * Math.sin(a));
  return [W / 2 + (X - W / 2) * f, H - yb * Math.cos(a) * f];
}
/** 牌桌傾斜（度）：開場壓低進斜角，砸中被壓一下（慢慢回），收尾回平 */
export function rulaiTilt(ms: number) {
  const t = RULAI_TL, base = TILT_DEG * sm(seg(ms, 0, 620)) * (1 - sm(seg(ms, t.total - 700, t.total)));
  return base + (ms > t.hit ? 3.5 * Math.pow(1 - seg(ms, t.hit, t.hit + 500), 2) : 0);
}
/** 暗幕（播到結束都留著，結算才不會先亮一下） */
export const rulaiDim = (ms: number) => 0.46 * sm(seg(ms, 0, 400)) + 0.34 * sm(seg(ms, 400, RULAI_TL.rush));
/** 牌、大字的整體透明度 */
export const rulaiFadeOut = (ms: number) => 1 - sm(seg(ms, RULAI_TL.total - 360, RULAI_TL.total));
/** 鏡頭：伸手時慢慢推近，猛衝再推一下，砸中後回原位 */
export const rulaiCam = (ms: number) => { const t = RULAI_TL; return 1 + 0.025 * sm(seg(ms, t.emerge, t.rush)) + 0.05 * sm(seg(ms, t.rush, t.hit)) + 0.03 * sm(seg(ms, t.hit, t.hit + 50)) - 0.105 * sm(seg(ms, t.hit + 80, t.hit + 800)); };
/** 牌桌震動（手機主擊 11px、電腦 19px；1.98 餘震；大字蓋章小震 3px） */
export function rulaiShake(ms: number, mobile: boolean): [number, number] {
  const t = RULAI_TL, d = ms - t.hit, m = mobile ? 1 : 1.7;
  if (d < 0) { const tr = seg(ms, 1000, t.rush) * 0.9 * m + seg(ms, t.rush, t.hit) * 1.4 * m; return [Math.sin(ms * 0.19) * tr, Math.cos(ms * 0.23) * tr]; }
  const amp = 11 * m * Math.pow(1 - seg(d, 0, 640), 2) + 4 * m * Math.sin(seg(d, 280, 560) * Math.PI) + 3 * m * Math.sin(seg(ms, t.zimo, t.zimo + 180) * Math.PI);
  return amp <= 0.02 ? [0, 0] : [Math.sin(d * 0.11) * amp * 0.55, Math.cos(d * 0.135) * amp];
}
/** 牌從凹陷中央彈起 */
export function rulaiTilePose(ms: number) {
  const a = seg(ms, RULAI_TL.tile, RULAI_TL.tile + 200);
  return { opacity: a, transform: a >= 1 ? "none" : `scale(${(0.4 + 0.6 * outC(a) + 0.14 * Math.sin(a * Math.PI)).toFixed(3)})` };
}
/** 大字像蓋章砸下；暗底提早慢慢壓暗（老闆 2026-11-06：銜接卡卡），字出來時背後已經暗了，不會一下子跳暗 */
export function rulaiTitlePose(ms: number) {
  const z = seg(ms, RULAI_TL.zimo, RULAI_TL.zimo + 130);
  return { art: { opacity: z, transform: z >= 1 ? "none" : `scale(${(1.7 - 0.7 * z * z * z).toFixed(3)})` }, back: sm(seg(ms, RULAI_TL.zimo - 300, RULAI_TL.zimo + 40)), name: seg(ms, RULAI_TL.name, RULAI_TL.name + 260) };
}

function mk(w: number, h: number) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
type Src = HTMLImageElement | HTMLCanvasElement;
const widthOf = (i: Src) => (i as HTMLImageElement).naturalWidth || i.width;
const heightOf = (i: Src) => (i as HTMLImageElement).naturalHeight || i.height;
function bakeGlow(size: number, stops: readonly (readonly [number, string])[]) {
  const c = mk(size, size), x = c.getContext("2d")!, g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([o, col]) => g.addColorStop(o, col));
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  return c;
}
const FLY_W = 96, FLY_H = 132; // 一格飛牌（比例同牌）
/** 被震飛的牌：牌桌同一套牌面（牌面在 ZimoFx 跟著素材載；還沒好或載壞就是白牌，不等）＋牌背，開播時烘一次 */
export const RULAI_FACES = ["Chun", "Hatsu", "Man1"] as const;
function bakeFly(faces: readonly HTMLImageElement[], back: readonly [string, string, string]) {
  const c = mk(FLY_W * 4, FLY_H), x = c.getContext("2d")!;
  const r = FLY_H * 0.08, card = (X: number, stops: readonly string[]) => {
    const g = x.createLinearGradient(0, 0, 0, FLY_H); stops.forEach((col, i) => g.addColorStop(i / (stops.length - 1), col)); x.fillStyle = g;
    x.beginPath(); x.roundRect(X + 1, 1, FLY_W - 2, FLY_H - 2, r); x.fill();
  };
  for (let i = 0; i < 3; i++) {
    card(i * FLY_W, ["#fff", "#f3efe4"]);
    const f = faces[i];
    if (f?.complete && f.naturalWidth > 0) { const k = Math.min((FLY_W - 8) / f.naturalWidth, (FLY_H - 8) / f.naturalHeight), w = f.naturalWidth * k, h = f.naturalHeight * k; x.drawImage(f, i * FLY_W + (FLY_W - w) / 2, (FLY_H - h) / 2, w, h); }
  }
  card(3 * FLY_W, back);
  return c;
}

/** 左右家用的雲：縮小烘一張，上、左兩邊（原圖有雲碰到圖邊）淡到 0，斜放也不會露出直邊。480×320，約 0.6 MB，播完放掉 */
function bakeSideCloud(cloud: Src) {
  const w = 480, h = 320, c = mk(w, h), x = c.getContext("2d")!;
  x.drawImage(cloud, 0, 0, w, h);
  x.globalCompositeOperation = "destination-out";
  const gl = x.createLinearGradient(0, 0, w * 0.32, 0); gl.addColorStop(0, "rgba(0,0,0,1)"); gl.addColorStop(1, "rgba(0,0,0,0)"); x.fillStyle = gl; x.fillRect(0, 0, w * 0.32, h);
  const gt = x.createLinearGradient(0, 0, 0, h * 0.2); gt.addColorStop(0, "rgba(0,0,0,1)"); gt.addColorStop(1, "rgba(0,0,0,0)"); x.fillStyle = gt; x.fillRect(0, 0, w, h * 0.2);
  x.globalCompositeOperation = "source-over";
  return c;
}
type Pose = { X: number; Y: number; sc: number; a: number };
type WarpOpt = { n?: number; lighter?: boolean; alpha?: number; strip?: ((m: number) => number) | null };

export class RulaiCanvas {
  private x: CanvasRenderingContext2D;
  private dpr: number;
  private art: Partial<Record<RulaiArt, HTMLImageElement>>;
  private baked: HTMLCanvasElement[];
  private fly: HTMLCanvasElement; private spark: HTMLCanvasElement; private gl: HTMLCanvasElement; private wave: HTMLCanvasElement; private shadow: HTMLCanvasElement;
  private sideCloud: HTMLCanvasElement | null = null; private hx: number; private hy: number; private pk = 1; private slant = false; private lx = 0; private ly = 0; private la = Math.PI / 2; private sx = 0; private sy = 0; private rot: number; private base: number; private D: number; private strips: number;
  private gold: { i: number; a: number; sp: number; s: number; ph: number; fx: number; fy: number; sway: number }[];
  private flys: { a: number; r0: number; R: number; up: number; spin: number; rot: number; fl: number; ph: number; big: number; face: boolean }[];
  private rubs: { a: number; R: number; up: number; s: number; spin: number; rot: number; ph: number; k: number }[];
  private dusts: { a: number; R: number; s: number; ph: number; k: number }[];
  private jets: { X: number; Y: number; d: number; ph: number; k: number; sz: number }[];
  private press: { a: number; sp: number; o: number; l: number }[];
  /** 粒子比例（自動降級：只減金屑，其他突然少一半看得出來） */
  scale = 1;
  /** 這一格畫了幾個粒子（驗收用） */
  lastCount = 0;
  constructor(private cv: HTMLCanvasElement, private g: SakuraGeo, art: Record<RulaiArt, HTMLImageElement>, devicePixelRatio: number, faces: readonly HTMLImageElement[] = [], back: readonly [string, string, string] = ["#4a8a5a", "#2a6038", "#1a4828"]) {
    const L = g.mobile ? RULAI_LIMIT.mobile : RULAI_LIMIT.desktop, { u, W, H, px, py, rel } = g, D = DEPTH[rel];
    this.dpr = Math.min(devicePixelRatio || 1, L.dpr);
    cv.width = Math.round(W * this.dpr); cv.height = Math.round(H * this.dpr);
    this.x = cv.getContext("2d")!;
    this.art = art; this.D = D; this.strips = L.strips;
    this.fly = bakeFly(faces, back);
    this.spark = bakeGlow(48, [[0, "rgba(255,255,235,1)"], [0.2, "rgba(255,226,130,.95)"], [0.55, "rgba(255,170,50,.3)"], [1, "rgba(255,150,30,0)"]]);
    this.gl = bakeGlow(256, [[0, "rgba(255,250,225,1)"], [0.25, "rgba(255,212,110,.7)"], [0.6, "rgba(255,160,40,.16)"], [1, "rgba(255,140,20,0)"]]);
    this.wave = bakeGlow(256, [[0, "rgba(255,230,160,0)"], [0.62, "rgba(255,226,150,0)"], [0.84, "rgba(255,240,195,.8)"], [0.93, "rgba(255,200,100,.22)"], [1, "rgba(255,180,60,0)"]]);
    this.shadow = bakeGlow(256, [[0, "rgba(0,0,0,.92)"], [0.6, "rgba(0,0,0,.6)"], [1, "rgba(0,0,0,0)"]]);
    if (rel % 2 === 1) this.sideCloud = bakeSideCloud(art["clouds-v5"]);
    this.baked = [...(this.sideCloud ? [this.sideCloud] : []), this.fly, this.spark, this.gl, this.wave, this.shadow];
    // 雲洞在畫面中央和落點的中間；手一律從雲洞往落點來，指尖朝畫面下方
    this.hx = lerp(W / 2, px, 0.55); this.hy = -H * 0.02;
    this.rot = HAND_ROT[rel]; this.pk = PERSP[rel];
    // 光從哪裡下來、往哪裡照：自己、對家從雲洞往下；左右家從胡牌者那一側的上角，沿著手下來的方向
    const fx = Math.sin(this.rot), fy = -Math.cos(this.rot); // 指尖方向
    this.slant = rel % 2 === 1;
    if (this.slant) { this.lx = rel === 1 ? W * 0.94 : W * 0.06; this.ly = H * 0.02; this.la = Math.atan2(fy, fx); this.sx = px - fx * u * 1.1; this.sy = py - fy * u * 1.1; }
    else { this.lx = this.hx; this.ly = H * 0.02; this.la = Math.PI / 2; this.sx = this.hx; this.sy = this.hy; }
    this.base = u * RULAI_HAND_SCALE * D;
    const r = rng(1908 + rel), TAU = 6.283;
    // 順序不能改：四家、重播都一樣
    this.gold = Array.from({ length: L.gold }, (_, i) => ({ i, a: r() * TAU, sp: 0.35 + r() * 1.05, s: u * (0.008 + r() * 0.018), ph: r(), fx: r(), fy: r(), sway: r() * 6.28 }));
    this.flys = Array.from({ length: L.fly }, () => ({ a: r() * TAU, r0: u * (0.1 + r() * 0.25), R: u * (0.45 + r() * 0.75) * D, up: u * (0.3 + r() * 0.6) * D, spin: (r() - 0.5) * 12, rot: r() * 6.28, fl: 2 + r() * 5, ph: r(), big: 0.8 + r() * 0.7, face: r() < 0.55 }));
    this.rubs = Array.from({ length: L.rubble }, (_, i) => ({ a: r() * TAU, R: u * (0.35 + r() * 0.8) * D, up: u * (0.2 + r() * 0.55) * D, s: u * (0.024 + r() * 0.03) * D, spin: (r() - 0.5) * 9, rot: r() * 6.28, ph: r(), k: i % 12 }));
    this.dusts = Array.from({ length: L.dust }, (_, i) => ({ a: (i / L.dust) * TAU + r() * 0.3, R: u * (0.5 + r() * 0.55) * D, s: u * (0.3 + r() * 0.3) * D, ph: r(), k: i % 4 }));
    this.jets = Array.from({ length: L.jets }, (_, i) => { const a = (i / L.jets) * TAU + r() * 0.4, d = 0.16 + r() * 0.8; return { X: Math.cos(a) * d * u * 1.15 * D, Y: Math.sin(a) * d * u * 0.5 * D, d, ph: r(), k: i % 4, sz: (0.2 + r() * 0.22) * (1 - 0.25 * d) }; });
    this.press = Array.from({ length: 20 }, (_, i) => ({ a: (i / 20) * TAU + r() * 0.25, sp: 0.8 + r() * 0.9, o: r(), l: 0.1 + r() * 0.16 }));
  }
  /** 收尾：放掉畫布記憶體和圖片參照 */
  destroy() {
    this.cv.width = 0; this.cv.height = 0;
    for (const c of this.baked) { c.width = 0; c.height = 0; }
    this.art = {};
    this.gold = []; this.flys = []; this.rubs = []; this.dusts = []; this.jets = []; this.press = [];
  }
  /** 開播前把所有圖先畫一次（第一次畫才真的解碼、上傳）；畫完清掉，這時畫面還沒開始動 */
  prime() {
    const t = RULAI_TL;
    for (const ms of [t.emerge + 300, t.rush + 100, t.hit + 60, t.hit + 400, t.zimo + 100]) this.draw(ms);
    this.x.getImageData(0, 0, 1, 1);
    this.x.setTransform(1, 0, 0, 1, 0, 0); this.x.clearRect(0, 0, this.cv.width, this.cv.height);
    this.lastCount = 0;
  }
  /** 手的姿態（時間 → 位置、大小、透視強度 a） */
  private pose(ms: number): Pose {
    const t = RULAI_TL, { hx, hy, base } = this, { px, py } = this.g;
    let k: number, a: number, sc: number;
    // 指尖朝上：手指在手掌上方，手掌要低一點手指才進得了畫面；新手圖本身已畫透視，條帶透視只補一點（太大會變形）
    const k0 = 0.3, k1 = 0.62, a0 = 0.08, a1 = 0.12, a2 = 0.24;
    if (ms < t.rush) { const f = sm(seg(ms, t.emerge, t.rush)); k = lerp(k0, k1, f); sc = lerp(0.6, 0.84, f); a = lerp(a0, a1, f); }
    else if (ms < t.hit) { const f = inC(seg(ms, t.rush, t.hit)); k = lerp(k1, 1, f); sc = lerp(0.84, 1.26, f); a = lerp(a1, a2, f); }
    else { const f = outC(seg(ms, t.hit, t.hit + 70)); sc = lerp(1.26, 1, f); a = lerp(a2, 0.08, f); k = 1; }
    return this.slant ? { X: lerp(this.sx, px, k), Y: lerp(this.sy, py, k), sc, a } : { X: lerp(hx, px, k), Y: lerp(hy - base * sc * 0.1, py, k), sc, a };
  }
  /** 條帶透視：一張圖切成 N 條，越靠近鏡頭的條帶越寬越高。沒有 3D，只有 drawImage */
  private warp(img: Src, P: Pose, opt: WarpOpt = {}) {
    const { x, dpr } = this, N = opt.n ?? this.strips, a = P.a * this.pk || 1e-4, base = this.base * P.sc, iw = widthOf(img), ih = heightOf(img), W0 = (base * iw) / ih;
    const lenF = (y: number) => -Math.log(1 - a * y) / a, total = lenF(1), sAt = (y: number) => 1 / (1 - a * y), palmAt = 0.62, sMid = sAt(palmAt), palm = lenF(palmAt) / total;
    if (this.slant) {
      // 斜放：透視幾乎為 0，整張一次畫完（沒有條帶就沒有接縫）；化光用平均透明度
      const cs = Math.cos(this.rot), sn = Math.sin(this.rot), al = (opt.alpha ?? 1) * (opt.strip ? opt.strip(0.5) : 1);
      if (al <= 0.004) return;
      x.setTransform(cs * dpr, sn * dpr, -sn * dpr, cs * dpr, P.X * dpr, P.Y * dpr);
      if (opt.lighter) x.globalCompositeOperation = "lighter";
      x.globalAlpha = al; x.drawImage(img, -W0 / 2, -palm * base, W0, base);
      x.setTransform(dpr, 0, 0, dpr, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = "source-over";
      return;
    }
    const c = Math.round(Math.cos(this.rot)), s = Math.round(Math.sin(this.rot));
    // y＝0 指尖、y＝1 掌根。條帶的上下邊都落在整數像素、不重疊、同一個透明度：中間不會出現細橫紋
    x.setTransform(c * dpr, s * dpr, -s * dpr, c * dpr, Math.round(P.X * dpr), Math.round(P.Y * dpr));
    if (opt.lighter) x.globalCompositeOperation = "lighter";
    const edge = (y: number) => Math.round((lenF(y) / total - palm) * base * dpr) / dpr;
    for (let i = 0; i < N; i++) {
      const y0 = i / N, y1 = (i + 1) / N, m = (y0 + y1) / 2, Y0 = edge(y0), Y1 = edge(y1), w = W0 * (sAt(m) / sMid);
      if (Y1 <= Y0) continue;
      const al = (opt.alpha ?? 1) * (opt.strip ? opt.strip(m) : 1);
      if (al <= 0.004) continue;
      x.globalAlpha = al;
      x.drawImage(img, 0, y0 * ih, iw, (y1 - y0) * ih, -w / 2, Y0, w, Y1 - Y0);
    }
    x.setTransform(dpr, 0, 0, dpr, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = "source-over";
  }
  /**
   * 左右家的雲（老闆 2026-11-06）：雲的厚處在手腕那一側（畫面角落），撕裂口和雷光邊朝手指方向打開，手指從裂口最前端衝出；
   * 雲以手的路徑為軸，左右對稱兩片，手衝出時往兩側推開，砸中後被衝散。用開播時烘的羽化小圖（上、左兩邊淡出），任何角度都不會露出雲圖的直邊。
   */
  private drawSideCloud(cloud: Src, ms: number, cIn: number, open: number, blast: number, cFade: number) {
    const { x, dpr, sideCloud } = this, { W, u, px, py } = this.g, t = RULAI_TL;
    if (!sideCloud) return;
    const iw = sideCloud.width, ih = sideCloud.height, fx = Math.sin(this.rot), fy = -Math.cos(this.rot), N = Math.atan2(0.9 * iw, 0.88 * ih); // N＝撕裂口朝外的方向（原圖朝右下）
    const phi = -N, c = Math.cos(phi), s = Math.sin(phi), cw = W * 0.95 * (1 + 0.15 * blast), ch = (cw * ih) / iw, tx = 0.45 * cw, ty = 0.44 * ch;
    const back = u * (0.35 + 0.5 * (1 - cIn) + 0.25 * blast), qx = px - fx * back, qy = py - fy * back; // 撕裂口中心在手的路徑上、手腕那一側
    const g = u * (0.02 + 0.07 * open + 0.2 * inC(seg(ms, t.rush, t.hit)) + 0.3 * blast); // 往兩側推開
    x.globalAlpha = cFade * (1 - blast * 0.5);
    for (const side of [1, -1]) {
      const a = fx * c - fy * s * side, b = fy * c + fx * s * side, cc = -fx * s - fy * c * side, d = -fy * s + fx * c * side;
      x.setTransform(a * dpr, b * dpr, cc * dpr, d * dpr, (qx - fy * g * side) * dpr, (qy + fx * g * side) * dpr);
      x.drawImage(sideCloud, -tx, -ty, cw, ch);
    }
    // 另一角：小、淡，只陪襯（原圖的上、左兩邊在畫面外）
    const fw = W * 0.3, fh = (fw * heightOf(cloud)) / widthOf(cloud), mir = fx < 0; // 下家手往左下，陪襯的雲在左上角
    x.globalAlpha = cFade * 0.42 * (1 - blast * 0.6);
    if (mir) x.setTransform(dpr, 0, 0, dpr, 0, 0); else x.setTransform(-dpr, 0, 0, dpr, W * dpr, 0);
    x.drawImage(cloud, -fw * (0.28 + 0.25 * blast), lerp(-fh, -fh * 0.2, cIn) - blast * fh * 0.4, fw, fh);
    x.setTransform(dpr, 0, 0, dpr, 0, 0); x.globalAlpha = 1;
  }
  draw(ms: number) {
    const { x, dpr, art, spark, gl, wave, fly, shadow, D } = this, { W, H, u, px, py } = this.g, tl = RULAI_TL, t = ms / 1000, hit = tl.hit, A = ms - hit, S = this.scale;
    const hand = art["hand-v5"], cloud = art["clouds-v5"], crater = art["crater-v5"], fis = art["fissures-v5"], fisG = art["fis-glow-v5"], jets = art["light-jets"], rays = art["light-rays"], rubble = art.rubble, dust = art.dust;
    if (!hand || !cloud || !crater || !fis || !fisG || !jets || !rays || !rubble || !dust) return; // 已經收尾
    let count = 0;
    const reset = () => { x.setTransform(dpr, 0, 0, dpr, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = "source-over"; };
    reset(); x.clearRect(0, 0, W, H);
    const fade = 1 - sm(seg(ms, tl.total - 600, tl.total));
    // ---- 地面（砸中前：影子、氣壓；影子砸中後再淡掉，不跟著閃光突然消失） ----
    if (ms < hit + 220) {
      const f = sm(seg(ms, tl.emerge, tl.rush)), ra = u * lerp(1.2, 0.72, f) * D * (ms > tl.rush ? lerp(1, 0.62, inC(seg(ms, tl.rush, hit))) : 1);
      x.globalAlpha = sm(seg(ms, 500, 1100)) * lerp(0.45, 0.9, f) * (1 - seg(A, 0, 220)); x.drawImage(shadow, px - ra, py - ra * SQ, ra * 2, ra * 2 * SQ); reset();
    }
    if (ms < hit) {
      const pr = sm(seg(ms, 700, 1200));
      if (pr > 0) { x.lineCap = "round"; x.strokeStyle = "#ffe9b8"; x.lineWidth = Math.max(1, u * 0.0035); for (const p of this.press) { const fp = (t * p.sp * (ms > tl.rush ? 3 : 1.5) + p.o) % 1, R0 = u * (1.2 - fp * 0.9) * D, Lp = u * p.l; x.globalAlpha = pr * 0.3 * Math.sin(fp * Math.PI); x.beginPath(); x.moveTo(px + Math.cos(p.a) * R0, py + Math.sin(p.a) * R0 * SQ); x.lineTo(px + Math.cos(p.a) * (R0 + Lp), py + Math.sin(p.a) * (R0 + Lp) * SQ); x.stroke(); } reset(); }
    }
    // ---- 地面（砸中後：裂縫、凹陷）。裂縫連續長大、不停頓；三波靠亮度起伏（老闆 2026-11-06：一段一段放大看起來卡） ----
    if (ms >= hit) {
      const a0 = seg(A, 0, 60) * fade, fh = u * 2.7 * D, fw = (fh * widthOf(fis)) / heightOf(fis), cSink = sm(seg(ms, tl.zimo - 300, tl.zimo + 400));
      const bump = (a: number, b: number) => Math.sin(seg(A, a, b) * Math.PI), pulse = 1 + 0.45 * bump(0, 300) + 0.4 * bump(200, 560) + 0.35 * bump(480, 960);
      const gs = 0.42 + 0.58 * outC(seg(A, 0, 900)), gw = fw * gs, gh = fh * SQ * gs;
      x.globalCompositeOperation = "lighter";
      x.globalAlpha = Math.min(1, a0 * 0.6 * pulse * (1 - 0.62 * cSink)); x.drawImage(fis, px - gw / 2, py - gh / 2, gw, gh);
      const peak = sm(seg(A, 300, 760)) * (1 - 0.75 * cSink); x.globalAlpha = a0 * (0.05 + 0.16 * peak) * (0.85 + 0.15 * Math.sin(t * 7)); x.drawImage(fisG, px - gw / 2, py - gh / 2, gw, gh); reset();
      const stamp: Pose = { X: px, Y: py, sc: 1, a: 0.08 };
      this.warp(crater, stamp, { alpha: sm(seg(A, 20, 240)) * fade * 0.94, n: 16 });
      const lit = sm(seg(A, 280, 720));
      if (lit > 0) this.warp(crater, stamp, { lighter: true, alpha: lit * 0.5 * fade * (1 - 0.3 * cSink) * (0.86 + 0.14 * Math.sin(ms / 240)), n: 12 });
    }
    // ---- 天光（在雲的後面） ----
    const cIn = sm(seg(ms, 0, tl.clouds)), open = sm(seg(ms, tl.clouds, tl.part)), blast = ms > hit ? outC(seg(A, 0, 700)) : 0, cFade = fade * (1 - 0.75 * seg(ms, hit + 300, tl.total - 800));
    if (open > 0) {
      const R = u * (0.45 + 0.75 * open), hy = this.ly, hx = this.lx, rw = widthOf(rays) / 2, rh = heightOf(rays) / 2, shaftA = open * (1 - sm(seg(A, 0, 500))) * fade;
      x.globalCompositeOperation = "lighter"; x.globalAlpha = open * cFade * lerp(0.95, 0.5, sm(seg(A, 0, 400))); x.drawImage(gl, hx - R * 1.2, hy - R * 0.9, R * 2.4, R * 1.9);
      if (shaftA > 0) for (let i = 0; i < 7; i++) { const an = this.la + (i - 3) * 0.24 + 0.03 * Math.sin(t * 1.7 + i), Ls = u * (1.05 + 0.25 * Math.sin(i * 3.1)) * (0.6 + 0.4 * open), wd = u * (0.13 + 0.03 * (i % 3)), c2 = Math.cos(an), s2 = Math.sin(an); x.setTransform(c2 * dpr, s2 * dpr, -s2 * dpr, c2 * dpr, hx * dpr, hy * dpr); x.globalAlpha = shaftA * 0.55; x.drawImage(rays, (i % 2) * rw, (i % 4 >> 1) * rh, rw, rh, 0, -wd / 2, Ls, wd); }
      reset();
    }
    // ---- 手：不抬手，砸中後從掌根往指尖化成金光 ----
    if (ms >= tl.emerge - 80 && ms < hit + 560) {
      const emergeA = sm(seg(ms, tl.emerge - 80, tl.emerge + 220)), P = this.pose(ms);
      if (ms >= tl.rush && ms < hit) { const f0 = seg(ms, tl.rush, hit); for (const [lag, al] of [[0.42, 0.2], [0.26, 0.3], [0.12, 0.42]] as const) this.warp(hand, this.pose(tl.rush + (hit - tl.rush) * clamp(f0 - lag * 0.5)), { lighter: true, alpha: al, n: 10 }); }
      const dis = seg(A, 110, 540), strip = ms >= hit + 110 ? (m: number) => 1 - sm(clamp(dis * 1.7 - (1 - m) * 0.7)) : null;
      this.warp(hand, P, { alpha: emergeA, strip });
      const crL = ms < tl.rush ? 0.12 + 0.2 * seg(ms, tl.emerge, tl.rush) : ms < hit ? 0.32 + 0.4 * seg(ms, tl.rush, hit) : 0.72;
      this.warp(hand, P, { lighter: true, alpha: Math.min(1, crL) * 0.45 * emergeA, strip, n: 12 }); // 老闆的手本身就有透光裂紋，疊一層讓它越衝越亮
      if (ms >= hit) this.warp(hand, P, { lighter: true, alpha: (1 - seg(A, 30, 460)) * 0.32, strip, n: 12 });
    }
    // ---- 雲（蓋住手的遠端，手像是從雲裡伸出來）；雲只有半邊，鏡射畫另一半 ----
    if (cFade > 0 && this.slant) this.drawSideCloud(cloud, ms, cIn, open, blast, cFade);
    else if (cFade > 0) {
      const cw = W * 0.68 * (1 + blast * 0.15), ch = (cw * heightOf(cloud)) / widthOf(cloud), // 照原圖比例，不拉伸
        ox = W * 0.01 + (W * 0.15 + W * 0.3 * blast) * open, oy = lerp(-ch, 0, cIn) - blast * H * 0.22, cx = this.slant ? W / 2 : this.hx; // 左右家：雲留在兩個上角，手從胡牌者那側的雲後面伸出來
      x.globalAlpha = cFade * (1 - blast * 0.55); x.drawImage(cloud, cx - ox - cw, oy, cw, ch);
      x.setTransform(-dpr, 0, 0, dpr, (cx + ox) * dpr, 0); x.drawImage(cloud, -cw, oy, cw, ch); reset();
    }
    // ---- 砸中後的立體層：噴光往上、塵雲、光波、碎片、飛牌、金屑、閃光 ----
    if (ms >= hit) {
      x.globalCompositeOperation = "lighter";
      const jc = widthOf(jets) / 2, jr = heightOf(jets) / 2;
      for (const j of this.jets) {
        const t0 = hit + 140 + j.d * 620 + j.ph * 180, p = seg(ms, t0, t0 + 860), q = seg(ms, hit + 650 + j.ph * 300, hit + 1500 + j.ph * 400), en = Math.max(p > 0 && p < 1 ? Math.sin(p * Math.PI) : 0, q > 0 && q < 1 ? Math.sin(q * Math.PI) * 0.75 : 0) * fade;
        if (en <= 0) continue;
        const z = u * j.sz * D * (0.75 + en * 0.55) * (1 + 0.03 * Math.sin(t * 9 + j.ph * 7)); x.globalAlpha = en; x.drawImage(jets, (j.k % 2) * jc, (j.k >> 1) * jr, jc, jr, px + j.X - z * 0.75, py + j.Y - z * 1.28, z * 1.5, z * 1.5); count++;
      }
      const dc = widthOf(dust) / 2, dr = heightOf(dust) / 2;
      for (const d of this.dusts) { const p = seg(A, d.ph * 60, 800 + d.ph * 380); if (p <= 0 || p >= 1) continue; const R = d.R * outC(p), z = d.s * (0.6 + p * 1.05); x.globalAlpha = (1 - p) * sm(clamp(p / 0.12)) * 0.4 * fade; x.drawImage(dust, (d.k % 2) * dc, (d.k >> 1) * dr, dc, dr, px + Math.cos(d.a) * R - z, py + Math.sin(d.a) * R * SQ - z * 0.7 - p * u * 0.1, z * 2, z * 1.4); count++; }
      // 光波：軟邊、由小變大、淡入淡出（不是一出現就全亮的圈）
      for (const [d0, R0, Dw, al] of [[0, 2, 760, 0.8], [130, 1.4, 820, 0.5]] as const) { const g = seg(A, d0, d0 + Dw); if (g <= 0 || g >= 1) continue; const r = u * R0 * outC(g) * D; x.globalAlpha = (1 - sm(g)) * sm(clamp(g / 0.1)) * al; x.drawImage(wave, px - r, py - r * SQ, r * 2, r * 2 * SQ); }
      reset();
      const rc = widthOf(rubble) / 4;
      for (const b of this.rubs) { const dl = b.ph * 90, p = seg(A, dl, dl + 700 + b.ph * 320); if (A < dl || p >= 1) continue; const R = b.R * outC(p), X = px + Math.cos(b.a) * R, Y = py + Math.sin(b.a) * R * SQ - Math.sin(p * Math.PI) * b.up, sc = b.s * (1 + 0.8 * Math.sin(p * Math.PI)), rt = b.rot + b.spin * p, c2 = Math.cos(rt), s2 = Math.sin(rt); x.setTransform(c2 * dpr, s2 * dpr, -s2 * dpr, c2 * dpr, X * dpr, Y * dpr); x.globalAlpha = (1 - p * p) * fade; x.drawImage(rubble, (b.k % 4) * rc, Math.floor(b.k / 4) * rc, rc, rc, -sc, -sc, sc * 2, sc * 2); count++; }
      for (const f of this.flys) {
        const dl = f.ph * 70, p = seg(A, dl, dl + 720 + f.big * 280), op = fade * (1 - seg(ms, tl.zimo + 500, tl.total - 500));
        if (A < dl || op <= 0) continue;
        const R = f.r0 + f.R * outC(p), arc = Math.sin(Math.min(p, 1) * Math.PI), X = px + Math.cos(f.a) * R, gy = py + Math.sin(f.a) * R * SQ, sc = u * 0.07 * D * (1 + 0.55 * arc) * f.big * (gy > py ? 1.15 : 0.9), rot = f.rot + f.spin * outC(p), flv = p < 1 ? Math.cos(p * f.fl * 3.14) : 1, sqz = 0.3 + 0.7 * Math.abs(flv), c2 = Math.cos(rot), s2 = Math.sin(rot);
        x.setTransform(c2 * dpr, s2 * dpr, -s2 * sqz * dpr, c2 * sqz * dpr, X * dpr, (gy - arc * f.up) * dpr); x.globalAlpha = op; x.drawImage(fly, (f.face === flv > 0 ? Math.floor(f.ph * 3) : 3) * FLY_W, 0, FLY_W, FLY_H, -sc * 0.36, -sc / 2, sc * 0.72, sc); count++;
      }
      reset();
      x.globalCompositeOperation = "lighter";
      for (const g of this.gold) {
        if (g.i % 10 >= 10 * S) continue;
        const dl = g.ph * 90, p = seg(A, dl, dl + 700 + g.sp * 240);
        if (A < dl) continue;
        const R = u * g.sp * D * 1.1 * outC(p);
        if (p < 1) { x.globalAlpha = (1 - p * p) * 0.9; const r = g.s * (1.4 - p * 0.6); x.drawImage(spark, px + Math.cos(g.a) * R * 1.25 - r, py + Math.sin(g.a) * R * SQ - p * u * 0.22 - r, r * 2, r * 2); count++; }
        else if (g.i % 2 === 0) { const q = seg(ms, hit + 300 + g.ph * 600, tl.total + 200); if (q > 0) { const r = g.s * (0.9 + q * 0.5); x.globalAlpha = Math.sin(Math.PI * q) * 0.85 * fade; x.drawImage(spark, px + Math.cos(g.a) * u * 0.62 * g.fx * D + Math.sin(t * 1.4 + g.sway) * u * 0.02 - r, py + Math.sin(g.a) * u * 0.24 * g.fy - q * u * 0.55 - r, r * 2, r * 2); count++; } }
      }
      const tg = sm(seg(ms, tl.tile - 60, tl.tile + 160)) * fade;
      if (tg > 0) { x.globalAlpha = 0.85 * tg; const R = u * 0.32 * D; x.drawImage(gl, px - R, py - R, R * 2, R * 2); }
      reset();
      const fl = seg(A, 0, 100);
      if (fl < 1) { x.globalAlpha = (1 - fl) * 0.86; x.fillStyle = "#fff6d8"; x.fillRect(0, 0, W, H); reset(); }
    }
    this.lastCount = count;
  }
}

/**
 * 播一次如來神掌：回傳 stop（跳過、卸載時呼叫，可重複呼叫）。全程只有一個 requestAnimationFrame 迴圈，播完或 stop 就放掉畫布、圖片，牌桌傾斜復原。
 * board＝牌桌本體（只有它傾斜；聊天面板、特效層不跟著斜）；stage＝震動和鏡頭推近的那一層。
 */
export function runRulai(els: SakuraEls & { board?: NonNullable<SakuraEls["stage"]> | null }, g: SakuraGeo, art: Record<RulaiArt, HTMLImageElement>, o: { dpr: number; rm: boolean; zeroAt: () => number; stageShadow: string; faces?: readonly HTMLImageElement[]; back?: readonly [string, string, string]; raf?: (f: (now: number) => void) => number; caf?: (id: number) => void }) {
  const raf = o.raf ?? requestAnimationFrame, caf = o.caf ?? cancelAnimationFrame;
  const { dim, tile, tileIn, title, art: artEl, back, name, stage, board, cv } = els;
  const fx = new RulaiCanvas(cv, g, art, o.dpr, o.faces, o.back);
  let id = 0, stopped = false, moved = false;
  const setOp = (e: { style: Partial<CSSStyleDeclaration> } | null | undefined, v: number) => { if (e) e.style.opacity = v.toFixed(3); };
  const clearStage = () => { if (stage) { stage.style.transform = ""; stage.style.boxShadow = ""; stage.style.transformOrigin = ""; moved = false; } if (board) { board.style.transform = ""; board.style.transformOrigin = ""; } };
  const stop = () => { if (stopped) return; stopped = true; caf(id); clearStage(); fx.destroy(); };
  if (!o.rm) fx.prime();
  // 時間零點在試畫之後：試畫花的時間不算進特效，聲音也從這裡對齊
  const zeroAt = o.zeroAt();
  if (o.rm) {
    fx.draw(RULAI_STILL_MS);
    const step = (now: number) => {
      if (stopped) return;
      const ms = now - zeroAt, p = sakuraStillPose(ms);
      setOp(cv as unknown as { style: Partial<CSSStyleDeclaration> }, p.base); setOp(dim, 0.8 * p.base); setOp(tileIn, p.main); setOp(artEl, p.main); setOp(back, p.main); setOp(name, p.name);
      if (ms < STILL_END) id = raf(step);
    };
    id = raf(step);
  } else {
    const gov = frameGovernor();
    let last = zeroAt;
    if (stage) stage.style.transformOrigin = `${Math.round(g.px)}px ${Math.round(g.py)}px`;
    if (board) board.style.transformOrigin = "50% 100%";
    const step = (now: number) => {
      if (stopped) return;
      const ms = now - zeroAt;
      fx.scale = gov(now - last);
      last = now;
      if (ms >= RULAI_TL.total) { setOp(tile, 0); setOp(title, 0); clearStage(); fx.destroy(); return; }
      fx.draw(ms);
      setOp(dim, rulaiDim(ms));
      const pose = rulaiTilePose(ms), t = rulaiTitlePose(ms), fo = rulaiFadeOut(ms);
      if (tileIn) { tileIn.style.opacity = pose.opacity.toFixed(3); tileIn.style.transform = pose.transform; }
      if (artEl) { artEl.style.opacity = t.art.opacity.toFixed(3); artEl.style.transform = t.art.transform; }
      setOp(back, t.back); setOp(name, t.name); setOp(tile, fo); setOp(title, fo);
      if (board) board.style.transform = `perspective(${perspOf(g.W)}px) rotateX(${rulaiTilt(ms).toFixed(2)}deg)`;
      if (stage) {
        const [sx, sy] = rulaiShake(ms, g.mobile), cam = rulaiCam(ms);
        if (sx || sy || Math.abs(cam - 1) > 1e-4) { stage.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) scale(${cam.toFixed(4)})`; stage.style.boxShadow = o.stageShadow; moved = true; }
        else if (moved) { stage.style.transform = ""; stage.style.boxShadow = ""; moved = false; }
      }
      id = raf(step);
    };
    id = raf(step);
  }
  return { stop };
}
