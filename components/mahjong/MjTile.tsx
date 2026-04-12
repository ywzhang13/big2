"use client";

import type { Tile } from "@/lib/mahjong/tiles";

interface MjTileProps {
  tile: Tile;
  selected?: boolean;
  onClick?: () => void;
  small?: boolean;
  faceDown?: boolean;
}

// Suit display: rank on top line, suit character below
function getTileLines(tile: Tile): { top: string; bottom: string; color: string } {
  if (tile.suit === "m") return { top: String(tile.rank), bottom: "萬", color: "#1e40af" }; // blue
  if (tile.suit === "p") return { top: String(tile.rank), bottom: "筒", color: "#15803d" }; // green
  if (tile.suit === "s") return { top: String(tile.rank), bottom: "條", color: "#b91c1c" }; // red
  if (tile.suit === "z") {
    if (tile.rank === 5) return { top: "中", bottom: "", color: "#dc2626" };
    if (tile.rank === 6) return { top: "發", bottom: "", color: "#15803d" };
    if (tile.rank === 7) return { top: "", bottom: "", color: "" }; // 白板
    const winds = ["東", "南", "西", "北"];
    return { top: winds[tile.rank - 1], bottom: "", color: "#1a1a1a" };
  }
  if (tile.suit === "f") {
    const names = ["春", "夏", "秋", "冬", "梅", "蘭", "竹", "菊"];
    const colors = ["#dc2626", "#dc2626", "#dc2626", "#dc2626", "#7c3aed", "#7c3aed", "#7c3aed", "#7c3aed"];
    return { top: names[tile.rank - 1], bottom: "", color: colors[tile.rank - 1] };
  }
  return { top: tile.display, bottom: "", color: "#1a1a1a" };
}

export default function MjTile({ tile, selected, onClick, small, faceDown }: MjTileProps) {
  const w = small ? 32 : 44;
  const h = small ? 44 : 62;

  if (faceDown) {
    return (
      <div
        className="rounded-md flex-shrink-0 flex items-center justify-center"
        style={{
          width: w, height: h,
          background: "linear-gradient(180deg, #2d6a4f 0%, #1b4332 60%, #0f2a1a 100%)",
          boxShadow: "1px 2px 4px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.15)",
          border: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        <div style={{
          width: w * 0.55, height: h * 0.65,
          borderRadius: 3,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(255,255,255,0.05)",
        }} />
      </div>
    );
  }

  const { top, bottom, color } = getTileLines(tile);
  const isWhite = tile.suit === "z" && tile.rank === 7;
  const isNumberTile = tile.suit === "m" || tile.suit === "p" || tile.suit === "s";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`rounded-md flex-shrink-0 flex flex-col items-center justify-center
        transition-all duration-100 active:scale-95
        ${selected ? "-translate-y-3 z-10" : "hover:brightness-[0.97]"}
        ${!onClick ? "cursor-default" : "cursor-pointer"}
      `}
      style={{
        width: w, height: h,
        // 3D ivory tile look
        background: selected
          ? "linear-gradient(180deg, #fff9e6 0%, #f5ecd0 40%, #e8ddb8 100%)"
          : "linear-gradient(180deg, #f8f2e0 0%, #efe5c8 35%, #e0d4a8 70%, #d4c490 100%)",
        boxShadow: selected
          ? `0 6px 16px rgba(201,169,110,0.5), inset 0 1px 0 rgba(255,255,255,0.9), 0 0 0 2px #C9A96E`
          : "1px 3px 6px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.8), inset 0 -1px 0 rgba(0,0,0,0.08)",
        border: selected ? "1px solid #C9A96E" : "1px solid rgba(180,170,140,0.5)",
      }}
    >
      {isWhite ? (
        // 白板: black hollow rectangle
        <div style={{
          width: w * 0.5, height: h * 0.55,
          border: `${small ? 2 : 2.5}px solid #1a1a1a`,
          borderRadius: 2,
        }} />
      ) : isNumberTile ? (
        // Number tiles: rank on top, suit name below
        <>
          <span style={{
            fontSize: small ? 14 : 20,
            fontWeight: 900,
            lineHeight: 1,
            color,
            fontFamily: "serif",
            textShadow: "0 1px 0 rgba(255,255,255,0.5)",
          }}>
            {top}
          </span>
          <span style={{
            fontSize: small ? 9 : 12,
            fontWeight: 700,
            lineHeight: 1,
            color,
            fontFamily: "serif",
            marginTop: small ? 0 : 1,
          }}>
            {bottom}
          </span>
        </>
      ) : (
        // 字牌/花牌: single character
        <span style={{
          fontSize: small ? 16 : 24,
          fontWeight: 900,
          lineHeight: 1,
          color,
          fontFamily: "serif",
          textShadow: "0 1px 0 rgba(255,255,255,0.5)",
        }}>
          {top}
        </span>
      )}
    </button>
  );
}
