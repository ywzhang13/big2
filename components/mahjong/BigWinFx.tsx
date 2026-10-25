"use client";

// 大牌胡牌特效（老闆 2026-10-23 定案；哪一手要播、播哪一種見 lib/mahjong/bigWin.ts）。
// 設計：小宜〈大牌胡牌特效-設計規格-2026-10-22〉＋〈八仙過海-重新設計〉方向 A；試看版在預覽站試按台確認過（畫面、時間軸、金鈴音效對齊都照試看版）。
// 四拍：入場 → 主動作 → 定格（牌型名＋台數，後面墊不透明深綠底）→ 收向勝者名牌。頂級約 3 秒（T2）、大牌約 2 秒（G3）。
// 2026-10-25 老闆：順序對調成「自摸／胡浮層（或帳號專屬的隕石自摸）→ 這一段 → 結算」（lib/mahjong/winShow.ts）；
// 接在前一段後面時（chained）暗角一開始就是暗的，前一段淡掉時底下已經是暗的，牌桌不會先亮一下。
// 畫面最亮的那一下（.bw-flash 的頂點和各牌型的重擊動作）排在音效的重擊點上；音效走互動音效的音量和靜音。
// 點畫面任一處、Enter、Space＝跳過，聲音一起停，跳過那一下不會按到後面結算浮層的按鈕；開啟「減少動態」時直接停在定格畫面（不飛、不轉、不閃）。
// 特效層 pointer-events: none；勝者名牌那一塊挖空，名牌一直看得到。
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import MjTile from "@/components/mahjong/MjTile";
import { bigWinHitMs, playBigWinSound } from "@/lib/mahjong/fx/engine";
import type { BigWinPick, BigWinTheme } from "@/lib/mahjong/bigWin";
import type { Tile, TileSuit } from "@/lib/mahjong/tiles";
import "./bigWin.css";

// 四拍的長度（ms）：頂級 0.25／1.20／0.90／0.65＝3.0 秒；大牌 0.18／0.77／0.45／0.60＝2.0 秒（規格第 4 節）
const BEATS: Record<"top" | "big", number[]> = { top: [250, 1200, 900, 650], big: [180, 770, 450, 600] };

let nid = 5000;
const tile = (suit: TileSuit, rank: number): Tile => ({ id: nid++, suit, rank, display: "" });
// 天胡手牌：台灣 16 張麻將胡牌是 17 張（五組＋一對）
const TIANHU_HAND: Tile[] = [
  ...[1, 2, 3, 4, 5, 6].map((r) => tile("m", r)), ...[7, 8, 9].map((r) => tile("p", r)),
  ...[2, 3, 4].map((r) => tile("s", r)), tile("z", 1), tile("z", 1), tile("z", 1), tile("z", 7), tile("z", 7),
];
const DRAGONS: Tile[] = [tile("z", 5), tile("z", 6), tile("z", 7)];

