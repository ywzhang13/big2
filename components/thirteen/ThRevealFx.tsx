"use client";
// 十三支亮牌特效層（小宜 v5 §1、§3，v4 §4～5）：開始比牌、衝三／鐵支／同花順／五龍、打槍、全壘打、場內全壘打。
// 只用老闆的素材（public/tiles/thirteen/fx），程式只做移動、縮放、旋轉、透明度；不做晃動、震動（老闆 2026-11-18）。
// 小宜 v7（老闆 2026-11-18）：大字（開始比牌、衝三、鐵支、同花順、五龍、全壘打）和棒球改用 v2——素材整理時已去黑底、四邊羽化成實心透明圖，
//   一般疊加、畫在牌上面（screen 疊在象牙白牌面會被洗掉）；衝三等四種出現在那一家那副牌上；全壘打 2.8 秒全螢幕（爆發、煙火用 screen 鋪滿）
// 每段特效掛上去時記下「已經播了幾毫秒」當負的 animation-delay：重新整理、晚一點才看到也從對的那一刻接著播。
// 位置照牌桌上四家那組牌的實際中心算（DOM 量），手機、桌機一樣。
import { useLayoutEffect, useState } from "react";
import type { Step } from "./revealTimeline";
import { POS_BY_OFFSET, type Pos } from "./ThTable";
import { CARD_BACK_SRC } from "./cardArt";
import { whenScreenImagesLoaded } from "@/lib/perf/tableFirst";
import { stageScale } from "./stageScale";
import { fxCenter, fxWidth } from "./fanLayout";

const FX = "/tiles/thirteen/fx";
const DESKTOP = "(min-width: 1100px) and (min-height: 700px)";

/** 素材版本：去黑底實心的是 v2，其他 v1；大牌大字 v3＝老闆 2026-11-20 新圖（去背、四邊羽化，彩金三種是新增的；彩金牌外框 8-jp-frame 試過不加） */
const VER: Record<string, string> = { start: "v2", chongsan: "v3", tiezhi: "v3", tonghuashun: "v3", wulong: "v3", jpchongsan: "v3", jphulu: "v3", jptiezhi: "v3", homerun: "v2", ball: "v2", hrbatter: "v2" }; // hrbatter v2＝老闆第 12 輪新揮棒圖（腳清楚）；hrfield、hrstar、hrready 是 v1
export const fxSrc = (name: string, size: "m" | "d") => `${FX}/th-fx-${name}.${VER[name] ?? "v1"}.${size}.webp`;
/** 每張特效圖的長寬比（.m 的像素；.d 同比例，差不到 1%）。老馬 2026-11-22 修「大字只出現一半、偏到下半部」：
 *  特效的 CSS 只給寬、高跟著圖，動畫用 translate(-50%,-50%) 置中。圖還沒載完時高度是 0，iPhone Safari 在動畫開始那一刻
 *  就把 -50% 換成固定的 0px（圖載完也不重算），整張圖的上緣就停在正中線、往下長——第一次播、特效圖還沒載完時就會發生。
 *  先給長寬比，圖還沒載完就有正確的高度。換素材時要一起改這裡（tests/_thirteen-fx-aspect.ts 會比對實際檔案） */
export const FX_AR: Record<string, [number, number]> = {
  start: [1400, 515], chongsan: [990, 622], tiezhi: [1000, 551], tonghuashun: [1000, 372], wulong: [1000, 516],
  jpchongsan: [1000, 529], jphulu: [1000, 532], jptiezhi: [1000, 490], gun: [256, 131], muzzle: [336, 232], bullet: [1024, 191],
  hole1: [144, 144], hole2: [144, 144], hole3: [144, 144], hole4: [144, 144], hrready: [458, 640], ball: [1200, 450], homerun: [1500, 562],
  burst: [1600, 893], fireworks: [1600, 893], hrfield: [1376, 768], hrbatter: [980, 1080], hrstar: [360, 360],
  ihrfield: [1376, 768], ihrstand: [640, 894], ihrkneel: [900, 1012], ihrword: [1500, 556],
};
/** 手機用 .m、桌機用 .d（同一套 CSS 尺寸，桌機圖比較大）。aspect-ratio 用 auto：圖載完照圖本身的比例，載完前用 FX_AR */
function Pic({ name, className, style }: { name: string; className?: string; style?: React.CSSProperties }) {
  const ar = FX_AR[name];
  return (
    <picture>
      <source media={DESKTOP} srcSet={fxSrc(name, "d")} />
      <img src={fxSrc(name, "m")} alt="" draggable={false} className={className} style={ar ? { aspectRatio: `auto ${ar[0]} / ${ar[1]}`, ...style } : style} />
    </picture>
  );
}

