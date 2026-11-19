"use client";
// 十三支本局結算、整場總結算（小宜 v5 §5～6，比照麻將每局結算的版型）：
//   畫面壓暗，左欄標題＋自己的明細＋金色主按鈕；右欄四家各一列。「查看牌桌」把面板暫時收起看四家亮開的牌，倒數不暫停
import { useState } from "react";
import type { Card } from "@/lib/thirteen";
import { CARD_BACK_SRC, cardSrc } from "./cardArt";
import { useStageScale } from "./stageScale";
import { badgeOf, breakdown, handScore, ROWS, rowDisplayOrder, type ThReveal } from "./revealTimeline";

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");
const tone = (n: number) => (n > 0 ? "is-up" : n < 0 ? "is-down" : "");
const HOLE = "/tiles/thirteen/fx/th-fx-hole1.v1.m.webp";

function Cards({ groups, labels }: { groups: Card[][]; labels?: { label: string; bonus: boolean }[] }) {
  return (
    <div className="th-res-cards">
      {groups.map((g, i) => (
        <div key={i} className="th-res-grp">
          {/* 每墩上方的牌型（小宜 v8-A §7）：伺服器結算的牌型；有加分紅金色，頭墩三條寫衝三 */}
          {labels?.[i] && <span className={`th-res-type${labels[i].bonus ? " is-bonus" : ""}`} data-th-res-type={labels[i].label}>{labels[i].label}</span>}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {g.map((c) => <img key={c.id} src={c ? cardSrc(c) : CARD_BACK_SRC} alt="" draggable={false} />)}
        </div>
      ))}
    </div>
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
  const readyN = ready?.filter((r) => r.ok).length ?? 0;
  const waiting = ready?.filter((r) => !r.ok).map((r) => (r.seat === mySeat ? "你" : r.name)) ?? [];
  useStageScale();
  const shotBy = rv.stats.map((st) => st.gunned);
  const items = breakdown(rv.stats[mySeat]); // 明細用伺服器的 stats（阿哲 2026-11-18：前端不再自己算）
  const total = rv.stats[mySeat]?.total ?? rv.result.totals[mySeat]; // 左欄「本局」：墩數（老闆 2026-11-19：左欄墩數、右欄輸贏）
  return (
    <div className={`th-res${peek ? " is-peek" : ""}`} data-th-result="round" role="dialog" aria-label="本局結算">
      <div className="th-res-left">
        <div className="th-res-title">本局結算</div>
        <div className="th-res-items" data-th-breakdown>
          {items.map((it) => <div key={it.label}><span>{it.label}</span><b className={tone(it.pts)}>{signed(it.pts)}</b></div>)}
          <div className="th-res-total"><span>本局</span><b className={tone(total)}>{signed(total)}</b></div>
        </div>
        <button type="button" className="th-res-btn primary" data-th-confirm disabled={confirmed || sending} onClick={onConfirm}>
          {confirmed ? (ready ? "已確認" : "等其他人…") : sending ? "送出中…" : `${confirmLabel ?? "確認"}${secondsLeft !== null ? `（${secondsLeft}）` : ""}`}
        </button>
        {ready && (
          <div className="th-res-ready" data-th-ready={readyN}>
            <span className="cnt">確認 {readyN}/4</span>
            {ready.map((r) => (
              <span key={r.seat} className={`chip ${r.ok ? "ok" : "wait"}`} data-th-ready-seat={r.seat} data-ok={r.ok ? "1" : "0"}><i>{r.ok ? "✓" : "…"}</i>{r.name}</span>
            ))}
            {readyN > 0 && waiting.length > 0 && <div className="line" role="status">還在等 {waiting.join("、")}</div>}
          </div>
        )}
        {error && !confirmed && <div className="th-res-err" role="alert" data-th-confirm-error>{error}</div>}
      </div>
      <div className="th-res-right">
        {[0, 1, 2, 3].map((seat) => {
          const a = rv.arrangements[seat];
          return (
            <div key={seat} className={`th-res-row${seat === mySeat ? " is-me" : ""}`} data-th-res-seat={seat}>
              <div className="th-res-who">
                <span>{names[seat]}</span>
                {rv.result.homeRun === seat && <span className="th-res-hr">全壘打</span>}
                {shotBy[seat] > 0 && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <span className="th-res-mark"><img src={HOLE} alt="" />−{shotBy[seat]}</span>
                )}
              </div>
              <Cards groups={ROWS.map((r) => rowDisplayOrder(a[r]))} labels={ROWS.map((r) => badgeOf(r, rv.result.values[seat][r]))} />
              <div className="th-res-pts">
                <b className={tone(handScore(rv, seat))}>{signed(handScore(rv, seat))}</b>
                <small>累計 {signed(rv.playerScores[seat])}</small>
              </div>
            </div>
          );
        })}
      </div>
      <button type="button" className="th-res-peek" data-th-peek onClick={() => setPeek((p) => !p)}>{peek ? "回到結算" : "查看牌桌"}</button>
    </div>
  );
}

/** 整場累計（伺服器的 stats：讀狀態、410 紀錄、th_room_closed 都有），依座位 */
export interface MatchStat { guns: number; gunned: number; homeRuns: number; homeRunned: number; total: number }

export function ThFinalResult({ players, mySeat, hands, stats, onLobby }: {
  players: { seat: number; playerName: string; totalScore: number }[];
  mySeat: number;
  hands: number;
  /** 伺服器的整場累計；舊紀錄沒有就是 null（只顯示總分） */
  stats: MatchStat[] | null;
  onLobby: () => void;
}) {
  useStageScale();
  const ranked = [...players].sort((a, b) => b.totalScore - a.totalScore || a.seat - b.seat);
  return (
    <div className="th-res" data-th-result="final" role="dialog" aria-label="總結算">
      <div className="th-res-left">
        <div className="th-res-title">總結算</div>
        <div className="th-res-sub">共 {hands} 局</div>
        <button type="button" className="th-res-btn primary" data-th-back-lobby onClick={onLobby}>回十三支大廳</button>
        {/* 小宜稿的「看對戰紀錄」：十三支還沒有對戰紀錄頁（只有 /api/thirteen/records），等頁面做了再加 */}
      </div>
      <div className="th-res-right">
        {ranked.map((p, i) => (
          <div key={p.seat} className={`th-res-row${p.seat === mySeat ? " is-me" : ""}`} data-th-fin-seat={p.seat}>
            <span className={`th-rank${i === 0 ? " is-1" : ""}`}>{i + 1}</span>
            <span className="th-fin-name">{p.playerName}</span>
            {stats?.[p.seat] && <span className="th-fin-stat" data-th-fin-guns={stats[p.seat].guns}>打槍 {stats[p.seat].guns}</span>}
            {stats?.[p.seat] && <span className="th-fin-stat" data-th-fin-hr={stats[p.seat].homeRuns}>全壘打 {stats[p.seat].homeRuns}</span>}
            <div className="th-res-pts"><b className={tone(p.totalScore)}>{signed(p.totalScore)}</b></div>
          </div>
        ))}
      </div>
    </div>
  );
}
