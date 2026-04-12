"use client";

import type { Tile } from "@/lib/mahjong/tiles";
import type { Meld } from "@/lib/mahjong/gameState";
import type { MjPlayer } from "@/hooks/useMahjong";
import MjTile from "./MjTile";
import MjHand from "./MjHand";

interface MjBoardProps {
  players: MjPlayer[];
  mySeat: number;
  myHand: Tile[];
  currentTurn: number;
  dealerSeat: number;
  lastDiscard: { tile: Tile; from: number } | null;
  availableActions: { type: string; tiles?: Tile[] }[];
  wallRemaining: number;
  hasDrawn: boolean;
  needsDraw: boolean;
  needsDiscard: boolean;
  isMyTurn: boolean;
  playerName: string;
  onDraw: () => void;
  onDiscard: (tileId: number) => void;
  onAction: (type: string, tiles?: Tile[]) => void;
}

const WIND_CHARS = ["東", "南", "西", "北"];

function ActionName(type: string): string {
  const m: Record<string, string> = {
    chi: "吃",
    pong: "碰",
    kong: "槓",
    win: "胡",
    pass: "過",
  };
  return m[type] || type;
}

/** Opponent info panel */
function OpponentPanel({
  player,
  position,
  isCurrent,
}: {
  player: MjPlayer | undefined;
  position: "top" | "left" | "right";
  isCurrent: boolean;
}) {
  if (!player) return null;

  const posClasses = {
    top: "flex-col items-center",
    left: "flex-col items-center",
    right: "flex-col items-center",
  };

  const isHorizontal = position === "top";
  const tileSize = position === "top" ? 18 : 14; // top has more space
  const tileH = position === "top" ? 24 : 20;

  return (
    <div
      className={`flex ${posClasses[position]} gap-1 transition-all duration-200
        ${isCurrent ? "" : "opacity-60"}`}
    >
      {/* Name badge */}
      <div className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px]
        ${isCurrent ? "bg-[#C9A96E]/25 border border-[#C9A96E]/40 text-[#f0d68a]" : "bg-white/5 text-white/70"}`}>
        <span className="font-bold truncate max-w-[50px]">{player.name}</span>
        {player.isDealer && <span className="text-[#C9A96E]">莊</span>}
      </div>

      {/* Face-down tiles — show actual count as tile backs */}
      <div className={`flex ${isHorizontal ? "flex-row" : "flex-col"} gap-[1px] items-center`}>
        {Array.from({ length: player.tileCount }).map((_, i) => (
          <div
            key={i}
            className="rounded-[2px]"
            style={{
              width: isHorizontal ? tileSize : tileSize - 2,
              height: isHorizontal ? tileH : tileSize,
              background: "linear-gradient(180deg, #3a7a4a 0%, #1a5028 100%)",
              boxShadow: "0 1px 2px rgba(0,0,0,0.3)",
              border: "0.5px solid rgba(255,255,255,0.1)",
            }}
          />
        ))}
      </div>

      {/* Flowers + Revealed melds */}
      {(player.flowers.length > 0 || player.revealed.length > 0) && (
        <div className={`flex ${isHorizontal ? "flex-row" : "flex-col"} gap-1 items-center`}>
          {player.flowers.map((f) => (
            <MjTile key={f.id} tile={f} small />
          ))}
          {player.revealed.map((meld, mi) => (
            <div key={mi} className="flex gap-[1px]">
              {meld.tiles.map((t) => (
                <MjTile key={t.id} tile={t} small faceDown={meld.type === "concealed_kong"} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MjBoard({
  players,
  mySeat,
  myHand,
  currentTurn,
  dealerSeat,
  lastDiscard,
  availableActions,
  wallRemaining,
  hasDrawn,
  needsDraw,
  needsDiscard,
  isMyTurn,
  playerName,
  onDraw,
  onDiscard,
  onAction,
}: MjBoardProps) {
  // Map opponents relative to my seat
  const getOpponent = (offset: number) => {
    const seat = (mySeat + offset) % 4;
    return players.find((p) => p.seat === seat);
  };

  const top = getOpponent(2);
  const left = getOpponent(3);
  const right = getOpponent(1);
  const me = players.find((p) => p.seat === mySeat);

  const hasActions = availableActions.length > 0;

  return (
    <div className="mj-landscape flex flex-col flex-1 overflow-hidden relative bg-[#0f2a1a]"
         style={{ minHeight: "100dvh" }}>
      {/* Top opponent */}
      <div className="flex justify-center pt-safe px-4 py-1">
        <OpponentPanel player={top} position="top" isCurrent={top?.seat === currentTurn} />
      </div>

      {/* Middle row: left | center | right */}
      <div className="flex-1 flex items-stretch px-1 min-h-0">
        {/* Left */}
        <div className="w-[70px] flex-shrink-0 flex items-center justify-center">
          <OpponentPanel player={left} position="left" isCurrent={left?.seat === currentTurn} />
        </div>

        {/* Center area — 4-sided discard pool */}
        <div className="flex-1 flex flex-col items-center justify-center gap-1 min-h-0 overflow-hidden">
          {/* Wind + wall + turn info */}
          <div className="flex items-center gap-3 text-[10px] text-white/40">
            <span>場風: {WIND_CHARS[(players.find(p => p.seat === dealerSeat)?.seat ?? 0)] || "東"}</span>
            <span>剩餘: {wallRemaining}</span>
            {isMyTurn ? (
              <span className="text-[#f0d68a] font-bold animate-pulse">
                {needsDraw ? "輪到你摸牌" : "輪到你打牌"}
              </span>
            ) : (
              <span>等待 {players.find((p) => p.seat === currentTurn)?.name || "..."}</span>
            )}
          </div>

          {/* 4-sided discard pool */}
          <div className="relative w-full max-w-[400px] h-[140px] bg-black/15 rounded-lg border border-white/5">
            {/* Top player discards (rotated 180deg) */}
            <div className="absolute top-1 left-1/2 -translate-x-1/2 flex gap-[1px] justify-center flex-wrap max-w-[280px]">
              {(top?.discards || []).slice(-9).map((t, i) => (
                <MjTile key={`top-${t.id}-${i}`} tile={t} small />
              ))}
            </div>
            {/* Left player discards */}
            <div className="absolute left-1 top-1/2 -translate-y-1/2 flex flex-col gap-[1px] items-center max-h-[120px] overflow-hidden">
              {(left?.discards || []).slice(-4).map((t, i) => (
                <MjTile key={`left-${t.id}-${i}`} tile={t} small />
              ))}
            </div>
            {/* Right player discards */}
            <div className="absolute right-1 top-1/2 -translate-y-1/2 flex flex-col gap-[1px] items-center max-h-[120px] overflow-hidden">
              {(right?.discards || []).slice(-4).map((t, i) => (
                <MjTile key={`right-${t.id}-${i}`} tile={t} small />
              ))}
            </div>
            {/* My discards (bottom) */}
            <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex gap-[1px] justify-center flex-wrap max-w-[280px]">
              {(me?.discards || []).slice(-9).map((t, i) => (
                <MjTile key={`me-${t.id}-${i}`} tile={t} small />
              ))}
            </div>
            {/* Center: last discard */}
            {lastDiscard && (
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                <div className="ring-2 ring-[#C9A96E] rounded">
                  <MjTile tile={lastDiscard.tile} small />
                </div>
              </div>
            )}
          </div>

          {/* Action buttons */}
          {hasActions && (
            <div className="flex gap-2 justify-center">
              {availableActions.map((action, i) => (
                <button
                  key={`${action.type}-${i}`}
                  onClick={() => onAction(action.type, action.tiles)}
                  className={`px-3 py-1.5 rounded-lg font-bold text-xs
                    cursor-pointer active:scale-95 transition-all duration-150
                    ${action.type === "win"
                      ? "bg-red-600 text-white animate-pulse"
                      : "bg-[#C9A96E] text-[#0f2a1a]"
                    }`}
                >
                  {ActionName(action.type)}
                </button>
              ))}
              <button
                onClick={() => onAction("pass")}
                className="px-3 py-1.5 rounded-lg bg-white/10 text-white font-bold text-xs
                  cursor-pointer active:scale-95 transition-all duration-150"
              >
                過
              </button>
            </div>
          )}
        </div>

        {/* Right */}
        <div className="w-[70px] flex-shrink-0 flex items-center justify-center">
          <OpponentPanel player={right} position="right" isCurrent={right?.seat === currentTurn} />
        </div>
      </div>

      {/* Bottom: my area */}
      <div className="pb-safe bg-black/20">
        {/* Meld + Flower zone (吃碰槓/花牌區) */}
        {me && (me.revealed.length > 0 || me.flowers.length > 0) && (
          <div className="flex items-center gap-3 px-3 py-1 border-b border-white/5">
            {/* Flowers */}
            {me.flowers.length > 0 && (
              <div className="flex gap-[2px] items-center">
                <span className="text-[9px] text-white/30 mr-1">花</span>
                {me.flowers.map((f) => (
                  <MjTile key={f.id} tile={f} small />
                ))}
              </div>
            )}
            {/* Revealed melds */}
            {me.revealed.length > 0 && (
              <div className="flex gap-2 items-center">
                {me.revealed.map((meld, mi) => (
                  <div key={mi} className="flex gap-[1px]">
                    {meld.tiles.map((t) => (
                      <MjTile key={t.id} tile={t} small faceDown={meld.type === "concealed_kong"} />
                    ))}
                  </div>
                ))}
              </div>
            )}
            {/* Spacer + info */}
            <span className="text-[10px] text-white/30 ml-auto">
              {playerName}{me.isDealer ? " (莊)" : ""}
            </span>
          </div>
        )}

        {/* Hand + draw button on same row */}
        <div className="flex items-end px-1 py-1 gap-2">
          <div className="flex-1 min-w-0">
            <MjHand tiles={myHand} canDiscard={needsDiscard} onDiscard={onDiscard} />
          </div>
          {needsDraw && (
            <button
              onClick={onDraw}
              className="px-4 py-2 rounded-lg bg-[#C9A96E] text-[#0f2a1a] font-bold text-xs
                         cursor-pointer active:scale-95 transition-all flex-shrink-0"
            >
              摸牌
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
