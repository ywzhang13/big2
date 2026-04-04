"use client";

import Card from "./Card";

interface HandProps {
  cards: string[];
  selectedCards: string[];
  onToggleCard: (card: string) => void;
}

export default function Hand({ cards, selectedCards, onToggleCard }: HandProps) {
  const cardCount = cards.length;
  // Card width is now 48px. Target fit within ~355px (iPhone SE: 375 - 20 padding)
  // totalWidth = cardWidth + (cardCount - 1) * step
  // step = (355 - 48) / (cardCount - 1)
  // overlap = step - 48
  const availableWidth = typeof window !== "undefined" ? Math.min(window.innerWidth - 20, 375) : 355;
  const cardWidth = 48;
  const step = cardCount > 1 ? (availableWidth - cardWidth) / (cardCount - 1) : 0;
  const overlapPx = cardCount > 1 ? Math.min(0, Math.floor(step - cardWidth)) : 0;

  // Subtle arc: cards near edges rotate slightly, center cards stay flat
  const getArc = (index: number, total: number) => {
    if (total <= 3) return { rotate: 0, translateY: 0 };
    const mid = (total - 1) / 2;
    const offset = index - mid;
    const maxRotate = Math.min(3, total * 0.3); // max rotation in degrees
    const rotate = (offset / mid) * maxRotate;
    const translateY = Math.abs(offset / mid) * 4; // max 4px dip at edges
    return { rotate, translateY };
  };

  return (
    <div className="w-full py-2 px-2.5">
      <div className="flex items-end justify-center">
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