export const FX_NAMES = ["start", "chongsan", "tiezhi", "tonghuashun", "wulong", "jpchongsan", "jphulu", "jptiezhi", "gun", "muzzle", "bullet", "hole1", "hole2", "hole3", "hole4", "hrready", "ball", "homerun", "burst", "fireworks", "hrfield", "hrbatter", "hrstar", "ihrfield", "ihrstand", "ihrkneel", "ihrword"];
let preloaded: Promise<void> | null = null;
/** 先把特效圖和牌背載好（理牌畫面一打開就呼叫）：第一次播的時候圖才不會還沒下載完、整段看不到。只載這台裝置那一套（手機 .m／桌機 .d） */
export function preloadRevealFx(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  const srcs = [CARD_BACK_SRC, ...FX_NAMES.map((n) => fxSrc(n, isDesktop() ? "d" : "m"))]; // 牌背也先載：理牌時只看得到牌面
  // 牌優先（老馬 2026-11-21）：等理牌畫面的牌面載完才開始下載（手機約 2.8MB），4G 下手牌才不會一張張冒出來
  preloaded ??= whenScreenImagesLoaded().then(() => Promise.all(srcs.map((src) => new Promise<void>((done) => {
    const img = new Image();
    img.onload = () => { img.decode().catch(() => {}).finally(done); };
    img.onerror = () => done(); // 載不到也不卡住牌局
    img.src = src;
  })))).then(() => undefined);
  return preloaded;
}

type Pt = { x: number; y: number };
function seatCenter(pos: Pos): Pt | null {
  const el = document.querySelector(`.th-table [data-th-pos="${pos}"] [data-th-mid]`); // 中墩中間那張牌的中心（扇形 v13）
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
const tableCenter = (): Pt => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
/** 全壘打、場內全壘打要不要左右鏡射（老闆 2026-11-28「對家跟右家翻轉怪怪的」）：鏡射版只有右家翻（對家坐正對面，沒有朝左的理由，改成不翻）；
 *  特效測試頁切成「不翻轉」（<html data-th-trial-dir="none">）時四家都不翻＝打者在左、大字在右，只靠名牌分是誰。正式遊戲不設＝鏡射版 */
const mirrorFor = (pos: Pos) => document.documentElement.dataset.thTrialDir !== "none" && pos === "right";
const isDesktop = () => window.matchMedia(DESKTOP).matches;

/** 一段特效：掛上去那一刻算好位置和「已播毫秒」 */
function useMount<T>(make: () => T): T | null {
  const [v, setV] = useState<T | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { setV(make()); }, []);
  return v;
}

function StartFx({ elapsed: elapsed0 }: { elapsed: number }) {
  const [elapsed] = useState(elapsed0); // 掛上去那一刻就固定（之後每次重畫都改 delay 會讓動畫跳格）
  const m = useMount(() => true);
  if (!m) return null;
  return (
    <div className="th-fx-at th-fx-start-at" data-th-fx="start">
      <Pic name="start" className="th-fx th-fx-start" style={{ animationDelay: `${-elapsed}ms` }} />
    </div>
  );
}

/** 大字（小宜 v14 §3 分級）：五龍寬當 100%（他家 210、自己 270），同花順 90%、鐵支 80% 照寬，衝三照面積 70%（拿掉舊的框高放寬 1.5 倍）；
 *  中心＝那一家中墩中間那張牌，左右家往外移到最大瞬間也離看板 4px（fanLayout.fxCenter）。牌桌座標照 .th-table 的實際位置和倍數換成畫面座標 */
