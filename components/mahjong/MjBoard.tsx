"use client";

import { useState } from "react";
import type { Tile } from "@/lib/mahjong/tiles";
import type { Meld } from "@/lib/mahjong/gameState";
import type { MjPlayer, MjOpponentHand } from "@/hooks/useMahjong";
import MjTile from "./MjTile";
import MjHand from "./MjHand";
import { MigiFx } from "./MjBoardMobile";
import { seatWindChar } from "./seatWind";

export interface MjBoardProps {
  players: MjPlayer[];
  mySeat: number;
  myHand: Tile[];
  currentTurn: number;
  dealerSeat: number;
  lastDiscard: { tile: Tile; from: number } | null;
  availableActions: { type: string; tiles?: Tile[] }[];
  pendingAddKong: { seat: number; tile: Tile } | null;
  robKong: boolean;
  pendingFlowerRob: { robberSeat: number; fromSeat: number; tile: Tile } | null;
  robFlower: boolean;
  tingSeats: number[];
  eyeSeats: number[];
  eyeOptions: number[]; // 這次打牌可以一起宣告眼牌的牌
  eyeWithTing: boolean;
  opponentHands: MjOpponentHand[] | null; // 我眼牌時才有
  declareFx: { seat: number; both: boolean }[]; // 正在播宣告特效的座位
  wallRemaining: number;
  hasDrawn: boolean;
  needsDraw: boolean;
  needsDiscard: boolean;
  isMyTurn: boolean;
  playerName: string;
  drawnTileId: number | null;
  actionNotice: { seat: number; type: string } | null;
  onDraw: () => void;
  onDiscard: (tileId: number, declareEye?: boolean) => void;
  onAction: (type: string, tiles?: Tile[]) => void;
  dice?: [number, number, number];
  doorSeat?: number;
  playerScores?: number[];
  dealerConsecutive?: number;
}

/** 已宣告地聽的標示（小宜規格的聽牌標）；pop＝宣告特效期間彈入 */
function TingTag({ pop }: { pop?: boolean }) {
  return (
    <span
      className={`px-1.5 py-[1px] rounded-full text-[9px] font-black leading-none ${pop ? "mjm-pop" : ""}`}
      style={{
        background: "linear-gradient(135deg, #059669, #34d399)",
        color: "#042f1f",
        border: "1px solid rgba(167,243,208,0.7)",
        whiteSpace: "nowrap",
      }}
    >
      聽
    </span>
  );
}

/** 已宣告眼牌的標示（小宜眼牌 v3） */
function EyeTag({ pop }: { pop?: boolean }) {
  return (
    <span
      className={`px-1.5 py-[1px] rounded-full text-[9px] font-black leading-none ${pop ? "mjm-pop" : ""}`}
      style={{
        background: "linear-gradient(135deg, #7c3aed, #c4b5fd)",
        color: "#2b0f55",
        border: "1px solid rgba(233,213,255,0.8)",
        whiteSpace: "nowrap",
      }}
    >
      眼
    </span>
  );
}

/** MIGI（＝地聽）的標示：第一輪宣告眼牌同時成立地聽時，取代「聽」＋「眼」（小宜眼牌 v5：放大加光暈） */
function MigiTag({ pop }: { pop?: boolean }) {
  return (
    <span
      className={`rounded-full font-black leading-none ${pop ? "mjm-pop" : ""}`}
      style={{
        background: "linear-gradient(135deg, #059669, #34d399)",
        color: "#042f1f",
        border: "1px solid rgba(209,250,229,0.95)",
        boxShadow: "0 0 10px rgba(52,211,153,0.55)",
        fontSize: 11,
        padding: "3px 7px",
        letterSpacing: ".06em",
        fontFamily: '"Chakra Petch", system-ui, sans-serif',
        whiteSpace: "nowrap",
      }}
    >
      MIGI
    </span>
  );
}

/** 聽／眼標示：地聽＋眼牌＝只顯示 MIGI；只有眼牌＝眼；只有地聽（舊牌局）＝聽 */
function DeclareTags({ ting, eye, fx }: { ting?: boolean; eye?: boolean; fx?: { both: boolean } }) {
  if (ting && eye) return <MigiTag pop={!!fx} />;
  if (eye) return <EyeTag pop={!!fx} />;
  if (ting) return <TingTag pop={!!fx} />;
  return null;
}

