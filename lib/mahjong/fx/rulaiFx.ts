// 如來神掌的單一畫布引擎（小宜〈如來神掌 v3 金光裂紋〉；老闆 2026-11-05 定案，老闆帳號專屬）。
// 畫面只由時間決定（draw(ms)），沒有 Web Animation、CSS filter、每格 shadowBlur、每顆一個 DOM（同櫻花紛飛，見 canvasFx.ts）。
// 圖層（下到上）：手影 → 手後金光 → 凹陷 → 裂縫 → 裂縫光暈 → 噴光 → 掌印 → 飛牌 → 碎石 → 塵雲 → 手 → 透光裂紋 → 光波 → 金屑 → 閃光。
// 素材由 scripts/gen-rulai-assets.mjs 從老闆的原圖產生（比例、錨點、噴光點在 rulaiMeta.ts）；光暈、手影、金屑、飛牌開播時才烘。
import { clamp, frameGovernor, inC, lerp, outC, rng, seg, sm, type SakuraEls, type SakuraGeo, sakuraStillPose } from "./canvasFx";
import { RULAI_META } from "./rulaiMeta";

export const RULAI_TL = { press: 450, lift: 1050, slam: 1380, hit: 1500, reveal: 1880, tile: 2300, zimo: 2620, name: 2860, total: 4200 };
/** 這幾張依裝置選一組（順序固定，ZimoFx 照這個順序載） */
export const RULAI_ART = ["hand", "hand-cracks", "print", "fissures", "fis-glow", "light-jets", "light-rays", "rubble", "dust"] as const;
export type RulaiArt = (typeof RULAI_ART)[number];
/** 手機／電腦上限：畫布倍率、金屑、飛牌、碎石、塵雲、噴光（手機合計 110） */
export const RULAI_LIMIT = {
  mobile: { dpr: 1.5, gold: 64, fly: 14, rubble: 12, dust: 10, jets: 10 },
  desktop: { dpr: 2, gold: 150, fly: 20, rubble: 20, dust: 14, jets: 16 },
} as const;
/** 減少動態：畫這一刻的靜止畫面（手已抬起，掌印、裂縫都亮著，沒有閃光） */
export const RULAI_STILL_MS = 2500;
const STILL_END = 620;
const SQ = 0.84; // 俯視壓扁
const { x: AX, y: AY } = RULAI_META.handAnchor;
const AR = RULAI_META.handAR;
const BEAM = 3; // 光束格子長寬比（照原圖，不拉伸）

/** 手的高度倍率：抬高變大、砸下變小 */
export function rulaiHandScale(ms: number) {
  const t = RULAI_TL;
  if (ms < t.press) return 1.75;
  if (ms < t.lift) return lerp(1.75, 1.14, sm(seg(ms, t.press, t.lift)));
  if (ms < t.slam) return lerp(1.14, 2.45, sm(seg(ms, t.lift, t.slam)));
  if (ms < t.hit) return lerp(2.45, 1.03, inC(seg(ms, t.slam, t.hit)));
  if (ms < t.hit + 90) return 1.03;
  if (ms < t.reveal) return lerp(1.03, 1, seg(ms, t.hit + 90, t.reveal));
  return lerp(1, 1.7, sm(seg(ms, t.reveal, t.reveal + 430)));
}
/** 暗幕（播到結束都留著，結算才不會先亮一下） */
export const rulaiDim = (ms: number) => 0.46 * sm(seg(ms, 0, 500)) + 0.34 * sm(seg(ms, 500, RULAI_TL.slam));
/** 牌、大字的整體透明度 */
export const rulaiFadeOut = (ms: number) => 1 - sm(seg(ms, RULAI_TL.total - 360, RULAI_TL.total));
/** 鏡頭：蓄力時慢慢推近，砸中再推一下，之後回原位（只大於 1，不會露出牌桌外） */
export const rulaiCam = (ms: number) => { const t = RULAI_TL; return 1 + 0.05 * sm(seg(ms, t.lift, t.slam)) + 0.045 * sm(seg(ms, t.hit, t.hit + 50)) - 0.095 * sm(seg(ms, t.hit + 70, t.hit + 760)); };
/** 牌桌震動（手機主擊 10px、電腦 17px；1.78 餘震；大字蓋章小震 3px） */
export function rulaiShake(ms: number, mobile: boolean): [number, number] {
  const t = RULAI_TL, d = ms - t.hit;
  if (d < 0) { const tr = seg(ms, t.lift, t.slam) * (mobile ? 0.8 : 1.3); return [Math.sin(ms * 0.19) * tr, Math.cos(ms * 0.23) * tr]; }
  const m = mobile ? 1 : 1.7, amp = 10 * m * Math.pow(1 - seg(d, 0, 620), 2) + 4 * m * Math.sin(seg(d, 280, 560) * Math.PI) + 3 * m * Math.sin(seg(ms, t.zimo, t.zimo + 180) * Math.PI);
  return amp <= 0.02 ? [0, 0] : [Math.sin(d * 0.11) * amp * 0.55, Math.cos(d * 0.135) * amp];
}
/** 牌從掌心彈出 */
export function rulaiTilePose(ms: number) {
  const a = seg(ms, RULAI_TL.tile, RULAI_TL.tile + 200);
  return { opacity: a, transform: a >= 1 ? "none" : `scale(${(0.4 + 0.6 * outC(a) + 0.14 * Math.sin(a * Math.PI)).toFixed(3)})` };
}
/** 大字像蓋章砸下；回傳大字、暗底、名字的樣子 */
export function rulaiTitlePose(ms: number) {
  const z = seg(ms, RULAI_TL.zimo, RULAI_TL.zimo + 130);
  return { art: { opacity: z, transform: z >= 1 ? "none" : `scale(${(1.7 - 0.7 * z * z * z).toFixed(3)})` }, back: seg(ms, RULAI_TL.zimo - 80, RULAI_TL.zimo + 60), name: seg(ms, RULAI_TL.name, RULAI_TL.name + 260) };
}

