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
        className={`relative px-3 py-2 rounded-2xl text-center transition-all duration-300 overflow-hidden
                    ${isCurrentTurn ? "bg-gold/20 ring-2 ring-gold/60" : "bg-white/10"}
                    ${isFinished ? "bg-green-500/15" : ""}`}
      >
        <div className="text-sm font-medium text-white truncate max-w-[80px]">
          {name}
        </div>

        {isFinished ? (
          <div className="text-green-400 text-[10px] font-bold flex items-center justify-center gap-0.5">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            完成
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

        {/* Pulsing indicator for current turn */}
        {isCurrentTurn && (
          <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-gold animate-pulse" />
        )}
      </div>
    </div>
  );
}