/** 名牌宣告特效：只有一般眼牌在名牌上播紫色彈一下 0.9 秒；MIGI 改播牌桌中央的大特效（MigiFx） */
function fxClass(fx?: { both: boolean }) {
  return fx && !fx.both ? "mjm-declare mjm-dc-eye" : "";
}

/** 眼牌者看到的手牌：摸進的那張排最後一張 */
function eyeHandTiles(h: MjOpponentHand): { tile: Tile; drew: boolean }[] {
  const drew = h.drawnTileId != null ? h.hand.find((t) => t.id === h.drawnTileId) : undefined;
  return [...h.hand.filter((t) => t !== drew).map((tile) => ({ tile, drew: false })), ...(drew ? [{ tile: drew, drew: true }] : [])];
}

const DREW_RING = { borderRadius: 3, boxShadow: "0 0 0 2px #fbbf24, 0 0 10px rgba(251,191,36,.45)" };

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
    concealed_kong: "暗槓",
    add_kong: "加槓",
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
  dealerConsecutive,
  isTing,
  isEye,
  fx,
  opponent,
}: {
  player: MjPlayer | undefined;
  position: "top" | "left" | "right";
  isCurrent: boolean;
  windChar: string;
  score?: number;
  dealerConsecutive?: number;
  isTing?: boolean;
  isEye?: boolean;
  fx?: { both: boolean }; // 正在播宣告特效
  opponent?: MjOpponentHand; // 我眼牌時：這家的牌面（暗槓翻開）
}) {
  if (!player) return null;

  const isHorizontal = position === "top";
  const tileSize = position === "top" ? 20 : 16;
  const tileH = position === "top" ? 26 : 22;

  // For left/right: layout is horizontal row with hand on outside, melds towards center
  // Each tile rotated 90° to face center
  const rotStyle = position === "left" ? "rotate(90deg)" : position === "right" ? "rotate(-90deg)" : undefined;
  // 吃碰槓／花的牌：平常 26×35；我眼牌時縮成 20×27，讓翻開的手牌（26×35）是這一區最大的牌
  const mw = opponent ? 20 : 26;
  const mh = opponent ? 27 : 35;

  return (
    <div className={`flex ${isHorizontal ? "flex-col" : position === "left" ? "flex-row" : "flex-row-reverse"} items-center gap-1.5 transition-all duration-300
      ${isCurrent ? "scale-105" : "opacity-60"}`}>
      {/* Avatar + Name badge */}
      <div className={`flex items-center gap-2 px-2 py-1 rounded-xl transition-all duration-300 ${fxClass(fx)}
        ${isCurrent
          ? "bg-gradient-to-r from-[#C9A96E]/30 to-[#e8c97a]/20 border border-[#C9A96E]/50 shadow-lg shadow-[#C9A96E]/10"
          : "bg-black/30 border border-white/10"
        }`}>
        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold
          ${isCurrent ? "bg-[#C9A96E] text-[#0f2a1a]" : "bg-white/10 text-white/60"}`}>
          {windChar}
        </div>
        <div className={`flex flex-col ${isHorizontal ? "" : "max-w-[64px]"}`}>
          {(() => {
            // 標示順序：連N → 聽 → 眼。對家放在名字同一行；左右家換到名字下一行（名牌寬度固定，不被畫面邊緣切掉）
            const tags = (
              <>
                {/* 連N pill — inline, no absolute positioning so it never clips against viewport edges. */}
                {player.isDealer && !!dealerConsecutive && dealerConsecutive > 0 && (
                  <span
                    className="px-1 py-[1px] rounded-full text-[8px] font-black tracking-wider"
                    style={{
                      background: "linear-gradient(135deg, #dc2626 0%, #C9A96E 100%)",
                      color: "#fff8dc",
                      border: "1px solid rgba(240,214,138,0.6)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    連{dealerConsecutive}
                  </span>
                )}
                <DeclareTags ting={isTing} eye={isEye} fx={fx} />
              </>
            );
            const name = (
              <span className={`text-[10px] font-bold truncate max-w-[50px] ${isCurrent ? "text-[#f0d68a]" : "text-white/70"}`}>
                {player.name}
              </span>
            );
            return isHorizontal ? (
              <div className="flex items-center gap-1">{name}{tags}</div>
            ) : (
              <>
                {name}
                {(isTing || isEye || (player.isDealer && !!dealerConsecutive)) && (
                  <div className="flex items-center gap-1 flex-wrap">{tags}</div>
                )}
              </>
            );
          })()}
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

      {/* 眼牌者：這家的手牌翻開，比吃碰槓大（26×35；左右家旋轉，摸進的那張最後＋金框） */}
      {opponent ? (
        <div className={`flex ${isHorizontal ? "flex-row" : "flex-col"} gap-[1px] items-center`}>
          {eyeHandTiles(opponent).map(({ tile, drew }) =>
            isHorizontal ? (
              <div key={tile.id} style={drew ? { marginLeft: 6, ...DREW_RING } : undefined}>
                <MjTile tile={tile} width={26} height={35} />
              </div>
            ) : (
              <div key={tile.id} style={{ width: 37, height: 27, display: "flex", alignItems: "center", justifyContent: "center", gap: 0 }}>
                <div style={{ transform: rotStyle, ...(drew ? DREW_RING : {}) }}>
                  <MjTile tile={tile} width={26} height={35} />
                </div>
              </div>
            )
          )}
        </div>
      ) : (
      /* Face-down tiles (outside edge) */
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
      )}

      {/* Flowers + Revealed melds — same visual spec for all three opponents:
          1px gap inside each meld, 10px gap between melds, thin bordered
          group background. Left/right rotate each tile to face center; to
          stop rotation from fighting flex layout we wrap each rotated tile
          in a swapped-dim container (35×26) so the column packs cleanly. */}
      {(player.flowers.length > 0 || (opponent?.revealed ?? player.revealed).length > 0) && (
        <div
          className={`flex ${isHorizontal ? "flex-row" : "flex-col"} items-center`}
          style={{ gap: 10 }}
        >
          {(opponent?.revealed ?? player.revealed).map((meld, mi) => (
            <div
              key={mi}
              className={`flex ${isHorizontal ? "flex-row" : "flex-col"}`}
              style={{
                gap: 1,
                border: "1px solid rgba(0,0,0,0.5)",
                borderRadius: 4,
                padding: 2,
                background: "rgba(0,0,0,0.35)",
                boxShadow: "inset 0 1px 2px rgba(0,0,0,0.4)",
              }}
            >
              {meld.tiles.map((t, ti) => {
                // 暗槓：對家無法看牌面，全部 4 張面朝下。自己的暗槓顯示
                // 邏輯在 "Bottom: my area" 區段單獨處理（那邊看得到牌面）。
                void ti;
                // 眼牌者看得到暗槓（opponent.revealed 有牌面）
                const isConcealedFaceDown = meld.type === "concealed_kong" && !opponent;
                return (
                  <div
                    key={t.id}
                    style={
                      rotStyle
                        ? {
                            width: mh,
                            height: mw,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }
                        : undefined
                    }
                  >
                    <div style={rotStyle ? { transform: rotStyle } : undefined}>
                      <MjTile tile={t} width={mw} height={mh} faceDown={isConcealedFaceDown} />
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
          {player.flowers.length > 0 && (
            <div
              className={`flex ${isHorizontal ? "flex-row" : "flex-col"}`}
              style={{ gap: 1 }}
            >
              {player.flowers.map((f) => (
                <div
                  key={f.id}
                  style={
                    rotStyle
                      ? {
                          width: mh,
                          height: mw,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }
                      : undefined
                  }
                >
                  <div style={rotStyle ? { transform: rotStyle } : undefined}>
                    <MjTile tile={f} width={mw} height={mh} />
                  </div>
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
  dealerSeat,
}: {
  currentTurn: number;
  mySeat: number;
  wallRemaining: number;
  doorSeat?: number;
  dealerSeat: number;
}) {
  // Position winds relative to player's seat
  const winds = [0, 1, 2, 3].map((offset) => {
    const seat = (mySeat + offset) % 4;
    return {
      char: seatWindChar(seat, doorSeat, dealerSeat),
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
  pendingAddKong,
  robKong,
  pendingFlowerRob,
  robFlower,
  tingSeats,
  eyeSeats,
  eyeOptions,
  opponentHands,
  declareFx,
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
  const isTing = tingSeats.includes(mySeat);
  const isEye = eyeSeats.includes(mySeat);
  // 地聽／眼牌後由伺服器處理出牌，不能自己選牌
  const locked = isTing || isEye;
  // 眼牌：這次打牌可以一起宣告時才有「眼牌」鈕；記住是對哪一組選項按下的，換回合自動失效
  const canEye = needsDiscard && !locked && eyeOptions.length > 0;
  const eyeKey = eyeOptions.join(",");
  const [eyeArmedKey, setEyeArmedKey] = useState<string | null>(null);
  const eyeArmed = canEye && eyeArmedKey === eyeKey;
  const fxOf = (seat?: number) => declareFx.find((f) => f.seat === seat);
  const oppOf = (seat?: number) => opponentHands?.find((h) => h.seat === seat);
  const migiFx = declareFx.find((f) => f.both);

  const getWindChar = (seat: number) => seatWindChar(seat, doorSeat, dealerSeat);

  return (
    <div className="flex flex-col flex-1 overflow-hidden relative"
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
            isTing={top != null && tingSeats.includes(top.seat)}
          isEye={top != null && eyeSeats.includes(top.seat)}
          fx={fxOf(top?.seat)}
          opponent={oppOf(top?.seat)}
          dealerConsecutive={dealerConsecutive}
        />
      </div>

      {/* Middle row: left | table | right */}
      <div className="flex-1 flex items-stretch px-2 min-h-0">
        {/* Left */}
        <div className="flex-shrink-0 flex items-center justify-center">
          <PlayerPanel
            player={left}
            position="left"
            isCurrent={left?.seat === currentTurn}
            windChar={getWindChar(left?.seat ?? 3)}
            score={left && playerScores ? playerScores[left.seat] : undefined}
            isTing={left != null && tingSeats.includes(left.seat)}
            isEye={left != null && eyeSeats.includes(left.seat)}
            fx={fxOf(left?.seat)}
            opponent={oppOf(left?.seat)}
            dealerConsecutive={dealerConsecutive}
          />
        </div>

        {/* Center table area — auto-scales with viewport via clamp() */}
        <div className="flex-1 flex flex-col items-center justify-center gap-2 min-h-0 overflow-hidden">
          {/* Table surface with wood-frame border — size driven by viewport:
              max-width up to 900px (or 78vw on narrower screens), max-height
              up to 600px (or 62vh). Aspect ratio 3:2 locked. */}
          <div className="relative w-full rounded-xl overflow-hidden"
            style={{
              maxWidth: "min(900px, 78vw)",
              maxHeight: "min(600px, 62vh)",
              aspectRatio: "3 / 2",
              background: "linear-gradient(145deg, #1e4a2e 0%, #153a22 50%, #0f2a1a 100%)",
              border: "3px solid #8B6914",
              boxShadow: "0 0 0 1px #5a4510, 0 0 0 5px #3a2a08, 0 8px 32px rgba(0,0,0,0.5), inset 0 2px 20px rgba(0,0,0,0.3)",
            }}>

            {/* MIGI 宣告大特效：四家都看得到，只蓋牌桌（不擋下方動作列） */}
            {migiFx && <MigiFx name={players.find((p) => p.seat === migiFx.seat)?.name ?? ""} desk />}

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
                    screen UP. Each column fills bottom→top (flex-col-reverse).
                    Wrapper dims (35×26) match the rotated tile's visual
                    bounding box so sibling columns don't overlap. */}
                <div className="flex-shrink-0 flex flex-row-reverse gap-[2px] items-end" style={{ maxWidth: 160 }}>
                  {(() => {
                    const tiles = (left?.discards || []);
                    const cols: typeof tiles[] = [];
                    // 每欄 5 張；超過 20 張時改成最多 4 欄、每欄加長，寬度才不會超出 160px 跑出金框
                    const perCol = Math.max(5, Math.ceil(tiles.length / 4));
                    for (let i = 0; i < tiles.length; i += perCol) {
                      cols.push(tiles.slice(i, i + perCol));
                    }
                    return cols.map((col, ci) => (
                      <div key={ci} className="flex flex-col-reverse gap-[1px]" style={{ width: 35 }}>
                        {col.map((t, ti) => (
                          <div
                            key={`left-${t.id}-${ti}`}
                            style={{
                              width: 35,
                              height: 26,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <div style={{ transform: "rotate(90deg)" }}>
                              <MjTile tile={t} tiny />
                            </div>
                          </div>
                        ))}
                      </div>
                    ));
                  })()}
                </div>

                {/* Center: wind dial + last discard */}
                <div className="flex-1 flex flex-col items-center justify-center gap-2">
                  <WindDial currentTurn={currentTurn} mySeat={mySeat} wallRemaining={wallRemaining} doorSeat={doorSeat} dealerSeat={dealerSeat} />
                  {/* 中央徽章移除，改以各家 PlayerPanel 上的 連N 小標顯示 */}
                  {/* Dice (骰子開門) — shown below wind dial when no lastDiscard */}
                  {dice && !lastDiscard && !pendingAddKong && !pendingFlowerRob && (
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
                  {/* 加槓中的牌：不是打出去的牌，只在中央提示，不進棄牌區 */}
                  {pendingAddKong && (
                    <div className="flex flex-col items-center gap-1">
                      <div className="rounded-lg overflow-hidden shadow-xl"
                        style={{
                          boxShadow: "0 4px 20px rgba(0,0,0,0.4), 0 0 0 2px rgba(220,38,38,0.6)",
                        }}>
                        <MjTile tile={pendingAddKong.tile} />
                      </div>
                      <span className="text-[9px] text-[#f0d68a] font-bold">
                        {players.find(p => p.seat === pendingAddKong.seat)?.name} 加槓中
                      </span>
                    </div>
                  )}
                  {/* 七搶一：摸到的第 8 張花 */}
                  {pendingFlowerRob && (
                    <div className="flex flex-col items-center gap-1">
                      <div className="rounded-lg overflow-hidden shadow-xl"
                        style={{
                          boxShadow: "0 4px 20px rgba(0,0,0,0.4), 0 0 0 2px rgba(220,38,38,0.6)",
                        }}>
                        <MjTile tile={pendingFlowerRob.tile} />
                      </div>
                      <span className="text-[9px] text-[#fca5a5] font-bold">七搶一</span>
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
                    screen DOWN. Each column fills top→down (default flex-col).
                    Wrapper dims match rotated bounding box (35×26). */}
                <div className="flex-shrink-0 flex flex-row gap-[2px] items-start" style={{ maxWidth: 160 }}>
                  {(() => {
                    const tiles = (right?.discards || []);
                    const cols: typeof tiles[] = [];
                    // 每欄 5 張；超過 20 張時改成最多 4 欄、每欄加長，寬度才不會超出 160px 跑出金框
                    const perCol = Math.max(5, Math.ceil(tiles.length / 4));
                    for (let i = 0; i < tiles.length; i += perCol) {
                      cols.push(tiles.slice(i, i + perCol));
                    }
                    return cols.map((col, ci) => (
                      <div key={ci} className="flex flex-col gap-[1px]" style={{ width: 35 }}>
                        {col.map((t, ti) => (
                          <div
                            key={`right-${t.id}-${ti}`}
                            style={{
                              width: 35,
                              height: 26,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <div style={{ transform: "rotate(-90deg)" }}>
                              <MjTile tile={t} tiny />
                            </div>
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
              if (pendingAddKong) {
                return (
                  <span className="text-[#f0d68a] font-bold text-sm">
                    {players.find((p) => p.seat === pendingAddKong.seat)?.name} 加槓中
                  </span>
                );
              }
              if (pendingFlowerRob) {
                return robFlower ? null : (
                  <span className="text-white/40 text-xs">
                    等待 {players.find((p) => p.seat === pendingFlowerRob.robberSeat)?.name}
                  </span>
                );
              }
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

          {/* Action buttons (碰/槓/胡/過/眼牌) */}
          {(hasActions || canEye) && (
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
                  <span>
                    {action.type === "win" && robFlower
                      ? "七搶一"
                      : action.type === "win" && robKong
                        ? "搶槓胡"
                        : ActionName(action.type)}
                  </span>
                  {/* Show the chi tile pair / add-kong tile so multiple options are distinguishable */}
                  {(action.type === "chi" || action.type === "add_kong") && action.tiles && (
                    <span className="flex gap-[1px]">
                      {action.tiles.map((t) => (
                        <MjTile key={t.id} tile={t} tiny />
                      ))}
                    </span>
                  )}
                </button>
              ))}
              {hasActions && (
                <button
                  onClick={() => onAction("pass")}
                  className="px-5 py-2 rounded-xl bg-white/10 text-white/70 font-bold text-sm border border-white/10
                    cursor-pointer active:scale-95 transition-all duration-150"
                >
                  {robKong || robFlower ? "不搶" : "過"}
                </button>
              )}
              {canEye && (
                <button
                  onClick={() => setEyeArmedKey(eyeArmed ? null : eyeKey)}
                  aria-pressed={eyeArmed}
                  className={`px-4 py-2 rounded-xl font-bold text-sm cursor-pointer active:scale-95 transition-all duration-150
                    ${eyeArmed ? "text-[#2b0f55] shadow-lg" : "bg-white/10 text-[#c4b5fd] border border-[#a78bfa]/45"}`}
                  style={eyeArmed ? { background: "linear-gradient(135deg, #7c3aed, #c4b5fd)", boxShadow: "0 2px 10px rgba(167,139,250,.4)" } : undefined}
                >
                  眼牌
                </button>
              )}
            </div>
          )}
        </div>

        {/* Right */}
        <div className="flex-shrink-0 flex items-center justify-center">
          <PlayerPanel
            player={right}
            position="right"
            isCurrent={right?.seat === currentTurn}
            windChar={getWindChar(right?.seat ?? 1)}
            score={right && playerScores ? playerScores[right.seat] : undefined}
            isTing={right != null && tingSeats.includes(right.seat)}
            isEye={right != null && eyeSeats.includes(right.seat)}
            fx={fxOf(right?.seat)}
            opponent={oppOf(right?.seat)}
            dealerConsecutive={dealerConsecutive}
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
          {/* 風位＋名字＋標示包一層當宣告特效的錨點（外觀不變） */}
          <span className={`mjm-me-who ${fxClass(fxOf(mySeat))}`} style={{ gap: 12 }}>
          {/* Wind avatar */}
          <div className="w-7 h-7 rounded-full bg-[#C9A96E] text-[#0f2a1a] flex items-center justify-center text-xs font-bold">
            {getWindChar(mySeat)}
          </div>
          <span className="text-xs text-[#f0d68a] font-bold">{playerName}</span>
          {me?.isDealer && (
            <span className="text-[9px] text-[#C9A96E] bg-[#C9A96E]/15 px-1.5 py-0.5 rounded">
              莊
            </span>
          )}
          {me?.isDealer && !!dealerConsecutive && dealerConsecutive > 0 && (
            <span
              className="px-1.5 py-[1px] rounded-full text-[9px] font-black tracking-wider"
              style={{
                background: "linear-gradient(135deg, #dc2626 0%, #C9A96E 100%)",
                color: "#fff8dc",
                border: "1px solid rgba(240,214,138,0.6)",
                boxShadow: "0 0 8px rgba(255,140,0,0.5)",
              }}
            >
              連{dealerConsecutive}·拉{dealerConsecutive}
            </span>
          )}
          <DeclareTags ting={isTing} eye={isEye} fx={fxOf(mySeat)} />
          </span>
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
                  {/* 自己的暗槓顯示全部牌面（其他家 PlayerPanel 則全部面朝下） */}
                  {meld.tiles.map((t) => (
                    <MjTile key={t.id} tile={t} small />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Hand — extra top padding for selected tile float */}
        <div className="flex items-end px-1 pt-4 pb-1.5 gap-2">
          <div className="flex-1 min-w-0">
            <MjHand
              tiles={myHand}
              canDiscard={needsDiscard && !locked}
              onDiscard={onDiscard}
              drawnTileId={drawnTileId ?? undefined}
              eyeArmed={eyeArmed}
              eyeOptionIds={eyeOptions}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
