// 櫻花紛飛的單一畫布引擎（小宜〈櫻花紛飛與如來神掌-分鏡與實作規格-2026-11-05〉第 3、5、6、9 節；老闆 2026-11-05 同意）。
// 畫面只由時間決定（draw(ms)），沒有 Web Animation、CSS filter、shadowBlur、每片一個 DOM：iOS 上動畫物件會累積（老馬 2026-11-04 查到），所以櫻花不走零件做法。
// 暗幕、牌、大字、名字也由 runSakura 一個 requestAnimationFrame 迴圈寫 inline style，不用 CSS 動畫和 transition：播放時 document.getAnimations() 不增加（審伯 2026-11-05）。
// 花瓣表（6 種形狀；上排清晰給中景，下排預先模糊給遠景、近景）由 scripts/gen-sakura-petals.mjs 產生。

export const SAKURA_TL = { hit: 1120, tile: 1420, zimo: 1880, name: 2120, total: 3400 };
/** 手機／電腦上限：畫布倍率、遠中近花瓣數 */
export const SAKURA_LIMIT = {
  mobile: { dpr: 1.5, petals: [130, 96, 14] },
  desktop: { dpr: 2, petals: [220, 170, 24] },
} as const;
/** 減少動態：畫這一刻的靜止畫面（紛飛段，沒有閃光、風線） */
export const SAKURA_STILL_MS = 2400;
/** 風從勝者那一側吹來（rel：0 自己、1 下家、2 對家、3 上家） */
const WIND = [[0.92, -0.38], [-0.97, 0.1], [0.46, 0.88], [0.97, 0.1]] as const;
const WIND_LINES = 14;

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const sm = (x: number) => x * x * (3 - 2 * x);
const outC = (x: number) => 1 - Math.pow(1 - x, 3);
const inC = (x: number) => x * x * x;
const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

/** 暗幕透明度（播到結束都留著，結算才不會先亮一下） */
export const sakuraDim = (ms: number) => 0.58 * sm(seg(ms, 0, 500));
/** 牌、大字的整體透明度（3.04 秒起淡出） */
export const sakuraFadeOut = (ms: number) => 1 - sm(seg(ms, SAKURA_TL.total - 360, SAKURA_TL.total));
/** 主擊那一下畫面順風推（手機 5px、電腦 7.5px，220ms，回傳水平位移） */
export const sakuraPush = (ms: number, rel: number, mobile: boolean) => {
  const d = ms - SAKURA_TL.hit;
  return d < 0 || d >= 220 ? 0 : WIND[rel][0] * 5 * Math.sin((d / 220) * Math.PI) * (mobile ? 1 : 1.5);
};
/** 自動降級：連續 20 格平均超過 28ms，粒子降到 60%；再超過降到 40%（主擊、牌、大字不降）。回傳目前比例 */
export function frameGovernor() {
  let scale = 1, sum = 0, n = 0;
  return (dt: number) => {
    if (dt > 250) return scale; // 切背景回來的那一格不算
    sum += dt;
    if (++n < 20) return scale;
    if (sum / n > 28) scale = scale === 1 ? 0.6 : 0.4;
    sum = 0; n = 0;
    return scale;
  };
}