const RM_Q = "(prefers-reduced-motion: reduce)";
function useReducedMotion() {
  return useSyncExternalStore(
    (cb) => { const m = matchMedia(RM_Q); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => matchMedia(RM_Q).matches,
    () => false,
  );
}

/**
 * 專屬段：p 0（剛掛上）→ 1 入場 → 2 主動作 → 3 定格 → 4 收向勝者名牌 → onDone(false)；跳過 → onDone(true)。
 * chained：接在自摸／胡浮層或隕石自摸後面，暗角一開始就是暗的
 */
export default function BigWinFx({ pick, seat, mobile, chained = false, onDone }: { pick: BigWinPick; seat: number; mobile: boolean; chained?: boolean; onDone: (skipped: boolean) => void }) {
  const { theme, tier, title, fan } = pick;
  // 畫面最亮那一下排在哪（從專屬段開始算，ms）：金鈴組的重擊點（頂級 T2 1.05 秒、大牌 G3 0.48 秒）
  const hit = bigWinHitMs(tier);
  const rm = useReducedMotion();
  // 減少動態：一開始就停在定格那一拍
  const [p, setP] = useState(() => (rm ? 3 : 0));
  const ref = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef(onDone);
  useLayoutEffect(() => { doneRef.current = onDone; });
  const stopRef = useRef(() => {}); // 停掉這一次的音效
  const alive = useRef(true);

  // 畫面出來前量好：每個要飛的東西（data-bw-fly）中心 → 勝者名牌（data-fx-seat）中心
  useLayoutEffect(() => {
    const plate = document.querySelector(`[data-fx-seat="${seat}"]`)?.getBoundingClientRect();
    const root = ref.current;
    if (!plate || !root) return;
    // 勝者名牌外面一圈亮框（定格時亮、收尾時閃一下）
    const a = anchorRef.current;
    if (a) Object.assign(a.style, { display: "block", left: `${plate.left - 4}px`, top: `${plate.top - 3}px`, width: `${plate.width + 8}px`, height: `${plate.height + 6}px` });
    const px = plate.left + plate.width / 2, py = plate.top + plate.height / 2;
    // 暗角在名牌那一塊挖空（橢圓），名牌一直看得到
    const box = root.getBoundingClientRect();
    root.style.setProperty("--ax", `${px - box.left}px`);
    root.style.setProperty("--ay", `${py - box.top}px`);
    root.style.setProperty("--arx", `${plate.width * 0.75 + 12}px`);
    root.style.setProperty("--ary", `${plate.height * 0.75 + 12}px`);
    root.querySelectorAll<HTMLElement>("[data-bw-fly]").forEach((el) => {
      const b = el.getBoundingClientRect();
      el.style.setProperty("--dx", `${px - (b.left + b.width / 2)}px`);
      el.style.setProperty("--dy", `${py - (b.top + b.height / 2)}px`);
    });
  }, [seat]);

  // 點畫面任一處、Enter、Space：跳過，直接進結算。
  // 手機點一下之後瀏覽器還會補一個 click，這時結算浮層已經出來：跳過後 0.5 秒內的 click 吃掉，不會按到結算浮層的按鈕
  const ended = useRef(false);
  useEffect(() => {
    const skip = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Enter" && e.key !== " ") return;
      if (ended.current) return;
      ended.current = true;
      e.preventDefault();
      const swallow = (c: Event) => { c.stopPropagation(); c.preventDefault(); };
      document.addEventListener("click", swallow, true);
      setTimeout(() => document.removeEventListener("click", swallow, true), 500);
      stopRef.current();
      doneRef.current(true);
    };
    document.addEventListener("pointerdown", skip, true);
    document.addEventListener("keydown", skip, true);
    return () => { document.removeEventListener("pointerdown", skip, true); document.removeEventListener("keydown", skip, true); };
  }, []);
  const finish = () => { if (!ended.current) { ended.current = true; doneRef.current(false); } };

  useEffect(() => {
    const beats = BEATS[tier];
    const total = beats.reduce((a, b) => a + b, 0);
    if (rm) {
      // 減少動態：直接定格那一拍（靜態金框＋牌型名，p 一開始就是 3），同樣長度後收尾；聲音照放、從頭放（不是動態）
      stopRef.current = playBigWinSound(tier, null);
      const t = setTimeout(finish, total);
      return () => clearTimeout(t);
    }
    const ts: ReturnType<typeof setTimeout>[] = [];
    // 等瀏覽器先畫一次 p0，入場的過渡才會跑；聲音和入場同一刻起播
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => {
      setP(1);
      let at = 0;
      beats.slice(0, 3).forEach((b, i) => { at += b; ts.push(setTimeout(() => {
        setP(i + 2);
        // 收尾那一拍從它真正開始時算滿（計時器晚到也不會把飛向名牌那一段砍短）
        if (i === 2) ts.push(setTimeout(finish, beats[3]));
      }, at)); });
    }));
    return () => { cancelAnimationFrame(raf); ts.forEach(clearTimeout); };
    // 一次播放只排一次時間軸（finish 透過 ref 呼叫最新的 onDone）
  }, [tier, theme, rm]);

  // 聲音：入場那一刻（最亮層動畫真正開始）對齊起播；卸載（跳過、整段結束）時一起停
  useEffect(() => { alive.current = true; return () => { alive.current = false; stopRef.current(); }; }, []);
  useLayoutEffect(() => {
    if (p !== 1) return;
    const anim = ref.current?.querySelector(".bw-flash")?.getAnimations()[0];
    const go = (zeroAt: number | null) => { if (alive.current && !ended.current) stopRef.current = playBigWinSound(tier, zeroAt); };
    if (anim) void anim.ready.then(() => go(typeof anim.startTime === "number" ? anim.startTime : null), () => go(null));
    else go(null);
  }, [p, tier]);

  return (
    <div ref={ref} className={`bw ${tier} ${theme} ${GENERIC.has(theme) ? "gen" : ""} ${mobile ? "m" : "d"} ${rm ? "rm" : ""} ${chained ? "chain" : ""}`} data-bw-phase={p} data-bw-theme={theme} style={{ ["--hit" as string]: `${hit}ms` }} aria-hidden>
      <div className="bw-vig" />
      <div className="bw-flash" />
      {theme === "tianhu" && <div className="bw-curtain" />}
      {theme === "dasanyuan" && <div className="bw-beam" />}
      <div className="bw-obj">
        {theme === "tianhu" && (
          <>
            <div className="bw-sun" data-bw-fly><div className="bw-rays" /></div>
            <div className="bw-hand">
              {TIANHU_HAND.map((t, i) => (
                <div key={t.id} className="bw-t" style={{ ["--i" as string]: i }}><MjTile tile={t} width="var(--tw)" height="var(--th)" /></div>
              ))}
            </div>
          </>
        )}
        {theme === "dasanyuan" && (
          <>
            <div className="bw-trio">
              {DRAGONS.map((t, i) => (
                <div key={t.id} className={`bw-d d${i}`}>
                  <div className="bw-pillar" />
                  <MjTile tile={t} width="var(--tw)" height="var(--th)" />
                </div>
              ))}
            </div>
            <div className="bw-line" data-bw-fly />
          </>
        )}
        {GENERIC.has(theme) && <GenericMain theme={theme} hitRel={hit - BEATS[tier][0]} />}
        {theme === "migi" && (
          <>
            <div className="bw-jade" />
            <div className="bw-stamp"><span>胡</span></div>
            <div className="bw-migi" data-bw-fly>MIGI</div>
          </>
        )}
        {/* 主標後面的暗底：牌桌中央的剩餘張數、「東風圈 第1局」不會透出來跟大字疊在一起 */}
        <div className="bw-back" />
        <div className="bw-title">
          {theme !== "migi" && <div className="bw-name">{title}</div>}
          <div className="bw-fan">{fan} 台</div>
        </div>
      </div>
      <div ref={anchorRef} className="bw-anchor" style={{ display: "none" }} />
      <div className="bw-skip"><i /><i /></div>
    </div>
  );
}

