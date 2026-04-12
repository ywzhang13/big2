"use client";

import type { Tile } from "@/lib/mahjong/tiles";

interface MjTileProps {
  tile: Tile;
  selected?: boolean;
  onClick?: () => void;
  small?: boolean;
  faceDown?: boolean;
}

// Get display info for each tile type
function getTileInfo(tile: Tile): { lines: string[]; color: string } {
  if (tile.suit === "m") {
    const nums = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
    return { lines: [nums[tile.rank], "萬"], color: "#ffffff" };
  }
  if (tile.suit === "p") {
    return { lines: [String(tile.rank), "筒"], color: "#ffffff" };
  }
  if (tile.suit === "s") {
    return { lines: [String(tile.rank), "條"], color: "#ffffff" };
  }
  if (tile.suit === "z") {
    if (tile.rank === 5) return { lines: ["中"], color: "#ef4444" }; // red
    if (tile.rank === 6) return { lines: ["發"], color: "#22c55e" }; // green
    if (tile.rank === 7) return { lines: [""], color: "" }; // 白板
    const winds = ["東", "南", "西", "北"];
    return { lines: [winds[tile.rank - 1]], color: "#ffffff" };
  }
  if (tile.suit === "f") {
    const names = ["春", "夏", "秋", "冬", "梅", "蘭", "竹", "菊"];
    const isFlower = tile.rank <= 4;
    return { lines: [names[tile.rank - 1]], color: isFlower ? "#fbbf24" : "#c084fc" };
  }
  return { lines: [tile.display], color: "#ffffff" };
}

export default function MjTile({ tile, selected, onClick, small, faceDown }: MjTileProps) {
  const w = small ? 30 : 46;
  const h = small ? 40 : 64;

  // Face down — green tile back
  if (faceDown) {
    return (
      <div className="flex-shrink-0" style={{
        width: w, height: h,
        borderRadius: 4,
        background: "linear-gradient(180deg, #4a8c5c 0%, #2d6a3e 30%, #1a5a2e 100%)",
        boxShadow: "1px 2px 4px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.2), inset 0 -2px 0 #0d3a1a",
        border: "1px solid #0d3a1a",
      }} />
    );
  }

  const { lines, color } = getTileInfo(tile);
  const isWhite = tile.suit === "z" && tile.rank === 7;
  const isTwoLine = lines.length === 2 && lines[1];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`flex-shrink-0 flex flex-col items-center justify-center
        transition-all duration-100 active:scale-95
        ${selected ? "-translate-y-3 z-10" : ""}
        ${!onClick ? "cursor-default" : "cursor-pointer"}
      `}
      style={{
        width: w, height: h,
        borderRadius: 5,
        // Green 3D tile — dark green base with lighter green face
        background: selected
          ? "linear-gradient(180deg, #5aad6a 0%, #3d8f4e 25%, #2a7a3a 70%, #1a5a28 100%)"
          : "linear-gradient(180deg, #4a9c5a 0%, #357a42 25%, #246a32 70%, #145022 100%)",
        boxShadow: selected
          ? "0 6px 16px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.3), 0 0 0 2px #fbbf24"
          : "1px 3px 5px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.25), inset 0 -2px 0 rgba(0,0,0,0.3)",
        border: selected ? "1px solid #fbbf24" : "1px solid rgba(0,0,0,0.3)",
      }}
    >
      {/* Inner face — slightly lighter area for the character */}
      <div className="flex flex-col items-center justify-center" style={{
        width: w - (small ? 6 : 10),
        height: h - (small ? 8 : 14),
        borderRadius: 3,
        background: "rgba(255,255,255,0.08)",
        border: "1px solid rgba(255,255,255,0.1)",
      }}>
        {isWhite ? (
          // 白板 — white hollow rectangle
          <div style={{
            width: w * 0.4, height: h * 0.4,
            border: `${small ? 1.5 : 2}px solid rgba(255,255,255,0.7)`,
            borderRadius: 2,
          }} />
        ) : isTwoLine ? (
          // Number tiles — two lines
          <>
            <span style={{
              fontSize: small ? 12 : 18,
              fontWeight: 900,
              lineHeight: 1.1,
              color,
              fontFamily: "serif",
              textShadow: "0 1px 2px rgba(0,0,0,0.5)",
            }}>
              {lines[0]}
            </span>
            <span style={{
              fontSize: small ? 8 : 11,
              fontWeight: 800,
              lineHeight: 1,
              color,
              fontFamily: "serif",
              textShadow: "0 1px 2px rgba(0,0,0,0.5)",
            }}>
              {lines[1]}
            </span>
          </>
        ) : (
          // Single character (字牌/花牌)
          <span style={{
            fontSize: small ? 16 : 26,
            fontWeight: 900,
            lineHeight: 1,
            color,
            fontFamily: "serif",
            textShadow: "0 1px 3px rgba(0,0,0,0.5)",
          }}>
            {lines[0]}
          </span>
        )}
      </div>
    </button>
  );
}