type Petal = {
  layer: 0 | 1 | 2; i: number; n: number; fx: number; fy: number; kind: number; rot: number; rs: number; flip: number; fs: number; s: number; sp: number;
  swayA: number; swayF: number; swayP: number; alpha: number; ang: number; burst: number; ring: number; ph: number; join: boolean;
};
export function makePetals(u: number, rel: number, counts: readonly number[]): Petal[] {
  const r = rng(2026 + rel), ps: Petal[] = [];
  const mul = (layer: 0 | 1 | 2, a: readonly [number, number, number]) => a[layer];
  ([0, 1, 2] as const).forEach((layer) => {
    const n = counts[layer];
    for (let i = 0; i < n; i++) {
      // 順序不能改：每一項取一次亂數，四家、重播都一樣
      const fx = r(), fy = r(), kind = Math.floor(r() * 6), rot = r() * 6.28, rs = (r() - 0.5) * 3.2 * mul(layer, [0.6, 1, 0.55]), flip = r() * 6.28, fs = (1.6 + r() * 3.2) * mul(layer, [0.7, 1, 0.5]);
      const a0 = r(), a1 = r(), a2 = r();
      const s = u * (layer === 0 ? 0.02 + a0 * 0.018 : layer === 1 ? 0.052 + a1 * 0.042 : 0.12 + a2 * 0.07);
      const sp = mul(layer, [0.52, 1, 1.9]) * (0.85 + r() * 0.3), swayA = u * (0.015 + r() * 0.05) * mul(layer, [0.6, 1, 1.5]), swayF = 0.9 + r() * 1.6, swayP = r() * 6.28;
      const b0 = r(), b1 = r(), b2 = r();
      const alpha = layer === 0 ? 0.58 + b0 * 0.24 : layer === 1 ? 0.88 + b1 * 0.12 : 0.5 + b2 * 0.2;
      const ang = r() * 6.283, burst = 0.35 + r() * 0.95, ring = 0.14 + r() * 0.28, ph = r(), join = layer === 1 || (layer === 0 && r() < 0.5);
      ps.push({ layer, i, n, fx, fy, kind, rot, rs, flip, fs, s, sp, swayA, swayF, swayP, alpha, ang, burst, ring, ph, join });
    }
  });
  return ps;
}

/** 風的累積位移（單位：畫面長度）：起風 → 主擊前收住 → 主擊後一陣大風 → 慢下來飄 */
function windCum(t: number) {
  const T = SAKURA_TL.hit / 1000;
  const p1 = 0.15 * clamp(t, 0, 0.9) + 0.55 * inC(seg(t, 0.15, T));
  const p2 = t > T ? 0.42 * outC(seg(t, T, T + 0.7)) : 0;
  const p3 = t > T + 0.5 ? 0.135 * (t - T - 0.5) : 0;
  return p1 + p2 + p3;
}

function bakeGlow() {
  const size = 256, c = document.createElement("canvas");
  c.width = c.height = size;
  const x = c.getContext("2d")!, g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  ([[0, "rgba(255,246,240,.95)"], [0.3, "rgba(255,190,210,.55)"], [0.7, "rgba(255,150,190,.12)"], [1, "rgba(255,140,180,0)"]] as const).forEach(([o, col]) => g.addColorStop(o, col));
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  return c;
}

