"use client";

import Card from "./Card";

interface HandProps {
  cards: string[];
  selectedCards: string[];
  onToggleCard: (card: string) => void;
}

export default function Hand({ cards, selectedCards, onToggleCard }: HandProps) {
  // Make all 13 cards fit on screen without scrolling
  // Use negative margins to overlap cards
  const cardCount = cards.length;
  // Calculate overlap so all cards fit within ~350px (iPhone width - padding)
  // Card width is 44px, we want total width ≈ 350px
  // totalWidth = cardWidth + (cardCount - 1) * (cardWidth + marginLeft)
  // 350 = 44 + (n-1) * (44 + ml) => ml = (350 - 44) / (n-1) - 44
  const overlapPx = cardCount > 1 ? Math.min(0, Math.floor((310 / (cardCount - 1)) - 44)) : 0;

  return (
    <div className="w-full py-2 px-3">
      <div className="flex items-end justify-center">
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
