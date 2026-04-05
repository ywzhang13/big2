"use client";

import Card from "./Card";

interface HandProps {
  cards: string[];
  selectedCards: string[];
  onToggleCard: (card: string) => void;
}

export default function Hand({ cards, selectedCards, onToggleCard }: HandProps) {
  const cardCount = cards.length;
  const cardWidth = 42;
  // Target: fit all cards within screen width minus padding
  const availableWidth = typeof window !== "undefined" ? Math.min(window.innerWidth - 16, 400) : 370;
  // Calculate step between cards so they all fit
  const step = cardCount > 1 ? Math.min(cardWidth + 2, (availableWidth - cardWidth) / (cardCount - 1)) : 0;
  const overlapPx = cardCount > 1 ? Math.floor(step - cardWidth) : 0;

  // Subtle arc for natural feel
  const getArc = (index: number, total: number) => {
    if (total <= 3) return { rotate: 0, translateY: 0 };
    const mid = (total - 1) / 2;
    const offset = index - mid;
    const maxRotate = Math.min(2.5, total * 0.25);
    const rotate = (offset / mid) * maxRotate;
    const translateY = Math.abs(offset / mid) * 3;
    return { rotate, translateY };
  };

  // Total width of the hand
  const totalWidth = cardCount > 1 ? cardWidth + (cardCount - 1) * step : cardWidth;
  const needsScroll = totalWidth > availableWidth;

  return (
    <div className={`w-full py-1.5 px-2 ${needsScroll ? "overflow-x-auto hide-scrollbar" : ""}`}>
      <div
        className="flex items-end justify-center"
        style={{ minWidth: needsScroll ? totalWidth + 8 : undefined }}
      >
        {cards.map((card, i) => {
          const { rotate, translateY } = getArc(i, cardCount);
          const isSelected = selectedCards.includes(card);
          return (
            <div
              key={card}
              style={{
                marginLeft: i === 0 ? 0 : overlapPx,
                zIndex: isSelected ? 50 + i : i,
                transform: `rotate(${rotate}deg) translateY(${translateY}px)`,
              }}
            >
              <Card
                card={card}
                selected={isSelected}
                onClick={() => onToggleCard(card)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
