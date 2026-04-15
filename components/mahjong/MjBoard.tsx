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
  actionNotice: { seat: number; type: string } | null;
  onDraw: () => void;
  onDiscard: (tileId: number) => void;
  onAction: (type: string, tiles?: Tile[]) => void;
  dice?: [number, number, number];
  doorSeat?: number;
  playerScores?: number[];
  dealerConsecutive?: number;
}

const WIND_CHARS = ["東", "南", "西", "北"];

/** Single die face (1-6) rendered with pips */
function DieFace({ value, size = 22 }: { value: number; size?: number }) {
  const dot = (
    <div
      style={{
        width: Math.max(3, size * 0.18),
        height: Math.max(3, size * 0.18),
        borderRadius: "50%",
        background: "radial-gradient(circle at 30% 30%, #7f1d1d 0%, #450a0a 100%)",
        boxShadow: "inset 0 1px 1px rgba(0,0,0,0.4)",
      }}
    />
  );
  // Pip positions for values 1-6 using a 3x3 grid
  const pipMap: Record<number, boolean[]> = {
    1: [false, false, false, false, true, false, false, false, false],
    2: [true, false, false, false, false, false, false, false, true],
    3: [true, false, false, false, true, false, false, false, true],
    4: [true, false, true, false, false, false, true, false, true],
    5: [true, false, true, false, true, false, true, false, true],
    6: [true, false, true, true, false, true, true, false, true],
  };
  const pips = pipMap[value] || pipMap[1];
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(3, size * 0.18),
        background: "linear-gradient(145deg, #fefcf5 0%, #f1e9cf 100%)",
        border: "1px solid rgba(140,110,60,0.5)",
        boxShadow: "0 2px 4px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.8), inset 0 -1px 1px rgba(120,90,40,0.3)",
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gridTemplateRows: "1fr 1fr 1fr",
        padding: Math.max(1, size * 0.1),
        gap: Math.max(1, size * 0.04),
      }}
    >
      {pips.map((show, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          {show && dot}
        </div>
      ))}
    </div>
  );
}

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
  score,
}: {
  player: MjPlayer | undefined;
  position: "top" | "left" | "right";
  isCurrent: boolean;
  windChar: string;
  score?: number;
}) {
  if (!player) return null;

  const isHorizontal = position === "top";
  const tileSize = position === "top" ? 20 : 16;
  const tileH = position === "top" ? 26 : 22;

  // For left/right: layout is horizontal row with hand on outside, melds towards center
  // Each tile rotated 90° to face center
  const rotStyle = position === "left" ? "rotate(90deg)" : position === "right" ? "rotate(-90deg)" : undefined;

  return (
    <div className={`flex ${isHorizontal ? "flex-col" : position === "left" ? "flex-row" : "flex-row-reverse"} items-center gap-1.5 transition-all duration-300
      ${isCurrent ? "scale-105" : "opacity-60"}`}>
      {/* Avatar + Name badge */}
      <div className={`flex items-center gap-2 px-2 py-1 rounded-xl transition-all duration-300
        ${isCurrent
          ? "bg-gradient-to-r from-[#C9A96E]/30 to-[#e8c97a]/20 border border-[#C9A96E]/50 shadow-lg shadow-[#C9A96E]/10"
          : "bg-black/30 border border-white/10"
        }`}>
        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold
          ${isCurrent ? "bg-[#C9A96E] text-[#0f2a1a]" : "bg-white/10 text-white/60"}`}>
          {windChar}
        </div>
        <div className="flex flex-col">
          <span className={`text-[10px] font-bold truncate max-w-[50px] ${isCurrent ? "text-[#f0d68a]" : "text-white/70"}`}>
            {player.name}
          </span>
          <span className="text-[8px] text-white/30">
            {player.tileCount} 張{player.isDealer ? " · 莊" : ""}
          </span>
          {score != null && (
            <span className={`text-[9px] font-bold leading-tight ${
              score > 0 ? "text-green-400" : score < 0 ? "text-red-400" : "text-white/40"
            }`}>
              {score > 0 ? "+" : ""}{score}
            </span>
          )}
        </div>
      </div>

      {/* Face-down tiles (outside edge) */}
      <div className={`flex ${isHorizontal ? "flex-row" : "flex-col"} gap-[1px] items-center`}>
        {Array.from({ length: player.tileCount }).map((_, i) => (
          <div
            key={i}
            className="rounded-[2px]"
            style={{
              width: isHorizontal ? tileSize - 2 : tileH - 6,
              height: isHorizontal ? tileH - 4 : tileSize - 4,
              background: "linear-gradient(180deg, #4a8a5a 0%, #2a6038 50%, #1a4828 100%)",
              boxShadow: "0 1px 3px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1)",
              border: "0.5px solid rgba(255,255,255,0.08)",
              ...(rotStyle ? { transform: rotStyle } : {}),
            }}
          />
        ))}
      </div>

      {/* Flowers + Revealed melds (closer to center for left/right) */}
      {(player.flowers.length > 0 || player.revealed.length > 0) && (
        <div
          className={`flex ${isHorizontal ? "flex-row" : "flex-col"} items-center`}
          // Inter-meld gap: 10px for both top and left/right
          style={{ gap: 10 }}
        >
          {/* Each meld is a tight group */}
          {player.revealed.map((meld, mi) => (
            <div
              key={mi}
              className={`flex ${isHorizontal ? "flex-row" : "flex-col"}`}
              // Intra-group:
              //   top: 1px (reduced 50% from 3px per user request)
              //   left/right: 0 (tight — tile wrappers handle overlap via negative margin)
              style={{
                gap: isHorizontal ? 1 : 0,
                border: "1px solid rgba(0,0,0,0.5)",
                borderRadius: 4,
                padding: 2,
                background: "rgba(0,0,0,0.35)",
                boxShadow: "inset 0 1px 2px rgba(0,0,0,0.4)",
              }}
            >
              {meld.tiles.map((t) => (
                <div
                  key={t.id}
                  style={
                    rotStyle
                      ? {
                          transform: rotStyle,
                          // Intra-group overlap — -10 keeps tiles tight but separate
                          marginTop: isHorizontal ? 0 : -6,
                        }
                      : undefined
                  }
                >
                  <MjTile tile={t} tiny faceDown={meld.type === "concealed_kong"} />
                </div>
              ))}
            </div>
          ))}
          {/* Flowers as a group */}
          {player.flowers.length > 0 && (
            <div className={`flex ${isHorizontal ? "flex-row" : "flex-col"}`} style={{ gap: isHorizontal ? 1 : 0 }}>
              {player.flowers.map((f) => (
                <div
                  key={f.id}
                  style={
                    rotStyle
                      ? {
                          transform: rotStyle,
                          // Intra-group overlap — -10 keeps tiles tight but separate
                          marginTop: isHorizontal ? 0 : -6,
                        }
                      : undefined
                  }
                >
                  <MjTile tile={f} tiny />
                </div>
              ))}
            </div>
          )}
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
  doorSeat,
}: {
  currentTurn: number;
  mySeat: number;
  wallRemaining: number;
  doorSeat?: number;
}) {
  // Position winds relative to player's seat
  const winds = [0, 1, 2, 3].map((offset) => {
    const seat = (mySeat + offset) % 4;
    return {
      char: WIND_CHARS[seat],
      isActive: seat === currentTurn,
      isDoor: doorSeat != null && seat === doorSeat,
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
    <div className="relative w-[72px] h-[72px] rounded-xl flex items-center justify-center"
      style={{
        background: "radial-gradient(circle, rgba(201,169,110,0.08) 0%, rgba(0,0,0,0.3) 100%)",
        border: "1.5px solid rgba(201,169,110,0.25)",
        boxShadow: "inset 0 0 12px rgba(0,0,0,0.3)",
      }}>
      {/* Remaining count */}
      <div className="flex flex-col items-center">
        <span className="text-xl font-bold text-[#f0d68a]" style={{ textShadow: "0 0 8px rgba(240,214,138,0.3)" }}>
          {wallRemaining}
        </span>
        <span className="text-[7px] text-[#C9A96E]/50 tracking-wider">剩餘</span>
      </div>
      {/* Wind markers */}
      {winds.map((w) => (
        <div
          key={w.position}
          className={`absolute flex items-center gap-[2px] text-[10px] font-bold transition-all duration-300
            ${w.isActive
              ? "text-[#f0d68a] scale-110"
              : w.isDoor
                ? "text-[#dc2626]"
                : "text-white/20"
            }`}
          style={{
            ...posStyle[w.position] as React.CSSProperties,
            ...(w.isActive ? { textShadow: "0 0 6px rgba(240,214,138,0.6)" } : {}),
            ...(w.isDoor && !w.isActive ? { textShadow: "0 0 6px rgba(220,38,38,0.7)" } : {}),
          }}
        >
          {w.isDoor && <span className="text-[7px] font-black" style={{ color: "#dc2626" }}>門</span>}
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
  actionNotice,
  onDraw,
  onDiscard,
  onAction,
  dice,
  doorSeat,
  playerScores,
  dealerConsecutive,
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
           height: "100%",
           maxHeight: "100%",
           background: "radial-gradient(ellipse at center, #1a3f25 0%, #0f2a1a 60%, #091a10 100%)",
         }}>

      {/* Top opponent */}
      <div className="flex justify-center px-4 py-2">
        <PlayerPanel
          player={top}
          position="top"
          isCurrent={top?.seat === currentTurn}
          windChar={getWindChar(top?.seat ?? 2)}
          score={top && playerScores ? playerScores[top.seat] : undefined}
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
            score={left && playerScores ? playerScores[left.seat] : undefined}
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

            {/* 4-sided discard pool using tiny tiles — no overflow hidden */}
            <div className="absolute inset-0 flex flex-col p-3">
              {/* Top discards — top player faces down, so their right is
                  screen LEFT. Row-reverse + justify-start puts first tile at
                  screen RIGHT and grows leftward (toward their right). */}
              <div className="flex flex-wrap flex-row-reverse justify-start gap-[1px] mx-auto" style={{ maxWidth: 312 }}>
                {(top?.discards || []).map((t, i) => (
                  <MjTile key={`top-${t.id}-${i}`} tile={t} tiny />
                ))}
              </div>

              {/* Middle: left | center | right */}
              <div className="flex-1 flex items-center min-h-0">
                {/* Left discards — left player faces right, so their right is
                    screen UP. Each column fills bottom→top (flex-col-reverse). */}
                <div className="flex-shrink-0 flex flex-row-reverse gap-[1px] items-end" style={{ maxWidth: 130 }}>
                  {(() => {
                    const tiles = (left?.discards || []);
                    const cols: typeof tiles[] = [];
                    for (let i = 0; i < tiles.length; i += 5) {
                      cols.push(tiles.slice(i, i + 5));
                    }
                    return cols.map((col, ci) => (
                      <div key={ci} className="flex flex-col-reverse gap-[1px]">
                        {col.map((t, ti) => (
                          <div key={`left-${t.id}-${ti}`} style={{ transform: "rotate(90deg)", width: 29, height: 29 }}>
                            <MjTile tile={t} tiny />
                          </div>
                        ))}
                      </div>
                    ));
                  })()}
                </div>

                {/* Center: wind dial + last discard */}
                <div className="flex-1 flex flex-col items-center justify-center gap-2">
                  <WindDial currentTurn={currentTurn} mySeat={mySeat} wallRemaining={wallRemaining} doorSeat={doorSeat} />
                  {/* 連莊 badge — show when dealer is on streak */}
                  {dealerConsecutive && dealerConsecutive > 0 && (
                    <div
                      className="px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider"
                      style={{
                        background: "linear-gradient(90deg, rgba(220,38,38,0.35) 0%, rgba(201,169,110,0.35) 100%)",
                        border: "1px solid rgba(240,214,138,0.45)",
                        color: "#fff8dc",
                        textShadow: "0 0 8px rgba(255,140,0,0.5)",
                      }}
                    >
                      連{dealerConsecutive} · 拉{dealerConsecutive}
                    </div>
                  )}
                  {/* Dice (骰子開門) — shown below wind dial when no lastDiscard */}
                  {dice && !lastDiscard && (
                    <div className="flex flex-col items-center gap-1">
                      <div className="flex gap-1">
                        <DieFace value={dice[0]} size={20} />
                        <DieFace value={dice[1]} size={20} />
                        <DieFace value={dice[2]} size={20} />
                      </div>
                      <span className="text-[9px] text-[#C9A96E]/60 font-bold tracking-wider">
                        {dice[0] + dice[1] + dice[2]} 點開門
                      </span>
                    </div>
                  )}
                  {lastDiscard && (
                    <div className="flex flex-col items-center gap-1">
                      <div className="rounded-lg overflow-hidden shadow-xl"
                        style={{
                          boxShadow: "0 4px 20px rgba(0,0,0,0.4), 0 0 0 2px rgba(201,169,110,0.3)",
                        }}>
                        <MjTile tile={lastDiscard.tile} />
                      </div>
                      <span className="text-[9px] text-[#C9A96E]/60 font-bold">
                        {players.find(p => p.seat === lastDiscard.from)?.name}
                      </span>
                    </div>
                  )}
                </div>

                {/* Right discards — right player faces left, so their right is
                    screen DOWN. Each column fills top→down (default flex-col). */}
                <div className="flex-shrink-0 flex flex-row gap-[1px] items-start" style={{ maxWidth: 130 }}>
                  {(() => {
                    const tiles = (right?.discards || []);
                    const cols: typeof tiles[] = [];
                    for (let i = 0; i < tiles.length; i += 5) {
                      cols.push(tiles.slice(i, i + 5));
                    }
                    return cols.map((col, ci) => (
                      <div key={ci} className="flex flex-col gap-[1px]">
                        {col.map((t, ti) => (
                          <div key={`right-${t.id}-${ti}`} style={{ transform: "rotate(-90deg)", width: 29, height: 29 }}>
                            <MjTile tile={t} tiny />
                          </div>
                        ))}
                      </div>
                    ));
                  })()}
                </div>
              </div>

              {/* Bottom (me) discards — I face up, my right is screen RIGHT.
                  justify-start puts first tile at screen left, new tiles
                  appended to the right (toward my right side). */}
              <div className="flex flex-wrap justify-start gap-[1px] mx-auto" style={{ maxWidth: 312 }}>
                {(me?.discards || []).map((t, i) => (
                  <MjTile key={`me-${t.id}-${i}`} tile={t} tiny />
                ))}
              </div>
            </div>
          </div>

          {/* Action notice animation (碰!/吃!/槓!) */}
          {actionNotice && (
            <div className="flex items-center justify-center gap-2 animate-bounce">
              <span className="px-4 py-2 rounded-xl bg-[#C9A96E] text-[#0f2a1a] font-bold text-lg shadow-lg shadow-[#C9A96E]/30">
                {players.find(p => p.seat === actionNotice.seat)?.name}
                {" "}
                {ActionName(actionNotice.type)}！
              </span>
            </div>
          )}

          {/* Turn status */}
          <div className="text-center">
            {(() => {
              const iJustDiscarded = lastDiscard != null && lastDiscard.from === mySeat && currentTurn === mySeat;
              if (iJustDiscarded) {
                return <span className="text-white/40 text-xs">等待其他玩家...</span>;
              }
              if (isMyTurn) {
                return (
                  <span className="text-[#f0d68a] font-bold text-sm animate-pulse">
                    {needsDraw ? "輪到你摸牌" : "輪到你打牌"}
                  </span>
                );
              }
              return (
                <span className="text-white/40 text-xs">
                  等待 {players.find((p) => p.seat === currentTurn)?.name || "..."}
                </span>
              );
            })()}
          </div>

          {/* Action buttons (碰/槓/胡/過) */}
          {hasActions && (
            <div className="flex gap-2 justify-center flex-wrap">
              {availableActions.map((action, i) => (
                <button
                  key={`${action.type}-${i}`}
                  onClick={() => onAction(action.type, action.tiles)}
                  className={`px-3 py-2 rounded-xl font-bold text-sm
                    cursor-pointer active:scale-95 transition-all duration-150 shadow-lg
                    flex items-center gap-1.5
                    ${action.type === "win"
                      ? "bg-gradient-to-r from-red-600 to-red-500 text-white animate-pulse shadow-red-500/30"
                      : "bg-gradient-to-r from-[#C9A96E] to-[#e8c97a] text-[#0f2a1a] shadow-[#C9A96E]/20"
                    }`}
                >
                  <span>{ActionName(action.type)}</span>
                  {/* Show the chi tile pair so multiple chi options are distinguishable */}
                  {action.type === "chi" && action.tiles && (
                    <span className="flex gap-[1px]">
                      {action.tiles.map((t) => (
                        <MjTile key={t.id} tile={t} tiny />
                      ))}
                    </span>
                  )}
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
            score={right && playerScores ? playerScores[right.seat] : undefined}
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
          {playerScores && mySeat >= 0 && (
            <span className={`text-[11px] font-bold ${
              playerScores[mySeat] > 0 ? "text-green-400" :
              playerScores[mySeat] < 0 ? "text-red-400" : "text-white/40"
            }`}>
              {playerScores[mySeat] > 0 ? "+" : ""}{playerScores[mySeat]}
            </span>
          )}
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

        {/* Hand — extra top padding for selected tile float */}
        <div className="flex items-end px-1 pt-4 pb-1.5 gap-2">
          <div className="flex-1 min-w-0">
            <MjHand tiles={myHand} canDiscard={needsDiscard} onDiscard={onDiscard} drawnTileId={drawnTileId ?? undefined} />
          </div>
        </div>
      </div>
    </div>
  );
}
