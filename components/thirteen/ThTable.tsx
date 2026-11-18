"use client";
// 十三支牌桌（送出後等其他人；小宜 v3 增補「牌桌：理牌中」＋v4「中央不放多餘文字、四家往中央靠」）：
//   自己在下方（攤開送出的三墩），下家在右、對家在上、上家在左（同麻將）；他家是 13 張牌背排成 3／5／5，
//   整組轉向自己的座位（左家 90°、右家 −90°、對家 180°），名字和狀態不轉
//   老闆 2026-11-18：牌桌不放文字引導（拿掉「已送出」「幾家已送出」「進入亮牌」），只留名字、倒數、局數；
//   還在理牌的人頭上一個「思考中…」對話泡泡（參考老闆圖五），送出後泡泡消失
//   亮牌（小宜 v5 §2）：傳 reveal 進來就照時間軸的那一刻畫——四家先都是牌背，翻開的墩換成牌面、正在翻的那排金色光暈、
//   那排正中央蓋牌型徽章（永遠是正的，不跟著牌轉）、這墩翻完在旁邊跳得失分；被打槍的人名字旁小彈孔＋「−N」
import { useEffect } from "react";
import type { Card } from "@/lib/thirteen";
import { CARD_BACK_SRC, cardSrc } from "./cardArt";
import { badgeOf, ROW_NAME, ROWS, rowDeltas, rowDisplayOrder, type RevealFrame, type ThReveal } from "./revealTimeline";
import type { ThGameView } from "./useThirteenRoom";
import { preloadRevealFx } from "./ThRevealFx";
import ThFeltMenu from "./ThFeltMenu";
import GamePlate, { type PlateSeat } from "../GamePlate";
import { useStageScale } from "./stageScale";

const ROW_SIZES = [3, 5, 5];
export type Pos = "bottom" | "right" | "top" | "left";
export const POS_BY_OFFSET: Pos[] = ["bottom", "right", "top", "left"];
const ROT: Record<Pos, number> = { bottom: 0, right: -90, top: 180, left: 90 };

type RowView = { cards: Card[] | null; glow?: boolean };

/** 出牌版面（小宜 v12 §2，基準 844×390）：出牌區中心、手牌區往自己那側的距離；自己的牌大一號；左右家同墩錯開比較短（side）。
 *  四家圍著中央看板成四方形：對家、自己到看板 8，左右家 10 */
const GEO: Record<Pos, { x: number; y: number; hand: number; big: boolean; side: boolean }> = {
  bottom: { x: 422, y: 299, hand: 88, big: true, side: false },
  top: { x: 422, y: 79, hand: 77, big: false, side: false },
  left: { x: 300, y: 185, hand: 188, big: false, side: true },   // 手牌區、名牌留在原位（x 112），出牌區靠向看板
  right: { x: 544, y: 185, hand: 188, big: false, side: true },
};
/** 共用名牌的座位代號（決定思考中泡泡朝哪邊） */
const PLATE_SEAT: Record<Pos, PlateSeat> = { bottom: "b", top: "t", left: "l", right: "r" };
/** 中央看板裡四家的格子（v12 §4）：對家上、左家左、右家右、自己下；字都是正的 */
const CELL: Record<Pos, "t" | "l" | "r" | "b"> = { top: "t", left: "l", right: "r", bottom: "b" };

/** 一家：靠自己那側的手牌區（13 張牌背 3／5／5，出掉的那組空出來）＋靠中央的出牌區（頭墩最靠中央、中墩疊上去往自己那側錯開、尾墩再疊；最新的在最上層）。
 *  整組轉向自己的座位；牌型＋分數那一行字是正的 */
/** 被打槍的彈孔位置（出牌區中心為原點），三個彼此隔 30 以上 */
const HOLE_AT = [[-42, -18], [34, 6], [-6, 38]];
/** 第一人稱大彈孔（被打的人自己的畫面；基準版面座標，小宜 v8-B §7）。老闆 2026-11-18：三槍要在同一畫面——
 *  大彈孔 220 見方，三個橫排在畫面中段（左、中、右，彼此只疊一點），轉了角度外框也還在 844×390 裡（見 thReveal.css .th-hole-big） */