function PatternFxView({ step, elapsed: elapsed0, mySeat }: { step: Extract<Step, { kind: "fx" }>; elapsed: number; mySeat: number }) {
  const [elapsed] = useState(elapsed0); // 掛上去那一刻就固定（之後每次重畫都改 delay 會讓動畫跳格）
  const pos = POS_BY_OFFSET[(step.seat - mySeat + 4) % 4];
  const at = useMount(() => {
    const s = stageScale(); // v8-A：特效尺寸跟著牌桌倍數放大
    const w = fxWidth(pos, step.fx) * s;
    const t = document.querySelector(".th-table")?.getBoundingClientRect();
    if (!t) { const c = seatCenter(pos) ?? tableCenter(); return { x: c.x, y: c.y, w }; }
    const [cx, cy] = fxCenter(pos, step.fx), k = t.width / 844;
    return { x: t.left + cx * k, y: t.top + cy * k, w };
  });
  if (!at) return null;
  return (
    <div className="th-fx-at th-fx-pat-at" style={{ left: at.x, top: at.y }} data-th-fx={step.fx} data-th-fx-seat={step.seat} data-th-fx-pos={pos}>
      <Pic name={step.fx} className="th-fx th-fx-pat" style={{ animationDelay: `${-elapsed}ms`, width: at.w }} />
    </div>
  );
}

/** 打槍一槍 0.8 秒（小宜 v8-B §7）：手槍出現、槍口指向對方 → 0.18 火光＋後座 → 子彈光束 → 0.26 對方出牌區多一個彈孔（彈孔由 ThTable 畫，留到結算） */
function GunFx({ step, elapsed: elapsed0, mySeat }: { step: Extract<Step, { kind: "gun" }>; elapsed: number; mySeat: number }) {
  const [elapsed] = useState(elapsed0); // 掛上去那一刻就固定（之後每次重畫都改 delay 會讓動畫跳格）
  const from = POS_BY_OFFSET[(step.from - mySeat + 4) % 4], to = POS_BY_OFFSET[(step.to - mySeat + 4) % 4];
  const g = useMount(() => {
    const s = stageScale(); // v8-A：特效尺寸跟著牌桌倍數放大
    const a = seatCenter(from) ?? tableCenter(), b = seatCenter(to) ?? tableCenter();
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const push = 78 * s, gunW = 130 * s, gunH = gunW * 131 / 256; // 手槍放大（老闆 2026-11-18：可以大把一點）
    const flip = Math.abs(ang) > Math.PI / 2 ? -1 : 1;
    const muzzle = push + 0.492 * gunW;                    // 槍口：槍身中心再往前（素材 fx-info：槍口 0.992、槍身中心 0.5）
    const muzzleY = -0.29 * gunH * flip;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const len = Math.max(20, dist - muzzle);
    return { a, deg: (ang * 180) / Math.PI, flip, push, gunW, gunH, muzzle, muzzleY, len, beamH: Math.max(40 * s, len / 3) };
  });
  if (!g) return null;
  const delay = { animationDelay: `${-elapsed}ms` };
  const rot = { left: g.a.x, top: g.a.y, transform: `rotate(${g.deg}deg)` };
  return (
    <>
      {/* 三層各自一個轉向的容器：黑底的 screen 要掛在最外層（容器有 transform 會自成一組，掛在裡面的圖只會跟透明的容器疊，黑底就露出來） */}
      <div className="th-fx-rot" style={rot} data-th-gun={`${step.from}-${step.to}`}>
        <div className="th-fx-gunbox" style={{ left: g.push }}>
          {/* 寬高都寫明（高照素材 256:131）：圖還沒載完時 translate(-50%,-50%) 也照對的大小算（老馬 2026-11-22，同大字偏下的原因） */}
          <Pic name="gun" className="th-fx th-fx-gun" style={{ ...delay, width: g.gunW, height: g.gunH, ["--flip" as string]: g.flip }} />
        </div>
      </div>
      <div className="th-fx-rot is-blend" style={rot}>
        <div className="th-fx-muzzle" style={{ left: g.muzzle, top: g.muzzleY }}>
          <Pic name="muzzle" className="th-fx th-fx-muzzle-img" style={delay} />
        </div>
      </div>
      <div className="th-fx-rot is-blend" style={rot}>
        <div className="th-fx-beam" style={{ left: g.muzzle, top: g.muzzleY, width: g.len, height: g.beamH }}>
          <Pic name="bullet" className="th-fx th-fx-bullet" style={delay} />
        </div>
      </div>
    </>
  );
}

