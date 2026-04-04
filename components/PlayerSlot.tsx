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
        className={`relative px-3 py-2 rounded-2xl text-center transition-all duration-300
                    ${isCurrentTurn ? "bg-gold/20 ring-2 ring-gold/60" : "bg-white/10"}
                    ${isFinished ? "bg-green-500/10" : ""}`}
      >
        {/* Pulsing ring animation for current turn */}
        {isCurrentTurn && <span className="turn-pulse-ring" />}

        <div className="text-sm font-medium text-white truncate max-w-[80px]">
          {name}
        </div>

        {isFinished ? (
          <div className="text-amber-400 text-xs flex items-center justify-center gap-0.5">
            <span className="text-sm">&#127942;</span> 完成
          </div>
        ) : (
          <div className="flex items-center justify-center gap-1">
            <span
              className={`inline-flex items-center justify-center min-w-[20px] h-[18px] rounded-full text-[10px] font-bold px-1
                          ${cardCount <= 3 ? "bg-red-500/30 text-red-300" : "bg-white/15 text-white/60"}`}
            >
              {cardCount}
            </span>
            <span className="text-white/40 text-[10px]">張</span>
          </div>
        )}
      </div>
    </div>
  );
}
