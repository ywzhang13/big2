"use client";

import Card from "./Card";

interface PlayerResult {
  seat: number;
  name: string;
  hand: string[];
  finishOrder: number | null;
}

interface GameOverProps {
  results: PlayerResult[];
  onGoHome: () => void;
  onPlayAgain?: () => void;
}

const RANK_LABELS = ["", "第一名", "第二名", "第三名", "第四名"];
const RANK_ICONS = ["", "\u{1F3C6}", "\u{1F948}", "\u{1F949}", ""];
const RANK_COLORS = [
  "",
  "from-yellow-500/20 to-amber-600/10 ring-yellow-500/50",
  "from-gray-300/15 to-gray-400/5 ring-gray-400/30",
  "from-amber-700/15 to-orange-800/5 ring-amber-700/30",
  "from-white/5 to-white/5 ring-white/10",
];

export default function GameOver({ results, onGoHome, onPlayAgain }: GameOverProps) {
  const sorted = [...results].sort(
    (a, b) => (a.finishOrder ?? 99) - (b.finishOrder ?? 99)
  );

  return (
    <div className="flex flex-col items-center gap-5 p-6 fade-in">
      {/* Winner celebration */}
      <div className="text-center">
        <div className="text-5xl mb-2 trophy-bounce">{"\u{1F3C6}"}</div>
        <h2 className="text-3xl font-bold font-heading shimmer-gold">
          遊戲結束
        </h2>
      </div>

      <div className="w-full max-w-sm flex flex-col gap-3">
        {sorted.map((p) => {
          const rank = p.finishOrder; // null means didn't finish
          const rankIdx = rank ?? 0;
          const isWinner = rank === 1;
          const hasRank = rank !== null && rank >= 1 && rank <= 4;
          return (
            <div
              key={p.seat}
              className={`rounded-2xl p-4 bg-gradient-to-r ${hasRank ? (RANK_COLORS[rankIdx] || RANK_COLORS[4]) : RANK_COLORS[4]}
                          ${isWinner ? "ring-1" : ""}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {isWinner && (
                    <span className="text-2xl trophy-bounce">{RANK_ICONS[1]}</span>
                  )}
                  <span className={`font-bold ${isWinner ? "text-xl text-gold-light" : "text-lg text-white"}`}>
                    {p.name}
                  </span>
                </div>
                <span className={`text-sm font-semibold ${isWinner ? "text-gold-light" : "text-white/40"}`}>
                  {isWinner ? "勝利" : ""}
                </span>
              </div>
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
            再來一局
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
