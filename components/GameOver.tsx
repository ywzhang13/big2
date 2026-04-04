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
}

const RANK_LABELS = ["", "🥇 第一名", "🥈 第二名", "🥉 第三名", "第四名"];

export default function GameOver({ results, onGoHome }: GameOverProps) {
  const sorted = [...results].sort(
    (a, b) => (a.finishOrder ?? 99) - (b.finishOrder ?? 99)
  );

  return (
    <div className="flex flex-col items-center gap-6 p-6 fade-in">
      <h2 className="text-3xl font-bold text-gold-light">遊戲結束</h2>

      <div className="w-full max-w-sm flex flex-col gap-4">
        {sorted.map((p, i) => (
          <div
            key={p.seat}
            className={`rounded-2xl p-4 ${
              i === 0 ? "bg-gold/20 ring-1 ring-gold/50" : "bg-white/10"
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-lg text-white">{p.name}</span>
              <span
                className={`text-sm font-medium ${
                  i === 0 ? "text-gold-light" : "text-white/60"
                }`}
              >
                {RANK_LABELS[p.finishOrder ?? 4]}
              </span>
            </div>
            {p.hand && p.hand.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {p.hand.map((card) => (
                  <Card key={card} card={card} small />
                ))}
              </div>
            )}
            {(!p.hand || p.hand.length === 0) && (
              <div className="text-green-400 text-sm">已出完所有牌</div>
            )}
          </div>
        ))}
      </div>

      <button
        onClick={onGoHome}
        className="mt-4 px-8 py-3 rounded-2xl bg-gold text-felt font-bold text-lg
                   active:scale-95 transition-transform"
      >
        回首頁
      </button>
    </div>
  );
}
