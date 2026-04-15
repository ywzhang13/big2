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
  // tiny bumped +30% so discard pool is easier to read (26×35 instead of 20×27)
  const w = tiny ? 26 : small ? 27 : 36;
  const h = tiny ? 35 : small ? 38 : 49;

  const characterSrc = faceDown
    ? null
    : `/tiles/${getTileSvg(tile)}.svg`;

  // faceDown → render a green-felt gradient div matching the rest of the
  // board, rather than the bundled red Back.svg which clashes visually.
  const backdropSrc = faceDown ? null : "/tiles/Front.svg";

  // Use <button> when clickable, <div> otherwise, to avoid nested <button>
  // issues when MjTile is rendered inside another button (e.g. chi action button).
  const Tag: "button" | "div" = onClick ? "button" : "div";
  const interactiveProps = onClick
    ? { type: "button" as const, onClick }
    : {};

  return (
    <Tag
      {...interactiveProps}
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
        padding: 0,
      }}
    >
      {/* Backdrop — Front.svg when face-up, inline green gradient when
          face-down (matches felt-style opponent tile backs). */}
      {backdropSrc ? (
        /* eslint-disable-next-line @next/next/no-img-element */
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
      ) : (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            width: w,
            height: h,
            borderRadius: Math.round(w * 0.12),
            background: "linear-gradient(180deg, #4a8a5a 0%, #2a6038 50%, #1a4828 100%)",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: "0 1px 3px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -1px 0 rgba(0,0,0,0.35)",
            pointerEvents: "none",
          }}
        />
      )}
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
    </Tag>
  );
}
