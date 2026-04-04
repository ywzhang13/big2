"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getSupabase } from "@/lib/supabase";
import { deal } from "@/lib/deck";
import { detectCombo } from "@/lib/combo";
import { beats } from "@/lib/compare";
import { compareCards } from "@/lib/card";
import type { Card } from "@/lib/constants";
import type { GameState, GameMessage, Player } from "@/lib/gameState";
import type { RealtimeChannel } from "@supabase/supabase-js";

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

export function useGame(roomCode: string, playerName: string) {
  const [state, setState] = useState<GameState>({
    roomCode,
    status: "waiting",
    players: [],
    myId: "",
    mySeat: -1,
    myHand: [],
    currentTurn: -1,
    lastPlay: null,
    passCount: 0,
    roundStarter: 0,
  });

  const channelRef = useRef<RealtimeChannel | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const myIdRef = useRef("");
  const joinedRef = useRef(false);

  // Generate stable player ID
  useEffect(() => {
    let id = localStorage.getItem(`big2_pid`);
    if (!id) {
      id = genId();
      localStorage.setItem(`big2_pid`, id);
    }
    myIdRef.current = id;
    setState((s) => ({ ...s, myId: id! }));
  }, []);

  // Broadcast helper
  const broadcast = useCallback((msg: GameMessage) => {
    channelRef.current?.send({ type: "broadcast", event: "game", payload: msg });
  }, []);

  // Handle broadcast messages (game actions only, not player tracking)
  const handleMessage = useCallback((msg: GameMessage) => {
    switch (msg.type) {
      case "game_start": {
        const myHand = msg.hands[myIdRef.current] || [];
        // Sort hand by rank then suit (3C, 3D, 3H, 3S, 4C, ...)
        myHand.sort(compareCards);
        setState((prev) => ({
          ...prev,
          status: "playing",
          myHand,
          currentTurn: msg.currentTurn,
          roundStarter: msg.roundStarter,
          lastPlay: null,
          passCount: 0,
          players: prev.players.map((p) => ({
            ...p,
            cardCount: 13,
            isFinished: false,
            finishOrder: undefined,
          })),
        }));
        break;
      }
      case "play_cards": {
        setState((prev) => {
          const newPlayers = prev.players.map((p) =>
            p.seat === msg.seat
              ? { ...p, cardCount: msg.cardCount, isFinished: msg.isFinished, finishOrder: msg.finishOrder }
              : p
          );
          const newHand = msg.seat === prev.mySeat
            ? prev.myHand.filter((c) => !msg.cards.includes(c))
            : prev.myHand;
          return {
            ...prev,
            players: newPlayers,
            myHand: newHand,
            lastPlay: { seat: msg.seat, cards: msg.cards, combo: msg.combo, playerName: msg.playerName },
            passCount: 0,
          };
        });
        break;
      }
      case "turn_change": {
        setState((prev) => ({
          ...prev,
          currentTurn: msg.currentTurn,
          passCount: msg.passCount,
          lastPlay: msg.lastPlay,
          roundStarter: msg.roundStarter,
        }));
        break;
      }
      case "round_clear": {
        setState((prev) => ({
          ...prev,
          currentTurn: msg.currentTurn,
          roundStarter: msg.roundStarter,
          lastPlay: null,
          passCount: 0,
        }));
        break;
      }
      case "game_over": {
        setState((prev) => ({
          ...prev,
          status: "finished",
          winner: msg.winner,
          finishedHands: msg.hands,
        }));
        break;
      }
      default:
        break;
    }
  }, []);

  // Connect to Supabase Realtime channel with Presence
  useEffect(() => {
    if (!myIdRef.current || !playerName || !roomCode) return;
    if (joinedRef.current) return;
    joinedRef.current = true;

    const supabase = getSupabase();
    const channel = supabase.channel(`big2:${roomCode}`, {
      config: { broadcast: { self: true }, presence: { key: myIdRef.current } },
    });

    // Handle presence sync — rebuild player list from presence state
    channel.on("presence", { event: "sync" }, () => {
      const presenceState = channel.presenceState();
      const players: Player[] = [];
      const entries = Object.entries(presenceState);
      // Sort by join order (presence_ref or first seen)
      entries.forEach(([key, presences]) => {
        const p = presences[0] as unknown as { name: string; seat: number };
        if (p && typeof p.name === "string") {
          players.push({
            id: key,
            name: p.name,
            seat: p.seat,
            cardCount: 0,
            isFinished: false,
          });
        }
      });
      // Sort by seat
      players.sort((a, b) => a.seat - b.seat);

      setState((prev) => {
        // Preserve game state (cardCount, isFinished etc) if playing
        if (prev.status === "playing" || prev.status === "finished") {
          const updated = players.map((np) => {
            const existing = prev.players.find((ep) => ep.id === np.id);
            return existing || np;
          });
          return { ...prev, players: updated };
        }
        // Update mySeat
        const me = players.find((p) => p.id === myIdRef.current);
        return { ...prev, players, mySeat: me?.seat ?? prev.mySeat };
      });
    });

    // Handle broadcast messages
    channel.on("broadcast", { event: "game" }, ({ payload }) => {
      handleMessage(payload as GameMessage);
    });

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        // Determine seat: count existing presence entries
        const existing = channel.presenceState();
        const takenSeats = new Set<number>();
        Object.values(existing).forEach((presences) => {
          const p = presences[0] as unknown as { seat: number };
          if (p && typeof p.seat === "number") takenSeats.add(p.seat);
        });
        let seat = 0;
        while (takenSeats.has(seat) && seat < 4) seat++;

        setState((prev) => ({ ...prev, mySeat: seat }));

        // Track presence
        await channel.track({ name: playerName, seat });
      }
    });

    channelRef.current = channel;

    return () => {
      channel.unsubscribe();
      channelRef.current = null;
      joinedRef.current = false;
    };
  }, [roomCode, playerName, handleMessage]);

  // Start game
  const startGame = useCallback(() => {
    const s = stateRef.current;
    if (s.players.length !== 4) return;

    const hands = deal();
    const handMap: Record<string, Card[]> = {};
    let clubThreeSeat = 0;

    s.players.forEach((p, i) => {
      handMap[p.id] = hands[i];
      if (hands[i].includes("3C")) {
        clubThreeSeat = p.seat;
      }
    });

    broadcast({
      type: "game_start",
      hands: handMap,
      currentTurn: clubThreeSeat,
      roundStarter: clubThreeSeat,
    });
  }, [broadcast]);

  // Play cards
  const playCards = useCallback((selectedCards: Card[]) => {
    const s = stateRef.current;
    if (s.currentTurn !== s.mySeat) return { success: false, error: "不是你的回合" };

    const isFirstTurn = s.players.every((p) => p.cardCount === 13);
    const isNewRound = s.lastPlay === null;

    // First turn must include 3C
    if (isFirstTurn && s.myHand.includes("3C") && !selectedCards.includes("3C")) {
      return { success: false, error: "第一手必須包含梅花3" };
    }

    const combo = detectCombo(selectedCards);
    if (!combo) return { success: false, error: "無效的牌型" };

    // Must beat last play (if not new round)
    if (!isNewRound && s.lastPlay) {
      if (!beats(s.lastPlay.combo, combo)) {
        return { success: false, error: "打不過上家" };
      }
    }

    const newHand = s.myHand.filter((c) => !selectedCards.includes(c));
    const isFinished = newHand.length === 0;
    const finishedCount = s.players.filter((p) => p.isFinished).length;
    const finishOrder = isFinished ? finishedCount + 1 : undefined;
    const me = s.players.find((p) => p.id === s.myId)!;

    broadcast({
      type: "play_cards",
      seat: s.mySeat,
      cards: selectedCards,
      combo,
      playerName: me.name,
      cardCount: newHand.length,
      isFinished,
      finishOrder,
    });

    // Check game over
    const activePlayers = s.players.filter((p) => !p.isFinished && !(p.seat === s.mySeat && isFinished));
    if (activePlayers.length <= 1) {
      const allHands: Record<string, Card[]> = {};
      s.players.forEach((p) => {
        allHands[p.id] = p.id === s.myId ? newHand : [];
      });
      broadcast({ type: "game_over", winner: me.name, hands: allHands });
    } else {
      // Next turn
      let next = (s.mySeat + 1) % 4;
      const finishedSeats = new Set([
        ...s.players.filter((p) => p.isFinished).map((p) => p.seat),
        ...(isFinished ? [s.mySeat] : []),
      ]);
      while (finishedSeats.has(next)) next = (next + 1) % 4;

      broadcast({
        type: "turn_change",
        currentTurn: next,
        passCount: 0,
        lastPlay: { seat: s.mySeat, cards: selectedCards, combo, playerName: me.name },
        roundStarter: s.mySeat,
      });
    }

    return { success: true };
  }, [broadcast]);

  // Pass
  const pass = useCallback(() => {
    const s = stateRef.current;
    if (s.currentTurn !== s.mySeat) return;
    if (!s.lastPlay) return;

    const newPassCount = s.passCount + 1;
    broadcast({ type: "pass", seat: s.mySeat });

    const activePlayers = s.players.filter((p) => !p.isFinished);
    const passThreshold = activePlayers.length - 1;

    if (newPassCount >= passThreshold) {
      let starter = s.roundStarter;
      const finishedSeats = new Set(s.players.filter((p) => p.isFinished).map((p) => p.seat));
      while (finishedSeats.has(starter)) starter = (starter + 1) % 4;
      broadcast({ type: "round_clear", currentTurn: starter, roundStarter: starter });
    } else {
      let next = (s.mySeat + 1) % 4;
      const finishedSeats = new Set(s.players.filter((p) => p.isFinished).map((p) => p.seat));
      while (finishedSeats.has(next)) next = (next + 1) % 4;
      if (next === s.roundStarter && newPassCount < passThreshold) {
        next = (next + 1) % 4;
        while (finishedSeats.has(next)) next = (next + 1) % 4;
      }
      broadcast({
        type: "turn_change",
        currentTurn: next,
        passCount: newPassCount,
        lastPlay: s.lastPlay,
        roundStarter: s.roundStarter,
      });
    }
  }, [broadcast]);

  return {
    state,
    startGame,
    playCards,
    pass,
    isMyTurn: state.currentTurn === state.mySeat,
    canPass: state.lastPlay !== null && state.currentTurn === state.mySeat,
  };
}
