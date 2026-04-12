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

  return (
    <div
      className={`flex ${posClasses[position]} gap-1 transition-all duration-200
        ${isCurrent ? "scale-105" : "opacity-70"}`}
    >
      <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg
        ${isCurrent ? "bg-[#C9A96E]/20 border border-[#C9A96E]/40" : "bg-white/5"}`}>
        <span className="text-xs font-bold text-white truncate max-w-[60px]">
          {player.name}
        </span>
        {player.isDealer && (
          <span className="text-[10px] text-[#C9A96E]">莊</span>
        )}
      </div>

      {/* Tile count */}
      <div className="flex items-center gap-1">
        <div className="flex gap-[1px]">
          {Array.from({ length: Math.min(player.tileCount, 8) }).map((_, i) => (
            <div key={i} className="w-[6px] h-[10px] rounded-[1px] bg-emerald-700 border border-emerald-500/30" />
          ))}
          {player.tileCount > 8 && (
            <span className="text-[8px] text-white/40 ml-0.5">+{player.tileCount - 8}</span>
          )}
        </div>
        <span className="text-[10px] text-white/50">{player.tileCount}張</span>
      </div>

      {/* Flowers */}
      {player.flowers.length > 0 && (
        <div className="flex gap-[2px]">
          {player.flowers.map((f) => (
            <MjTile key={f.id} tile={f} small />
          ))}
        </div>
      )}

      {/* Revealed melds */}
      {player.revealed.length > 0 && (
        <div className="flex gap-1 flex-wrap justify-center">
          {player.revealed.map((meld, mi) => (
            <div key={mi} className="flex gap-[1px]">
              {meld.tiles.map((t) => (
                <MjTile
                  key={t.id}
                  tile={t}
                  small
                  faceDown={meld.type === "concealed_kong"}
                />
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

  // Collect all discards for the pool display
  const allDiscards = players
    .flatMap((p) => p.discards.map((d) => ({ tile: d, from: p.seat })))
    .slice(-20); // Show last 20

  const hasActions = availableActions.length > 0;

  return (
    <div className="flex flex-col flex-1 overflow-hidden relative">
      {/* Top opponent */}
      <div className="flex justify-center pt-safe px-4 py-2">
        <OpponentPanel player={top} position="top" isCurrent={top?.seat === currentTurn} />
      </div>

      {/* Middle row: left | center | right */}
      <div className="flex-1 flex items-stretch px-1 min-h-0">
        {/* Left */}
        <div className="w-[70px] flex-shrink-0 flex items-center justify-center">
          <OpponentPanel player={left} position="left" isCurrent={left?.seat === currentTurn} />
        </div>

        {/* Center area */}
        <div className="flex-1 flex flex-col items-center justify-center gap-2 min-h-0 overflow-hidden">
          {/* Wind + wall info */}
          <div className="flex items-center gap-3 text-[10px] text-white/40">
            <span>場風: {WIND_CHARS[(players.find(p => p.seat === dealerSeat)?.seat ?? 0)] || "東"}</span>
            <span>剩餘: {wallRemaining}</span>
          </div>

          {/* Discard pool */}
          <div className="w-full max-w-[260px] min-h-[80px] bg-black/20 rounded-xl border border-white/5 p-2
                          flex flex-wrap justify-center gap-[2px] content-start">
            {allDiscards.map(({ tile }, i) => (
              <MjTile key={`${tile.id}-${i}`} tile={tile} small />
            ))}
            {allDiscards.length === 0 && (
              <p className="text-white/20 text-xs self-center">牌河</p>
            )}
          </div>

          {/* Last discard highlight */}
          {lastDiscard && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-white/40">
                {players.find((p) => p.seat === lastDiscard.from)?.name || "?"} 打出:
              </span>
              <div className="ring-2 ring-[#C9A96E] rounded-md">
                <MjTile tile={lastDiscard.tile} />
              </div>
            </div>
          )}

          {/* Turn indicator */}
          {isMyTurn ? (
            <div className="px-4 py-1.5 rounded-full bg-[#C9A96E]/20 border border-[#C9A96E]/40 animate-pulse">
              <p className="text-sm font-bold text-[#f0d68a]">
                {needsDraw ? "輪到你摸牌" : "輪到你打牌"}
              </p>
            </div>
          ) : (
            <p className="text-xs text-white/50">
              等待 {players.find((p) => p.seat === currentTurn)?.name || "..."}
            </p>
          )}

          {/* Action buttons (chi/pong/kong/win from other player's discard) */}
          {hasActions && (
            <div className="flex gap-2 flex-wrap justify-center">
              {availableActions.map((action, i) => (
                <button
                  key={`${action.type}-${i}`}
                  onClick={() => onAction(action.type, action.tiles)}
                  className={`px-4 py-2.5 rounded-xl font-bold text-sm
                    cursor-pointer active:scale-95 transition-all duration-150 min-w-[52px]
                    ${action.type === "win"
                      ? "bg-red-600 text-white shadow-lg shadow-red-600/30 animate-pulse"
                      : "bg-[#C9A96E] text-[#0f2a1a] shadow-md shadow-[#C9A96E]/30"
                    }`}
                >
                  {ActionName(action.type)}
                </button>
              ))}
              <button
                onClick={() => onAction("pass")}
                className="px-4 py-2.5 rounded-xl bg-white/10 text-white font-bold text-sm
                  cursor-pointer active:scale-95 transition-all duration-150 min-w-[52px]"
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
      <div className="pb-safe bg-black/30 backdrop-blur-sm rounded-t-2xl">
        {/* My info bar */}
        <div className="h-7 flex items-center justify-between px-4">
          <span className="text-[10px] text-white/40">
            {playerName}
            {me?.isDealer ? " (莊)" : ""}
            {" · "}
            <span className={`font-bold ${myHand.length <= 3 ? "text-red-400" : "text-[#f0d68a]"}`}>
              {myHand.length}
            </span>
            {" 張"}
          </span>
          {/* My flowers */}
          {me && me.flowers.length > 0 && (
            <div className="flex gap-[2px]">
              {me.flowers.map((f) => (
                <MjTile key={f.id} tile={f} small />
              ))}
            </div>
          )}
        </div>

        {/* My revealed melds */}
        {me && me.revealed.length > 0 && (
          <div className="flex gap-2 justify-center px-4 pb-1">
            {me.revealed.map((meld, mi) => (
              <div key={mi} className="flex gap-[1px]">
                {meld.tiles.map((t) => (
                  <MjTile
                    key={t.id}
                    tile={t}
                    small
                    faceDown={meld.type === "concealed_kong"}
                  />
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Hand */}
        <MjHand
          tiles={myHand}
          canDiscard={needsDiscard}
          onDiscard={onDiscard}
        />

        {/* Bottom action bar */}
        <div className="flex gap-3 px-4 py-3">
          {needsDraw && (
            <button
              onClick={onDraw}
              className="flex-1 py-3 rounded-xl bg-[#C9A96E] text-[#0f2a1a] font-bold text-sm
                         cursor-pointer active:scale-95 transition-all duration-150
                         shadow-md shadow-[#C9A96E]/30"
            >
              摸牌
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
