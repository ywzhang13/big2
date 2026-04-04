"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getSupabase } from "@/lib/supabase";
import { deal } from "@/lib/deck";
import { detectCombo } from "@/lib/combo";
import { beats } from "@/lib/compare";
import { validatePlay } from "@/lib/rules";
import type { Card } from "@/lib/constants";
import type { GameState, GameMessage, Player } from "@/lib/gameState";

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

  const channelRef = useRef<ReturnType<ReturnType<typeof getSupabase>["channel"]> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Initialize player ID
  const myIdRef = useRef("");
  useEffect(() => {
    let id = localStorage.getItem(`big2_id_${roomCode}`);
    if (!id) {
      id = genId();
      localStorage.setItem(`big2_id_${roomCode}`, id);
    }
    myIdRef.current = id;
    setState((s) => ({ ...s, myId: id! }));
  }, [roomCode]);

  // Broadcast helper
  const broadcast = useCallback((msg: GameMessage) => {
    channelRef.current?.send({ type: "broadcast", event: "game", payload: msg });
  }, []);

  // Handle incoming messages
  const handleMessage = useCallback((msg: GameMessage) => {
    const s = stateRef.current;

    switch (msg.type) {
      case "player_joined": {
        setState((prev) => {
          if (prev.players.find((p) => p.id === msg.player.id)) return prev;
          return {
            ...prev,
            players: [...prev.players, { ...msg.player, cardCount: 0, isFinished: false }],
          };
        });
        break;
      }
      case "player_left": {
        setState((prev) => ({
          ...prev,
          players: prev.players.filter((p) => p.id !== msg.playerId),
        }));
        break;
      }
      case "game_start": {
        const myHand = msg.hands[myIdRef.current] || [];
        setState((prev) => ({
          ...prev,
          status: "playing",
          myHand: myHand.sort(),
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
          const newPlayers = prev.players.map((p) => {
            if (p.seat === msg.seat) {
              return {
                ...p,
                cardCount: msg.cardCount,
                isFinished: msg.isFinished,
                finishOrder: msg.finishOrder,
              };
            }
            return p;
          });
          // Remove cards from my hand if it was me
          let newHand = prev.myHand;
          if (msg.seat === prev.mySeat) {
            newHand = prev.myHand.filter((c) => !msg.cards.includes(c));
          }
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
      case "pass": {
        // handled by turn_change
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
      case "sync_request": {
        // Only host (seat 0) responds
        if (s.mySeat === 0 && s.status === "waiting") {
          broadcast({
            type: "sync_response",
            state: {
              players: s.players,
              status: s.status,
              currentTurn: s.currentTurn,
              lastPlay: s.lastPlay,
              passCount: s.passCount,
              roundStarter: s.roundStarter,
            },
          });
        }
        break;
      }
      case "sync_response": {
        setState((prev) => {
          if (prev.players.length === 0) {
            return {
              ...prev,
              players: msg.state.players,
              status: msg.state.status,
              currentTurn: msg.state.currentTurn,
              lastPlay: msg.state.lastPlay,
              passCount: msg.state.passCount,
              roundStarter: msg.state.roundStarter,
            };
          }
          return prev;
        });
        break;
      }
    }
  }, [broadcast]);

  // Connect to channel
  useEffect(() => {
    if (!myIdRef.current) return;

    const supabase = getSupabase();
    const channel = supabase.channel(`big2:${roomCode}`, {
      config: { broadcast: { self: true } },
    });

    channel.on("broadcast", { event: "game" }, ({ payload }) => {
      handleMessage(payload as GameMessage);
    });

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        // Join the room
        const seat = stateRef.current.players.length;
        const me: Player = {
          id: myIdRef.current,
          name: playerName,
          seat,
          cardCount: 0,
          isFinished: false,
        };

        setState((prev) => {
          if (prev.players.find((p) => p.id === myIdRef.current)) return prev;
          return { ...prev, mySeat: seat, players: [...prev.players, me] };
        });

        channel.send({
          type: "broadcast",
          event: "game",
          payload: {
            type: "player_joined",
            player: { id: myIdRef.current, name: playerName, seat },
          } satisfies GameMessage,
        });

        // Request sync from host
        setTimeout(() => {
          channel.send({
            type: "broadcast",
            event: "game",
            payload: { type: "sync_request", fromId: myIdRef.current } satisfies GameMessage,
          });
        }, 500);
      }
    });

    channelRef.current = channel;

    return () => {
      channel.unsubscribe();
      channelRef.current = null;
    };
  }, [roomCode, playerName, handleMessage]);

  // Start game (host only)
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

    const isFirstTurn = s.status === "playing" && s.lastPlay === null && s.passCount === 0 &&
      s.players.every((p) => p.cardCount === 13 || p.cardCount === 0);
    const isNewRound = s.lastPlay === null;

    const lastCombo = s.lastPlay?.combo || null;
    const validation = validatePlay(s.myHand, selectedCards, lastCombo, isFirstTurn && s.myHand.includes("3C"), isNewRound);
    if (!validation.valid) return { success: false, error: validation.error };

    const combo = detectCombo(selectedCards)!;
    const newHand = s.myHand.filter((c) => !selectedCards.includes(c));
    const isFinished = newHand.length === 0;

    const finishedCount = s.players.filter((p) => p.isFinished).length;
    const finishOrder = isFinished ? finishedCount + 1 : undefined;

    const me = s.players.find((p) => p.id === s.myId)!;

    // Broadcast play
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

    // Calculate next turn
    const activePlayers = s.players.filter((p) => !p.isFinished && !(p.seat === s.mySeat && isFinished));
    if (activePlayers.length <= 1) {
      // Game over
      const allHands: Record<string, Card[]> = {};
      s.players.forEach((p) => {
        if (p.id === s.myId) {
          allHands[p.id] = newHand;
        } else {
          allHands[p.id] = []; // other players' hands are unknown, will be filled by their own state
        }
      });
      broadcast({
        type: "game_over",
        winner: me.name,
        hands: allHands,
      });
    } else {
      // Next turn
      let next = (s.mySeat + 1) % 4;
      const allFinishedSeats = new Set(
        [...s.players.filter((p) => p.isFinished).map((p) => p.seat), ...(isFinished ? [s.mySeat] : [])]
      );
      while (allFinishedSeats.has(next)) {
        next = (next + 1) % 4;
      }

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
    if (!s.lastPlay) return; // Can't pass if no one has played

    const newPassCount = s.passCount + 1;

    broadcast({ type: "pass", seat: s.mySeat });

    // Check if round should clear (all other active players passed)
    const activePlayers = s.players.filter((p) => !p.isFinished);
    const passThreshold = activePlayers.length - 1; // everyone except the last player who played

    if (newPassCount >= passThreshold) {
      // Round clear - give turn back to round starter
      let starter = s.roundStarter;
      const finishedSeats = new Set(s.players.filter((p) => p.isFinished).map((p) => p.seat));
      while (finishedSeats.has(starter)) {
        starter = (starter + 1) % 4;
      }
      broadcast({
        type: "round_clear",
        currentTurn: starter,
        roundStarter: starter,
      });
    } else {
      let next = (s.mySeat + 1) % 4;
      const finishedSeats = new Set(s.players.filter((p) => p.isFinished).map((p) => p.seat));
      while (finishedSeats.has(next)) {
        next = (next + 1) % 4;
      }
      // Skip the round starter (they already played the current cards)
      if (next === s.roundStarter && newPassCount < passThreshold) {
        next = (next + 1) % 4;
        while (finishedSeats.has(next)) {
          next = (next + 1) % 4;
        }
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
