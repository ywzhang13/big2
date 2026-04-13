"use client";

import type { Tile } from "@/lib/mahjong/tiles";
import type { Meld, ScoreResult } from "@/lib/mahjong/gameState";
import MjTile from "./MjTile";

interface MjGameOverProps {
  winner: {
    seat: number;
    name: string;
    score: ScoreResult;
    allHands?: {
      seat: number;
      name: string;
      hand: Tile[];
      revealed: Meld[];
      flowers: Tile[];
    }[];
  };
  onGoHome: () => void;
  onPlayAgain?: () => void;
}

export default function MjGameOver({ winner, onGoHome, onPlayAgain }: MjGameOverProps) {
  const isDraw = winner.seat < 0;
  const winnerHand = winner.allHands?.find((h) => h.seat === winner.seat);

  return (
    <div className="flex flex-col flex-1 min-h-dvh items-center justify-center px-4 py-6"
      style={{
        background: "radial-gradient(ellipse at center top, #2a1f0e 0%, #1a1408 40%, #0f0e08 100%)",
      }}>
      <div className="w-full max-w-md flex flex-col items-center gap-5">

        {/* Header */}
        {isDraw ? (
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-white/5 flex items-center justify-center">
              <span className="text-3xl">&#128524;</span>
            </div>
            <h2 className="text-2xl font-bold text-white/70 font-heading">流局</h2>
            <p className="text-white/40 text-sm mt-1">牌牆摸完，無人胡牌</p>
          </div>
        ) : (
          <div className="text-center">
            <div className="w-20 h-20 mx-auto mb-3 rounded-full flex items-center justify-center"
              style={{
                background: "radial-gradient(circle, #C9A96E 0%, #8B6914 100%)",
                boxShadow: "0 0 30px rgba(201,169,110,0.4), 0 0 60px rgba(201,169,110,0.15)",
              }}>
              <span className="text-4xl">&#127936;</span>
            </div>
            <h2 className="text-2xl font-bold font-heading"
              style={{ color: "#f0d68a", textShadow: "0 0 20px rgba(240,214,138,0.3)" }}>
              {winner.name} 胡牌！
            </h2>
            <div className="mt-2 inline-flex items-baseline gap-1">
              <span className="text-white/50 text-sm">共</span>
              <span className="text-3xl font-bold" style={{ color: "#C9A96E" }}>
                {winner.score.totalFan}
              </span>
              <span className="text-white/50 text-sm">台</span>
            </div>
          </div>
        )}

        {/* Winning hand display */}
        {winnerHand && (
          <div className="w-full">
            <p className="text-white/40 text-xs mb-2 text-center font-bold tracking-wider">胡牌牌型</p>
            <div className="rounded-2xl p-4 border"
              style={{
                background: "linear-gradient(145deg, rgba(201,169,110,0.08) 0%, rgba(0,0,0,0.3) 100%)",
                borderColor: "rgba(201,169,110,0.2)",
              }}>
              {/* Concealed tiles */}
              <div className="flex flex-wrap justify-center gap-[3px] mb-2">
                {winnerHand.hand.map((t) => (
                  <MjTile key={t.id} tile={t} small />
                ))}
              </div>
              {/* Revealed melds */}
              {winnerHand.revealed.length > 0 && (
                <div className="flex flex-wrap justify-center gap-3 pt-2 border-t border-white/10">
                  {winnerHand.revealed.map((meld, mi) => (
                    <div key={mi} className="flex gap-[1px]">
                      {meld.tiles.map((t) => (
                        <MjTile key={t.id} tile={t} small faceDown={meld.type === "concealed_kong"} />
                      ))}
                    </div>
                  ))}
                </div>
              )}
              {/* Flowers */}
              {winnerHand.flowers.length > 0 && (
                <div className="flex justify-center gap-[2px] pt-2 border-t border-white/10 mt-2">
                  {winnerHand.flowers.map((f) => (
                    <MjTile key={f.id} tile={f} small />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Fan breakdown */}
        {!isDraw && winner.score.fans.length > 0 && (
          <div className="w-full">
            <p className="text-white/40 text-xs mb-2 text-center font-bold tracking-wider">台數明細</p>
            <div className="rounded-2xl border overflow-hidden"
              style={{
                background: "linear-gradient(145deg, rgba(201,169,110,0.05) 0%, rgba(0,0,0,0.3) 100%)",
                borderColor: "rgba(201,169,110,0.15)",
              }}>
              {winner.score.fans.map((fan, i) => (
                <div
                  key={i}
                  className={`flex items-center justify-between px-4 py-3
                    ${i !== winner.score.fans.length - 1 ? "border-b border-white/5" : ""}`}
                >
                  <span className="text-white/80 text-sm">{fan.name}</span>
                  <span className="font-bold text-sm" style={{ color: "#C9A96E" }}>{fan.value} 台</span>
                </div>
              ))}
              {/* Total row */}
              <div className="flex items-center justify-between px-4 py-3"
                style={{
                  background: "linear-gradient(90deg, rgba(201,169,110,0.15) 0%, rgba(201,169,110,0.05) 100%)",
                  borderTop: "1px solid rgba(201,169,110,0.2)",
                }}>
                <span className="font-bold" style={{ color: "#f0d68a" }}>合計</span>
                <span className="font-bold text-xl" style={{ color: "#f0d68a" }}>{winner.score.totalFan} 台</span>
              </div>
            </div>
          </div>
        )}

        {/* All players' hands */}
        {winner.allHands && winner.allHands.length > 0 && (
          <div className="w-full">
            <p className="text-white/40 text-xs mb-2 text-center font-bold tracking-wider">各家手牌</p>
            <div className="flex flex-col gap-2">
              {winner.allHands
                .filter((h) => h.seat !== winner.seat)
                .map((h) => (
                  <div key={h.seat} className="rounded-xl p-2.5 border border-white/5"
                    style={{ background: "rgba(0,0,0,0.2)" }}>
                    <p className="text-[10px] text-white/40 mb-1 font-bold">{h.name}</p>
                    <div className="flex flex-wrap gap-[2px]">
                      {h.hand.map((t) => (
                        <MjTile key={t.id} tile={t} small />
                      ))}
                      {h.revealed.map((meld, mi) =>
                        meld.tiles.map((t) => (
                          <MjTile key={`r-${mi}-${t.id}`} tile={t} small />
                        ))
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="w-full flex gap-3 mt-2">
          {onPlayAgain && (
            <button
              onClick={onPlayAgain}
              className="flex-1 py-4 rounded-2xl font-bold text-base
                cursor-pointer active:scale-95 transition-all duration-150 shadow-lg"
              style={{
                background: "linear-gradient(135deg, #C9A96E 0%, #e8c97a 100%)",
                color: "#0f2a1a",
                boxShadow: "0 4px 20px rgba(201,169,110,0.3)",
              }}
            >
              再來一局
            </button>
          )}
          <button
            onClick={onGoHome}
            className={`${onPlayAgain ? "flex-1" : "w-full"} py-4 rounded-2xl font-bold text-base
              border border-white/15 text-white/70
              cursor-pointer active:scale-95 transition-all duration-150`}
            style={{ background: "rgba(255,255,255,0.05)" }}
          >
            回大廳
          </button>
        </div>
      </div>
    </div>
  );
}
