"use client";

import Card from "./Card";

interface PlayAreaProps {
  lastPlay: { cards: string[]; comboType: string; playerName: string } | null;
  isNewRound: boolean;
}

export default function PlayArea({ lastPlay, isNewRound }: PlayAreaProps) {
  if (isNewRound && !lastPlay) {
    return (
      <div className="flex flex-col items-center justify-center gap-2">
        <div className="text-gold-light text-lg font-bold font-heading free-play-pulse tracking-wide">
          自由出牌
        </div>
      </div>
    );
  }

  if (!lastPlay) {
    return (
      <div className="flex flex-col items-center justify-center">
        <div className="text-white/20 text-sm">等待出牌</div>
      </div>
    );
  }

  const overlap = lastPlay.cards.length > 3 ? -14 : -6;

  return (
    <div className="flex flex-col items-center justify-center gap-1.5 card-enter">
      <div className="text-white/60 text-xs font-medium">{lastPlay.playerName}</div>
      <div className="flex items-end justify-center py-1">
        {lastPlay.cards.map((card, i) => (
          <div key={card} style={{ marginLeft: i === 0 ? 0 : overlap, zIndex: i }}>
            <Card card={card} small glow />
          </div>
        ))}
      </div>
      <div className="text-gold-light text-xs font-semibold bg-gold/10 px-3 py-0.5 rounded-full">
        {lastPlay.comboType}
      </div>
    </div>
  );
}
