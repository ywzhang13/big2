"use client";
// 特效預熱（2026-10-25 效能健檢）：特效第一次出現時，瀏覽器要先替畫面上的漸層、遮罩、混色、濾鏡建好 GPU 管線（編譯著色器），
// 建好之前畫面停住——隕石第一次播最長卡 1.1 秒、大牌第一次播卡 0.5～1 秒、自摸／胡浮層卡 0.2～0.8 秒（手機 844×390、CPU 降速 4 倍、GPU 著色器快取全空時實測）。
// 預熱＝真的播放之前，先把同一個特效掛在畫面上「看不見」（0.4% 透明度，換算成畫面亮度最多差 1 階；另一份透明度 1 但只露出角落 1 個像素，見 useFxWarmUp），
// 照它自己的時間軸一格一格走一遍（每格推 160ms），讓 GPU 先把管線建好，再拿掉。不出聲音、不攔點擊、不改真的牌桌看得到的任何像素（震動的變形套在看不見的預熱容器上；牌桌只是先升層、加畫面外的陰影，見 stepPlay）。
// 同一種特效一個分頁只預熱一次；素材要先載好（預熱不會多下載任何東西：只用這一手本來就要播、已經載好的那一種）。
import { useCallback, useRef, useState, type CSSProperties, type ReactNode } from "react";

/** 預熱時的透明度：0.004 ≈ 1/255，疊在牌桌上最多差 1 階亮度（看不出來），但瀏覽器照樣會把它畫出來（0 才會跳過不畫） */
export const WARM_OPACITY = 0.004;

/**
 * 預熱用的占位圖（內嵌 SVG、不用下載）：和真圖同尺寸（大圖的畫法——分塊、縮放取樣——和 1×1 小圖不同，尺寸要對才建得到同一組管線）。
 * 開局背景預熱時特效的圖都換成它，不下載任何素材
 */
const ART_SIZE: Record<string, [number, number]> = {
  "bx-gate": [1024, 1024], "bx-sea": [1600, 667], "dsx-beasts": [1024, 1024], "dsx-nebula": [1024, 1024], "dsx-sky": [1600, 667], "dsy-burst": [1024, 1024],
  "dsy-dragons": [1024, 1024], "migi-ground": [1024, 1024], "migi-pillar": [768, 1024], "qq1-flowers": [1024, 512], "qq1-swirl": [1024, 1024], "qys-splash": [1024, 1024],
  "qys-wave": [1024, 1024], "th-dragon": [729, 900], "th-gate": [1024, 1024], "th-palace": [1600, 900], "th-phoenix": [728, 900], "th-starburst": [1600, 900],
  "lg-core": [640, 640], "lg-jade-l": [480, 640], "lg-jade-r": [480, 640], "lg-pairs": [2100, 240], "lg-ring": [1200, 502],
  "wak-circle": [1024, 1024], "wak-orbs": [1024, 1024], "xsx-clouds": [1280, 200], "xsx-eye": [1024, 1024], "zi-flow": [1600, 800], "zi-ink": [1024, 1024],
  crater: [768, 768], debris: [1024, 512], explosion: [1024, 1024], meteor: [1024, 1024],
};
export function warmImg(file: string): string {
  const [w, h] = ART_SIZE[file.replace(/^.*\//, "").replace(/\.webp$/, "")] ?? [1, 1];
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'%3E%3Crect width='100%25' height='100%25' fill='%23888' fill-opacity='.5'/%3E%3C/svg%3E`;
}

const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r));

/** 牌桌的三種狀態：沒在震（對齊像素，畫法和有位移時不同）、大牌震動（純位移，帶小數點的像素）、隕石震動（位移＋旋轉＋縮小，鏡頭往後一震）。預熱容器一格一格輪流套用 */
const SHAKE_POSES = ["none", "translate(1.3px, -0.7px)", "translate(-2.2px, 1px) rotate(0.25deg) scale(0.96)"];

/**
 * 讓 root 底下所有動畫（CSS 動畫和 Web Animations）從頭一格一格走完整條時間軸（total 毫秒）：每畫完一格才往前推 step 毫秒，
 * 第一次建 GPU 管線卡住時也不會跳過任何畫面。動畫一直保持「播放中」（只是幾乎不走，時間由這裡推），
 * 這樣才會交給合成執行緒、分層方式才和正式播放一樣（停住的動畫分層不同，有些管線建不到）。
 * shake：預熱容器（[data-fx-warm]，裁切範圍和牌桌一樣是整個畫面）一格一格輪流套用真的震動會有的變形——
 * 真的震動時整個牌桌連同特效被位移、旋轉、縮放後再裁切，畫圖要用另一組管線（實測：旋轉裁切、多重取樣），也要先建好。
 * 容器整組只有 0.4% 透明度，怎麼變形都看不到。
 * stageShadow：真的特效一掛上，牌桌根節點（[data-mt-stage]）就會加一圈補底色的陰影、升成獨立的合成層（見 holdStage），
 * 整張牌桌要在這個條件下重畫，用到的管線（實測：圓角牌面圖、文字的旋轉裁切、多重取樣）只有牌桌本身畫得出來。
 * 預熱時對真的牌桌做一樣的事：陰影在畫面外、升層不改任何像素，看起來完全一樣，管線先建好
 */
