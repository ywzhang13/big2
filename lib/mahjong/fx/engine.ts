// 麻將互動特效的播放引擎（小宜〈互動特效-5種定案規格-2026-10-20〉、原型 _engine.js／_keep_stream.js／_egg_water.js／_keep_punch.js）。
// 老闆遇過「只有聲音沒動畫、動畫只播一半」，所以照規格必做：
//   1. 先預載、先解碼：圖片 fetch 成 blob 網址，每張預先建好幾份 <img> 並 decode() 完，播放時直接拿池子裡的節點；Lottie 先在畫面外跑一次
//   2. 一次只播一個：其他的排隊，不疊加
//   3. 每個動畫和計時器都登記在「這一次播放」底下，全部結束（含之後才加進來的）才算播完；每次播放各自一份，計時器不互相干擾
//   4. 播完一定清乾淨：取消殘留動畫、清空特效層、拿掉名牌上的發光和抖動
//   5. 音效只在預載完成、圖片已經放上畫面之後才播
//   6. 分頁切到背景：正在播的立刻收掉、排隊的丟掉，回來時畫面是乾淨的
export type FxKind = "love" | "cash" | "egg" | "water" | "punch" | "clap";
export type FxView = "sender" | "victim" | "bystander";
export const FX_KINDS: FxKind[] = ["love", "cash", "egg", "water", "punch", "clap"];
export const FX_LABEL: Record<FxKind, string> = { love: "愛心", cash: "砸錢", egg: "丟雞蛋", water: "潑水桶", punch: "拳擊", clap: "拍手" };
// 分兩組（老闆 2026-10-21）：輕組（愛心、砸錢、拍手）可以同時播、也能疊在重組上；重組（雞蛋、潑水、拳擊）一次只播一個、排隊。
// 發送冷卻每組共用：輕組 5 秒、重組 10 秒（伺服器擋，畫面倒數只是提示）。拍手是第 6 種（老闆 2026-10-22 定案「D-五下」），歸輕組
export const FX_LIGHT: readonly FxKind[] = ["love", "cash", "clap"];
export const isLightFx = (k: FxKind) => FX_LIGHT.includes(k);
export const FX_COOLDOWN: Record<FxKind, number> = { love: 5000, cash: 5000, egg: 10000, water: 10000, punch: 10000, clap: 5000 };

const BASE = "/mahjong-fx/";
const IMG = {
  heart: "heart-glossy.png", billA: "bill-classic.png", billB: "bill-green.png", coins: "coins-stack-melle.png",
  // 別人丟我：老闆給的正面拳套（拳套.png 依透明邊界裁切後置中成正方形，2026-10-21）
  gloveFront: "glove-front.webp",
  // 發送者／旁觀者飛過去的拳套：以「拳頭朝右的側面圖」為準，程式依飛行方向轉向／左右翻（換成老闆的圖只要換這個檔）
  gloveSide: "glove-side.png", crack: "glass-crack-thin.webp", star6: "star_06.png", star7: "star_07.png", spark5: "spark_05.png",
  light1: "light_01.png", eggWhole: "egg-lottie-whole.webp",
  // 潑水：老闆用 AI 生成的 3 張（2026-10-20），砸中名牌的水花和被潑的人中間的皇冠是同一張冰藍水花皇冠
  bucket: "bucket-water.webp", burst: "splash-crown-ice.webp", overlay: "splash-overlay.webp",
  // 拍手：飛過去用 Microsoft Fluent Emoji 的立體拍手靜態圖（MIT，授權文字在 public/mahjong-fx/LICENSE-MIT-Microsoft.txt）
  clap: "clap-fluent.png",
} as const;
type ImgKey = keyof typeof IMG;
// 圖檔的高寬比（畫的時候照比例，不拉變形）
const BUCKET_AR = 652 / 640, CROWN_AR = 1109 / 1200, OVERLAY_AR = 806 / 1400;
/** 圖的高寬比，從預載好的圖讀（換圖不用改程式） */
const arOf = (k: ImgKey, fallback: number) => { const i = MASTER[k]?.[0]; return i && i.naturalWidth ? i.naturalHeight / i.naturalWidth : fallback; };
// 每張圖預先建幾份：輕組最多 4 則同時播（LIGHT_MAX），愛心一則用 10 顆、砸錢一則用鈔票各 5 張＋金幣 1 疊，所以備 4 則的量
const COPIES: Partial<Record<ImgKey, number>> = { heart: 44, billA: 22, billB: 22, coins: 5, clap: 4 };
const SOUNDS = ["heart-tick", "heart-pluck1", "heart-pluck2", "heart-chime", "bill-swish", "coin-1", "coin-2", "coin-3", "coin-stack",
  "egg-crack1", "thud", "splash1", "splash2", "punch1", "punch2", "shatter1", "glass-heavy",
  "clap-hit-1", "clap-hit-2", "clap-hit-3", "clap-hit-4", "clap-hit-5"] as const;
type SoundKey = (typeof SOUNDS)[number];

// ---------------- 預載 ----------------
const URL_OF: Partial<Record<ImgKey, string>> = {};
const MASTER: Partial<Record<ImgKey, HTMLImageElement[]>> = {};
const POOL: Partial<Record<ImgKey, HTMLImageElement[]>> = {};
const BUF: Partial<Record<SoundKey, AudioBuffer>> = {};
let AC: AudioContext | null = null;
let MIX: AudioNode | null = null; // 所有特效音效的總出口：總音量 → 壓縮器 → 喇叭，疊在一起也不會爆音
let FX_GAIN: GainNode | null = null; // 互動音效總音量（設定的「互動音效」拉霸、靜音；0＝不出聲，動畫照播）
let masterGain = 1;
let eggLottie: { txt: string; w: number; h: number; fr: number; op: number } | null = null;
let clapAnim: Blob | null = null; // 拍手的動態 WebP（每次播用新的 blob 網址，動畫才會從第一格開始）
type LottieAnim = { addEventListener: (e: string, f: () => void) => void; setSpeed: (n: number) => void; playSegments: (s: number[], f: boolean) => void; goToAndStop: (f: number, isFrame: boolean) => void; destroy: () => void };
type LottieLib = { loadAnimation: (o: Record<string, unknown>) => LottieAnim };
let lottie: LottieLib | null = null;
let readyPromise: Promise<boolean> | null = null;
let ready = false;
export const isFxReady = () => ready;

