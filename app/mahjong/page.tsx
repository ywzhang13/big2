"use client";

import { useState, useEffect, useRef } from "react";
import { useMahjong, getMjId } from "@/hooks/useMahjong";
import MjBoard from "@/components/mahjong/MjBoard";
import MjGameOver from "@/components/mahjong/MjGameOver";

// Read room code from URL hash: #room=XXXX
function getRoomFromHash(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash;
  const match = hash.match(/^#room=(\d{4})$/);
  return match ? match[1] : null;
}

export default function MahjongPage() {
  const [screen, setScreen] = useState<"home" | "create" | "join" | "room">("home");
  const [roomCode, setRoomCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [name, setName] = useState("");
  const [nameReady, setNameReady] = useState(false);
  const [error, setError] = useState("");
  const [createdRoomId, setCreatedRoomId] = useState("");
  // Room settings
  const [totalRounds, setTotalRounds] = useState(4);
  const [basePoints, setBasePoints] = useState(100);
  const [fanPoints, setFanPoints] = useState(20);

  // Check hash on load
  useEffect(() => {
    const code = getRoomFromHash();
    if (code) {
      setRoomCode(code);
      setScreen("room");
    }
    const stored = localStorage.getItem("mj_name");
    if (stored) {
      setName(stored);
      setNameReady(true);
    }

    const onHash = () => {
      const c = getRoomFromHash();
      if (c) {
        setRoomCode(c);
        setScreen("room");
      } else {
        setScreen("home");
        setRoomCode("");
      }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  async function handleCreate() {
    if (!name.trim()) {
      setError("請輸入暱稱");
      return;
    }
    localStorage.setItem("mj_name", name.trim());
    setNameReady(true);
    try {
      const myId = getMjId();
      const res = await fetch("/api/mahjong/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostId: myId, totalRounds, basePoints, fanPoints }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "建立房間失敗");
        return;
      }
      // Host also joins
      await fetch("/api/mahjong/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: data.code, playerId: myId, name: name.trim() }),
      });
      setRoomCode(data.code);
      setCreatedRoomId(data.roomId);
      setScreen("room");
      window.location.hash = `room=${data.code}`;
    } catch {
      setError("網路錯誤，請重試");
    }
  }

  async function handleJoin() {
    if (!joinCode || joinCode.length !== 4) {
      setError("請輸入4位數房間碼");
      return;
    }
    if (!name.trim()) {
      setError("請輸入暱稱");
      return;
    }
    localStorage.setItem("mj_name", name.trim());
    setNameReady(true);
    try {
      const myId = getMjId();
      const res = await fetch("/api/mahjong/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: joinCode, playerId: myId, name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "加入房間失敗");
        return;
      }
      setRoomCode(joinCode);
      setCreatedRoomId(data.roomId);
      setScreen("room");
      window.location.hash = `room=${joinCode}`;
    } catch {
      setError("網路錯誤，請重試");
    }
  }

  function goHome() {
    window.location.href = "/";
  }

  // --- Home / Create / Join screens ---
  if (screen !== "room") {
    return (
      <div className="flex flex-col flex-1 min-h-dvh bg-[#0f2a1a] items-center justify-center px-6">
        <div className="flex flex-col items-center gap-8 w-full max-w-sm">
          <div className="text-center">
            <div className="flex gap-1 justify-center mb-2">
              {[{t:"中",c:"#dc2626"},{t:"發",c:"#15803d"},{t:"",c:""}].map((x,i)=>(
                <div key={i} className="w-10 h-14 rounded-md flex items-center justify-center"
                  style={{background:"linear-gradient(145deg, #f5f0e0 0%, #e8dfc8 50%, #d4c9a8 100%)",boxShadow:"2px 3px 6px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.8)",border:"1px solid rgba(180,170,140,0.6)"}}>
                  {x.t ? <span className="text-xl font-black" style={{color:x.c,fontFamily:"serif"}}>{x.t}</span>
                    : <div className="w-6 h-8 rounded-sm" style={{border:"2.5px solid #1a1a1a"}} />}
                </div>
              ))}
            </div>
            <h1 className="text-5xl font-bold tracking-wider text-[#f0d68a] font-heading">
              台灣麻將
            </h1>
            <p className="text-white/50 mt-2 text-sm">Taiwan Mahjong — 4 Players</p>
          </div>

          {screen === "home" ? (
            <div className="flex flex-col gap-4 w-full fade-in">
              <button
                onClick={() => {
                  setScreen("create");
                  setError("");
                }}
                className="w-full py-4 rounded-2xl bg-[#C9A96E] text-[#0f2a1a] font-bold text-lg
                           cursor-pointer active:scale-95 transition-all duration-150
                           hover:brightness-110"
              >
                建立房間
              </button>
              <button
                onClick={() => {
                  setScreen("join");
                  setError("");
                }}
                className="w-full py-4 rounded-2xl border-2 border-[#C9A96E]/60 text-[#f0d68a] font-bold text-lg
                           cursor-pointer active:scale-95 transition-all duration-150
                           hover:border-[#C9A96E] hover:bg-[#C9A96E]/5"
              >
                加入房間
              </button>
              <button
                onClick={goHome}
                className="text-white/40 text-sm cursor-pointer hover:text-white/60 transition-colors mt-2"
              >
                返回首頁
              </button>
            </div>
          ) : screen === "create" ? (
            <div className="flex flex-col gap-4 w-full fade-in">
              <input
                type="text"
                maxLength={8}
                placeholder="你的暱稱"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full py-4 px-5 rounded-2xl bg-white/10 text-white text-center text-lg
                           placeholder:text-white/30 outline-none focus:ring-2 focus:ring-[#C9A96E]/50 transition-all"
              />

              {/* 房間設定 */}
              <div className="flex flex-col gap-3">

                {/* 圈數 Card */}
                <div className="rounded-2xl p-4"
                  style={{
                    background: "linear-gradient(145deg, rgba(201,169,110,0.08) 0%, rgba(255,255,255,0.03) 100%)",
                    border: "1px solid rgba(201,169,110,0.15)",
                  }}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[#f0d68a] text-sm font-bold">圈數</span>
                    <span className="text-white/40 text-xs">每圈4局</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {[1, 2, 4, 8].map((n) => (
                      <button
                        key={n}
                        onClick={() => setTotalRounds(n)}
                        className={`py-2.5 rounded-xl text-base font-bold cursor-pointer transition-all duration-150 active:scale-95
                          ${totalRounds === n
                            ? "bg-[#C9A96E] text-[#0f2a1a] shadow-lg shadow-[#C9A96E]/20"
                            : "bg-white/5 text-white/60 hover:bg-white/10 border border-white/5"
                          }`}
                      >
                        {n}圈
                      </button>
                    ))}
                  </div>
                </div>

                {/* 底 Card */}
                <div className="rounded-2xl p-4"
                  style={{
                    background: "linear-gradient(145deg, rgba(201,169,110,0.08) 0%, rgba(255,255,255,0.03) 100%)",
                    border: "1px solid rgba(201,169,110,0.15)",
                  }}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[#f0d68a] text-sm font-bold">底</span>
                    <span className="text-white/40 text-xs">基本分</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {[30, 50, 100, 200, 300, 500, 600, 1000].map((n) => (
                      <button
                        key={n}
                        onClick={() => setBasePoints(n)}
                        className={`py-2.5 rounded-xl text-sm font-bold cursor-pointer transition-all duration-150 active:scale-95
                          ${basePoints === n
                            ? "bg-[#C9A96E] text-[#0f2a1a] shadow-lg shadow-[#C9A96E]/20"
                            : "bg-white/5 text-white/60 hover:bg-white/10 border border-white/5"
                          }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 每台 Card */}
                <div className="rounded-2xl p-4"
                  style={{
                    background: "linear-gradient(145deg, rgba(201,169,110,0.08) 0%, rgba(255,255,255,0.03) 100%)",
                    border: "1px solid rgba(201,169,110,0.15)",
                  }}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[#f0d68a] text-sm font-bold">每台</span>
                    <span className="text-white/40 text-xs">台數加成</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[10, 20, 30, 50, 100, 200].map((n) => (
                      <button
                        key={n}
                        onClick={() => setFanPoints(n)}
                        className={`py-2.5 rounded-xl text-sm font-bold cursor-pointer transition-all duration-150 active:scale-95
                          ${fanPoints === n
                            ? "bg-[#C9A96E] text-[#0f2a1a] shadow-lg shadow-[#C9A96E]/20"
                            : "bg-white/5 text-white/60 hover:bg-white/10 border border-white/5"
                          }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 結算公式預覽 */}
                <div className="rounded-xl px-4 py-3 flex items-center justify-center gap-2"
                  style={{
                    background: "rgba(0,0,0,0.25)",
                    border: "1px dashed rgba(201,169,110,0.2)",
                  }}>
                  <span className="text-white/40 text-xs">每局</span>
                  <span className="text-[#C9A96E] font-bold text-sm">{basePoints}</span>
                  <span className="text-white/30 text-xs">+</span>
                  <span className="text-white/60 text-xs">台數</span>
                  <span className="text-white/30 text-xs">×</span>
                  <span className="text-[#C9A96E] font-bold text-sm">{fanPoints}</span>
                </div>
              </div>

              <button
                onClick={handleCreate}
                className="w-full py-4 rounded-2xl bg-[#C9A96E] text-[#0f2a1a] font-bold text-lg
                           cursor-pointer active:scale-95 transition-all duration-150
                           hover:brightness-110"
              >
                建立房間
              </button>
              <button
                onClick={() => {
                  setScreen("home");
                  setError("");
                }}
                className="text-white/40 text-sm cursor-pointer hover:text-white/60 transition-colors"
              >
                返回
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4 w-full fade-in">
              <input
                type="text"
                inputMode="numeric"
                maxLength={4}
                placeholder="房間碼 (4位數)"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, ""))}
                className="w-full py-4 px-5 rounded-2xl bg-white/10 text-white text-center text-2xl
                           tracking-[0.5em] placeholder:text-white/30 placeholder:tracking-normal
                           placeholder:text-base outline-none focus:ring-2 focus:ring-[#C9A96E]/50 transition-all"
              />
              <input
                type="text"
                maxLength={8}
                placeholder="你的暱稱"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full py-4 px-5 rounded-2xl bg-white/10 text-white text-center text-lg
                           placeholder:text-white/30 outline-none focus:ring-2 focus:ring-[#C9A96E]/50 transition-all"
              />
              <button
                onClick={handleJoin}
                className="w-full py-4 rounded-2xl bg-[#C9A96E] text-[#0f2a1a] font-bold text-lg
                           cursor-pointer active:scale-95 transition-all duration-150
                           hover:brightness-110"
              >
                加入遊戲
              </button>
              <button
                onClick={() => {
                  setScreen("home");
                  setError("");
                }}
                className="text-white/40 text-sm cursor-pointer hover:text-white/60 transition-colors"
              >
                返回
              </button>
            </div>
          )}

          {error && <p className="text-red-400 text-sm text-center fade-in">{error}</p>}
        </div>
      </div>
    );
  }

  // --- Room ---
  return (
    <RoomView
      code={roomCode}
      playerName={name}
      nameReady={nameReady}
      initialRoomId={createdRoomId}
      onSetName={(n) => {
        setName(n);
        setNameReady(true);
        localStorage.setItem("mj_name", n);
      }}
      onGoHome={goHome}
    />
  );
}

// ─── Room Component ───
function RoomView({
  code,
  playerName,
  nameReady,
  initialRoomId,
  onSetName,
  onGoHome,
}: {
  code: string;
  playerName: string;
  nameReady: boolean;
  initialRoomId: string;
  onSetName: (n: string) => void;
  onGoHome: () => void;
}) {
  const [localName, setLocalName] = useState(playerName);

  const {
    state,
    isHost,
    isMyTurn,
    needsDraw,
    needsDiscard,
    startGame,
    nextGame,
    drawTile,
    discardTile,
    doAction,
    setRoomId,
  } = useMahjong(code, nameReady ? playerName : "");

  // Pass roomId from create/join to the hook
  useEffect(() => {
    if (initialRoomId) {
      setRoomId(initialRoomId);
    }
  }, [initialRoomId, setRoomId]);

  // When joining via hash link (no initialRoomId), call join API
  useEffect(() => {
    if (nameReady && playerName && code && !initialRoomId) {
      const pid = getMjId();
      fetch("/api/mahjong/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, playerId: pid, name: playerName }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.roomId) setRoomId(data.roomId);
        })
        .catch((err) => console.error("[mj] auto-join failed:", err));
    }
  }, [nameReady, playerName, code, initialRoomId, setRoomId]);

  // Vibrate on my turn
  const prevIsMyTurn = useRef(false);
  useEffect(() => {
    if (isMyTurn && !prevIsMyTurn.current && state.status === "playing") {
      try {
        navigator.vibrate?.(200);
      } catch {}
    }
    prevIsMyTurn.current = isMyTurn;
  }, [isMyTurn, state.status]);

  // Name input (when joining via hash)
  if (!nameReady) {
    return (
      <div className="flex flex-col flex-1 min-h-dvh bg-[#0f2a1a] items-center justify-center px-6">
        <div className="flex flex-col items-center gap-6 w-full max-w-sm">
          <h2 className="text-2xl font-bold text-[#f0d68a] font-heading">加入房間 {code}</h2>
          <input
            type="text"
            maxLength={8}
            placeholder="你的暱稱"
            value={localName}
            onChange={(e) => setLocalName(e.target.value)}
            className="w-full py-4 px-5 rounded-2xl bg-white/10 text-white text-center text-lg
                       placeholder:text-white/30 outline-none focus:ring-2 focus:ring-[#C9A96E]/50 transition-all"
          />
          <button
            onClick={() => {
              if (localName.trim()) onSetName(localName.trim());
            }}
            className="w-full py-4 rounded-2xl bg-[#C9A96E] text-[#0f2a1a] font-bold text-lg
                       cursor-pointer active:scale-95 transition-all duration-150"
          >
            加入
          </button>
        </div>
      </div>
    );
  }

  // Lobby (waiting for players)
  if (state.status === "waiting") {
    const isFull = state.players.length >= 4;
    const isInRoom = state.players.some((p) => p.id === state.myId);
    const roomFull = isFull && !isInRoom;

    return (
      <div className="flex flex-col flex-1 min-h-dvh bg-[#0f2a1a] items-center justify-center px-6">
        <div className="flex flex-col items-center gap-6 w-full max-w-sm">
          <h2 className="text-xl font-bold text-[#f0d68a] font-heading">等待玩家加入</h2>

          {roomFull && (
            <div className="w-full rounded-2xl bg-red-500/20 border border-red-500/30 p-4 text-center fade-in">
              <p className="text-red-400 font-bold text-lg">房間已滿</p>
              <p className="text-red-300/70 text-sm mt-1">此房間已有 4 位玩家</p>
            </div>
          )}

          {/* Room code */}
          <div className="bg-white/10 rounded-2xl px-8 py-4 text-center">
            <p className="text-white/50 text-xs mb-1">房間碼</p>
            <p className="text-4xl font-bold text-[#C9A96E] tracking-[0.3em] font-heading">{code}</p>
            <button
              onClick={() => {
                const base = window.location.origin + "/mahjong";
                navigator.clipboard?.writeText(`${base}#room=${code}`);
              }}
              className="mt-2 text-xs text-white/40 cursor-pointer active:text-[#C9A96E] hover:text-white/60 transition-colors"
            >
              點擊複製連結
            </button>
          </div>

          {/* Room settings display */}
          {state.roomSettings && (
            <div className="bg-white/5 rounded-xl px-4 py-2.5 w-full">
              <div className="flex justify-center gap-6 text-sm">
                <span className="text-white/40">{state.roomSettings.totalRounds}圈</span>
                <span className="text-white/40">底{state.roomSettings.basePoints}</span>
                <span className="text-white/40">台{state.roomSettings.fanPoints}</span>
              </div>
            </div>
          )}

          {/* Player seats */}
          <div className="grid grid-cols-2 gap-3 w-full">
            {[0, 1, 2, 3].map((seat) => {
              const player = state.players.find((p) => p.seat === seat);
              const windChar = ["東", "南", "西", "北"][seat];
              return (
                <div
                  key={seat}
                  className={`rounded-xl p-4 text-center transition-all duration-300 ${
                    player
                      ? "bg-[#C9A96E]/20 border border-[#C9A96E]/30"
                      : "bg-white/5 border border-white/10"
                  }`}
                >
                  <p className="text-xs text-white/40 mb-1">
                    {windChar}風 · 座位 {seat + 1}
                  </p>
                  {player ? (
                    <p className="font-bold text-[#f0d68a]">
                      {player.name}
                      {player.id === state.myId && " (你)"}
                      {player.id === state.hostId && " *"}
                    </p>
                  ) : (
                    <p className="text-white/20">等待中...</p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Start button */}
          {isHost ? (
            <button
              onClick={startGame}
              disabled={state.players.length !== 4}
              className="w-full py-4 rounded-2xl bg-[#C9A96E] text-[#0f2a1a] font-bold text-lg
                         cursor-pointer active:scale-95 transition-all duration-150
                         disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {state.players.length === 4
                ? "開始遊戲"
                : `等待玩家 (${state.players.length}/4)`}
            </button>
          ) : (
            <div className="w-full py-4 rounded-2xl bg-white/10 text-center">
              <p className="text-white/50 font-medium">
                {state.players.length === 4
                  ? "等待房主開始遊戲"
                  : `等待玩家 (${state.players.length}/4)`}
              </p>
            </div>
          )}

          <button
            onClick={onGoHome}
            className="text-white/40 text-sm cursor-pointer hover:text-white/60 transition-colors"
          >
            返回首頁
          </button>
        </div>
      </div>
    );
  }

  // Playing (or finished — show board with result overlay)
  const isFinished = state.status === "finished" && state.winner;

  return (
    <div className="flex flex-col flex-1 min-h-dvh bg-[#0f2a1a] relative">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
        <button
          onClick={onGoHome}
          className="text-sm text-white/60 cursor-pointer active:text-[#f0d68a]"
        >
          離開
        </button>
        <div className="text-center">
          <h1 className="text-sm font-bold text-[#f0d68a] font-heading">
            台灣麻將 · {code}
          </h1>
          {state.roundInfo && state.roomSettings && (
            <p className="text-[10px] text-white/40">
              {["東", "南", "西", "北"][(state.roundInfo.currentRound - 1) % 4]}風圈
              {" "}第{state.roundInfo.currentGame}局
              {state.roundInfo.dealerConsecutive > 0 && ` · 連${state.roundInfo.dealerConsecutive}莊`}
            </p>
          )}
        </div>
        <div className="w-10" />
      </div>

      <MjBoard
        players={state.players}
        mySeat={state.mySeat}
        myHand={state.myHand}
        currentTurn={state.currentTurn}
        dealerSeat={state.dealerSeat}
        lastDiscard={state.lastDiscard}
        availableActions={state.availableActions}
        wallRemaining={state.wallRemaining}
        hasDrawn={state.hasDrawn}
        needsDraw={needsDraw}
        needsDiscard={needsDiscard}
        isMyTurn={isMyTurn}
        playerName={playerName}
        drawnTileId={state.drawnTileId}
        actionNotice={state.actionNotice}
        onDraw={drawTile}
        onDiscard={discardTile}
        onAction={doAction}
        dice={state.dice}
        doorSeat={state.doorSeat}
      />

      {/* Game over overlay — stays on the board */}
      {isFinished && state.winner && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-50 overflow-y-auto">
          <div className="bg-[#1a1408] border border-[#C9A96E]/30 rounded-2xl p-6 max-w-sm w-full mx-4 my-4 shadow-2xl">
            {state.winner.seat < 0 ? (
              <div className="text-center">
                <div className="w-12 h-12 mx-auto mb-2 rounded-full bg-white/5 flex items-center justify-center text-2xl">
                  &#9940;
                </div>
                <h2 className="text-xl font-bold text-white/70">流局</h2>
                <p className="text-white/40 text-sm mt-1">牌牆摸完，無人胡牌</p>
              </div>
            ) : (
              <div className="text-center">
                <div className="w-14 h-14 mx-auto mb-2 rounded-full flex items-center justify-center text-2xl"
                  style={{ background: "radial-gradient(circle, #C9A96E, #8B6914)", boxShadow: "0 0 20px rgba(201,169,110,0.4)" }}>
                  胡
                </div>
                <h2 className="text-xl font-bold text-[#f0d68a]">
                  {state.winner.name} 胡牌！
                </h2>
                {/* Show 自摸 or 放槍 */}
                <p className="text-white/50 text-sm mt-1">
                  {state.winner.score.fans.some(f => f.name.includes("自摸"))
                    ? <span className="text-[#C9A96E]">自摸</span>
                    : state.lastDiscard
                      ? <span className="text-red-400">{state.players.find(p => p.seat === state.lastDiscard?.from)?.name} 放槍</span>
                      : <span className="text-[#C9A96E]">自摸</span>
                  }
                </p>
                <p className="text-white/50 text-sm mt-1">
                  {state.winner.score.totalFan > 0 && (
                    <span>共 <span className="text-[#C9A96E] font-bold text-lg">{state.winner.score.totalFan}</span> 台</span>
                  )}
                </p>
                {/* Fan breakdown */}
                {state.winner.score.fans.length > 0 && (
                  <div className="mt-3 border-t border-white/10 pt-3">
                    {state.winner.score.fans.map((fan, i) => (
                      <div key={i} className="flex justify-between text-sm px-2 py-1">
                        <span className="text-white/70">{fan.name}</span>
                        <span className="text-[#C9A96E] font-bold">{fan.value} 台</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Settlement breakdown (底台制) */}
            {state.settlement && state.roomSettings && (
              <div className="mt-4 border-t border-white/10 pt-3">
                <p className="text-white/40 text-xs font-bold tracking-wider text-center mb-2">積分結算</p>
                <div className="bg-white/5 rounded-xl overflow-hidden">
                  {state.players.map((p) => {
                    const delta = state.settlement!.deltas[p.seat];
                    return (
                      <div key={p.seat} className="flex items-center justify-between px-3 py-2 border-b border-white/5 last:border-b-0">
                        <span className="text-white/70 text-sm">
                          {p.name}
                          {p.seat === state.mySeat && " (你)"}
                        </span>
                        <span className={`font-bold text-sm ${delta > 0 ? "text-green-400" : delta < 0 ? "text-red-400" : "text-white/40"}`}>
                          {delta > 0 ? "+" : ""}{delta}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <p className="text-white/30 text-xs text-center mt-1">
                  底{state.roomSettings.basePoints} + {state.settlement.fanTotal}台 × {state.roomSettings.fanPoints} = {state.settlement.paymentPerPlayer}
                  {state.settlement.reason === "self_draw" ? " (×3)" : ""}
                </p>
              </div>
            )}

            {/* Running scores */}
            {state.playerScores && state.roomSettings && (
              <div className="mt-3 border-t border-white/10 pt-3">
                <p className="text-white/40 text-xs font-bold tracking-wider text-center mb-2">累計積分</p>
                <div className="grid grid-cols-4 gap-1">
                  {state.players.map((p) => (
                    <div key={p.seat} className="text-center bg-white/5 rounded-lg py-2 px-1">
                      <p className="text-[10px] text-white/40 truncate">{p.name}</p>
                      <p className={`font-bold text-sm ${
                        state.playerScores![p.seat] > 0 ? "text-green-400" :
                        state.playerScores![p.seat] < 0 ? "text-red-400" : "text-white/50"
                      }`}>
                        {state.playerScores![p.seat] > 0 ? "+" : ""}{state.playerScores![p.seat]}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-col gap-3 mt-4">
              {state.roomSettings && !state.gameOver && (
                <>
                  {/* Ready check — 4 player consent */}
                  <div className="rounded-xl bg-white/5 border border-[#C9A96E]/15 p-3">
                    <p className="text-[10px] text-white/40 text-center mb-2 font-bold tracking-wider">
                      四家同意後開始下一局 ({(state.nextGameReady?.length ?? 0)}/4)
                    </p>
                    <div className="grid grid-cols-4 gap-1.5">
                      {state.players.map((p) => {
                        const isReady = state.nextGameReady?.includes(p.id) ?? false;
                        return (
                          <div
                            key={p.seat}
                            className={`text-center py-1.5 px-1 rounded-lg text-[10px] font-bold transition-all ${
                              isReady
                                ? "bg-[#C9A96E]/30 text-[#f0d68a] border border-[#C9A96E]/50"
                                : "bg-white/5 text-white/40 border border-white/10"
                            }`}
                          >
                            <div>{isReady ? "✓" : "·"}</div>
                            <div className="truncate">{p.name}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* My ready button */}
                  {state.nextGameReady?.includes(state.myId) ? (
                    <div className="py-3 rounded-xl bg-white/10 text-center">
                      <p className="text-white/50 text-sm">已確認，等待其他玩家...</p>
                    </div>
                  ) : (
                    <button
                      onClick={nextGame}
                      className="py-3 rounded-xl bg-[#C9A96E] text-[#0f2a1a] font-bold
                        cursor-pointer active:scale-95 transition-all"
                    >
                      同意下一局
                    </button>
                  )}
                </>
              )}

              <button
                onClick={onGoHome}
                className={`py-3 rounded-xl font-bold
                  cursor-pointer active:scale-95 transition-all
                  ${state.gameOver ? "bg-[#C9A96E] text-[#0f2a1a]" : "border border-white/15 text-white/60"}`}
              >
                {state.gameOver ? "結束 · 回大廳" : "回大廳"}
              </button>
            </div>

            {/* Game over final standings */}
            {state.gameOver && state.playerScores && (
              <div className="mt-4 border-t border-[#C9A96E]/30 pt-3">
                <p className="text-[#f0d68a] text-sm font-bold text-center mb-2">
                  {state.roomSettings?.totalRounds}圈結束 — 最終排名
                </p>
                <div className="flex flex-col gap-1">
                  {[...state.players]
                    .sort((a, b) => (state.playerScores![b.seat]) - (state.playerScores![a.seat]))
                    .map((p, rank) => (
                      <div key={p.seat} className="flex items-center justify-between px-3 py-2 bg-white/5 rounded-lg">
                        <span className="text-white/70 text-sm">
                          <span className="text-[#C9A96E] font-bold mr-2">#{rank + 1}</span>
                          {p.name}
                        </span>
                        <span className={`font-bold ${
                          state.playerScores![p.seat] > 0 ? "text-green-400" :
                          state.playerScores![p.seat] < 0 ? "text-red-400" : "text-white/50"
                        }`}>
                          {state.playerScores![p.seat] > 0 ? "+" : ""}{state.playerScores![p.seat]}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
