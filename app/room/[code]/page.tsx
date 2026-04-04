"use client";

import { use, useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { detectCombo } from "@/lib/combo";
import { compareCards } from "@/lib/card";
import type { Card as CardType } from "@/lib/constants";
import type { ComboType } from "@/lib/constants";
import Hand from "@/components/Hand";
import PlayArea from "@/components/PlayArea";
import PlayerSlot from "@/components/PlayerSlot";
import GameOver from "@/components/GameOver";

interface LastPlay {
  cards: string[];
  type: ComboType;
  seat: number;
}

interface PlayerInfo {
  id: string;
  seat: number;
  name: string;
  card_count: number;
  hand: string[];
  is_finished: boolean;
  finish_order: number | null;
}

interface GameState {
  status: "waiting" | "playing" | "finished";
  currentTurn: number;
  lastPlay: LastPlay | null;
  roundStarter: number;
  passCount: number;
}

const COMBO_LABELS: Record<string, string> = {
  single: "單張",
  pair: "對子",
  straight: "順子",
  fullHouse: "葫蘆",
  fourOfAKind: "鐵支",
  straightFlush: "同花順",
};

export default function RoomPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = use(params);
  const router = useRouter();

  // Session state from localStorage
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [mySeat, setMySeat] = useState<number>(-1);
  const [myName, setMyName] = useState<string>("");

  // Join form state (for players who arrived via link)
  const [joinName, setJoinName] = useState("");
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState("");

  // Game state
  const [gameState, setGameState] = useState<GameState>({
    status: "waiting",
    currentTurn: -1,
    lastPlay: null,
    roundStarter: -1,
    passCount: 0,
  });
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [myHand, setMyHand] = useState<string[]>([]);
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState("");
  const [gameResults, setGameResults] = useState<
    { seat: number; name: string; hand: string[]; finishOrder: number | null }[] | null
  >(null);
  const [lastAction, setLastAction] = useState<{ seat: number; action: "pass" } | null>(null);
  const [isFirstTurn, setIsFirstTurn] = useState(true);

  const channelRef = useRef<ReturnType<ReturnType<typeof getSupabase>["channel"]> | null>(null);

  // Load session from localStorage
  useEffect(() => {
    const st = localStorage.getItem("big2_sessionToken");
    const pid = localStorage.getItem("big2_playerId");
    const rid = localStorage.getItem("big2_roomId");
    const seat = localStorage.getItem("big2_seat");
    const nm = localStorage.getItem("big2_name");
    if (st) setSessionToken(st);
    if (pid) setPlayerId(pid);
    if (rid) setRoomId(rid);
    if (seat) setMySeat(parseInt(seat, 10));
    if (nm) setMyName(nm);
  }, []);

  // Fetch room state from DB
  const fetchGameState = useCallback(async () => {
    const rid = roomId || localStorage.getItem("big2_roomId");
    const st = sessionToken || localStorage.getItem("big2_sessionToken");
    if (!rid) return;

    const supabase = getSupabase();

    // Fetch room
    const { data: room } = await supabase
      .from("big2_rooms")
      .select("status, current_turn, last_play, round_starter, pass_count")
      .eq("id", rid)
      .single();

    if (room) {
      setGameState({
        status: room.status,
        currentTurn: room.current_turn ?? -1,
        lastPlay: room.last_play,
        roundStarter: room.round_starter ?? -1,
        passCount: room.pass_count ?? 0,
      });

      // Track first turn (no plays have been made yet)
      if (room.status === "playing" && room.last_play === null && room.pass_count === 0) {
        setIsFirstTurn(true);
      } else {
        setIsFirstTurn(false);
      }
    }

    // Fetch players
    const { data: playerRows } = await supabase
      .from("big2_players")
      .select("id, seat, name, card_count, hand, is_finished, finish_order")
      .eq("room_id", rid)
      .order("seat", { ascending: true });

    if (playerRows) {
      setPlayers(playerRows);
      // Find my hand
      if (st) {
        // Also refetch my own player row to get hand
        const { data: myPlayer } = await supabase
          .from("big2_players")
          .select("hand, seat, id, name")
          .eq("room_id", rid)
          .eq("session_token", st)
          .single();
        if (myPlayer) {
          const sorted = [...myPlayer.hand].sort(compareCards);
          setMyHand(sorted);
          setMySeat(myPlayer.seat);
          setPlayerId(myPlayer.id);
          setMyName(myPlayer.name);
        }
      }
    }
  }, [roomId, sessionToken]);

  // Initial fetch + poll
  useEffect(() => {
    fetchGameState();
  }, [fetchGameState]);

  // Subscribe to Supabase Realtime
  useEffect(() => {
    if (!code) return;
    const supabase = getSupabase();
    const channel = supabase.channel(`room:${code}`);

    channel
      .on("broadcast", { event: "player_joined" }, () => {
        fetchGameState();
      })
      .on("broadcast", { event: "game_start" }, (payload) => {
        const currentTurn = payload.payload?.currentTurn ?? 0;
        setGameState((prev) => ({
          ...prev,
          status: "playing",
          currentTurn,
          lastPlay: null,
          passCount: 0,
        }));
        setIsFirstTurn(true);
        fetchGameState();
      })
      .on("broadcast", { event: "play_cards" }, (payload) => {
        const { seat, cards, comboType, cardsLeft } = payload.payload ?? {};
        setGameState((prev) => ({
          ...prev,
          lastPlay: { cards, type: comboType, seat },
          passCount: 0,
          roundStarter: seat,
        }));
        setIsFirstTurn(false);
        setLastAction(null);
        // Update player card counts
        setPlayers((prev) =>
          prev.map((p) =>
            p.seat === seat
              ? { ...p, card_count: cardsLeft, is_finished: cardsLeft === 0 }
              : p
          )
        );
        // If it's my play, remove cards from hand
        if (seat === mySeat) {
          setMyHand((prev) =>
            prev.filter((c) => !cards.includes(c))
          );
          setSelectedCards([]);
        }
      })
      .on("broadcast", { event: "pass" }, (payload) => {
        const { seat } = payload.payload ?? {};
        setLastAction({ seat, action: "pass" });
        setGameState((prev) => ({
          ...prev,
          passCount: prev.passCount + 1,
        }));
      })
      .on("broadcast", { event: "turn_change" }, (payload) => {
        const { currentTurn, roundCleared } = payload.payload ?? {};
        setGameState((prev) => ({
          ...prev,
          currentTurn,
          ...(roundCleared ? { lastPlay: null, passCount: 0 } : {}),
        }));
        setSelectedCards([]);
        setActionError("");
      })
      .on("broadcast", { event: "game_over" }, (payload) => {
        const { results } = payload.payload ?? {};
        setGameState((prev) => ({ ...prev, status: "finished" }));
        setGameResults(results);
        fetchGameState();
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [code, mySeat, fetchGameState]);

  // Join handler for players arriving via link
  async function handleJoin() {
    if (!joinName.trim()) {
      setJoinError("請輸入暱稱");
      return;
    }
    setJoinLoading(true);
    setJoinError("");
    try {
      const res = await fetch("/api/game/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name: joinName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to join");
      localStorage.setItem("big2_roomId", data.roomId);
      localStorage.setItem("big2_playerId", data.playerId);
      localStorage.setItem("big2_sessionToken", data.sessionToken);
      localStorage.setItem("big2_seat", String(data.seat));
      localStorage.setItem("big2_code", code);
      localStorage.setItem("big2_name", joinName.trim());
      setSessionToken(data.sessionToken);
      setPlayerId(data.playerId);
      setRoomId(data.roomId);
      setMySeat(data.seat);
      setMyName(joinName.trim());

      // Broadcast to others
      const supabase = getSupabase();
      const ch = supabase.channel(`room:${code}`);
      await ch.send({
        type: "broadcast",
        event: "player_joined",
        payload: { seat: data.seat, name: joinName.trim() },
      });

      fetchGameState();
    } catch (e: unknown) {
      setJoinError(e instanceof Error ? e.message : "Error");
    } finally {
      setJoinLoading(false);
    }
  }

  // Deal / start game
  async function handleDeal() {
    const rid = roomId || localStorage.getItem("big2_roomId");
    const st = sessionToken || localStorage.getItem("big2_sessionToken");
    if (!rid || !st) return;
    setActionLoading(true);
    try {
      const res = await fetch("/api/game/deal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: rid, sessionToken: st }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to deal");
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "Error");
    } finally {
      setActionLoading(false);
    }
  }

  // Play cards
  async function handlePlay() {
    if (selectedCards.length === 0) return;
    const rid = roomId || localStorage.getItem("big2_roomId");
    const st = sessionToken || localStorage.getItem("big2_sessionToken");
    if (!rid || !st) return;
    setActionLoading(true);
    setActionError("");
    try {
      const res = await fetch("/api/game/play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: rid,
          sessionToken: st,
          cards: selectedCards,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Invalid play");
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "Error");
    } finally {
      setActionLoading(false);
    }
  }

  // Pass
  async function handlePass() {
    const rid = roomId || localStorage.getItem("big2_roomId");
    const st = sessionToken || localStorage.getItem("big2_sessionToken");
    if (!rid || !st) return;
    setActionLoading(true);
    setActionError("");
    try {
      const res = await fetch("/api/game/pass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: rid, sessionToken: st }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Cannot pass");
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "Error");
    } finally {
      setActionLoading(false);
    }
  }

  function toggleCard(card: string) {
    setSelectedCards((prev) =>
      prev.includes(card)
        ? prev.filter((c) => c !== card)
        : [...prev, card]
    );
    setActionError("");
  }

  // Determine combo type hint
  const selectedCombo = selectedCards.length > 0
    ? detectCombo(selectedCards as CardType[])
    : null;

  // Helper: get player at a relative seat position
  function getPlayerAt(relativeSeat: number): PlayerInfo | undefined {
    const targetSeat = (mySeat + relativeSeat) % 4;
    return players.find((p) => p.seat === targetSeat);
  }

  // Build player name map
  const playerNames: Record<number, string> = {};
  players.forEach((p) => {
    playerNames[p.seat] = p.name;
  });

  const isMyTurn = gameState.currentTurn === mySeat;
  const isNewRound = gameState.lastPlay === null;
  const canPass = isMyTurn && !isNewRound && gameState.status === "playing";

  // ====== RENDER: Not joined yet ======
  if (!sessionToken) {
    return (
      <div className="flex flex-col flex-1 items-center justify-center px-6">
        <div className="flex flex-col items-center gap-6 w-full max-w-sm">
          <div className="text-center">
            <div className="text-6xl font-mono font-bold text-gold-light tracking-[0.3em] mb-2">
              {code}
            </div>
            <p className="text-white/50 text-sm">輸入暱稱加入遊戲</p>
          </div>

          <input
            type="text"
            maxLength={8}
            placeholder="你的暱稱"
            value={joinName}
            onChange={(e) => setJoinName(e.target.value)}
            className="w-full py-4 px-5 rounded-2xl bg-white/10 text-white text-center text-lg
                       placeholder:text-white/30 outline-none focus:ring-2 focus:ring-gold/50"
          />

          <button
            onClick={handleJoin}
            disabled={joinLoading}
            className="w-full py-4 rounded-2xl bg-gold text-felt font-bold text-lg
                       active:scale-95 transition-transform disabled:opacity-50"
          >
            {joinLoading ? "加入中..." : "加入遊戲"}
          </button>

          {joinError && (
            <p className="text-red-400 text-sm text-center">{joinError}</p>
          )}
        </div>
      </div>
    );
  }

  // ====== RENDER: Game Over ======
  if (gameState.status === "finished" && gameResults) {
    return (
      <div className="flex flex-col flex-1 items-center justify-center">
        <GameOver
          results={gameResults}
          onGoHome={() => {
            localStorage.clear();
            router.push("/");
          }}
        />
      </div>
    );
  }

  // ====== RENDER: Lobby ======
  if (gameState.status === "waiting") {
    return (
      <div className="flex flex-col flex-1 items-center justify-center px-6">
        <div className="flex flex-col items-center gap-8 w-full max-w-sm">
          <div className="text-center">
            <p className="text-white/50 text-sm mb-1">房間碼</p>
            <div className="text-6xl font-mono font-bold text-gold-light tracking-[0.3em]">
              {code}
            </div>
          </div>

          <div className="w-full bg-white/5 rounded-2xl p-4">
            <p className="text-white/50 text-xs mb-3 text-center">等待玩家加入...</p>
            <div className="grid grid-cols-2 gap-3">
              {[0, 1, 2, 3].map((seat) => {
                const player = players.find((p) => p.seat === seat);
                return (
                  <div
                    key={seat}
                    className={`rounded-xl py-3 px-4 text-center ${
                      player ? "bg-gold/20" : "bg-white/5"
                    } ${seat === mySeat ? "ring-1 ring-gold/50" : ""}`}
                  >
                    <div className="text-white/30 text-xs mb-1">
                      座位 {seat + 1}
                    </div>
                    <div className="text-white text-sm font-medium truncate">
                      {player?.name ?? "---"}
                    </div>
                    {seat === mySeat && (
                      <div className="text-gold text-xs">(你)</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {players.length === 4 && (
            <button
              onClick={handleDeal}
              disabled={actionLoading}
              className="w-full py-4 rounded-2xl bg-gold text-felt font-bold text-lg
                         active:scale-95 transition-transform disabled:opacity-50"
            >
              {actionLoading ? "發牌中..." : "開始遊戲"}
            </button>
          )}

          {players.length < 4 && (
            <p className="text-white/40 text-sm">
              {players.length}/4 位玩家已加入
            </p>
          )}

          {actionError && (
            <p className="text-red-400 text-sm text-center">{actionError}</p>
          )}
        </div>
      </div>
    );
  }

  // ====== RENDER: Playing ======
  const topPlayer = getPlayerAt(2);
  const leftPlayer = getPlayerAt(3);
  const rightPlayer = getPlayerAt(1);

  return (
    <div className="flex flex-col flex-1 h-dvh overflow-hidden">
      {/* Top player */}
      <div className="flex justify-center pt-2 pb-1 shrink-0">
        {topPlayer && (
          <PlayerSlot
            name={topPlayer.name}
            cardCount={topPlayer.card_count}
            isCurrentTurn={gameState.currentTurn === topPlayer.seat}
            isFinished={topPlayer.is_finished}
            position="top"
          />
        )}
      </div>

      {/* Middle section: left player - play area - right player */}
      <div className="flex flex-1 min-h-0">
        {/* Left player */}
        <div className="flex items-center justify-center w-16 shrink-0">
          {leftPlayer && (
            <PlayerSlot
              name={leftPlayer.name}
              cardCount={leftPlayer.card_count}
              isCurrentTurn={gameState.currentTurn === leftPlayer.seat}
              isFinished={leftPlayer.is_finished}
              position="left"
            />
          )}
        </div>

        {/* Play area */}
        <div className="flex-1 flex flex-col items-center justify-center min-h-0">
          <div className="w-full max-w-[280px] h-[140px] rounded-2xl bg-felt-light/30 border border-white/10 p-2">
            <PlayArea
              lastPlay={gameState.lastPlay}
              isNewRound={isNewRound}
              playerNames={playerNames}
              lastAction={lastAction}
            />
          </div>

          {/* Turn indicator */}
          <div className="mt-2 text-center">
            {isMyTurn ? (
              <span className="text-gold-light text-sm font-bold fade-in">
                輪到你出牌
              </span>
            ) : (
              <span className="text-white/40 text-xs">
                等待 {playerNames[gameState.currentTurn] ?? "..."} 出牌
              </span>
            )}
          </div>
        </div>

        {/* Right player */}
        <div className="flex items-center justify-center w-16 shrink-0">
          {rightPlayer && (
            <PlayerSlot
              name={rightPlayer.name}
              cardCount={rightPlayer.card_count}
              isCurrentTurn={gameState.currentTurn === rightPlayer.seat}
              isFinished={rightPlayer.is_finished}
              position="right"
            />
          )}
        </div>
      </div>

      {/* Bottom: my hand + action bar */}
      <div className="shrink-0 pb-2">
        {/* Combo hint + error */}
        <div className="text-center h-5 mb-1">
          {actionError ? (
            <span className="text-red-400 text-xs">{actionError}</span>
          ) : selectedCombo ? (
            <span className="text-gold-light text-xs font-medium">
              {COMBO_LABELS[selectedCombo.type] ?? selectedCombo.type}
            </span>
          ) : selectedCards.length > 0 ? (
            <span className="text-red-400/70 text-xs">無效牌型</span>
          ) : null}
        </div>

        {/* Hand */}
        <Hand
          cards={myHand}
          selectedCards={selectedCards}
          onToggleCard={toggleCard}
        />

        {/* Action buttons */}
        <div className="flex justify-center gap-4 px-6 mt-2 mb-1">
          <button
            onClick={handlePass}
            disabled={!canPass || actionLoading}
            className="flex-1 py-3 rounded-xl bg-white/10 text-white font-medium text-base
                       active:scale-95 transition-transform disabled:opacity-30"
          >
            Pass
          </button>
          <button
            onClick={handlePlay}
            disabled={!isMyTurn || !selectedCombo || actionLoading}
            className="flex-1 py-3 rounded-xl bg-gold text-felt font-bold text-base
                       active:scale-95 transition-transform disabled:opacity-30"
          >
            出牌
          </button>
        </div>
      </div>
    </div>
  );
}