export type SakuraGeo = { W: number; H: number; u: number; px: number; py: number; rel: number; mobile: boolean };
export class SakuraCanvas {
  private x: CanvasRenderingContext2D;
  private dpr: number;
  private ps: Petal[];
  private glow: HTMLCanvasElement;
  private sheet: HTMLImageElement | null = null;
  /** 粒子比例（自動降級） */
  scale = 1;
  /** 上一格畫了幾片（驗收用） */
  lastCount = 0;
  constructor(private cv: HTMLCanvasElement, private g: SakuraGeo, devicePixelRatio: number) {
    const L = g.mobile ? SAKURA_LIMIT.mobile : SAKURA_LIMIT.desktop;
    this.dpr = Math.min(devicePixelRatio || 1, L.dpr);
    cv.width = Math.round(g.W * this.dpr);
    cv.height = Math.round(g.H * this.dpr);
    this.x = cv.getContext("2d")!;
    this.ps = makePetals(g.u, g.rel, L.petals);
    this.glow = bakeGlow();
  }
  /** 花瓣表解碼好才給（沒給之前只畫光和風線，不會出錯） */
  setSheet(img: HTMLImageElement) { this.sheet = img; }
  /** 收尾：放掉畫布記憶體和圖片參照 */
  destroy() {
    this.cv.width = 0;
    this.cv.height = 0;
    this.glow.width = 0;
    this.sheet = null;
    this.ps = [];
  }
  draw(ms: number) {
    const { x, dpr, glow, sheet } = this, { W, H, u, px, py, rel } = this.g, tl = SAKURA_TL, t = ms / 1000, T = tl.hit / 1000, S = this.scale;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, W, H);
    const fade = 1 - sm(seg(ms, tl.total - 500, tl.total));
    const [wx, wy] = WIND[rel];
    const after = sm(seg(t, T, T + 0.9));
    const cum = windCum(t), M = Math.max(W, H) * 1.2;
    const ramp = sm(seg(ms, 40, 860)), bigW = W + 240, bigH = H + 240;
    const grav = u * 0.34 * Math.max(0, t - T - 0.15); // 主擊後才明顯往下落
    // 底光：風中的粉色大氣，主擊前慢慢亮起
    const air = sm(seg(ms, 500, 1100)) * (1 - 0.55 * sm(seg(ms, 1500, 2600))) * fade;
    x.globalCompositeOperation = "lighter";
    x.globalAlpha = 0.34 * air;
    x.drawImage(glow, px - u * 1.1, py - u * 1.1, u * 2.2, u * 2.2);
    x.globalCompositeOperation = "source-over";
    // 風線：順著風掃過，讓風看得見
    const gust = (sm(seg(ms, 280, 620)) * (1 - seg(ms, 1000, tl.hit)) + sm(seg(ms, tl.hit, tl.hit + 120)) * (1 - seg(ms, tl.hit + 120, tl.hit + 900))) * fade;
    if (gust > 0) {
      x.lineCap = "round";
      const rs = rng(5 + rel), nx = -wy, ny = wx, D = Math.hypot(W, H);
      for (let i = 0; i < WIND_LINES; i++) {
        const o = rs(), lane = (rs() - 0.5) * D * 0.95, sp = 0.9 + rs() * 1.1, len = u * (0.35 + rs() * 0.6), bow = (rs() - 0.5) * u * 0.22, f = (((t * sp * 0.9 + o) % 1) + 1) % 1;
        const along = (f - 0.5) * (D + len * 2), cx = W / 2 + wx * along + nx * lane, cy = H / 2 + wy * along + ny * lane;
        x.globalAlpha = gust * (0.1 + rs() * 0.14) * Math.sin(f * Math.PI);
        x.strokeStyle = "#ffe3ec";
        x.lineWidth = Math.max(1, u * (0.002 + rs() * 0.004));
        x.beginPath();
        x.moveTo(cx - (wx * len) / 2, cy - (wy * len) / 2);
        x.quadraticCurveTo(cx + nx * bow, cy + ny * bow, cx + (wx * len) / 2, cy + (wy * len) / 2);
        x.stroke();
      }
      x.globalAlpha = 1;
    }
    let count = 0;
    if (sheet) {
      const cell = sheet.naturalWidth / 6;
      for (const p of this.ps) {
        if (p.i / p.n > ramp + (p.layer === 2 ? -0.15 : 0.02) || (S < 1 && p.i % 10 >= 10 * S)) continue;
        // 風場位置：沿風向繞行（超出畫面從另一邊回來），花瓣永遠鋪滿
        let fxp = p.fx * bigW + wx * cum * M * p.sp + Math.sin(t * p.swayF + p.swayP) * p.swayA;
        let fyp = p.fy * bigH + wy * cum * M * p.sp + Math.cos(t * p.swayF * 0.8 + p.swayP) * p.swayA * 0.7 + grav * p.sp;
        fxp = ((fxp % bigW) + bigW) % bigW - 120;
        fyp = ((fyp % bigH) + bigH) % bigH - 120;
        let X = fxp, Y = fyp, sc = 1, al = p.alpha;
        if (p.join) {
          // 收束：0.72～1.12 各自沿環線被捲向落點（每片獨立，不是整張圖在轉）
          const gather = ms < tl.hit ? inC(seg(ms, 700 + p.ph * 180, tl.hit - 10)) : 0;
          if (gather > 0) {
            const ang = p.ang + t * 5.5, rr = u * p.ring * (1 - gather * 0.78);
            X = lerp(fxp, px + Math.cos(ang) * rr * 1.25, gather);
            Y = lerp(fyp, py + Math.sin(ang) * rr * 0.62, gather);
          }
          // 花爆：主擊瞬間全向噴出，再融回風場
          if (ms >= tl.hit) {
            const b = outC(seg(ms, tl.hit, tl.hit + 620)), R = u * p.burst * 1.05 * b + u * 0.03;
            const back = sm(seg(ms, tl.hit + 340 + p.ph * 160, tl.hit + 1040));
            X = lerp(px + Math.cos(p.ang) * R * 1.35, fxp, back);
            Y = lerp(py + Math.sin(p.ang) * R * 0.72, fyp, back);
            sc = 1 + 0.45 * (1 - back) * (p.layer === 1 ? 1 : 0.5);
          }
        }
        if (p.layer === 2) al *= sm(seg(ms, 500, 1000)) * (0.6 + 0.4 * after);
        if (X < -140 || X > W + 140 || Y < -140 || Y > H + 140) continue;
        // 翻轉：單軸縮放，看起來像 3D、沒有 3D 圖層
        const fl = Math.cos(t * p.fs + p.flip), sq = 0.28 + 0.72 * Math.abs(fl), rot = p.rot + t * p.rs + (fl < 0 ? 0.25 : 0);
        const c = Math.cos(rot), sn = Math.sin(rot), s = p.s * sc;
        x.globalAlpha = al * fade * (fl < 0 ? 0.78 : 1);
        x.setTransform(c * dpr, sn * dpr, -sn * sq * dpr, c * sq * dpr, X * dpr, Y * dpr);
        x.drawImage(sheet, p.kind * cell, (p.layer === 1 ? 0 : 1) * cell, cell, cell, -s / 2, -s / 2, s, s);
        count++;
      }
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      x.globalAlpha = 1;
    }
    this.lastCount = count;
    // 主擊：粉白光一下（不連閃，210ms）＋一圈柔和風壓
    const f = seg(ms, tl.hit, tl.hit + 210);
    if (ms >= tl.hit && f < 1) {
      x.globalCompositeOperation = "lighter";
      x.globalAlpha = (1 - f) * 0.7;
      const R = u * (0.5 + 1.05 * outC(f));
      x.drawImage(glow, px - R * 1.3, py - R * 0.85, R * 2.6, R * 1.7);
      x.globalAlpha = (1 - f) * 0.2;
      x.fillStyle = "#ffe6ee";
      x.fillRect(0, 0, W, H);
      x.globalCompositeOperation = "source-over";
      x.globalAlpha = 1;
    }
    const g = seg(ms, tl.hit, tl.hit + 640);
    if (ms >= tl.hit && g < 1) {
      x.globalAlpha = (1 - g) * 0.55;
      x.strokeStyle = "#fff0f5";
      x.lineWidth = u * 0.012 * (1 - g) + 1;
      x.beginPath();
      x.ellipse(px, py, u * 1.25 * outC(g), u * 0.55 * outC(g), 0, 0, 6.3);
      x.stroke();
      x.globalAlpha = 1;
    }
    // 牌後的柔光
    const tileG = sm(seg(ms, tl.tile - 60, tl.tile + 180)) * fade;
    if (tileG > 0) {
      x.globalCompositeOperation = "lighter";
      x.globalAlpha = 0.7 * tileG;
      const R = u * 0.32;
      x.drawImage(glow, px - R, py - R, R * 2, R * 2);
      x.globalCompositeOperation = "source-over";
      x.globalAlpha = 1;
    }
  }
}

