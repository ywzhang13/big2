"use client";

import { useState, useEffect, useRef } from "react";
import { useGame } from "@/hooks/useGame";
import { detectCombo } from "@/lib/combo";
import { beats } from "@/lib/compare";
import Hand from "@/components/Hand";
import PlayArea from "@/components/PlayArea";
import PlayerSlot from "@/components/PlayerSlot";
import GameOver from "@/components/GameOver";
import type { Card as CardType } from "@/lib/constants";
import { calculateScore } from "@/lib/scoring";

function genCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

// Read room code from URL hash: #room=XXXX
function getRoomFromHash(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash;
  const match = hash.match(/^#room=(\d{4})$/);
  return match ? match[1] : null;
}

export default function Home() {
  const [screen, setScreen] = useState<"home" | "create" | "join" | "room">("home");
  const [roomCode, setRoomCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [name, setName] = useState("");
  const [nameReady, setNameReady] = useState(false);
  const [error, setError] = useState("");

  // Check hash on load
  useEffect(() => {
    const code = getRoomFromHash();
    if (code) {
      setRoomCode(code);
      setScreen("room");
    }
    const stored = localStorage.getItem("big2_name");
    if (stored) {
      setName(stored);
      setNameReady(true);
    }

    const onHash = () => {
      const c = getRoomFromHash();
      if (c) { setRoomCode(c); setScreen("room"); }
      else { setScreen("home"); setRoomCode(""); }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function handleCreate() {
    if (!name.trim()) { setError("請輸入暱稱"); return; }
    localStorage.setItem("big2_name", name.trim());
    setNameReady(true);
    const code = genCode();
    setRoomCode(code);
    setScreen("room");
    window.location.hash = `room=${code}`;
  }

  function handleJoin() {
    if (!joinCode || joinCode.length !== 4) { setError("請輸入4位數房間碼"); return; }
    if (!name.trim()) { setError("請輸入暱稱"); return; }
    localStorage.setItem("big2_name", name.trim());
    setNameReady(true);
    setRoomCode(joinCode);
    setScreen("room");
    window.location.hash = `room=${joinCode}`;
  }

  function goHome() {
    setScreen("home");
    setRoomCode("");
    window.location.hash = "";
  }

  // ─── Home / Create / Join screens ───
  if (screen !== "room") {
    return (
      <div className="flex flex-col flex-1 items-center justify-center px-6">
        <div className="flex flex-col items-center gap-8 w-full max-w-sm">
          <div className="text-center">
            <div className="text-5xl mb-2">
              <span className="text-red-400">&#9829;</span>
              <span className="text-white">&#9824;</span>
              <span className="text-red-400">&#9830;</span>
              <span className="text-white">&#9827;</span>
            </div>
            <h1 className="text-5xl font-bold tracking-wider text-gold-light font-heading">大老二</h1>
            <p className="text-white/50 mt-2 text-sm">Big Two &mdash; 4 Players</p>
          </div>

          {screen === "home" ? (
            <div className="flex flex-col gap-4 w-full fade-in">
              <button onClick={() => { setScreen("create"); setError(""); }}
                className="w-full py-4 rounded-2xl bg-gold text-felt font-bold text-lg
                           cursor-pointer active:scale-95 transition-all duration-150
                           hover:brightness-110">
                建立房間
              </button>
              <button onClick={() => { setScreen("join"); setError(""); }}
                className="w-full py-4 rounded-2xl border-2 border-gold/60 text-gold-light font-bold text-lg
                           cursor-pointer active:scale-95 transition-all duration-150
                           hover:border-gold hover:bg-gold/5">
                加入房間
              </button>
            </div>
          ) : screen === "create" ? (
            <div className="flex flex-col gap-4 w-full fade-in">
              <input type="text" maxLength={8} placeholder="你的暱稱" value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full py-4 px-5 rounded-2xl bg-white/10 text-white text-center text-lg placeholder:text-white/30 outline-none focus:ring-2 focus:ring-gold/50 transition-all" />
              <button onClick={handleCreate}
                className="w-full py-4 rounded-2xl bg-gold text-felt font-bold text-lg
                           cursor-pointer active:scale-95 transition-all duration-150
                           hover:brightness-110">
                建立房間
              </button>
              <button onClick={() => { setScreen("home"); setError(""); }}
                className="text-white/40 text-sm cursor-pointer hover:text-white/60 transition-colors">
                返回
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4 w-full fade-in">
              <input type="text" inputMode="numeric" maxLength={4} placeholder="房間碼 (4位數)" value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, ""))}
                className="w-full py-4 px-5 rounded-2xl bg-white/10 text-white text-center text-2xl tracking-[0.5em] placeholder:text-white/30 placeholder:tracking-normal placeholder:text-base outline-none focus:ring-2 focus:ring-gold/50 transition-all" />
              <input type="text" maxLength={8} placeholder="你的暱稱" value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full py-4 px-5 rounded-2xl bg-white/10 text-white text-center text-lg placeholder:text-white/30 outline-none focus:ring-2 focus:ring-gold/50 transition-all" />
              <button onClick={handleJoin}
                className="w-full py-4 rounded-2xl bg-gold text-felt font-bold text-lg
                           cursor-pointer active:scale-95 transition-all duration-150
                           hover:brightness-110">
                加入遊戲
              </button>
              <button onClick={() => { setScreen("home"); setError(""); }}
                className="text-white/40 text-sm cursor-pointer hover:text-white/60 transition-colors">
                返回
              </button>
            </div>
          )}

          {error && <p className="text-red-400 text-sm text-center fade-in">{error}</p>}
        </div>
      </div>
    );
  }

  // ─── Room ───
  return <RoomView code={roomCode} playerName={name} nameReady={nameReady}
    onSetName={(n) => { setName(n); setNameReady(true); localStorage.setItem("big2_name", n); }}
    onGoHome={goHome} />;
}

// ─── Room Component ───
function RoomView({ code, playerName, nameReady, onSetName, onGoHome }: {
  code: string; playerName: string; nameReady: boolean;
  onSetName: (n: string) => void; onGoHome: () => void;
}) {
  const [localName, setLocalName] = useState(playerName);
  const [selectedCards, setSelectedCards] = useState<CardType[]>([]);
  const [playError, setPlayError] = useState("");

  const { state, isHost, startGame, confirmReady, dealAndStart, continueGame, playCards, pass, isMyTurn, canPass } = useGame(
    code, nameReady ? playerName : ""
  );

  // Auto-deal when all 4 players are ready (host triggers)
  const allReady = state.readyCheck && state.readyPlayers.size >= state.players.length && state.players.length === 4;
  useEffect(() => {
    if (allReady && state.status === "waiting") {
      // Small delay so everyone sees "all ready" state
      const t = setTimeout(() => dealAndStart(), 500);
      return () => clearTimeout(t);
    }
  }, [allReady, state.status, dealAndStart]);

  // Vibrate when it becomes my turn
  const prevIsMyTurn = useRef(false);
  useEffect(() => {
    if (isMyTurn && !prevIsMyTurn.current && state.status === "playing") {
      try { navigator.vibrate?.(200); } catch {}
    }
    prevIsMyTurn.current = isMyTurn;
  }, [isMyTurn, state.status]);

  const toggleCard = (card: CardType) => {
    setSelectedCards((prev) => prev.includes(card) ? prev.filter((c) => c !== card) : [...prev, card]);
    setPlayError("");
  };

  const selectedCombo = selectedCards.length > 0 ? detectCombo(selectedCards) : null;
  const isValidPlay = (() => {
    if (!selectedCombo || !isMyTurn) return false;
    if (state.lastPlay === null) {
      const isFirstTurn = state.players.every((p) => p.cardCount === 13);
      if (isFirstTurn && state.myHand.includes("3C") && !selectedCards.includes("3C")) return false;
      return true;
    }
    return beats(state.lastPlay.combo, selectedCombo);
  })();

  const handlePlay = () => {
    const result = playCards(selectedCards);
    if (result.success) { setSelectedCards([]); setPlayError(""); }
    else setPlayError(result.error || "無效的出牌");
  };

  const handlePass = () => { pass(); setSelectedCards([]); setPlayError(""); };

  const comboName = (type: string) => {
    const m: Record<string, string> = { single: "單張", pair: "對子", straight: "順子", fullHouse: "葫蘆", fourOfAKind: "鐵支", straightFlush: "同花順" };
    return m[type] || type;
  };

  const getOpponent = (offset: number) => {
    const seat = (state.mySeat + offset) % 4;
    return state.players.find((p) => p.seat === seat);
  };

  // Name input
  if (!nameReady) {
    return (
      <div className="flex flex-col flex-1 items-center justify-center px-6">
        <div className="flex flex-col items-center gap-6 w-full max-w-sm">
          <h2 className="text-2xl font-bold text-gold-light font-heading">加入房間 {code}</h2>
          <input type="text" maxLength={8} placeholder="你的暱稱" value={localName}
            onChange={(e) => setLocalName(e.target.value)}
            className="w-full py-4 px-5 rounded-2xl bg-white/10 text-white text-center text-lg placeholder:text-white/30 outline-none focus:ring-2 focus:ring-gold/50 transition-all" />
          <button onClick={() => { if (localName.trim()) onSetName(localName.trim()); }}
            className="w-full py-4 rounded-2xl bg-gold text-felt font-bold text-lg
                       cursor-pointer active:scale-95 transition-all duration-150">
            加入
          </button>
        </div>
      </div>
    );
  }

  // Lobby
  if (state.status === "waiting") {
    const isFull = state.players.length >= 4;
    const isInRoom = state.players.some((p) => p.id === state.myId);
    const roomFull = isFull && !isInRoom;

    return (
      <div className="flex flex-col flex-1 items-center justify-center px-6">
        <div className="flex flex-col items-center gap-6 w-full max-w-sm">
          <h2 className="text-xl font-bold text-gold-light font-heading">等待玩家加入</h2>

          {roomFull && (
            <div className="w-full rounded-2xl bg-red-500/20 border border-red-500/30 p-4 text-center fade-in">
              <p className="text-red-400 font-bold text-lg">房間已滿</p>
              <p className="text-red-300/70 text-sm mt-1">此房間已有 4 位玩家</p>
            </div>
          )}

          <div className="bg-white/10 rounded-2xl px-8 py-4 text-center">
            <p className="text-white/50 text-xs mb-1">房間碼</p>
            <p className="text-4xl font-bold text-gold tracking-[0.3em] font-heading">{code}</p>
            <button onClick={() => {
              const base = window.location.origin + window.location.pathname;
              navigator.clipboard?.writeText(`${base}#room=${code}`);
            }} className="mt-2 text-xs text-white/40 cursor-pointer active:text-gold hover:text-white/60 transition-colors">
              點擊複製連結
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 w-full">
            {[0, 1, 2, 3].map((seat) => {
              const player = state.players.find((p) => p.seat === seat);
              const isReady = player ? state.readyPlayers.has(player.id) : false;
              return (
                <div key={seat} className={`rounded-xl p-4 text-center transition-all duration-300 ${
                  isReady ? "bg-green-500/20 border border-green-500/40" :
                  player ? "bg-gold/20 border border-gold/30" : "bg-white/5 border border-white/10"
                }`}>
                  <p className="text-xs text-white/40 mb-1">座位 {seat + 1}</p>
                  {player ? (
                    <div>
                      <p className="font-bold text-gold-light">
                        {player.name}
                        {player.id === state.myId && " (你)"}
                        {player.id === state.hostId && " 👑"}
                      </p>
                      {state.readyCheck && (
                        <p className={`text-xs mt-1 font-bold ${isReady ? "text-green-400" : "text-white/30"}`}>
                          {isReady ? "✓ 準備好了" : "等待確認..."}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-white/20">等待中...</p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Ready check state */}
          {state.readyCheck && !state.readyPlayers.has(state.myId) ? (
            <button onClick={confirmReady}
              className="w-full py-4 rounded-2xl bg-green-500 text-white font-bold text-lg
                         cursor-pointer active:scale-95 transition-all duration-150 animate-pulse">
              準備好了！
            </button>
          ) : state.readyCheck ? (
            <div className="w-full py-4 rounded-2xl bg-white/10 text-center">
              <p className="text-gold-light font-bold">等待其他玩家準備 ({state.readyPlayers.size}/{state.players.length})</p>
            </div>
          ) : isHost ? (
            <button onClick={startGame} disabled={state.players.length !== 4}
              className="w-full py-4 rounded-2xl bg-gold text-felt font-bold text-lg
                         cursor-pointer active:scale-95 transition-all duration-150
                         disabled:opacity-30 disabled:cursor-not-allowed">
              {state.players.length === 4 ? "開始遊戲" : `等待玩家 (${state.players.length}/4)`}
            </button>
          ) : (
            <div className="w-full py-4 rounded-2xl bg-white/10 text-center">
              <p className="text-white/50 font-medium">
                {state.players.length === 4 ? "等待房主開始遊戲" : `等待玩家 (${state.players.length}/4)`}
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Game Over
  if (state.status === "finished") {
    // Calculate losers' scores first
    const roundScores: Record<string, number> = {};
    let losersTotal = 0;
    state.players.forEach((p) => {
      const hand = (state.finishedHands || {})[p.id] || [];
      const score = calculateScore(hand);
      roundScores[p.id] = score;
      if (score < 0) losersTotal += score; // negative
    });
    // Winner gets absolute value of losers' total
    const winnerId = state.players.find((p) => p.finishOrder === 1)?.id;
    if (winnerId) roundScores[winnerId] = Math.abs(losersTotal);

    const results = state.players.map((p) => ({
      seat: p.seat, name: p.name,
      hand: (state.finishedHands || {})[p.id] || [],
      finishOrder: p.finishOrder ?? null,
      roundScore: roundScores[p.id] || 0,
      score: (state.scores[p.id] || 0) + (roundScores[p.id] || 0),
    }));
    return <GameOver results={results} onGoHome={onGoHome} onPlayAgain={isHost ? continueGame : undefined} />;
  }

  // Playing
  const top = getOpponent(2);
  const left = getOpponent(3);
  const right = getOpponent(1);

  return (
    <div className="flex flex-col flex-1 overflow-hidden relative">
      <div className="flex justify-center pt-safe px-4 py-2">
        {top && <PlayerSlot name={top.name} cardCount={top.cardCount} isCurrentTurn={state.currentTurn === top.seat} isFinished={top.isFinished} position="top" score={state.scores[top.id]} />}
      </div>

      <div className="flex-1 flex items-center px-2 min-h-0">
        <div className="w-16 flex-shrink-0">
          {left && <PlayerSlot name={left.name} cardCount={left.cardCount} isCurrentTurn={state.currentTurn === left.seat} isFinished={left.isFinished} position="left" score={state.scores[left.id]} />}
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <PlayArea
            lastPlay={state.lastPlay ? { cards: state.lastPlay.cards, comboType: comboName(state.lastPlay.combo.type), playerName: state.lastPlay.playerName } : null}
            isNewRound={state.lastPlay === null} />
          {isMyTurn ? (
            <div className="px-4 py-1.5 rounded-full bg-gold/20 border border-gold/40 animate-pulse">
              <p className="text-sm font-bold text-gold-light">輪到你出牌</p>
            </div>
          ) : (
            <p className="text-xs text-white/50">
              等待 {state.players.find((p) => p.seat === state.currentTurn)?.name || "..."}
            </p>
          )}
        </div>
        <div className="w-16 flex-shrink-0">
          {right && <PlayerSlot name={right.name} cardCount={right.cardCount} isCurrentTurn={state.currentTurn === right.seat} isFinished={right.isFinished} position="right" score={state.scores[right.id]} />}
        </div>
      </div>

      <div className="pb-safe bg-black/30 backdrop-blur-sm rounded-t-2xl">
        <div className="h-7 flex items-center justify-between px-4">
          <span className="text-[10px] text-white/40">
            {playerName} · <span className={`font-bold ${state.myHand.length <= 3 ? "text-red-400" : "text-gold-light"}`}>{state.myHand.length}</span> 張
            {(state.scores[state.myId] ?? 0) !== 0 && (
              <span className={`ml-1.5 font-bold ${(state.scores[state.myId] || 0) > 0 ? "text-green-400" : "text-red-400"}`}>
                {(state.scores[state.myId] || 0) > 0 ? "+" : ""}{state.scores[state.myId]}分
              </span>
            )}
          </span>
          <div>
            {selectedCombo && (
              <span className={`text-xs font-bold px-3 py-0.5 rounded-full ${isValidPlay ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                {comboName(selectedCombo.type)}{!isValidPlay && state.lastPlay ? " (打不過)" : ""}
              </span>
            )}
            {playError && <span className="text-xs text-red-400">{playError}</span>}
          </div>
        </div>
        <Hand cards={state.myHand} selectedCards={selectedCards} onToggleCard={toggleCard} />
        <div className="flex gap-3 px-4 py-3">
          <button onClick={handlePass} disabled={!canPass}
            className="flex-1 py-3 rounded-xl bg-white/10 text-white font-bold text-sm
                       cursor-pointer active:scale-95 transition-all duration-150
                       disabled:opacity-30 disabled:cursor-not-allowed">
            Pass
          </button>
          <button onClick={handlePlay} disabled={!isValidPlay}
            className="flex-1 py-3 rounded-xl bg-gold text-felt font-bold text-sm
                       cursor-pointer active:scale-95 transition-all duration-150
                       disabled:opacity-30 disabled:cursor-not-allowed">
            出牌
          </button>
        </div>
      </div>
    </div>
  );
}
