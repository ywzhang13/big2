"use client";

import { getCardRank, getCardSuit, getSuitEmoji, getSuitColor } from "@/lib/card";

interface CardProps {
  card: string;
  selected?: boolean;
  onClick?: () => void;
  faceDown?: boolean;
  small?: boolean;
}

export default function Card({
  card,
  selected = false,
  onClick,
  faceDown = false,
  small = false,
}: CardProps) {
  const w = small ? "w-[40px]" : "w-[50px]";
  const h = small ? "h-[56px]" : "h-[70px]";
  const textSize = small ? "text-xs" : "text-sm";
  const suitSize = small ? "text-base" : "text-lg";

  if (faceDown) {
    return (
      <div
        className={`${w} ${h} rounded-lg flex items-center justify-center
                    bg-gradient-to-br from-blue-800 to-blue-950
                    border border-blue-600/50 shadow-md shrink-0`}
      >
        <div className="w-[70%] h-[70%] rounded border border-blue-500/30 bg-blue-900/50
                        flex items-center justify-center text-blue-400/40 text-xs font-bold">
          B2
        </div>
      </div>
    );
  }

  const rank = getCardRank(card);
  const suit = getCardSuit(card);
  const emoji = getSuitEmoji(suit);
  const color = getSuitColor(suit);
  const textColor = color === "red" ? "text-red-600" : "text-gray-900";

  return (
    <div
      onClick={onClick}
      className={`${w} ${h} rounded-lg bg-white flex flex-col items-center justify-center
                  cursor-pointer shrink-0 card-base
                  border border-gray-200 select-none
                  ${selected ? "card-selected" : "shadow-md"}`}
      style={{ boxShadow: selected ? undefined : "var(--card-shadow)" }}
    >
      <span className={`${suitSize} leading-none ${textColor}`}>{emoji}</span>
      <span className={`${textSize} font-bold leading-tight ${textColor}`}>
        {rank}
      </span>
    </div>
  );
}
