"use client";

import { useState } from "react";
import type { Tile } from "@/lib/mahjong/tiles";
import MjTile from "./MjTile";

interface MjHandProps {
  tiles: Tile[];
  canDiscard: boolean;
  onDiscard: (tileId: number, declareTing?: boolean) => void;
  drawnTileId?: number; // ID of the tile just drawn (show separated on right)
  // 地聽：按下「地聽」後只能選打出後仍聽牌的牌，打牌鈕變成「打出＋地聽」
  tingArmed?: boolean;
  tingOptionIds?: number[];
}

export default function MjHand({ tiles, canDiscard, onDiscard, drawnTileId, tingArmed, tingOptionIds }: MjHandProps) {
  const [rawSelectedId, setSelectedId] = useState<number | null>(null);
  const tingBlocked = (id: number) => !!tingArmed && !(tingOptionIds ?? []).includes(id);
  // 按下地聽後原本選的牌不能地聽 → 視為沒選
  const selectedId = rawSelectedId !== null && tingBlocked(rawSelectedId) ? null : rawSelectedId;

  function handleTileClick(tile: Tile) {
    if (!canDiscard || tingBlocked(tile.id)) return;
    setSelectedId((prev) => (prev === tile.id ? null : tile.id));
  }

  function handleDiscard() {
    if (selectedId === null) return;
    onDiscard(selectedId, !!tingArmed);
    setSelectedId(null);
  }

  const dim = (id: number) => (canDiscard && tingBlocked(id) ? { opacity: 0.35 } : undefined);

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
      {/* Tiles row — pt-5 reserves space for the -translate-y-3 selected-lift */}
      <div className="flex justify-center items-end px-1 pt-5 max-w-full">
        {/* Main hand */}
        <div className="flex gap-[2px]">
          {mainTiles.map((t) => (
            <div key={t.id} style={dim(t.id)}>
              <MjTile
                tile={t}
                selected={selectedId === t.id}
                onClick={() => handleTileClick(t)}
              />
            </div>
          ))}
        </div>
        {/* Drawn tile separated */}
        {drawnTile && (
          <div className="ml-3 pl-3 border-l border-white/10" style={dim(drawnTile.id)}>
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
          {tingArmed ? "打出＋地聽" : "打牌"}
        </button>
      )}
    </div>
  );
}
