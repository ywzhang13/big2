"use client";
// 十三支本局結算、整場總結算（小宜 v15 §4～5：位置對齊麻將每局結算，外框用三款共用的 GameResultFrame）：
//   左欄大標題、彩金牌、「查看牌桌」小按鈕、自己的明細（墩數）；右欄四家（三墩＋一條線隔開的沒用到 3 張、乘過底分的輸贏和累計）、
//   「還在等 A、B」、「確認 2/4」小牌子，右下角主要按鈕。「查看牌桌」把面板暫時收起看四家亮開的牌，倒數不暫停
import { useState } from "react";
import { CAT, type Card } from "@/lib/thirteen";
import GameResultFrame from "../gameResult/GameResultFrame";
import { cardSrc, isGold } from "./cardArt";
import { useStageScale } from "./stageScale";
import { badgeOf, breakdown, handScore, ROWS, rowDisplayOrder, type ThReveal } from "./revealTimeline";

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");
const HOLE = "/tiles/thirteen/fx/th-fx-hole1.v1.m.webp";
/** 彩金牌型（彩金三條／葫蘆／鐵支）：牌型小標用金底（v15 §4-2） */
const LUCKY_CATS = new Set<number>([CAT.LUCKY_THREE, CAT.LUCKY_FULL_HOUSE, CAT.LUCKY_FOUR]);

function Img({ c, lucky }: { c: Card; lucky: number | null }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={isGold(c, lucky) ? "is-gold" : undefined} src={cardSrc(c, lucky)} alt="" draggable={false} />;
}

/** 一家的三墩（每墩上面一顆牌型小標）＋沒用到的 3 張（先空 10、一條直線、再空 10，正常顏色、不寫字） */
function Cards({ groups, labels, unused, lucky }: { groups: Card[][]; labels: { label: string; bonus: boolean; jp: boolean }[]; unused?: Card[]; lucky: number | null }) {
  return (
    <div className="th-res-cards">
      {groups.map((g, i) => (
        <div key={i} className="th-res-grp">
          <span className={`th-res-type${labels[i].jp ? " is-jp" : labels[i].bonus ? " is-bonus" : ""}`} data-th-res-type={labels[i].label}>{labels[i].label}</span>
          {g.map((c) => <Img key={c.id} c={c} lucky={lucky} />)}
        </div>
      ))}
      {/* 伺服器亮牌後才給 unusedCards，沒有就不顯示 */}
      {unused && unused.length > 0 && (
        <div className="th-res-grp th-res-unused" data-th-unused={unused.length}>
          {rowDisplayOrder(unused).map((c) => <Img key={c.id} c={c} lucky={lucky} />)}
        </div>
      )}
    </div>
  );
}

/** 「彩金」小標＋彩金牌（本局結算左欄標題下） */
function LuckyTag({ card }: { card: Card }) {
  return (
    <span className="th-res-lucky" data-th-res-lucky={card.id}>
      <b>彩金</b>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={cardSrc(card, card.rank)} alt="彩金牌" draggable={false} />
    </span>
  );
}

