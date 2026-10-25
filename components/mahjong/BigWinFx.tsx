"use client";

// 大牌胡牌特效（老闆 2026-10-23 定案；哪一手要播、播哪一種見 lib/mahjong/bigWin.ts）。
// 設計：小宜〈大牌胡牌特效-設計規格-2026-10-22〉＋〈八仙過海-重新設計〉方向 A；試看版在預覽站試按台確認過（畫面、時間軸、金鈴音效對齊都照試看版）。
// 四拍：入場 → 主動作 → 定格（牌型名＋台數，後面墊不透明深綠底）→ 收向勝者名牌。頂級約 3 秒（T2）、大牌約 2 秒（G3）。
// 2026-10-25 老闆：八台大牌新版定案，大牌（tier big）7 種改由 BigWin8Fx 播；這裡只剩頂級 3 種（天胡、字一色、大四喜）。
// 順序改成「這一段 → 自摸／胡浮層（或帳號專屬的隕石自摸）→ 結算」（lib/mahjong/winShow.ts）：播完頁面會繼續掛著到整串結束，
// 只留暗角（.bw.done），後面那一段從暗角上淡入，牌桌不會先亮一下。
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
 * 播完後還掛著（後面接浮層或隕石）時只留暗角（.bw.done）
 */
export default function BigWinFx({ pick, seat, mobile, onDone }: { pick: BigWinPick; seat: number; mobile: boolean; onDone: (skipped: boolean) => void }) {
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
  const finish = () => { if (!ended.current) { ended.current = true; ref.current?.classList.add("done"); doneRef.current(false); } };

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
    <div ref={ref} className={`bw ${tier} ${theme} ${GENERIC.has(theme) ? "gen" : ""} ${mobile ? "m" : "d"} ${rm ? "rm" : ""}`} data-bw-phase={p} data-bw-theme={theme} style={{ ["--hit" as string]: `${hit}ms` }} aria-hidden>
      <div className="bw-vig" />
      <div className="bw-flash" />
      {theme === "tianhu" && <div className="bw-curtain" />}
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
        {GENERIC.has(theme) && <GenericMain theme={theme} hitRel={hit - BEATS[tier][0]} />}
        {/* 主標後面的暗底：牌桌中央的剩餘張數、「東風圈 第1局」不會透出來跟大字疊在一起 */}
        <div className="bw-back" />
        <div className="bw-title">
          <div className="bw-name">{title}</div>
          <div className="bw-fan">{fan} 台</div>
        </div>
      </div>
      <div ref={anchorRef} className="bw-anchor" style={{ display: "none" }} />
      <div className="bw-skip"><i /><i /></div>
    </div>
  );
}

// ---------------- 字一色、大四喜：共用「擺牌」做法（大牌 7 種 2026-10-25 改由 BigWin8Fx 播） ----------------
// 每張牌記：終點（x、y，單位＝一張牌的寬、高）、起點（x0、y0、轉角、縮放）、入場那一拍的亮度 o1、
// 主動作那一拍何時開始動（dl，從主動作開始算 ms）、動多久（du）。
// 時間都從重擊點倒推（hitRel＝重擊點離主動作開始幾 ms：頂級 800、大牌 300），畫面最亮那一下就會對在鑼聲上。
const GENERIC = new Set<BigWinTheme>(["zi1se", "dasixi"]);
type G = { t: Tile; x: number; y: number; r?: number; x0?: number; y0?: number; r0?: number; s0?: number; o1?: number; dl?: number; du?: number; ez?: string; cls?: string };
const z = (rank: number) => tile("z", rank);
const EASE_LAND = "cubic-bezier(.3,1.25,.5,1)", EASE_OUT = "cubic-bezier(.2,.8,.3,1)";
/** 一排一排擺：rows＝每排的牌；同一排相鄰間距 1.06 張、排距 1.08 張，整組置中 */
function rowsLayout(rows: Tile[][]) {
  const out: { t: Tile; x: number; y: number; row: number; col: number }[] = [];
  rows.forEach((row, ri) => {
    const w = (row.length - 1) * 1.06;
    row.forEach((t, ci) => out.push({ t, x: ci * 1.06 - w / 2, y: (ri - (rows.length - 1) / 2) * 1.08, row: ri, col: ci }));
  });
  return out;
}
// 牌型（都是能胡的 17 張真實牌型，或規格要的那一組）
// 字一色：東東東 南南南 西西西 中中中 發發發 白白（另含小三元 4 台，不到 8 台不另列）
const ZI1SE = [[z(1), z(1), z(1), z(2), z(2), z(2)], [z(3), z(3), z(3), z(5), z(5), z(5)], [z(6), z(6), z(6), z(7), z(7)]];
// 大四喜：東南西北各一刻（手牌另有 123 萬、55 筒，畫面只擺四喜）
const WINDS4 = [1, 2, 3, 4];

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
    case "dasixi": {
      // 羅盤：東（上）南（右）西（下）北（左），每一方擺那一刻；整個羅盤從倒轉半圈轉正（外層轉 -180→0，每張牌反向轉，牌面一直是正的），轉正那一刻＝重擊點
      // 牌放大 1.5 倍後上下距離收一點（1.75→1.55 張高），手機上不碰到牌桌下緣
      const pos = [[0, -1.55], [3.25, 0], [0, 1.55], [-3.25, 0]];
      const out: G[] = [];
      WINDS4.forEach((w, k) => {
        for (let j = 0; j < 3; j++) {
          const x = pos[k][0] + (j - 1) * 1.06, y = pos[k][1];
          out.push({ t: z(w), x, y, r0: 180, dl: hitRel - 800, du: 800, ez: "cubic-bezier(.25,.7,.25,1)", cls: "rot" });
        }
      });
      return out;
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
    default: return null;
  }
}
// 收向勝者名牌的那個東西（規格第 5 節最後一欄）
const FLYER: Partial<Record<BigWinTheme, string>> = {
  zi1se: "seal", dasixi: "disc",
};

function GenericMain({ theme, hitRel }: { theme: BigWinTheme; hitRel: number }) {
  const [gs] = useState(() => layoutOf(theme, hitRel));
  return (
    <>
      <div className="bw-main" style={{ ["--hr" as string]: `${hitRel}ms` }}>
        <Extras theme={theme} />
        <div className={theme === "dasixi" ? "bw-rotor" : "bw-tiles"}>
          {gs.map((g) => (
            <div key={g.t.id} className={`bw-g ${g.cls ?? ""}`} style={{
              ["--x" as string]: g.x, ["--y" as string]: g.y, ["--r" as string]: `${g.r ?? 0}deg`,
              ["--x0" as string]: g.x0 ?? g.x, ["--y0" as string]: g.y0 ?? g.y, ["--r0" as string]: `${g.r0 ?? 0}deg`, ["--s0" as string]: g.s0 ?? 1,
              ["--o1" as string]: g.o1 ?? 0, ["--dl" as string]: `${g.dl ?? 0}ms`, ["--du" as string]: `${g.du ?? 300}ms`, ["--ez" as string]: g.ez ?? EASE_OUT,
            }}>
              <MjTile tile={g.t} width="var(--tw)" height="var(--th)" />
            </div>
          ))}
        </div>
      </div>
      <div className={`bw-fly2 k-${FLYER[theme]}`} data-bw-fly />
    </>
  );
}

