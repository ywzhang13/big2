"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getSupabase } from "@/lib/supabase";
import { deal } from "@/lib/deck";
import { detectCombo } from "@/lib/combo";
import { beats } from "@/lib/compare";
import { compareCardsDisplay } from "@/lib/card";
import { calculateScore } from "@/lib/scoring";
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
    scores: {},
  });

  const channelRef = useRef<RealtimeChannel | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const announceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const send = useCallback((msg: GameMessage) => {
    channelRef.current?.send({ type: "broadcast", event: "game", payload: msg });
  }, []);

  useEffect(() => {
    if (!playerName || !roomCode || !myId) return;

    const supabase = getSupabase();
    const channel = supabase.channel(`big2-${roomCode}`, {
      config: { broadcast: { self: true } },
    });

    // Track known players and their join timestamps for seat assignment
    const knownPlayers = new Map<string, { name: string; seat: number; ts: number }>();

    function getOrAssignSeat(playerId: string, name: string, requestedSeat?: number): number {
      const existing = knownPlayers.get(playerId);
      if (existing) return existing.seat;

      // Reject if room is full (4 players already)
      if (knownPlayers.size >= 4) return -1;

      // Find available seat
      const takenSeats = new Set([...knownPlayers.values()].map((p) => p.seat));
      let seat = requestedSeat ?? 0;
      if (takenSeats.has(seat)) {
        seat = 0;
        while (takenSeats.has(seat) && seat < 4) seat++;
      }
      if (seat >= 4) return -1;
      return seat;
    }

    function syncPlayersToState() {
      const players: Player[] = [];
      knownPlayers.forEach((p, id) => {
        players.push({
          id, name: p.name, seat: p.seat,
          cardCount: 0, isFinished: false,
        });
      });
      players.sort((a, b) => a.seat - b.seat);

      setState((prev) => {
        if (prev.status !== "waiting") return prev;
        const mySeat = knownPlayers.get(myId)?.seat ?? prev.mySeat;
        return { ...prev, players, mySeat };
      });
    }

    channel.on("broadcast", { event: "game" }, ({ payload }) => {
      const msg = payload as GameMessage;

      switch (msg.type) {
        case "heartbeat": {
          const seat = getOrAssignSeat(msg.playerId, msg.name, msg.seat);
          if (seat === -1) break; // Room full, ignore
          knownPlayers.set(msg.playerId, { name: msg.name, seat, ts: Date.now() });
          syncPlayersToState();
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
          // Stop heartbeat during game
          if (announceTimerRef.current) {
            clearInterval(announceTimerRef.current);
            announceTimerRef.current = null;
          }
          setState((prev) => ({
            ...prev,
            status: "playing", myHand, mySeat,
            currentTurn: msg.currentTurn, roundStarter: msg.roundStarter,
            lastPlay: null, passCount: 0, players: gamePlayers,
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
            lastPlay: { seat: msg.seat, cards: msg.cards, combo: msg.combo, playerName: msg.playerName },
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
          // When game ends, reveal my remaining hand to everyone
          const myCurrentHand = stateRef.current.myHand;
          if (myCurrentHand.length > 0) {
            setTimeout(() => {
              channel.send({
                type: "broadcast", event: "game",
                payload: { type: "reveal_hand", playerId: myId, hand: myCurrentHand } satisfies GameMessage,
              });
            }, 200);
          }
          setState((prev) => ({
            ...prev, status: "finished",
            winner: msg.winner,
            finishedHands: { ...msg.hands, [myId]: prev.myHand },
          }));
          break;
        }

        case "reveal_hand": {
          setState((prev) => ({
            ...prev,
            finishedHands: { ...prev.finishedHands, [msg.playerId]: msg.hand },
          }));
          break;
        }

        case "continue_game": {
          const myHand = [...(msg.hands[myId] || [])];
          myHand.sort(compareCardsDisplay);
          const gamePlayers: Player[] = msg.players.map((p) => ({
            id: p.id, name: p.name, seat: p.seat,
            cardCount: 13, isFinished: false,
          }));
          const mySeat = gamePlayers.find((p) => p.id === myId)?.seat ?? -1;
          setState((prev) => ({
            ...prev,
            status: "playing", myHand, mySeat,
            currentTurn: msg.currentTurn, roundStarter: msg.roundStarter,
            lastPlay: null, passCount: 0, players: gamePlayers,
            scores: msg.scores,
            finishedHands: undefined, winner: undefined, roundScores: undefined,
          }));
          break;
        }
      }
    });

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        console.log("[big2] connected to room", roomCode);

        // Join immediately — assign seat from known players
        const mySeat = getOrAssignSeat(myId, playerName);
        if (mySeat === -1) {
          setState((prev) => ({ ...prev, status: "finished" as const }));
          return;
        }

        knownPlayers.set(myId, { name: playerName, seat: mySeat, ts: Date.now() });
        syncPlayersToState();

        // Send heartbeat immediately
        channel.send({
          type: "broadcast", event: "game",
          payload: { type: "heartbeat", playerId: myId, name: playerName, seat: mySeat } satisfies GameMessage,
        });

        // Keep sending heartbeat every 1.5 seconds during lobby
        announceTimerRef.current = setInterval(() => {
          const s = stateRef.current;
          if (s.status !== "waiting") {
            if (announceTimerRef.current) clearInterval(announceTimerRef.current);
            return;
          }
          const currentSeat = knownPlayers.get(myId)?.seat ?? 0;
          channel.send({
            type: "broadcast", event: "game",
            payload: { type: "heartbeat", playerId: myId, name: playerName, seat: currentSeat } satisfies GameMessage,
          });
        }, 1500);
      }
    });

    channelRef.current = channel;

    return () => {
      if (announceTimerRef.current) clearInterval(announceTimerRef.current);
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
      if (hands[i].includes("3C")) clubThreeSeat = p.seat;
    });

    send({
      type: "game_start",
      hands: handMap,
      currentTurn: clubThreeSeat,
      roundStarter: clubThreeSeat,
      players: s.players.map((p) => ({ id: p.id, name: p.name, seat: p.seat })),
    });
  }, [send]);

  // Continue game (new round with scores)
  const continueGame = useCallback(() => {
    const s = stateRef.current;
    if (s.players.length !== 4) return;

    // Calculate this round's scores — winner gets abs of losers' total
    const newScores = { ...s.scores };
    let losersTotal = 0;
    const winnerId = s.players.find((p) => p.finishOrder === 1)?.id;
    s.players.forEach((p) => {
      const hand = s.finishedHands?.[p.id] || [];
      const score = calculateScore(hand);
      if (score < 0) losersTotal += score;
      if (p.id !== winnerId) {
        newScores[p.id] = (newScores[p.id] || 0) + score;
      }
    });
    if (winnerId) {
      newScores[winnerId] = (newScores[winnerId] || 0) + Math.abs(losersTotal);
    }

    const hands = deal();
    const handMap: Record<string, Card[]> = {};
    let clubThreeSeat = 0;

    s.players.forEach((p, i) => {
      handMap[p.id] = hands[i];
      if (hands[i].includes("3C")) clubThreeSeat = p.seat;
    });

    send({
      type: "continue_game",
      hands: handMap,
      currentTurn: clubThreeSeat,
      roundStarter: clubThreeSeat,
      players: s.players.map((p) => ({ id: p.id, name: p.name, seat: p.seat })),
      scores: newScores,
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

    if (s.lastPlay && !beats(s.lastPlay.combo, combo)) {
      return { success: false, error: "打不過上家" };
    }

    const newHand = s.myHand.filter((c) => !selectedCards.includes(c));
    const isFinished = newHand.length === 0;
    const finishedCount = s.players.filter((p) => p.isFinished).length;
    const finishOrder = isFinished ? finishedCount + 1 : undefined;
    const me = s.players.find((p) => p.id === myId)!;

    // Game ends when FIRST player finishes (Taiwan rules)
    if (isFinished && finishedCount === 0) {
      // First player to finish — game over!
      send({
        type: "play_cards", seat: s.mySeat, cards: selectedCards, combo,
        playerName: me.name, cardCount: 0,
        isFinished: true, finishOrder: 1, nextTurn: -1,
      });
      // Immediately update local hand before game_over fires
      setState((prev) => ({
        ...prev,
        myHand: newHand,
      }));
      setTimeout(() => {
        send({ type: "game_over", winner: me.name, hands: { [myId]: [] } });
      }, 200);
      return { success: true };
    }

    const finishedSeats = new Set([
      ...s.players.filter((p) => p.isFinished).map((p) => p.seat),
      ...(isFinished ? [s.mySeat] : []),
    ]);
    let next = (s.mySeat + 1) % 4;
    let safety = 0;
    while (finishedSeats.has(next) && safety < 4) { next = (next + 1) % 4; safety++; }

    send({
      type: "play_cards", seat: s.mySeat, cards: selectedCards, combo,
      playerName: me.name, cardCount: newHand.length,
      isFinished, finishOrder, nextTurn: next,
    });

    // Also immediately update local hand to prevent stale state
    setState((prev) => ({
      ...prev,
      myHand: newHand,
    }));

    return { success: true };
  }, [send, myId]);

  // Pass
  const pass = useCallback(() => {
    const s = stateRef.current;
    if (s.currentTurn !== s.mySeat || !s.lastPlay) return;

    const newPassCount = s.passCount + 1;
    const activePlayers = s.players.filter((p) => !p.isFinished);
    const passThreshold = activePlayers.length - 1;

    const finishedSeats = new Set(s.players.filter((p) => p.isFinished).map((p) => p.seat));

    // Find next active player after me
    let next = (s.mySeat + 1) % 4;
    let safety = 0;
    while ((finishedSeats.has(next) || next === s.mySeat) && safety < 4) {
      next = (next + 1) % 4;
      safety++;
    }

    // If next player is the roundStarter (the one who played last), round clears
    const clearRound = next === s.roundStarter || newPassCount >= passThreshold;

    if (clearRound) {
      // Round starter gets free turn
      next = s.roundStarter;
      while (finishedSeats.has(next)) next = (next + 1) % 4;
    }

    send({ type: "pass", seat: s.mySeat, passCount: newPassCount, nextTurn: next, clearRound });
  }, [send]);

  return {
    state, startGame, continueGame, playCards, pass,
    isMyTurn: state.currentTurn === state.mySeat,
    canPass: state.lastPlay !== null && state.currentTurn === state.mySeat,
  };
}
