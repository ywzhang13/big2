"use client";

// 結算浮層（一般胡牌、流局、八仙過海、七搶一）。左欄：胡法＋台數明細；
// 右欄：四家攤牌＋輸贏＋下一局（整場打完時改成總積分榜）。金額一律用後端的 settlement。
// 桌機和手機橫向同一個樣式（老闆選定手機版），desktop 只是放大字和牌。

import { useState } from "react";
import type { Settlement } from "@/lib/mahjong/gameState";
import type { MjPlayer, MjWinner, MjHandReveal } from "@/hooks/useMahjong";
import { RevealTiles, WaitsList } from "./MjReveal";
import { Die } from "./MjBoardMobile";

const FLOWER_WIN_NAMES = ["八仙過海", "七搶一"];

interface MjResultMobileProps {
  winner: MjWinner & { allHands?: MjHandReveal[] };
  winners?: MjWinner[];
  players: MjPlayer[];
  mySeat: number;
  myId: string;
  fromName?: string; // 放槍者（一般胡牌、非自摸）
  isZimo: boolean;
  settlement?: Settlement;
  playerScores?: number[];
  hasRounds: boolean;
  gameOver?: boolean;
  nextGameReady?: string[];
  /** 回傳被拒絕時要顯示的訊息（成功或已由登入流程處理時是 null） */
  onNextGame: () => Promise<string | null>;
  onLeave: () => void;
  desktop?: boolean;
  tingSeats?: number[];
  eyeSeats?: number[];
  /** 這局開局的三顆骰子；doorSeat＝開門那家（門風東），dealerSeat＝莊家 */
  dice?: [number, number, number];
  doorSeat?: number;
  dealerSeat?: number;
}

const RANK_LABELS = ["冠", "亞", "季", "殿"];

const WINDS = ["東", "南", "西", "北"];

function signed(n: number) {
  return `${n > 0 ? "+" : ""}${n}`;
}

function deltaColor(n: number) {
  return n > 0 ? "#4ade80" : n < 0 ? "#f87171" : "rgba(255,255,255,.4)";
}

