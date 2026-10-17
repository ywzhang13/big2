"use client";

import { useEffect, useState } from "react";
import type { Tile } from "@/lib/mahjong/tiles";
import MjTile, { tileKind } from "./MjTile";

interface MjHandProps {
  tiles: Tile[];
  canDiscard: boolean;
  onDiscard: (tileId: number, declareEye?: boolean) => void;
  drawnTileId?: number; // ID of the tile just drawn (show separated on right)
  // 眼牌：按下「眼牌」後，打出後仍聽牌的牌往上浮，點一張就直接打出並宣告；其餘變暗不能點
  eyeArmed?: boolean;
  eyeOptionIds?: number[];
  // 眼牌後慢慢摸牌：摸進的那張先蓋著再翻開（只有眼牌的人自己看得到）
  slowDraw?: { tileId: number; win: boolean } | null;
  // 選中（還沒打出）的是哪一種牌，給牌桌比對海底和吃碰區；沒選＝null
  onPickKind?: (kind: string | null) => void;
}

/** 慢慢摸牌的翻牌（小宜 2026-10-16）：牌背浮起＋金光 → 翻面 → 落定；能胡時翻開那面閃金框。桌機、手機共用 */
export function SlowDrawTile({ tile, win, width, height }: { tile: Tile; win: boolean; width?: number | string; height?: number | string }) {
  return (
    <div className={`mjm-slowdraw ${win ? "win" : ""}`} data-slow-draw={win ? "win" : "draw"}>
      <div className="inner">
        <div className="face back"><MjTile tile={tile} faceDown width={width} height={height} /></div>
        <div className="face front"><MjTile tile={tile} width={width} height={height} /></div>
      </div>
    </div>
  );
}

export default function MjHand({ tiles, canDiscard, onDiscard, drawnTileId, eyeArmed, eyeOptionIds, slowDraw, onPickKind }: MjHandProps) {
  const [rawSelectedId, setSelectedId] = useState<number | null>(null);
  const eyePick = (id: number) => !!eyeArmed && (eyeOptionIds ?? []).includes(id);
  const eyeBlocked = (id: number) => !!eyeArmed && !eyePick(id);
  // 按下眼牌後就是「點牌直接打出」，原本選的牌不算
  const selectedId = eyeArmed ? null : rawSelectedId;
  const picked = canDiscard ? tiles.find((t) => t.id === selectedId) : undefined;
  const pickKind = picked ? tileKind(picked) : null;
  useEffect(() => {
    onPickKind?.(pickKind);
  }, [pickKind, onPickKind]);

  function handleTileClick(tile: Tile) {
    if (!canDiscard || eyeBlocked(tile.id)) return;
    if (eyeArmed) {
      onDiscard(tile.id, true);
      setSelectedId(null);
      return;
    }
    setSelectedId((prev) => (prev === tile.id ? null : tile.id));
  }

  function handleDiscard() {
    if (selectedId === null) return;
    onDiscard(selectedId);
    setSelectedId(null);
  }

  const dim = (id: number) =>
    !canDiscard ? undefined : eyeBlocked(id) ? { opacity: 0.35 } : eyePick(id) ? { transform: "translateY(-6px)" } : undefined;

  // Separate drawn tile from the rest
  // If drawnTileId matches a tile, separate it; otherwise show last tile as drawn
  let drawnTile: Tile | null = null;
  let mainTiles = tiles;
  if (drawnTileId != null) { // 牌 id 可能是 0
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
            {slowDraw?.tileId === drawnTile.id ? (
              <SlowDrawTile key={drawnTile.id} tile={drawnTile} win={slowDraw.win} />
            ) : (
              <MjTile
                tile={drawnTile}
                selected={selectedId === drawnTile.id}
                onClick={() => handleTileClick(drawnTile)}
              />
            )}
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
