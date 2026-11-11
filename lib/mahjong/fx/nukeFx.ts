// 核彈自摸（nuke，老闆 2026-11-10 定案）。專屬特效：只有指定的那個帳號能選（jeff 門清一摸三，不是老闆），
// 和如來神掌同一條路（lib/mahjong/zimoFx/rules.ts 的 EXCLUSIVE_FX 對應表）。
// 敘事（老闆 2026-11-10 定案）：Q 版金正恩從胡牌者那一側登場比讚 → 飛彈從他身後竄出、走拋物線砸向胡牌者的位置
//   → 核爆白閃、火球、衝擊波 → 蕈狀雲升起 → 「自摸」大字 → 他還在火光前比讚。
// 老闆 2026-11-10：這一款不出「自摸的那張牌」、也不出自摸者的名字（winShow 的 fxShowsTile／fxShowsName），
//   大字直接借如來神掌那張素材。畫面上沒有那兩個元素時，下面的 setOp 自然略過，時間軸的 tile／name 留著給節奏和音效對點。
// 素材三件：Q 版金正恩的四個姿勢表（gen-nuke-poses.mjs；四格的頭會自動對齊）、Q 版飛彈（gen-nuke-assets.mjs；會自動轉正成彈頭朝右）、
//   爆炸的 16 格序列幀（gen-nuke-boom.mjs；老闆 2026-11-11 出圖）。大字借如來神掌那張。
// 火球、蕈狀雲、衝擊波、碎片、煙、地面焦痕、白閃、金屑、飛彈尾焰全部是程式畫的，不吃圖檔——
//   好處是換配色、改節奏只動這支，不用重出素材，也不會踩長期快取「同檔名換內容」的坑。
// 單一畫布，畫面只由時間決定（draw(ms)），沒有 Web Animation、沒有每格 shadowBlur（和 rulaiFx 同一套作法）。
import { clamp, frameGovernor, inC, lerp, outC, rng, sakuraStillPose, seg, sm, type SakuraEls, type SakuraGeo } from "./canvasFx";

/** 時間軸（ms，從特效開始算；音效 zimo-nuke-*.mp3 的 0 秒＝這裡的 0，爆炸聲對在 hit） */
export const NUKE_TL = { enter: 260, launch: 900, hit: 1800, boom: 1870, tile: 2400, zimo: 2780, name: 3020, total: 4600 };
/** 要載的圖（依裝置選 -d／-m，見 ZimoFx 的 zfxArt） */
export const NUKE_ART = ["kim-set-v2", "missile", "boom-v2"] as const;
export type NukeArt = (typeof NUKE_ART)[number];
/** 人物的四個姿勢（scripts/gen-nuke-poses.mjs 產，2×2 的方格表，四格的頭已經對齊到同一個位置）。
 *  姿勢照劇情換，不是逐格動畫：站著 → 指天大吼 → 摀耳朵 → 大笑比讚。
 *  格子是正方形，人物頭頂在格高 6% 處、腳到格底，所以畫的時候整格等比貼上就好。 */
export const NUKE_POSES = { cols: 2, rows: 2, n: 4 } as const;
/** 哪一刻用哪一個姿勢（索引對應上面的順序） */
export function nukePose(ms: number): number {
  const T = NUKE_TL;
  if (ms < T.launch) return 0;              // 登場：站著
  if (ms < T.hit - 60) return 1;            // 飛彈在天上：指著大吼
  if (ms < T.hit + 760) return 2;           // 命中前一瞬到爆完：摀耳朵
  return 3;                                 // 收尾：大笑比讚
}
/** 飛彈圖的長寬比（寬÷高）：同上的 missileAR。素材已經轉正成彈頭朝右，畫的時候直接轉到飛行角度 */
export const NUKE_MISSILE_AR = 2.3869;
/** 爆炸序列幀（老闆 2026-11-11 出圖，scripts/gen-nuke-boom.mjs 產）：4×4＝16 格，從左上往右逐列排。
 *  dur＝整段播完的毫秒數（16 格約 17fps，和素材的張數相稱；再快會看到跳格） */
export const NUKE_BOOM = { cols: 4, rows: 4, frames: 16, dur: 940 } as const;
/** 減少動態：畫這一刻的靜止畫面（爆完、蕈狀雲在、沒有閃光和震動） */
export const NUKE_STILL_MS = 2600;
const STILL_END = 620;

/** 手機／電腦上限：畫布倍率、碎片、煙團、金屑、衝擊環、蕈狀雲的團塊數、烘圖邊長 */
export const NUKE_LIMIT = {
  mobile: { dpr: 1.5, debris: 14, smoke: 10, sparks: 48, rings: 2, puffs: 9, tex: 192 },
  desktop: { dpr: 2, debris: 24, smoke: 16, sparks: 110, rings: 3, puffs: 14, tex: 256 },
} as const;

