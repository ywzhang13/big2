"use client";

import { useState } from "react";
import type { Tile } from "@/lib/mahjong/tiles";
import MjTile from "./MjTile";

interface MjHandProps {
  tiles: Tile[];
  canDiscard: boolean;
  onDiscard: (tileId: number) => void;
  drawnTileId?: number; // ID of the tile just drawn (show separated on right)
}

export default function MjHand({ tiles, canDiscard, onDiscard, drawnTileId }: MjHandProps) {
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

  // Separate drawn tile from the rest
  // If drawnTileId matches a tile, separate it; otherwise show last tile as drawn
  let drawnTile: Tile | null = null;
  let mainTiles = tiles;
  if (drawnTileId) {
    drawnTile = tiles.find(t => t.id === drawnTileId) ?? null;
    if (drawnTile) {
      mainTiles = tiles.filter(t => t.id !== drawnTileId);
    } else if (tiles.length > 0) {
      // Fallback: if drawn tile ID doesn't match (e.g. after flower replacement),
      // show the last tile as the drawn one
      drawnTile = tiles[tiles.length - 1];
      mainTiles = tiles.slice(0, -1);
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Tiles row */}
      <div className="flex justify-center items-end px-1 max-w-full overflow-x-auto">
        {/* Main hand */}
        <div className="flex gap-[2px]">
          {mainTiles.map((t) => (
            <MjTile
              key={t.id}
              tile={t}
              selected={selectedId === t.id}
              onClick={() => handleTileClick(t)}
            />
          ))}
        </div>
        {/* Drawn tile separated */}
        {drawnTile && (
          <div className="ml-3 pl-3 border-l border-white/10">
            <MjTile
              tile={drawnTile}
              selected={selectedId === drawnTile.id}
              onClick={() => handleTileClick(drawnTile)}
            />
          </div>
        )}
      </div>

      {/* Discard button */}
      {canDiscard && selectedId !== null && (
        <button
          onClick={handleDiscard}
          className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-[#C9A96E] to-[#e8c97a] text-[#0f2a1a] font-bold text-sm
                     cursor-pointer active:scale-95 transition-all duration-150
                     shadow-md shadow-[#C9A96E]/30"
        >
          打牌
        </button>
      )}
    </div>
  );
}