const BIG_HOLE_AT = [[215, 185], [629, 205], [422, 190]];
/** 彈孔：老闆 2026-11-18 新圖（去洋紅底、四邊羽化，沒有矩形外框）；三個孔各轉一個角度看起來不一樣 */
const HOLE_SRC = "/tiles/thirteen/fx/th-fx-hole.v2.m.webp", HOLE_BIG_SRC = "/tiles/thirteen/fx/th-fx-hole.v2.d.webp";
const HOLE_ROT = [0, 130, 250];

function Seat({ rows, pos, played, holes }: { rows: RowView[]; pos: Pos; played: boolean[]; holes: number }) {
  // 彈孔角度用 --hr 放進 transform（直接用 rotate 屬性會繞著還沒置中的框轉，彈孔被甩出原位；老闆 2026-11-18 截圖三槍跑出畫面）
  const g = GEO[pos];
  const rot = ROT[pos];
  return (
    <div className={`th-seat2${g.big ? " is-big" : ""}${g.side ? " is-side" : ""}`} style={{ left: g.x, top: g.y, transform: `rotate(${rot}deg)` }}>
      <div className="th-blk" data-th-play>
        {HOLE_AT.slice(0, holes).map(([x, y], i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={`h${i}`} className="th-hole" data-th-hole={i} src={HOLE_SRC} alt="" draggable={false} style={{ left: `calc(50% + ${x}px)`, top: `calc(50% + ${y}px)`, "--hr": `${HOLE_ROT[i]}deg` } as React.CSSProperties} />
        ))}
        {rows.map((row, r) => row.cards && (
          <div key={r} className={`th-blk-row${row.glow ? " is-glow" : ""}`} data-th-row={ROWS[r]} style={{ top: `calc(${r} * var(--off))`, zIndex: r + 1 }}>
            {row.cards.map((c) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={c.id} src={cardSrc(c)} alt="" draggable={false} />
            ))}
          </div>
        ))}
      </div>
      <div className="th-hand-strip" style={{ top: g.hand }} data-th-hand>
        {ROW_SIZES.map((n, r) => (
          <span key={r} className="th-hand-grp" style={played[r] ? { width: `calc(var(--bw) + ${n - 1} * var(--bx))`, height: "var(--bh)" } : undefined}>
            {!played[r] && Array.from({ length: n }, (_, k) => ( // 出掉的那組空出來，其他組不移動
              // eslint-disable-next-line @next/next/no-img-element
              <img key={k} src={CARD_BACK_SRC} alt="" draggable={false} />
            ))}
          </span>
        ))}
      </div>
    </div>
  );
}

/** 中央看板（小宜 v10～v12）：這一墩四家的牌型（牌落定才跳出；大牌播完大字顯示紅金）和加分（四家出完才一起出現，留到下一墩第一家落定）。
 *  材質照麻將中央資訊盤；在牌的下層（DOM 順序在前）、大字特效的下層 */
function Board({ rv, frame, mySeat, deltas }: { rv: ThReveal; frame: RevealFrame; mySeat: number; deltas: Record<(typeof ROWS)[number], number[]> }) {
  const b = frame.board;
  const cells = [0, 1, 2, 3].map((seat) => {
    const pos = POS_BY_OFFSET[(seat - mySeat + 4) % 4], cell = CELL[pos], p = b.pats[seat];
    const name = p ? badgeOf(b.row, rv.result.values[seat][b.row]) : null;
    const d = deltas[b.row][seat];
    return (
      <div key={seat} className={`th-board-e is-${cell}`} data-th-board-cell={pos}>
        {name && p ? (
          <span key={`${b.row}-${p.at}`} className={`th-board-pt${p.big ? " is-bonus" : " is-pop"}${(cell === "l" || cell === "r") && name.label.length >= 4 ? " is-long" : ""}`}
            data-th-board-pt={name.label}>{name.label}</span>
        ) : <span className="th-board-pt is-none">—</span>}
        {b.scoreAt !== null && (
          <span key={`${b.row}-sc`} className={`th-board-sc ${d > 0 ? "is-up" : d < 0 ? "is-down" : "is-zero"}`} data-th-board-sc={d}>{d > 0 ? `+${d}` : d < 0 ? `−${-d}` : "0"}</span>
        )}
      </div>
    );
  });
  return (
    <div className={`th-board${b.show ? "" : " is-hide"}`} data-th-board={b.row} aria-hidden={!b.show}>
      {cells}
      <span className="th-board-hub">{ROW_NAME[b.row]}</span>
    </div>
  );
}

