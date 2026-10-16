"use client";

import type { Tile } from "@/lib/mahjong/tiles";

interface MjTileProps {
  tile: Tile;
  selected?: boolean;
  onClick?: () => void;
  small?: boolean;
  tiny?: boolean; // even smaller for discard pool
  faceDown?: boolean;
  // 指定尺寸（手機橫向用 CSS 變數，例如 "var(--tile-hand-w)"），覆蓋 tiny/small
  width?: number | string;
  height?: number | string;
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

export default function MjTile({ tile, selected, onClick, small, tiny, faceDown, width, height }: MjTileProps) {
  // tiny bumped +30% so discard pool is easier to read (26×35 instead of 20×27)
  const w = width ?? (tiny ? 26 : small ? 27 : 36);
  const h = height ?? (tiny ? 35 : small ? 38 : 49);

  // 牌面：Cangjie6 中式牌組（Wikimedia Commons，CC BY-SA 4.0，見 public/tiles/cj6/LICENSE.txt）。
  // SVG 已拿掉立體牌身、只剩牌面圖案（scripts/flatten-cj6-tiles.mjs）；白底、細框、小圓角在這裡畫成平面牌
  const characterSrc = faceDown
    ? null
    : `/tiles/cj6/${getTileSvg(tile)}.svg`;

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
      {/* faceDown → inline green gradient (matches felt-style opponent tile backs). */}
      {faceDown && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            width: w,
            height: h,
            borderRadius: typeof w === "number" ? Math.round(w * 0.12) : "12%",
            background: "linear-gradient(180deg, #4a8a5a 0%, #2a6038 50%, #1a4828 100%)",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: "0 1px 3px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -1px 0 rgba(0,0,0,0.35)",
            pointerEvents: "none",
          }}
        />
      )}
      {/* 牌面：白底平面牌（細框用 inset 陰影畫，小牌也不會吃掉圖案的空間） */}
      {characterSrc && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={characterSrc}
          alt={tile.display}
          width={typeof w === "number" ? w : undefined}
          height={typeof h === "number" ? h : undefined}
          style={{
            position: "absolute",
            inset: 0,
            width: w,
            height: h,
            objectFit: "contain",
            display: "block",
            pointerEvents: "none",
            background: "#fff",
            borderRadius: typeof w === "number" ? Math.max(1.5, Math.round(w * 0.1)) : "10% / 7.5%",
            boxShadow: "inset 0 0 0 1px #c9c2b2",
          }}
          draggable={false}
        />
      )}
    </Tag>
  );
}