/** 全壘打 5.0 秒（小宜 v9；老闆 2026-11-28 預備也要集氣、總長對齊場內全壘打，原本 3.2 秒、0.55 揮棒）：0～1.0 在打者那組牌上集氣（老闆「集氣有點太久」從 1.4 縮短）——老闆 2026-11-18 第 10 輪：只有球棒的圖換成打擊者準備姿勢圖
 * （人一直是正的，只左右鏡射面向球飛的方向：鏡射版只有右家面向左（mirrorFor）；1.0 秒後的打擊者畫面跟著同一個方向）；
 * 1.0 擊中 → 全螢幕亮光換景成打擊者畫面（球場背景、打擊者背影在左、1.25 球從球棒甜蜜點飛上天變十字星、壓暗、「全壘打」大字在右、打出全壘打那一家的名牌、煙火）→ 停到 4.5 → 4.5～5.0 一起淡出（時間在 thReveal.css）。位置、大小都是畫面寬高的比例（thReveal.css .th-hr9），不跟牌桌倍數走 */
function HomeRunFx({ step, elapsed: elapsed0, mySeat, name }: { step: Extract<Step, { kind: "homerun" }>; elapsed: number; mySeat: number; name: string }) {
  const [elapsed] = useState(elapsed0); // 掛上去那一刻就固定（之後每次重畫都改 delay 會讓動畫跳格）
  const pos = POS_BY_OFFSET[(step.seat - mySeat + 4) % 4];
  const h = useMount(() => {
    const s = stageScale(); // v8-A：特效尺寸跟著牌桌倍數放大
    const a = seatCenter(pos) ?? tableCenter();
    const face = mirrorFor(pos) ? -1 : 1;
    const readyH = 200 * s, half = readyH * 0.6; // 最大放到 1.12 倍：上下各留 0.6 倍高，對家（牌在上緣）頭頂才不會出畫面
    // 預備新版（老闆 2026-11-28 試做，只有特效測試頁會切成 new）：預備姿勢不在牌桌上，先換景到球場、出現在揮棒打者同一個位置，再交叉淡入成揮棒
    const ready2 = document.documentElement.dataset.thTrialReady === "new";
    return { a, face, readyH, readyY: Math.min(Math.max(a.y, half), window.innerHeight - half), ready2 };
  });
  if (!h) return null;
  const delay = { animationDelay: `${-elapsed}ms` };
  const shown = Array.from(name).length > 10 ? `${Array.from(name).slice(0, 10).join("")}…` : name; // 名字最多 10 個字（同麻將自摸）
  return (
    <>
      {/* 集氣的光（開場的全螢幕爆發圖縮小）：舊預備 0～1.0 在牌上的預備姿勢後面由小放大、越來越亮；新預備只在牌上亮 0～0.3，換景後由球場上的 th-hr9-charge 接手 */}
      <div className="th-fx-at is-blend" style={{ left: h.a.x, top: h.a.y }}>
        <Pic name="burst" className={`th-fx th-fx-charge${h.ready2 ? " is-quick" : ""}`} style={delay} />
      </div>
      {/* 打擊者準備姿勢：中心對齊那一家整組牌的中心（上下超出畫面才往內收） */}
      {/* 鏡射放在外層、固定不動（老闆第 10 輪：準備姿勢要定住）；動畫只做放大和透明度，沒有旋轉和水平位移 */}
      {!h.ready2 && (
      <div className="th-fx-at" style={{ left: h.a.x, top: h.readyY, transform: h.face < 0 ? "scaleX(-1)" : undefined }} data-th-hr-ready={pos}>
        <Pic name="hrready" className="th-fx th-fx-ready" style={{ ...delay, height: h.readyH, width: (h.readyH * FX_AR.hrready[0]) / FX_AR.hrready[1] }} />{/* 寬也寫明（照素材比例），圖沒載完也不偏 */}
      </div>
      )}
      {/* 打擊者畫面（v9 §3 圖層由下到上）：背景、壓暗、煙火（screen）、打擊者、球、星星、大字、名牌、換景亮光 */}
      {/* 集氣人物朝左（鏡射版的右家）→ 打擊者畫面也左右對調（打擊者在右、大字和名字在左），方向一致（老闆第 10 輪） */}
      <div className={`th-hr9${h.face < 0 ? " is-flip" : ""}${h.ready2 ? " is-ready2" : ""}`} data-th-homerun={step.seat} data-th-hr-flip={h.face < 0 ? 1 : 0} style={delay}>
        <Pic name="hrfield" className="th-hr9-field" style={delay} />
        <div className="th-hr9-dim" style={delay} />
        <Pic name="fireworks" className="th-hr9-fw" style={delay} />
        {h.ready2 && <Pic name="burst" className="th-hr9-charge" style={delay} />}
        {h.ready2 && <Pic name="hrready" className="th-hr9-ready" style={delay} />}
        <Pic name="hrbatter" className="th-hr9-batter" style={delay} />
        <div className="th-hr9-ballpath" style={delay}><Pic name="ball" className="th-hr9-ball" /></div>
        <Pic name="hrstar" className="th-hr9-star" style={delay} />
        <div className="th-hr9-title">
          <Pic name="homerun" className="th-hr9-word" style={delay} />
          <p className="th-hr9-name" data-th-hr-name style={delay}>{shown}</p>
        </div>
        <div className="th-hr9-flash" style={delay} />
      </div>
    </>
  );
}