// ---------------- 第三版補做的 8 種：共用「擺牌」做法 ----------------
// 每張牌記：終點（x、y，單位＝一張牌的寬、高）、起點（x0、y0、轉角、縮放）、入場那一拍的亮度 o1、
// 主動作那一拍何時開始動（dl，從主動作開始算 ms）、動多久（du）、要不要先蓋著再翻面（fl＝開始翻的時間）。
// 時間都從重擊點倒推（hitRel＝重擊點離主動作開始幾 ms：頂級 800、大牌 300），畫面最亮那一下就會對在鑼聲上。
const GENERIC = new Set<BigWinTheme>(["zi1se", "dasixi", "xiaosixi", "qing1se", "wuanke", "baxian", "qiqiang1"]);
type G = { t: Tile; x: number; y: number; r?: number; x0?: number; y0?: number; r0?: number; s0?: number; o1?: number; dl?: number; du?: number; ez?: string; fl?: number; cls?: string };
const FLIP_MS = 120; // 翻面：牌背縮成一條 60ms＋牌面展開 60ms
const z = (rank: number) => tile("z", rank);
const ts3 = (suit: TileSuit, ranks: number[]) => ranks.map((r) => tile(suit, r));
const EASE_LAND = "cubic-bezier(.3,1.25,.5,1)", EASE_OUT = "cubic-bezier(.2,.8,.3,1)", EASE_PULL = "cubic-bezier(.6,0,.9,.6)";
/** 一排一排擺：rows＝每排的牌；同一排相鄰間距 1.06 張；gap＝哪幾張後面多空半張（分組） */
function rowsLayout(rows: Tile[][], opts: { gapAfter?: number[][]; rowStep?: number; arc?: number } = {}) {
  const out: { t: Tile; x: number; y: number; row: number; col: number }[] = [];
  const step = opts.rowStep ?? 1.08;
  rows.forEach((row, ri) => {
    const gaps = opts.gapAfter?.[ri] ?? [];
    const xs: number[] = []; let x = 0;
    row.forEach((_, ci) => { xs.push(x); x += 1.06 + (gaps.includes(ci) ? 0.5 : 0); });
    const w = xs[xs.length - 1];
    row.forEach((t, ci) => {
      const cx = xs[ci] - w / 2;
      // arc：中間高、兩邊低的弧（清一色的牌浪）
      const lift = opts.arc ? opts.arc * (1 - (cx / (w / 2 || 1)) ** 2) : 0;
      out.push({ t, x: cx, y: (ri - (rows.length - 1) / 2) * step - lift, row: ri, col: ci });
    });
  });
  return out;
}
// 牌型（都是能胡的 17 張真實牌型，或規格要的那一組）
// 字一色：東東東 南南南 西西西 中中中 發發發 白白（另含小三元 4 台，不到 8 台不另列）
const ZI1SE = [[z(1), z(1), z(1), z(2), z(2), z(2)], [z(3), z(3), z(3), z(5), z(5), z(5)], [z(6), z(6), z(6), z(7), z(7)]];
// 大四喜：東南西北各一刻（手牌另有 123 萬、55 筒，畫面只擺四喜）；小四喜：東南西三刻＋北一對
const WINDS4 = [1, 2, 3, 4];
// 清一色：同一門（萬子）17 張：111 234 456 678 789 99
const QING = ts3("m", [1, 1, 1, 2, 3, 4, 4, 5, 6, 6, 7, 7, 8, 8, 9, 9, 9]);
// 五暗刻：222萬 555萬 777筒 ／ 333條 東東東 ＋ 88條 一對
const WUANKE = [[...ts3("m", [2, 2, 2]), ...ts3("m", [5, 5, 5]), ...ts3("p", [7, 7, 7])], [...ts3("s", [3, 3, 3]), z(1), z(1), z(1), ...ts3("s", [8, 8])]];
// 花牌：照牌上印的數字排 春1 夏2 秋3 冬4、梅1 蘭2 菊3 竹4（遊戲裡 Flower7＝竹、Flower8＝菊，見 lib/mahjong/tiles.ts）
const FLOWERS = [1, 2, 3, 4, 5, 6, 8, 7].map((r) => tile("f", r));

