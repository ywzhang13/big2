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
import { CARD_BACK_SRC, cardSrc, isGold } from "./cardArt";
import { badgeOf, plateScore, ROW_NAME, ROWS, rowDisplayOrder, type RevealFrame, type ThReveal } from "./revealTimeline";
import type { ThGameView } from "./useThirteenRoom";
import { preloadRevealFx } from "./ThRevealFx";
import ThFeltMenu from "./ThFeltMenu";
import GamePlate, { type PlateSeat } from "../GamePlate";
import { useStageScale } from "./stageScale";
import { BACK_SLIDE_MS, FAN_FLY_MS, FAN_STAGGER_MS, ROW_SIZES, SEAT_GEO, backGroupX, backY, cardPose, type Pos } from "./fanLayout";

export type { Pos } from "./fanLayout";
export const POS_BY_OFFSET: Pos[] = ["bottom", "right", "top", "left"];

type RowView = { cards: Card[] | null; glow?: boolean };

/** 共用名牌的座位代號（決定思考中泡泡朝哪邊） */
const PLATE_SEAT: Record<Pos, PlateSeat> = { bottom: "b", top: "t", left: "l", right: "r" };
/** 中央看板裡四家的格子（v12 §4）：對家上、左家左、右家右、自己下；字都是正的 */
const CELL: Record<Pos, "t" | "l" | "r" | "b"> = { top: "t", left: "l", right: "r", bottom: "b" };

/** 一家：靠自己那側的牌背區（13 張牌背 3／5／5）＋靠中央的出牌區（頭墩最靠中央、中墩疊上去往自己那側錯開、尾墩再疊；最新的在最上層）。整組轉向自己的座位 */
/** 被打槍的彈孔位置（中墩中心為原點），三個彼此隔 30 以上 */
const HOLE_AT = [[-42, -18], [34, 6], [-6, 38]];
/** 第一人稱大彈孔（被打的人自己的畫面；基準版面座標，小宜 v8-B §7）。老闆 2026-11-18：三槍要在同一畫面——
 *  大彈孔 220 見方，三個橫排在畫面中段（左、中、右，彼此只疊一點），轉了角度外框也還在 844×390 裡（見 thReveal.css .th-hole-big） */
const BIG_HOLE_AT = [[215, 185], [629, 205], [422, 190]];
/** 彈孔：老闆 2026-11-18 新圖（去洋紅底、四邊羽化，沒有矩形外框）；三個孔各轉一個角度看起來不一樣 */
const HOLE_SRC = "/tiles/thirteen/fx/th-fx-hole.v2.m.webp", HOLE_BIG_SRC = "/tiles/thirteen/fx/th-fx-hole.v2.d.webp";
const HOLE_ROT = [0, 130, 250];

