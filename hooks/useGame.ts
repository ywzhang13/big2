"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getSupabase } from "@/lib/supabase";
import { compareCardsDisplay } from "@/lib/card";
import type { Card } from "@/lib/constants";
import type { GameState, Player } from "@/lib/gameState";
import type { Combo } from "@/lib/combo";
import type { RealtimeChannel } from "@supabase/supabase-js";

function getMyId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem("big2_pid");
  if (!id) {
    id = Math.random().toString(36).slice(2, 10);
    localStorage.setItem("big2_pid", id);
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

export function useGame(roomCode: string, playerName: string) {
  const myId = useRef(getMyId()).current;

  const [state, setState] = useState<GameState>({
    roomCode,
    status: "waiting",
    players: [],
    myId,
    mySeat: -1,
    myHand: [],
    currentTurn: -1,
    lastPlay: null,
    passCount: 0,
    roundStarter: 0,
    scores: {},
    hostId: "",
    readyCheck: false,
    readyPlayers: new Set(),
  });

  const [roomId, setRoomId] = useState<string>("");
  const channelRef = useRef<RealtimeChannel | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const roomIdRef = useRef(roomId);
  roomIdRef.current = roomId;

  // Fetch full state from API (for reconnection)
  const fetchState = useCallback(async (rid: string) => {
    try {
      const data = await api<{
        status: string;
        players: { id: string; name: string; seat: number; cardCount: number; isFinished: boolean; finishOrder?: number }[];
        currentTurn: number;
        lastPlay: { seat: number; cards: Card[]; combo: Combo; playerName: string } | null;
        passCount: number;
        roundStarter: number;
        scores: Record<string, number>;
        hostId: string;
        myHand: Card[];
        mySeat: number;
        winner?: string;
        finishedHands?: Record<string, Card[]>;
        readyCheck?: boolean;
        readyPlayers?: string[];
      }>("GET", `/api/game/state?roomId=${rid}&playerId=${myId}`);

      const hand = [...(data.myHand || [])];
      hand.sort(compareCardsDisplay);

      setState((prev) => ({
        ...prev,
        status: data.status as GameState["status"],
        players: data.players.map((p) => ({
          id: p.id,
          name: p.name,
          seat: p.seat,
          cardCount: p.cardCount,
          isFinished: p.isFinished,
          finishOrder: p.finishOrder,
        })),
        currentTurn: data.currentTurn,
        lastPlay: data.lastPlay,
        passCount: data.passCount,
        roundStarter: data.roundStarter,
        scores: data.scores || {},
        hostId: data.hostId || "",
        myHand: hand,
        mySeat: data.mySeat,
        winner: data.winner,
        finishedHands: data.finishedHands,
        readyCheck: data.readyCheck || false,
        readyPlayers: new Set(data.readyPlayers || []),
      }));
    } catch (err) {
      console.error("[big2] fetchState failed:", err);
    }
  }, [myId]);

  // Subscribe to Supabase Realtime
  useEffect(() => {
    if (!playerName || !roomCode || !myId) return;

    const supabase = getSupabase();
    const channel = supabase.channel(`big2-${roomCode}`, {
      config: { broadcast: { self: true } },
    });

    channel.on("broadcast", { event: "player_joined" }, ({ payload }) => {
      const { playerId, name, seat } = payload as { playerId: string; name: string; seat: number };
      setState((prev) => {
        if (prev.status !== "waiting") return prev;
        const exists = prev.players.find((p) => p.id === playerId);
        let players: Player[];
        if (exists) {
          players = prev.players.map((p) =>
            p.id === playerId ? { ...p, name, seat } : p
          );
        } else {
          players = [...prev.players, { id: playerId, name, seat, cardCount: 0, isFinished: false }];
        }
        players.sort((a, b) => a.seat - b.seat);
        const hostPlayer = players.find((p) => p.seat === 0);
        const mySeat = playerId === myId ? seat : prev.mySeat;
        return { ...prev, players, mySeat, hostId: hostPlayer?.id || prev.hostId };
      });
    });

    channel.on("broadcast", { event: "ready_check" }, () => {
      try { navigator.vibrate?.(200); } catch {}
      setState((prev) => ({
        ...prev,
        readyCheck: true,
        readyPlayers: new Set(),
      }));
    });

    channel.on("broadcast", { event: "player_ready" }, ({ payload }) => {
      const { playerId } = payload as { playerId: string };
      setState((prev) => {
        const newReady = new Set(prev.readyPlayers);
        newReady.add(playerId);
        return { ...prev, readyPlayers: newReady };
      });
    });

    channel.on("broadcast", { event: "game_start" }, ({ payload }) => {
      const msg = payload as {
        currentTurn: number;
        roundStarter: number;
        players: { id: string; name: string; seat: number; cardCount: number }[];
      };
      const gamePlayers: Player[] = msg.players.map((p) => ({
        id: p.id,
        name: p.name,
        seat: p.seat,
        cardCount: p.cardCount,
        isFinished: false,
      }));
      const mySeat = gamePlayers.find((p) => p.id === myId)?.seat ?? -1;
      setState((prev) => ({
        ...prev,
        status: "playing",
        mySeat,
        currentTurn: msg.currentTurn,
        roundStarter: msg.roundStarter,
        lastPlay: null,
        passCount: 0,
        players: gamePlayers,
        readyCheck: false,
        readyPlayers: new Set(),
        finishedHands: undefined,
        winner: undefined,
        roundScores: undefined,
      }));
    });

    channel.on("broadcast", { event: "deal_hand" }, ({ payload }) => {
      const { playerId, hand } = payload as { playerId: string; hand: Card[] };
      if (playerId !== myId) return;
      const sorted = [...hand];
      sorted.sort(compareCardsDisplay);
      setState((prev) => ({ ...prev, myHand: sorted }));
    });

    channel.on("broadcast", { event: "play_cards" }, ({ payload }) => {
      const msg = payload as {
        seat: number;
        cards: Card[];
        combo: Combo;
        playerName: string;
        cardCount: number;
        isFinished: boolean;
        finishOrder?: number;
        nextTurn: number;
        gameOver?: boolean;
        winner?: string;
      };

      if (msg.gameOver && msg.winner) {
        // Reveal own hand for game over screen
        const myCurrentHand = stateRef.current.myHand;
        if (myCurrentHand.length > 0) {
          setTimeout(() => {
            channel.send({
              type: "broadcast",
              event: "reveal_hand",
              payload: { playerId: myId, hand: myCurrentHand },
            });
          }, 200);
        }
        setState((prev) => ({
          ...prev,
          status: "finished",
          winner: msg.winner,
          players: prev.players.map((p) =>
            p.seat === msg.seat
              ? { ...p, cardCount: 0, isFinished: true, finishOrder: 1 }
              : p
          ),
          myHand: msg.seat === prev.mySeat ? [] : prev.myHand,
          finishedHands: { [myId]: msg.seat === prev.mySeat ? [] : prev.myHand },
        }));
        return;
      }

      setState((prev) => ({
        ...prev,
        players: prev.players.map((p) =>
          p.seat === msg.seat
            ? { ...p, cardCount: msg.cardCount, isFinished: msg.isFinished, finishOrder: msg.finishOrder }
            : p
        ),
        myHand: msg.seat === prev.mySeat
          ? prev.myHand.filter((c) => !msg.cards.includes(c))
          : prev.myHand,
        lastPlay: { seat: msg.seat, cards: msg.cards, combo: msg.combo, playerName: msg.playerName },
        passCount: 0,
        currentTurn: msg.nextTurn,
        roundStarter: msg.seat,
      }));
    });

    channel.on("broadcast", { event: "pass" }, ({ payload }) => {
      const msg = payload as { seat: number; passCount: number; nextTurn: number; clearRound: boolean };
      setState((prev) => ({
        ...prev,
        passCount: msg.passCount,
        currentTurn: msg.nextTurn,
        lastPlay: msg.clearRound ? null : prev.lastPlay,
        roundStarter: msg.clearRound ? msg.nextTurn : prev.roundStarter,
      }));
    });

    channel.on("broadcast", { event: "game_over" }, ({ payload }) => {
      const msg = payload as { winner: string; hands: Record<string, Card[]> };
      const myCurrentHand = stateRef.current.myHand;
      if (myCurrentHand.length > 0) {
        setTimeout(() => {
          channel.send({
            type: "broadcast",
            event: "reveal_hand",
            payload: { playerId: myId, hand: myCurrentHand },
          });
        }, 200);
      }
      setState((prev) => ({
        ...prev,
        status: "finished",
        winner: msg.winner,
        finishedHands: { ...msg.hands, [myId]: prev.myHand },
      }));
    });

    channel.on("broadcast", { event: "reveal_hand" }, ({ payload }) => {
      const { playerId, hand } = payload as { playerId: string; hand: Card[] };
      setState((prev) => ({
        ...prev,
        finishedHands: { ...prev.finishedHands, [playerId]: hand },
      }));
    });

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        console.log("[big2] connected to room", roomCode);
        // If we already have a roomId, fetch state for reconnection
        const rid = roomIdRef.current;
        if (rid) {
          fetchState(rid);
        }
      }
    });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [roomCode, playerName, myId, fetchState]);

  // Host = seat 0 player
  const isHost = state.hostId === myId || (state.hostId === "" && state.mySeat === 0);

  // Start game - sends ready check (host only)
  const startGame = useCallback(async () => {
    const s = stateRef.current;
    if (s.players.length !== 4) return;
    if (s.status !== "waiting" || s.readyCheck) return;
    if (s.hostId !== myId) return;
    try {
      await api("POST", "/api/game/ready-check", {
        roomId: roomIdRef.current,
        playerId: myId,
      });
    } catch (err) {
      console.error("[big2] ready-check failed:", err);
    }
  }, [myId]);

  // Confirm ready
  const confirmReady = useCallback(async () => {
    try {
      const data = await api<{ allReady: boolean }>("POST", "/api/game/ready", {
        roomId: roomIdRef.current,
        playerId: myId,
      });
      // If all ready, the backend will broadcast game_start + deal_hand
      if (data.allReady) {
        console.log("[big2] all players ready, game starting...");
      }
    } catch (err) {
      console.error("[big2] ready failed:", err);
    }
  }, [myId]);

  // dealAndStart - in API mode, this is handled by the backend when all players are ready
  // Keep the function for interface compatibility but it's a no-op
  const dealAndStart = useCallback(() => {
    // The backend auto-deals when all players confirm ready.
    // This is kept for interface compatibility.
  }, []);

  // Continue game (new round)
  const continueGame = useCallback(async () => {
    try {
      await api("POST", "/api/game/continue", {
        roomId: roomIdRef.current,
        playerId: myId,
      });
    } catch (err) {
      console.error("[big2] continue failed:", err);
    }
  }, [myId]);

  // Play cards
  const playCards = useCallback((selectedCards: Card[]): { success: boolean; error?: string } => {
    const s = stateRef.current;
    if (s.currentTurn !== s.mySeat) return { success: false, error: "不是你的回合" };

    // Optimistically remove cards from hand
    const newHand = s.myHand.filter((c) => !selectedCards.includes(c));
    setState((prev) => ({ ...prev, myHand: newHand }));

    // Fire and forget the API call, but handle errors
    api<{ success: boolean; error?: string; gameOver?: boolean }>("POST", "/api/game/play", {
      roomId: roomIdRef.current,
      playerId: myId,
      cards: selectedCards,
    }).then((data) => {
      if (!data.success) {
        // Revert optimistic update
        setState((prev) => ({
          ...prev,
          myHand: [...prev.myHand, ...selectedCards].sort(compareCardsDisplay),
        }));
        console.error("[big2] play rejected:", data.error);
      }
      // If success, the broadcast will update state automatically
    }).catch((err) => {
      // Revert optimistic update
      setState((prev) => ({
        ...prev,
        myHand: [...prev.myHand, ...selectedCards].sort(compareCardsDisplay),
      }));
      console.error("[big2] play API error:", err);
    });

    return { success: true };
  }, [myId]);

  // Pass
  const pass = useCallback(async () => {
    const s = stateRef.current;
    if (s.currentTurn !== s.mySeat || !s.lastPlay) return;
    try {
      const data = await api<{ success: boolean; error?: string }>("POST", "/api/game/pass", {
        roomId: roomIdRef.current,
        playerId: myId,
      });
      if (!data.success) {
        console.error("[big2] pass rejected:", data.error);
      }
    } catch (err) {
      console.error("[big2] pass API error:", err);
    }
  }, [myId]);

  // Expose setRoomId for the page to call after create/join
  const setRoomIdExternal = useCallback((id: string) => {
    setRoomId(id);
    roomIdRef.current = id;
  }, []);

  return {
    state,
    isHost,
    startGame,
    confirmReady,
    dealAndStart,
    continueGame,
    playCards,
    pass,
    isMyTurn: state.currentTurn === state.mySeat,
    canPass: state.lastPlay !== null && state.currentTurn === state.mySeat,
    setRoomId: setRoomIdExternal,
  };
}