/** 牌登場（原本 CSS 的 zf-tile-pop，420ms）：小 → 超過一點 → 定位 */
export function sakuraTilePose(ms: number) {
  const f = seg(ms, SAKURA_TL.tile, SAKURA_TL.tile + 420);
  if (ms < SAKURA_TL.tile) return { opacity: 0, transform: "translateY(20%) scale(0.2)" };
  const up = seg(f, 0, 0.75), down = seg(f, 0.75, 1), o = outC(up);
  const y = down > 0 ? lerp(-6, 0, down) : lerp(20, -6, o), sc = down > 0 ? lerp(1.2, 1, down) : lerp(0.2, 1.2, o);
  return { opacity: seg(f, 0, 0.45), transform: f >= 1 ? "none" : `translateY(${y.toFixed(1)}%) scale(${sc.toFixed(3)})` };
}
/** 大字順風飄入定位；回傳大字、暗底、名字的樣子 */
export function sakuraTitlePose(ms: number) {
  const z = outC(seg(ms, SAKURA_TL.zimo, SAKURA_TL.zimo + 360));
  return {
    art: { opacity: z, transform: z >= 1 ? "none" : `translate(${(-(1 - z) * 40).toFixed(1)}px, ${(-(1 - z) * 14).toFixed(1)}px) scale(${(0.9 + 0.1 * z).toFixed(3)})` },
    back: seg(ms, SAKURA_TL.zimo - 80, SAKURA_TL.zimo + 140),
    name: seg(ms, SAKURA_TL.name, SAKURA_TL.name + 260),
  };
}
/** 減少動態 1.6 秒：0～0.18 暗幕和花瓣、0.18～0.42 牌和大字、0.38～0.62 名字淡入；不動、不推、不閃 */
export const sakuraStillPose = (ms: number) => ({ base: seg(ms, 0, 180), main: seg(ms, 180, 420), name: seg(ms, 380, 620) });
const SAKURA_STILL_END = 620;