type C2 = CanvasRenderingContext2D;
function mk(w: number, h: number) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
function bakeGlow(size: number, stops: readonly (readonly [number, string])[]) {
  const c = mk(size, size), x = c.getContext("2d")!, g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([o, col]) => g.addColorStop(o, col));
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  return c;
}
/** 被震飛的牌：4 種（中、發、萬、牌背），開播時烘一次 */
function bakeFly() {
  const c = mk(256, 88), x = c.getContext("2d")!;
  const one = (X: number, f1: string, f2: string, label: string, col: string) => {
    const g = x.createLinearGradient(0, 0, 0, 88); g.addColorStop(0, f1); g.addColorStop(1, f2); x.fillStyle = g;
    x.beginPath(); x.roundRect(X + 1, 1, 62, 86, 7); x.fill();
    if (label) { x.fillStyle = col; x.font = "900 34px 'PingFang TC',sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(label, X + 32, 45); }
  };
  one(0, "#fff", "#e6dcc4", "中", "#b02a2a"); one(64, "#fff", "#e6dcc4", "發", "#1e6b45"); one(128, "#fff", "#e6dcc4", "萬", "#1f2a24"); one(192, "#2f7051", "#14402c", "", "");
  return c;
}
/** 手影：手的輪廓變黑，只烘一次（播放中不用 shadowBlur） */
function bakeShadow(hand: HTMLImageElement) {
  const h = 256, w = Math.round(h * AR), c = mk(w + 32, h + 32), x = c.getContext("2d")!;
  x.shadowColor = "#000"; x.shadowBlur = 16; x.drawImage(hand, 16, 16, w, h);
  x.shadowBlur = 0; x.globalCompositeOperation = "source-in"; x.fillStyle = "#000"; x.fillRect(0, 0, c.width, c.height);
  return c;
}

export class RulaiCanvas {
  private x: C2;
  private dpr: number;
  private rot: number;
  private ph: number;
  private out: [number, number];
  private fw: number;
  private fh: number;
  private art: Partial<Record<RulaiArt, HTMLImageElement>>;
  private baked: HTMLCanvasElement[];
  private shadow: HTMLCanvasElement; private fly: HTMLCanvasElement; private spark: HTMLCanvasElement; private wave: HTMLCanvasElement; private gl: HTMLCanvasElement;
  private gold: { i: number; ang: number; sp: number; s: number; ph: number; fx: number; fy: number; sway: number }[];
  private beams: { a: number; L: number; ph: number; k: number }[];
  private flys: { a: number; r0: number; R: number; spin: number; rot: number; flip: number; ph: number; h: number; face: boolean }[];
  private rubs: { a: number; R: number; s: number; spin: number; rot: number; ph: number; k: number }[];
  private dusts: { a: number; R: number; s: number; ph: number; k: number }[];
  private jetsU: { x: number; y: number; a: number; ph: number; k: number; sz: number }[];
  private press: { a: number; sp: number; o: number; l: number }[];
  /** 粒子比例（自動降級：金屑、飛牌、碎石、塵雲） */
  scale = 1;
  /** 這一格畫了幾個粒子（驗收用） */
  lastCount = 0;
  constructor(private cv: HTMLCanvasElement, private g: SakuraGeo, art: Record<RulaiArt, HTMLImageElement>, devicePixelRatio: number) {
    const L = g.mobile ? RULAI_LIMIT.mobile : RULAI_LIMIT.desktop, { u, W, H, px, py, rel } = g;
    this.dpr = Math.min(devicePixelRatio || 1, L.dpr);
    cv.width = Math.round(W * this.dpr); cv.height = Math.round(H * this.dpr);
    this.x = cv.getContext("2d")!;
    this.art = art;
    this.shadow = bakeShadow(art.hand); this.fly = bakeFly();
    this.spark = bakeGlow(48, [[0, "rgba(255,255,235,1)"], [0.2, "rgba(255,226,130,.95)"], [0.55, "rgba(255,170,50,.3)"], [1, "rgba(255,150,30,0)"]]);
    this.wave = bakeGlow(256, [[0, "rgba(255,230,160,0)"], [0.62, "rgba(255,226,150,0)"], [0.84, "rgba(255,240,195,.85)"], [0.93, "rgba(255,200,100,.25)"], [1, "rgba(255,180,60,0)"]]);
    this.gl = bakeGlow(256, [[0, "rgba(255,250,225,1)"], [0.25, "rgba(255,212,110,.7)"], [0.6, "rgba(255,160,40,.16)"], [1, "rgba(255,140,20,0)"]]);
    this.baked = [this.shadow, this.fly, this.spark, this.wave, this.gl];
    const r = rng(1908 + rel), TAU = 6.283;
    // 順序不能改：四家、重播都一樣
    this.gold = Array.from({ length: L.gold }, (_, i) => ({ i, ang: r() * TAU, sp: 0.35 + r() * 1.05, s: u * (0.008 + r() * 0.02), ph: r(), fx: r(), fy: r(), sway: r() * 6.28 }));
    this.beams = Array.from({ length: 9 }, (_, i) => ({ a: (i / 9) * TAU + r() * 0.3, L: 1.3 + r() * 0.9, ph: r(), k: i % 4 }));
    this.flys = Array.from({ length: L.fly }, () => ({ a: r() * TAU, r0: u * (0.2 + r() * 0.3), R: u * (0.5 + r() * 0.7), spin: (r() - 0.5) * 12, rot: r() * 6.28, flip: 2 + r() * 5, ph: r(), h: 0.5 + r() * 0.9, face: r() < 0.55 }));
    this.rubs = Array.from({ length: L.rubble }, (_, i) => ({ a: r() * TAU, R: u * (0.45 + r() * 0.75), s: u * (0.045 + r() * 0.05), spin: (r() - 0.5) * 9, rot: r() * 6.28, ph: r(), k: i % 12 }));
    this.dusts = Array.from({ length: L.dust }, (_, i) => ({ a: (i / L.dust) * TAU + r() * 0.3, R: u * (0.75 + r() * 0.7), s: u * (0.32 + r() * 0.34), ph: r(), k: i % 4 }));
    // 噴光點：取最靠中心的 80%，平均分配
    const pts = [...RULAI_META.jets].sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
    this.jetsU = Array.from({ length: L.jets }, (_, i) => ({ ...pts[Math.floor((i / L.jets) * pts.length * 0.8)], ph: r(), k: i % 4, sz: 0.2 + r() * 0.16 }));
    this.press = Array.from({ length: 20 }, (_, i) => ({ a: (i / 20) * TAU + r() * 0.25, sp: 0.8 + r() * 0.9, o: r(), l: 0.1 + r() * 0.16 }));
    this.rot = [0, -Math.PI / 2, Math.PI, Math.PI / 2][rel];
    this.ph = u * (g.mobile ? 1.2 : 1.1); // 砸中時手長：比牌桌還大，手指和掌根都超出畫面
    const cx = W / 2, cy = H / 2, dl = Math.hypot(px - cx, py - cy) || 1;
    this.out = [(px - cx) / dl, (py - cy) / dl];
    this.fw = Math.max(u * 3.3, Math.max(px, W - px) * 2.04); this.fh = this.fw / RULAI_META.fisAR; // 落點靠邊時，另一側也要鋪滿，裂縫不會在畫面中斷掉
  }
  /** 收尾：放掉畫布記憶體和 10 張圖的參照 */
  destroy() {
    this.cv.width = 0; this.cv.height = 0;
    for (const c of this.baked) { c.width = 0; c.height = 0; }
    this.art = {};
    this.gold = []; this.flys = []; this.rubs = []; this.dusts = []; this.jetsU = []; this.beams = []; this.press = [];
  }
  draw(ms: number) {
    const { x, dpr, ph, gl, spark, wave, fly, shadow, art, rot } = this, { W, H, u, px, py } = this.g, tl = RULAI_TL, t = ms / 1000, hit = tl.hit, S = this.scale;
    const hand = art.hand, cracks = art["hand-cracks"], print = art.print, fis = art.fissures, fisG = art["fis-glow"], jets = art["light-jets"], rays = art["light-rays"], rubble = art.rubble, dust = art.dust;
    if (!hand || !cracks || !print || !fis || !fisG || !jets || !rays || !rubble || !dust) return; // 已經收尾
    let count = 0;
    x.setTransform(dpr, 0, 0, dpr, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = "source-over";
    x.clearRect(0, 0, W, H);
    const fade = 1 - sm(seg(ms, tl.total - 600, tl.total));
    const s = rulaiHandScale(ms), oK = (u * 0.28 * Math.max(0, s - 1.03)) / 1.32;
    const hx = px + this.out[0] * oK, hy = py + this.out[1] * oK;
    const C = Math.cos(rot), Sn = Math.sin(rot);
    const place = (cx: number, cy: number) => x.setTransform(C * dpr, Sn * dpr, -Sn * dpr, C * dpr, cx * dpr, cy * dpr);
    const reset = () => { x.setTransform(dpr, 0, 0, dpr, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = "source-over"; };
    const spin = (a: number, sq: number, X: number, Y: number) => { const c = Math.cos(a), n = Math.sin(a); x.setTransform(c * dpr, n * dpr, -n * sq * dpr, c * sq * dpr, X * dpr, Y * dpr); };
    const handAt = (img: CanvasImageSource, z: number) => { const w = z * AR; x.drawImage(img, -w * AX, -z * AY, w, z); };
    const handIn = sm(seg(ms, tl.press - 60, tl.press + 240)), handOut = 1 - sm(seg(ms, tl.reveal + 60, tl.reveal + 430));
    // 手影：大到蓋住整張牌桌，手越低越實
    const shA = ms < hit ? sm(seg(ms, 60, 420)) * lerp(0.92, 0.45, clamp((s - 1.03) / 1.32)) : (1 - seg(ms, tl.reveal, tl.reveal + 240)) * 0.9;
    if (shA > 0) { const k = lerp(1.04, 1.5, clamp((s - 1.03) / 1.32)) * (ms < tl.press ? lerp(0.6, 1, seg(ms, 60, tl.press)) : 1), z = ph * k * 1.06; place(px + this.out[0] * oK * 0.35, py + this.out[1] * oK * 0.35); x.globalAlpha = shA; handAt(shadow, z); reset(); }
    // 金光束：照原圖比例（3:1），只等比例放大
    const beamCellW = rays.naturalWidth / 2, beamCellH = rays.naturalHeight / 2;
    const drawBeams = (cx: number, cy: number, al: number, scaleL: number) => {
      x.globalCompositeOperation = "lighter";
      for (const b of this.beams) { const L = u * b.L * scaleL, wd = L / BEAM, a = b.a + 0.05 * Math.sin(t * 2.4 + b.ph * 6); spin(a, 1, cx, cy); x.globalAlpha = al * (0.65 + 0.35 * Math.sin(t * 5 + b.ph * 9)); x.drawImage(rays, (b.k % 2) * beamCellW, (b.k >> 1) * beamCellH, beamCellW, beamCellH, 0, -wd / 2, L, wd); }
      reset();
    };
    if (ms < hit) {
      // 風壓線、金屑往落點吸、手後的天光
      const pr = sm(seg(ms, 80, 500)) * (ms < tl.lift ? 0.55 : 1); x.lineCap = "round"; x.strokeStyle = "#ffe9b8"; x.lineWidth = Math.max(1, u * 0.0035);
      for (const p of this.press) { const f = (t * p.sp * (ms > tl.lift ? 1.9 : 1) + p.o) % 1, R0 = u * (1.15 - f * 0.92), Lp = u * p.l * (ms > tl.slam ? 2.6 : 1); x.globalAlpha = pr * 0.34 * Math.sin(f * Math.PI); x.beginPath(); x.moveTo(px + Math.cos(p.a) * R0, py + Math.sin(p.a) * R0 * SQ); x.lineTo(px + Math.cos(p.a) * (R0 + Lp), py + Math.sin(p.a) * (R0 + Lp) * SQ); x.stroke(); }
      reset();
      x.globalCompositeOperation = "lighter"; const dustIn = seg(ms, 120, hit - 20);
      for (const g of this.gold) { if (g.i > this.gold.length * 0.55 * S) continue; const p = inC(clamp(dustIn * 1.25 - g.ph * 0.35)); if (p <= 0) continue; x.globalAlpha = sm(seg(p, 0, 0.15)) * (1 - seg(p, 0.92, 1)) * 0.9; const r = g.s * (1.5 - p * 0.6); x.drawImage(spark, lerp(g.fx * W, px, p) - r, lerp(g.fy * H, py, p) - r, r * 2, r * 2); count++; }
      reset();
      const glowA = sm(seg(ms, tl.press - 40, tl.press + 300));
      if (glowA > 0) { x.globalCompositeOperation = "lighter"; x.globalAlpha = 0.42 * glowA; const R = ph * s * 0.72; x.drawImage(gl, hx - R, hy - R, R * 2, R * 2); reset(); drawBeams(hx, hy, 0.62 * glowA, 1.25 * Math.max(1, s * 0.8)); }
    }
    const { fw, fh } = this;
    if (ms >= hit) {
      const a0 = seg(ms, hit, hit + 60) * fade, A = ms - hit;
      // 桌面下陷
      const sinkR = u * 1.3 * outC(seg(ms, hit, hit + 200)), sink = a0 * (1 - 0.55 * seg(ms, tl.zimo, tl.total));
      const gr = x.createRadialGradient(px, py, sinkR * 0.1, px, py, sinkR); gr.addColorStop(0, "rgba(0,0,0,.78)"); gr.addColorStop(0.55, "rgba(0,0,0,.5)"); gr.addColorStop(1, "rgba(0,0,0,0)");
      x.globalAlpha = sink; x.fillStyle = gr; x.save(); x.translate(px, py); x.scale(1, SQ); x.translate(-px, -py); x.beginPath(); x.arc(px, py, sinkR, 0, 6.3); x.fill(); x.restore(); reset();
      // 裂縫三波：先裂開，再從裂縫裡透金光（同一張圖用橢圓遮罩揭開）
      const waveR = 0.34 * outC(seg(A, 0, 130)) + 0.33 * outC(seg(A, 200, 400)) + 0.33 * outC(seg(A, 480, 800)), crR = u * 1.75 * waveR;
      const fisA = a0 * 0.82 * (ms < tl.zimo ? 1 : lerp(1, 0.45, seg(ms, tl.zimo, tl.zimo + 500)));
      // 揭開中多疊一圈半透明：裂縫的邊不是一條硬的圓弧（小宜：不要像環）
      if (waveR < 1) { x.save(); x.beginPath(); x.ellipse(px, py, crR * 1.5, crR * SQ * 1.5, 0, 0, 6.3); x.clip(); x.globalCompositeOperation = "lighter"; x.globalAlpha = fisA * 0.45; x.drawImage(fis, px - fw / 2, py - fh / 2, fw, fh); x.restore(); reset(); }
      x.save(); x.beginPath(); x.ellipse(px, py, crR * 1.25, crR * SQ * 1.25, 0, 0, 6.3); x.clip();
      x.globalCompositeOperation = "lighter";
      x.globalAlpha = waveR < 1 ? fisA * 0.55 : fisA; x.drawImage(fis, px - fw / 2, py - fh / 2, fw, fh);
      const peak = sm(seg(ms, tl.reveal, tl.reveal + 420)) * (1 - 0.7 * sm(seg(ms, tl.zimo, tl.zimo + 600)));
      x.globalAlpha = a0 * (0.12 + 0.3 * peak) * (0.82 + 0.18 * Math.sin(t * 7)); x.drawImage(fisG, px - fw / 2, py - fh / 2, fw, fh);
      x.restore(); reset();
      // 亮光沿裂縫往外跑（環形遮罩）
      const pulse = seg(A, 540, 1500);
      if (pulse > 0 && pulse < 1) { const R1 = u * 2 * pulse; x.save(); x.beginPath(); x.ellipse(px, py, R1 + u * 0.2, (R1 + u * 0.2) * SQ, 0, 0, 6.3); x.moveTo(px + R1, py); x.ellipse(px, py, R1, R1 * SQ, 0, 0, 6.3, true); x.clip("evenodd"); x.globalCompositeOperation = "lighter"; x.globalAlpha = (1 - pulse) * 0.95; x.drawImage(fis, px - fw / 2, py - fh / 2, fw, fh); x.restore(); reset(); }
      // 裂縫噴金光（主角）：越靠中心越早，掌印亮起時第二次噴
      x.globalCompositeOperation = "lighter"; const jw = jets.naturalWidth / 2, jh = jets.naturalHeight / 2, jAR = jw / jh;
      for (const j of this.jetsU) {
        const dist = Math.hypot(j.x, j.y), t0 = hit + 120 + dist * 1700 + j.ph * 160, p = seg(ms, t0, t0 + 900), second = seg(ms, tl.reveal + j.ph * 240, tl.reveal + 1100 + j.ph * 400);
        const en = Math.max(p > 0 && p < 1 ? Math.sin(p * Math.PI) : 0, second > 0 && second < 1 ? Math.sin(second * Math.PI) : 0) * fade;
        if (en <= 0) continue;
        const z = u * j.sz * (0.72 + en * 0.6) * (1 + 0.1 * Math.sin(t * 19 + j.ph * 7));
        spin(j.a + Math.PI / 2, 1, px + j.x * fw, py + j.y * fh); x.globalAlpha = en; x.drawImage(jets, (j.k % 2) * jw, (j.k >> 1) * jh, jw, jh, (-z * jAR) / 2, -z * 0.88, z * jAR, z); count++;
      }
      reset();
      // 掌印：手抬起才看得到，裡面的光就是手背那張裂紋
      if (ms >= tl.reveal - 20) {
        const lit = sm(seg(ms, tl.reveal + 60, tl.reveal + 560)), br = 0.86 + 0.14 * Math.sin((ms - tl.reveal) / 240), dimmed = ms > tl.zimo ? 0.6 : 1;
        place(px, py); x.globalAlpha = lit * dimmed * fade * 0.8; handAt(shadow, ph * 1.04); // 底下壓暗，發光手形才看得出來
        x.globalCompositeOperation = "lighter"; x.globalAlpha = lit * br * dimmed * fade; handAt(print, ph); x.globalAlpha = lit * br * dimmed * fade * 0.4; handAt(cracks, ph); reset();
        const ra = sm(seg(ms, tl.reveal + 180, tl.reveal + 420)) * (1 - sm(seg(ms, tl.reveal + 500, tl.zimo + 420))) * fade;
        if (ra > 0) drawBeams(px, py, ra * 0.38, 0.9 + 0.5 * seg(ms, tl.reveal + 180, tl.zimo + 400));
      }
      // 牌被震飛
      for (const f of this.flys) {
        const dl = f.ph * 70, p = seg(A, dl, dl + 640 + f.h * 260), op = fade * (1 - seg(ms, tl.zimo + 500, tl.total - 500));
        if (A < dl || op <= 0 || (S < 1 && Math.floor(f.ph * 10) >= 10 * S)) continue;
        const R = f.r0 + f.R * outC(p), jump = Math.sin(p * Math.PI), sc = u * 0.078 * (1 + f.h * 0.95 * jump), flipv = p < 1 ? Math.cos(p * f.flip * Math.PI) : 1;
        spin(f.rot + f.spin * outC(p), 0.3 + 0.7 * Math.abs(flipv), px + Math.cos(f.a) * R, py + Math.sin(f.a) * R * SQ); x.globalAlpha = op; x.drawImage(fly, f.face === flipv > 0 ? Math.floor(f.ph * 3) * 64 : 192, 0, 64, 88, -sc * 0.36, -sc / 2, sc * 0.72, sc); count++;
      }
      // 碎石：桌面崩出來的碎片（格子是正方形，比例照原圖）
      const rc = rubble.naturalWidth / 4;
      for (const b of this.rubs) {
        const dl = b.ph * 90, p = seg(A, dl, dl + 620 + b.ph * 300);
        if (A < dl || p >= 1 || (S < 1 && b.k % 10 >= 10 * S)) continue;
        const sc = b.s * (1 + 0.9 * Math.sin(p * Math.PI));
        spin(b.rot + b.spin * p, 1, px + Math.cos(b.a) * b.R * outC(p), py + Math.sin(b.a) * b.R * outC(p) * SQ); x.globalAlpha = (1 - p * p) * fade; x.drawImage(rubble, (b.k % 4) * rc, Math.floor(b.k / 4) * rc, rc, rc, -sc, -sc, sc * 2, sc * 2); count++;
      }
      reset();
      // 金色塵雲貼著桌面翻出去（格子 3:2）
      const dw = dust.naturalWidth / 2, dh = dust.naturalHeight / 2, dAR = dw / dh; x.globalCompositeOperation = "lighter";
      for (const d of this.dusts) {
        const p = seg(A, d.ph * 60, 720 + d.ph * 360);
        if (p <= 0 || p >= 1 || (S < 1 && d.k >= 4 * S)) continue;
        const R = d.R * outC(p), z = d.s * (0.6 + p * 1.05); x.globalAlpha = (1 - p) * 0.5 * fade;
        x.drawImage(dust, (d.k % 2) * dw, (d.k >> 1) * dh, dw, dh, px + Math.cos(d.a) * R - z * dAR, py + Math.sin(d.a) * R * SQ - z * SQ, z * dAR * 2, z * 2 * SQ); count++;
      }
      reset();
    }
    // 手本體＋透光裂紋：蓄力時裂紋越來越亮，抬到最高時幾乎白熱
    const drawHand = (scale: number, cx: number, cy: number, al: number, lighter: boolean) => { place(cx, cy); x.globalAlpha = al; if (lighter) x.globalCompositeOperation = "lighter"; handAt(hand, ph * scale); reset(); };
    const al = handIn * handOut;
    if (al > 0) {
      // 砸下的殘影 3 張
      if (ms >= tl.slam && ms < hit) { const f0 = seg(ms, tl.slam, hit); for (const [lag, a] of [[0.5, 0.22], [0.3, 0.3], [0.14, 0.42]] as const) { const sc = lerp(2.45, 1.03, inC(clamp(f0 - lag * 0.5))), o2 = (u * 0.28 * Math.max(0, sc - 1.03)) / 1.32; drawHand(sc, px + this.out[0] * o2, py + this.out[1] * o2, a, true); } }
      drawHand(s, hx, hy, al, false);
      // 老闆的手背本身就有發光裂紋和雲紋，疊加不能蓋掉它們：壓下時很淡，抬到最高才接近白熱
      const crA = (ms < tl.lift ? 0.1 + 0.16 * seg(ms, tl.press, tl.lift) : ms < hit ? 0.26 + 0.5 * sm(seg(ms, tl.lift, tl.slam)) + 0.12 * Math.sin(t * 34) * seg(ms, tl.lift, tl.slam) : 0.7 - 0.45 * seg(ms, hit, tl.reveal)) * al;
      if (crA > 0) { place(hx, hy); x.globalCompositeOperation = "lighter"; x.globalAlpha = Math.min(1, crA); handAt(cracks, ph * s); if (crA > 1) { x.globalAlpha = Math.min(1, crA - 1); handAt(cracks, ph * s); } reset(); }
      if (ms >= hit && ms < hit + 340) drawHand(s, hx, hy, (1 - seg(ms, hit, hit + 300)) * 0.28 * al, true);
      // 砸中後指縫透光
      if (ms >= hit && ms < tl.reveal + 200) drawBeams(px, py, (1 - seg(ms, hit + 40, tl.reveal + 200)) * 0.3, 1.45);
    }
    if (ms >= hit) {
      const A = ms - hit; x.globalCompositeOperation = "lighter";
      // 光波：軟邊，不是細線環
      for (const [d0, R, D, a2] of [[0, 2.1, 620, 0.95], [130, 1.45, 700, 0.62]] as const) { const g = seg(A, d0, d0 + D); if (g <= 0 || g >= 1) continue; const r = u * R * outC(g); x.globalAlpha = (1 - g) * a2; x.drawImage(wave, px - r, py - r * SQ, r * 2, r * 2 * SQ); }
      // 金屑：炸開，後段一半慢慢上升
      for (const g of this.gold) {
        if (g.i % 10 >= 10 * S) continue;
        const dl = g.ph * 90, p = seg(A, dl, dl + 700 + g.sp * 240);
        if (A < dl) continue;
        const R = u * g.sp * 1.12 * outC(p);
        if (p < 1) { x.globalAlpha = (1 - p * p) * 0.9; const r = g.s * (1.4 - p * 0.6); x.drawImage(spark, px + Math.cos(g.ang) * R * 1.25 - r, py + Math.sin(g.ang) * R * SQ - r, r * 2, r * 2); count++; }
        else if (g.i % 2 === 0) { const q = seg(ms, tl.reveal + 200 + g.ph * 600, tl.total + 200); if (q > 0) { const r = g.s * (0.9 + q * 0.5); x.globalAlpha = Math.sin(Math.PI * q) * 0.85 * fade; x.drawImage(spark, px + Math.cos(g.ang) * u * 0.6 * g.fx + Math.sin(t * 1.4 + g.sway) * u * 0.02 - r, py + Math.sin(g.ang) * u * 0.5 * g.fy - r, r * 2, r * 2); count++; } }
      }
      const tg = sm(seg(ms, tl.tile - 60, tl.tile + 160)) * fade;
      if (tg > 0) { x.globalAlpha = 0.4 * tg; const R = u * 0.32; x.drawImage(gl, px - R, py - R, R * 2, R * 2); }
      reset();
      // 閃光一次（90ms）
      const fl = seg(A, 0, 90);
      if (fl < 1) { x.globalAlpha = (1 - fl) * 0.74; x.fillStyle = "#fff4cf"; x.fillRect(0, 0, W, H); reset(); }
    }
    this.lastCount = count;
  }
}

/**
 * 播一次如來神掌：回傳 stop（跳過、卸載時呼叫，可重複呼叫）。全程只有一個 requestAnimationFrame 迴圈，播完或 stop 就放掉畫布、圖片。
 */
export function runRulai(els: SakuraEls, g: SakuraGeo, art: Record<RulaiArt, HTMLImageElement>, o: { dpr: number; rm: boolean; zeroAt: number; stageShadow: string; raf?: (f: (now: number) => void) => number; caf?: (id: number) => void }) {
  const raf = o.raf ?? requestAnimationFrame, caf = o.caf ?? cancelAnimationFrame;
  const { dim, tile, tileIn, title, art: artEl, back, name, stage, cv } = els;
  const fx = new RulaiCanvas(cv, g, art, o.dpr);
  let id = 0, stopped = false, moved = false;
  const setOp = (e: { style: Partial<CSSStyleDeclaration> } | null | undefined, v: number) => { if (e) e.style.opacity = v.toFixed(3); };
  const clearStage = () => { if (stage && moved) { stage.style.transform = ""; stage.style.boxShadow = ""; stage.style.transformOrigin = ""; moved = false; } };
  const stop = () => { if (stopped) return; stopped = true; caf(id); clearStage(); fx.destroy(); };
  if (o.rm) {
    fx.draw(RULAI_STILL_MS);
    const step = (now: number) => {
      if (stopped) return;
      const ms = now - o.zeroAt, p = sakuraStillPose(ms);
      setOp(cv as unknown as { style: Partial<CSSStyleDeclaration> }, p.base); setOp(dim, 0.8 * p.base); setOp(tileIn, p.main); setOp(artEl, p.main); setOp(back, p.main); setOp(name, p.name);
      if (ms < STILL_END) id = raf(step);
    };
    id = raf(step);
  } else {
    const gov = frameGovernor();
    let last = o.zeroAt;
    if (stage) stage.style.transformOrigin = `${Math.round(g.px)}px ${Math.round(g.py)}px`;
    const step = (now: number) => {
      if (stopped) return;
      const ms = now - o.zeroAt;
      fx.scale = gov(now - last);
      last = now;
      if (ms >= RULAI_TL.total) { setOp(tile, 0); setOp(title, 0); clearStage(); fx.destroy(); return; }
      fx.draw(ms);
      setOp(dim, rulaiDim(ms));
      const pose = rulaiTilePose(ms), t = rulaiTitlePose(ms), fo = rulaiFadeOut(ms);
      if (tileIn) { tileIn.style.opacity = pose.opacity.toFixed(3); tileIn.style.transform = pose.transform; }
      if (artEl) { artEl.style.opacity = t.art.opacity.toFixed(3); artEl.style.transform = t.art.transform; }
      setOp(back, t.back); setOp(name, t.name); setOp(tile, fo); setOp(title, fo);
      if (stage) {
        const [sx, sy] = rulaiShake(ms, g.mobile), cam = rulaiCam(ms);
        if (sx || sy || Math.abs(cam - 1) > 1e-4) { stage.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) scale(${cam.toFixed(4)})`; stage.style.boxShadow = o.stageShadow; moved = true; } else clearStage();
      }
      id = raf(step);
    };
    id = raf(step);
  }
  return { stop };
}
