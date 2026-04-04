"use client";

import Card from "./Card";
import type { ComboType } from "@/lib/constants";

interface LastPlay {
  cards: string[];
  type: ComboType;
  seat: number;
}

interface PlayAreaProps {
  lastPlay: LastPlay | null;
  isNewRound: boolean;
  playerNames: Record<number, string>;
  lastAction?: { seat: number; action: "pass" } | null;
}

const COMBO_LABELS: Record<ComboType, string> = {
  single: "單張",
  pair: "對子",
  straight: "順子",
  fullHouse: "葫蘆",
  fourOfAKind: "鐵支",
  straightFlush: "同花順",
};

export default function PlayArea({
  lastPlay,
  isNewRound,
  playerNames,
  lastAction,
}: PlayAreaProps) {
  if (isNewRound && !lastPlay) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2">
        <div className="text-gold/80 text-sm font-medium">自由出牌</div>
      </div>
    );
  }

  if (lastAction?.action === "pass" && !lastPlay) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2">
        <div className="text-white/40 text-sm">
          {playerNames[lastAction.seat] ?? `P${lastAction.seat + 1}`} Pass
        </div>
        <div className="text-gold/80 text-sm font-medium">自由出牌</div>
      </div>
    );
  }

  if (!lastPlay) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <div className="text-white/20 text-sm">等待出牌</div>
      </div>
    );
  }

  const overlap = lastPlay.cards.length > 3 ? -16 : -8;

  return (
    <div className="flex flex-col items-center justify-center h-full gap-1.5 card-enter">
      <div className="text-white/50 text-xs">
        {playerNames[lastPlay.seat] ?? `P${lastPlay.seat + 1}`}
      </div>
      <div className="flex items-end justify-center">
        {lastPlay.cards.map((card, i) => (
          <div
            key={card}
            style={{ marginLeft: i === 0 ? 0 : overlap, zIndex: i }}
          >
            <Card card={card} small />
          </div>
        ))}
      </div>
      <div className="text-gold-light text-xs font-medium">
        {COMBO_LABELS[lastPlay.type]}
      </div>
    </div>
  );
}