function loadScript(src: string): Promise<void> {
  return new Promise((ok, bad) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => ok();
    s.onerror = () => bad(new Error(src));
    document.head.appendChild(s);
  });
}

async function loadImg(k: ImgKey) {
  const blob = await fetch(BASE + IMG[k]).then((r) => { if (!r.ok) throw new Error(IMG[k]); return r.blob(); });
  const url = URL.createObjectURL(blob);
  URL_OF[k] = url;
  const list: HTMLImageElement[] = [];
  for (let n = 0; n < (COPIES[k] ?? 2); n++) {
    const i = new Image();
    i.decoding = "sync";
    i.src = url;
    await i.decode();
    list.push(i);
  }
  MASTER[k] = list;
  POOL[k] = list.slice();
}

async function loadEgg() {
  if (!(window as unknown as { lottie?: LottieLib }).lottie) await loadScript(BASE + "lottie_light.min.js");
  lottie = (window as unknown as { lottie: LottieLib }).lottie;
  const txt = await fetch(BASE + "lottie-egg-broken.json").then((r) => r.text());
  const j = JSON.parse(txt) as { w: number; h: number; fr: number; op: number };
  eggLottie = { txt, w: j.w, h: j.h, fr: j.fr, op: j.op };
  // 先在畫面外跑一次，讓動畫裡內嵌的圖先解碼
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;left:-9999px;top:0;width:40px;height:40px";
  document.body.appendChild(box);
  const a = lottie.loadAnimation({ container: box, renderer: "svg", loop: false, autoplay: false, animationData: JSON.parse(txt) });
  await new Promise<void>((r) => { a.addEventListener("DOMLoaded", () => r()); setTimeout(r, 3000); });
  a.goToAndStop(80, true);
  await new Promise((r) => setTimeout(r, 200));
  a.destroy();
  box.remove();
}

async function loadClap() {
  const blob = await fetch(BASE + "clap-anim.webp").then((r) => { if (!r.ok) throw new Error("clap-anim.webp"); return r.blob(); });
  clapAnim = blob;
  // 先解碼一次，第一次播不會等
  const u = URL.createObjectURL(blob), i = new Image();
  i.src = u;
  await i.decode().catch(() => {});
  URL.revokeObjectURL(u);
}

async function loadSounds() {
  try {
    AC ??= new AudioContext();
    if (!MIX) {
      const c = AC.createDynamicsCompressor();
      c.threshold.value = -14; c.knee.value = 8; c.ratio.value = 8; c.attack.value = 0.003; c.release.value = 0.25;
      c.connect(AC.destination);
      FX_GAIN = AC.createGain();
      FX_GAIN.gain.value = masterGain;
      FX_GAIN.connect(c);
      MIX = FX_GAIN;
    }
  } catch { return; }
  await Promise.all(SOUNDS.map(async (n) => {
    try {
      const ab = await fetch(`${BASE}s/${n}.mp3`).then((r) => r.arrayBuffer());
      BUF[n] = await AC!.decodeAudioData(ab);
    } catch { /* 這個音效載不到就安靜，動畫照播 */ }
  }));
}

/** 互動音效總音量（0＝靜音；1＝原本的大小）。改了立刻生效，正在播的音效也跟著變 */
export function setFxVolume(gain: number) {
  masterGain = Math.max(0, gain);
  if (FX_GAIN && AC) FX_GAIN.gain.setTargetAtTime(masterGain, AC.currentTime, 0.02);
}
export const getFxVolume = () => masterGain;

/** 進牌桌就呼叫：全部圖片解碼好、Lottie 跑過一次才算 ready（音效載不到不擋） */
export function preloadFx(): Promise<boolean> {
  readyPromise ??= (async () => {
    try {
      await Promise.all([...(Object.keys(IMG) as ImgKey[]).map(loadImg), loadEgg(), loadClap(), loadSounds()]);
      ready = true;
      return true;
    } catch (e) {
      console.warn("[mj-fx] 素材載入失敗", e);
      readyPromise = null; // 下次再試
      return false;
    }
  })();
  return readyPromise;
}

/** 手機要在使用者點擊時解鎖音效 */
export function unlockAudio() {
  if (AC && AC.state !== "running") void AC.resume().catch(() => {});
}

