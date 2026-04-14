"use client";

import type { Tile } from "@/lib/mahjong/tiles";

interface MjTileProps {
  tile: Tile;
  selected?: boolean;
  onClick?: () => void;
  small?: boolean;
  tiny?: boolean; // even smaller for discard pool
  faceDown?: boolean;
}

// Map tile to SVG filename
function getTileSvg(tile: Tile): string {
  if (tile.suit === "m") return `Man${tile.rank}`;
  if (tile.suit === "p") return `Pin${tile.rank}`;
  if (tile.suit === "s") return `Sou${tile.rank}`;
  if (tile.suit === "z") {
    if (tile.rank === 1) return "Ton";   // 東
    if (tile.rank === 2) return "Nan";   // 南
    if (tile.rank === 3) return "Shaa";  // 西
    if (tile.rank === 4) return "Pei";   // 北
    if (tile.rank === 5) return "Chun";  // 中
    if (tile.rank === 6) return "Hatsu"; // 發
    if (tile.rank === 7) return "Haku";  // 白
  }
  if (tile.suit === "f") return `Flower${tile.rank}`;
  return "Blank";
}

// Flower number: 春=1 夏=2 秋=3 冬=4 / 梅=1 蘭=2 竹=3 菊=4
function getFlowerNumber(rank: number): number {
  return ((rank - 1) % 4) + 1;
}

export default function MjTile({ tile, selected, onClick, small, tiny, faceDown }: MjTileProps) {
  const w = tiny ? 22 : small ? 30 : 44;
  const h = tiny ? 30 : small ? 42 : 60;

  const src = faceDown
    ? "/tiles/Back.svg"
    : `/tiles/${getTileSvg(tile)}.svg`;

  const isFlower = tile.suit === "f";
  const flowerNum = isFlower ? getFlowerNumber(tile.rank) : 0;

  // Badge size scales with tile size
  const badgeSize = tiny ? 10 : small ? 13 : 16;
  const badgeFontSize = tiny ? 7 : small ? 9 : 11;
  const padding = tiny ? 1 : small ? 1.5 : 2;
  const borderRadius = tiny ? 3 : small ? 4 : 6;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`flex-shrink-0 transition-all duration-100 active:scale-95 relative
        ${selected ? "-translate-y-3 z-10" : ""}
        ${!onClick ? "cursor-default" : "cursor-pointer"}
      `}
      style={{
        width: w,
        height: h,
        borderRadius,
        overflow: "hidden",
        // Classic Taiwan mahjong mobile game tile: cream ivory gradient
        background: faceDown
          ? "linear-gradient(135deg, #1a7a3e 0%, #0f5c2d 100%)"
          : "linear-gradient(145deg, #faf3de 0%, #f0e5c8 50%, #ddd0aa 100%)",
        // Raised 3D bezel: top-left highlight, bottom-right shadow
        boxShadow: selected
          ? "0 6px 16px rgba(0,0,0,0.5), 0 0 0 2px #fbbf24, inset 0 1px 0 rgba(255,255,255,0.9), inset 0 -1px 1px rgba(120,90,40,0.4)"
          : "0 1px 2px rgba(0,0,0,0.3), 0 1px 0 rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.9), inset 0 -1px 1px rgba(120,90,40,0.3)",
        border: selected
          ? "1px solid #fbbf24"
          : faceDown
            ? "1px solid rgba(0,0,0,0.4)"
            : "1px solid rgba(140,110,60,0.55)",
        padding,
      }}
    >
      {!faceDown && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={tile.display}
            width={w - padding * 2}
            height={h - padding * 2}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              display: "block",
              // Warm tone: slight sepia + saturation boost for classic look
              filter: "saturate(1.15) contrast(1.05)",
            }}
            draggable={false}
          />

          {/* Flower number badge (1-4) — top-right corner */}
          {isFlower && !tiny && (
            <div
              style={{
                position: "absolute",
                top: 1,
                right: 1,
                width: badgeSize,
                height: badgeSize,
                borderRadius: "50%",
                background: "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)",
                color: "#fff7ed",
                fontSize: badgeFontSize,
                fontWeight: 900,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 1px 2px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.3)",
                fontFamily: "serif",
                lineHeight: 1,
              }}
            >
              {flowerNum}
            </div>
          )}
        </>
      )}

      {/* Face-down decoration */}
      {faceDown && (
        <div
          style={{
            position: "absolute",
            inset: 2,
            borderRadius: Math.max(2, borderRadius - 2),
            border: "1px solid rgba(255,255,255,0.15)",
            background:
              "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.08) 0%, transparent 60%)",
          }}
        />
      )}
    </button>
  );
}
