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

export default function MjTile({ tile, selected, onClick, small, tiny, faceDown }: MjTileProps) {
  const w = tiny ? 20 : small ? 27 : 36;
  const h = tiny ? 27 : small ? 38 : 49;

  const characterSrc = faceDown
    ? null
    : `/tiles/${getTileSvg(tile)}.svg`;

  const backdropSrc = faceDown
    ? "/tiles/Back.svg"
    : "/tiles/Front.svg";

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
        width: w, height: h,
        background: "transparent",
        boxShadow: selected
          ? "0 6px 16px rgba(0,0,0,0.5), 0 0 0 2px #fbbf24"
          : "none",
        border: "none",
      }}
    >
      {/* Backdrop (tile face/back) */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={backdropSrc}
        alt=""
        width={w}
        height={h}
        style={{
          position: "absolute",
          inset: 0,
          width: w,
          height: h,
          objectFit: "contain",
          display: "block",
          pointerEvents: "none",
        }}
        draggable={false}
      />
      {/* Character overlay (on top of Front.svg) */}
      {characterSrc && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={characterSrc}
          alt={tile.display}
          width={w}
          height={h}
          style={{
            position: "absolute",
            inset: 0,
            width: w,
            height: h,
            objectFit: "contain",
            display: "block",
            pointerEvents: "none",
          }}
          draggable={false}
        />
      )}
    </button>
  );
}