/** 地面效果壓扁（和牌桌視角一致，同 rulaiFx 的 SQ） */
const SQ = 0.54;
const TAU = Math.PI * 2;
/** 勝者在我的哪一邊：從桌心指向勝者（0 自己＝下、1 下家＝右、2 對家＝上、3 上家＝左），同 ZimoFx 的 SIDE */
const SIDE = [[0, 1], [1, 0], [0, -1], [-1, 0]] as const;

/** 暗幕：開場壓下來，播到結束都留著（結算接手時牌桌不會先亮一下） */
export const nukeDim = (ms: number) => 0.66 * sm(seg(ms, 0, 420));
/** 整體淡出（最後 0.4 秒） */
const fadeOut = (ms: number) => 1 - sm(seg(ms, NUKE_TL.total - 400, NUKE_TL.total));

/** 牌從爆心炸出來、停在那裡 */
export function nukeTilePose(ms: number) {
  const f = seg(ms, NUKE_TL.tile, NUKE_TL.tile + 420);
  if (ms < NUKE_TL.tile) return { opacity: 0, transform: "translateY(26%) scale(0.2)" };
  const up = seg(f, 0, 0.72), down = seg(f, 0.72, 1), o = outC(up);
  const y = down > 0 ? lerp(-8, 0, down) : lerp(26, -8, o);
  const sc = down > 0 ? lerp(1.24, 1, down) : lerp(0.2, 1.24, o);
  return { opacity: seg(f, 0, 0.4), transform: f >= 1 ? "none" : `translateY(${y.toFixed(1)}%) scale(${sc.toFixed(3)})` };
}

/** 「自摸」大字：被爆風往上推一下再落定 */
export function nukeTitlePose(ms: number) {
  const z = outC(seg(ms, NUKE_TL.zimo, NUKE_TL.zimo + 340));
  return {
    art: { opacity: z, transform: z >= 1 ? "none" : `translateY(${((1 - z) * 26).toFixed(1)}px) scale(${(0.86 + 0.14 * z).toFixed(3)})` },
    back: seg(ms, NUKE_TL.zimo - 80, NUKE_TL.zimo + 140),
    name: seg(ms, NUKE_TL.name, NUKE_TL.name + 260),
  };
}

/** 主擊的震動：核爆比隕石重，手機 18px、電腦 24px，0.55 秒衰減 */
export function nukeShake(ms: number, mobile: boolean): [number, number] {
  const p = seg(ms, NUKE_TL.hit, NUKE_TL.hit + 550);
  if (p <= 0 || p >= 1) return [0, 0];
  const A = (mobile ? 18 : 24) * Math.pow(1 - p, 2);
  const t = (ms - NUKE_TL.hit) / 1000;
  return [Math.sin(t * 74) * A, Math.cos(t * 61) * A * 0.72];
}

/** 鏡頭：命中那一刻往前頂一下 */
export const nukeCam = (ms: number) => 1 + 0.045 * Math.pow(1 - seg(ms, NUKE_TL.hit, NUKE_TL.hit + 460), 2) * (ms > NUKE_TL.hit ? 1 : 0);

/**
 * 開播前先烘兩張小圖（煙團、火球），播放時只是旋轉縮放疊上去。
 * 為什麼：canvas 的漸層沒有紋理，純漸層畫出來的火球像光斑、煙像橢圓，和其他款（雷霆那批有十幾張
 * 美術圖層）比就是樸素。烘一次紋理＝不用下載素材也有細節，而且每一格只多幾個 drawImage，
 * 比播放中開 filter／shadowBlur 便宜得多（那兩個在這套規範裡是禁止的）。同櫻花 bakeGlow、神掌烘小圖的做法。
 */
function bakeTex(size: number, seed: number, warm: boolean): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const x = c.getContext("2d")!;
  const R = size / 2, r = rng(seed);
  const base = x.createRadialGradient(R, R, R * 0.06, R, R, R);
  if (warm) {
    base.addColorStop(0, "rgba(255,252,238,0.98)");
    base.addColorStop(0.26, "rgba(255,226,130,0.92)");
    base.addColorStop(0.58, "rgba(255,132,36,0.66)");
    base.addColorStop(1, "rgba(150,34,10,0)");
  } else {
    base.addColorStop(0, "rgba(86,76,68,0.9)");
    base.addColorStop(0.45, "rgba(62,54,48,0.52)");
    base.addColorStop(1, "rgba(44,38,34,0)");
  }
  x.fillStyle = base;
  x.beginPath(); x.arc(R, R, R, 0, TAU); x.fill();
  // 翻滾的團塊：一次畫好，播放時整張轉、整張縮
  x.globalCompositeOperation = warm ? "lighter" : "source-over";
  for (let i = 0; i < (warm ? 70 : 90); i++) {
    const a = r() * TAU, d = r() * R * 0.74, rr = R * (0.1 + r() * 0.26);
    const bx = R + Math.cos(a) * d, by = R + Math.sin(a) * d;
    const fall = 1 - d / R;                                   // 越外圈越淡，邊緣才不會像圓盤
    const g = x.createRadialGradient(bx, by, 0, bx, by, rr);
    if (warm) {
      g.addColorStop(0, `rgba(255,${190 + Math.round(r() * 60)},${90 + Math.round(r() * 80)},${(0.26 * fall).toFixed(3)})`);
      g.addColorStop(1, "rgba(255,110,24,0)");
    } else {
      const v = 54 + Math.round(r() * 66);                  // 深褐灰為主，少數亮一點的團塊當受光面
      g.addColorStop(0, `rgba(${v},${v - 9},${v - 16},${(0.34 * fall).toFixed(3)})`);
      g.addColorStop(1, "rgba(38,32,28,0)");
    }
    x.fillStyle = g;
    x.beginPath(); x.arc(bx, by, rr, 0, TAU); x.fill();
  }
  x.globalCompositeOperation = "source-over";
  return c;
}

