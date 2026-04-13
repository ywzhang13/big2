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
  drawnTileId: number | null;
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

/** Player info panel for table edges */
function PlayerPanel({
  player,
  position,
  isCurrent,
  windChar,
}: {
  player: MjPlayer | undefined;
  position: "top" | "left" | "right";
  isCurrent: boolean;
  windChar: string;
}) {
  if (!player) return null;

  const isHorizontal = position === "top";
  const tileSize = position === "top" ? 20 : 16;
  const tileH = position === "top" ? 26 : 22;

  return (
    <div className={`flex ${isHorizontal ? "flex-col" : "flex-col"} items-center gap-1.5 transition-all duration-300
      ${isCurrent ? "scale-105" : "opacity-60"}`}>
      {/* Avatar + Name badge */}
      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all duration-300
        ${isCurrent
          ? "bg-gradient-to-r from-[#C9A96E]/30 to-[#e8c97a]/20 border border-[#C9A96E]/50 shadow-lg shadow-[#C9A96E]/10"
          : "bg-black/30 border border-white/10"
        }`}>
        {/* Wind avatar circle */}
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold
          ${isCurrent
            ? "bg-[#C9A96E] text-[#0f2a1a]"
            : "bg-white/10 text-white/60"
          }`}>
          {windChar}
        </div>
        <div className="flex flex-col">
          <span className={`text-xs font-bold truncate max-w-[60px] ${isCurrent ? "text-[#f0d68a]" : "text-white/70"}`}>
            {player.name}
          </span>
          <span className="text-[9px] text-white/30">
            {player.tileCount} 張{player.isDealer ? " · 莊" : ""}
          </span>
        </div>
      </div>

      {/* Face-down tiles */}
      <div className={`flex ${isHorizontal ? "flex-row" : "flex-col"} gap-[1px] items-center`}>
        {Array.from({ length: player.tileCount }).map((_, i) => (
          <div
            key={i}
            className="rounded-[3px]"
            style={{
              width: isHorizontal ? tileSize : tileSize - 2,
              height: isHorizontal ? tileH : tileSize,
              background: "linear-gradient(180deg, #4a8a5a 0%, #2a6038 50%, #1a4828 100%)",
              boxShadow: "0 1px 3px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1)",
              border: "0.5px solid rgba(255,255,255,0.08)",
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

/** Center wind direction dial */
function WindDial({
  currentTurn,
  mySeat,
  wallRemaining,
}: {
  currentTurn: number;
  mySeat: number;
  wallRemaining: number;
}) {
  // Position winds relative to player's seat
  const winds = [0, 1, 2, 3].map((offset) => {
    const seat = (mySeat + offset) % 4;
    return {
      char: WIND_CHARS[seat],
      isActive: seat === currentTurn,
      position: offset, // 0=bottom, 1=right, 2=top, 3=left
    };
  });

  const posStyle = [
    { bottom: "2px", left: "50%", transform: "translateX(-50%)" },     // bottom (me)
    { right: "2px", top: "50%", transform: "translateY(-50%)" },       // right
    { top: "2px", left: "50%", transform: "translateX(-50%)" },        // top
    { left: "2px", top: "50%", transform: "translateY(-50%)" },        // left
  ];

  return (
    <div className="relative w-[80px] h-[80px] rounded-lg bg-black/40 border border-[#C9A96E]/30
      shadow-inner flex items-center justify-center">
      {/* Remaining count */}
      <div className="flex flex-col items-center">
        <span className="text-lg font-bold text-[#f0d68a] font-heading">{wallRemaining}</span>
        <span className="text-[8px] text-white/30">剩餘</span>
      </div>
      {/* Wind markers */}
      {winds.map((w) => (
        <div
          key={w.position}
          className={`absolute text-[11px] font-bold transition-all duration-300 px-1
            ${w.isActive
              ? "text-[#f0d68a] scale-125 drop-shadow-[0_0_4px_rgba(240,214,138,0.5)]"
              : "text-white/25"
            }`}
          style={posStyle[w.position] as React.CSSProperties}
        >
          {w.char}
        </div>
      ))}
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
  drawnTileId,
  onDraw,
  onDiscard,
  onAction,
}: MjBoardProps) {
  const getOpponent = (offset: number) => {
    const seat = (mySeat + offset) % 4;
    return players.find((p) => p.seat === seat);
  };

  const top = getOpponent(2);
  const left = getOpponent(3);
  const right = getOpponent(1);
  const me = players.find((p) => p.seat === mySeat);

  const hasActions = availableActions.length > 0;

  const getWindChar = (seat: number) => WIND_CHARS[seat] || "?";

  return (
    <div className="mj-landscape flex flex-col flex-1 overflow-hidden relative"
         style={{
           minHeight: "100dvh",
           background: "radial-gradient(ellipse at center, #1a3f25 0%, #0f2a1a 60%, #091a10 100%)",
         }}>

      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-black/30 border-b border-[#C9A96E]/20">
        <button
          onClick={() => window.location.href = "/mahjong"}
          className="text-white/50 text-xs hover:text-white/80 cursor-pointer transition-colors"
        >
          離開
        </button>
        <h1 className="text-[#C9A96E] font-bold text-sm tracking-wider font-heading">
          台灣麻將
        </h1>
        <div className="flex items-center gap-2 text-[10px] text-white/40">
          {isMyTurn && (
            <span className="text-[#f0d68a] font-bold animate-pulse text-xs">
              {needsDraw ? "摸牌" : "打牌"}
            </span>
          )}
        </div>
      </div>

      {/* Top opponent */}
      <div className="flex justify-center px-4 py-2">
        <PlayerPanel
          player={top}
          position="top"
          isCurrent={top?.seat === currentTurn}
          windChar={getWindChar(top?.seat ?? 2)}
        />
      </div>

      {/* Middle row: left | table | right */}
      <div className="flex-1 flex items-stretch px-2 min-h-0">
        {/* Left */}
        <div className="w-[80px] flex-shrink-0 flex items-center justify-center">
          <PlayerPanel
            player={left}
            position="left"
            isCurrent={left?.seat === currentTurn}
            windChar={getWindChar(left?.seat ?? 3)}
          />
        </div>

        {/* Center table area */}
        <div className="flex-1 flex flex-col items-center justify-center gap-2 min-h-0 overflow-hidden">
          {/* Table surface with wood-frame border — 30% larger */}
          <div className="relative w-full max-w-[624px] max-h-[416px] rounded-xl overflow-hidden"
            style={{
              aspectRatio: "3 / 2",
              background: "linear-gradient(145deg, #1e4a2e 0%, #153a22 50%, #0f2a1a 100%)",
              border: "3px solid #8B6914",
              boxShadow: "0 0 0 1px #5a4510, 0 0 0 5px #3a2a08, 0 8px 32px rgba(0,0,0,0.5), inset 0 2px 20px rgba(0,0,0,0.3)",
            }}>

            {/* 4-sided discard pool: compact grid layout */}
            <div className="absolute inset-0 flex flex-col p-2">
              {/* Top discards (8 per row, max 2 rows) */}
              <div className="flex flex-wrap justify-center gap-[1px] mx-auto overflow-hidden"
                style={{ maxWidth: 256, maxHeight: 48 }}>
                {(top?.discards || []).slice(-16).map((t, i) => (
                  <MjTile key={`top-${t.id}-${i}`} tile={t} small />
                ))}
              </div>

              {/* Middle: left | center | right */}
              <div className="flex-1 flex items-center min-h-0">
                {/* Left discards (vertical columns, 6 per column, newest on right) */}
                <div className="flex-shrink-0 flex gap-[2px] items-center overflow-hidden"
                  style={{ maxWidth: 100 }}>
                  {(() => {
                    const tiles = (left?.discards || []).slice(-12);
                    const cols: typeof tiles[] = [];
                    for (let i = 0; i < tiles.length; i += 6) {
                      cols.push(tiles.slice(i, i + 6));
                    }
                    return cols.map((col, ci) => (
                      <div key={ci} className="flex flex-col gap-[1px]">
                        {col.map((t, ti) => (
                          <MjTile key={`left-${t.id}-${ti}`} tile={t} small />
                        ))}
                      </div>
                    ));
                  })()}
                </div>

                {/* Center: wind dial + last discard */}
                <div className="flex-1 flex flex-col items-center justify-center gap-1">
                  <WindDial currentTurn={currentTurn} mySeat={mySeat} wallRemaining={wallRemaining} />
                  {lastDiscard && (
                    <div className="flex items-center gap-1.5 bg-black/40 px-2 py-1 rounded-lg border border-[#C9A96E]/30">
                      <span className="text-[9px] text-white/40">
                        {players.find(p => p.seat === lastDiscard.from)?.name}
                      </span>
                      <div className="ring-2 ring-[#C9A96E]/60 rounded shadow-lg shadow-[#C9A96E]/20">
                        <MjTile tile={lastDiscard.tile} small />
                      </div>
                    </div>
                  )}
                </div>

                {/* Right discards (vertical columns, 6 per column, newest on left towards center) */}
                <div className="flex-shrink-0 flex flex-row-reverse gap-[2px] items-center overflow-hidden"
                  style={{ maxWidth: 100 }}>
                  {(() => {
                    const tiles = (right?.discards || []).slice(-12);
                    const cols: typeof tiles[] = [];
                    for (let i = 0; i < tiles.length; i += 6) {
                      cols.push(tiles.slice(i, i + 6));
                    }
                    return cols.map((col, ci) => (
                      <div key={ci} className="flex flex-col gap-[1px]">
                        {col.map((t, ti) => (
                          <MjTile key={`right-${t.id}-${ti}`} tile={t} small />
                        ))}
                      </div>
                    ));
                  })()}
                </div>
              </div>

              {/* Bottom discards (8 per row, max 2 rows) */}
              <div className="flex flex-wrap justify-center gap-[1px] mx-auto overflow-hidden"
                style={{ maxWidth: 256, maxHeight: 48 }}>
                {(me?.discards || []).slice(-16).map((t, i) => (
                  <MjTile key={`me-${t.id}-${i}`} tile={t} small />
                ))}
              </div>
            </div>
          </div>

          {/* Turn status */}
          <div className="text-center">
            {isMyTurn ? (
              <span className="text-[#f0d68a] font-bold text-sm animate-pulse">
                {needsDraw ? "輪到你摸牌" : "輪到你打牌"}
              </span>
            ) : (
              <span className="text-white/40 text-xs">
                等待 {players.find((p) => p.seat === currentTurn)?.name || "..."}
              </span>
            )}
          </div>

          {/* Action buttons (碰/槓/胡/過) */}
          {hasActions && (
            <div className="flex gap-2 justify-center">
              {availableActions.map((action, i) => (
                <button
                  key={`${action.type}-${i}`}
                  onClick={() => onAction(action.type, action.tiles)}
                  className={`px-5 py-2 rounded-xl font-bold text-sm
                    cursor-pointer active:scale-95 transition-all duration-150 shadow-lg
                    ${action.type === "win"
                      ? "bg-gradient-to-r from-red-600 to-red-500 text-white animate-pulse shadow-red-500/30"
                      : "bg-gradient-to-r from-[#C9A96E] to-[#e8c97a] text-[#0f2a1a] shadow-[#C9A96E]/20"
                    }`}
                >
                  {ActionName(action.type)}
                </button>
              ))}
              <button
                onClick={() => onAction("pass")}
                className="px-5 py-2 rounded-xl bg-white/10 text-white/70 font-bold text-sm border border-white/10
                  cursor-pointer active:scale-95 transition-all duration-150"
              >
                過
              </button>
            </div>
          )}
        </div>

        {/* Right */}
        <div className="w-[80px] flex-shrink-0 flex items-center justify-center">
          <PlayerPanel
            player={right}
            position="right"
            isCurrent={right?.seat === currentTurn}
            windChar={getWindChar(right?.seat ?? 1)}
          />
        </div>
      </div>

      {/* Bottom: my area */}
      <div className="pb-safe" style={{
        background: "linear-gradient(180deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.4) 100%)",
        borderTop: "1px solid rgba(201,169,110,0.15)",
      }}>
        {/* My info bar */}
        <div className="flex items-center gap-3 px-3 py-1.5 border-b border-white/5">
          {/* Wind avatar */}
          <div className="w-7 h-7 rounded-full bg-[#C9A96E] text-[#0f2a1a] flex items-center justify-center text-xs font-bold">
            {getWindChar(mySeat)}
          </div>
          <span className="text-xs text-[#f0d68a] font-bold">{playerName}</span>
          {me?.isDealer && <span className="text-[9px] text-[#C9A96E] bg-[#C9A96E]/15 px-1.5 py-0.5 rounded">莊</span>}
          <span className="text-[10px] text-white/30 ml-auto">{myHand.length} 張</span>

          {/* Flowers */}
          {me && me.flowers.length > 0 && (
            <div className="flex gap-[2px] items-center ml-2">
              {me.flowers.map((f) => (
                <MjTile key={f.id} tile={f} small />
              ))}
            </div>
          )}

          {/* Revealed melds */}
          {me && me.revealed.length > 0 && (
            <div className="flex gap-2 items-center ml-2">
              {me.revealed.map((meld, mi) => (
                <div key={mi} className="flex gap-[1px]">
                  {meld.tiles.map((t) => (
                    <MjTile key={t.id} tile={t} small faceDown={meld.type === "concealed_kong"} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Hand + draw button */}
        <div className="flex items-end px-1 py-1.5 gap-2">
          <div className="flex-1 min-w-0">
            <MjHand tiles={myHand} canDiscard={needsDiscard} onDiscard={onDiscard} drawnTileId={drawnTileId ?? undefined} />
          </div>
        </div>
      </div>
    </div>
  );
}
