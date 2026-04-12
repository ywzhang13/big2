"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getSupabase } from "@/lib/supabase";
import { sortTiles } from "@/lib/mahjong/tiles";
import type { Tile } from "@/lib/mahjong/tiles";
import type { Meld, ScoreResult } from "@/lib/mahjong/gameState";
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
        const lobbyPlayers = (data as { lobbyPlayers?: { id: string; name: string; seat: number }[]; hostId?: string }).lobbyPlayers || [];
        const hostId = (data as { hostId?: string }).hostId || "";
        if (lobbyPlayers.length > 0) {
          setState((prev) => {
            const players: MjPlayer[] = lobbyPlayers.map((p) => ({
              id: p.id, name: p.name, seat: p.seat,
              tileCount: 0, flowers: [], discards: [], revealed: [], isDealer: false,
            }));
            const mySeat = players.find((p) => p.id === myId)?.seat ?? prev.mySeat;
            return { ...prev, players, mySeat, hostId };
          });
        }
        return;
      }

      const gs = data.gameState;
      const hand = gs.hand ? sortTiles([...gs.hand]) : [];
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
        myHand: sortTiles([...hand]),
        // Update my flower count in players list
        players: prev.players.map((p) =>
          p.id === myId ? { ...p, flowers, tileCount: hand.length } : p
        ),
      }));
    });

    // --- mj_draw (public) ---
    channel.on("broadcast", { event: "mj_draw" }, ({ payload }) => {
      const { seat, tileCount, wallCount } = payload as {
        seat: number;
        tileCount: number;
        wallCount: number;
      };
      setState((prev) => ({
        ...prev,
        wallRemaining: wallCount,
        hasDrawn: true,
        players: prev.players.map((p) =>
          p.seat === seat ? { ...p, tileCount } : p
        ),
      }));
    });

    // --- mj_draw_tile (private) ---
    channel.on("broadcast", { event: "mj_draw_tile" }, ({ payload }) => {
      const { playerId, hand, canWin, canKong, kongOptions } = payload as {
        playerId: string;
        tile: Tile;
        hand: Tile[];
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
      setState((prev) => ({
        ...prev,
        myHand: sortTiles([...hand]),
        availableActions: actions,
        hasDrawn: true,
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
        hasDrawn: false,
        availableActions: [],
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
        return {
          ...prev,
          currentTurn: msg.seat,
          lastDiscard: null,
          availableActions: [],
          hasDrawn: true, // after chi/pong/kong player must discard (or already drew for kong)
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
    });

    // --- mj_hand_update (private, after action) ---
    channel.on("broadcast", { event: "mj_hand_update" }, ({ payload }) => {
      const { playerId, hand } = payload as { playerId: string; hand: Tile[] };
      if (playerId !== myId) return;
      setState((prev) => ({
        ...prev,
        myHand: sortTiles([...hand]),
      }));
    });

    // --- mj_pass ---
    channel.on("broadcast", { event: "mj_pass" }, ({ payload }) => {
      const { seat: _seat, allPassed } = payload as {
        seat: number;
        allPassed?: boolean;
      };
      setState((prev) => ({
        ...prev,
        // Always clear actions for the passing player; clear for everyone if all passed
        availableActions:
          prev.mySeat === _seat || allPassed ? [] : prev.availableActions,
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
      // Optimistically remove tile from hand
      setState((prev) => ({
        ...prev,
        myHand: prev.myHand.filter((t) => t.id !== tileId),
        availableActions: [],
      }));
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
      try {
        await api("POST", "/api/mahjong/action", {
          roomId: rid,
          playerId: myId,
          actionType,
          tiles: tiles?.map((t) => t.id),
        });
        setState((prev) => ({ ...prev, availableActions: [] }));
      } catch (err) {
        console.error("[mj] action failed:", err);
      }
    },
    [myId]
  );

  const setRoomIdExternal = useCallback((id: string) => {
    setRoomId(id);
    roomIdRef.current = id;
  }, []);

  const isMyTurn = state.currentTurn === state.mySeat;
  const needsDraw = isMyTurn && !state.hasDrawn && state.status === "playing";
  const needsDiscard = isMyTurn && state.hasDrawn && state.status === "playing";

  return {
    state,
    isHost,
    isMyTurn,
    needsDraw,
    needsDiscard,
    startGame,
    drawTile: drawTileAction,
    discardTile,
    doAction,
    setRoomId: setRoomIdExternal,
    createRoom,
    joinRoom,
  };
}
