"use client";
// 十三支亮牌特效層（小宜 v5 §1、§3，v4 §4～5）：開始比牌、衝三／鐵支／同花順／五龍、打槍、全壘打。
// 只用老闆的素材（public/tiles/thirteen/fx），程式只做移動、縮放、旋轉、透明度、震動。
// 小宜 v7（老闆 2026-11-18）：大字（開始比牌、衝三、鐵支、同花順、五龍、全壘打）和棒球改用 v2——素材整理時已去黑底、四邊羽化成實心透明圖，
//   一般疊加、畫在牌上面（screen 疊在象牙白牌面會被洗掉）；衝三等四種出現在那一家那副牌上；全壘打 2.8 秒全螢幕（爆發、煙火用 screen 鋪滿）
// 每段特效掛上去時記下「已經播了幾毫秒」當負的 animation-delay：重新整理、晚一點才看到也從對的那一刻接著播。
// 位置照牌桌上四家那組牌的實際中心算（DOM 量），手機、桌機一樣。
import { useLayoutEffect, useState } from "react";
import type { Step } from "./revealTimeline";
import { POS_BY_OFFSET, type Pos } from "./ThTable";
import { CARD_BACK_SRC } from "./cardArt";

const FX = "/tiles/thirteen/fx";
const DESKTOP = "(min-width: 1100px) and (min-height: 700px)";

/** 素材版本：去黑底實心的是 v2，其他 v1 */
const VER: Record<string, string> = { start: "v2", chongsan: "v2", tiezhi: "v2", tonghuashun: "v2", wulong: "v2", homerun: "v2", ball: "v2" };
const src = (name: string, size: "m" | "d") => `${FX}/th-fx-${name}.${VER[name] ?? "v1"}.${size}.webp`;
/** 手機用 .m、桌機用 .d（同一套 CSS 尺寸，桌機圖比較大） */
function Pic({ name, className, style }: { name: string; className?: string; style?: React.CSSProperties }) {
  return (
    <picture>
      <source media={DESKTOP} srcSet={src(name, "d")} />
      <img src={src(name, "m")} alt="" draggable={false} className={className} style={style} />
    </picture>
  );
}

const FX_NAMES = ["start", "chongsan", "tiezhi", "tonghuashun", "wulong", "gun", "muzzle", "bullet", "hole1", "hole2", "hole3", "hole4", "bat", "ball", "homerun", "burst", "fireworks"];
let preloaded: Promise<void> | null = null;
/** 先把特效圖和牌背載好（理牌畫面一打開就呼叫）：第一次播的時候圖才不會還沒下載完、整段看不到。只載這台裝置那一套（手機 .m／桌機 .d） */
export function preloadRevealFx(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  const srcs = [CARD_BACK_SRC, ...FX_NAMES.map((n) => src(n, isDesktop() ? "d" : "m"))]; // 牌背也先載：理牌時只看得到牌面
  preloaded ??= Promise.all(srcs.map((src) => new Promise<void>((done) => {
    const img = new Image();
    img.onload = () => { img.decode().catch(() => {}).finally(done); };
    img.onerror = () => done(); // 載不到也不卡住牌局
    img.src = src;
  }))).then(() => undefined);
  return preloaded;
}

