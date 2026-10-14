"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getSupabase } from "@/lib/supabase";
import { sortTiles, isFlower, tileKey } from "@/lib/mahjong/tiles";
import type { Tile } from "@/lib/mahjong/tiles";

/** Filter out any flower tiles that shouldn't be in hand (defensive) */
function safeHand(tiles: Tile[]): Tile[] {
  const filtered = tiles.filter((t) => {
    // Triple check: suit property, isFlower function, and display name
    if (t.suit === "f") return false;
    if (isFlower(t)) return false;
    const flowerNames = ["春", "夏", "秋", "冬", "梅", "蘭", "竹", "菊"];
    if (flowerNames.includes(t.display)) return false;
    return true;
  });
  if (filtered.length !== tiles.length) {
    console.warn("[mj] safeHand filtered flowers:", tiles.length - filtered.length, "removed");
  }
  return sortTiles(filtered);
}
import type { Meld, ScoreResult, RoomSettings, RoundInfo, Settlement } from "@/lib/mahjong/gameState";
import type { RealtimeChannel } from "@supabase/supabase-js";

function getMjId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem("mj_pid");
  if (!id) {
    id = Math.random().toString(36).slice(2, 10);
    localStorage.setItem("mj_pid", id);
  }
  return id;
}

/** 「這一回合」的識別：第幾圈第幾局連幾＋牌牆剩幾張＋摸進的牌。牌牆張數在一局內只會變少，
 *  所以同一局每次摸牌都不同；牌 id 每局重複使用，要靠圈局區分不同局 */
function ownTurnKey(roundInfo: RoundInfo | undefined, wallCount: number, drawnTileId: number | null | undefined): string | null {
  if (drawnTileId == null) return null;
  const game = roundInfo ? `${roundInfo.currentRound}-${roundInfo.currentGame}-${roundInfo.dealerConsecutive}` : "";
  return `${game}|${wallCount}|${drawnTileId}`;
}

async function api<T>(method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<T> {
  const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body && method === "POST") opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `API error ${res.status}`);
  }
  return res.json();
}

export interface MjPlayer {
  id: string;
  name: string;
  seat: number;
  tileCount: number;
  flowers: Tile[];
  discards: Tile[];
  revealed: Meld[];
  isDealer: boolean;
}

export interface MjClientState {
  roomCode: string;
  status: "waiting" | "playing" | "finished";
  players: MjPlayer[];
  myId: string;
  mySeat: number;
  myHand: Tile[];
  currentTurn: number;
  dealerSeat: number;
  lastDiscard: { tile: Tile; from: number } | null;
  availableActions: { type: string; tiles?: Tile[] }[];
  // 搶槓窗口：某家加槓中，等其他家決定要不要搶槓胡
  pendingAddKong: { seat: number; tile: Tile } | null;
  // 我目前的動作按鈕是搶槓胡（顯示「搶槓胡／不搶」）
  robKong: boolean;
  // 七搶一窗口：fromSeat 摸到第 8 張花（tile），robberSeat 有 7 張花在決定要不要搶
  pendingFlowerRob: { robberSeat: number; fromSeat: number; tile: Tile } | null;
  // 我目前的動作按鈕是七搶一（顯示「七搶一／不搶」）
  robFlower: boolean;
  winner?: {
    seat: number;
    name: string;
    score: ScoreResult;
    allHands?: {
      seat: number;
      name: string;
      hand: Tile[];
      revealed: Meld[];
      flowers: Tile[];
    }[];
  };
  // 一炮多響: all winners of this round (seat/name/score per winner).
  // Populated alongside `winner` when multiple players hu on the same discard.
  winners?: { seat: number; name: string; score: ScoreResult }[];
  wallRemaining: number;
  hostId: string;
  hasDrawn: boolean;
  drawnTileId: number | null;
  actionNotice: { seat: number; type: string } | null;
  // Round system
  roomSettings?: RoomSettings;
  roundInfo?: RoundInfo;
  playerScores?: number[];
  settlement?: Settlement;
  gameOver?: boolean;
  // Dice / door
  dice?: [number, number, number];
  doorSeat?: number;
  // Next-game ready check
  nextGameReady?: string[];
  nextGameAllReady?: boolean;
  // Leave request (離開需他家同意)
  leaveRequest?: {
    requesterId: string;
    requesterName: string;
    requesterSeat: number;
    approvedCount?: number;
    deniedCount?: number;
  };
  leaveResult?: "granted" | "denied" | null;
}

export { getMjId };