function layoutOf(theme: BigWinTheme, hitRel: number): G[] {
  switch (theme) {
    case "zi1se": {
      // 四張字牌先以墨影浮在四角 → 17 張落成一方字印（最後一張落定在重擊點前 120ms，金墨在重擊點掃過）
      const L = rowsLayout(ZI1SE);
      const ink = new Set([0, 5, 12, 16]);
      return L.map((g, i) => ink.has(i)
        ? { ...g, x0: g.x * 1.7, y0: g.y * 1.9, o1: 0.35, dl: i * 20 + hitRel - 120 - 16 * 20 - 360, du: 360, ez: EASE_LAND }
        : { ...g, x0: g.x * 0.4, y0: g.y - 4, r0: (i % 2 ? 1 : -1) * 12, dl: i * 20 + hitRel - 120 - 16 * 20 - 360, du: 360, ez: EASE_LAND });
    }
    case "dasixi":
    case "xiaosixi": {
      // 羅盤：東（上）南（右）西（下）北（左），每一方擺那一刻（小四喜的北是一對）
      const big = theme === "dasixi";
      // 牌放大 1.5 倍後上下距離收一點（1.75→1.55 張高），手機上不碰到牌桌下緣
      const pos = [[0, -1.55], [3.25, 0], [0, 1.55], [-3.25, 0]];
      const out: G[] = [];
      WINDS4.forEach((w, k) => {
        const n = !big && w === 4 ? 2 : 3;
        for (let j = 0; j < n; j++) {
          const x = pos[k][0] + (j - (n - 1) / 2) * 1.06, y = pos[k][1];
          if (big) {
            // 大四喜：整個羅盤從倒轉半圈轉正（外層轉 -180→0，每張牌反向轉，牌面一直是正的），轉正那一刻＝重擊點
            out.push({ t: z(w), x, y, r0: 180, dl: hitRel - 800, du: 800, ez: "cubic-bezier(.25,.7,.25,1)", cls: "rot" });
          } else {
            // 小四喜：東南西從三個角掠入先亮，北晚半拍補位，落定＝重擊點
            const corner = [[-6, -4], [6, -4], [6, 4], [-6, 4]][k];
            const late = w === 4;
            out.push({ t: z(w), x, y, x0: corner[0], y0: corner[1], r0: corner[0] > 0 ? 25 : -25, dl: late ? hitRel - 180 : 0, du: late ? 180 : 200, ez: late ? EASE_PULL : EASE_OUT });
          }
        }
      });
      return out;
    }
    case "qing1se": {
      // 17 張同一門的牌背排成弧 → 從左到右逐張翻亮成一道牌浪，最後一欄翻好＝重擊點
      const L = rowsLayout([QING.slice(0, 9), QING.slice(9)], { arc: 0.35 });
      const last = hitRel - FLIP_MS, stepMs = last / 8;
      return L.map((g) => ({ ...g, y0: g.y + 0.35, o1: 0.55, dl: 0, du: 200, ez: EASE_OUT, fl: Math.round(g.col * stepMs) }));
    }
    case "wuanke": {
      // 五組暗刻蓋著浮出 → 從中間往外一組一組翻面（555萬、222萬、777筒、333條、東），第五組翻好＝重擊點；一對 88 條本來就亮著
      const L = rowsLayout(WUANKE, { gapAfter: [[2, 5], [2, 5]], rowStep: 1.14 });
      const order = [1, 0, 2, 3, 4]; // 第幾組第幾個翻
      const last = hitRel - FLIP_MS, stepMs = last / 4;
      return L.map((g) => {
        const grp = g.row * 3 + Math.floor(g.col / 3);
        const pair = g.row === 1 && g.col >= 6;
        return pair
          ? { ...g, y0: g.y + 0.3, o1: 0.4, dl: 0, du: 220, ez: EASE_OUT }
          : { ...g, y0: g.y + 0.3, o1: 0.4, dl: 0, du: 220, ez: EASE_OUT, fl: Math.round(order.indexOf(grp) * stepMs), cls: "thud" };
      });
    }
    case "baxian": {
      // 八仙過海（小宜〈八仙過海-重新設計〉方向 A 金潮長卷）：左右各四張從畫面外同時滑入，排成 4＋4 錯位雙列
      //（上排春夏秋冬、下排梅蘭菊竹，照牌上印的 1～4），落定＝重擊點，八張同時金亮
      return FLOWERS.map((t, i) => {
        const row = i < 4 ? 0 : 1, col = i % 4;
        const x = (col - 1.5) * 1.12 + (row ? 0.3 : -0.3), y = row ? 0.57 : -0.57;
        return { t, x, y, x0: x + (x < 0 ? -9 : 9), dl: 0, du: hitRel, ez: EASE_OUT, cls: "hitglow" };
      });
    }
    case "qiqiang1": {
      // 七張花排成上半圈的弧（照印的數字排）→ 第八張（秋）從對面被拉進圈中心，到位＝重擊點，弧圈瞬間閉合
      const seven = FLOWERS.filter((f) => f.rank !== 3);
      const arc: G[] = seven.map((t, i) => {
        const a = (180 + i * 30) * Math.PI / 180;
        return { t, x: Math.cos(a) * 3.3, y: Math.sin(a) * 1.6 + 0.55, s0: 0.85, o1: 0.75, dl: 0, du: 200, ez: EASE_OUT };
      });
      return [...arc, { t: FLOWERS[2], x: 0, y: 0.35, x0: 5.5, y0: 3, r0: 30, dl: hitRel - 220, du: 220, ez: EASE_PULL, cls: "glow" }];
    }
    default:
      return [];
  }
}

