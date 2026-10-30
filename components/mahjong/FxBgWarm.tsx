"use client";
// 麻將大牌特效背景預熱（老闆 2026-10-25：大牌很少見，一般打牌絕對不能因為預熱而卡；下載時機越早越好）：
// 由根 layout 的 FxBgWarmRoot（components/mahjong/FxBgWarmRoot.tsx）只在網站首頁和麻將頁動態載入（大老二不載入、不做）；首頁切到麻將頁是同一份文件，預熱接著做、做過的仍有效。
// 只在「不是打牌中」的時候做：首頁、麻將大廳、進房等人、結算畫面、等下一局。牌局進行中（RoomView 呼叫 setBgWarmPaused(true)）完全暫停，
// 正在做的那一種立刻收掉（下次從頭再做），沒做完的留到結算時接著做。
// 順序：天胡 → MIGI → 隕石 → 自摸特效庫 5 種 → 七搶一 → 八仙過海 → 其他大牌 → 自摸／胡浮層。每一種拆成小塊（fxWarmUp 的 stepPlay：一格只露出幾個元素）。
// 圖都換成同尺寸的內嵌占位圖，不下載；只有天胡例外：一開網頁就在背景（頁面載完、瀏覽器空閒後）下載真圖，用真圖預熱（大圖第一次上傳 GPU 的成本占位圖做不到）。
// 同一種一個分頁只做一次（fxWarmUp 的 warmed）。還沒預熱完就胡了：直接播，不等
import { useEffect, useRef } from "react";
import { BIG_WIN_ORDER, type BigWinTheme } from "@/lib/mahjong/bigWin";
import BigWin8Fx, { preloadBigWin8 } from "./BigWin8Fx";
import MeteorFx from "./MeteorFx";
import ZimoFx from "./ZimoFx";
import { ZIMO_FX_NEW } from "@/lib/mahjong/winShow";
import { WinCelebrationWarm } from "./WinCelebration";
import { isWarmed, setWarmPausedFn, useFxWarmUp } from "./fxWarmUp";

/** 開網頁後等多久才開始（讓首頁、大廳、牌局資料先載完） */
const START_DELAY_MS = 1500;
const FIRST: BigWinTheme[] = ["tianhu", "migi", "qiqiang1", "baxian"];

let paused = false;
let cancelCurrent = () => {};
setWarmPausedFn(() => paused);
/** 牌局進行中（或胡牌特效在播）＝true：背景預熱完全暫停，正在做的那一種收掉 */
export function setBgWarmPaused(p: boolean) {
  paused = p;
  if (p) cancelCurrent();
}

// 天胡真圖：頁面載完、瀏覽器空閒、而且不是牌局進行中才下載（不和首頁、大廳、牌局資料搶），一個分頁只下載一次
let tianhuArt: Promise<boolean> | null = null;
function loadTianhuArt(): Promise<boolean> {
  return (tianhuArt ??= new Promise<void>((r) => (document.readyState === "complete" ? r() : addEventListener("load", () => r(), { once: true })))
    .then(() => new Promise<void>((r) => (typeof requestIdleCallback === "function" ? requestIdleCallback(() => r(), { timeout: 3000 }) : setTimeout(r, 500))))
    // 牌局進行中不下載（打牌時不做任何事），等結算、等人時再開始
    .then(async () => { while (paused) await new Promise((r) => setTimeout(r, 1000)); })
    .then(() => preloadBigWin8("tianhu")));
}

/** 正式頁面由 FxBgWarmRoot 動態載入；量測頁（預覽站）也直接用 */
export function FxBgWarm({ mobile }: { mobile: boolean }) {
  const { element, warmUp, cancelAll } = useFxWarmUp(30000);
  const ref = useRef({ warmUp, mobile });
  useEffect(() => { ref.current = { warmUp, mobile }; });
  useEffect(() => {
    cancelCurrent = cancelAll;
    return () => { cancelCurrent = () => {}; };
  }, [cancelAll]);
  useEffect(() => {
    let alive = true;
    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const idle = () => new Promise<void>((r) => (typeof requestIdleCallback === "function" ? requestIdleCallback(() => r(), { timeout: 1500 }) : setTimeout(r, 200)));
    let tianhuReady = false;
    void loadTianhuArt().then((ok) => { tianhuReady = ok; });
    const big = (theme: BigWinTheme) => {
      const d = BIG_WIN_ORDER.find((x) => x.theme === theme)!;
      return {
        key: `big|${theme}`,
        // 天胡要等真圖載好才做（還沒好就先跳過，做下一種，之後回來）
        ready: () => theme !== "tianhu" || tianhuReady,
        run: () => ref.current.warmUp(`big|${theme}`, (done, mode) => (
          <BigWin8Fx warm={mode} realArt={theme === "tianhu"} theme={theme} title={d.title} fan={theme === "tianhu" ? 24 : d.tier === "top" ? 16 : 8} seat={0} mobile={ref.current.mobile} winTile={null} name="" onDone={done} />
        ), { layered: true }),
      };
    };
    const jobs = [
      big("tianhu"), big("migi"),
      { key: "meteor", ready: () => true, run: () => ref.current.warmUp("meteor", (done, mode) => <MeteorFx warm={mode} seat={0} mySeat={0} mobile={ref.current.mobile} tile={null} name="" onDone={done} />, { layered: true }) },
      // 自摸特效庫的新特效（老闆 2026-10-31）：比照隕石，排在隕石後面
      ...ZIMO_FX_NEW.map((fx) => ({ key: `zfx|${fx}`, ready: () => true, run: () => ref.current.warmUp(`zfx|${fx}`, (done, mode) => <ZimoFx warm={mode} fx={fx} seat={0} mySeat={0} mobile={ref.current.mobile} tile={null} onDone={done} />, { layered: true }) })),
      big("qiqiang1"), big("baxian"),
      ...BIG_WIN_ORDER.filter((d) => !FIRST.includes(d.theme)).map((d) => big(d.theme)),
      { key: "cele|zimo", ready: () => true, run: () => ref.current.warmUp("cele|zimo", (done) => <WinCelebrationWarm mode="zimo" name="" onDone={done} />) },
      { key: "cele|ron", ready: () => true, run: () => ref.current.warmUp("cele|ron", (done) => <WinCelebrationWarm mode="ron" name="" onDone={done} />) },
    ];
    // 一直照順序找下一個還沒做完、可以做的；牌局進行中就等（被打斷的那一種沒有標成做完，之後重做）
    const run = async () => {
      while (alive) {
        const job = jobs.find((j) => !isWarmed(j.key) && j.ready());
        if (!job) { if (jobs.every((j) => isWarmed(j.key))) return; await wait(1000); continue; }
        if (paused) { await wait(500); continue; }
        await idle();
        if (!alive || paused) continue;
        await job.run();
      }
    };
    const t = setTimeout(() => void run(), START_DELAY_MS);
    return () => { alive = false; clearTimeout(t); };
  }, []);
  return element;
}
