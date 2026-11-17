"use client";
// 十三支特效測試頁（app/thirteen/preview/fx）：四家牌全部亮開的牌桌上，按鈕觸發各種特效；元件和正式牌局同一套（ThTable、ThRevealFx）
import { useEffect, useMemo, useState } from "react";
import ThTable from "./ThTable";
import ThRevealFx, { preloadRevealFx } from "./ThRevealFx";
import { allOpen, MS, type PatternFx, type Step, type ThReveal } from "./revealTimeline";
import { applyFelt, FELTS, isFelt, loadFelt, type FeltKey } from "./feltTheme";
import type { ThGameView } from "./useThirteenRoom";
import "./thRoom.css";
import "./thReveal.css";

const NAMES = ["老闆", "小明", "阿明", "小華"];
export type LabFx = "start" | PatternFx | "gun" | "homerun";
const FX_LIST: { key: LabFx; name: string }[] = [
  { key: "start", name: "開始比牌" }, { key: "chongsan", name: "衝三" }, { key: "tiezhi", name: "鐵支" }, { key: "tonghuashun", name: "同花順" },
  { key: "wulong", name: "五龍" }, { key: "gun", name: "打槍" }, { key: "homerun", name: "全壘打" },
];
const SEATS = ["自己", "右家", "對家", "左家"]; // 自己坐 0 號：1 號在右、2 號對家、3 號在左（同 ThTable）
const isFx = (v: unknown): v is LabFx => FX_LIST.some((f) => f.key === v);

/** 這次要播的那一段（時間軸從 0 開始）；打槍打對家 */
export function labStep(fx: LabFx, seat: number): Step {
  if (fx === "start") return { kind: "start", t0: 0, dur: MS.start };
  if (fx === "gun") return { kind: "gun", t0: 0, dur: MS.gun, from: seat, to: (seat + 2) % 4, n: 0 };
  if (fx === "homerun") return { kind: "homerun", t0: 0, dur: MS.homerun, seat };
  return { kind: "fx", t0: 0, dur: MS.fx, row: fx === "chongsan" ? "front" : "middle", seat, fx };
}

export default function ThFxLab({ rv, initial }: { rv: ThReveal; initial: { fx: string | null; seat: number; felt: string | null; ui: boolean } }) {
  const [fx, setFx] = useState<LabFx>(isFx(initial.fx) ? initial.fx : "tiezhi");
  const [seat, setSeat] = useState(initial.seat >= 0 && initial.seat <= 3 ? Math.floor(initial.seat) : 0);
  const [felt, setFelt] = useState<FeltKey>("green");
  const [ui, setUi] = useState(initial.ui);
  const [play, setPlay] = useState<{ n: number; at: number; step: Step } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const f = isFelt(initial.felt) ? initial.felt : loadFelt();
    setFelt(f); applyFelt(f, isFelt(initial.felt));
    // 特效圖都載好才播（第一次打開圖還在下載）；網址有 fx 就自動播一次
    void preloadRevealFx().then(() => { if (isFx(initial.fx)) setPlay({ n: 1, at: Date.now() + 300, step: labStep(initial.fx, seat) }); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 33);
    return () => clearInterval(id);
  }, []);

  const go = (f: LabFx, s: number) => { setFx(f); setSeat(s); setPlay((p) => ({ n: (p?.n ?? 0) + 1, at: Date.now(), step: labStep(f, s) })); };
  const pickFelt = (k: FeltKey) => { setFelt(k); applyFelt(k); };

  const view: ThGameView = useMemo(() => ({
    status: "playing", code: "0000", sv: 0, phase: "revealed", handNo: 1, settings: { arrangeSec: 60, totalHands: 8 },
    serverNow: 0, arrangeDeadline: null, players: NAMES.map((name, s) => ({ id: `p${s}`, name, seat: s, submitted: true })),
    me: { seat: 0, hand: [], arrangement: rv.arrangements[0] }, reveal: rv,
  }), [rv]);
  const frame = useMemo(() => allOpen(), []);
  const t = play ? now - play.at : 0;
  const active = play && t >= 0 && t < play.step.dur ? [play.step] : [];

  return (
    <>
      <ThTable view={view} now={now} clockSkew={0} reveal={{ rv, frame }} menu={false} />
      {play && <ThRevealFx key={play.n} active={active} t={Math.max(0, t)} mySeat={0} />}
      {ui ? (
        <div className="th-lab" data-th-lab>
          <div className="th-lab-row">
            {FX_LIST.map((f) => (
              <button key={f.key} type="button" className={f.key === fx ? "is-on" : ""} data-th-lab-fx={f.key} onClick={() => go(f.key, seat)}>{f.name}</button>
            ))}
          </div>
          <div className="th-lab-row">
            {SEATS.map((name, s) => (
              <button key={s} type="button" className={s === seat ? "is-on" : ""} data-th-lab-seat={s} disabled={fx === "start"} onClick={() => go(fx, s)}>{name}</button>
            ))}
            <button type="button" className="is-replay" data-th-lab-replay onClick={() => go(fx, seat)}>重播</button>
          </div>
          <div className="th-lab-row">
            {FELTS.map((f) => (
              <button key={f.key} type="button" className={`th-lab-felt${f.key === felt ? " is-on" : ""}`} data-th-lab-felt={f.key} onClick={() => pickFelt(f.key)}>
                <i style={{ background: f.swatch }} />{f.name}
              </button>
            ))}
            <button type="button" onClick={() => setUi(false)}>收起</button>
          </div>
        </div>
      ) : (
        <button type="button" className="th-lab-open" onClick={() => setUi(true)} aria-label="打開特效按鈕">特效</button>
      )}
    </>
  );
}