export async function stepPlay(root: Element, total: number, { alive = () => true, step = 160, shake = true, stageShadow }: { alive?: () => boolean; step?: number; shake?: boolean; stageShadow?: string } = {}): Promise<void> {
  const box = shake ? root.closest<HTMLElement>("[data-fx-warm]") : null;
  const stage = stageShadow ? document.querySelector<HTMLElement>("[data-mt-stage]") : null;
  const release = stage && stageShadow ? holdStage(stage, stageShadow) : null;
  // 分攤（老闆 2026-10-25：慢慢做、平均分攤）：每一個時間點不一次全畫，元素一批一批露出來（其他先 visibility: hidden），
  // 一格只建少量 GPU 管線；這一格花太久就把下一批減半，很快就加倍。牌桌在播發牌、補花等動畫時先暫停
  const els = Array.from(root.querySelectorAll<HTMLElement>("*"));
  const host = root as HTMLElement;
  host.setAttribute("data-warm-chunk", "");
  let k = 2;
  try {
    // 動畫清單只拿一次（getAnimations 每叫一次都會強制重算樣式，每一格都叫會讓預熱本身變慢）
    const anims = root.getAnimations({ subtree: true });
    for (const a of anims) { a.playbackRate = 0.001; a.play(); }
    let i = 0;
    for (let t = 0; t <= total + step; t += step, i++) {
      if (!alive()) return;
      while (warmPaused() || boardBusy()) { await new Promise((r) => setTimeout(r, 250)); if (!alive()) return; }
      for (const a of anims) a.currentTime = t;
      if (box) box.style.transform = SHAKE_POSES[i % SHAKE_POSES.length];
      for (const e of els) e.removeAttribute("data-warm-on");
      for (let j = 0; j < els.length;) {
        const end = Math.min(els.length, j + k);
        for (; j < end; j++) els[j].setAttribute("data-warm-on", "");
        const t0 = performance.now();
        await nextFrame();
        const dt = performance.now() - t0;
        k = dt > 40 ? Math.max(1, k >> 1) : dt < 24 ? Math.min(64, k * 2) : k;
        if (!alive()) return;
      }
    }
    await nextFrame();
  } finally {
    host.removeAttribute("data-warm-chunk");
    for (const e of els) e.removeAttribute("data-warm-on");
    if (box) box.style.transform = "";
    release?.();
  }
}

let warmPaused = () => false;
/** 什麼時候不准預熱（components/mahjong/FxBgWarm.tsx 設：牌局進行中） */
export function setWarmPausedFn(fn: () => boolean) { warmPaused = fn; }

/** 牌桌上有沒有正在播的一次性動畫（發牌、補花、吃碰槓等；無限循環的提示動畫不算、預熱副本自己的不算）：有就先暫停預熱 */
function boardBusy(): boolean {
  return document.getAnimations().some((a) => {
    if (a.playState !== "running") return false;
    const tm = a.effect?.getComputedTiming();
    if (!tm || tm.iterations === Infinity) return false;
    const el = (a.effect as KeyframeEffect | null)?.target as Element | null;
    return !!el && !el.closest("[data-fx-warm]");
  });
}

/**
 * 特效期間把牌桌根節點升成獨立的合成層（will-change: transform）並加上補底色的陰影（震動時牌桌外露的那一圈用深色補；
 * 牌桌沒動的時候陰影整圈都在畫面外，看不到）。特效一掛上就做，重擊、撞擊開始震動那一刻就不用整張牌桌重畫，只是移動已經畫好的圖層。
 * 回傳還原函式（還原成原本的樣子）；同時有兩段特效（大牌段墊在隕石底下）時，最後一個還原的才真的還原
 */
const holds = new WeakMap<HTMLElement, { n: number; willChange: string; boxShadow: string }>();
export function holdStage(stage: HTMLElement, shadow: string): () => void {
  const h = holds.get(stage) ?? { n: 0, willChange: stage.style.willChange, boxShadow: stage.style.boxShadow };
  h.n++;
  holds.set(stage, h);
  stage.style.willChange = "transform";
  stage.style.boxShadow = shadow;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    if (--h.n > 0) return;
    holds.delete(stage);
    stage.style.willChange = h.willChange;
    stage.style.boxShadow = h.boxShadow;
  };
}

const warmed = new Set<string>();
/** 這一種在這個分頁預熱過了沒 */
export const isWarmed = (key: string) => warmed.has(key);