// ---------------- 一次播放（Run）：所有動畫、計時器都登記在這裡 ----------------
class Run {
  p: Promise<unknown>[] = [];
  aborted = false;
  /** 這一則借走的池子圖片、加在名牌上的發光／抖動：收尾時只還自己的、只拿掉自己的 */
  imgs: [ImgKey, HTMLImageElement][] = [];
  marks: [Element, string][] = [];
  /** 這一則排進音訊時鐘的聲音（拍手會先排好之後才響的聲音）：中止時只停自己的，還沒到點的就不會響 */
  srcs: AudioScheduledSourceNode[] = [];
  // 計時器 → 時間到要做的事。中止時一樣要做（讓等它的 Promise 結束），不然 pump 會一直等下去
  private timers = new Map<ReturnType<typeof setTimeout>, () => void>();
  stats = { anims: 0, done: 0, imgs: 0, notReady: 0, sounds: 0 };
  /** layer：這一則自己的子圖層（掛在特效層底下）；同時播的幾則各有各的，收尾時只拿掉自己的 */
  constructor(public layer: HTMLElement, public muted: boolean) {}
  track<T>(p: Promise<T>): Promise<T> { this.p.push(p); return p; }
  timer(ms: number, done: () => void) {
    const t = setTimeout(() => { this.timers.delete(t); done(); }, ms);
    this.timers.set(t, done);
  }
  wait(ms: number) { return this.track(new Promise<void>((r) => this.timer(ms, r))); }
  later(ms: number, fn: () => void) {
    return this.track(new Promise<void>((r) => this.timer(ms, () => { try { if (!this.aborted) fn(); } finally { r(); } })));
  }
  /** 收尾：取消自己子圖層裡的動畫、拿掉子圖層、圖片還回池子、拿掉自己加的發光和抖動。不碰別則的東西 */
  cleanup() {
    this.layer.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    this.layer.remove();
    for (const [k, i] of this.imgs) {
      i.getAnimations().forEach((a) => a.cancel());
      i.remove();
      if (!POOL[k]!.includes(i)) POOL[k]!.push(i);
    }
    this.imgs = [];
    this.marks.forEach(([el, cls]) => el.classList.remove(cls));
    this.marks = [];
  }
  /** 中止：還沒到時間的計時器全部取消，但馬上收尾（later 的 fn 因為已中止不會執行），等它們的 Promise 都會結束；
   *  這一則排好的聲音也停掉（還沒到點的不會響） */
  stop() {
    this.aborted = true;
    this.srcs.forEach((s) => { try { s.stop(); } catch { /* 已經停了 */ } });
    this.srcs = [];
    const pending = [...this.timers.entries()];
    this.timers.clear();
    pending.forEach(([t, done]) => { clearTimeout(t); done(); });
  }
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

// ---------------- 跟著螢幕調整大小 ----------------
// 規格的 px 是照手機 844×390 調的：以 844×390 為 1 倍，依畫面寬、高比例較小的那個縮放，限制在 0.75～1.6 倍
// （小手機不擠、大螢幕不誇張）。每次播放開始時重算，所以轉螢幕、改視窗大小後，下一次播放就用新的大小。
// 皇冠水花、裂紋、暗角本來就照螢幕算，不再乘。
export const FX_SCALE_MIN = 0.75, FX_SCALE_MAX = 1.6;
export function fxScale(w = innerWidth, h = innerHeight) {
  return Math.min(FX_SCALE_MAX, Math.max(FX_SCALE_MIN, Math.min(w / 844, h / 390)));
}
let SC = 1;
const z = (n: number) => n * SC;
const T = (x: number, y: number, s = 1, r = 0, w = 0, h = 0) => `translate(${x - w / 2}px,${y - h / 2}px) rotate(${r}deg) scale(${s})`;
type Pt = { x: number; y: number; el?: HTMLElement | null };

function plate(seat: number): Pt {
  const el = document.querySelector<HTMLElement>(`[data-fx-seat="${seat}"]`);
  const r = el?.getBoundingClientRect();
  if (!r) return { x: innerWidth / 2, y: innerHeight / 2, el: null };
  // 桌機左右家的名牌貼著螢幕邊：特效落點往內收，愛心、水花才不會被切掉一半；名牌本身照樣發光、抖動。
  // 手機橫向（高度 ≤ 500）照原型，不收（844×390 維持和定案一樣）
  const m = innerHeight > 500 ? z(48) : 0;
  const clamp = (v: number, max: number) => Math.min(max - m, Math.max(m, v));
  return { x: clamp(r.left + r.width / 2, innerWidth), y: clamp(r.top + r.height / 2, innerHeight), el };
}

function mk(run: Run, k: ImgKey, w: number, h?: number): HTMLImageElement {
  let i = POOL[k]?.pop();
  if (!i) { i = new Image(); i.src = URL_OF[k] ?? BASE + IMG[k]; } // 池子用完才臨時建（正常不會發生，會被記成 notReady）
  i.style.cssText = "";
  i.style.width = w + "px";
  if (h) i.style.height = h + "px";
  i.style.opacity = "0";
  i.dataset.k = k; // 哪一張素材（量大小、除錯用）
  run.layer.appendChild(i);
  if (MASTER[k]?.includes(i)) run.imgs.push([k, i]);
  // 池子裡的圖會重複使用：上一次留在圖上的動畫（已播完、停在最後一格）要先取消。
  // 圖離開畫面時瀏覽器列不出它的動畫，所以要放回畫面後才清得到
  i.getAnimations().forEach((a) => a.cancel());
  run.stats.imgs++;
  if (!(i.complete && i.naturalWidth > 0)) run.stats.notReady++;
  return i;
}

function tinted(run: Run, k: ImgKey, w: number, color: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = "tint";
  d.dataset.k = k;
  const url = URL_OF[k] ?? BASE + IMG[k];
  d.style.cssText = `width:${w}px;height:${w}px;background:${color};-webkit-mask-image:url(${url});mask-image:url(${url});opacity:0`;
  run.layer.appendChild(d);
  return d;
}

function anim(run: Run, el: HTMLElement, frames: Keyframe[], opt: KeyframeAnimationOptions) {
  const a = el.animate(frames, { fill: "forwards", ...opt });
  run.stats.anims++;
  return run.track(a.finished.then(() => { el.remove(); run.stats.done++; }, () => el.remove()));
}

function flyPath(run: Run, el: HTMLElement, a: Pt, b: Pt, o: { dur?: number; bend?: number; spin?: number; s0?: number; s1?: number; ease?: string; w: number; h: number }) {
  const { dur = 420, bend = 60, spin = 0, s0 = 0.7, s1 = 1, ease = "cubic-bezier(.35,.05,.55,1)", w, h } = o;
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len, bd = z(bend);
  const c = { x: (a.x + b.x) / 2 + nx * bd, y: (a.y + b.y) / 2 + ny * bd - Math.abs(bd) * 0.4 };
  const fr: Keyframe[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12, u = 1 - t;
    fr.push({ transform: T(u * u * a.x + 2 * u * t * c.x + t * t * b.x, u * u * a.y + 2 * u * t * c.y + t * t * b.y, s0 + (s1 - s0) * t, spin * t, w, h), opacity: 1 });
  }
  run.stats.anims++;
  return run.track(el.animate(fr, { duration: dur, easing: ease, fill: "forwards" }).finished.then(() => { run.stats.done++; }, () => {}));
}

function burst(run: Run, k: ImgKey, p: Pt, px: number, color: string, dur = 380) {
  const size = z(px);
  const d = tinted(run, k, size, color);
  return anim(run, d, [
    { transform: T(p.x, p.y, 0.2, 0, size, size), opacity: 1 },
    { transform: T(p.x, p.y, 1.15, 40, size, size), opacity: 0.9, offset: 0.5 },
    { transform: T(p.x, p.y, 1.35, 60, size, size), opacity: 0 },
  ], { duration: dur, easing: "ease-out" });
}

function glow(run: Run, el: HTMLElement | null | undefined, cls: string, ms: number) {
  if (!el) return;
  el.classList.add(cls);
  run.marks.push([el, cls]);
  run.later(ms, () => el.classList.remove(cls));
}
function shake(run: Run, el: Element | null | undefined, cls = "mjfx-shk") {
  if (!el) return;
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
  run.marks.push([el, cls]);
  run.later(400, () => el.classList.remove(cls));
}
function vignette(run: Run, color: string, dur = 1200) {
  const d = document.createElement("div");
  d.className = "p";
  d.dataset.k = "vignette";
  d.style.cssText = `width:100vw;height:100vh;background:radial-gradient(ellipse at center,transparent 45%,${color} 100%);opacity:0`;
  run.layer.appendChild(d);
  return anim(run, d, [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], { duration: dur });
}
function snd(run: Run, n: SoundKey, rate = 1, vol = 0.8, delay = 0) {
  if (run.muted || run.aborted || !AC || !BUF[n] || masterGain === 0) return; // 互動音效靜音：不開始播（動畫照播）
  try {
    const s = AC.createBufferSource(), g = AC.createGain();
    s.buffer = BUF[n]!;
    s.playbackRate.value = rate;
    g.gain.value = vol / Math.sqrt(Math.max(1, playing())); // 同時播 n 則：每則音量 ÷ √n，再經過壓縮器
    s.connect(g).connect(MIX ?? AC.destination);
    s.start(AC.currentTime + delay / 1000);
    run.srcs.push(s);
    run.stats.sounds++;
  } catch { /* 安靜 */ }
}

// ---------------- 6 種特效（尺寸、秒數、音效照定案規格） ----------------
type Ctx = { run: Run; A: Pt; B: Pt; view: FxView };

async function stream(c: Ctx, love: boolean) {
  const { run, A, B } = c;
  const me = c.view === "victim";
  if (me) vignette(run, love ? "rgba(255,80,150,.38)" : "rgba(255,200,60,.32)", 1700);
  const n = love ? 9 : 10, baseW = z(love ? 46 : 62);
  const hits: Promise<unknown>[] = [];
  for (let i = 0; i < n; i++) {
    if (run.aborted) return;
    const k: ImgKey = love ? "heart" : i % 2 ? "billB" : "billA";
    const w = baseW * rand(0.85, 1.15), h = love ? w * 0.88 : w * 0.45;
    const el = mk(run, k, w, h);
    el.style.opacity = "1";
    const a = { x: A.x + rand(-8, 8), y: A.y + rand(-6, 6) }, b = { x: B.x + rand(-14, 14), y: B.y + rand(-10, 10) };
    const opt = love
      ? { dur: rand(480, 560), bend: rand(-90, 90), spin: rand(-25, 25), s0: 0.45, s1: 1.05, w, h, ease: "cubic-bezier(.3,.1,.4,1)" }
      : { dur: rand(300, 360), bend: rand(-40, 40), spin: rand(-540, 540), s0: 0.6, s1: 1, w, h, ease: "cubic-bezier(.5,0,.7,1)" };
    snd(run, love ? "heart-tick" : "bill-swish", love ? 1.4 + i * 0.05 : rand(1.1, 1.4), love ? 0.18 : 0.25);
    hits.push(flyPath(run, el, a, b, opt).then(() => {
      if (run.aborted) return;
      if (love) {
        snd(run, i % 2 ? "heart-pluck2" : "heart-pluck1", 1 + i * 0.07, 0.55);
        burst(run, "star6", b, 46, "radial-gradient(circle,#fff,#ff8fb8 55%,#ff3d7f)");
        anim(run, el, [{ transform: T(b.x, b.y, 1.05, 0, w, h), opacity: 1 }, { transform: T(b.x, b.y - 18, 1.5, 0, w, h), opacity: 0 }], { duration: 320, easing: "ease-out" });
      } else {
        snd(run, (["coin-1", "coin-2", "coin-3"] as const)[i % 3], rand(0.95, 1.35), 0.6);
        burst(run, "spark5", b, 42, "radial-gradient(circle,#fff,#ffe27a 50%,#e0a100)", 300);
        const vx = z(rand(-70, 70));
        anim(run, el, [
          { transform: T(b.x, b.y, 1, 0, w, h), opacity: 1 },
          { transform: T(b.x + vx * 0.5, b.y - z(rand(20, 36)), 0.9, rand(-90, 90), w, h), opacity: 1, offset: 0.35 },
          { transform: T(b.x + vx, b.y + z(rand(40, 70)), 0.75, rand(-180, 180), w, h), opacity: 0 },
        ], { duration: 520, easing: "cubic-bezier(.2,.6,.4,1)" });
      }
      if (i === 0) glow(run, B.el, love ? "mjfx-glow-love" : "mjfx-glow-cash", 1500);
      if (!love && i % 3 === 0) shake(run, B.el, "mjfx-shk-s");
    }));
    await run.wait(love ? 70 : 110); // 砸錢：鈔票間隔 55→110ms，整段加長約 0.5 秒（老闆 2026-10-20）
  }
  await hits[hits.length - 1];
  if (run.aborted) return;
  if (love) {
    snd(run, "heart-chime", 1, 0.6);
    const bw = z(96), bh = z(84), big = mk(run, "heart", bw);
    anim(run, big, [
      { transform: T(B.x, B.y - z(4), 0.2, 0, bw, bh), opacity: 0 }, { transform: T(B.x, B.y - z(8), 1.35, 0, bw, bh), opacity: 1, offset: 0.3 },
      { transform: T(B.x, B.y - z(10), 1.1, 0, bw, bh), opacity: 1, offset: 0.55 }, { transform: T(B.x, B.y - z(30), 1.25, 0, bw, bh), opacity: 0 },
    ], { duration: 900, easing: "ease-out" });
    burst(run, "light1", B, 140, "radial-gradient(circle,rgba(255,220,235,.9),rgba(255,90,150,.4) 60%,transparent)", 700);
  } else {
    snd(run, "coin-stack", 1, 0.7);
    const cw = z(86), st = mk(run, "coins", cw);
    anim(run, st, [
      { transform: T(B.x, B.y - z(6), 0.2, 0, cw, cw), opacity: 0 }, { transform: T(B.x, B.y - z(12), 1.2, 0, cw, cw), opacity: 1, offset: 0.3 },
      { transform: T(B.x, B.y - z(12), 1, 0, cw, cw), opacity: 1, offset: 0.7 }, { transform: T(B.x, B.y - z(26), 1, 0, cw, cw), opacity: 0 },
    ], { duration: 900, easing: "ease-out" });
    burst(run, "star7", B, 150, "radial-gradient(circle,#fff,#ffd34d 45%,rgba(224,161,0,.2))", 600);
  }
}

function playEggLottie(run: Run, P: Pt, W: number, speed: number) {
  const L = eggLottie!, H = (W * L.h) / L.w, ax = 366 / 700, ay = 240 / 525;
  const d = document.createElement("div");
  d.className = "p";
  d.dataset.k = "eggLottie";
  d.style.cssText = `left:${P.x - W * ax}px;top:${P.y - H * ay}px;width:${W}px;height:${H}px`;
  run.layer.appendChild(d);
  run.stats.anims++;
  return run.track(new Promise<void>((res) => {
    const an = lottie!.loadAnimation({ container: d, renderer: "svg", loop: false, autoplay: false, animationData: JSON.parse(L.txt) });
    let done = false;
    const fin = () => { if (done) return; done = true; an.destroy(); d.remove(); run.stats.done++; res(); };
    an.addEventListener("complete", fin);
    an.setSpeed(speed);
    an.playSegments([54, 121], true); // 從蛋破開那一格播到最後
    run.timer(((121 - 54) / L.fr / speed) * 1000 + 1500, fin); // 保險：事件沒來也一定收尾（中止時也會馬上收尾）
  }));
}

async function egg(c: Ctx) {
  const { run, A, B } = c;
  const me = c.view === "victim";
  const P = me ? { x: innerWidth / 2, y: innerHeight * 0.47 } : { x: B.x, y: B.y };
  const W = z(me ? 440 * 3 : 340), k = W / 700; // 被丟的人 3 倍（老闆 2026-10-21）；發送者／旁觀者 2 倍
  const ew = Math.round(63 * k * 1.15), eh = Math.round((ew * 329) / 247); // 飛到時的大小＝第 54 格那顆蛋，接上破蛋不會跳
  const e = mk(run, "eggWhole", ew, eh);
  e.style.opacity = "1";
  await flyPath(run, e, A, P, { dur: me ? 520 : 480, bend: -60, spin: 540, s0: me ? 0.45 : 0.8, s1: 1, w: ew, h: eh, ease: "cubic-bezier(.3,0,.75,.9)" });
  e.remove();
  if (run.aborted) return;
  snd(run, "egg-crack1", 1, 0.9);
  if (!me) glow(run, B.el, "mjfx-glow-hit", 1500);
  await playEggLottie(run, P, W, 1.5);
}

async function water(c: Ctx) {
  const { run, A, B } = c;
  if (c.view === "victim") {
    const C = { x: innerWidth / 2, y: innerHeight * 0.48 };
    const kk = 0.36, M = { x: A.x + (C.x - A.x) * kk, y: A.y + (C.y - A.y) * kk - z(30) }, bw = z(120), bh = bw * BUCKET_AR, dir = C.x >= A.x ? 1 : -1;
    const bk = mk(run, "bucket", bw, bh);
    bk.style.opacity = "1";
    bk.style.filter = "drop-shadow(0 6px 8px rgba(0,0,0,.45))";
    run.stats.anims++;
    await run.track(bk.animate([{ transform: T(A.x, A.y, 0.3, 0, bw, bh) }, { transform: T(M.x, M.y, 1, -dir * 12, bw, bh) }], { duration: 280, easing: "ease-out", fill: "forwards" }).finished.then(() => { run.stats.done++; }, () => {}));
    if (run.aborted) return;
    snd(run, "splash2", 1, 0.85);
    anim(run, bk, [
      { transform: T(M.x, M.y, 1, -dir * 12, bw, bh), opacity: 1 }, { transform: T(M.x, M.y, 1, dir * 112, bw, bh), opacity: 1, offset: 0.3 },
      { transform: T(M.x - dir * z(12), M.y + z(8), 0.95, dir * 124, bw, bh), opacity: 0 },
    ], { duration: 900 });
    await run.wait(160);
    if (run.aborted) return;
    snd(run, "splash1", 0.9, 0.95);
    // 鋪滿畫面的寫實水花飛濺（中間的冰藍水花皇冠拿掉了，老闆 2026-10-21）
    const OW = Math.max(innerWidth, innerHeight / OVERLAY_AR) * 1.08, OH = OW * OVERLAY_AR;
    const ov = mk(run, "overlay", OW, OH);
    anim(run, ov, [
      { transform: T(C.x, C.y, 0.6, 0, OW, OH), opacity: 0 }, { transform: T(C.x, C.y, 1, 0, OW, OH), opacity: 0.9, offset: 0.16 },
      { transform: T(C.x, C.y + 20, 1.04, 0, OW, OH), opacity: 0.8, offset: 0.6 }, { transform: T(C.x, C.y + 50, 1.08, 0, OW, OH), opacity: 0 },
    ], { duration: 1700, easing: "cubic-bezier(.2,.6,.4,1)" });
    return;
  }
  // 發送者、旁觀者：W3 整桶砸過去（木桶 67px＝縮小 20%）
  // 木桶和砸中名牌的水花都縮小 50%（老闆 2026-10-21）
  const Tg = { x: B.x, y: B.y }, dir = Tg.x >= A.x ? 1 : -1, bw = z(67 * 0.5), bh = bw * BUCKET_AR;
  const bk = mk(run, "bucket", bw, bh);
  bk.style.opacity = "1";
  bk.style.filter = "drop-shadow(0 6px 8px rgba(0,0,0,.45))";
  await flyPath(run, bk, A, Tg, { dur: 480, bend: -70, spin: dir * 720, s0: 0.5, s1: 1, w: bw, h: bh, ease: "cubic-bezier(.3,0,.75,.9)" });
  if (run.aborted) return;
  snd(run, "thud", 0.8, 0.9);
  snd(run, "splash1", 1, 0.8);
  const S = z(200 * 0.5), SH = S * CROWN_AR;
  const sp = mk(run, "burst", S, SH);
  anim(run, sp, [
    { transform: T(Tg.x, Tg.y, 0.3, -20 * dir, S, SH), opacity: 0.95 }, { transform: T(Tg.x, Tg.y, 1, -20 * dir, S, SH), opacity: 0.92, offset: 0.25 },
    { transform: T(Tg.x, Tg.y + z(8), 1.1, -20 * dir, S, SH), opacity: 0.75, offset: 0.65 }, { transform: T(Tg.x, Tg.y + z(14), 1.15, -20 * dir, S, SH), opacity: 0 },
  ], { duration: 1100, easing: "ease-out" });
  glow(run, B.el, "mjfx-glow-hit", 1400);
  shake(run, B.el, "mjfx-shk-s");
  anim(run, bk, [
    { transform: T(Tg.x, Tg.y, 1, dir * 720, bw, bh), opacity: 1 }, { transform: T(Tg.x - dir * z(40), Tg.y - z(50), 0.95, dir * 800, bw, bh), opacity: 1, offset: 0.35 },
    { transform: T(Tg.x - dir * z(70), Tg.y + z(60), 0.9, dir * 900, bw, bh), opacity: 0 },
  ], { duration: 800, easing: "cubic-bezier(.2,.6,.5,1)" });
}

/** 拳頭朝右的側面拳套：轉到飛行方向；整趟往左打時左右翻（拳頭朝左、不會上下顛倒）。
 *  翻不翻整趟固定（left），不能逐格判斷：否則接近直上直下時會在兩格之間從 -1 縮放到 1，拳套被壓扁 */
function sideT(x: number, y: number, ang: number, s: number, w: number, h: number, left: boolean) {
  const deg = ((((left ? ang - Math.PI : ang) * 180) / Math.PI + 540) % 360) - 180; // 角度維持連續，不會繞一圈
  return `translate(${x - w / 2}px,${y - h / 2}px) rotate(${deg}deg) scale(${left ? -s : s},${s})`;
}
async function punchFly(run: Run, A: Pt, B: Pt) {
  const w = z(99), h = w * arOf("gloveSide", 172 / 220); // 和原本直立的拳套（81×99）差不多大
  const g = mk(run, "gloveSide", w, h);
  g.style.opacity = "1";
  g.style.filter = "drop-shadow(0 6px 10px rgba(0,0,0,.55))";
  const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len, bd = z(-24);
  const c = { x: (A.x + B.x) / 2 + nx * bd, y: (A.y + B.y) / 2 + ny * bd - Math.abs(bd) * 0.4 };
  // 沿弧線飛到名牌前一點，每一格都轉到當下的飛行方向
  const stop = 0.86, fr: Keyframe[] = [], left = B.x < A.x;
  let ang = 0;
  for (let i = 0; i <= 12; i++) {
    const t = (i / 12) * stop, u = 1 - t;
    const x = u * u * A.x + 2 * u * t * c.x + t * t * B.x, y = u * u * A.y + 2 * u * t * c.y + t * t * B.y;
    ang = Math.atan2(2 * u * (c.y - A.y) + 2 * t * (B.y - c.y), 2 * u * (c.x - A.x) + 2 * t * (B.x - c.x));
    fr.push({ transform: sideT(x, y, ang, 0.6 + 0.4 * (i / 12), w, h, left), opacity: 1 });
  }
  run.stats.anims++;
  await run.track(g.animate(fr, { duration: 340, easing: "cubic-bezier(.5,0,.85,.7)", fill: "forwards" }).finished.then(() => { run.stats.done++; }, () => {}));
  if (run.aborted) return;
  // 出拳：往後收一點 → 用力往前打到名牌 → 回彈、淡出
  // 對準的是「拳面」：拳面（側面圖前緣，約寬度的 4 成）打在名牌正中間，不是拳套中心
  const face = w * 0.42, ux = Math.cos(ang), uy = Math.sin(ang), at = (k: number) => ({ x: B.x - ux * k, y: B.y - uy * k });
  const back = at(face + z(32)), hit = at(face), reb = at(face + z(20));
  run.stats.anims++;
  const thrust = g.animate([
    { transform: sideT(back.x, back.y, ang, 0.95, w, h, left), opacity: 1 },
    { transform: sideT(hit.x, hit.y, ang, 1.12, w, h, left), opacity: 1, offset: 0.22 },
    { transform: sideT(hit.x, hit.y, ang, 1.08, w, h, left), opacity: 1, offset: 0.4 },
    { transform: sideT(reb.x, reb.y, ang, 0.95, w, h, left), opacity: 0 },
  ], { duration: 520, easing: "ease-out", fill: "forwards" });
  // 拳面打到名牌那一刻：音效、星芒、名牌紅框和抖動
  run.later(115, () => {
    snd(run, "punch1", 1, 0.9);
    burst(run, "star6", B, 110, "radial-gradient(circle,#fff,#ffe066 45%,#ff7a00)", 420);
    glow(run, B.el, "mjfx-glow-hit", 1300);
    shake(run, B.el);
  });
  await run.track(thrust.finished.then(() => { g.remove(); run.stats.done++; }, () => g.remove()));
}

async function punch(c: Ctx, crackOn: boolean) {
  const { run, A, B } = c;
  if (c.view === "victim") {
    const gw = z(66), gh = gw; // 正面拳套是正方形圖，高度和原本直立拳套（54×66）一樣
    const g = mk(run, "gloveFront", gw, gh);
    g.style.opacity = "1";
    g.style.filter = "drop-shadow(0 6px 10px rgba(0,0,0,.55))";
    const C = { x: innerWidth / 2, y: innerHeight * 0.5 };
    await flyPath(run, g, A, C, { dur: 380, bend: -30, spin: -12, s0: 0.5, s1: 3.4, w: gw, h: gh, ease: "cubic-bezier(.55,0,.9,.6)" });
    if (run.aborted) return;
    anim(run, g, [
      { transform: T(C.x, C.y, 3.4, -12, gw, gh), opacity: 1 }, { transform: T(C.x, C.y, 3.1, -8, gw, gh), opacity: 1, offset: 0.3 },
      { transform: T(C.x, C.y + z(30), 2.6, 0, gw, gh), opacity: 0 },
    ], { duration: 380 });
    snd(run, "punch2", 1, 1);
    const fl = document.createElement("div");
    fl.className = "p";
    fl.dataset.k = "flash";
    fl.style.cssText = "width:100vw;height:100vh;background:#fff";
    run.layer.appendChild(fl);
    anim(run, fl, [{ opacity: 0.85 }, { opacity: 0 }], { duration: 260 });
    shake(run, document.querySelector("[data-mj-shake]"));
    if (!crackOn) return;
    snd(run, "shatter1", 1, 0.9, 40);
    snd(run, "glass-heavy", 0.9, 0.6, 20);
    const S = Math.max(innerWidth, innerHeight) * 1.05;
    const cr = document.createElement("div");
    cr.className = "p";
    cr.dataset.k = "crackWrap";
    cr.style.cssText = "width:100vw;height:100vh;opacity:0";
    const ci = mk(run, "crack", S, S);
    ci.style.cssText += `;position:absolute;left:${C.x - S / 2}px;top:${C.y - S / 2}px;transform:rotate(${rand(-30, 30)}deg);opacity:.85`;
    cr.appendChild(ci);
    run.layer.appendChild(cr);
    anim(run, cr, [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }], { duration: 2000 });
    return;
  }
  // 發送者／旁觀者：拳頭朝向目標名牌飛過去（左家、右家、對家都對），打中時往前出拳一下再收回
  await punchFly(run, A, B);
}

