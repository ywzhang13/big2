"use client";

import Card from "./Card";

interface HandProps {
  cards: string[];
  selectedCards: string[];
  onToggleCard: (card: string) => void;
}

export default function Hand({ cards, selectedCards, onToggleCard }: HandProps) {
  // Always use horizontal scroll with comfortable spacing
  // Each card overlaps by a fixed amount that keeps them readable
  const overlapPx = -14; // 42 - 14 = 28px visible per card, comfortable to tap

  return (
    <div className="w-full py-1.5 overflow-x-auto hide-scrollbar">
      <div
        className="flex items-end justify-center"
        style={{ paddingLeft: 12, paddingRight: 12 }}
      >
        {cards.map((card, i) => {
          const isSelected = selectedCards.includes(card);
          return (
            <div
              key={card}
              style={{
                marginLeft: i === 0 ? 0 : overlapPx,
                zIndex: isSelected ? 50 + i : i,
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
