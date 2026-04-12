"use client";

import { useState } from "react";
import type { Tile } from "@/lib/mahjong/tiles";
import MjTile from "./MjTile";

interface MjHandProps {
  tiles: Tile[];
  canDiscard: boolean;
  onDiscard: (tileId: number) => void;
}

export default function MjHand({ tiles, canDiscard, onDiscard }: MjHandProps) {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  function handleTileClick(tile: Tile) {
    if (!canDiscard) return;
    setSelectedId((prev) => (prev === tile.id ? null : tile.id));
  }

  function handleDiscard() {
    if (selectedId === null) return;
    onDiscard(selectedId);
    setSelectedId(null);
  }

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Tiles row */}
      <div className="flex flex-wrap justify-center gap-[3px] px-2 max-w-full">
        {tiles.map((t) => (
          <MjTile
            key={t.id}
            tile={t}
            selected={selectedId === t.id}
            onClick={() => handleTileClick(t)}
          />
        ))}
      </div>

      {/* Discard button */}
      {canDiscard && selectedId !== null && (
        <button
          onClick={handleDiscard}
          className="px-6 py-2.5 rounded-xl bg-[#C9A96E] text-[#0f2a1a] font-bold text-sm
                     cursor-pointer active:scale-95 transition-all duration-150
                     shadow-md shadow-[#C9A96E]/30 animate-pulse"
        >
          打牌
        </button>
      )}
    </div>
  );
}