// 拍手（老闆 2026-10-22 定案預覽站的「D-五下」）：Fluent 靜態拍手圖飛到名牌 → 換成拍手動圖拍 5 下，一拍一聲 → 往上飄、淡出。
// 動圖 clap-anim.webp 是 Microsoft 官方動畫（28 格×42ms、10 格拍一下）的第 0～19 格，後面接第 10～19 格重複，
// 所以 5 下間隔都是 420ms，拍合在動圖開始後 336／756／1176／1596／2016ms。
export const CLAP_HITS = [336, 756, 1176, 1596, 2016];
const CLAP_SND = ["clap-hit-1", "clap-hit-2", "clap-hit-3", "clap-hit-4", "clap-hit-5"] as const; // 5 聲各自一段單拍（Mixkit 480 ClappingFast 剪出來）
const CLAP_RATE = [1, 0.95, 1.05, 0.97, 1.02]; // 每聲音高稍微不同，聽起來不像同一聲重複
const CLAP_VOL = [0.6, 0.55, 0.62, 0.42, 0.24]; // 第 4、5 下漸弱（約 71%、41%）
// 收尾照原始拍手 D：1970ms 起一邊往上飄 22px、放大到 1.1 倍、一邊淡出，546ms 收完、越後面越慢（下面是每 1/8 時間走到的進度）
const CLAP_END = 2516, CLAP_FADE_AT = 1970, CLAP_FADE = [0, 0.211, 0.402, 0.571, 0.716, 0.834, 0.923, 0.98, 1];

