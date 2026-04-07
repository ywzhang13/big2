"use client";

import Card from "./Card";
import { scoreBreakdown } from "@/lib/scoring";

interface PlayerResult {
  seat: number;
  name: string;
  hand: string[];
  finishOrder: number | null;
  score: number; // cumulative score
  roundScore: number; // this round
}

interface GameOverProps {
  results: PlayerResult[];
  winnerLastPlay?: { cards: string[]; comboType: string; playerName: string };
  onGoHome: () => void;
  onPlayAgain?: () => void;
}

const COMBO_NAMES: Record<string, string> = {
  single: "單張", pair: "對子", straight: "順子",
  fullHouse: "葫蘆", fourOfAKind: "鐵支", straightFlush: "同花順",
};

export default function GameOver({ results, winnerLastPlay, onGoHome, onPlayAgain }: GameOverProps) {
  // Sort: winner first, then by remaining cards (fewer = better)
  const sorted = [...results].sort((a, b) => {
    if (a.finishOrder === 1) return -1;
    if (b.finishOrder === 1) return 1;
    return a.hand.length - b.hand.length;
  });

  return (
    <div className="flex flex-col items-center gap-5 p-6 fade-in overflow-y-auto flex-1">
      {/* Winner celebration */}
      <div className="text-center">
        <div className="text-5xl mb-2 trophy-bounce">{"\u{1F3C6}"}</div>
        <h2 className="text-3xl font-bold font-heading shimmer-gold">遊戲結束</h2>
      </div>

      {/* Winner's last play */}
      {winnerLastPlay && (
        <div className="bg-white/10 rounded-2xl p-4 text-center w-full max-w-sm">
          <p className="text-white/50 text-xs mb-2">{winnerLastPlay.playerName} 的最後一手</p>
          <div className="flex items-end justify-center gap-1">
            {winnerLastPlay.cards.map((card) => (
              <Card key={card} card={card} small glow />
            ))}
          </div>
          <p className="text-gold-light text-sm font-bold mt-2">{COMBO_NAMES[winnerLastPlay.comboType] || winnerLastPlay.comboType}</p>
        </div>
      )}

      <div className="w-full max-w-sm flex flex-col gap-3">
        {sorted.map((p) => {
          const isWinner = p.finishOrder === 1;
          const breakdown = scoreBreakdown(p.hand);

          return (
            <div
              key={p.seat}
              className={`rounded-2xl p-4 ${
                isWinner
                  ? "bg-gradient-to-r from-yellow-500/20 to-amber-600/10 ring-1 ring-yellow-500/50"
                  : "bg-white/5 ring-1 ring-white/10"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {isWinner && <span className="text-2xl trophy-bounce">{"\u{1F3C6}"}</span>}
                  <span className={`font-bold ${isWinner ? "text-xl text-gold-light" : "text-lg text-white"}`}>
                    {p.name}
                  </span>
                </div>
                <div className="text-right">
                  <span className={`text-lg font-bold ${
                    p.roundScore === 0 ? "text-green-400" : "text-red-400"
                  }`}>
                    {p.roundScore === 0 ? "0" : p.roundScore}
                  </span>
                </div>
              </div>

              {/* Score breakdown */}
              {!isWinner && p.hand.length > 0 && (
                <div className="text-white/40 text-[10px] mb-2 flex flex-wrap gap-x-2">
                  {breakdown.reasons.map((r, i) => (
                    <span key={i}>{r}</span>
                  ))}
                </div>
              )}

              {/* Cards */}
              {p.hand && p.hand.length > 0 ? (
                <div>
                  <div className="text-red-400/80 text-xs mb-1">
                    剩餘 {p.hand.length} 張
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {p.hand.map((card) => (
                      <Card key={card} card={card} small />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-green-400 text-sm font-medium">
                  {isWinner ? "出完所有牌！" : "載入中..."}
                </div>
              )}

              {/* Cumulative score */}
              <div className="mt-2 pt-2 border-t border-white/10 flex justify-between items-center">
                <span className="text-white/30 text-xs">累計</span>
                <span className={`text-sm font-bold ${p.score <= 0 ? "text-red-400" : "text-green-400"}`}>
                  {p.score}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 w-full max-w-sm mt-2">
        {onPlayAgain && (
          <button
            onClick={onPlayAgain}
            className="w-full px-8 py-3.5 rounded-2xl bg-gold text-felt font-bold text-lg
                       cursor-pointer active:scale-95 transition-transform"
          >
            繼續遊戲
          </button>
        )}
        <button
          onClick={onGoHome}
          className={`px-8 py-3.5 rounded-2xl font-bold text-lg cursor-pointer
                     active:scale-95 transition-transform
                     ${onPlayAgain
                       ? "border-2 border-gold/40 text-gold-light bg-transparent"
                       : "bg-gold text-felt"
                     }`}
        >
          回首頁
        </button>
      </div>
    </div>
  );
}