/** 飛彈在 t（0～1）時走到哪：從人物身後拋到落點，中間拱起 */
function missileAt(t: number, sx: number, sy: number, px: number, py: number, arc: number) {
  const x = lerp(sx, px, t);
  const y = lerp(sy, py, t) - Math.sin(t * Math.PI) * arc;
  return [x, y] as const;
}

export class NukeCanvas {
  private x: CanvasRenderingContext2D;
  private dpr: number;
  private L: { dpr: number; debris: number; smoke: number; sparks: number; rings: number; puffs: number; tex: number };
  private debris: { a: number; R: number; up: number; s: number; spin: number; rot: number; ph: number }[];
  private smoke: { a: number; R: number; s: number; ph: number; rise: number }[];
  private sparks: { a: number; R: number; s: number; ph: number }[];
  /** 蕈狀雲的團塊（柱＋頭各幾球，固定亂數） */
  private puffs: { cap: boolean; a: number; d: number; up: number; s: number; rot: number; spin: number; ph: number }[];
  /** 烘好的紋理：煙團、火球 */
  private tex: { smoke: HTMLCanvasElement; fire: HTMLCanvasElement };
  /** 粒子比例（自動降級，frameGovernor 給） */
  scale = 1;
  /** 上一格畫了幾個零件（驗收用） */
  lastCount = 0;
  constructor(private cv: HTMLCanvasElement, private g: SakuraGeo, private art: Partial<Record<NukeArt, HTMLImageElement>>, devicePixelRatio: number) {
    const L = (this.L = g.mobile ? NUKE_LIMIT.mobile : NUKE_LIMIT.desktop);
    this.dpr = Math.min(devicePixelRatio || 1, L.dpr);
    cv.width = Math.round(g.W * this.dpr);
    cv.height = Math.round(g.H * this.dpr);
    this.x = cv.getContext("2d")!;
    const u = g.u, r = rng(4521);
    // 固定亂數：每次播都一樣，不會這局好看下局怪
    this.debris = Array.from({ length: L.debris }, () => ({
      a: r() * TAU, R: u * (0.4 + r() * 0.95), up: u * (0.3 + r() * 0.7),
      s: u * (0.016 + r() * 0.026), spin: (r() - 0.5) * 11, rot: r() * TAU, ph: r(),
    }));
    this.smoke = Array.from({ length: L.smoke }, (_, i) => ({
      a: (i / L.smoke) * TAU + r() * 0.5, R: u * (0.3 + r() * 0.5),
      s: u * (0.18 + r() * 0.2), ph: r(), rise: u * (0.1 + r() * 0.3),
    }));
    this.sparks = Array.from({ length: L.sparks }, () => ({ a: r() * TAU, R: u * (0.25 + r() * 1.25), s: 1 + r() * 2.4, ph: r() }));
    // 蕈狀雲：前三分之一是柱子（沿著中軸往上疊），其餘是頭（繞一圈外翻）
    this.puffs = Array.from({ length: L.puffs }, (_, i) => {
      const stemN = Math.max(3, Math.round(L.puffs * 0.36)), cap = i >= stemN;
      const k = cap ? (i - stemN) / Math.max(1, L.puffs - stemN) : i / stemN;
      return cap
        ? { cap, a: k * TAU + r() * 0.4, d: 0.5 + r() * 0.46, up: 0.94 + r() * 0.12, s: 0.4 + r() * 0.22, rot: r() * TAU, spin: (r() - 0.5) * 0.7, ph: r() }
        : { cap, a: 0, d: (r() - 0.5) * 0.2, up: 0.08 + k * 0.78, s: 0.26 + r() * 0.14, rot: r() * TAU, spin: (r() - 0.5) * 0.5, ph: r() };
    });
    this.tex = { smoke: bakeTex(L.tex, 7321, false), fire: bakeTex(L.tex, 1559, true) };
  }

  destroy() {
    this.cv.width = 0;
    this.cv.height = 0;
    this.debris = [];
    this.smoke = [];
    this.sparks = [];
    this.puffs = [];
    this.tex.smoke.width = this.tex.smoke.height = 0;  // 烘好的小圖也要放掉，不然跟著畫面留著
    this.tex.fire.width = this.tex.fire.height = 0;
    this.art = {};
  }

