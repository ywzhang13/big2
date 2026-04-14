"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getSupabase } from "@/lib/supabase";
import { sortTiles, isFlower } from "@/lib/mahjong/tiles";
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
        lastDiscard: gs.lastDiscard,
        wallRemaining: gs.wallCount,
        hasDrawn: gs.hasDrawn,
        // Keep availableActions from broadcast — polling doesn't provide them
        availableActions: prev.availableActions,
        winner: gs.winner
          ? {
              seat: gs.winner.seat,
              name: gs.players[gs.winner.seat]?.name ?? "",
              score: gs.winner.score,
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
        players: prev.players.map((p) =>
          p.seat === seat ? { ...p, tileCount, ...(flowers ? { flowers } : {}) } : p
        ),
      }));
    });

    // --- mj_draw_tile (private) ---
    channel.on("broadcast", { event: "mj_draw_tile" }, ({ payload }) => {
      const { playerId, hand, flowers, canWin, canKong, kongOptions } = payload as {
        playerId: string;
        tile: Tile;
        hand: Tile[];
        flowers?: Tile[];
        canWin: boolean;
        canKong: boolean;
        kongOptions: number[][];
      };
      if (playerId !== myId) return;
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
      const drawnTile = payload.tile as Tile;
      setState((prev) => ({
        ...prev,
        myHand: safeHand(hand),
        availableActions: actions,
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
      const { seat, tile } = payload as {
        seat: number;
        tile: Tile;
        availableActions: { type: string; playerSeat: number }[];
      };
      setState((prev) => ({
        ...prev,
        lastDiscard: { tile, from: seat },
        // Don't change hasDrawn here — wait for mj_pass/mj_draw to set it properly
        // This prevents the brief "輪到你摸牌" flash
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
      const { playerId, actions } = payload as {
        playerId: string;
        actions: { type: string; playerSeat: number; tiles?: Tile[] }[];
      };
      if (playerId !== myId) return;
      setState((prev) => ({
        ...prev,
        availableActions: actions.map((a) => ({
          type: a.type,
          tiles: a.tiles,
        })),
      }));
    });

    // --- mj_action (chi/pong/kong) ---
    channel.on("broadcast", { event: "mj_action" }, ({ payload }) => {
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
        ...(drawnTileId != null ? { drawnTileId } : {}),
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
        // Clear actions for the passing player; clear for everyone if all passed
        availableActions:
          prev.mySeat === _seat || allPassed ? [] : prev.availableActions,
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
      const msg = payload as {
        winnerSeat: number;
        winnerName: string | null;
        score: ScoreResult | null;
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
  const needsDiscard = isMyTurn && state.hasDrawn && state.status === "playing";

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
