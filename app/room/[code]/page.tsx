"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { useGame } from "@/hooks/useGame";
import { detectCombo } from "@/lib/combo";
import { beats } from "@/lib/compare";
import Hand from "@/components/Hand";
import PlayArea from "@/components/PlayArea";
import PlayerSlot from "@/components/PlayerSlot";
import GameOver from "@/components/GameOver";
import type { Card as CardType } from "@/lib/constants";
// eslint-disable-next-line @typescript-eslint/no-unused-vars

export default function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();
  const [playerName, setPlayerName] = useState("");
  const [nameSet, setNameSet] = useState(false);
  const [selectedCards, setSelectedCards] = useState<CardType[]>([]);
  const [playError, setPlayError] = useState("");

  useEffect(() => {
    const stored = localStorage.getItem("big2_name");
    if (stored) {
      setPlayerName(stored);
      setNameSet(true);
    }
  }, []);

  const { state, startGame, playCards, pass, isMyTurn, canPass } = useGame(
    code,
    nameSet ? playerName : ""
  );

  const toggleCard = (card: CardType) => {
    setSelectedCards((prev) =>
      prev.includes(card) ? prev.filter((c) => c !== card) : [...prev, card]
    );
    setPlayError("");
  };

  const selectedCombo = selectedCards.length > 0 ? detectCombo(selectedCards) : null;
  const isValidPlay = (() => {
    if (!selectedCombo || !isMyTurn) return false;
    const isNewRound = state.lastPlay === null;
    if (isNewRound) {
      const isFirstTurn = state.players.every((p) => p.cardCount === 13);
      if (isFirstTurn && state.myHand.includes("3C") && !selectedCards.includes("3C")) return false;
      return true;
    }
    if (!state.lastPlay) return true;
    return beats(state.lastPlay.combo, selectedCombo);
  })();

  const handlePlay = () => {
    const result = playCards(selectedCards);
    if (result.success) {
      setSelectedCards([]);
      setPlayError("");
    } else {
      setPlayError(result.error || "無效的出牌");
    }
  };

  const handlePass = () => {
    pass();
    setSelectedCards([]);
    setPlayError("");
  };

  const comboName = (type: string) => {
    const names: Record<string, string> = {
      single: "單張", pair: "對子", straight: "順子",
      fullHouse: "葫蘆", fourOfAKind: "鐵支", straightFlush: "同花順",
    };
    return names[type] || type;
  };

  const getOpponent = (offset: number) => {
    const seat = (state.mySeat + offset) % 4;
    return state.players.find((p) => p.seat === seat);
  };

  // Name input
  if (!nameSet) {
    return (
      <div className="flex flex-col flex-1 items-center justify-center px-6">
        <div className="flex flex-col items-center gap-6 w-full max-w-sm">
          <h2 className="text-2xl font-bold text-gold-light">加入房間 {code}</h2>
          <input
            type="text" maxLength={8} placeholder="你的暱稱" value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            className="w-full py-4 px-5 rounded-2xl bg-white/10 text-white text-center text-lg placeholder:text-white/30 outline-none focus:ring-2 focus:ring-gold/50"
          />
          <button
            onClick={() => { if (playerName.trim()) { localStorage.setItem("big2_name", playerName.trim()); setNameSet(true); } }}
            className="w-full py-4 rounded-2xl bg-gold text-felt font-bold text-lg active:scale-95 transition-transform"
          >
            加入
          </button>
        </div>
      </div>
    );
  }

  // ─── Lobby ───
  if (state.status === "waiting") {
    return (
      <div className="flex flex-col flex-1 items-center justify-center px-6">
        <div className="flex flex-col items-center gap-6 w-full max-w-sm">
          <h2 className="text-xl font-bold text-gold-light">等待玩家加入</h2>
          <div className="bg-white/10 rounded-2xl px-8 py-4 text-center">
            <p className="text-white/50 text-xs mb-1">房間碼</p>
            <p className="text-4xl font-bold text-gold tracking-[0.3em]">{code}</p>
            <button
              onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/room/${code}`)}
              className="mt-2 text-xs text-white/40 active:text-gold"
            >
              點擊複製連結
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 w-full">
            {[0, 1, 2, 3].map((seat) => {
              const player = state.players.find((p) => p.seat === seat);
              return (
                <div key={seat} className={`rounded-xl p-4 text-center ${player ? "bg-gold/20 border border-gold/30" : "bg-white/5 border border-white/10"}`}>
                  <p className="text-xs text-white/40 mb-1">座位 {seat + 1}</p>
                  {player ? (
                    <p className="font-bold text-gold-light">{player.name}{player.id === state.myId && " (你)"}</p>
                  ) : (
                    <p className="text-white/20">等待中...</p>
                  )}
                </div>
              );
            })}
          </div>
          <button
            onClick={startGame}
            disabled={state.players.length !== 4}
            className="w-full py-4 rounded-2xl bg-gold text-felt font-bold text-lg active:scale-95 transition-transform disabled:opacity-30"
          >
            {state.players.length === 4 ? "開始遊戲" : `等待玩家 (${state.players.length}/4)`}
          </button>
        </div>
      </div>
    );
  }

  // ─── Game Over ───
  if (state.status === "finished") {
    const results = state.players.map((p) => ({
      seat: p.seat,
      name: p.name,
      hand: (state.finishedHands || {})[p.id] || [],
      finishOrder: p.finishOrder ?? null,
    }));
    return <GameOver results={results} onGoHome={() => router.push("/")} />;
  }

  // ─── Playing ───
  const topOpponent = getOpponent(2);
  const leftOpponent = getOpponent(3);
  const rightOpponent = getOpponent(1);

  return (
    <div className="flex flex-col flex-1 overflow-hidden relative">
      {/* Top opponent */}
      <div className="flex justify-center pt-safe px-4 py-2">
        {topOpponent && (
          <PlayerSlot name={topOpponent.name} cardCount={topOpponent.cardCount}
            isCurrentTurn={state.currentTurn === topOpponent.seat} isFinished={topOpponent.isFinished} position="top" />
        )}
      </div>

      {/* Middle: left + play area + right */}
      <div className="flex-1 flex items-center px-2 min-h-0">
        <div className="w-16 flex-shrink-0">
          {leftOpponent && (
            <PlayerSlot name={leftOpponent.name} cardCount={leftOpponent.cardCount}
              isCurrentTurn={state.currentTurn === leftOpponent.seat} isFinished={leftOpponent.isFinished} position="left" />
          )}
        </div>

        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <PlayArea
            lastPlay={state.lastPlay ? { cards: state.lastPlay.cards, comboType: comboName(state.lastPlay.combo.type), playerName: state.lastPlay.playerName } : null}
            isNewRound={state.lastPlay === null}
          />
          <p className="text-xs text-white/50">
            {isMyTurn ? "輪到你出牌" : `等待 ${state.players.find((p) => p.seat === state.currentTurn)?.name || "..."}`}
          </p>
        </div>

        <div className="w-16 flex-shrink-0">
          {rightOpponent && (
            <PlayerSlot name={rightOpponent.name} cardCount={rightOpponent.cardCount}
              isCurrentTurn={state.currentTurn === rightOpponent.seat} isFinished={rightOpponent.isFinished} position="right" />
          )}
        </div>
      </div>

      {/* Bottom: hand + actions */}
      <div className="pb-safe bg-black/30 backdrop-blur-sm rounded-t-2xl">
        <div className="h-7 flex items-center justify-center">
          {selectedCombo && (
            <span className={`text-xs font-bold px-3 py-0.5 rounded-full ${isValidPlay ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
              {comboName(selectedCombo.type)}{!isValidPlay && state.lastPlay ? " (打不過)" : ""}
            </span>
          )}
          {playError && <span className="text-xs text-red-400">{playError}</span>}
        </div>

        <Hand cards={state.myHand} selectedCards={selectedCards} onToggleCard={toggleCard} />

        <div className="flex gap-3 px-4 py-3">
          <button onClick={handlePass} disabled={!canPass}
            className="flex-1 py-3 rounded-xl bg-white/10 text-white font-bold text-sm active:scale-95 transition-transform disabled:opacity-30">
            Pass
          </button>
          <button onClick={handlePlay} disabled={!isValidPlay}
            className="flex-1 py-3 rounded-xl bg-gold text-felt font-bold text-sm active:scale-95 transition-transform disabled:opacity-30">
            出牌
          </button>
        </div>
      </div>
    </div>
  );
}