  /** 開播前試畫一格：把「第一次用這張圖」的材質上傳成本挪到這裡（同 rulai 的 prime） */
  prime() {
    this.draw(NUKE_TL.hit + 120);
    this.x.setTransform(1, 0, 0, 1, 0, 0);
    this.x.clearRect(0, 0, this.cv.width, this.cv.height);
  }

  draw(ms: number) {
    const { x, dpr, L } = this, { W, H, u, px, py, rel } = this.g, T = NUKE_TL;
    const S = this.scale, fade = fadeOut(ms);
    let count = 0;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, W, H);
    if (fade <= 0) { this.lastCount = 0; return; }

    // ── 人物站的位置：一定站在落點的「另一邊」，不然會整個蓋住爆心 ──────────
    // 進場方向照胡牌者那一側（sxDir／syDir 只決定滑入的方向），站的位置則取離落點遠的那半邊。
    const [sxDir, syDir] = SIDE[rel];
    // 姿勢表的格子是正方形，人物約佔格高 94%（頭頂留 6%）；
    // 原本單張是裁到人物邊界的，所以這裡要放大一點才會是同樣的視覺大小
    const kimH = u * (this.g.mobile ? 0.49 : 0.58), kimW = kimH;
    const toRight = px < W / 2;                      // 落點偏左 → 人站右邊，反之亦然
    const kimX = toRight ? W - kimW * 0.58 : kimW * 0.58;
    const kimY = H * 0.99;                           // 腳貼畫面底（drawImage 用底邊對齊）

