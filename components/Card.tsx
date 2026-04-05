"use client";

import { getCardRank, getCardSuit, getSuitColor } from "@/lib/card";

interface CardProps {
  card: string;
  selected?: boolean;
  onClick?: () => void;
  faceDown?: boolean;
  small?: boolean;
  glow?: boolean;
}

const SUIT_CHARS: Record<string, string> = {
  S: "\u2660", // ♠ (black)
  H: "\u2665", // ♥ (red)
  D: "\u2666", // ♦ (red)
  C: "\u2663", // ♣ (black)
};

export default function Card({
  card,
  selected = false,
  onClick,
  faceDown = false,
  small = false,
  glow = false,
}: CardProps) {
  const w = small ? "w-[38px]" : "w-[42px]";
  const h = small ? "h-[54px]" : "h-[60px]";
  const textSize = small ? "text-[10px]" : "text-xs";
  const suitSize = small ? "text-[14px]" : "text-[16px]";

  if (faceDown) {
    return (
      <div className={`${w} ${h} rounded-lg flex items-center justify-center bg-gradient-to-br from-blue-800 to-blue-950 border border-blue-600/50 shadow-md shrink-0`}>
        <div className="w-[70%] h-[70%] rounded border border-blue-500/30 bg-blue-900/50 flex items-center justify-center text-blue-400/40 text-[8px] font-bold">
          B2
        </div>
      </div>
    );
  }

  const rank = getCardRank(card);
  const suit = getCardSuit(card);
  const suitChar = SUIT_CHARS[suit] ?? suit;
  const color = getSuitColor(suit);
  const textColor = color === "red" ? "text-red-600" : "text-gray-900";

  return (
    <div
      onClick={onClick}
      className={`${w} ${h} rounded-lg bg-white flex flex-col items-center justify-center
                  cursor-pointer shrink-0 card-base select-none
                  ${selected ? "card-selected" : "shadow-md border border-gray-200/80"}
                  ${glow ? "card-glow" : ""}
                  `}
      style={{
        boxShadow: selected
          ? undefined
          : "0 2px 6px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.8)",
      }}
    >
      <span
        className={`${suitSize} leading-none ${textColor}`}
        style={{ fontFamily: "serif", fontWeight: 700 }}
      >
        {suitChar}
      </span>
      <span className={`${textSize} font-extrabold leading-tight ${textColor}`}>
        {rank}
      </span>
    </div>
  );
}
