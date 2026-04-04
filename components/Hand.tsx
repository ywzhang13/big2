"use client";

import Card from "./Card";

interface HandProps {
  cards: string[];
  selectedCards: string[];
  onToggleCard: (card: string) => void;
}

export default function Hand({ cards, selectedCards, onToggleCard }: HandProps) {
  // Calculate overlap based on card count
  const overlapPx = cards.length > 10 ? -18 : cards.length > 7 ? -14 : -8;

  return (
    <div className="w-full overflow-x-auto hide-scrollbar py-2 px-4">
      <div
        className="flex items-end justify-center min-w-min mx-auto"
        style={{ paddingLeft: 8, paddingRight: 8 }}
      >
        {cards.map((card, i) => (
          <div
            key={card}
            style={{
              marginLeft: i === 0 ? 0 : overlapPx,
              zIndex: i,
            }}
          >
            <Card
              card={card}
              selected={selectedCards.includes(card)}
              onClick={() => onToggleCard(card)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