    // ── 0～launch：警報紅光（畫面邊緣脈動） ─────────────────────────────
    const alert = sm(seg(ms, 120, 520)) * (1 - sm(seg(ms, T.launch, T.hit))) * fade;
    if (alert > 0.01) {
      const pulse = 0.5 + 0.5 * Math.sin((ms / 1000) * 11);
      const gr = x.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.26, W / 2, H / 2, Math.max(W, H) * 0.72);
      gr.addColorStop(0, "rgba(210,32,28,0)");
      gr.addColorStop(1, `rgba(228,38,30,${(0.5 * alert * (0.55 + 0.45 * pulse)).toFixed(3)})`);
      x.fillStyle = gr;
      x.fillRect(0, 0, W, H);
      count++;
    }

    // ── 地面焦痕：命中後出現，留到最後 ──────────────────────────────────
    const scorch = sm(seg(ms, T.hit, T.hit + 320)) * fade;
    if (scorch > 0.01) {
      const R = u * 0.62 * (0.8 + 0.2 * sm(seg(ms, T.hit, T.hit + 900)));
      const gr = x.createRadialGradient(px, py, 0, px, py, R);
      gr.addColorStop(0, `rgba(16,10,8,${(0.86 * scorch).toFixed(3)})`);
      gr.addColorStop(0.62, `rgba(44,22,12,${(0.6 * scorch).toFixed(3)})`);
      gr.addColorStop(1, "rgba(60,30,14,0)");
      x.save();
      x.translate(px, py); x.scale(1, SQ); x.translate(-px, -py);
      x.fillStyle = gr;
      x.beginPath(); x.arc(px, py, R, 0, TAU); x.fill();
      x.restore();
      count++;
    }

    // ── 地面裂紋：命中後從爆心裂出去的幾道，留到最後 ──────────────────────
    const crack = sm(seg(ms, T.hit, T.hit + 260)) * fade;
    if (crack > 0.01) {
      x.save();
      x.translate(px, py); x.scale(1, SQ); x.translate(-px, -py);
      x.strokeStyle = `rgba(12,8,6,${(0.72 * crack).toFixed(3)})`;
      x.lineCap = "round";
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + 0.6, len = u * (0.42 + (i % 3) * 0.16) * crack;
        const mx = px + Math.cos(a + 0.18) * len * 0.55, my = py + Math.sin(a + 0.18) * len * 0.55;
        x.lineWidth = u * 0.014 * (1 - i * 0.08);
        x.beginPath();
        x.moveTo(px, py);
        x.quadraticCurveTo(mx, my, px + Math.cos(a) * len, py + Math.sin(a) * len);
        x.stroke();
      }
      x.restore();
      count++;
    }

    // ── 蕈狀雲：用烘好的煙團堆出來（柱 → 頭），命中後升起 ────────────────────
    // 原本是「一條漸層柱 + 一顆橢圓」，太幾何；改成十幾球烘好的煙各自旋轉、縮放，才有翻滾的體積感。
    // 高度仍夾在落點到畫面頂之間：u*1.25 在一般牌桌上會整朵衝出畫面外，什麼都看不到。
    const mush = seg(ms, T.boom + 120, T.total - 500);
    if (mush > 0) {
      const rise = outC(mush);
      const a = Math.min(1, seg(ms, T.boom + 120, T.boom + 520)) * fade * (1 - 0.3 * sm(seg(ms, T.total - 1400, T.total - 300)));
      const maxH = Math.max(u * 0.34, py - H * 0.1);           // 柱頂不超過畫面上緣下方一點
      const stemH = Math.min(u * 0.9, maxH) * rise;
      const capR = Math.min(u * 0.29, W * 0.16) * (0.42 + 0.58 * rise);
      // 頭再往上壓一次：團塊是以中心畫的，capY 只夾到柱頂還不夠，整顆頭會有一半在畫面外
      const capY = Math.max(py - stemH, capR * 0.55);
      const t = ms / 1000;
      for (const q of this.puffs) {
        // 柱子的球沿中軸往上疊、頭的球繞一圈外翻；每一球自己慢慢轉，越晚出現的越小
        const grow = seg(mush, q.ph * 0.35, q.ph * 0.35 + 0.5);
        if (grow <= 0) continue;
        const cx = q.cap ? px + Math.cos(q.a) * capR * q.d : px + q.d * u * 0.2 * rise;
        const cy = q.cap ? capY + Math.sin(q.a) * capR * 0.42 * q.d - capR * 0.1 : py - stemH * q.up;
        const R = (q.cap ? capR * q.s : u * 0.19 * q.s) * (0.7 + 0.3 * grow);
        x.save();
        x.translate(cx, cy);
        x.rotate(q.rot + q.spin * t);
        x.globalAlpha = a * grow * (q.cap ? 0.66 : 0.58);
        x.drawImage(this.tex.smoke, -R, -R * 0.86, R * 2, R * 1.72);
        x.restore();
        count++;
      }
      x.globalAlpha = 1;
      // 頭的下緣被底下的火光打亮（爆心還在燒的那段最明顯）
      const lit = a * (0.25 + 0.55 * (1 - seg(ms, T.hit, T.hit + 1500)));
      if (lit > 0.02) {
        x.globalCompositeOperation = "lighter";
        x.globalAlpha = lit * 0.42;
        x.drawImage(this.tex.fire, px - capR * 0.52, capY - capR * 0.02, capR * 1.04, capR * 0.6);
        x.globalAlpha = 1;
        x.globalCompositeOperation = "source-over";
        count++;
      }
    }

    x.globalCompositeOperation = "lighter";

    // ── 衝擊波環：命中後往外擴的壓扁橢圓環 ───────────────────────────────
    for (let i = 0; i < L.rings; i++) {
      const p = seg(ms, T.hit + i * 150, T.hit + i * 150 + 900);
      if (p <= 0 || p >= 1) continue;
      const R = u * (0.16 + outC(p) * 1.9), a = (1 - p) * (1 - p) * 0.72 * fade;
      x.save();
      x.translate(px, py); x.scale(1, SQ); x.translate(-px, -py);
      x.strokeStyle = `rgba(255,214,150,${a.toFixed(3)})`;
      x.lineWidth = u * 0.03 * (1 - p * 0.6);
      x.beginPath(); x.arc(px, py, R, 0, TAU); x.stroke();
      x.restore();
      count++;
    }

    // ── 爆炸本體：老闆出的 16 格序列幀，一格一個 drawImage ────────────────────
    // 真正的體積感只有序列幀做得到（單張縮放永遠像「一顆球變大」）。素材載不到就退回下面那套
    // 程式畫的三層火球，整段不會開天窗。
    const boom = this.art["boom-v2"];
    const bp = seg(ms, T.hit, T.hit + NUKE_BOOM.dur);
    const boomOk = !!boom && boom.complete && boom.naturalWidth > 0;
    if (boomOk && bp > 0 && bp < 1) {
      const idx = Math.min(NUKE_BOOM.frames - 1, Math.floor(bp * NUKE_BOOM.frames));
      const cw = boom!.naturalWidth / NUKE_BOOM.cols, chh = boom!.naturalHeight / NUKE_BOOM.rows;
      // 畫面上的半徑。素材每格只有 256px，放到滿版（放大 3 倍以上）會看到馬賽克；
      // 0.72u 大約是放大 2.6 倍，是「夠大又還看得清楚」的折衷。要再大就得換每格 512px 的來源。
      const R = u * 0.72;
      x.globalAlpha = fade * (1 - sm(seg(bp, 0.88, 1)));    // 最後一點淡出，接給蕈狀雲
      x.drawImage(boom!, (idx % NUKE_BOOM.cols) * cw, Math.floor(idx / NUKE_BOOM.cols) * chh, cw, chh,
        px - R, py - R * 1.04, R * 2, R * 2);
      x.globalAlpha = 1;
      count++;
    }

    // ── 火球（退路）：三層疊出來（外焰、內核、翻滾的紋理），然後收成餘燼 ───────
    // 單一 radial gradient 看起來像光斑；外焰用烘好的火紋理慢慢轉、內核另外壓一層亮心，才像在燒。
    const fb = boomOk ? 0 : seg(ms, T.hit, T.hit + 760);
    if (fb > 0 && fb < 1) {
      const R = u * (0.1 + outC(fb) * 0.78), a = (1 - inC(fb)) * fade;
      const spin = (ms - T.hit) / 1000;
      for (const [k, al, rot] of [[1.08, 0.9, spin * 0.5], [0.74, 0.75, -spin * 0.8], [0.44, 0.6, spin * 1.3]] as const) {
        x.save();
        x.translate(px, py);
        x.rotate(rot);
        x.globalCompositeOperation = "lighter";
        x.globalAlpha = a * al;
        x.drawImage(this.tex.fire, -R * k, -R * k, R * 2 * k, R * 2 * k);
        x.restore();
        count++;
      }
      x.globalAlpha = 1;
      x.globalCompositeOperation = "lighter";
      const gf = x.createRadialGradient(px, py - R * 0.1, 0, px, py, R * 0.5);
      gf.addColorStop(0, `rgba(255,255,246,${(0.95 * a).toFixed(3)})`);
      gf.addColorStop(0.5, `rgba(255,224,140,${(0.5 * a).toFixed(3)})`);
      gf.addColorStop(1, "rgba(255,120,30,0)");
      x.fillStyle = gf;
      x.beginPath(); x.arc(px, py, R * 0.5, 0, TAU); x.fill();
      count++;
    }
    // ── 二次爆：主爆之後再悶一下（偏一點，不對稱才不像重播） ──────────────────
    const fb2 = seg(ms, T.hit + 380, T.hit + 980);
    if (fb2 > 0 && fb2 < 1) {
      const R = u * (0.06 + outC(fb2) * 0.34), a = (1 - inC(fb2)) * fade * 0.72;
      x.save();
      x.translate(px - u * 0.18, py - u * 0.06);
      x.rotate(fb2 * 1.2);
      x.globalCompositeOperation = "lighter";
      x.globalAlpha = a;
      x.drawImage(this.tex.fire, -R, -R, R * 2, R * 2);
      x.restore();
      count++;
    }
    x.globalAlpha = 1;
    x.globalCompositeOperation = "lighter";

    // ── 金屑／火星：爆開後往外飛，慢慢落下 ───────────────────────────────
    const sparkN = Math.round(this.sparks.length * S);
    for (let i = 0; i < sparkN; i++) {
      const s = this.sparks[i];
      const dl = s.ph * 140, p = seg(ms, T.hit + dl, T.hit + dl + 1000 + s.ph * 500);
      if (p <= 0 || p >= 1) continue;
      const R = s.R * outC(p);
      const X = px + Math.cos(s.a) * R, Y = py + Math.sin(s.a) * R * SQ - Math.sin(p * Math.PI) * u * 0.3 + p * p * u * 0.22;
      x.globalAlpha = (1 - p) * fade;
      x.fillStyle = p < 0.4 ? "#fff0c4" : "#ff9a3c";
      x.beginPath(); x.arc(X, Y, s.s * (1 - p * 0.5), 0, TAU); x.fill();
      count++;
    }
    x.globalAlpha = 1;

    // ── 碎片：拋物線飛出去 ──────────────────────────────────────────────
    x.globalCompositeOperation = "source-over";
    const debN = Math.round(this.debris.length * S);
    for (let i = 0; i < debN; i++) {
      const b = this.debris[i];
      const dl = b.ph * 110, p = seg(ms, T.hit + dl, T.hit + dl + 820 + b.ph * 360);
      if (p <= 0 || p >= 1) continue;
      const R = b.R * outC(p);
      const X = px + Math.cos(b.a) * R, Y = py + Math.sin(b.a) * R * SQ - Math.sin(p * Math.PI) * b.up;
      const sc = b.s * (1 + 0.5 * Math.sin(p * Math.PI)), rt = b.rot + b.spin * p;
      const c2 = Math.cos(rt), s2 = Math.sin(rt);
      x.setTransform(c2 * dpr, s2 * dpr, -s2 * dpr, c2 * dpr, X * dpr, Y * dpr);
      x.globalAlpha = (1 - p * p) * fade;
      x.fillStyle = "#2b2420";
      x.fillRect(-sc, -sc * 0.72, sc * 2, sc * 1.44);
      count++;
    }
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.globalAlpha = 1;

    // ── 煙團：爆完往上飄散 ──────────────────────────────────────────────
    const smokeN = Math.round(this.smoke.length * S);
    for (let i = 0; i < smokeN; i++) {
      const s = this.smoke[i];
      const dl = s.ph * 200, p = seg(ms, T.boom + dl, T.boom + dl + 1500 + s.ph * 700);
      if (p <= 0 || p >= 1) continue;
      const R = s.R * outC(p), z = s.s * (0.7 + p * 0.9);
      const X = px + Math.cos(s.a) * R, Y = py + Math.sin(s.a) * R * SQ - p * s.rise - p * u * 0.12;
      x.globalAlpha = (1 - p) * 0.17 * fade;
      x.fillStyle = "#49403a";
      x.beginPath(); x.arc(X, Y, z, 0, TAU); x.fill();
      count++;
    }
    x.globalAlpha = 1;

    // ── 飛彈：從人物身後拋向落點（命中就消失）──────────────────────────────
    // 彈體是老闆出的去背圖（素材已經轉正成彈頭朝右，所以直接轉到飛行角度就好）；
    // 尾焰留程式畫：長度隨時間抖動、命中就收掉，做成圖反而僵硬。圖沒好就退回原本的向量彈體。
    const fly = seg(ms, T.launch, T.hit);
    if (fly > 0 && fly < 1) {
      const sx = kimX - sxDir * kimW * 0.3, sy = kimY - kimH * 0.62;
      const arc = u * 0.62;
      const [mx, my] = missileAt(fly, sx, sy, px, py, arc);
      const [ax, ay] = missileAt(Math.max(0, fly - 0.02), sx, sy, px, py, arc);
      const ang = Math.atan2(my - ay, mx - ax);
      const mw = u * 0.46, mh = mw / NUKE_MISSILE_AR;      // 畫面上的彈體長寬
      const len = mw / 2, rad = mh / 2;
      x.save();
      x.translate(mx, my);
      x.rotate(ang);
      // 尾焰（在彈體後面，先畫）
      x.globalCompositeOperation = "lighter";
      const gt = x.createLinearGradient(-len * 0.72, 0, -len * 2.3, 0);
      gt.addColorStop(0, "rgba(255,238,170,0.95)");
      gt.addColorStop(0.45, "rgba(255,150,48,0.6)");
      gt.addColorStop(1, "rgba(255,90,20,0)");
      x.fillStyle = gt;
      x.beginPath();
      x.moveTo(-len * 0.72, -rad * 0.5);
      x.lineTo(-len * (1.6 + 0.5 * Math.abs(Math.sin(ms / 40))), 0);
      x.lineTo(-len * 0.72, rad * 0.5);
      x.closePath();
      x.fill();
      x.globalCompositeOperation = "source-over";
      const mi = this.art.missile;
      if (mi && mi.complete && mi.naturalWidth > 0) {
        x.drawImage(mi, -len, -rad, mw, mh);
      } else {
        // 退回向量彈體：彈身、彈頭紅環、兩片尾翼（只有素材載不到才會看到）
        x.fillStyle = "#d8dae0";
        x.beginPath();
        x.moveTo(len, 0);
        x.quadraticCurveTo(len * 0.42, -rad, -len * 0.5, -rad);
        x.lineTo(-len * 0.5, rad);
        x.quadraticCurveTo(len * 0.42, rad, len, 0);
        x.closePath();
        x.fill();
        x.fillStyle = "#c4342a";
        x.beginPath();
        x.moveTo(len, 0);
        x.quadraticCurveTo(len * 0.66, -rad * 0.72, len * 0.46, -rad * 0.86);
        x.lineTo(len * 0.46, rad * 0.86);
        x.quadraticCurveTo(len * 0.66, rad * 0.72, len, 0);
        x.closePath();
        x.fill();
        x.fillStyle = "#9aa0ab";
        for (const sgn of [-1, 1]) {
          x.beginPath();
          x.moveTo(-len * 0.5, sgn * rad);
          x.lineTo(-len * 0.86, sgn * rad * 1.9);
          x.lineTo(-len * 0.3, sgn * rad * 0.9);
          x.closePath();
          x.fill();
        }
      }
      x.restore();
      count++;
    }


    // ── 金正恩：從那一側滑進來，照劇情換姿勢，爆炸時被火光照亮 ─────────────────
    const kim = this.art["kim-set-v2"];
    if (kim && kim.complete && kim.naturalWidth > 0) {
      const inP = sm(seg(ms, T.enter, T.enter + 420));
      if (inP > 0) {
        const pose = nukePose(ms);
        const cw = kim.naturalWidth / NUKE_POSES.cols, chh = kim.naturalHeight / NUKE_POSES.rows;
        const sxSrc = (pose % NUKE_POSES.cols) * cw, sySrc = Math.floor(pose / NUKE_POSES.cols) * chh;
        const slide = (1 - inP) * u * 0.42;
        const X = kimX + sxDir * slide, Y = kimY + syDir * slide * 0.5;
        // 命中時被往後震一下
        const kick = Math.pow(1 - seg(ms, T.hit, T.hit + 420), 2) * (ms > T.hit ? 1 : 0) * u * 0.05;
        const sc = 0.88 + 0.12 * inP;
        const w = kimW * sc, h = kimH * sc;
        const dx = X - w / 2 + sxDir * kick, dy = Y - h + syDir * kick * 0.4;
        x.globalAlpha = inP * fade;
        x.drawImage(kim, sxSrc, sySrc, cw, chh, dx, dy, w, h);
        // 爆炸的暖光打在人物身上
        const lit = (1 - seg(ms, T.hit, T.hit + 700)) * (ms > T.hit ? 1 : 0);
        if (lit > 0.02) {
          x.globalCompositeOperation = "lighter";
          x.globalAlpha = lit * 0.34 * fade;
          x.drawImage(kim, sxSrc, sySrc, cw, chh, dx, dy, w, h);
          x.globalCompositeOperation = "source-over";
        }
        x.globalAlpha = 1;
        count++;
      }
    }

    // ── 白閃：命中那一格整個畫面白掉，很快退 ──────────────────────────────
    const flash = 1 - seg(ms, T.hit - 30, T.hit + 260);
    if (flash > 0 && ms > T.hit - 30) {
      x.globalCompositeOperation = "lighter";
      x.fillStyle = `rgba(255,250,235,${(flash * flash * 0.92 * fade).toFixed(3)})`;
      x.fillRect(0, 0, W, H);
      x.globalCompositeOperation = "source-over";
      count++;
    }

    this.lastCount = count;
  }
}