async function clap(c: Ctx) {
  const { run, A, B } = c;
  if (c.view === "victim") vignette(run, "rgba(255,210,90,.30)", 1700);
  const fw = z(56), bw = z(96); // 飛的時候和飛行中的愛心差不多大，到了和愛心最後那顆大愛心一樣大
  const f = mk(run, "clap", fw, fw);
  f.style.opacity = "1";
  snd(run, "heart-tick", 1.2, 0.2);
  await flyPath(run, f, A, B, { dur: 520, bend: 50, spin: -12, s0: 0.5, s1: 1, w: fw, h: fw, ease: "cubic-bezier(.3,.1,.4,1)" });
  if (run.aborted) return;
  glow(run, B.el, "mjfx-glow-cash", 1800);
  burst(run, "light1", B, 150, "radial-gradient(circle,rgba(255,240,200,.9),rgba(255,200,80,.35) 60%,transparent)", 700);
  // 名牌貼著畫面邊（手機對家在最上面、自己在左下）：拍手整個收進畫面內，不被切掉
  const lim = (v: number, max: number) => Math.min(max - bw / 2 - 4, Math.max(bw / 2 + 4, v));
  const x = lim(B.x, innerWidth), y = lim(B.y - z(8), innerHeight);
  // 換成動圖：每次用新的 blob 網址，從第一格開始播
  const url = URL.createObjectURL(clapAnim!);
  const d = new Image();
  d.src = url;
  d.dataset.k = "clapAnim";
  d.style.cssText = `width:${bw}px;height:${bw}px`;
  await d.decode().catch(() => {});
  if (run.aborted) { URL.revokeObjectURL(url); return; }
  run.layer.appendChild(d);
  f.remove();
  const a = d.animate([
    { transform: T(x, y, 0.6, 0, bw, bw), opacity: 1, offset: 0, easing: "ease-out" },
    { transform: T(x, y, 1, 0, bw, bw), opacity: 1, offset: 124 / CLAP_END },
    ...CLAP_FADE.map((q, k) => ({ transform: T(x, y - z(22) * q, 1 + 0.1 * q, 0, bw, bw), opacity: 1 - q, offset: (CLAP_FADE_AT + (546 * k) / 8) / CLAP_END })),
  ], { duration: CLAP_END, easing: "linear", fill: "forwards" });
  run.stats.anims++;
  const done = run.track(a.finished.then(() => { d.remove(); run.stats.done++; }, () => d.remove()));
  // 從動圖真正畫上畫面那一格起算（加進畫面到第一次畫出來可能差到 0.1 秒），拍合時閃金星、響一聲（音效用音訊時鐘排程）
  await a.ready.catch(() => {});
  const lag = Number(document.timeline.currentTime ?? 0) - Number(a.startTime ?? document.timeline.currentTime ?? 0);
  CLAP_HITS.forEach((t, i) => {
    void run.later(t - lag, () => burst(run, "star6", { x: x + rand(-z(26), z(26)), y: y - z(20) - rand(0, z(14)) }, 34, "radial-gradient(circle,#fff,#ffe27a 50%,#e0a100)", 320));
    snd(run, CLAP_SND[i], CLAP_RATE[i], CLAP_VOL[i], t - lag);
  });
  await done;
  URL.revokeObjectURL(url);
}

