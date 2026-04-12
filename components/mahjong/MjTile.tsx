"use client";

import type { Tile } from "@/lib/mahjong/tiles";

interface MjTileProps {
  tile: Tile;
  selected?: boolean;
  onClick?: () => void;
  small?: boolean;
  faceDown?: boolean;
}

function getTileColor(tile: Tile): string {
  if (tile.suit === "m") return "text-blue-700";
  if (tile.suit === "p") return "text-green-700";
  if (tile.suit === "s") return "text-red-700";
  if (tile.suit === "z") {
    if (tile.rank === 5) return "text-red-600"; // 中
    if (tile.rank === 6) return "text-green-700"; // 發
    if (tile.rank === 7) return "text-gray-400"; // 白
    return "text-gray-800"; // 風牌
  }
  if (tile.suit === "f") return "text-purple-600"; // 花牌
  return "text-gray-800";
}

export default function MjTile({ tile, selected, onClick, small, faceDown }: MjTileProps) {
  const w = small ? "w-[30px]" : "w-[40px]";
  const h = small ? "h-[42px]" : "h-[56px]";
  const textSize = small ? "text-[10px]" : "text-sm";

  if (faceDown) {
    return (
      <div
        className={`${w} ${h} rounded-md flex-shrink-0
          bg-gradient-to-br from-emerald-800 to-emerald-950
          border border-emerald-600/40 shadow-md
          flex items-center justify-center`}
      >
        <div className="w-[60%] h-[70%] rounded-sm border border-emerald-500/30 bg-emerald-700/50" />
      </div>
    );
  }

  const colorClass = getTileColor(tile);
  const isWhiteDragon = tile.suit === "z" && tile.rank === 7;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`${w} ${h} rounded-md flex-shrink-0 cursor-pointer
        bg-white/95 shadow-md
        flex items-center justify-center
        transition-all duration-100 active:scale-95
        ${selected
          ? "-translate-y-2 ring-2 ring-[#C9A96E] shadow-lg shadow-[#C9A96E]/30"
          : "hover:brightness-95"}
        ${isWhiteDragon ? "border-2 border-gray-300" : "border border-gray-200/60"}
        ${!onClick ? "cursor-default" : ""}
      `}
    >
      <span className={`${textSize} font-bold leading-none ${colorClass}`}>
        {tile.display}
      </span>
    </button>
  );
}
