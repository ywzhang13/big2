"use client";
// 十三支牌桌（送出後等其他人；小宜 v3 增補「牌桌：理牌中」＋v4「中央不放多餘文字、四家往中央靠」）：
//   自己在下方（攤開送出的三墩），下家在右、對家在上、上家在左（同麻將）；他家是 13 張牌背排成 3／5／5，
//   整組轉向自己的座位（左家 90°、右家 −90°、對家 180°），名字和狀態不轉
//   老闆 2026-11-18：牌桌不放文字引導（拿掉「已送出」「幾家已送出」「進入亮牌」），只留名字、倒數、局數；
//   還在理牌的人頭上一個「思考中…」對話泡泡（參考老闆圖五），送出後泡泡消失
//   亮牌（小宜 v5 §2）：傳 reveal 進來就照時間軸的那一刻畫——四家先都是牌背，翻開的墩換成牌面、正在翻的那排金色光暈、
//   那排正中央蓋牌型徽章（永遠是正的，不跟著牌轉）、這墩翻完在旁邊跳得失分；被打槍的人名字旁小彈孔＋「−N」
import { useEffect } from "react";
import type { Arrangement, Card } from "@/lib/thirteen";
import { CARD_BACK_SRC, cardSrc } from "./cardArt";
import { badgeOf, ROWS, rowDeltas, type RevealFrame, type ThReveal } from "./revealTimeline";
import type { ThGameView } from "./useThirteenRoom";
import { preloadRevealFx } from "./ThRevealFx";
import ThFeltMenu from "./ThFeltMenu";

const ROW_SIZES = [3, 5, 5];
export type Pos = "bottom" | "right" | "top" | "left";
export const POS_BY_OFFSET: Pos[] = ["bottom", "right", "top", "left"];
const ROT: Record<Pos, number> = { bottom: 0, right: -90, top: 180, left: 90 };

type RowView = { cards: (Card | null)[]; glow?: boolean; badge?: { label: string; bonus: boolean } | null; delta?: number | null };

function Block({ rows, pos, mine }: { rows: RowView[]; pos: Pos; mine: boolean }) {
  return (
    <div className={`th-blk${mine ? " is-mine" : ""}`} style={{ transform: `translate(-50%, -50%) rotate(${ROT[pos]}deg)` }}>
      {rows.map((row, r) => (
        <div key={r} className={`th-blk-row${row.glow ? " is-glow" : ""}`} data-th-row={ROWS[r]}>
          {row.cards.map((c, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={c ? c.id : `b${i}`} src={c ? cardSrc(c) : CARD_BACK_SRC} alt="" draggable={false} />
          ))}
          {row.badge && (
            <span className={`th-badge${row.badge.bonus ? " is-bonus" : ""}`} data-th-badge={row.badge.label} style={{ transform: `translate(-50%, -50%) rotate(${-ROT[pos]}deg)` }}>{row.badge.label}</span>
          )}
          {row.delta != null && (
            <span className={`th-delta${row.delta > 0 ? " is-up" : row.delta < 0 ? " is-down" : ""}`} data-th-delta={row.delta} style={{ transform: `translateY(-50%) rotate(${-ROT[pos]}deg)` }}>
              {row.delta > 0 ? `+${row.delta}` : row.delta < 0 ? `−${-row.delta}` : "0"}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

const fmt = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const backs = () => ROW_SIZES.map((n) => Array<null>(n).fill(null));

export default function ThTable({ view, now, clockSkew, reveal, menu = true }: {
  view: ThGameView; now: number; clockSkew: number;
  /** 左上角設定（換牌桌）；特效測試頁有自己的按鈕就不放 */
  menu?: boolean;
  /** 亮牌中：伺服器的亮牌內容＋時間軸現在這一刻（沒有＝理牌中的牌桌） */
  reveal?: { rv: ThReveal; frame: RevealFrame } | null;
}) {
  const mySeat = view.me?.seat ?? 0;
  const mine: Arrangement | null = view.me?.arrangement ?? null;
  const revealed = !!reveal || view.phase === "revealed" || view.status === "finished";
  const left = view.arrangeDeadline !== null ? view.arrangeDeadline - (now + clockSkew) : 0;
  const deltas = reveal ? rowDeltas(reveal.rv.result) : null;
  useEffect(() => { void preloadRevealFx(); }, []); // 等其他人送出的時候先載特效圖

  function rowsFor(seat: number, isMe: boolean): RowView[] {
    if (!reveal) {
      const cards = isMe && mine ? [mine.front, mine.middle, mine.back] : backs();
      return cards.map((c) => ({ cards: c }));
    }
    const { rv, frame } = reveal;
    const a = rv.arrangements[seat];
    return ROWS.map((row, i) => {
      const open = frame.open[seat][row];
      const current = frame.row === row;
      return {
        cards: open ? a[row] : backs()[i],
        glow: frame.glow.some((g) => g.seat === seat && g.row === row),
        badge: open && current ? badgeOf(row, rv.result.values[seat][row]) : null,
        delta: current && frame.showRowScore && deltas ? deltas[row][seat] : null,
      };
    });
  }

  return (
    <div className="th-table" data-testid="th-table">
      <div className="th-felt" />
      {view.players.map((p) => {
        const pos = POS_BY_OFFSET[(p.seat - mySeat + 4) % 4];
        const isMe = pos === "bottom";
        const shot = reveal?.frame.shot[p.seat] ?? 0;
        return (
          <div key={p.id} className={`th-seatbox th-at-${pos}`} data-seat={p.seat} data-th-pos={pos}>
            <Block rows={rowsFor(p.seat, isMe)} pos={pos} mine={isMe && (!!mine || !!reveal)} />
            <div className="th-name">
              <span className="th-avatar">{p.name.slice(-1)}</span>
              <span className="th-name-t">{p.name}</span>
              {!p.submitted && !revealed && (
                <span className="th-think" data-th-thinking={p.seat} role="img" aria-label={`${p.name} 思考中`}>思考中<i>.</i><i>.</i><i>.</i></span>
              )}
              {shot > 0 && (
                <span className="th-shot" data-th-shot={shot}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/tiles/thirteen/fx/th-fx-hole1.v1.m.webp" alt="" draggable={false} />−{shot}
                </span>
              )}
            </div>
          </div>
        );
      })}
      {menu && <ThFeltMenu />}
      <div className="th-hands" aria-label={`第 ${view.handNo} 局，共 ${view.settings.totalHands} 局`}>{view.handNo}/{view.settings.totalHands}</div>
      {!revealed && (
        <div className="th-center" role="timer">
          <div className={`th-clock${left <= 10_000 ? " is-low" : ""}`}>{fmt(left)}</div>
        </div>
      )}
    </div>
  );
}