export default function MjResultMobile({
  winner,
  winners,
  players,
  mySeat,
  myId,
  fromName,
  isZimo,
  settlement,
  playerScores,
  hasRounds,
  gameOver,
  nextGameReady,
  onNextGame,
  onLeave,
  desktop = false,
  tingSeats = [],
  eyeSeats = [],
  dice,
  doorSeat,
  dealerSeat,
}: MjResultMobileProps) {
  const isDraw = winner.seat < 0;
  const flowerName = winner.score.fans.find((f) => FLOWER_WIN_NAMES.includes(f.name))?.name;
  const allWinners = winners && winners.length > 0 ? winners : isDraw ? [] : [winner];
  const multi = allWinners.length > 1;
  const hands = winner.allHands ?? [];

  const nameOf = (seat: number) => players.find((p) => p.seat === seat)?.name ?? "";
  const title = isDraw ? "流局" : flowerName ?? (isZimo ? "自摸" : "胡");
  const iAmReady = nextGameReady?.includes(myId) ?? false;
  // 按下一局：送出中先鎖住按鈕；被拒絕時在按鈕旁顯示原因（之前錯誤被吞掉，看起來像按了沒反應）
  const [sending, setSending] = useState(false);
  const [nextErr, setNextErr] = useState<string | null>(null);
  const pressNext = async () => {
    setSending(true);
    setNextErr(null);
    try {
      setNextErr(await onNextGame());
    } finally {
      setSending(false);
    }
  };
  const readyCount = players.filter((p) => nextGameReady?.includes(p.id)).length;
  const waiting = players.filter((p) => !nextGameReady?.includes(p.id)).map((p) => (p.id === myId ? "你" : p.name));
  // 門風：開門那家（doorSeat）是東，seat+1 依序南西北（和計分的自風、正花同一套，見 gameLogic 的 seatWind）
  const windOf = (seat: number) => (doorSeat == null ? null : WINDS[(seat - doorSeat + 4) % 4]);
  const tile = desktop ? { w: 26, ht: 35, ww: 18, wh: 24 } : { w: 14, ht: 19, ww: 12, wh: 16 };
  // 整場打完：總積分榜（高分在前）
  const ranking = gameOver && playerScores ? [...players].sort((a, b) => playerScores[b.seat] - playerScores[a.seat]) : null;

  return (
    <div className={`mjm-result${desktop ? " desk" : ""}`}>
      {/* 左欄：胡法、誰胡、台數明細 */}
      <div className="lcol">
        <span className={`hu ${isDraw ? "draw" : ""}`}>{title}</span>
        {!isDraw && (
          <span className="who">
            {allWinners.map((w, i) => (
              <span key={w.seat}>
                {i > 0 && "、"}
                {w.name}
                {/* 名字後面接藥丸：地聽＋眼牌＝MIGI；只有眼牌＝眼；只有地聽（舊牌局）＝聽 */}
                {tingSeats.includes(w.seat) && eyeSeats.includes(w.seat) ? (
                  <span className="mjm-tag migi" style={{ marginLeft: 4, verticalAlign: "middle" }}>MIGI</span>
                ) : eyeSeats.includes(w.seat) ? (
                  <span className="mjm-tag eye" style={{ marginLeft: 4, verticalAlign: "middle" }}>眼</span>
                ) : tingSeats.includes(w.seat) ? (
                  <span className="mjm-tag ting" style={{ marginLeft: 4, verticalAlign: "middle" }}>聽</span>
                ) : null}
              </span>
            ))}{" "}
            胡牌
          </span>
        )}
        {!isDraw && !flowerName && !isZimo && fromName && <span className="from">{fromName} 放槍</span>}
        {dice && (
          <span className="dice">
            <Die value={dice[0]} size={desktop ? 20 : 14} />
            <Die value={dice[1]} size={desktop ? 20 : 14} />
            <Die value={dice[2]} size={desktop ? 20 : 14} />
            <span>骰 <b>{dice[0] + dice[1] + dice[2]}</b></span>
          </span>
        )}
        {!isDraw && !multi && (
          <div className="fans">
            {winner.score.fans.map((f, i) => (
              <span key={i} style={{ display: "contents" }}>
                <span className="n">{f.name}</span>
                <span className="v">{f.value} 台</span>
              </span>
            ))}
            <span className="n tot">共</span>
            <span className="v tot">{winner.score.totalFan} 台</span>
          </div>
        )}
      </div>

      {/* 右欄：四家攤牌＋輸贏 */}
      <div className="rcol">
        {[...players]
          .sort((a, b) => a.seat - b.seat)
          .map((p) => {
            const delta = settlement?.deltas[p.seat] ?? 0;
            const w = allWinners.find((x) => x.seat === p.seat);
            const h = hands.find((x) => x.seat === p.seat);
            return (
              <div key={p.seat} className={`seat ${w ? "win" : ""}`} style={{ flexWrap: "wrap", rowGap: 2 }}>
                <span className="who2">
                  {windOf(p.seat) && <i className={`wind${p.seat === dealerSeat ? " dealer" : ""}`} title={p.seat === dealerSeat ? "莊家" : undefined}>{windOf(p.seat)}</i>}
                  {p.name}
                  {p.seat === mySeat && "（你）"}
                </span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: "#f0d68a", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {w && (multi ? `胡 ${w.score.totalFan} 台：${w.score.fans.map((f) => f.name).join("、")}` : "胡")}
                </span>
                <WaitsList waits={w?.waits} w={tile.ww} ht={tile.wh} />
                {settlement && (
                  <span className="delta" style={{ color: deltaColor(delta) }}>{signed(delta)}</span>
                )}
                {playerScores && <span className="tot">總{signed(playerScores[p.seat])}</span>}
                {h && (
                  <div style={{ flexBasis: "100%", minWidth: 0 }}>
                    <RevealTiles h={h} winner={w} nameOf={nameOf} w={tile.w} ht={tile.ht} />
                  </div>
                )}
              </div>
            );
          })}

        {/* 下一局的狀態列：被拒絕時顯示原因；有人按了、還沒到齊時列出還在等誰（四家都看得到） */}
        {hasRounds && !gameOver && (nextErr || (readyCount > 0 && waiting.length > 0)) && (
          <div className={`nextline${nextErr ? " err" : ""}`} role={nextErr ? "alert" : "status"}>
            {nextErr ?? `還在等 ${waiting.join("、")} 按下一局`}
          </div>
        )}
        <div className="foot">
          {hasRounds && !gameOver && (
            <div className="ready">
              <span className="cnt">同意 {readyCount}/4</span>
              {players.map((p) => {
                const ok = nextGameReady?.includes(p.id) ?? false;
                return (
                  <span key={p.seat} className={`chip ${ok ? "ok" : "wait"}`} title={ok ? "已同意" : "還沒按"}>
                    <i>{ok ? "✓" : "…"}</i>
                    {p.name}
                  </span>
                );
              })}
            </div>
          )}
          {ranking && (
            <div className="rank">
              <span className="cnt">總積分榜</span>
              {ranking.map((p, i) => (
                <span key={p.seat} className={`chip r${i}`}>
                  <i>{RANK_LABELS[i]}</i>
                  <span className="nm">{p.name}</span>
                  <b style={{ color: deltaColor(playerScores![p.seat]) }}>{signed(playerScores![p.seat])}</b>
                </span>
              ))}
            </div>
          )}
          {hasRounds && !gameOver && (
            <button type="button" className="mjm-btn" disabled={iAmReady || sending} onClick={pressNext}>
              {iAmReady ? "已同意" : sending ? "送出中…" : "下一局"}
            </button>
          )}
          <button
            type="button"
            className={`mjm-btn ${gameOver || !hasRounds ? "" : "ghost"}`}
            style={!gameOver && !hasRounds ? { marginLeft: "auto" } : undefined}
            onClick={onLeave}
          >
            {gameOver ? "回大廳" : "離開"}
          </button>
        </div>
      </div>
    </div>
  );
}