type Styled = { style: Partial<CSSStyleDeclaration> };
export type SakuraEls = { cv: HTMLCanvasElement; dim?: Styled | null; tile?: Styled | null; tileIn?: Styled | null; title?: Styled | null; art?: Styled | null; back?: Styled | null; name?: Styled | null; stage?: Styled | null };
/**
 * 播一次櫻花紛飛：回傳 setSheet（花瓣表解碼好才給）和 stop（跳過、卸載時呼叫，可重複呼叫）。
 * 全程只有這一個 requestAnimationFrame 迴圈，播完或 stop 就放掉畫布、圖片；stageShadow＝推畫面時蓋住牌桌邊緣的陰影。
 */
export function runSakura(els: SakuraEls, g: SakuraGeo, o: { dpr: number; rm: boolean; zeroAt: number; stageShadow: string; raf?: (f: (now: number) => void) => number; caf?: (id: number) => void }) {
  const raf = o.raf ?? requestAnimationFrame, caf = o.caf ?? cancelAnimationFrame;
  const { dim, tile, tileIn, title, art, back, name, stage, cv } = els;
  const fx = new SakuraCanvas(cv, g, o.dpr);
  let id = 0, stopped = false, pushed = false;
  const setOp = (e: Styled | null | undefined, v: number) => { if (e) e.style.opacity = v.toFixed(3); };
  const clearPush = () => { if (stage && pushed) { stage.style.transform = ""; stage.style.boxShadow = ""; pushed = false; } };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    caf(id);
    clearPush();
    fx.destroy();
  };
  if (o.rm) {
    fx.draw(SAKURA_STILL_MS);
    const step = (now: number) => {
      if (stopped) return;
      const ms = now - o.zeroAt, p = sakuraStillPose(ms);
      setOp(cv as unknown as Styled, p.base); setOp(dim, 0.58 * p.base); setOp(tileIn, p.main); setOp(art, p.main); setOp(back, p.main); setOp(name, p.name);
      if (ms < SAKURA_STILL_END) id = raf(step);
    };
    id = raf(step);
  } else {
    const gov = frameGovernor();
    let last = o.zeroAt;
    const step = (now: number) => {
      if (stopped) return;
      const ms = now - o.zeroAt;
      fx.scale = gov(now - last);
      last = now;
      if (ms >= SAKURA_TL.total) { setOp(tile, 0); setOp(title, 0); clearPush(); fx.destroy(); return; }
      fx.draw(ms);
      setOp(dim, sakuraDim(ms));
      const pose = sakuraTilePose(ms), t = sakuraTitlePose(ms), fo = sakuraFadeOut(ms);
      if (tileIn) { tileIn.style.opacity = pose.opacity.toFixed(3); tileIn.style.transform = pose.transform; }
      if (art) { art.style.opacity = t.art.opacity.toFixed(3); art.style.transform = t.art.transform; }
      setOp(back, t.back); setOp(name, t.name); setOp(tile, fo); setOp(title, fo);
      if (stage) {
        const sx = sakuraPush(ms, g.rel, g.mobile);
        if (sx) { stage.style.transform = `translateX(${sx.toFixed(1)}px)`; stage.style.boxShadow = o.stageShadow; pushed = true; } else clearPush();
      }
      id = raf(step);
    };
    id = raf(step);
  }
  return { stop, setSheet: (img: HTMLImageElement) => { if (stopped) return; fx.setSheet(img); if (o.rm) fx.draw(SAKURA_STILL_MS); } };
}