type Styled = { style: Partial<CSSStyleDeclaration> };

/**
 * 播一次核彈自摸：回傳 stop（跳過、換局、卸載時呼叫，可重複呼叫）。
 * 全程只有一個 requestAnimationFrame 迴圈；播完或 stop 就放掉畫布和圖片參照。
 */
export function runNuke(
  els: SakuraEls,
  g: SakuraGeo,
  art: Partial<Record<NukeArt, HTMLImageElement>>,
  o: { dpr: number; rm: boolean; zeroAt: () => number; stageShadow: string; raf?: (f: (now: number) => void) => number; caf?: (id: number) => void },
) {
  const raf = o.raf ?? requestAnimationFrame, caf = o.caf ?? cancelAnimationFrame;
  const { dim, tile, tileIn, title, art: artEl, back, name, stage, cv } = els;
  const fx = new NukeCanvas(cv, g, art, o.dpr);
  let id = 0, stopped = false, moved = false;
  const setOp = (e: Styled | null | undefined, v: number) => { if (e) e.style.opacity = v.toFixed(3); };
  // 收尾一律把三個 inline style 都清掉（不能只在震過的情況才清）：
  // transformOrigin 在開播就寫上去了，留著會被下一個特效的 transform 吃到，牌桌會從錯的點縮放（同 rulaiFx 的 clearStage）
  const clearStage = () => {
    if (stage) { stage.style.transform = ""; stage.style.boxShadow = ""; stage.style.transformOrigin = ""; moved = false; }
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    caf(id);
    clearStage();
    fx.destroy();
  };
  if (!o.rm) fx.prime();
  // 時間零點在試畫之後：試畫花的時間不算進特效，聲音也從這裡對齊
  const zeroAt = o.zeroAt();

  if (o.rm) {
    // 減少動態：定格在爆完的畫面，只有淡入，不震不閃
    fx.draw(NUKE_STILL_MS);
    const step = (now: number) => {
      if (stopped) return;
      const ms = now - zeroAt, p = sakuraStillPose(ms);
      setOp(cv as unknown as Styled, p.base); setOp(dim, 0.66 * p.base);
      setOp(tileIn, p.main); setOp(artEl, p.main); setOp(back, p.main); setOp(name, p.name);
      if (ms < STILL_END) id = raf(step);
    };
    id = raf(step);
  } else {
    const gov = frameGovernor();
    let last = zeroAt;
    if (stage) stage.style.transformOrigin = `${Math.round(g.px)}px ${Math.round(g.py)}px`;
    const step = (now: number) => {
      if (stopped) return;
      const ms = now - zeroAt;
      fx.scale = gov(now - last);
      last = now;
      if (ms >= NUKE_TL.total) { setOp(tile, 0); setOp(title, 0); clearStage(); fx.destroy(); return; }
      fx.draw(ms);
      setOp(dim, nukeDim(ms));
      const pose = nukeTilePose(ms), t = nukeTitlePose(ms), fo = fadeOut(ms);
      if (tileIn) { tileIn.style.opacity = pose.opacity.toFixed(3); tileIn.style.transform = pose.transform; }
      if (artEl) { artEl.style.opacity = t.art.opacity.toFixed(3); artEl.style.transform = t.art.transform; }
      setOp(back, t.back); setOp(name, t.name); setOp(tile, fo); setOp(title, fo);
      if (stage) {
        const [sx, sy] = nukeShake(ms, g.mobile), cam = nukeCam(ms);
        if (sx || sy || Math.abs(cam - 1) > 1e-4) {
          stage.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) scale(${cam.toFixed(4)})`;
          stage.style.boxShadow = o.stageShadow;
          moved = true;
        } else if (moved) { stage.style.transform = ""; stage.style.boxShadow = ""; moved = false; }
      }
      id = raf(step);
    };
    id = raf(step);
  }
  return { stop };
}
