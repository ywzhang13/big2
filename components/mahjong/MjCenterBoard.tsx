"use client";
// 麻將中央看板（小宜〈麻將換共用元件 v1〉§3，2026-11-21）：手機、桌機同一個元件（桌機 --cb-s 1.5 倍）。
//   中間：剩餘張數、圈局、骰子；四邊 16×16 的格子放風位（字上下左右都置中，老闆 11/18）。
//   方向：下＝自己、右＝下家、上＝對家、左＝上家；風字照開門那家是東依序排（seatWindChar）。
//   開門那家：格子外一圈紅框（不寫「門」字）；輪到誰：金字、光暈、放大 1.15。
import { Die } from "./MjBoardMobile";
import { seatWindChar } from "./seatWind";

const SIDES = [["b", 0], ["r", 1], ["t", 2], ["l", 3]] as const;

export default function MjCenterBoard({ wallRemaining, roundLabel, dice, mySeat, doorSeat, dealerSeat, currentTurn, className }: {
  wallRemaining: number;
  roundLabel?: string;
  dice?: [number, number, number];
  mySeat: number;
  doorSeat?: number;
  dealerSeat: number;
  currentTurn: number;
  className?: string;
}) {
  const base = mySeat < 0 ? 0 : mySeat;
  return (
    <div className={`mj-cb${className ? ` ${className}` : ""}`} data-center-board>
      {SIDES.map(([pos, off]) => {
        const seat = (base + off) % 4;
        const door = doorSeat != null && seat === doorSeat, turn = seat === currentTurn;
        return (
          <span key={pos} className={`w ${pos}${door ? " door" : ""}${turn ? " turn" : ""}`} data-cb-wind={pos} data-cb-seat={seat}
            data-cb-door={door ? "" : undefined} data-cb-turn={turn ? "" : undefined}>
            {seatWindChar(seat, doorSeat, dealerSeat)}
          </span>
        );
      })}
      <span className="big" data-cb-wall="">{wallRemaining}</span>
      {roundLabel && <span className="rnd">{roundLabel}</span>}
      {dice && (
        <span className="dice" data-center-dice>
          <Die value={dice[0]} size={10} />
          <Die value={dice[1]} size={10} />
          <Die value={dice[2]} size={10} />
        </span>
      )}
    </div>
  );
}
