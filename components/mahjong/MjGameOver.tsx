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
}

export default function MjGameOver({ winner, onGoHome }: MjGameOverProps) {
  const isDraw = winner.seat < 0;
  const winnerHand = winner.allHands?.find((h) => h.seat === winner.seat);

  return (
    <div className="flex flex-col flex-1 min-h-dvh bg-[#0f2a1a] items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm flex flex-col items-center gap-6">
        {/* Header */}
        {isDraw ? (
          <div className="text-center">
            <p className="text-4xl mb-2">-</p>
            <h2 className="text-2xl font-bold text-white/70 font-heading">流局</h2>
            <p className="text-white/40 text-sm mt-1">牌牆摸完，無人胡牌</p>
          </div>
        ) : (
          <div className="text-center">
            <p className="text-4xl mb-2">&#127936;</p>
            <h2 className="text-2xl font-bold text-[#f0d68a] font-heading">
              {winner.name} 胡牌！
            </h2>
            <p className="text-white/50 text-sm mt-1">
              共 <span className="text-[#C9A96E] font-bold text-lg">{winner.score.totalFan}</span> 台
            </p>
          </div>
        )}

        {/* Winning hand display */}
        {winnerHand && (
          <div className="w-full">
            <p className="text-white/40 text-xs mb-2 text-center">胡牌牌型</p>
            <div className="bg-black/30 rounded-2xl p-3 border border-white/10">
              {/* Concealed tiles */}
              <div className="flex flex-wrap justify-center gap-[3px] mb-2">
                {winnerHand.hand.map((t) => (
                  <MjTile key={t.id} tile={t} small />
                ))}
              </div>
              {/* Revealed melds */}
              {winnerHand.revealed.length > 0 && (
                <div className="flex flex-wrap justify-center gap-2 pt-2 border-t border-white/10">
                  {winnerHand.revealed.map((meld, mi) => (
                    <div key={mi} className="flex gap-[1px]">
                      {meld.tiles.map((t) => (
                        <MjTile key={t.id} tile={t} small />
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
            <p className="text-white/40 text-xs mb-2 text-center">台數明細</p>
            <div className="bg-black/30 rounded-2xl border border-white/10 overflow-hidden">
              {winner.score.fans.map((fan, i) => (
                <div
                  key={i}
                  className={`flex items-center justify-between px-4 py-2.5
                    ${i !== winner.score.fans.length - 1 ? "border-b border-white/5" : ""}`}
                >
                  <span className="text-white/80 text-sm">{fan.name}</span>
                  <span className="text-[#C9A96E] font-bold text-sm">{fan.value} 台</span>
                </div>
              ))}
              {/* Total */}
              <div className="flex items-center justify-between px-4 py-3 bg-[#C9A96E]/10 border-t border-[#C9A96E]/20">
                <span className="text-[#f0d68a] font-bold">合計</span>
                <span className="text-[#f0d68a] font-bold text-lg">{winner.score.totalFan} 台</span>
              </div>
            </div>
          </div>
        )}

        {/* All players' hands (if available) */}
        {winner.allHands && winner.allHands.length > 0 && (
          <div className="w-full">
            <p className="text-white/40 text-xs mb-2 text-center">各家手牌</p>
            <div className="flex flex-col gap-2">
              {winner.allHands
                .filter((h) => h.seat !== winner.seat)
                .map((h) => (
                  <div key={h.seat} className="bg-black/20 rounded-xl p-2 border border-white/5">
                    <p className="text-[10px] text-white/40 mb-1">{h.name}</p>
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

        {/* Back button */}
        <button
          onClick={onGoHome}
          className="w-full py-4 rounded-2xl bg-[#C9A96E] text-[#0f2a1a] font-bold text-lg
                     cursor-pointer active:scale-95 transition-all duration-150"
        >
          回大廳
        </button>
      </div>
    </div>
  );
}