// ---------------- 播放：重組一次只播一個、排隊；輕組馬上播、可以同時好幾則；切到背景就收掉 ----------------
export interface FxJob { kind: FxKind; from: number; to: number; mySeat: number; crack: boolean; muted: boolean }
// lane：light＝輕組（同時播）、heavy＝重組（排隊）；at：開始播的時間（performance.now）；
// dropped：沒播就丟掉的原因（重組排太多、輕組同時太多、分頁在背景、素材還沒好）
export interface FxRunLog {
  kind: FxKind; view: FxView; lane: "light" | "heavy"; at: number; ms: number; anims: number; done: number; imgs: number; notReady: number; sounds: number; left: number; aborted: boolean;
  dropped?: "queue_full" | "light_full" | "hidden" | "not_ready";
  gain?: number; // 播放時的互動音效總音量（0＝靜音）
}
// 重組排隊上限 20（照舊）：超過的新來那則不播、記在 fxLog。
export const QUEUE_MAX = 20;
// 輕組同時最多 4 則：一桌 4 個人、輕組發送冷卻 5 秒、一則播不到 2 秒，所以正常同一時間最多 4 則；超過的不播、記在 fxLog
export const LIGHT_MAX = 4;
let layerEl: HTMLElement | null = null;
let queue: FxJob[] = [];
let current: Run | null = null;
const lights = new Set<Run>();
let pumping = false;
export const fxLog: FxRunLog[] = [];
function logRun(r: FxRunLog) {
  fxLog.push(r);
  if (fxLog.length > 200) fxLog.shift();
}
const listeners = new Set<() => void>();
export function onFxState(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
const emit = () => listeners.forEach((l) => l());
export const isFxBusy = () => current != null || queue.length > 0 || lights.size > 0;
/** 現在同時在播幾則（音量用） */
const playing = () => lights.size + (current ? 1 : 0);

export function setFxLayer(el: HTMLElement | null) { layerEl = el; }

const GLOW = ["mjfx-glow-love", "mjfx-glow-cash", "mjfx-glow-hit", "mjfx-shk", "mjfx-shk-s"];
/** 全部清乾淨（只在中止時用）：取消所有動畫、清空特效層、拿掉名牌上的發光和抖動、池子補滿 */
export function clearFx() {
  if (layerEl) {
    layerEl.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    layerEl.replaceChildren();
  }
  document.querySelectorAll("." + GLOW.join(",.")).forEach((e) => e.classList.remove(...GLOW));
  for (const k of Object.keys(MASTER) as ImgKey[]) {
    MASTER[k]!.forEach((i) => { i.getAnimations().forEach((a) => a.cancel()); i.remove(); });
    POOL[k] = MASTER[k]!.slice();
  }
}

/** 收掉正在播的（重組和所有輕組）、丟掉排隊的（切到背景、結算畫面出現時） */
export function abortFx() {
  queue = [];
  current?.stop();
  lights.forEach((r) => r.stop());
  clearFx();
  emit();
}

export function viewOf(job: FxJob): FxView {
  return job.to === job.mySeat ? "victim" : job.from === job.mySeat ? "sender" : "bystander";
}

/** 排一個特效；回傳 false＝沒播（素材還沒好、分頁在背景、重組排太多、輕組同時太多），會記在 fxLog（dropped） */
export function enqueueFx(job: FxJob): boolean {
  const light = isLightFx(job.kind);
  const drop = !ready || !layerEl ? "not_ready" : document.hidden ? "hidden"
    : light ? (lights.size >= LIGHT_MAX ? "light_full" : null) : queue.length >= QUEUE_MAX ? "queue_full" : null;
  if (drop) {
    logRun({ kind: job.kind, view: viewOf(job), lane: light ? "light" : "heavy", at: Math.round(performance.now()), ms: 0, anims: 0, done: 0, imgs: 0, notReady: 0, sounds: 0, left: 0, aborted: false, dropped: drop });
    return false;
  }
  if (light) {
    void play(job, (run) => lights.add(run), (run) => lights.delete(run)); // 輕組：馬上播，疊在正在播的上面
    return true;
  }
  queue.push(job);
  emit();
  void pump();
  return true;
}

/** 播一則：自己的子圖層、自己的計時器；全部結束（含之後才加進來的）才收尾，收尾只清自己的東西 */
async function play(job: FxJob, start: (r: Run) => void, end: (r: Run) => void) {
  const sub = document.createElement("div");
  sub.style.cssText = "position:absolute;inset:0;pointer-events:none";
  layerEl!.appendChild(sub);
  const run = new Run(sub, job.muted);
  start(run);
  emit();
  const t0 = performance.now();
  const view = viewOf(job);
  SC = fxScale(); // 每次播放開始時照當下的畫面大小重算
  const c: Ctx = { run, A: plate(job.from), B: plate(job.to), view };
  const work = job.kind === "love" || job.kind === "cash" ? stream(c, job.kind === "love")
    : job.kind === "egg" ? egg(c) : job.kind === "water" ? water(c) : job.kind === "clap" ? clap(c) : punch(c, job.crack);
  run.p.push(work.catch(() => {}));
  // 保險：任何情況 4 秒內一定收尾
  const guard = setTimeout(() => run.stop(), 4000);
  let seen = 0;
  while (seen < run.p.length) { seen = run.p.length; await Promise.allSettled(run.p.slice()); }
  clearTimeout(guard);
  const left = sub.children.length;
  run.cleanup();
  logRun({ kind: job.kind, view, lane: isLightFx(job.kind) ? "light" : "heavy", at: Math.round(t0), ms: Math.round(performance.now() - t0), ...run.stats, left, aborted: run.aborted, gain: masterGain });
  end(run);
  emit();
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length && layerEl) {
      const job = queue.shift()!;
      await play(job, (r) => { current = r; }, () => { current = null; });
    }
  } finally {
    pumping = false;
    current = null;
    emit();
  }
}

// 預覽站的自動驗收讀這份播放紀錄（每次播放的動畫數、完成數、沒準備好的圖、殘留節點）
if (typeof window !== "undefined" && process.env.NEXT_PUBLIC_MJ_PREVIEW === "1") (window as unknown as { __mjFxLog: FxRunLog[] }).__mjFxLog = fxLog;

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => { if (document.hidden) abortFx(); });
}