export function ThRoundResult({ rv, names, mySeat, secondsLeft, confirmed, sending = false, error = null, onConfirm, confirmLabel, ready = null }: {
  rv: ThReveal;
  names: string[];
  mySeat: number;
  /** 確認鈕上的倒數（秒）；null＝不倒數 */
  secondsLeft: number | null;
  confirmed: boolean;
  sending?: boolean;
  error?: string | null;
  onConfirm: () => void;
  confirmLabel?: string;
  /** 四家有沒有按確認（跟麻將一樣顯示誰在等誰）；null＝不顯示（最後一局、預覽頁） */
  ready?: { seat: number; name: string; ok: boolean }[] | null;
}) {
  const [peek, setPeek] = useState(false);
  useStageScale();
  const readyN = ready?.filter((r) => r.ok).length ?? 0;
  const waiting = ready?.filter((r) => !r.ok).map((r) => (r.seat === mySeat ? "你" : r.name)) ?? [];
  const lucky = rv.luckyCard ?? null, lr = lucky?.rank ?? null;
  const shotBy = rv.stats.map((st) => st.gunned);
  // 明細用伺服器的 stats（墩數，老闆 2026-11-19：左欄墩數、右欄輸贏）；只列有分數的項目（v15 §4-3：v4 的墩分永遠 0 就不列）
  const items = breakdown(rv.stats[mySeat]).filter((it) => it.pts !== 0).map((it) => ({ label: it.label, value: it.pts }));
  const total = rv.stats[mySeat]?.total ?? rv.result.totals[mySeat];
  const btn = confirmed ? (ready ? "已確認" : "等其他人…") : sending ? "送出中…" : `${confirmLabel ?? "確認"}${secondsLeft !== null ? `（${secondsLeft}）` : ""}`;
  return (
    <GameResultFrame
      title="本局結算" scaleVar="var(--th-s2, 1)" peek={peek} onBack={() => setPeek(false)} attrs={{ "data-th-result": "round" }}
      sub={lucky ? <LuckyTag card={lucky} /> : undefined}
      tool={{ label: "查看牌桌", onClick: () => setPeek(true), attrs: { "data-th-peek": "" } }}
      items={items} total={{ label: "本局", value: total }}
      rows={[0, 1, 2, 3].map((seat) => {
        const a = rv.arrangements[seat], v = rv.result.values[seat], d = handScore(rv, seat);
        return {
          key: seat, me: seat === mySeat, name: names[seat], delta: d, sub: <>累計 {signed(rv.playerScores[seat])}</>, attrs: { "data-th-res-seat": seat },
          marks: <>
            {rv.result.homeRun === seat && <span className="gr-mark hr">全壘打</span>}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {shotBy[seat] > 0 && <span className="gr-mark shot"><img src={HOLE} alt="" />−{shotBy[seat]}</span>}
          </>,
          body: <Cards groups={ROWS.map((r) => rowDisplayOrder(a[r]))} labels={ROWS.map((r) => ({ ...badgeOf(r, v[r]), jp: LUCKY_CATS.has(v[r].cat) }))} unused={rv.unusedCards?.[seat]} lucky={lr} />,
        };
      })}
      next={readyN > 0 && waiting.length > 0 ? `還在等 ${waiting.join("、")}` : null}
      ready={ready ? { label: `確認 ${readyN}/4`, attrs: { "data-th-ready": readyN }, chips: ready.map((r) => ({ key: r.seat, name: r.name, ok: r.ok, attrs: { "data-th-ready-seat": r.seat, "data-ok": r.ok ? "1" : "0" } })) } : null}
      error={confirmed ? null : error}
      primary={{ label: btn, disabled: confirmed || sending, onClick: onConfirm, attrs: { "data-th-confirm": "" } }}
    />
  );
}

/** 整場累計（伺服器的 stats：讀狀態、410 紀錄、th_room_closed 都有），依座位 */
export interface MatchStat { guns: number; gunned: number; homeRuns: number; homeRunned: number; total: number }

export function ThFinalResult({ players, mySeat, hands, stats, onLobby, baseScore = null }: {
  players: { seat: number; playerName: string; totalScore: number }[];
  mySeat: number;
  hands: number;
  /** 伺服器的整場累計；舊紀錄沒有就是 null（只顯示總分） */
  stats: MatchStat[] | null;
  onLobby: () => void;
  /** 這房的底分（舊房 1 或沒有就不寫） */
  baseScore?: number | null;
}) {
  useStageScale();
  const ranked = [...players].sort((a, b) => b.totalScore - a.totalScore || a.seat - b.seat);
  return (
    <GameResultFrame
      title="總結算" scaleVar="var(--th-s2, 1)" attrs={{ "data-th-result": "final" }}
      sub={<span data-th-fin-sub>{hands} 局{baseScore && baseScore > 1 ? `・底分 ${baseScore}` : ""}</span>}
      rows={ranked.map((p, i) => {
        const st = stats?.[p.seat];
        return {
          key: p.seat, me: p.seat === mySeat, name: p.playerName, rank: i, delta: p.totalScore, attrs: { "data-th-fin-seat": p.seat },
          stats: st ? [
            { label: "打槍", value: st.guns, attrs: { "data-th-fin-guns": st.guns } },
            { label: "被打槍", value: st.gunned, attrs: { "data-th-fin-gunned": st.gunned } },
            { label: "全壘打", value: st.homeRuns, attrs: { "data-th-fin-hr": st.homeRuns } },
          ] : undefined,
        };
      })}
      primary={{ label: "回大廳", onClick: onLobby, attrs: { "data-th-back-lobby": "" } }}
    />
  );
}