const fmt = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

export default function ThTable({ view, now, clockSkew, reveal, menu = true }: {
  view: ThGameView; now: number; clockSkew: number;
  /** 左上角設定（換牌桌）；特效測試頁有自己的按鈕就不放 */
  menu?: boolean;
  /** 亮牌中：伺服器的亮牌內容＋時間軸現在這一刻（沒有＝理牌中的牌桌） */
  reveal?: { rv: ThReveal; frame: RevealFrame } | null;
}) {
  const mySeat = view.me?.seat ?? 0;
  const revealed = !!reveal || view.phase === "revealed" || view.status === "finished";
  const left = view.arrangeDeadline !== null ? view.arrangeDeadline - (now + clockSkew) : 0;
  const deltas = reveal ? rowDeltas(reveal.rv.result) : null;
  useEffect(() => { void preloadRevealFx(); }, []); // 等其他人送出的時候先載特效圖
  useStageScale();

  function rowsFor(seat: number): RowView[] {
    if (!reveal) return ROWS.map(() => ({ cards: null }));
    const { rv, frame } = reveal;
    const a = rv.arrangements[seat];
    return ROWS.map((row) => {
      const open = frame.open[seat][row];
      return {
        cards: open ? rowDisplayOrder(a[row]) : null, // 翻開時照牌型排好（A A A Q Q）
        glow: frame.glow.some((x) => x.seat === seat && x.row === row),
      };
    });
  }
  const playedOf = (seat: number) => ROWS.map((row) => !!reveal?.frame.open[seat][row]);

  return (
    <div className="th-bg">{/* 桌布鋪滿畫面；牌桌 844×390 整塊等比放大置中（v8-A §1） */}
    <div className="th-table" data-testid="th-table">
      {reveal && <Board rv={reveal.rv} frame={reveal.frame} mySeat={mySeat} deltas={deltas!} />}
      {view.players.map((p) => {
        const pos = POS_BY_OFFSET[(p.seat - mySeat + 4) % 4];
        const isMe = pos === "bottom";
        const shot = reveal?.frame.shot[p.seat] ?? 0;
        const score = view.playerScores?.[p.seat] ?? 0;
        return (
          <div key={p.id} className={`th-seatbox th-at-${pos}`} data-seat={p.seat} data-th-pos={pos}>
            <Seat rows={rowsFor(p.seat)} pos={pos} played={playedOf(p.seat)} holes={shot} />
            {/* 共用名牌（小宜〈共用名牌-設計說明〉）：四家同一個 88×32，頭像＋名字＋這一場的累計分數；
                思考中泡泡貼在朝牌桌中心那一邊、彈孔掛右下角（§5 錨點），都不改變名牌大小 */}
            <GamePlate seat={PLATE_SEAT[pos]} name={p.name} score={score} me={isMe} plateId={p.seat} className={`th-gp th-gp-${pos}`}
              thinking={!p.submitted && !revealed} shot={shot} />
          </div>
        );
      })}
      {/* 被打槍的人自己：第一人稱大彈孔（每一槍一個，停一下淡到 35%，留到結算） */}
      {BIG_HOLE_AT.slice(0, reveal?.frame.shot[mySeat] ?? 0).map(([x, y], i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={`bh${i}`} className="th-hole-big" data-th-hole-big={i} src={HOLE_BIG_SRC} alt="" draggable={false} style={{ left: x, top: y, "--hr": `${HOLE_ROT[i]}deg` } as React.CSSProperties} />
      ))}
      {menu && <ThFeltMenu />}
      <div className="th-hands" aria-label={`第 ${view.handNo} 局，共 ${view.settings.totalHands} 局`}>{view.handNo}/{view.settings.totalHands}</div>
      {!revealed && (
        <div className="th-center" role="timer">
          <div className={`th-clock${left <= 10_000 ? " is-low" : ""}`}>{fmt(left)}</div>
        </div>
      )}
    </div>
    </div>
  );
}