export function useMahjong(roomCode: string, playerName: string) {
  const myId = useRef(getMjId()).current;

  const [state, setState] = useState<MjClientState>({
    roomCode,
    status: "waiting",
    players: [],
    myId,
    mySeat: -1,
    myHand: [],
    currentTurn: -1,
    dealerSeat: 0,
    lastDiscard: null,
    availableActions: [],
    pendingAddKong: null,
    robKong: false,
    pendingFlowerRob: null,
    robFlower: false,
    wallRemaining: 0,
    hostId: "",
    hasDrawn: false,
    drawnTileId: null,
    actionNotice: null,
  });

  const [roomId, setRoomId] = useState<string>("");
  const channelRef = useRef<RealtimeChannel | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const roomIdRef = useRef(roomId);
  roomIdRef.current = roomId;
  const discardingRef = useRef(false);
  // 自己回合按「過」收起自摸胡／暗槓／加槓按鈕：記下是哪一張摸牌時收起的，輪詢就不再補回。
  // 只對「這一回合」有效：換局、別人出牌／吃碰槓、我重新摸牌都會清掉（牌 id 每局會重複使用）
  const dismissedOwnActionsRef = useRef<string | null>(null);

  // Fetch full state from API (for reconnection / polling)
  const fetchState = useCallback(async (rid: string) => {
    try {
      const data = await api<{
        roomId: string;
        code: string;
        status: string;
        gameState: {
          roomCode: string;
          status: string;
          players: {
            id: string;
            name: string;
            seat: number;
            tileCount: number;
            revealed: Meld[];
            flowers: Tile[];
            discards: Tile[];
            isDealer: boolean;
          }[];
          wallCount: number;
          currentTurn: number;
          lastDiscard: { tile: Tile; from: number } | null;
          dealerSeat: number;
          prevalentWind: number;
          turnCount: number;
          hasDrawn: boolean;
          winner?: { seat: number; score: ScoreResult };
          hand?: Tile[];
          myAvailableActions?: { type: string; tiles?: Tile[] }[];
          pendingAddKong?: { seat: number; tile: Tile };
          pendingFlowerRob?: { robberSeat: number; fromSeat: number; tile: Tile };
          myDrawnTileId?: number;
        } | null;
      }>("GET", `/api/mahjong/state?roomId=${rid}&playerId=${myId}`);

      if (!data.gameState) {
        // Room exists but no game state yet — still in lobby
        // Update players from DB
        const lobbyData = data as { lobbyPlayers?: { id: string; name: string; seat: number }[]; hostId?: string; roomSettings?: RoomSettings };
        const lobbyPlayers = lobbyData.lobbyPlayers || [];
        const hostId = lobbyData.hostId || "";
        const lobbySettings = lobbyData.roomSettings;
        if (lobbyPlayers.length > 0) {
          setState((prev) => {
            const players: MjPlayer[] = lobbyPlayers.map((p) => ({
              id: p.id, name: p.name, seat: p.seat,
              tileCount: 0, flowers: [], discards: [], revealed: [], isDealer: false,
            }));
            const mySeat = players.find((p) => p.id === myId)?.seat ?? prev.mySeat;
            return {
              ...prev,
              players,
              mySeat,
              hostId,
              ...(lobbySettings ? { roomSettings: lobbySettings } : {}),
            };
          });
        }
        return;
      }

      const gs = data.gameState;
      const hand = gs.hand ? safeHand(gs.hand) : [];
      const mySeat = gs.players.find((p) => p.id === myId)?.seat ?? -1;
      // 漏接廣播時的保險：伺服器上已經不是收起時的那個回合，就清掉記號
      const turnKey = ownTurnKey(
        (gs as Record<string, unknown>).roundInfo as RoundInfo | undefined,
        gs.wallCount,
        gs.myDrawnTileId
      );
      if (gs.status !== "playing" || gs.currentTurn !== mySeat || turnKey !== dismissedOwnActionsRef.current) {
        dismissedOwnActionsRef.current = null;
      }
      const pendingAddKong = gs.pendingAddKong ?? null;
      const pendingFlowerRob = gs.pendingFlowerRob ?? null;

      setState((prev) => ({
        ...prev,
        status: gs.status as MjClientState["status"],
        players: gs.players.map((p) => ({
          id: p.id,
          name: p.name,
          seat: p.seat,
          tileCount: p.tileCount,
          flowers: p.flowers,
          discards: p.discards,
          revealed: p.revealed,
          isDealer: p.isDealer,
        })),
        myHand: hand,
        mySeat,
        currentTurn: gs.currentTurn,
        dealerSeat: gs.dealerSeat,
        // 搶槓窗口期間 lastDiscard 是加槓的牌，不是打出去的牌，不當棄牌顯示
        lastDiscard: pendingAddKong ? null : gs.lastDiscard,
        pendingAddKong,
        robKong: pendingAddKong != null && pendingAddKong.seat !== mySeat,
        pendingFlowerRob,
        robFlower: pendingFlowerRob != null && pendingFlowerRob.robberSeat === mySeat,
        // 輪到我且剛摸完牌：重新整理後把摸進的那張分開顯示
        drawnTileId: gs.myDrawnTileId ?? prev.drawnTileId,
        wallRemaining: gs.wallCount,
        hasDrawn: gs.hasDrawn,
        // availableActions: prefer broadcast-delivered value (fresh), but
        // fall back to polled myAvailableActions if the broadcast was missed
        // so chi/pong/kong buttons appear even after realtime drops.
        availableActions: prev.availableActions.length > 0
          ? prev.availableActions
          : turnKey != null && turnKey === dismissedOwnActionsRef.current
            ? []
            : (gs.myAvailableActions ?? []),
        // Preserve allHands from mj_game_over broadcast — polling state
        // doesn't include allHands, so we don't want to overwrite it.
        winner: gs.winner
          ? {
              seat: gs.winner.seat,
              name: gs.players[gs.winner.seat]?.name ?? "",
              score: gs.winner.score,
              allHands: prev.winner?.allHands,
            }
          : prev.winner,
        // Round system fields from polling
        roomSettings: (gs as Record<string, unknown>).roomSettings as RoomSettings | undefined ?? prev.roomSettings,
        roundInfo: (gs as Record<string, unknown>).roundInfo as RoundInfo | undefined ?? prev.roundInfo,
        playerScores: (gs as Record<string, unknown>).playerScores as number[] | undefined ?? prev.playerScores,
        settlement: (gs as Record<string, unknown>).settlement as Settlement | undefined ?? prev.settlement,
        gameOver: (gs as Record<string, unknown>).gameOver as boolean | undefined ?? prev.gameOver,
        dice: (gs as Record<string, unknown>).dice as [number, number, number] | undefined ?? prev.dice,
        doorSeat: (gs as Record<string, unknown>).doorSeat as number | undefined ?? prev.doorSeat,
        nextGameReady: (gs as Record<string, unknown>).nextGameReady as string[] | undefined ?? prev.nextGameReady,
      }));
    } catch (err) {
      console.error("[mj] fetchState failed:", err);
    }
  }, [myId]);

  // Subscribe to Supabase Realtime
  useEffect(() => {
    if (!playerName || !roomCode || !myId) return;

    const supabase = getSupabase();
    const channel = supabase.channel(`mj-${roomCode}`, {
      config: { broadcast: { self: true } },
    });

    // --- mj_player_joined ---
    channel.on("broadcast", { event: "mj_player_joined" }, ({ payload }) => {
      const { playerId, name, seat } = payload as {
        playerId: string;
        name: string;
        seat: number;
      };
      setState((prev) => {
        if (prev.status !== "waiting") return prev;
        const exists = prev.players.find((p) => p.id === playerId);
        let players: MjPlayer[];
        if (exists) {
          players = prev.players.map((p) =>
            p.id === playerId ? { ...p, name, seat } : p
          );
        } else {
          players = [
            ...prev.players,
            {
              id: playerId,
              name,
              seat,
              tileCount: 0,
              flowers: [],
              discards: [],
              revealed: [],
              isDealer: false,
            },
          ];
        }
        players.sort((a, b) => a.seat - b.seat);
        const hostPlayer = players.find((p) => p.seat === 0);
        const mySeat = playerId === myId ? seat : prev.mySeat;
        return {
          ...prev,
          players,
          mySeat,
          hostId: hostPlayer?.id || prev.hostId,
        };
      });
    });

    // --- mj_game_start ---
    channel.on("broadcast", { event: "mj_game_start" }, ({ payload }) => {
      dismissedOwnActionsRef.current = null;
      const msg = payload as {
        currentTurn: number;
        dealerSeat: number;
        prevalentWind: number;
        wallCount: number;
        players: {
          id: string;
          name: string;
          seat: number;
          tileCount: number;
          revealed: Meld[];
          flowers: Tile[];
          discards: Tile[];
          isDealer: boolean;
        }[];
        roundInfo?: RoundInfo;
        playerScores?: number[];
        dice?: [number, number, number];
        doorSeat?: number;
      };
      const mySeat = msg.players.find((p) => p.id === myId)?.seat ?? -1;
      setState((prev) => ({
        ...prev,
        status: "playing",
        mySeat,
        currentTurn: msg.currentTurn,
        dealerSeat: msg.dealerSeat,
        wallRemaining: msg.wallCount,
        lastDiscard: null,
        availableActions: [],
        pendingAddKong: null,
        robKong: false,
        pendingFlowerRob: null,
        robFlower: false,
        hasDrawn: msg.currentTurn === msg.dealerSeat, // dealer starts with 17
        players: msg.players.map((p) => ({
          id: p.id,
          name: p.name,
          seat: p.seat,
          tileCount: p.tileCount,
          flowers: p.flowers || [],
          discards: p.discards || [],
          revealed: p.revealed || [],
          isDealer: p.isDealer,
        })),
        winner: undefined,
        settlement: undefined,
        gameOver: false,
        ...(msg.roundInfo ? { roundInfo: msg.roundInfo } : {}),
        ...(msg.playerScores ? { playerScores: msg.playerScores } : {}),
        ...(msg.dice ? { dice: msg.dice } : {}),
        ...(msg.doorSeat != null ? { doorSeat: msg.doorSeat } : {}),
        nextGameReady: [],
        nextGameAllReady: false,
      }));
    });

    // --- mj_deal_hand (private) ---
    channel.on("broadcast", { event: "mj_deal_hand" }, ({ payload }) => {
      const { playerId, hand, flowers } = payload as {
        playerId: string;
        hand: Tile[];
        flowers: Tile[];
      };
      if (playerId !== myId) return;
      setState((prev) => ({
        ...prev,
        myHand: safeHand(hand),
        // Update my flower count in players list
        players: prev.players.map((p) =>
          p.id === myId ? { ...p, flowers, tileCount: hand.length } : p
        ),
      }));
    });

    // --- mj_draw (public) ---
    channel.on("broadcast", { event: "mj_draw" }, ({ payload }) => {
      const { seat, tileCount, wallCount, flowers } = payload as {
        seat: number;
        tileCount: number;
        wallCount: number;
        flowers?: Tile[];
      };
      setState((prev) => ({
        ...prev,
        wallRemaining: wallCount,
        hasDrawn: true,
        // 七搶一不搶後會重送摸牌事件；若又要等七搶一，後面的 pending 事件會再設回來
        pendingFlowerRob: null,
        robFlower: false,
        players: prev.players.map((p) =>
          p.seat === seat ? { ...p, tileCount, ...(flowers ? { flowers } : {}) } : p
        ),
      }));
    });

    // --- mj_draw_tile (private) ---
    channel.on("broadcast", { event: "mj_draw_tile" }, ({ payload }) => {
      const { playerId, hand, flowers, canWin, canKong, kongOptions, addKongOptions } = payload as {
        playerId: string;
        tile: Tile;
        hand: Tile[];
        flowers?: Tile[];
        canWin: boolean;
        canKong: boolean;
        kongOptions: number[][];
        addKongOptions?: number[];
      };
      if (playerId !== myId) return;
      dismissedOwnActionsRef.current = null; // 新摸的牌（含槓後補牌）重新判斷
      const actions: { type: string; tiles?: Tile[] }[] = [];
      if (canWin) {
        actions.push({ type: "win" });
      }
      if (canKong && kongOptions) {
        for (const group of kongOptions) {
          const tiles = hand.filter((t) => group.includes(t.id));
          actions.push({ type: "kong", tiles });
        }
      }
      for (const id of addKongOptions ?? []) {
        const tile = hand.find((t) => t.id === id);
        if (tile) actions.push({ type: "add_kong", tiles: [tile] });
      }
      const drawnTile = payload.tile as Tile;
      console.log("[mj] mj_draw_tile", { drawnTileId: drawnTile?.id, drawnDisplay: drawnTile?.display, handLen: hand.length });
      setState((prev) => ({
        ...prev,
        myHand: safeHand(hand),
        availableActions: actions,
        robKong: false,
        hasDrawn: true,
        drawnTileId: drawnTile?.id ?? null,
        // Update flowers if provided (補花)
        players: flowers
          ? prev.players.map((p) =>
              p.id === myId ? { ...p, flowers, tileCount: hand.length } : p
            )
          : prev.players,
      }));
    });

    // --- mj_discard ---
    channel.on("broadcast", { event: "mj_discard" }, ({ payload }) => {
      dismissedOwnActionsRef.current = null;
      const { seat, tile } = payload as {
        seat: number;
        tile: Tile;
        availableActions: { type: string; playerSeat: number }[];
      };
      setState((prev) => ({
        ...prev,
        lastDiscard: { tile, from: seat },
        // Clear actions — new mj_available_actions will re-populate after this
        // arrives (server sends mj_discard first, action broadcasts second).
        availableActions: [],
        drawnTileId: prev.mySeat === seat ? null : prev.drawnTileId,
        players: prev.players.map((p) =>
          p.seat === seat
            ? {
                ...p,
                // Bug #5: prevent duplicate discards
                discards: p.discards.some((d) => d.id === tile.id)
                  ? p.discards
                  : [...p.discards, tile],
                tileCount: p.tileCount - 1,
              }
            : p
        ),
        // If not my discard, keep hand; if mine, remove that tile
        myHand:
          prev.mySeat === seat
            ? prev.myHand.filter((t) => t.id !== tile.id)
            : prev.myHand,
      }));
    });

    // --- mj_available_actions (private) ---
    channel.on("broadcast", { event: "mj_available_actions" }, ({ payload }) => {
      const { playerId, actions, robKong, robFlower } = payload as {
        playerId: string;
        actions: { type: string; playerSeat: number; tiles?: Tile[] }[];
        robKong?: boolean;
        robFlower?: boolean;
      };
      if (playerId !== myId) return;
      setState((prev) => ({
        ...prev,
        robKong: robKong === true,
        robFlower: robFlower === true,
        availableActions: actions.map((a) => ({
          type: a.type,
          tiles: a.tiles,
        })),
      }));
    });

    // --- mj_action (chi/pong/kong) ---
    channel.on("broadcast", { event: "mj_action" }, ({ payload }) => {
      dismissedOwnActionsRef.current = null;
      const msg = payload as {
        type: string;
        seat: number;
        tiles: Tile[];
        tileCount?: number;
      };
      setState((prev) => {
        const meld: Meld = {
          type: msg.type as Meld["type"],
          tiles: msg.tiles,
          from: prev.lastDiscard?.from,
        };
        // If I'm the one who did chi/pong/kong, immediately remove the used
        // tiles from my hand to avoid a brief window where stale tiles are
        // clickable before mj_hand_update arrives (causes "卡住" feel).
        const meldTileIds = new Set(msg.tiles.map((t) => t.id));
        const updatedHand =
          msg.seat === prev.mySeat
            ? prev.myHand.filter((t) => !meldTileIds.has(t.id))
            : prev.myHand;
        return {
          ...prev,
          currentTurn: msg.seat,
          lastDiscard: null,
          availableActions: [],
          hasDrawn: true, // after chi/pong/kong player must discard (or already drew for kong)
          actionNotice: { seat: msg.seat, type: msg.type },
          myHand: updatedHand,
          players: prev.players.map((p) =>
            p.seat === msg.seat
              ? {
                  ...p,
                  revealed: [...p.revealed, meld],
                  tileCount: msg.tileCount ?? p.tileCount,
                }
              : p
          ),
        };
      });
      // Auto-clear action notice after 1.5s
      setTimeout(() => {
        setState((prev) => ({ ...prev, actionNotice: null }));
      }, 1500);
    });

    // --- mj_add_kong_pending (public): 加槓中，等其他家決定要不要搶槓 ---
    channel.on("broadcast", { event: "mj_add_kong_pending" }, ({ payload }) => {
      const { seat, tile, tileCount } = payload as {
        seat: number;
        tile: Tile;
        tileCount: number;
      };
      setState((prev) => ({
        ...prev,
        pendingAddKong: { seat, tile },
        availableActions: [],
        robKong: false,
        players: prev.players.map((p) =>
          p.seat === seat ? { ...p, tileCount } : p
        ),
      }));
    });

    // --- mj_flower_rob_pending (public): 有人摸到第 8 張花，等 7 張花的人決定要不要七搶一 ---
    channel.on("broadcast", { event: "mj_flower_rob_pending" }, ({ payload }) => {
      const { robberSeat, fromSeat, tile } = payload as {
        robberSeat: number;
        fromSeat: number;
        tile: Tile;
      };
      setState((prev) => ({
        ...prev,
        pendingFlowerRob: { robberSeat, fromSeat, tile },
        availableActions: [],
        robFlower: false,
      }));
    });

    // --- mj_add_kong (public): 加槓完成，把那組碰升成槓（不新增一組） ---
    channel.on("broadcast", { event: "mj_add_kong" }, ({ payload }) => {
      const { seat, tile, tileCount } = payload as {
        seat: number;
        tile: Tile;
        tileCount: number;
      };
      setState((prev) => ({
        ...prev,
        currentTurn: seat,
        pendingAddKong: null,
        robKong: false,
        actionNotice: { seat, type: "add_kong" },
        myHand:
          seat === prev.mySeat
            ? prev.myHand.filter((t) => t.id !== tile.id)
            : prev.myHand,
        players: prev.players.map((p) => {
          if (p.seat !== seat) return p;
          // 輪詢可能已經先拿到升級後的槓，找不到同種的碰就不動
          const idx = p.revealed.findIndex(
            (m) => m.type === "pong" && tileKey(m.tiles[0]) === tileKey(tile)
          );
          const revealed =
            idx === -1
              ? p.revealed
              : p.revealed.map((m, i) =>
                  i === idx ? { ...m, type: "kong" as const, tiles: [...m.tiles, tile] } : m
                );
          return { ...p, revealed, tileCount };
        }),
      }));
      setTimeout(() => {
        setState((prev) => ({ ...prev, actionNotice: null }));
      }, 1500);
    });

    // --- mj_hand_update (private, after action) ---
    channel.on("broadcast", { event: "mj_hand_update" }, ({ payload }) => {
      const { playerId, hand, drawnTileId } = payload as {
        playerId: string;
        hand: Tile[];
        drawnTileId?: number;
      };
      if (playerId !== myId) return;
      setState((prev) => ({
        ...prev,
        myHand: safeHand(hand),
        // Authoritative: kong → replacement tile id; chi/pong → null
        drawnTileId: drawnTileId ?? null,
      }));
    });

    // --- mj_turn_advance (from discard when no actions, to avoid flash) ---
    channel.on("broadcast", { event: "mj_turn_advance" }, ({ payload }) => {
      const { currentTurn, hasDrawn } = payload as {
        currentTurn: number;
        hasDrawn: boolean;
      };
      setState((prev) => ({
        ...prev,
        currentTurn,
        hasDrawn,
      }));
    });

    // --- mj_pass ---
    channel.on("broadcast", { event: "mj_pass" }, ({ payload }) => {
      const { seat: _seat, allPassed, currentTurn: newTurn, hasDrawn: newHasDrawn } = payload as {
        seat: number;
        allPassed?: boolean;
        currentTurn?: number;
        hasDrawn?: boolean;
      };
      setState((prev) => ({
        ...prev,
        // Only clear my own action buttons if *I* was the one passing. Do not
        // clear based on `allPassed` — in edge cases (stale broadcasts, out-of-
        // order delivery) that can hide my still-valid chi/pong button before
        // I've had a chance to decide. A legitimate allPassed=true always
        // implies my own pass already cleared them earlier.
        availableActions:
          prev.mySeat === _seat ? [] : prev.availableActions,
        robKong: prev.mySeat === _seat ? false : prev.robKong,
        robFlower: prev.mySeat === _seat ? false : prev.robFlower,
        ...(allPassed ? { pendingFlowerRob: null } : {}),
        // When allPassed, server sends authoritative turn state so currentTurn
        // + hasDrawn update together (no "輪到你摸牌" flash).
        ...(allPassed && newTurn != null && newHasDrawn != null
          ? { currentTurn: newTurn, hasDrawn: newHasDrawn }
          : {}),
      }));
    });

    // --- mj_leave_request ---
    channel.on("broadcast", { event: "mj_leave_request" }, ({ payload }) => {
      const { requesterId, requesterName, requesterSeat } = payload as {
        requesterId: string;
        requesterName: string;
        requesterSeat: number;
      };
      setState((prev) => ({
        ...prev,
        leaveRequest: { requesterId, requesterName, requesterSeat, approvedCount: 0, deniedCount: 0 },
        leaveResult: null,
      }));
    });

    // --- mj_leave_vote ---
    channel.on("broadcast", { event: "mj_leave_vote" }, ({ payload }) => {
      const { approvedCount, deniedCount, result, requesterSeat, requesterName } = payload as {
        voterId: string;
        voterSeat: number;
        approve: boolean;
        approvedCount: number;
        deniedCount: number;
        result: "granted" | "denied" | "vote";
        requesterSeat: number;
        requesterName: string;
      };
      setState((prev) => ({
        ...prev,
        leaveRequest:
          result === "vote"
            ? {
                requesterId: prev.leaveRequest?.requesterId ?? "",
                requesterName,
                requesterSeat,
                approvedCount,
                deniedCount,
              }
            : undefined,
        leaveResult: result === "granted" ? "granted" : result === "denied" ? "denied" : prev.leaveResult,
        // If granted, game becomes finished
        ...(result === "granted" ? { status: "finished" as const } : {}),
      }));
    });

    // --- mj_next_game_ready (partial readiness or all ready) ---
    channel.on("broadcast", { event: "mj_next_game_ready" }, ({ payload }) => {
      const { readyIds, allReady } = payload as { readyIds: string[]; allReady?: boolean };
      setState((prev) => ({
        ...prev,
        nextGameReady: readyIds,
        nextGameAllReady: allReady === true,
      }));
    });

    // --- mj_game_over ---
    channel.on("broadcast", { event: "mj_game_over" }, ({ payload }) => {
      dismissedOwnActionsRef.current = null;
      const msg = payload as {
        winnerSeat: number;
        winnerName: string | null;
        score: ScoreResult | null;
        winners?: { seat: number; name: string; score: ScoreResult }[];
        allHands: {
          seat: number;
          name: string;
          hand: Tile[];
          revealed: Meld[];
          flowers: Tile[];
        }[];
        settlement?: Settlement;
        playerScores?: number[];
        roundInfo?: RoundInfo;
        gameOver?: boolean;
      };
      setState((prev) => ({
        ...prev,
        status: "finished",
        availableActions: [],
        // 搶槓胡：結算畫面靠 lastDiscard 顯示「某某 放槍」，把加槓的牌放回來
        lastDiscard: prev.pendingAddKong
          ? { tile: prev.pendingAddKong.tile, from: prev.pendingAddKong.seat }
          : prev.lastDiscard,
        pendingAddKong: null,
        robKong: false,
        pendingFlowerRob: null,
        robFlower: false,
        winner:
          msg.winnerSeat >= 0
            ? {
                seat: msg.winnerSeat,
                name: msg.winnerName || "",
                score: msg.score || { fans: [], totalFan: 0 },
                allHands: msg.allHands,
              }
            : {
                seat: -1,
                name: "",
                score: { fans: [], totalFan: 0 },
                allHands: msg.allHands,
              },
        winners: msg.winners && msg.winners.length > 0 ? msg.winners : undefined,
        settlement: msg.settlement,
        playerScores: msg.playerScores ?? prev.playerScores,
        roundInfo: msg.roundInfo ?? prev.roundInfo,
        gameOver: msg.gameOver ?? false,
      }));
    });

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        console.log("[mj] connected to room", roomCode);
        const rid = roomIdRef.current;
        if (rid) {
          fetchState(rid);
        }
      }
    });

    channelRef.current = channel;

    // Periodic state poll for recovery
    const pollTimer = setInterval(() => {
      const rid = roomIdRef.current;
      if (!rid) return;
      fetchState(rid);
    }, 5000);

    return () => {
      clearInterval(pollTimer);
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [roomCode, playerName, myId, fetchState]);

  const isHost = state.hostId === myId || (state.hostId === "" && state.mySeat === 0);

  // --- API calls ---

  const createRoom = useCallback(async () => {
    const data = await api<{ code: string; roomId: string }>("POST", "/api/mahjong/create", {
      hostId: myId,
    });
    return data;
  }, [myId]);

  const joinRoom = useCallback(
    async (code: string, name: string) => {
      const data = await api<{ seat: number; roomId: string }>("POST", "/api/mahjong/join", {
        code,
        playerId: myId,
        name,
      });
      return data;
    },
    [myId]
  );

  const startGame = useCallback(async () => {
    const rid = roomIdRef.current;
    if (!rid) return;
    await api("POST", "/api/mahjong/start", {
      roomId: rid,
      playerId: myId,
    });
  }, [myId]);

  const drawTileAction = useCallback(async () => {
    const rid = roomIdRef.current;
    if (!rid) return;
    try {
      await api("POST", "/api/mahjong/draw", {
        roomId: rid,
        playerId: myId,
      });
    } catch (err) {
      // Race: auto-draw effect can fire before the mj_action broadcast
      // flips hasDrawn to true after chi/pong/kong. Server will reject with
      // "已經摸過牌了" — safe to ignore; the next discard path will proceed.
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("已經摸過牌了") || msg.includes("等待其他玩家動作中")) return;
      console.error("[mj] draw failed:", err);
    }
  }, [myId]);

  const discardTile = useCallback(
    async (tileId: number) => {
      const rid = roomIdRef.current;
      if (!rid) return;
      // Bug #16: prevent double-discard race condition
      if (discardingRef.current) return;
      discardingRef.current = true;
      // Optimistically remove tile from hand + mark hasDrawn=false so UI
      // doesn't keep showing "輪到你打牌" during the pending-action window
      setState((prev) => {
        const tile = prev.myHand.find((t) => t.id === tileId);
        return {
          ...prev,
          myHand: prev.myHand.filter((t) => t.id !== tileId),
          availableActions: [],
          drawnTileId: null,
          hasDrawn: false,
          lastDiscard: tile ? { tile, from: prev.mySeat } : prev.lastDiscard,
        };
      });
      try {
        await api("POST", "/api/mahjong/discard", {
          roomId: rid,
          playerId: myId,
          tileId,
        });
      } catch (err) {
        console.error("[mj] discard failed:", err);
        // Revert on failure — poll will fix state
        const rid2 = roomIdRef.current;
        if (rid2) fetchState(rid2);
      } finally {
        discardingRef.current = false;
      }
    },
    [myId, fetchState]
  );

  const doAction = useCallback(
    async (actionType: string, tiles?: Tile[]) => {
      const rid = roomIdRef.current;
      if (!rid) return;
      // 自己回合（摸牌後）的「過」只是不做自摸胡／暗槓／加槓，不送後端：
      // 後端在沒有等待窗口時收到 pass 會直接跳到下一家
      const cur = stateRef.current;
      if (
        actionType === "pass" &&
        cur.currentTurn === cur.mySeat &&
        cur.hasDrawn &&
        !cur.robKong &&
        !cur.robFlower &&
        !cur.pendingAddKong &&
        !cur.pendingFlowerRob
      ) {
        dismissedOwnActionsRef.current = ownTurnKey(cur.roundInfo, cur.wallRemaining, cur.drawnTileId);
        setState((prev) => ({ ...prev, availableActions: [] }));
        return;
      }
      // Optimistically clear action buttons immediately
      setState((prev) => ({ ...prev, availableActions: [] }));
      try {
        const res = await api("POST", "/api/mahjong/action", {
          roomId: rid,
          playerId: myId,
          actionType,
          tiles: tiles?.map((t) => t.id),
        });
        console.log(`[mj] action ${actionType} success`, res);
      } catch (err) {
        console.error(`[mj] action ${actionType} failed:`, err, { tiles: tiles?.map(t => ({ id: t.id, display: t.display })) });
        // Resync state from server to recover
        fetchState(rid);
      }
    },
    [myId, fetchState]
  );

  const requestLeave = useCallback(async () => {
    const rid = roomIdRef.current;
    if (!rid) return;
    try {
      await api("POST", "/api/mahjong/leave-request", {
        roomId: rid,
        playerId: myId,
      });
    } catch (err) {
      console.error("[mj] leave-request failed:", err);
    }
  }, [myId]);

  const voteLeave = useCallback(
    async (approve: boolean) => {
      const rid = roomIdRef.current;
      if (!rid) return;
      try {
        await api("POST", "/api/mahjong/leave-vote", {
          roomId: rid,
          playerId: myId,
          approve,
        });
      } catch (err) {
        console.error("[mj] leave-vote failed:", err);
      }
    },
    [myId]
  );

  const nextGame = useCallback(async () => {
    const rid = roomIdRef.current;
    if (!rid) return;
    try {
      await api("POST", "/api/mahjong/next-game", {
        roomId: rid,
        playerId: myId,
      });
    } catch (err) {
      console.error("[mj] next-game failed:", err);
    }
  }, [myId]);

  const setRoomIdExternal = useCallback((id: string) => {
    setRoomId(id);
    roomIdRef.current = id;
    // Fetch state immediately on reconnect — don't wait for 5s polling tick
    if (id) {
      fetchState(id);
    }
  }, [fetchState]);

  const isMyTurn = state.currentTurn === state.mySeat;
  const needsDraw = isMyTurn && !state.hasDrawn && state.status === "playing";
  // 搶槓／七搶一窗口期間不能打牌（後端會回 409）
  const needsDiscard =
    isMyTurn &&
    state.hasDrawn &&
    state.status === "playing" &&
    !state.pendingAddKong &&
    !state.pendingFlowerRob;

  // Auto-draw: when it's my turn and I need to draw, do it automatically
  // BUT NOT if there are pending actions OR I just discarded (pending
  // chi/pong/kong/win window on my own discard).
  const justDiscarded =
    state.lastDiscard != null && state.lastDiscard.from === state.mySeat;
  useEffect(() => {
    if (
      needsDraw &&
      state.mySeat >= 0 &&
      state.availableActions.length === 0 &&
      !justDiscarded
    ) {
      const timer = setTimeout(() => {
        drawTileAction();
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [needsDraw, state.mySeat, state.availableActions.length, justDiscarded]);

  return {
    state,
    isHost,
    isMyTurn,
    needsDraw,
    needsDiscard,
    startGame,
    nextGame,
    requestLeave,
    voteLeave,
    drawTile: drawTileAction,
    discardTile,
    doAction,
    setRoomId: setRoomIdExternal,
    createRoom,
    joinRoom,
  };
}
