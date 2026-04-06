"use client";

import Card from "./Card";

interface HandProps {
  cards: string[];
  selectedCards: string[];
  onToggleCard: (card: string) => void;
}

export default function Hand({ cards, selectedCards, onToggleCard }: HandProps) {
  const cardCount = cards.length;

  // Two-row layout when more than 7 cards
  if (cardCount > 7) {
    // Split into two rows: top row has the first half, bottom row has the rest
    const topCount = Math.ceil(cardCount / 2);
    const topRow = cards.slice(0, topCount);
    const bottomRow = cards.slice(topCount);

    return (
      <div className="w-full py-1 px-2">
        {/* Top row */}
        <div className="flex items-end justify-center mb-1">
          {topRow.map((card, i) => {
            const isSelected = selectedCards.includes(card);
            return (
              <div
                key={card}
                style={{
                  marginLeft: i === 0 ? 0 : -2,
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
        {/* Bottom row */}
        <div className="flex items-end justify-center">
          {bottomRow.map((card, i) => {
            const isSelected = selectedCards.includes(card);
            return (
              <div
                key={card}
                style={{
                  marginLeft: i === 0 ? 0 : -2,
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

  // Single row for 7 or fewer cards — comfortable spacing
  return (
    <div className="w-full py-1.5 px-2">
      <div className="flex items-end justify-center gap-1">
        {cards.map((card, i) => {
          const isSelected = selectedCards.includes(card);
          return (
            <div
              key={card}
              style={{ zIndex: isSelected ? 50 + i : i }}
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
