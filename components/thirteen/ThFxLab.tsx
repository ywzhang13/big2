"use client";
// 十三支特效測試頁（app/thirteen/preview/fx）：四家牌全部亮開的牌桌上，按鈕觸發各種特效；元件和正式牌局同一套（ThTable、ThRevealFx）
import { useEffect, useMemo, useState } from "react";
import ThTable from "./ThTable";
import ThRevealFx, { preloadRevealFx } from "./ThRevealFx";
import { allOpen, MS, type PatternFx, type Step, type ThReveal } from "./revealTimeline";
import { applyFelt, FELTS, isFelt, loadFelt, type FeltKey } from "./feltTheme";
import { BIG_SFX, IHR_SFX, loadBigSfx, loadIhrSfx, playSfx, playSrc, saveBigSfx, saveIhrSfx, SFX_PICK, sfxSrc, useRevealSfx, type IhrSfxKey, type SfxVariant } from "./sfx";
import type { ThGameView } from "./useThirteenRoom";
import "./thRoom.css";
import "./thReveal.css";

const NAMES = ["老闆", "小明", "阿明", "小華"];
export type LabFx = "start" | PatternFx | "gun" | "gun3" | "homerun" | "insidehr";
const FX_LIST: { key: LabFx; name: string }[] = [
  { key: "start", name: "開始比牌" }, { key: "chongsan", name: "衝三" }, { key: "tiezhi", name: "鐵支" }, { key: "tonghuashun", name: "同花順" },
  { key: "wulong", name: "五龍" }, { key: "jpchongsan", name: "彩金衝三" }, { key: "jphulu", name: "彩金葫蘆" }, { key: "jptiezhi", name: "彩金鐵支" }, { key: "gun", name: "打槍" }, { key: "gun3", name: "被打三槍" }, { key: "homerun", name: "全壘打" }, { key: "insidehr", name: "場內全壘打" },
];
const SEATS = ["自己", "右家", "對家", "左家"]; // 自己坐 0 號：1 號在右、2 號對家、3 號在左（同 ThTable）
const isFx = (v: unknown): v is LabFx => FX_LIST.some((f) => f.key === v);

/** 這次要播的那一段（時間軸從 0 開始）；打槍打對家 */
export function labSteps(fx: LabFx, seat: number): Step[] {
  if (fx === "start") return [{ kind: "start", t0: 0, dur: MS.startWord }];
  if (fx === "gun") return [{ kind: "gun", t0: 0, dur: MS.gun, from: seat, to: (seat + 2) % 4, n: 0 }];
  // 被三家打槍（小宜 v8-B §7）：選的那家是被打的人，另外三家一人一槍，三槍三孔；選「自己」看第一人稱大彈孔
  if (fx === "gun3") return [1, 2, 3].map((k, n) => ({ kind: "gun" as const, t0: n * MS.gun, dur: MS.gun, from: (seat + k) % 4, to: seat, n }));
  if (fx === "homerun") return [{ kind: "homerun", t0: 0, dur: MS.homerun, seat }];
  if (fx === "insidehr") return [{ kind: "insidehr", t0: 0, dur: MS.insidehr, seat }]; // 選的那家是被三家打槍的人（只播場內全壘打這一段）
  return [{ kind: "fx", t0: 0, dur: MS.fx, row: fx === "chongsan" || fx === "jpchongsan" ? "front" : "middle", seat, fx }];
}

