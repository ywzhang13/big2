"use client";

// 手機橫向的結算浮層（一般胡牌、流局、八仙過海、七搶一）。左欄：胡法＋台數明細；
// 右欄：四家輸贏＋下一局。390 高內不捲動就看得到全部，金額一律用後端的 settlement。

import type { Tile } from "@/lib/mahjong/tiles";
import { sortTiles } from "@/lib/mahjong/tiles";
import type { Meld, ScoreResult, Settlement } from "@/lib/mahjong/gameState";
import type { MjPlayer } from "@/hooks/useMahjong";
import MjTile from "./MjTile";

const FLOWER_WIN_NAMES = ["八仙過海", "七搶一"];

interface MjResultMobileProps {
  winner: {
    seat: number;
    name: string;
    score: ScoreResult;
    allHands?: { seat: number; name: string; hand: Tile[]; revealed: Meld[]; flowers: Tile[] }[];
  };
  winners?: { seat: number; name: string; score: ScoreResult }[];
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
  onNextGame: () => void;
  onLeave: () => void;
}

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
}: MjResultMobileProps) {
  const isDraw = winner.seat < 0;
  const flowerName = winner.score.fans.find((f) => FLOWER_WIN_NAMES.includes(f.name))?.name;
  const allWinners = winners && winners.length > 0 ? winners : isDraw ? [] : [winner];
  const multi = allWinners.length > 1;
  const winnerSeats = new Set(allWinners.map((w) => w.seat));
  const hands = winner.allHands ?? [];
  const winnerFlowers = hands.find((h) => h.seat === winner.seat)?.flowers ?? [];

  const title = isDraw ? "流局" : flowerName ?? (isZimo ? "自摸" : "胡");
  const iAmReady = nextGameReady?.includes(myId) ?? false;

  return (
    <div className="mjm-result">
      {/* 左欄：胡法、誰胡、台數明細 */}
      <div className="lcol">
        <span className={`hu ${isDraw ? "draw" : ""}`}>{title}</span>
        {!isDraw && (
          <span className="who">{allWinners.map((w) => w.name).join("、")} 胡牌</span>
        )}
        {!isDraw && !flowerName && !isZimo && fromName && <span className="from">{fromName} 放槍</span>}
        {flowerName && (
          <div className="flowrow">
            {sortTiles(winnerFlowers).map((f) => (
              <MjTile key={f.id} tile={f} width={20} height={27} />
            ))}
          </div>
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

      {/* 右欄：四家輸贏 */}
      <div className="rcol">
        {[...players]
          .sort((a, b) => a.seat - b.seat)
          .map((p) => {
            const delta = settlement?.deltas[p.seat] ?? 0;
            const isWin = winnerSeats.has(p.seat);
            const w = allWinners.find((x) => x.seat === p.seat);
            const h = hands.find((x) => x.seat === p.seat);
            return (
              <div key={p.seat} className={`seat ${isWin ? "win" : ""}`} style={isWin ? { flexWrap: "wrap" } : undefined}>
                <span className="who2">
                  {p.name}
                  {p.seat === mySeat && "（你）"}
                </span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: "#f0d68a", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {isWin && w && (multi ? `胡 ${w.score.totalFan} 台：${w.score.fans.map((f) => f.name).join("、")}` : "胡")}
                </span>
                {settlement && (
                  <span className="delta" style={{ color: deltaColor(delta) }}>{signed(delta)}</span>
                )}
                {playerScores && <span className="tot">總{signed(playerScores[p.seat])}</span>}
                {/* 胡牌那家的手牌（花胡不顯示手牌） */}
                {isWin && !flowerName && h && (
                  <div className="tiles" style={{ flexBasis: "100%" }}>
                    {sortTiles(h.hand).map((t) => (
                      <MjTile key={t.id} tile={t} width={16} height={22} />
                    ))}
                    {h.revealed.map((m, mi) => (
                      <span key={mi} style={{ display: "contents" }}>
                        <span className="gap" />
                        {m.tiles.map((t) => (
                          <MjTile key={t.id} tile={t} width={16} height={22} />
                        ))}
                      </span>
                    ))}
                    {h.flowers.length > 0 && <span className="gap" />}
                    {sortTiles(h.flowers).map((f) => (
                      <MjTile key={f.id} tile={f} width={16} height={22} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

        <div className="foot">
          {hasRounds && !gameOver && (
            <div className="ready">
              {players.map((p) => (
                <span key={p.seat} className={nextGameReady?.includes(p.id) ? "ok" : ""}>
                  {nextGameReady?.includes(p.id) ? "✓ " : ""}
                  {p.name}
                </span>
              ))}
            </div>
          )}
          {hasRounds && !gameOver && (
            <button type="button" className="mjm-btn" disabled={iAmReady} onClick={onNextGame}>
              {iAmReady ? "已同意" : "下一局"}
            </button>
          )}
          <button
            type="button"
            className={`mjm-btn ${gameOver || !hasRounds ? "" : "ghost"}`}
            style={gameOver || !hasRounds ? { marginLeft: "auto" } : undefined}
            onClick={onLeave}
          >
            {gameOver ? "回大廳" : "離開"}
          </button>
        </div>
      </div>
    </div>
  );
}
