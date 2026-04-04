"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getSupabase } from "@/lib/supabase";
import { deal } from "@/lib/deck";
import { detectCombo } from "@/lib/combo";
import { beats } from "@/lib/compare";
import { compareCardsDisplay } from "@/lib/card";
import type { Card } from "@/lib/constants";
import type { GameState, GameMessage, Player } from "@/lib/gameState";
import type { RealtimeChannel } from "@supabase/supabase-js";

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

function getMyId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem("big2_pid");
  if (!id) {
    id = genId();
    localStorage.setItem("big2_pid", id);
  }
  return id;
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
  });

  const channelRef = useRef<RealtimeChannel | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Send a broadcast message
  const send = useCallback((msg: GameMessage) => {
    const ch = channelRef.current;
    if (!ch) return;
    ch.send({ type: "broadcast", event: "game", payload: msg });
  }, []);

  // Connect to channel
  useEffect(() => {
    if (!playerName || !roomCode || !myId) return;

    const supabase = getSupabase();
    const channel = supabase.channel(`big2-${roomCode}`, {
      config: { broadcast: { self: true } },
    });

    channel.on("broadcast", { event: "game" }, ({ payload }) => {
      const msg = payload as GameMessage;

      switch (msg.type) {
        case "player_joined": {
          setState((prev) => {
            // Don't add duplicates
            if (prev.players.find((p) => p.id === msg.player.id)) {
              // But update name if changed
              return {
                ...prev,
                players: prev.players.map((p) =>
                  p.id === msg.player.id ? { ...p, name: msg.player.name } : p
                ),
              };
            }
            const newPlayer: Player = {
              ...msg.player,
              cardCount: 0,
              isFinished: false,
            };
            const newPlayers = [...prev.players, newPlayer].sort((a, b) => a.seat - b.seat);
            const mySeat = msg.player.id === myId ? msg.player.seat : prev.mySeat;
            return { ...prev, players: newPlayers, mySeat };
          });
          break;
        }

        case "game_start": {
          const myHand = [...(msg.hands[myId] || [])];
          myHand.sort(compareCardsDisplay);
          const gamePlayers: Player[] = msg.players.map((p) => ({
            id: p.id, name: p.name, seat: p.seat,
            cardCount: 13, isFinished: false,
          }));
          const mySeat = gamePlayers.find((p) => p.id === myId)?.seat ?? -1;
          setState((prev) => ({
            ...prev,
            status: "playing",
            myHand,
            mySeat,
            currentTurn: msg.currentTurn,
            roundStarter: msg.roundStarter,
            lastPlay: null,
            passCount: 0,
            players: gamePlayers,
          }));
          break;
        }

        case "play_cards": {
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
            lastPlay: {
              seat: msg.seat, cards: msg.cards,
              combo: msg.combo, playerName: msg.playerName,
            },
            passCount: 0,
            currentTurn: msg.nextTurn,
            roundStarter: msg.seat,
          }));
          break;
        }

        case "pass": {
          setState((prev) => ({
            ...prev,
            passCount: msg.passCount,
            currentTurn: msg.nextTurn,
            lastPlay: msg.clearRound ? null : prev.lastPlay,
            roundStarter: msg.clearRound ? msg.nextTurn : prev.roundStarter,
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
      }
    });

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        console.log("[big2] subscribed to channel big2-" + roomCode);

        // Announce self to room
        // First, request existing players
        channel.send({
          type: "broadcast", event: "game",
          payload: { type: "request_players", fromId: myId } satisfies GameMessage,
        });

        // Wait a moment then join (so we can count existing players)
        setTimeout(() => {
          const s = stateRef.current;
          if (s.mySeat >= 0) return; // already joined

          // Find next available seat
          const takenSeats = new Set(s.players.map((p) => p.seat));
          let seat = 0;
          while (takenSeats.has(seat)) seat++;
          if (seat >= 4) return; // room full

          setState((prev) => ({ ...prev, mySeat: seat }));

          channel.send({
            type: "broadcast", event: "game",
            payload: {
              type: "player_joined",
              player: { id: myId, name: playerName, seat },
            } satisfies GameMessage,
          });
        }, 300);
      }
    });

    // Also handle request_players — existing players re-announce themselves
    channel.on("broadcast", { event: "game" }, ({ payload }) => {
      const msg = payload as GameMessage & { type: string };
      if (msg.type === "request_players") {
        const s = stateRef.current;
        if (s.mySeat >= 0 && (msg as { fromId: string }).fromId !== myId) {
          // Re-announce self
          setTimeout(() => {
            channel.send({
              type: "broadcast", event: "game",
              payload: {
                type: "player_joined",
                player: { id: myId, name: playerName, seat: s.mySeat },
              } satisfies GameMessage,
            });
          }, 100);
        }
      }
    });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [roomCode, playerName, myId]);

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

    send({
      type: "game_start",
      hands: handMap,
      currentTurn: clubThreeSeat,
      roundStarter: clubThreeSeat,
      players: s.players.map((p) => ({ id: p.id, name: p.name, seat: p.seat })),
    });
  }, [send]);

  // Play cards
  const playCards = useCallback((selectedCards: Card[]) => {
    const s = stateRef.current;
    if (s.currentTurn !== s.mySeat) return { success: false, error: "不是你的回合" };

    const isFirstTurn = s.players.every((p) => p.cardCount === 13);
    if (isFirstTurn && s.myHand.includes("3C") && !selectedCards.includes("3C")) {
      return { success: false, error: "第一手必須包含梅花3" };
    }

    const combo = detectCombo(selectedCards);
    if (!combo) return { success: false, error: "無效的牌型" };

    const isNewRound = s.lastPlay === null;
    if (!isNewRound && s.lastPlay && !beats(s.lastPlay.combo, combo)) {
      return { success: false, error: "打不過上家" };
    }

    const newHand = s.myHand.filter((c) => !selectedCards.includes(c));
    const isFinished = newHand.length === 0;
    const finishedCount = s.players.filter((p) => p.isFinished).length;
    const finishOrder = isFinished ? finishedCount + 1 : undefined;
    const me = s.players.find((p) => p.id === myId)!;

    // Calculate next turn
    const finishedSeats = new Set([
      ...s.players.filter((p) => p.isFinished).map((p) => p.seat),
      ...(isFinished ? [s.mySeat] : []),
    ]);
    let next = (s.mySeat + 1) % 4;
    while (finishedSeats.has(next) && next !== s.mySeat) next = (next + 1) % 4;

    const activePlayers = s.players.filter((p) => !p.isFinished && !(p.seat === s.mySeat && isFinished));

    // Send single combined message
    send({
      type: "play_cards",
      seat: s.mySeat,
      cards: selectedCards,
      combo,
      playerName: me.name,
      cardCount: newHand.length,
      isFinished,
      finishOrder,
      nextTurn: next,
    });

    if (activePlayers.length <= 1) {
      const allHands: Record<string, Card[]> = {};
      s.players.forEach((p) => {
        allHands[p.id] = p.id === myId ? newHand : [];
      });
      setTimeout(() => send({ type: "game_over", winner: me.name, hands: allHands }), 100);
    }

    return { success: true };
  }, [send, myId]);

  // Pass
  const pass = useCallback(() => {
    const s = stateRef.current;
    if (s.currentTurn !== s.mySeat || !s.lastPlay) return;

    const newPassCount = s.passCount + 1;
    const activePlayers = s.players.filter((p) => !p.isFinished);
    const passThreshold = activePlayers.length - 1;
    const clearRound = newPassCount >= passThreshold;

    const finishedSeats = new Set(s.players.filter((p) => p.isFinished).map((p) => p.seat));

    let next: number;
    if (clearRound) {
      next = s.roundStarter;
      while (finishedSeats.has(next)) next = (next + 1) % 4;
    } else {
      next = (s.mySeat + 1) % 4;
      while (finishedSeats.has(next)) next = (next + 1) % 4;
      // Skip round starter if not clear yet
      if (next === s.roundStarter) {
        next = (next + 1) % 4;
        while (finishedSeats.has(next)) next = (next + 1) % 4;
      }
    }

    send({
      type: "pass",
      seat: s.mySeat,
      passCount: newPassCount,
      nextTurn: next,
      clearRound,
    });
  }, [send]);

  return {
    state,
    startGame,
    playCards,
    pass,
    isMyTurn: state.currentTurn === state.mySeat,
    canPass: state.lastPlay !== null && state.currentTurn === state.mySeat,
  };
}
