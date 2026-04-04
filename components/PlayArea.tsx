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
        <div className="text-gold/80 text-sm font-medium">自由出牌</div>
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

  const overlap = lastPlay.cards.length > 3 ? -16 : -8;

  return (
    <div className="flex flex-col items-center justify-center gap-1.5 card-enter">
      <div className="text-white/50 text-xs">{lastPlay.playerName}</div>
      <div className="flex items-end justify-center">
        {lastPlay.cards.map((card, i) => (
          <div key={card} style={{ marginLeft: i === 0 ? 0 : overlap, zIndex: i }}>
            <Card card={card} small />
          </div>
        ))}
      </div>
      <div className="text-gold-light text-xs font-medium">{lastPlay.comboType}</div>
    </div>
  );
}