function Seat({ rows, pos, played, holes, lucky }: { rows: RowView[]; pos: Pos; played: boolean[]; holes: number; /** 彩金牌點數：一樣的牌畫金卡 */ lucky: number | null }) {
  // 彈孔角度用 --hr 放進 transform（直接用 rotate 屬性會繞著還沒置中的框轉，彈孔被甩出原位；老闆 2026-11-18 截圖三槍跑出畫面）
  // 扇形（小宜 v13）：每張牌各自算中心和角度（fanLayout.cardPose），座位座標原點＝頭墩中間那張牌，整組轉到那一家的方向。
  // 牌背（v14.2）：還沒出的組永遠在牌背區正中間；出牌時剩下的組 0.2 秒滑過去（CSS transition，重新整理時直接畫在最後位置）。
  // 出牌飛行（v13 §5）：每張從那一墩出牌前牌背的中心、直的、0.65 倍、透明度 20% 飛到扇形位置，0.29 秒、依序晚 0.015 秒。
  // 起點的 y 給 --dy0（沒內縮的牌背位置）；左右家牌背避開瀏海往內縮時，thRoom.css 再減掉同樣的量（--dy），起點才會和看得到的牌背對齊
  const g = SEAT_GEO[pos];
  const gone = played.filter(Boolean).length;
  const bx = backGroupX(g, gone), by = backY(g);
  const vars = { "--cw": `${g.w}px`, "--ch": `${g.h}px`, "--bw": `${g.bw}px`, "--bh": `${g.bh}px`, "--bx": `${g.bx}px`,
    "--fly": `${FAN_FLY_MS}ms`, "--slide": `${BACK_SLIDE_MS}ms` } as React.CSSProperties;
  return (
    <div className="th-seat2" style={{ left: g.o[0], top: g.o[1], transform: `rotate(${g.rot}deg)`, ...vars }}>
      <div className="th-blk" data-th-play>
        <span className="th-blk-mid" data-th-mid style={{ top: g.off }} />{/* 中墩中間那張牌的中心：大字、打槍的落點 */}
        {HOLE_AT.slice(0, holes).map(([x, y], i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={`h${i}`} className="th-hole" data-th-hole={i} src={HOLE_SRC} alt="" draggable={false} style={{ left: x, top: g.off + y, "--hr": `${HOLE_ROT[i]}deg` } as React.CSSProperties} />
        ))}
        {rows.map((row, r) => {
          if (!row.cards) return null;
          const fromX = backGroupX(g, r)[r]!; // 這一墩出牌前牌背的中心
          return (
            <div key={r} className={`th-blk-row${row.glow ? " is-glow" : ""}`} data-th-row={ROWS[r]} style={{ zIndex: r + 1 }}>
              {row.cards.map((c, i, all) => {
                const p = cardPose(g, r, i, all.length);
                return (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={c.id} className={`th-fan-card${isGold(c, lucky) ? " is-gold" : ""}`} src={cardSrc(c, lucky)} alt="" draggable={false} data-th-card={`${r}-${i}`}
                    style={{ left: p.x, top: p.y, "--a": `${p.deg}deg`, "--dx": `${fromX - p.x}px`, "--dy0": `${by - p.y}px`, "--d": `${i * FAN_STAGGER_MS}ms` } as React.CSSProperties} />
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="th-hand-strip" style={{ top: by }} data-th-hand>
        {ROW_SIZES.map((n, r) => played[r] ? null : (
          <span key={r} className="th-hand-grp" data-th-back={r} style={{ transform: `translate(${bx[r]}px, 0) translate(-50%, -50%)` }}>
            {Array.from({ length: n }, (_, k) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={k} src={CARD_BACK_SRC} alt="" draggable={false} />
            ))}
          </span>
        ))}
      </div>
    </div>
  );
}

/** 中央看板（小宜 v15 §3，取代 v12 的排法）：四邊是四家這一墩的牌型（牌落定才跳出；大牌播完大字顯示紅金），左右家直排；
 *  正中間放這一局的彩金牌（旁邊不寫字）。不顯示每墩的加分（v4 不算每墩輸贏，加分在本局結算看）。舊房沒有彩金牌：中間照舊寫墩名。
 *  材質照麻將中央資訊盤；在牌的下層（DOM 順序在前）、大字特效的下層 */
function Board({ rv, frame, mySeat }: { rv: ThReveal; frame: RevealFrame; mySeat: number }) {
  const b = frame.board;
  const cells = [0, 1, 2, 3].map((seat) => {
    const pos = POS_BY_OFFSET[(seat - mySeat + 4) % 4], cell = CELL[pos], p = b.pats[seat];
    const name = p ? badgeOf(b.row, rv.result.values[seat][b.row]) : null;
    return (
      <div key={seat} className={`th-board-e is-${cell}`} data-th-board-cell={pos}>
        {name && p ? (
          <span key={`${b.row}-${p.at}`} className={`th-board-pt${p.big ? " is-bonus" : " is-pop"}`} data-th-board-pt={name.label}>{name.label}</span>
        ) : <span className="th-board-pt is-none">—</span>}
      </div>
    );
  });
  const lucky = rv.luckyCard ?? null;
  return (
    <div className={`th-board${b.show ? "" : " is-hide"}`} data-th-board={b.row} aria-hidden={!b.show}>
      {cells}
      {lucky ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="th-board-lucky" data-th-board-lucky={lucky.id} src={cardSrc(lucky, lucky.rank)} alt="" draggable={false} />
      ) : <span className="th-board-hub">{ROW_NAME[b.row]}</span>}
    </div>
  );
}

const fmt = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

export default function ThTable({ view, now, clockSkew, reveal, menu = true }: {
  view: ThGameView; now: number; clockSkew: number;
  /** 左上角設定（換牌桌）；特效測試頁有自己的按鈕就不放 */
  menu?: boolean;
  /** 亮牌中：伺服器的亮牌內容＋時間軸現在這一刻（沒有＝理牌中的牌桌） */
  reveal?: { rv: ThReveal; frame: RevealFrame; /** 本局結算出現了（名牌才換成新的累計） */ settled?: boolean } | null;
}) {
  const mySeat = view.me?.seat ?? 0;
  const revealed = !!reveal || view.phase === "revealed" || view.status === "finished";
  const left = view.arrangeDeadline !== null ? view.arrangeDeadline - (now + clockSkew) : 0;
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
      {reveal && <Board rv={reveal.rv} frame={reveal.frame} mySeat={mySeat} />}
      {view.players.map((p) => {
        const pos = POS_BY_OFFSET[(p.seat - mySeat + 4) % 4];
        const isMe = pos === "bottom";
        const shot = reveal?.frame.shot[p.seat] ?? 0;
        const score = reveal ? plateScore(reveal.rv, p.seat, !!reveal.settled) : view.playerScores?.[p.seat] ?? 0; // 亮牌途中維持上一局的累計
        return (
          <div key={p.id} className={`th-seatbox th-at-${pos}`} data-seat={p.seat} data-th-pos={pos}>
            <Seat rows={rowsFor(p.seat)} pos={pos} played={playedOf(p.seat)} holes={shot} lucky={reveal?.rv.luckyCard?.rank ?? null} />
            {/* 共用名牌（小宜〈共用名牌-設計說明〉）：四家同一個 88×38，頭像＋名字＋這一場的累計分數；
                思考中泡泡貼在朝牌桌中心那一邊、彈孔掛右下角（§5 錨點），都不改變名牌大小 */}
            <GamePlate seat={PLATE_SEAT[pos]} name={p.name} score={score} me={isMe} plateId={p.seat} avatarUrl={p.avatarUrl ?? null} className={`th-gp th-gp-${pos}`}
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