/** 預熱副本的種類：group＝整組放在 0.4% 透明的容器裡；pixel＝透明度 1、只露出左上角 1 個像素 */
export type WarmMode = "group" | "pixel";
type Job = { key: string; el: ReactNode; mode: WarmMode };
/**
 * 頁面用：warmUp(key, render) 把 render(done, mode) 掛在看不見的容器裡，特效在 done() 時表示預熱完成；回傳的 Promise 在完成時（或 maxMs 到了，這時也收掉）、
 * 預熱副本拆掉那一格畫完之後結束。同一個 key 只預熱一次；預熱中又叫同一個 key 就等同一次。element 要放進頁面（建議放在牌桌根節點裡，和真的特效同一層）。
 * layered（大牌段、隕石）：同時掛兩份、兩份都走完才算完成——
 *   group：整組 0.4% 透明，所有內容都完整畫一次（容器帶透明度，裡面的圖層先畫進獨立畫布再整張疊）；
 *   pixel：透明度維持 1、整組只露出畫面左上角 1 個像素（手機螢幕角是圓角，那一點實際上看不到；用矩形裁切，不用 clip-path），直接疊在牌桌上的畫法才和真的播放一樣
 *     （混色、遮罩圖層直接疊在牌桌上時用的是另一組管線；實測只靠 group 會漏掉這幾條）。
 * 沒有 layered 的（自摸／胡浮層）：一份 group
 */
export function useFxWarmUp(maxMs = 1500) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const pending = useRef(new Map<string, Promise<void>>());
  // 還在做的預熱：收掉用（不算做完，下次再做）
  const aborts = useRef(new Map<string, () => void>());
  const warmUp = useCallback((key: string, render: (done: () => void, mode: WarmMode) => ReactNode, { layered = false }: { layered?: boolean } = {}) => {
    if (warmed.has(key)) return Promise.resolve();
    const p0 = pending.current.get(key);
    if (p0) return p0;
    const p = new Promise<void>((resolve) => {
      let finished = false;
      const done = (ok = true) => {
        if (finished) return;
        finished = true;
        aborts.current.delete(key);
        if (ok) warmed.add(key);
        pending.current.delete(key);
        setJobs((js) => js.filter((j) => j.key !== key));
        // 預熱副本拆掉那一格先畫完（兩個畫面後）才讓真的特效掛上：拆掉的成本不會算到特效的第一格（這時牌桌是靜止的，多等約 30ms 看不出來）
        void nextFrame().then(nextFrame).then(() => resolve());
      };
      const modes: WarmMode[] = layered ? ["pixel", "group"] : ["group"];
      let left = modes.length;
      const one = () => { if (--left === 0) done(); };
      setJobs((js) => [...js, ...modes.map((mode) => {
        let called = false;
        return { key, mode, el: render(() => { if (!called) { called = true; one(); } }, mode) };
      })]);
      // 很慢的手機上預熱太久：時間到就收掉預熱、先開播（剩下的管線邊播邊建），不讓勝負畫面拖太久，也不會和真的特效同時在跑
      setTimeout(done, maxMs);
      aborts.current.set(key, () => done(false));
    });
    pending.current.set(key, p);
    return p;
  }, [maxMs]);
  /** 收掉所有還在做的預熱（例如胡牌了：真的特效要開播，背景預熱不能和它搶） */
  const cancelAll = useCallback(() => { for (const f of [...aborts.current.values()]) f(); }, []);
  const base = { position: "fixed", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 1 } as const;
  // pixel：外層 1×1 像素、overflow 裁切（矩形裁切＝只設剪裁範圍，不換畫法；用 clip-path 的話整層會改用另一組帶遮罩的管線，等於沒預熱到）；
  // 內層整個畫面大、contain: paint（特效裡 position: fixed 的圖層照整個畫面排版）
  const PIXEL_CLIP: CSSProperties = { position: "fixed", left: 0, top: 0, width: 1, height: 1, overflow: "hidden", pointerEvents: "none", zIndex: 1 };
  const STYLE: Record<WarmMode, CSSProperties> = {
    group: { ...base, opacity: WARM_OPACITY },
    pixel: { position: "absolute", left: 0, top: 0, width: "100vw", height: "100dvh", contain: "paint" },
  };
  const element = jobs.length ? <><style>{"[data-warm-chunk] *:not([data-warm-on]) { visibility: hidden !important; }"}</style>{(["group", "pixel"] as const).map((m) => {
    const list = jobs.filter((j) => j.mode === m);
    if (!list.length) return null;
    const box = (
      <div key={m} aria-hidden data-fx-warm={m} style={STYLE[m]}>
        {list.map((j) => <div key={j.key} style={{ display: "contents" }}>{j.el}</div>)}
      </div>
    );
    return m === "pixel" ? <div key={m} aria-hidden style={PIXEL_CLIP}>{box}</div> : box;
  })}</> : null;
  return { element, warmUp, cancelAll };
}