export default function ThFxLab({ rv, initial }: { rv: ThReveal; initial: { fx: string | null; seat: number; felt: string | null; ui: boolean } }) {
  const [fx, setFx] = useState<LabFx>(isFx(initial.fx) ? initial.fx : "tiezhi");
  const [seat, setSeat] = useState(initial.seat >= 0 && initial.seat <= 3 ? Math.floor(initial.seat) : 0);
  const [felt, setFelt] = useState<FeltKey>("green");
  const [ui, setUi] = useState(initial.ui);
  const [play, setPlay] = useState<{ n: number; at: number; steps: Step[] } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [big, setBig] = useState<string | null>(null);
  const [ihr, setIhr] = useState<Partial<Record<IhrSfxKey, SfxVariant>>>({});

  // 自動量測用（只有預覽站的這一頁有）：照正式牌局同一條路（playSrc → Web Audio、跟著互動音效音量）播一個檔
  useEffect(() => { (window as unknown as { __thPlay?: typeof playSrc }).__thPlay = playSrc; }, []);
  useEffect(() => {
    setBig(loadBigSfx()); setIhr(loadIhrSfx());
    const f = isFelt(initial.felt) ? initial.felt : loadFelt();
    setFelt(f); applyFelt(f, isFelt(initial.felt));
    // 特效圖都載好才播（第一次打開圖還在下載）；網址有 fx 就自動播一次
    void preloadRevealFx().then(() => { if (isFx(initial.fx)) setPlay({ n: 1, at: Date.now() + 300, steps: labSteps(initial.fx, seat) }); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 33);
    return () => clearInterval(id);
  }, []);

  // 晚 0.1 秒開始：音效那邊先看到負的時間，0 秒的大字聲才不會被當成「已經過了」而略過
  const go = (f: LabFx, s: number) => { setFx(f); setSeat(s); setPlay((p) => ({ n: (p?.n ?? 0) + 1, at: Date.now() + 100, steps: labSteps(f, s) })); };
  const pickFelt = (k: FeltKey) => { setFelt(k); applyFelt(k); };
  // 大牌音效候選：按了就試聽並選用（記在本機，衝三、鐵支、同花順、五龍和完整牌局都用這個）；按「不選」回到原本（衝三、鐵支、同花順靜音、五龍照舊）
  const pickBig = (id: string | null) => {
    const x = BIG_SFX.find((c) => c.id === id);
    if (x) playSfx("chongsan", { src: x.src, force: true });
    setBig(x ? x.id : null); saveBigSfx(x ? x.id : null);
  };
  const batches = [...new Set(BIG_SFX.map((x) => x.batch))];
  // 場內全壘打音效候選（老闆 2026-11-28）：按了就試聽並選用（記在本機），完整牌局照同一個選擇播
  const pickIhr = (key: IhrSfxKey, v: SfxVariant) => { playSrc(sfxSrc(key, v), { force: true }); saveIhrSfx(key, v); setIhr(loadIhrSfx()); };

  const view: ThGameView = useMemo(() => ({
    status: "playing", code: "0000", sv: 0, phase: "revealed", handNo: 1, settings: { arrangeSec: 60, totalHands: 8 },
    serverNow: 0, arrangeDeadline: null, players: NAMES.map((name, s) => ({ id: `p${s}`, name, seat: s, submitted: true })),
    me: { seat: 0, hand: [], arrangement: rv.arrangements[0] }, reveal: rv,
  }), [rv]);
  const t = play ? now - play.at : 0;
  const steps = useMemo(() => play?.steps ?? [], [play]);
  const active = play && t >= 0 ? steps.filter((s) => t >= s.t0 && t < s.t0 + s.dur) : [];
  // 彈孔留著（每槍 0.26 秒中彈）；重播或換特效才清掉
  const shot = [0, 1, 2, 3].map((seat) => steps.filter((s) => s.kind === "gun" && s.to === seat && t >= s.t0 + 260).length);
  const frame = { ...allOpen(), shot };
  useRevealSfx(steps, play ? t : 0, 0);

  return (
    <>
      <ThTable view={view} now={now} clockSkew={0} reveal={{ rv, frame }} menu={false} />
      {play && <ThRevealFx key={play.n} active={active} t={Math.max(0, t)} mySeat={0} names={NAMES} />}
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
          <div className="th-lab-row" data-th-lab-big>{/* 大牌音效（老闆 2026-11-18 第 10 輪）：已定案的音效選項都拿掉，只留這一組；候選照批次分組，BIG_SFX 加一行就多一顆 */}
            <span className="th-lab-sfx">大牌音效</span>
            {batches.map((b) => (
              <span key={b} className="th-lab-sfx">
                {b}
                {BIG_SFX.filter((x) => x.batch === b).map((x) => (
                  <button key={x.id} type="button" title={x.name} className={big === x.id ? "is-on" : ""} data-th-lab-big={x.id} onClick={() => pickBig(x.id)}>{x.label}</button>
                ))}
              </span>
            ))}
            <button type="button" className={big ? "" : "is-on"} data-th-lab-big="off" onClick={() => pickBig(null)}>不選</button>
          </div>
          <div className="th-lab-row" data-th-lab-ihr>
            <span className="th-lab-sfx">場內全壘打音效</span>
            {IHR_SFX.map((x) => (
              <span key={x.key} className="th-lab-sfx">
                {x.name}
                {x.options.map((o) => (
                  <button key={String(o.v)} type="button" title={o.name} className={(ihr[x.key] ?? SFX_PICK[x.key]) === o.v ? "is-on" : ""} data-th-lab-ihr={`${x.key}-${o.v}`} onClick={() => pickIhr(x.key, o.v)}>{o.label}</button>
                ))}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <button type="button" className="th-lab-open" onClick={() => setUi(true)} aria-label="打開特效按鈕">特效</button>
      )}
    </>
  );
}