/** 主物件以外的光、環、花瓣（只用漸層、邊框；不用圖） */
function Extras({ theme }: { theme: BigWinTheme }) {
  switch (theme) {
    case "zi1se": return <><div className="bw-sealframe" /><div className="bw-sweep" /></>;
    case "dasixi": return <><div className="bw-ring" /><div className="bw-winds"><i /><i /><i /><i /></div></>;
    case "xiaosixi": return <><div className="bw-ring gap" /><div className="bw-ring full" /></>;
    case "qing1se": return <div className="bw-sweep" />;
    case "baxian": return <div className="bw-waves"><i /><i /></div>;
    case "qiqiang1": return <><div className="bw-ring half" /><div className="bw-ring full" /></>;
    default: return null;
  }
}
// 收向勝者名牌的那個東西（規格第 5 節最後一欄）
const FLYER: Partial<Record<BigWinTheme, string>> = {
  zi1se: "seal", dasixi: "disc", xiaosixi: "ring", qing1se: "arc", wuanke: "seal", baxian: "arc", qiqiang1: "ribbon",
};

function GenericMain({ theme, hitRel }: { theme: BigWinTheme; hitRel: number }) {
  const [gs] = useState(() => layoutOf(theme, hitRel));
  return (
    <>
      <div className="bw-main" style={{ ["--hr" as string]: `${hitRel}ms` }}>
        <Extras theme={theme} />
        <div className={theme === "dasixi" ? "bw-rotor" : "bw-tiles"}>
          {gs.map((g) => (
            <div key={g.t.id} className={`bw-g ${g.fl != null ? "flip" : ""} ${g.cls ?? ""}`} style={{
              ["--x" as string]: g.x, ["--y" as string]: g.y, ["--r" as string]: `${g.r ?? 0}deg`,
              ["--x0" as string]: g.x0 ?? g.x, ["--y0" as string]: g.y0 ?? g.y, ["--r0" as string]: `${g.r0 ?? 0}deg`, ["--s0" as string]: g.s0 ?? 1,
              ["--o1" as string]: g.o1 ?? 0, ["--dl" as string]: `${g.dl ?? 0}ms`, ["--du" as string]: `${g.du ?? 300}ms`, ["--ez" as string]: g.ez ?? EASE_OUT,
              ["--fl" as string]: `${g.fl ?? 0}ms`,
            }}>
              {g.fl != null
                  ? <div className="in"><div className="bk"><MjTile tile={g.t} faceDown width="var(--tw)" height="var(--th)" /></div><div className="fc"><MjTile tile={g.t} width="var(--tw)" height="var(--th)" /></div></div>
                  : <MjTile tile={g.t} width="var(--tw)" height="var(--th)" />}
            </div>
          ))}
        </div>
      </div>
      <div className={`bw-fly2 k-${FLYER[theme]}`} data-bw-fly />
    </>
  );
}

