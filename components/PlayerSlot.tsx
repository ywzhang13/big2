"use client";

interface PlayerSlotProps {
  name: string;
  cardCount: number;
  isCurrentTurn: boolean;
  isFinished: boolean;
  position: "top" | "left" | "right";
}

export default function PlayerSlot({
  name,
  cardCount,
  isCurrentTurn,
  isFinished,
  position,
}: PlayerSlotProps) {
  const isVertical = position === "left" || position === "right";

  return (
    <div
      className={`flex items-center gap-2 ${
        isVertical ? "flex-col" : "flex-row"
      }`}
    >
      <div
        className={`relative px-3 py-1.5 rounded-xl text-center
                    ${isCurrentTurn ? "bg-gold/20 ring-1 ring-gold/50" : "bg-white/10"}`}
      >
        {isCurrentTurn && (
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-green-400 turn-pulse" />
        )}
        <div className="text-sm font-medium text-white truncate max-w-[80px]">
          {name}
        </div>
        {isFinished ? (
          <div className="text-green-400 text-xs">&#10003; 完成</div>
        ) : (
          <div className="text-white/50 text-xs">{cardCount} 張</div>
        )}
      </div>
    </div>
  );
}