type Pt = { x: number; y: number };
function seatCenter(pos: Pos): Pt | null {
  const el = document.querySelector(`.th-table [data-th-pos="${pos}"] .th-blk`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
const tableCenter = (): Pt => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
const isDesktop = () => window.matchMedia(DESKTOP).matches;

/** 牌桌震動（Web Animations：可以給負的 delay，晚到也對得上時間） */
function shake(px: number, times: number, durMs: number, delayMs: number) {
  const el = document.querySelector<HTMLElement>(".th-table");
  if (!el?.animate) return;
  const frames: Keyframe[] = [{ transform: "translate(0,0)" }];
  for (let i = 0; i < times; i++) frames.push({ transform: `translate(${px}px,0)` }, { transform: `translate(${-px}px,0)` });
  frames.push({ transform: "translate(0,0)" });
  el.animate(frames, { duration: durMs, delay: delayMs, easing: "ease-out" });
}
function shakeSeat(pos: Pos, px: number, durMs: number, delayMs: number) {
  const el = document.querySelector<HTMLElement>(`.th-table [data-th-pos="${pos}"] .th-blk`);
  if (!el?.animate) return;
  const base = getComputedStyle(el).transform;
  const t = (dx: number) => `translate(${dx}px,0) ${base === "none" ? "" : base}`;
  el.animate([{ transform: t(0) }, { transform: t(px) }, { transform: t(-px) }, { transform: t(px) }, { transform: t(-px) }, { transform: t(px) }, { transform: t(0) }],
    { duration: durMs, delay: delayMs });
}

/** 一段特效：掛上去那一刻算好位置和「已播毫秒」 */
function useMount<T>(make: () => T): T | null {
  const [v, setV] = useState<T | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { setV(make()); }, []);
  return v;
}

function StartFx({ elapsed: elapsed0 }: { elapsed: number }) {
  const [elapsed] = useState(elapsed0); // 掛上去那一刻就固定（之後每次重畫都改 delay 會讓動畫跳格）
  const m = useMount(() => { shake(isDesktop() ? 6 : 4, 1, 160, 200 - elapsed); return true; });
  if (!m) return null;
  return (
    <div className="th-fx-at th-fx-start-at" data-th-fx="start">
      <Pic name="start" className="th-fx th-fx-start" style={{ animationDelay: `${-elapsed}ms` }} />
    </div>
  );
}

/** 大字的寬高比（素材 fx-info-v2.json）：照小宜 v7 的框（自己 300×110、其他三家 240×88；桌機 ×1.9）等比放進去 */
const RATIO: Record<string, number> = { chongsan: 1.3734, tiezhi: 2.6947, tonghuashun: 2.7179, wulong: 2.6987 };
function PatternFxView({ step, elapsed: elapsed0, mySeat }: { step: Extract<Step, { kind: "fx" }>; elapsed: number; mySeat: number }) {
  const [elapsed] = useState(elapsed0); // 掛上去那一刻就固定（之後每次重畫都改 delay 會讓動畫跳格）
  const big = step.fx === "tonghuashun" || step.fx === "wulong";
  const pos = POS_BY_OFFSET[(step.seat - mySeat + 4) % 4];
  const at = useMount(() => {
    const d = isDesktop();
    shake((big ? 10 : 6) * (d ? 1.5 : 1), 1, 160, 150 - elapsed);
    const c = seatCenter(pos) ?? tableCenter(); // v7 §2：圖的中心對齊那一家整組牌的中心
    const k = d ? 1.9 : 1;
    const [bw, bh] = pos === "bottom" ? [300 * k, 110 * k] : [240 * k, 88 * k];
    const r = RATIO[step.fx] ?? 2.7;
    const w = step.fx === "chongsan" ? Math.min(bw, bh * 1.5 * r) : Math.min(bw, bh * r); // 衝三的圖比較方（鯉魚在上），框高放寬 1.5 倍才不會太小
    return { x: c.x, y: c.y, w };
  });
  if (!at) return null;
  return (
    <div className="th-fx-at" style={{ left: at.x, top: at.y }} data-th-fx={step.fx} data-th-fx-seat={step.seat} data-th-fx-pos={pos}>
      <Pic name={step.fx} className="th-fx th-fx-pat" style={{ animationDelay: `${-elapsed}ms`, width: at.w }} />
    </div>
  );
}

/** 打槍 1.0 秒（v4 §4）：手槍在打槍者那組牌往對方推 78／148 px、槍口指向對方 → 後座＋槍口火光 → 子彈光束拉到對方 → 三個彈孔＋對方的牌抖 */
function GunFx({ step, elapsed: elapsed0, mySeat }: { step: Extract<Step, { kind: "gun" }>; elapsed: number; mySeat: number }) {
  const [elapsed] = useState(elapsed0); // 掛上去那一刻就固定（之後每次重畫都改 delay 會讓動畫跳格）
  const from = POS_BY_OFFSET[(step.from - mySeat + 4) % 4], to = POS_BY_OFFSET[(step.to - mySeat + 4) % 4];
  const g = useMount(() => {
    const d = isDesktop();
    const a = seatCenter(from) ?? tableCenter(), b = seatCenter(to) ?? tableCenter();
    shakeSeat(to, d ? 10 : 6, 280, 320 - elapsed);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const push = d ? 148 : 78, gunW = d ? 163 : 85, gunH = gunW * 131 / 256;
    const flip = Math.abs(ang) > Math.PI / 2 ? -1 : 1;
    const muzzle = push + 0.492 * gunW;                    // 槍口：槍身中心再往前（素材 fx-info：槍口 0.992、槍身中心 0.5）
    const muzzleY = -0.29 * gunH * flip;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const len = Math.max(20, dist - muzzle);
    const hole = d ? 65 : 34;
    let seed = step.n * 7 + 3;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    // 三個彈孔落在對方那組牌上（照那組牌實際的框，左右家的牌是直的），彼此錯開
    const r = document.querySelector(`.th-table [data-th-pos="${to}"] .th-blk`)?.getBoundingClientRect();
    const box = r ?? { left: b.x - 40, top: b.y - 40, width: 80, height: 80 };
    const spots = [[0.28, 0.3], [0.7, 0.48], [0.36, 0.74]];
    const holes = spots.map(([fx, fy], i) => ({ x: box.left + box.width * (fx + (rnd() - 0.5) * 0.1), y: box.top + box.height * (fy + (rnd() - 0.5) * 0.1), r: rnd() * 360, img: ((step.n + i) % 4) + 1 }));
    return { a, deg: (ang * 180) / Math.PI, flip, push, gunW, muzzle, muzzleY, len, beamH: Math.max(d ? 76 : 40, len / 3), hole, holes };
  });
  if (!g) return null;
  const delay = { animationDelay: `${-elapsed}ms` };
  const rot = { left: g.a.x, top: g.a.y, transform: `rotate(${g.deg}deg)` };
  return (
    <>
      {/* 三層各自一個轉向的容器：黑底的 screen 要掛在最外層（容器有 transform 會自成一組，掛在裡面的圖只會跟透明的容器疊，黑底就露出來） */}
      <div className="th-fx-rot" style={rot} data-th-gun={`${step.from}-${step.to}`}>
        <div className="th-fx-gunbox" style={{ left: g.push }}>
          <Pic name="gun" className="th-fx th-fx-gun" style={{ ...delay, width: g.gunW, ["--flip" as string]: g.flip }} />
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
      {g.holes.map((h, i) => (
        <div key={i} className="th-fx-at" style={{ left: h.x, top: h.y }}>
          <Pic name={`hole${h.img}`} className={`th-fx th-fx-hole th-fx-hole-${i}`} style={{ ...delay, width: g.hole, height: g.hole, rotate: `${h.r}deg` }} />
        </div>
      ))}
    </>
  );
}

/** 全壘打 2.8 秒全螢幕（小宜 v7 §3）：球棒在打者那組牌上方揮擊 → 棒球放大 3.8 倍朝鏡頭飛出 → 金色放射爆發鋪滿畫面 → 「全壘打」大字砸下、連震 3 下
 * → 煙火彩帶（1.4 秒再疊一份左右翻面的）→ 淡出進結算。球棒、棒球依座位鏡射：自己往右上、右家往左上、對家往左下、左家往右下 */
function HomeRunFx({ step, elapsed: elapsed0, mySeat }: { step: Extract<Step, { kind: "homerun" }>; elapsed: number; mySeat: number }) {
  const [elapsed] = useState(elapsed0); // 掛上去那一刻就固定（之後每次重畫都改 delay 會讓動畫跳格）
  const pos = POS_BY_OFFSET[(step.seat - mySeat + 4) % 4];
  const h = useMount(() => {
    const d = isDesktop();
    shake(d ? 12 : 8, 1, 120, 300 - elapsed);   // 擊中
    shake(d ? 20 : 14, 3, 300, 750 - elapsed);  // 大字砸下連震 3 下
    const a = seatCenter(pos) ?? tableCenter();
    const mirror = { bottom: "none", right: "scaleX(-1)", top: "scale(-1,-1)", left: "scaleY(-1)" }[pos];
    const batW = d ? 456 : 240;
    return { a, mirror, lift: d ? 133 : 70, batW, reach: 0.83 * batW };
  });
  if (!h) return null;
  const delay = { animationDelay: `${-elapsed}ms` };
  const hx = h.reach * Math.cos(Math.PI / 6), hy = h.reach * Math.sin(Math.PI / 6); // 揮到 +30° 時的棒頭
  return (
    <>
      {/* 底層：screen 疊滿畫面的爆發、煙火（黑底素材；容器不能有 transform，見 thReveal.css） */}
      <div className="th-fx-at th-fx-full-at is-blend" data-th-homerun={step.seat}>
        <Pic name="burst" className="th-fx th-fx-burst" style={delay} />
      </div>
      <div className="th-fx-at th-fx-full-at is-blend">
        <Pic name="fireworks" className="th-fx th-fx-fireworks" style={delay} />
      </div>
      <div className="th-fx-at th-fx-full-at is-blend">
        <Pic name="fireworks" className="th-fx th-fx-fireworks is-flip" style={delay} />
      </div>
      {/* 上層：實心的球棒、棒球、大字 */}
      <div className="th-fx-rot" style={{ left: h.a.x, top: h.a.y, transform: h.mirror }}>
        <div className="th-fx-batbox" style={{ top: -h.lift }}>
          <Pic name="bat" className="th-fx th-fx-bat" style={{ ...delay, width: h.batW }} />
        </div>
        <div className="th-fx-ballbox" style={{ left: hx, top: -h.lift + hy }}>
          <Pic name="ball" className="th-fx th-fx-ball" style={delay} />
        </div>
      </div>
      <div className="th-fx-at th-fx-hr-at">
        <Pic name="homerun" className="th-fx th-fx-homerun" style={delay} />
      </div>
    </>
  );
}

export default function ThRevealFx({ active, t, mySeat }: { active: Step[]; t: number; mySeat: number }) {
  return (
    <div className="th-fx-layer" aria-hidden>
      {active.map((s) => {
        const key = `${s.kind}-${s.t0}-${"seat" in s ? s.seat : ""}`;
        const elapsed = Math.max(0, t - s.t0);
        if (s.kind === "start") return <StartFx key={key} elapsed={elapsed} />;
        if (s.kind === "fx") return <PatternFxView key={key} step={s} elapsed={elapsed} mySeat={mySeat} />;
        if (s.kind === "gun") return <GunFx key={key} step={s} elapsed={elapsed} mySeat={mySeat} />;
        if (s.kind === "homerun") return <HomeRunFx key={key} step={s} elapsed={elapsed} mySeat={mySeat} />;
        return null;
      })}
    </div>
  );
}