/** 場內全壘打 5.0 秒（老闆 2026-11-28「被三家打槍＝場內全壘打，悲情版、風格跟全壘打一樣」；阿哲分鏡；老闆「可以久一點」從 3.2 拉長到 5.0）：
 *  0～0.55 被打那一家的牌依序中三個彈孔、整組牌變灰 → 0.55 冷白閃光換景到雨夜球場（悶雷）→ 0.55～1.6 打者站著、快跪下去 →
 *  1.6～1.85 交叉淡入跪姿、往下沉 → 1.85～2.05「場內全壘打」大字從上方重重落下（不彈跳，「咚」）→ 2.3 遠處一盞燈熄掉、畫面暗一階（小號 C），
 *  跪姿肩膀一直微微起伏 → 2.25 被打那一家的名字（灰白）→ 停到 4.5 → 4.5～5.0 淡出。方向照全壘打（mirrorFor）：鏡射版右家觸發時整個畫面左右鏡射（人在右、大字在左），不翻轉版四家都人在左。
 *  位置、大小都是畫面寬高的比例（thReveal.css .th-ihr），四家看到同一個畫面（只差鏡射，跟全壘打一樣） */
const IHR_HOLES: [number, number, number][] = [[0.3, 0.42, -18], [0.56, 0.58, 24], [0.78, 0.38, 70]]; // 三個彈孔在那組牌上的位置（寬、高的比例）和角度
function InsideHrFx({ step, elapsed: elapsed0, mySeat, name }: { step: Extract<Step, { kind: "insidehr" }>; elapsed: number; mySeat: number; name: string }) {
  const [elapsed] = useState(elapsed0); // 掛上去那一刻就固定（之後每次重畫都改 delay 會讓動畫跳格）
  const pos = POS_BY_OFFSET[(step.seat - mySeat + 4) % 4];
  const h = useMount(() => {
    const rs = [...document.querySelectorAll(`.th-table [data-th-pos="${pos}"] [data-th-card]`)].map((e) => e.getBoundingClientRect());
    const c = seatCenter(pos) ?? tableCenter();
    const box = rs.length
      ? { l: Math.min(...rs.map((r) => r.left)), t: Math.min(...rs.map((r) => r.top)), r: Math.max(...rs.map((r) => r.right)), b: Math.max(...rs.map((r) => r.bottom)) }
      : { l: c.x - 80, t: c.y - 50, r: c.x + 80, b: c.y + 50 };
    return { box, hole: Math.max(36, (box.b - box.t) * 0.5), flip: mirrorFor(pos) };
  });
  if (!h) return null;
  const delay = { animationDelay: `${-elapsed}ms` };
  const shown = Array.from(name).length > 10 ? `${Array.from(name).slice(0, 10).join("")}…` : name; // 名字最多 10 個字（同全壘打）
  const { box } = h, w = box.r - box.l, ht = box.b - box.t;
  return (
    <>
      {/* 整組牌變灰：只套在被打那一家的牌上（不畫灰色方塊，牌和牌之間的桌布不變色）；4.5～5.0 跟著淡出變回原色 */}
      <style>{`.th-table [data-th-pos="${pos}"] [data-th-card]{animation:th-ihr-gray 5s linear both;animation-delay:${-elapsed}ms}`}</style>
      {IHR_HOLES.map(([fx, fy, deg], i) => (
        <div key={i} className="th-fx-at" style={{ left: box.l + w * fx - h.hole / 2, top: box.t + ht * fy - h.hole / 2 }} data-th-ihr-hole={i}>
          {/* 寬高都寫明、不用 translate 置中（圖沒載完也不偏） */}
          <Pic name={`hole${i + 1}`} className={`th-fx th-ihr-hole th-ihr-hole-${i}`} style={{ ...delay, width: h.hole, height: h.hole, ["--hr" as string]: `${deg}deg` }} />
        </div>
      ))}
      <div className={`th-ihr${h.flip ? " is-flip" : ""}`} data-th-insidehr={step.seat} data-th-ihr-flip={h.flip ? 1 : 0} style={delay}>
        <div className="th-ihr-stage" style={delay}>
          <Pic name="ihrfield" className="th-ihr-field" />
          <div className="th-ihr-lamp" style={delay} />
        </div>
        <div className="th-ihr-rain" style={delay} />
        <div className="th-ihr-dim" style={delay} />
        <div className="th-ihr-figs">
          <Pic name="ihrstand" className="th-ihr-stand" style={delay} />
          <Pic name="ihrkneel" className="th-ihr-kneel" style={delay} />
        </div>
        <div className="th-ihr-title">
          <Pic name="ihrword" className="th-ihr-word" style={delay} />
          <p className="th-ihr-name" data-th-ihr-name style={delay}>{shown}</p>
        </div>
        <div className="th-ihr-flash" style={delay} />
      </div>
    </>
  );
}

/** names：每個座位的名字（全壘打畫面的名牌用） */
export default function ThRevealFx({ active, t, mySeat, names = [] }: { active: Step[]; t: number; mySeat: number; names?: string[] }) {
  return (
    <div className="th-fx-layer" aria-hidden>
      {active.map((s) => {
        const key = `${s.kind}-${s.t0}-${"seat" in s ? s.seat : ""}`;
        const elapsed = Math.max(0, t - s.t0);
        if (s.kind === "start") return <StartFx key={key} elapsed={elapsed} />;
        if (s.kind === "fx") return <PatternFxView key={key} step={s} elapsed={elapsed} mySeat={mySeat} />;
        if (s.kind === "gun") return <GunFx key={key} step={s} elapsed={elapsed} mySeat={mySeat} />;
        if (s.kind === "homerun") return <HomeRunFx key={key} step={s} elapsed={elapsed} mySeat={mySeat} name={names[s.seat] ?? ""} />;
        if (s.kind === "insidehr") return <InsideHrFx key={key} step={s} elapsed={elapsed} mySeat={mySeat} name={names[s.seat] ?? ""} />;
        return null;
      })}
    </div>
  );
}
